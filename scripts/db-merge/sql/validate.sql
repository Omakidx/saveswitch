\set ON_ERROR_STOP on
\ir source-access.sql

-- Aggregate-only post-merge proof. This intentionally emits no source or
-- target row values, identifiers, email addresses, path codes, or URLs.
SELECT source_system, entity_type, disposition, row_count
FROM merge_audit.disposition_counts
ORDER BY source_system, entity_type, disposition;

SELECT entity, row_count
FROM (
  SELECT 'target_users'::text AS entity, count(*)::bigint AS row_count FROM public.users
  UNION ALL SELECT 'target_pages', count(*)::bigint FROM public.pages
  UNION ALL SELECT 'target_resources', count(*)::bigint FROM public.resources
  UNION ALL SELECT 'target_asset_deletion_queue', count(*)::bigint FROM public.asset_deletion_queue
) AS target_counts
ORDER BY entity;

SELECT check_name, value
FROM (
  SELECT 'manifest_conflicts'::text AS check_name, count(*)::bigint AS value FROM merge_audit.conflict_manifest
  UNION ALL
  SELECT 'target_orphan_pages', count(*)::bigint
  FROM public.pages p LEFT JOIN public.users u ON u.id = p.user_id
  WHERE p.user_id IS NOT NULL AND u.id IS NULL
  UNION ALL
  SELECT 'target_orphan_resources', count(*)::bigint
  FROM public.resources r LEFT JOIN public.pages p ON p.id = r.page_id
  WHERE p.id IS NULL
  UNION ALL
  SELECT 'negative_resource_sizes', count(*)::bigint FROM public.resources WHERE size_bytes < 0
  UNION ALL
  SELECT 'negative_xoomshare_counters', count(*)::bigint
  FROM public.pages WHERE xoomshare_resource_count < 0 OR xoomshare_resource_bytes < 0
  UNION ALL
  SELECT 'invalid_user_visibility', count(*)::bigint
  FROM public.users WHERE visibility NOT IN ('public', 'private')
  UNION ALL
  SELECT 'invalid_page_visibility', count(*)::bigint
  FROM public.pages WHERE visibility NOT IN ('public', 'private')
  UNION ALL
  SELECT 'invalid_resource_type', count(*)::bigint
  FROM public.resources WHERE type NOT IN ('link', 'image', 'text', 'pdf', 'file')
  UNION ALL
  SELECT 'invalid_provider_pair', count(*)::bigint
  FROM public.resources
  WHERE (provider_public_id IS NULL) <> (provider_resource_type IS NULL)
     OR (provider_resource_type IS NOT NULL AND provider_resource_type NOT IN ('image', 'raw'))
  UNION ALL
  SELECT 'queue_rows', count(*)::bigint FROM public.asset_deletion_queue
  UNION ALL
  SELECT 'queue_matches_retained_provider_reference', count(*)::bigint
  FROM public.asset_deletion_queue q JOIN public.resources r ON r.provider_public_id = q.provider_public_id
  UNION ALL
  SELECT 'expired_xoomshare_pages_retained', count(*)::bigint
  FROM public.pages
  WHERE path_code IS NOT NULL AND session_id IS NOT NULL
    AND (expires_at < current_timestamp OR created_at < current_timestamp - interval '3 hours')
) AS checks
ORDER BY check_name;

WITH expected AS (
  SELECT root.id AS root_id,
         count(resource.id)::integer AS resource_count,
         COALESCE(sum(resource.size_bytes), 0)::integer AS resource_bytes
  FROM public.pages root
  LEFT JOIN public.pages room_page ON room_page.session_id = root.session_id
  LEFT JOIN public.resources resource ON resource.page_id = room_page.id
  WHERE root.path_code IS NOT NULL AND root.session_id IS NOT NULL
  GROUP BY root.id
)
SELECT check_name, value
FROM (
  SELECT 'xoomshare_counter_mismatches'::text AS check_name, count(*)::bigint AS value
  FROM public.pages p JOIN expected e ON e.root_id = p.id
  WHERE p.xoomshare_resource_count <> e.resource_count
     OR p.xoomshare_resource_bytes <> e.resource_bytes
  UNION ALL
  SELECT 'xoomshare_roots'::text, count(*)::bigint FROM expected
) AS counter_checks
ORDER BY check_name;

WITH target_counts AS (
  SELECT 'users'::text AS entity_type, count(*)::bigint AS row_count FROM public.users
  UNION ALL SELECT 'pages', count(*)::bigint FROM public.pages
  UNION ALL SELECT 'resources', count(*)::bigint FROM public.resources
  UNION ALL SELECT 'asset_deletion_queue', count(*)::bigint FROM public.asset_deletion_queue
), disposition_totals AS (
  SELECT entity_type, COALESCE(sum(row_count), 0)::bigint AS row_count
  FROM merge_audit.disposition_counts
  GROUP BY entity_type
)
SELECT 'disposition_target_count_mismatches'::text AS check_name,
       count(*)::bigint AS value
