\set ON_ERROR_STOP on
\ir source-access.sql

-- The audit schema contains only hashed record fingerprints. It is a local
-- quarantine manifest: conflicted Neon rows never reach public application
-- tables and must be explicitly remediated before a clean-target rerun.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS merge_audit;
CREATE TABLE IF NOT EXISTS merge_audit.conflict_manifest (
  source_system text NOT NULL,
  entity_type text NOT NULL,
  conflict_reason text NOT NULL,
  record_fingerprint text NOT NULL,
  detected_at timestamp without time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, entity_type, conflict_reason, record_fingerprint)
);
CREATE TABLE IF NOT EXISTS merge_audit.disposition_counts (
  source_system text NOT NULL,
  entity_type text NOT NULL,
  disposition text NOT NULL,
  row_count bigint NOT NULL CHECK (row_count >= 0),
  PRIMARY KEY (source_system, entity_type, disposition)
);

-- Refuse a rerun before clearing the prior audit evidence. A successful
-- rehearsal must be rebuilt from a new disposable target, not mixed with or
-- partially audited against an existing canonical dataset.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users)
     OR EXISTS (SELECT 1 FROM public.pages)
     OR EXISTS (SELECT 1 FROM public.resources)
     OR EXISTS (SELECT 1 FROM public.asset_deletion_queue) THEN
    RAISE EXCEPTION 'Canonical target is not empty; create a new disposable target rather than merging into existing data';
  END IF;
END $$;

DELETE FROM merge_audit.conflict_manifest;
DELETE FROM merge_audit.disposition_counts;

-- One statement per unsafe Neon record/reason makes the manifest deterministic
-- without exposing user, page, resource, path, or provider values. A shared
-- user ID is not unsafe by itself: it is the same Google subject, and Heroku
-- deterministically wins its attributes. Neon pages retaining that user ID
-- therefore attach to the Heroku user without an FK rewrite.

INSERT INTO merge_audit.conflict_manifest (source_system, entity_type, conflict_reason, record_fingerprint)
SELECT 'neon', 'users', 'email_owned_by_different_heroku_id', encode(digest('users:' || n.id, 'sha256'), 'hex')
FROM neon_source.users n JOIN heroku_source.users h ON h.email = n.email AND h.id <> n.id;

INSERT INTO merge_audit.conflict_manifest (source_system, entity_type, conflict_reason, record_fingerprint)
SELECT 'neon', 'users', 'username_owned_by_different_heroku_id', encode(digest('users:' || n.id, 'sha256'), 'hex')
FROM neon_source.users n JOIN heroku_source.users h
  ON n.username IS NOT NULL AND h.username = n.username AND h.id <> n.id;

INSERT INTO merge_audit.conflict_manifest (source_system, entity_type, conflict_reason, record_fingerprint)
SELECT 'neon', 'pages', 'uuid_owned_by_heroku', encode(digest('pages:' || n.id::text, 'sha256'), 'hex')
FROM neon_source.pages n JOIN heroku_source.pages h ON h.id = n.id;

INSERT INTO merge_audit.conflict_manifest (source_system, entity_type, conflict_reason, record_fingerprint)
SELECT 'neon', 'pages', 'path_code_owned_by_heroku', encode(digest('pages:' || n.id::text, 'sha256'), 'hex')
FROM neon_source.pages n JOIN heroku_source.pages h
  ON n.path_code IS NOT NULL AND h.path_code = n.path_code AND h.id <> n.id;

INSERT INTO merge_audit.conflict_manifest (source_system, entity_type, conflict_reason, record_fingerprint)
SELECT 'neon', 'pages', 'session_id_shared_with_heroku_room', encode(digest('pages:' || n.id::text, 'sha256'), 'hex')
FROM neon_source.pages n JOIN heroku_source.pages h
  ON n.session_id IS NOT NULL AND h.session_id = n.session_id AND h.id <> n.id;

INSERT INTO merge_audit.conflict_manifest (source_system, entity_type, conflict_reason, record_fingerprint)
SELECT 'neon', 'pages', 'user_identity_conflict_or_missing', encode(digest('pages:' || n.id::text, 'sha256'), 'hex')
FROM neon_source.pages n
WHERE n.user_id IS NOT NULL
  AND (
    NOT EXISTS (SELECT 1 FROM neon_source.users u WHERE u.id = n.user_id)
    OR EXISTS (
      SELECT 1 FROM merge_audit.conflict_manifest m
      WHERE m.source_system = 'neon' AND m.entity_type = 'users'
        AND m.record_fingerprint = encode(digest('users:' || n.user_id, 'sha256'), 'hex')
    )
  );

INSERT INTO merge_audit.conflict_manifest (source_system, entity_type, conflict_reason, record_fingerprint)
SELECT 'neon', 'resources', 'uuid_owned_by_heroku', encode(digest('resources:' || n.id::text, 'sha256'), 'hex')
FROM neon_source.resources n JOIN heroku_source.resources h ON h.id = n.id;

