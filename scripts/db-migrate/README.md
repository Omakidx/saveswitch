# RDS canonical baseline and controlled data load

This directory is the only migration-runner contract for a new Saveswitch RDS
database. It is intentionally separate from API startup and from Drizzle's
development `push` workflow. It never contacts Heroku or Neon, and it has no
database URL, password, source record, or dump in the repository.

`manifest.json` is append-only. It freezes the schema sequence as the accepted
canonical baseline (`0000`) followed by the existing compatible application
migrations (`0001` through `0004`). Before opening a connection, `run.ts`
parses the manifest, enforces contiguous ordering, rejects duplicate versions,
paths, and hashes, rejects symlinks/out-of-repository paths, and verifies every
artifact SHA-256. It can execute only that list. Applied rows in the private
`saveswitch_meta.schema_migrations` ledger must be a checksum-matching prefix
of the same manifest; unknown, skipped, reordered, or changed entries fail.

Never change an applied SQL file or its manifest row. Forward repair means
append a new migration with the next version and a new checksum. Rebuilding a
failed clean RDS target is an explicit, separately authorized operation; this
runner deliberately refuses an unledgered non-empty `public` schema.

## Production sequence

Keep the ECS/API service disabled throughout this sequence. Existing Terraform
plan artifacts were created for review and must not be applied as deployment
authority.

1. An RDS administrator creates a fresh private target and runs
   `roles/bootstrap.sql` using an explicit database name plus short UTC expiry
   timestamps. That administrator must separately configure the temporary
   migrator/loader login mechanism in Secrets Manager or IAM database auth;
   passwords must never appear in a shell command, repository file, CI log, or
   terminal transcript.
   Bootstrap retains `saveswitch_owner` membership with admin option only on
   that named RDS administrator so ownership transfer and later retirement can
   be performed explicitly; runtime, loader, and CI identities never receive
   that membership.
2. Connect as `saveswitch_migrator` and run the manifest runner. It sets the
   non-login owner role only inside each transaction, applies `0000` through
   `0004`, and inserts each matching ledger row in the same transaction as
   that migration. Every iteration re-reads the ledger after acquiring the
   database-scoped advisory lock, and bounds lock, statement, and
   idle-in-transaction waits.
3. While the temporary `saveswitch_migrator` login is active, run
   `roles/after-schema-grants.sql`. The script explicitly sets the non-login
   owner role, then gives the loader SELECT/INSERT on exactly `users`, `pages`,
   and `resources`; it grants no deletion-queue access or DDL.
4. Produce a fresh custom, data-only dump of the already accepted local
   canonical database, using only the three data tables. Store it in protected
   temporary storage outside the repository:

   ```bash
   pg_dump --format=custom --data-only --no-owner --no-privileges \
     --table=public.users --table=public.pages --table=public.resources \
     --file /protected/path/saveswitch-canonical-data.dump "$CANONICAL_DATABASE_URL"
   ```

5. Connect as `saveswitch_loader` and restore that exact dump into RDS. Do not
   use `--clean`, `--create`, or `--disable-triggers`; they are incompatible
   with the least-privilege load and could hide integrity problems:

   ```bash
   pg_restore --data-only --single-transaction --exit-on-error \
     --no-owner --no-privileges --dbname="$DATABASE_URL" \
     /protected/path/saveswitch-canonical-data.dump
   ```

6. Connect as `saveswitch_migrator` while its temporary membership is still
   valid, then run `validate-target.sql` with the reviewed canonical aggregate
   values. The script sets the owner role, runs `ANALYZE`, and emits one
   aggregate. The accepted rehearsal values are 4 users, 39 pages, 378
   resources, and 0 queue rows:

   ```bash
   psql -X -v ON_ERROR_STOP=1 -d "$DATABASE_URL" \
     -v expected_users=4 -v expected_pages=39 \
     -v expected_resources=378 -v expected_queue=0 \
     -f scripts/db-migrate/validate-target.sql
   ```

   The validator emits one JSON aggregate only. It checks expected totals,
   queue emptiness, foreign-key orphans, uniqueness, provider field pairing,
   nonnegative counters, and validated constraints/indexes. It never reads a
   source or emits application rows.
7. Once that aggregate has `accepted: true`, as the RDS administrator run
   `roles/retire-elevated-roles.sql`. It removes loader access, removes the
   migrator's owner membership, and expires/disables both temporary logins.
   Only then may a separately accepted deployment enable the API.

The runner is available as an explicit package script and is never coupled to
API startup:

```bash
cd server && bun run db:migrate
```

The future one-off migration image must install the server package dependencies
and execute this command with a short-lived `DATABASE_URL` for the migrator.
Do not run it as the API application role.

## Failure behavior and prerequisites

Each migration and its ledger insert share one transaction. A failure rolls
back that migration; a successful earlier migration remains ledgered and can
be safely resumed only when its artifact hash still matches. The canonical
baseline's extension and tables commit atomically with its `0000` ledger row.
A timed-out advisory lock fails instead of allowing concurrent schema changes.

RDS prerequisites: a database administrator capable of creating roles and
transferring database/schema ownership; a private TLS-authenticated connection
path; a secure temporary credential/IAM-auth method; PostgreSQL `pgcrypto`
extension availability; and a separately approved one-off execution surface.
RDS master ownership restrictions or organization policies can prevent role
creation/ownership transfer; resolve them before any production attempt.
