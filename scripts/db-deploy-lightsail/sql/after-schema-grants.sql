\set ON_ERROR_STOP on
SET ROLE saveswitch_owner;
REVOKE ALL ON SCHEMA saveswitch_meta FROM PUBLIC, saveswitch_migrator, saveswitch_loader, saveswitch_app;
REVOKE ALL ON ALL TABLES IN SCHEMA saveswitch_meta FROM PUBLIC, saveswitch_migrator, saveswitch_loader, saveswitch_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, saveswitch_migrator, saveswitch_loader, saveswitch_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, saveswitch_migrator, saveswitch_loader, saveswitch_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, saveswitch_migrator, saveswitch_loader, saveswitch_app;
GRANT USAGE ON SCHEMA public TO saveswitch_loader, saveswitch_app;
GRANT SELECT, INSERT ON TABLE public.users, public.pages, public.resources TO saveswitch_loader;
GRANT SELECT, INSERT, UPDATE ON TABLE public.users TO saveswitch_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pages, public.resources, public.asset_deletion_queue TO saveswitch_app;
ALTER DEFAULT PRIVILEGES FOR ROLE saveswitch_owner IN SCHEMA public REVOKE ALL ON TABLES FROM saveswitch_loader, saveswitch_app;
ALTER DEFAULT PRIVILEGES FOR ROLE saveswitch_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM saveswitch_loader, saveswitch_app;