INSERT INTO merge_audit.conflict_manifest (source_system, entity_type, conflict_reason, record_fingerprint)
SELECT 'neon', 'resources', 'parent_page_conflict_or_missing', encode(digest('resources:' || n.id::text, 'sha256'), 'hex')
FROM neon_source.resources n
WHERE NOT EXISTS (SELECT 1 FROM neon_source.pages p WHERE p.id = n.page_id)
   OR EXISTS (
     SELECT 1 FROM merge_audit.conflict_manifest m
     WHERE m.source_system = 'neon' AND m.entity_type = 'pages'
       AND m.record_fingerprint = encode(digest('pages:' || n.page_id::text, 'sha256'), 'hex')
   );

-- Source integrity errors are also fail-closed and retained as aggregate
-- manifest rows. The fingerprint is constant because there is no safe record
-- identity to carry forward.
INSERT INTO merge_audit.conflict_manifest (source_system, entity_type, conflict_reason, record_fingerprint)
SELECT source_system, entity_type, conflict_reason, encode(digest(source_system || ':' || entity_type || ':' || conflict_reason, 'sha256'), 'hex')
FROM (
  SELECT 'heroku'::text AS source_system, 'pages'::text AS entity_type, 'orphan_user'::text AS conflict_reason
  WHERE EXISTS (SELECT 1 FROM heroku_source.pages p LEFT JOIN heroku_source.users u ON u.id = p.user_id WHERE p.user_id IS NOT NULL AND u.id IS NULL)
  UNION ALL SELECT 'neon', 'pages', 'orphan_user'
  WHERE EXISTS (SELECT 1 FROM neon_source.pages p LEFT JOIN neon_source.users u ON u.id = p.user_id WHERE p.user_id IS NOT NULL AND u.id IS NULL)
  UNION ALL SELECT 'heroku', 'resources', 'orphan_page'
  WHERE EXISTS (SELECT 1 FROM heroku_source.resources r LEFT JOIN heroku_source.pages p ON p.id = r.page_id WHERE p.id IS NULL)
  UNION ALL SELECT 'neon', 'resources', 'orphan_page'
  WHERE EXISTS (SELECT 1 FROM neon_source.resources r LEFT JOIN neon_source.pages p ON p.id = r.page_id WHERE p.id IS NULL)
  UNION ALL SELECT 'heroku', 'users', 'invalid_visibility'
  WHERE EXISTS (SELECT 1 FROM heroku_source.users WHERE visibility NOT IN ('public', 'private'))
  UNION ALL SELECT 'neon', 'users', 'invalid_visibility'
  WHERE EXISTS (SELECT 1 FROM neon_source.users WHERE visibility NOT IN ('public', 'private'))
  UNION ALL SELECT 'heroku', 'pages', 'invalid_visibility'
  WHERE EXISTS (SELECT 1 FROM heroku_source.pages WHERE visibility NOT IN ('public', 'private'))
  UNION ALL SELECT 'neon', 'pages', 'invalid_visibility'
  WHERE EXISTS (SELECT 1 FROM neon_source.pages WHERE visibility NOT IN ('public', 'private'))
  UNION ALL SELECT 'heroku', 'resources', 'invalid_type'
  WHERE EXISTS (SELECT 1 FROM heroku_source.resources WHERE type NOT IN ('link', 'image', 'text', 'pdf', 'file'))
  UNION ALL SELECT 'neon', 'resources', 'invalid_type'
  WHERE EXISTS (SELECT 1 FROM neon_source.resources WHERE type NOT IN ('link', 'image', 'text', 'pdf', 'file'))
  UNION ALL SELECT 'heroku', 'resources', 'negative_size_bytes'
  WHERE EXISTS (SELECT 1 FROM heroku_source.resources WHERE size_bytes < 0)
  UNION ALL SELECT 'heroku', 'resources', 'invalid_provider_pair'
  WHERE EXISTS (
    SELECT 1 FROM heroku_source.resources
    WHERE (provider_public_id IS NULL) <> (provider_resource_type IS NULL)
       OR (provider_resource_type IS NOT NULL AND provider_resource_type NOT IN ('image', 'raw'))
  )
) AS unsafe_source;

BEGIN;
LOCK TABLE public.users, public.pages, public.resources, public.asset_deletion_queue IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM merge_audit.conflict_manifest) THEN
    RAISE EXCEPTION 'Unsafe cross-source conflicts found; inspect aggregate manifest counts and remediate before merge';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users)
     OR EXISTS (SELECT 1 FROM public.pages)
     OR EXISTS (SELECT 1 FROM public.resources)
     OR EXISTS (SELECT 1 FROM public.asset_deletion_queue) THEN
    RAISE EXCEPTION 'Canonical target is not empty; create a new disposable target rather than merging into existing data';
  END IF;
END $$;

-- Heroku is inserted first and therefore owns every compatible cross-source
-- identity. Every Neon row is additive only; no source row is updated.
INSERT INTO public.users (id, email, username, name, picture, visibility)
SELECT id, email, username, name, picture, visibility
FROM heroku_source.users
ORDER BY id;

