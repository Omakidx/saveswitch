# Local database merge rehearsal

This directory provides a reproducible, disposable rehearsal for combining the
current Heroku Saveswitch database with the historical Neon database. It is not
production cutover authorization and it makes no AWS, Heroku, Neon, Cloudflare,
or Cloudinary change.

## Decided policy

- This rehearsal uses PostgreSQL 18 because Neon is currently PostgreSQL 18.6.
  The future AWS target Region is `us-east-1`; its exact RDS PostgreSQL version
  remains gated on current Regional support and application compatibility when
  production infrastructure is separately authorized.
- Heroku is the authoritative source when a compatible record conflicts.
- Neon is historical: it must receive no writes.
- Expired Xoomshare records are preserved.
- Cloudinary remains the media provider. No media is copied to S3.
- `asset_deletion_queue` starts empty and is never imported, so no historical
  Cloudinary asset is deleted by this rehearsal.

## Safety model

The canonical disposable database must expose each already-restored source as
read-only `postgres_fdw` foreign tables:

| Schema | Required foreign tables |
| --- | --- |
| `heroku_source` | `users`, `pages`, `resources`, `asset_deletion_queue` |
| `neon_source` | `users`, `pages`, `resources` |

`source-access.sql` fails unless every relation is a foreign table served by its
distinct approved staging server with `updatable=false`, no table-level
`updatable=true` override, and a current-user mapping to the dedicated remote
`merge_reader` role. The server host/database options must identify the
internal disposable `saveswitch-stage-heroku-*`/`stage_heroku` and
`saveswitch-stage-neon-*`/`stage_neon` databases. The merge scripts themselves
contain no source DML. Do not point them at a live host.

Create `merge_reader` independently in each restored staging database. Give it
only `CONNECT` on that database, `USAGE` on the source schema, and `SELECT` on
the required tables; revoke DML and schema creation, set
`default_transaction_read_only=on`, and use only that role in the FDW user
mapping. Prove the role cannot perform DML before running preflight. A server
flag is defense in depth, not a substitute for remote database privileges.

The manifest in `merge_audit.conflict_manifest` stores only SHA-256 record
fingerprints, source, entity, and reason. It is a quarantine ledger: unsafe
Neon records are never joined onto a Heroku identity or inserted into `public`.
The merge aborts before target writes whenever that ledger is non-empty.

An identical user ID is a compatible identity: Heroku's attributes win and
Neon's pages retain that shared foreign key. Fail-closed reasons instead
include email or username ownership by a different ID, page UUID/path/session
collisions, resource UUID collisions, orphaned foreign keys, and Neon
dependents of an unsafe user or page. Remediate those conflicts deliberately,
create another clean disposable target, and rerun. Do not delete records or
alter either source to make the script pass.

## Local workflow

Use a new disposable canonical database for every attempt. From the repository
root, and only after the local FDW source schemas have been provisioned:

```bash
export CANONICAL_CONTAINER='<canonical-container>'
docker cp scripts/db-merge/sql "${CANONICAL_CONTAINER}:/tmp/db-merge-sql"
docker exec -u postgres "${CANONICAL_CONTAINER}" \
  psql -X -v ON_ERROR_STOP=1 -d canonical_rehearsal -f /tmp/db-merge-sql/canonical-schema.sql
docker exec -u postgres "${CANONICAL_CONTAINER}" \
  psql -X -v ON_ERROR_STOP=1 -d canonical_rehearsal -f /tmp/db-merge-sql/preflight.sql
docker exec -u postgres "${CANONICAL_CONTAINER}" \
  psql -X -v ON_ERROR_STOP=1 -d canonical_rehearsal -f /tmp/db-merge-sql/merge.sql
docker exec -u postgres "${CANONICAL_CONTAINER}" \
  psql -X -v ON_ERROR_STOP=1 -d canonical_rehearsal -f /tmp/db-merge-sql/validate.sql
```

The source access and validation scripts output aggregate counts only. Do not
replace those queries with row-selects, and do not copy connection strings,
dumps, or output containing source records into this repository.

The temporary copy is inside the disposable canonical container only. The SQL
uses `\ir` to load its sibling `source-access.sql`; it has no host, credential,
or live-provider configuration.

## Merge behavior

After the manifest is empty, the script starts one transaction and requires all
public target tables to be empty. It inserts Heroku then Neon, preserving UUIDs
and timestamps. Neon columns introduced later receive deterministic values:

- resource `size_bytes` is the UTF-8 byte length of persisted content,
  title, description, and thumbnail fields;
- Cloudinary provider fields are `NULL`, never inferred;
- Xoomshare counters are recomputed across every room page, including expired
  rooms;
- no asset-deletion queue row is imported or created.

All target writes roll back if a constraint, counter range, or transaction
check fails. The conflict ledger remains so its aggregate counts can be
reviewed. A successful target is intentionally not rerunnable: a second merge
fails rather than mixing runs. Forward repair means discard the disposable
target, remediate the source conflict mapping outside this script with approval,
and rebuild from the original immutable restores. Do not use rollback against
either source.

## Acceptance checks

`validate.sql` must report zero for manifest conflicts, source/target orphan
checks, invalid values, counter mismatches, queue rows, queued references, and
disposition-to-target reconciliation mismatches. Every aggregate field-level
fidelity check for Heroku, additive Neon rows, the shared-user winner, and
Neon-derived resource fields must also report zero.
Its retained-expired count is evidence that expired Xoomshare data was not
filtered. Compare source disposition counts with target counts before any
future production cutover discussion.

## RDS handoff

After this local rehearsal is accepted, do not connect this canonical database
to the API or restore it in place. The RDS-only baseline, immutable migration
ledger, least-privilege role handoff, data-only dump/restore command, and
aggregate target validator are in [`../db-migrate/README.md`](../db-migrate/README.md).
The only approved data export is a fresh data-only custom dump of canonical
`users`, `pages`, and `resources`; `asset_deletion_queue` remains empty.

## Retention and teardown gate

These restores, dumps, connection URL files, FDW mappings, and the canonical
dump are full-data sensitive copies. Agree on a short retention deadline and
obtain explicit teardown authorization before removal. Until then, keep the
Docker network internal, publish no PostgreSQL ports, leave provider/app
processes disconnected, and keep host artifacts mode `0600` under a mode
`0700` directory.

At teardown, first inventory and record the exact resolved container names,
volume names, network name, and temporary directory. Stop and remove only
those explicit disposable containers, then their explicit volumes and network;
remove only the resolved temporary directory after checking it is neither `/`,
the repository, nor a home directory. Revoke the temporary `merge_reader`
credentials and delete its FDW mappings. Provider credential rotation is a
separate live action: rotate any captured Heroku or Neon credential only with
explicit authorization, then remove the local URL files. Finish by confirming
that no labeled disposable container, volume, network, dump, URL file, or
canonical artifact remains. Do not use broad globs or recursive deletion with
an unresolved variable.
