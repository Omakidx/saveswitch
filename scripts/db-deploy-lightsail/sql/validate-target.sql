\set ON_ERROR_STOP on
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
    (SELECT count(*) FROM (SELECT email FROM public.users GROUP BY email HAVING count(*) > 1) s) AS duplicate_emails,
    (SELECT count(*) FROM (SELECT username FROM public.users WHERE username IS NOT NULL GROUP BY username HAVING count(*) > 1) s) AS duplicate_usernames,
    (SELECT count(*) FROM (SELECT path_code FROM public.pages WHERE path_code IS NOT NULL GROUP BY path_code HAVING count(*) > 1) s) AS duplicate_path_codes,
    (SELECT count(*) FROM public.pages WHERE xoomshare_resource_count < 0 OR xoomshare_resource_bytes < 0) AS invalid_page_counters,
    (SELECT count(*) FROM public.resources WHERE size_bytes < 0) AS invalid_resource_sizes,
    (SELECT count(*) FROM public.asset_deletion_queue WHERE attempts < 0) AS invalid_queue_attempts,
    (SELECT count(*) FROM public.resources WHERE NOT ((provider_public_id IS NULL AND provider_resource_type IS NULL) OR (provider_public_id IS NOT NULL AND provider_resource_type IN ('image', 'raw')))) AS invalid_provider_pairs,
    (SELECT count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid IN ('public.users'::regclass, 'public.pages'::regclass, 'public.resources'::regclass, 'public.asset_deletion_queue'::regclass) AND c.contype IN ('c', 'f') AND NOT c.convalidated) AS unvalidated_constraints,
    (SELECT count(*) FROM pg_catalog.pg_index i WHERE i.indrelid IN ('public.users'::regclass, 'public.pages'::regclass, 'public.resources'::regclass, 'public.asset_deletion_queue'::regclass) AND NOT i.indisvalid) AS invalid_indexes
)
SELECT aggregate_values.*,
  users = 4 AND pages = 39 AND resources = 378 AND queue = 0
    AND page_user_orphans = 0 AND resource_page_orphans = 0
    AND duplicate_emails = 0 AND duplicate_usernames = 0 AND duplicate_path_codes = 0
    AND invalid_page_counters = 0 AND invalid_resource_sizes = 0
    AND invalid_queue_attempts = 0 AND invalid_provider_pairs = 0
    AND unvalidated_constraints = 0 AND invalid_indexes = 0 AS accepted
FROM aggregate_values;
DO $$ BEGIN
  IF NOT (SELECT accepted FROM pg_temp.saveswitch_target_validation) THEN
    RAISE EXCEPTION 'target validation failed: %',
      (SELECT to_jsonb(result) FROM pg_temp.saveswitch_target_validation AS result);
  END IF;
END $$;
SELECT jsonb_build_object(
  'expected', jsonb_build_object('users', 4, 'pages', 39, 'resources', 378, 'queue', 0),
  'actual', jsonb_build_object('users', users, 'pages', pages, 'resources', resources, 'queue', queue),
  'accepted', accepted
) AS validation
FROM pg_temp.saveswitch_target_validation;