FROM target_counts target
LEFT JOIN disposition_totals disposition USING (entity_type)
WHERE target.row_count <> COALESCE(disposition.row_count, 0)
   OR (target.entity_type = 'asset_deletion_queue' AND target.row_count <> 0);

-- Field-level fidelity checks emit counts only. They cover every preserved
-- field, the Heroku-winner policy for shared users, and Neon's deterministic
-- size/provider transformation. Xoomshare counters are checked separately
-- above because the merge deliberately recomputes them.
SELECT check_name, value
FROM (
  SELECT 'heroku_user_field_mismatches'::text AS check_name, count(*)::bigint AS value
  FROM heroku_source.users source
  LEFT JOIN public.users target ON target.id = source.id
  WHERE ROW(target.id, target.email, target.username, target.name, target.picture, target.visibility)
    IS DISTINCT FROM
        ROW(source.id, source.email, source.username, source.name, source.picture, source.visibility)

  UNION ALL
  SELECT 'neon_additive_user_field_mismatches', count(*)::bigint
  FROM neon_source.users source
  LEFT JOIN heroku_source.users winner ON winner.id = source.id
  LEFT JOIN public.users target ON target.id = source.id
  WHERE winner.id IS NULL
    AND ROW(target.id, target.email, target.username, target.name, target.picture, target.visibility)
      IS DISTINCT FROM
        ROW(source.id, source.email, source.username, source.name, source.picture, source.visibility)

  UNION ALL
  SELECT 'neon_shared_user_heroku_winner_mismatches', count(*)::bigint
  FROM neon_source.users source
  JOIN heroku_source.users winner ON winner.id = source.id
  LEFT JOIN public.users target ON target.id = source.id
  WHERE ROW(target.id, target.email, target.username, target.name, target.picture, target.visibility)
    IS DISTINCT FROM
        ROW(winner.id, winner.email, winner.username, winner.name, winner.picture, winner.visibility)

  UNION ALL
  SELECT 'heroku_page_field_mismatches', count(*)::bigint
  FROM heroku_source.pages source
  LEFT JOIN public.pages target ON target.id = source.id
  WHERE ROW(target.id, target.user_id, target.color, target.name, target.visibility,
            target.path_code, target.session_id, target.expires_at,
            target.allow_guest_resources, target.created_at)
    IS DISTINCT FROM
        ROW(source.id, source.user_id, source.color, source.name, source.visibility,
            source.path_code, source.session_id, source.expires_at,
            source.allow_guest_resources, source.created_at)

  UNION ALL
  SELECT 'neon_page_field_mismatches', count(*)::bigint
  FROM neon_source.pages source
  LEFT JOIN public.pages target ON target.id = source.id
  WHERE ROW(target.id, target.user_id, target.color, target.name, target.visibility,
            target.path_code, target.session_id, target.expires_at,
            target.allow_guest_resources, target.created_at)
    IS DISTINCT FROM
        ROW(source.id, source.user_id, source.color, source.name, source.visibility,
            source.path_code, source.session_id, source.expires_at,
            source.allow_guest_resources, source.created_at)

  UNION ALL
  SELECT 'heroku_resource_field_mismatches', count(*)::bigint
  FROM heroku_source.resources source
  LEFT JOIN public.resources target ON target.id = source.id
  WHERE ROW(target.id, target.page_id, target.type, target.content, target.title,
            target.description, target.thumbnail_url, target.x, target.y,
            target.z_index, target.rotation, target.session_id, target.size_bytes,
            target.provider_public_id, target.provider_resource_type, target.created_at)
    IS DISTINCT FROM
        ROW(source.id, source.page_id, source.type, source.content, source.title,
            source.description, source.thumbnail_url, source.x, source.y,
            source.z_index, source.rotation, source.session_id, source.size_bytes,
            source.provider_public_id, source.provider_resource_type, source.created_at)

  UNION ALL
  SELECT 'neon_resource_field_mismatches', count(*)::bigint
  FROM neon_source.resources source
  LEFT JOIN public.resources target ON target.id = source.id
  WHERE ROW(target.id, target.page_id, target.type, target.content, target.title,
            target.description, target.thumbnail_url, target.x, target.y,
            target.z_index, target.rotation, target.session_id, target.size_bytes,
            target.provider_public_id, target.provider_resource_type, target.created_at)
    IS DISTINCT FROM
        ROW(source.id, source.page_id, source.type, source.content, source.title,
            source.description, source.thumbnail_url, source.x, source.y,
            source.z_index, source.rotation, source.session_id,
            octet_length(source.content) + COALESCE(octet_length(source.title), 0)
              + COALESCE(octet_length(source.description), 0)
              + COALESCE(octet_length(source.thumbnail_url), 0),
            NULL::text, NULL::text, source.created_at)
) AS fidelity_checks
ORDER BY check_name;
