\set ON_ERROR_STOP on
\if :{?database_name}
\else
  \echo 'database_name is required'
  SELECT 1 / 0 AS missing_database_name;
\endif
\if :{?migrator_valid_until}
\else
  \echo 'migrator_valid_until is required'
  SELECT 1 / 0 AS missing_migrator_valid_until;
\endif
\if :{?loader_valid_until}
\else
  \echo 'loader_valid_until is required'
  SELECT 1 / 0 AS missing_loader_valid_until;
\endif
\getenv saveswitch_migrator_password SAVESWITCH_MIGRATOR_PASSWORD
\getenv saveswitch_loader_password SAVESWITCH_LOADER_PASSWORD
\getenv saveswitch_app_password SAVESWITCH_APP_PASSWORD
\if :{?saveswitch_migrator_password}
\else
  \echo 'SAVESWITCH_MIGRATOR_PASSWORD is required in the protected process environment'
  SELECT 1 / 0 AS missing_migrator_password;
\endif
\if :{?saveswitch_loader_password}
\else
  \echo 'SAVESWITCH_LOADER_PASSWORD is required in the protected process environment'
  SELECT 1 / 0 AS missing_loader_password;
\endif
\if :{?saveswitch_app_password}
\else
  \echo 'SAVESWITCH_APP_PASSWORD is required in the protected process environment'
  SELECT 1 / 0 AS missing_app_password;
\endif

-- Run only through the local PostgreSQL-container administrator. This is not
-- RDS SQL: it relies solely on ordinary PostgreSQL roles and Unix-socket admin
-- access. psql's :'' literal interpolation safely quotes each secret and no
-- command enables ECHO/xtrace.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saveswitch_owner') THEN
    CREATE ROLE saveswitch_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saveswitch_migrator') THEN
    CREATE ROLE saveswitch_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saveswitch_loader') THEN
    CREATE ROLE saveswitch_loader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saveswitch_app') THEN
    CREATE ROLE saveswitch_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
  END IF;
END $$;

ALTER ROLE saveswitch_migrator CONNECTION LIMIT 1 VALID UNTIL :'migrator_valid_until' PASSWORD :'saveswitch_migrator_password';
ALTER ROLE saveswitch_loader CONNECTION LIMIT 1 VALID UNTIL :'loader_valid_until' PASSWORD :'saveswitch_loader_password';
ALTER ROLE saveswitch_app CONNECTION LIMIT 20 VALID UNTIL 'infinity' PASSWORD :'saveswitch_app_password';

GRANT saveswitch_owner TO saveswitch_migrator;
ALTER DATABASE :"database_name" OWNER TO saveswitch_owner;
REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO saveswitch_owner, saveswitch_migrator, saveswitch_loader, saveswitch_app;

ALTER SCHEMA public OWNER TO saveswitch_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, saveswitch_migrator, saveswitch_loader, saveswitch_app;
GRANT USAGE ON SCHEMA public TO saveswitch_loader, saveswitch_app;
