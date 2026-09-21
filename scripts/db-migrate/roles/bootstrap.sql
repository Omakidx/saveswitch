\set ON_ERROR_STOP on
\if :{?database_name}
\else
  \echo 'database_name is required (for example: -v database_name=saveswitch)'
  SELECT 1 / 0 AS missing_database_name;
\endif
\if :{?migrator_valid_until}
\else
  \echo 'migrator_valid_until is required (UTC timestamp, e.g. 2026-10-01T12:00:00Z)'
  SELECT 1 / 0 AS missing_migrator_valid_until;
\endif
\if :{?loader_valid_until}
\else
  \echo 'loader_valid_until is required (UTC timestamp, e.g. 2026-10-01T12:00:00Z)'
  SELECT 1 / 0 AS missing_loader_valid_until;
\endif

-- Run as the RDS database administrator against the empty target database.
-- Passwords, IAM database authentication, and any human identity mapping are
-- deliberately configured out-of-band; this repository never carries them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saveswitch_owner') THEN
    CREATE ROLE saveswitch_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saveswitch_migrator') THEN
    CREATE ROLE saveswitch_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saveswitch_loader') THEN
    CREATE ROLE saveswitch_loader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saveswitch_app') THEN
    CREATE ROLE saveswitch_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
  END IF;
END $$;

ALTER ROLE saveswitch_migrator CONNECTION LIMIT 2;
ALTER ROLE saveswitch_loader CONNECTION LIMIT 1;
ALTER ROLE saveswitch_app CONNECTION LIMIT 20;
ALTER ROLE saveswitch_migrator VALID UNTIL :'migrator_valid_until';
ALTER ROLE saveswitch_loader VALID UNTIL :'loader_valid_until';
ALTER ROLE saveswitch_app VALID UNTIL 'infinity';

-- The migration runner connects as the short-lived migrator then sets this
-- role inside each locked transaction. Do not grant this membership to app or
-- loader roles.
GRANT saveswitch_owner TO saveswitch_migrator;

-- PostgreSQL requires membership in a target owner role for ownership
-- transfer. Retain that membership only on the named RDS administrative
-- identity executing this bootstrap; application and data roles never receive
-- it. The admin option is needed to retire the migrator membership later.
GRANT saveswitch_owner TO CURRENT_USER
  WITH ADMIN TRUE, INHERIT FALSE, SET TRUE;

ALTER DATABASE :"database_name" OWNER TO saveswitch_owner;
REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO saveswitch_owner, saveswitch_migrator, saveswitch_loader, saveswitch_app;

ALTER SCHEMA public OWNER TO saveswitch_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO saveswitch_loader, saveswitch_app;
GRANT CREATE ON SCHEMA public TO saveswitch_owner;

-- This is a defence-in-depth default for future objects. Explicit grants are
-- applied after the manifest reaches 0004.
ALTER DEFAULT PRIVILEGES FOR ROLE saveswitch_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE saveswitch_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;

-- Required secure, out-of-band follow-up before any LOGIN role is used:
--   * set a random password through Secrets Manager/IAM auth (never shell
--     history or this file), or map the role to approved IAM database auth;
--   * verify only the named migration/load operator can obtain each short-
--     lived credential; and
--   * record the scheduled expiry and revoke it immediately after acceptance.
