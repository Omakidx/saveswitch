\set ON_ERROR_STOP on
\ir source-access.sql

-- Aggregate-only source integrity, collision, and preservation evidence.
-- This script deliberately returns no source values or row identifiers.
WITH metrics AS (
  SELECT 'source_orphan_pages'::text AS metric,
         'heroku'::text AS source,
         count(*)::bigint AS value
  FROM heroku_source.pages p LEFT JOIN heroku_source.users u ON u.id = p.user_id
  WHERE p.user_id IS NOT NULL AND u.id IS NULL
  UNION ALL
  SELECT 'source_orphan_pages', 'neon', count(*)::bigint
  FROM neon_source.pages p LEFT JOIN neon_source.users u ON u.id = p.user_id
  WHERE p.user_id IS NOT NULL AND u.id IS NULL
  UNION ALL
  SELECT 'source_orphan_resources', 'heroku', count(*)::bigint
  FROM heroku_source.resources r LEFT JOIN heroku_source.pages p ON p.id = r.page_id
  WHERE p.id IS NULL
  UNION ALL
  SELECT 'source_orphan_resources', 'neon', count(*)::bigint
  FROM neon_source.resources r LEFT JOIN neon_source.pages p ON p.id = r.page_id
  WHERE p.id IS NULL
  UNION ALL
  SELECT 'invalid_user_visibility', 'heroku', count(*)::bigint
  FROM heroku_source.users WHERE visibility NOT IN ('public', 'private')
  UNION ALL
  SELECT 'invalid_user_visibility', 'neon', count(*)::bigint
  FROM neon_source.users WHERE visibility NOT IN ('public', 'private')
  UNION ALL
  SELECT 'invalid_page_visibility', 'heroku', count(*)::bigint
  FROM heroku_source.pages WHERE visibility NOT IN ('public', 'private')
  UNION ALL
  SELECT 'invalid_page_visibility', 'neon', count(*)::bigint
  FROM neon_source.pages WHERE visibility NOT IN ('public', 'private')
  UNION ALL
  SELECT 'invalid_resource_type', 'heroku', count(*)::bigint
  FROM heroku_source.resources WHERE type NOT IN ('link', 'image', 'text', 'pdf', 'file')
  UNION ALL
  SELECT 'invalid_resource_type', 'neon', count(*)::bigint
  FROM neon_source.resources WHERE type NOT IN ('link', 'image', 'text', 'pdf', 'file')
  UNION ALL
  SELECT 'negative_resource_size_bytes', 'heroku', count(*)::bigint
  FROM heroku_source.resources WHERE size_bytes < 0
  UNION ALL
  SELECT 'invalid_cloudinary_provider_pair', 'heroku', count(*)::bigint
  FROM heroku_source.resources
  WHERE (provider_public_id IS NULL) <> (provider_resource_type IS NULL)
     OR (provider_resource_type IS NOT NULL AND provider_resource_type NOT IN ('image', 'raw'))
  UNION ALL
  SELECT 'same_user_id', 'cross_source', count(*)::bigint
  FROM heroku_source.users h JOIN neon_source.users n ON n.id = h.id
  UNION ALL
  SELECT 'divergent_same_user_id', 'cross_source', count(*)::bigint
  FROM heroku_source.users h JOIN neon_source.users n ON n.id = h.id
  WHERE ROW(h.email, h.username, h.name, h.picture, h.visibility)
        IS DISTINCT FROM ROW(n.email, n.username, n.name, n.picture, n.visibility)
  UNION ALL
  SELECT 'email_conflict_different_id', 'cross_source', count(*)::bigint
  FROM heroku_source.users h JOIN neon_source.users n ON n.email = h.email AND n.id <> h.id
  UNION ALL
  SELECT 'username_conflict_different_id', 'cross_source', count(*)::bigint
  FROM heroku_source.users h JOIN neon_source.users n
    ON n.username IS NOT NULL AND n.username = h.username AND n.id <> h.id
  UNION ALL
  SELECT 'same_page_id', 'cross_source', count(*)::bigint
  FROM heroku_source.pages h JOIN neon_source.pages n ON n.id = h.id
  UNION ALL
  SELECT 'path_code_conflict', 'cross_source', count(*)::bigint
  FROM heroku_source.pages h JOIN neon_source.pages n
    ON n.path_code IS NOT NULL AND n.path_code = h.path_code AND n.id <> h.id
  UNION ALL
  SELECT 'session_id_conflict', 'cross_source', count(*)::bigint
  FROM heroku_source.pages h JOIN neon_source.pages n
    ON n.session_id IS NOT NULL AND n.session_id = h.session_id AND n.id <> h.id
  UNION ALL
  SELECT 'same_resource_id', 'cross_source', count(*)::bigint
  FROM heroku_source.resources h JOIN neon_source.resources n ON n.id = h.id
  UNION ALL
  SELECT 'expired_xoomshare_pages_to_preserve', 'heroku', count(*)::bigint
  FROM heroku_source.pages
  WHERE path_code IS NOT NULL AND session_id IS NOT NULL
    AND (expires_at < current_timestamp OR created_at < current_timestamp - interval '3 hours')
  UNION ALL
  SELECT 'expired_xoomshare_pages_to_preserve', 'neon', count(*)::bigint
  FROM neon_source.pages
  WHERE path_code IS NOT NULL AND session_id IS NOT NULL
    AND (expires_at < current_timestamp OR created_at < current_timestamp - interval '3 hours')
)
SELECT metric, source, value
FROM metrics
ORDER BY metric, source;
