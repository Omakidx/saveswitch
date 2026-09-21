\set ON_ERROR_STOP on
-- This permits either a pristine target or an exact empty resumable schema
-- state. It refuses any data or unknown public object before roles are changed
-- or a dump is restored.
DO $$
DECLARE
  public_objects integer;
  data_rows bigint;
  ledger_state text;
BEGIN
  SELECT count(*) INTO public_objects
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');

  IF public_objects = 0 AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'saveswitch_meta'
  ) THEN
    RETURN;
  END IF;

  IF public_objects <> 4 THEN
    RAISE EXCEPTION 'target is not a pristine or empty resumable Saveswitch database';
  END IF;

  SELECT
    (SELECT count(*) FROM public.users)
    + (SELECT count(*) FROM public.pages)
    + (SELECT count(*) FROM public.resources)
    + (SELECT count(*) FROM public.asset_deletion_queue)
  INTO data_rows;
  IF data_rows <> 0 THEN
    RAISE EXCEPTION 'target contains application data and cannot be loaded';
  END IF;

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname NOT IN ('users','pages','resources','asset_deletion_queue')) THEN 'unknown-public-table'
    WHEN to_regclass('saveswitch_meta.schema_migrations') IS NULL THEN 'missing-ledger'
    WHEN (SELECT count(*) FROM saveswitch_meta.schema_migrations) <> 5 THEN 'incomplete-ledger'
    WHEN EXISTS (
      SELECT 1 FROM saveswitch_meta.schema_migrations
      WHERE (version, name, sha256) NOT IN (
        ('0000','canonical-baseline','b3c7b77b8e6356651556b26c639fd889d6d09ed49c3fafed41ac31ec7caa82bc'),
        ('0001','xoomshare-rooms','eb05f6eac5c4eb63cf467fe5b7a2bd93f9bbfec07d3e62d6ad3885470d507da9'),
        ('0002','xoomshare-guest-ownership','eaa254064b0760eafbc5f81bb6e02fd5dbe18f21f07ac1c5141f8e8833105c1b'),
        ('0003','xoomshare-resource-quotas','a66daccf6fe2ffd0b238b607faa22b9d2e9efdccfca337c35f150061a7d4bbbd'),
        ('0004','asset-deletion-queue','6a692d84ae50c35c3fed846c42d64e0bcc51bb3bcf343016750296e4bf82ac72')
      )
    ) THEN 'unexpected-ledger'
    ELSE 'ready'
  END INTO ledger_state;
  IF ledger_state <> 'ready' THEN
    RAISE EXCEPTION 'target is not an exact empty resumable schema state: %', ledger_state;
  END IF;

  IF EXISTS (
    WITH expected_constraints(name) AS (VALUES
      ('users_pkey'), ('users_email_key'), ('users_username_key'), ('users_visibility_check'),
      ('pages_pkey'), ('pages_user_id_fkey'), ('pages_visibility_check'),
      ('pages_xoomshare_resource_count_nonnegative'), ('pages_xoomshare_resource_bytes_nonnegative'),
      ('resources_pkey'), ('resources_page_id_fkey'), ('resources_type_check'),
      ('resources_size_bytes_nonnegative'), ('resources_provider_pair_check'),
      ('asset_deletion_queue_pkey'), ('asset_deletion_queue_provider_resource_type_check'),
      ('asset_deletion_queue_attempts_nonnegative')
    )
    SELECT 1 FROM expected_constraints expected
    LEFT JOIN pg_catalog.pg_constraint actual ON actual.conname = expected.name
    WHERE actual.oid IS NULL OR NOT actual.convalidated
  ) THEN
    RAISE EXCEPTION 'resumable target is missing a required validated constraint';
  END IF;

  IF EXISTS (
    WITH expected_indexes(name) AS (VALUES
      ('pages_path_code_unique'), ('pages_session_id_idx'), ('resources_page_id_idx'),
      ('asset_deletion_queue_provider_public_id_unique'), ('asset_deletion_queue_created_at_idx')
    )
    SELECT 1 FROM expected_indexes expected
    LEFT JOIN pg_catalog.pg_class index_class ON index_class.relname = expected.name
    LEFT JOIN pg_catalog.pg_index index_info ON index_info.indexrelid = index_class.oid
    WHERE index_info.indexrelid IS NULL OR NOT index_info.indisvalid
  ) THEN
    RAISE EXCEPTION 'resumable target is missing a required valid index';
  END IF;
END $$;
