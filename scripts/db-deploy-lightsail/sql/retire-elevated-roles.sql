\set ON_ERROR_STOP on
SET ROLE saveswitch_owner;
REVOKE SELECT, INSERT ON TABLE public.users, public.pages, public.resources FROM saveswitch_loader;
RESET ROLE;
REVOKE saveswitch_owner FROM saveswitch_migrator;
ALTER ROLE saveswitch_loader NOLOGIN VALID UNTIL 'epoch';
ALTER ROLE saveswitch_migrator NOLOGIN VALID UNTIL 'epoch';