INSERT INTO public.users (id, email, username, name, picture, visibility)
SELECT id, email, username, name, picture, visibility
FROM neon_source.users
WHERE NOT EXISTS (SELECT 1 FROM heroku_source.users h WHERE h.id = neon_source.users.id)
ORDER BY id;

INSERT INTO public.pages (
  id, user_id, color, name, visibility, path_code, session_id, expires_at,
  allow_guest_resources, xoomshare_resource_count, xoomshare_resource_bytes, created_at
)
SELECT id, user_id, color, name, visibility, path_code, session_id, expires_at,
       allow_guest_resources, 0, 0, created_at
FROM heroku_source.pages
ORDER BY id;

INSERT INTO public.pages (
  id, user_id, color, name, visibility, path_code, session_id, expires_at,
  allow_guest_resources, xoomshare_resource_count, xoomshare_resource_bytes, created_at
)
SELECT id, user_id, color, name, visibility, path_code, session_id, expires_at,
       allow_guest_resources, 0, 0, created_at
FROM neon_source.pages
ORDER BY id;

INSERT INTO public.resources (
  id, page_id, type, content, title, description, thumbnail_url, x, y, z_index,
  rotation, session_id, size_bytes, provider_public_id, provider_resource_type, created_at
)
SELECT id, page_id, type, content, title, description, thumbnail_url, x, y, z_index,
       rotation, session_id, size_bytes, provider_public_id, provider_resource_type, created_at
FROM heroku_source.resources
ORDER BY id;

-- Historical Neon has no size/provider columns. Its deterministic size
-- backfill follows the repository's current migration; Cloudinary fields are
-- deliberately NULL rather than guessed.
INSERT INTO public.resources (
  id, page_id, type, content, title, description, thumbnail_url, x, y, z_index,
  rotation, session_id, size_bytes, provider_public_id, provider_resource_type, created_at
)
SELECT id, page_id, type, content, title, description, thumbnail_url, x, y, z_index,
       rotation, session_id,
       octet_length(content) + COALESCE(octet_length(title), 0)
         + COALESCE(octet_length(description), 0) + COALESCE(octet_length(thumbnail_url), 0),
       NULL, NULL, created_at
FROM neon_source.resources
ORDER BY id;

-- Expired Xoomshare rooms are deliberately retained. Recalculate all room-root
-- counters after the complete additive merge so stale source counters cannot
-- silently enforce incorrect quotas.
UPDATE public.pages
SET xoomshare_resource_count = 0, xoomshare_resource_bytes = 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.pages root
    LEFT JOIN public.pages room_page ON room_page.session_id = root.session_id
    LEFT JOIN public.resources resource ON resource.page_id = room_page.id
    WHERE root.path_code IS NOT NULL AND root.session_id IS NOT NULL
    GROUP BY root.id
    HAVING COALESCE(sum(resource.size_bytes), 0) > 2147483647
  ) THEN
    RAISE EXCEPTION 'A Xoomshare resource-byte total exceeds the application integer counter range';
  END IF;
END $$;

WITH room_totals AS (
  SELECT root.id AS root_id,
         count(resource.id)::integer AS resource_count,
         COALESCE(sum(resource.size_bytes), 0)::integer AS resource_bytes
  FROM public.pages root
  LEFT JOIN public.pages room_page ON room_page.session_id = root.session_id
  LEFT JOIN public.resources resource ON resource.page_id = room_page.id
  WHERE root.path_code IS NOT NULL AND root.session_id IS NOT NULL
  GROUP BY root.id
)
UPDATE public.pages root
SET xoomshare_resource_count = totals.resource_count,
    xoomshare_resource_bytes = totals.resource_bytes
FROM room_totals totals
WHERE root.id = totals.root_id;

-- Queue import is intentionally absent. It must remain empty so a rehearsal
-- cannot schedule Cloudinary deletes for historical data.
INSERT INTO merge_audit.disposition_counts (source_system, entity_type, disposition, row_count)
SELECT source_system, entity_type, 'inserted', row_count
FROM (
  SELECT 'heroku'::text AS source_system, 'users'::text AS entity_type, count(*)::bigint AS row_count FROM heroku_source.users
  UNION ALL SELECT 'heroku', 'pages', count(*)::bigint FROM heroku_source.pages
  UNION ALL SELECT 'heroku', 'resources', count(*)::bigint FROM heroku_source.resources
  UNION ALL
  SELECT 'neon', 'users', count(*)::bigint
  FROM neon_source.users n
  WHERE NOT EXISTS (SELECT 1 FROM heroku_source.users h WHERE h.id = n.id)
  UNION ALL SELECT 'neon', 'pages', count(*)::bigint FROM neon_source.pages
  UNION ALL SELECT 'neon', 'resources', count(*)::bigint FROM neon_source.resources
  UNION ALL SELECT 'heroku', 'asset_deletion_queue', 0::bigint
  UNION ALL SELECT 'neon', 'asset_deletion_queue', 0::bigint
) AS dispositions;

COMMIT;
