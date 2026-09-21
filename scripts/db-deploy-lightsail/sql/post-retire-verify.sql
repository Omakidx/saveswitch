\set ON_ERROR_STOP on
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saveswitch_app' AND rolcanlogin)
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('saveswitch_loader','saveswitch_migrator') AND rolcanlogin)
     OR pg_has_role('saveswitch_migrator', 'saveswitch_owner', 'member')
     OR has_table_privilege('saveswitch_loader', 'public.users', 'insert')
     OR NOT has_table_privilege('saveswitch_app', 'public.users', 'select,insert,update')
     OR has_table_privilege('saveswitch_app', 'public.users', 'delete')
     OR NOT has_table_privilege('saveswitch_app', 'public.pages', 'select,insert,update,delete')
     OR NOT has_table_privilege('saveswitch_app', 'public.resources', 'select,insert,update,delete')
     OR NOT has_table_privilege('saveswitch_app', 'public.asset_deletion_queue', 'select,insert,update,delete')
     OR has_schema_privilege('saveswitch_app', 'saveswitch_meta', 'usage') THEN
    RAISE EXCEPTION 'post-retirement role contract failed';
  END IF;
END $$;
SELECT jsonb_build_object('app_login_ready', true, 'loader_and_migrator_retired', true, 'accepted', true) AS role_validation;
