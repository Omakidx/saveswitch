\set ON_ERROR_STOP on
\if :{?expected_users}
\else
  \echo 'expected_users is required'
  SELECT 1 / 0 AS missing_expected_users;
\endif
\if :{?expected_pages}
\else
  \echo 'expected_pages is required'
  SELECT 1 / 0 AS missing_expected_pages;
\endif
\if :{?expected_resources}
\else
  \echo 'expected_resources is required'
  SELECT 1 / 0 AS missing_expected_resources;
\endif
\if :{?expected_queue}
\else
  \echo 'expected_queue is required (must be 0 for this migration)'
  SELECT 1 / 0 AS missing_expected_queue;
\endif

-- Aggregate-only target validation. No source connection, FDW, source schema,
-- or application-record output is permitted.
SET ROLE saveswitch_owner;
ANALYZE public.users;
ANALYZE public.pages;
ANALYZE public.resources;
ANALYZE public.asset_deletion_queue;
CREATE TEMP TABLE saveswitch_target_validation AS
WITH aggregate_values AS (
  SELECT
    (SELECT count(*) FROM public.users) AS users,
    (SELECT count(*) FROM public.pages) AS pages,
    (SELECT count(*) FROM public.resources) AS resources,
    (SELECT count(*) FROM public.asset_deletion_queue) AS queue,
    (SELECT count(*) FROM public.pages p LEFT JOIN public.users u ON u.id = p.user_id WHERE p.user_id IS NOT NULL AND u.id IS NULL) AS page_user_orphans,
    (SELECT count(*) FROM public.resources r LEFT JOIN public.pages p ON p.id = r.page_id WHERE p.id IS NULL) AS resource_page_orphans,
    (SELECT count(*) FROM (SELECT email FROM public.users GROUP BY email HAVING count(*) > 1) duplicates) AS duplicate_emails,
    (SELECT count(*) FROM (SELECT username FROM public.users WHERE username IS NOT NULL GROUP BY username HAVING count(*) > 1) duplicates) AS duplicate_usernames,
    (SELECT count(*) FROM (SELECT path_code FROM public.pages WHERE path_code IS NOT NULL GROUP BY path_code HAVING count(*) > 1) duplicates) AS duplicate_path_codes,
    (SELECT count(*) FROM public.pages WHERE xoomshare_resource_count < 0 OR xoomshare_resource_bytes < 0) AS invalid_page_counters,
    (SELECT count(*) FROM public.resources WHERE size_bytes < 0) AS invalid_resource_sizes,
    (SELECT count(*) FROM public.asset_deletion_queue WHERE attempts < 0) AS invalid_queue_attempts,
    (SELECT count(*) FROM public.resources WHERE NOT ((provider_public_id IS NULL AND provider_resource_type IS NULL) OR (provider_public_id IS NOT NULL AND provider_resource_type IN ('image', 'raw')))) AS invalid_provider_pairs,
    (SELECT count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid IN ('public.users'::regclass, 'public.pages'::regclass, 'public.resources'::regclass, 'public.asset_deletion_queue'::regclass) AND c.contype IN ('c', 'f') AND NOT c.convalidated) AS unvalidated_constraints,
    (SELECT count(*) FROM pg_catalog.pg_index i WHERE i.indrelid IN ('public.users'::regclass, 'public.pages'::regclass, 'public.resources'::regclass, 'public.asset_deletion_queue'::regclass) AND NOT i.indisvalid) AS invalid_indexes
)
SELECT aggregate_values.*,
  users = :'expected_users'::bigint
    AND pages = :'expected_pages'::bigint
    AND resources = :'expected_resources'::bigint
    AND queue = 0
    AND queue = :'expected_queue'::bigint
    AND page_user_orphans = 0
    AND resource_page_orphans = 0
    AND duplicate_emails = 0
    AND duplicate_usernames = 0
    AND duplicate_path_codes = 0
    AND invalid_page_counters = 0
    AND invalid_resource_sizes = 0
    AND invalid_queue_attempts = 0
    AND invalid_provider_pairs = 0
    AND unvalidated_constraints = 0
    AND invalid_indexes = 0 AS accepted
FROM aggregate_values;

-- Make validation failure a SQL error/nonzero process exit, rather than
-- requiring an operator to notice a false field in successful psql output.
DO $$
BEGIN
  IF NOT (SELECT accepted FROM pg_temp.saveswitch_target_validation) THEN
    RAISE EXCEPTION 'target validation failed';
  END IF;
END $$;

SELECT jsonb_build_object(
  'expected', jsonb_build_object('users', :'expected_users'::bigint, 'pages', :'expected_pages'::bigint, 'resources', :'expected_resources'::bigint, 'queue', :'expected_queue'::bigint),
  'actual', jsonb_build_object('users', users, 'pages', pages, 'resources', resources, 'queue', queue),
  'checks', jsonb_build_object(
    'expected_counts_match', users = :'expected_users'::bigint AND pages = :'expected_pages'::bigint AND resources = :'expected_resources'::bigint AND queue = :'expected_queue'::bigint,
    'queue_is_empty', queue = 0,
    'page_user_orphans', page_user_orphans,
    'resource_page_orphans', resource_page_orphans,
    'duplicate_emails', duplicate_emails,
    'duplicate_usernames', duplicate_usernames,
    'duplicate_path_codes', duplicate_path_codes,
    'invalid_page_counters', invalid_page_counters,
    'invalid_resource_sizes', invalid_resource_sizes,
    'invalid_queue_attempts', invalid_queue_attempts,
    'invalid_provider_pairs', invalid_provider_pairs,
    'unvalidated_constraints', unvalidated_constraints,
    'invalid_indexes', invalid_indexes,
    'accepted', accepted
  )
) AS validation
FROM pg_temp.saveswitch_target_validation;
