# Lightsail PostgreSQL 18: controlled canonical load

This is a repository-only, one-time production database-load contract for the
co-located PostgreSQL 18 container on `saveswitch-production-app-db`. It uses
the accepted canonical data archive only; it does not connect to Heroku or
Neon, does not write either source, does not start the API, and does not move
Cloudinary objects. Cloudinary remains Saveswitch's object provider.

## Immutable inputs and acceptance result

The only permitted archive is the protected canonical data-only archive:

| Input | SHA-256 |
| --- | --- |
| `canonical-public.dump` | `82cb308843f66341a786f853b74e1a70dc27b92ce2e6d750f74adfe0cbcdadab` |

The load accepts only the Heroku-default merged result: **4 users, 39 pages,
378 resources, and 0 deletion-queue rows**. Expired Xoomshare data is retained
as already represented in the canonical archive. `pg_restore` restores only
`public.users`, `public.pages`, and `public.resources`; queue data is never
restored.

`artifacts.sha256` pins every load-owned script and SQL file. `apply-schema.sh`
also pins the canonical schema plus migrations `0001`–`0004` from their current
repository locations and records all five checksums in
`saveswitch_meta.schema_migrations`. A changed artifact, missing artifact,
symlink, unknown ledger row, incomplete ledger, non-empty data table, or
unexpected target object stops the workflow.

## Preconditions

The infrastructure/runtime owner must complete these before this workflow is
authorized to run:

1. PostgreSQL **18** is already running in the local Docker container, using
   `/srv/saveswitch/postgres` as its persistent data location. Set its database
   name at initialization (normally `saveswitch`); this workflow does not
   create containers, disks, volumes, networks, or a database.
2. The API/container that can use `saveswitch_app` is stopped and cannot be
   reached. The operator supplies `SAVESWITCH_API_DISABLED_CONFIRM=API-DISABLED`
   only after verifying that condition.
3. The target database is new and empty. A limited recovery rerun is accepted
   only if the prior run reached the exact checksum ledger while every
   application table remains empty. The workflow never truncates, drops, or
   overwrites data to make a retry possible.
4. The canonical archive is a regular, non-symlink protected file on the host
   and is supplied through `CANONICAL_DUMP_PATH`. It must not be copied into
   the repository. It is copied briefly into a checksum-derived `0700`
   container directory, rehashed there, and removed via that exact path on exit.
5. Inside the PostgreSQL container, create a dedicated secret directory owned
   by its `postgres` OS user, mode `0700`, for example
   `/run/saveswitch/db-bootstrap`. It holds exactly these regular, non-symlink,
   mode-`0600`, no-whitespace password files:

   - `migrator-password`
   - `loader-password`
   - `app-password`

   Passwords are read only by the `postgres`-UID process and transferred into
   the immediate `psql`/`pg_restore` environment. They are not passed as host
   command arguments, printed, committed, or stored in temporary SQL. Use
   independent high-entropy values. The application’s long-lived password must
   also be placed in its separately managed protected runtime secret file.

6. Use short UTC values for the temporary roles, for example one hour in the
   future, in `SAVESWITCH_MIGRATOR_VALID_UNTIL` and
   `SAVESWITCH_LOADER_VALID_UNTIL`. Do not use these identities for the API.

## Offline validation

Run this before a live approval:

```bash
scripts/db-deploy-lightsail/tests/validate-static.sh
```

If `docker image inspect postgres:18` succeeds locally, the deployment owner
may additionally perform a separately authorized disposable test. This root
does not download an image and contains no test that contacts a live host.

## Controlled execution

Run from the repository root in a non-xtrace shell after the preconditions are
met. Do not put a password in this command or in a shell history entry.

```bash
export PG_CONTAINER='saveswitch-postgres'
export PG_DATABASE='saveswitch'
export PG_SECRETS_DIR='/run/saveswitch/db-bootstrap'
export CANONICAL_DUMP_PATH='/protected/path/canonical-public.dump'
export SAVESWITCH_API_DISABLED_CONFIRM='API-DISABLED'
export SAVESWITCH_MIGRATOR_VALID_UNTIL='2026-09-21T18:00:00Z'
export SAVESWITCH_LOADER_VALID_UNTIL='2026-09-21T18:00:00Z'
scripts/db-deploy-lightsail/run-load.sh
```

The ordered transaction boundary is:

1. Verify local artifacts and the canonical dump checksum; preflight that the
   target is pristine/empty and that the API remains disabled.
2. Create the non-login owner plus short-lived migrator/loader and application
   roles. Apply the canonical schema and migrations in one database-locked
   transaction and atomically write the five-row ledger.
3. Grant the loader only `SELECT, INSERT` on the three imported tables. Restore
   the exact archive with a real `saveswitch_loader` login, table restrictions,
   `--single-transaction`, and `--exit-on-error`.
4. Validate aggregate counts and database invariants as the short-lived
   migrator. Then remove loader access, revoke owner membership from migrator,
   disable both temporary logins, and verify `saveswitch_app` is ready with no
   schema/ledger access.

The final message does **not** make the API live. The deployment owner must
separately configure the application secret, health checks, container service,
Cloudflare Tunnel, and API traffic only after accepting the database result.

## Failure and forward repair

The schema transaction is all-or-nothing. The data restore is one transaction;
it is never retried into non-empty tables. If bootstrap/migration fails, fix the
repository artifact or target configuration and rerun only after confirming the
target remains empty. If a data restore or validation fails, stop: preserve the
source canonical archive, do not write Heroku/Neon, and obtain separate
authorization for either a forensic read-only examination or rebuilding the
target. No script here runs `DROP`, `TRUNCATE`, `pg_restore --clean`,
`--create`, or `--disable-triggers`.

There is no rollback to either source database. The canonical dump is the
forward-only, checksum-pinned source of truth for this load; sources remain
read-only migration records until an independently authorized retention and
retirement process.
