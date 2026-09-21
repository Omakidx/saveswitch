\set ON_ERROR_STOP on

-- Run as the RDS administrator only after aggregate validation is accepted
-- and before enabling the API.
-- This leaves the roles in place for auditability but makes their credentials
-- unusable. A later forward repair requires a new, separately authorized,
-- short-lived credential and a new role-membership grant.
SET ROLE saveswitch_owner;
REVOKE SELECT, INSERT ON TABLE public.users, public.pages, public.resources FROM saveswitch_loader;
RESET ROLE;
REVOKE saveswitch_owner FROM saveswitch_migrator;
ALTER ROLE saveswitch_loader NOLOGIN VALID UNTIL 'epoch';
ALTER ROLE saveswitch_migrator NOLOGIN VALID UNTIL 'epoch';
