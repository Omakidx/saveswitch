#!/usr/bin/env bash
# Applies the immutable canonical baseline plus the four approved application
# migrations in one guarded transaction. It is safe to rerun only after a full
# success: a failed transaction rolls back all five schema ledger rows.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

refuse_xtrace
require_command docker
require_command sha256sum
load_environment
"$script_dir/verify-artifacts.sh"
assert_secret_file migrator-password

# These are immutable repository inputs rather than copies: checking both the
# resolved regular file and digest prevents a later application edit from being
# silently promoted into a production schema change.
verify_sha256 b3c7b77b8e6356651556b26c639fd889d6d09ed49c3fafed41ac31ec7caa82bc "$repo_root/scripts/db-merge/sql/canonical-schema.sql"
verify_sha256 eb05f6eac5c4eb63cf467fe5b7a2bd93f9bbfec07d3e62d6ad3885470d507da9 "$repo_root/server/drizzle/0001_xoomshare_rooms.sql"
verify_sha256 eaa254064b0760eafbc5f81bb6e02fd5dbe18f21f07ac1c5141f8e8833105c1b "$repo_root/server/drizzle/0002_xoomshare_guest_ownership.sql"
verify_sha256 a66daccf6fe2ffd0b238b607faa22b9d2e9efdccfca337c35f150061a7d4bbbd "$repo_root/server/drizzle/0003_xoomshare_resource_quotas.sql"
verify_sha256 6a692d84ae50c35c3fed846c42d64e0bcc51bb3bcf343016750296e4bf82ac72 "$repo_root/server/drizzle/0004_asset_deletion_queue.sql"

ledger_relation="$(admin_psql_scalar "
  SELECT COALESCE(to_regclass('saveswitch_meta.schema_migrations')::text, '');")"

# PostgreSQL resolves relation references while parsing a statement, before a
# CASE expression can short-circuit. Never mention the ledger relation in SQL
# until to_regclass has independently proved that it exists.
if [[ -z "$ledger_relation" ]]; then
  schema_state='empty'
else
  [[ "$ledger_relation" == 'saveswitch_meta.schema_migrations' ]] \
    || die 'schema ledger resolved to an unexpected relation'
  schema_state="$(admin_psql_scalar "
    SELECT CASE
      WHEN count(*) <> 5 THEN 'invalid'
      WHEN EXISTS (
        SELECT 1 FROM saveswitch_meta.schema_migrations
        WHERE (version, name, sha256) NOT IN (
          ('0000','canonical-baseline','b3c7b77b8e6356651556b26c639fd889d6d09ed49c3fafed41ac31ec7caa82bc'),
          ('0001','xoomshare-rooms','eb05f6eac5c4eb63cf467fe5b7a2bd93f9bbfec07d3e62d6ad3885470d507da9'),
          ('0002','xoomshare-guest-ownership','eaa254064b0760eafbc5f81bb6e02fd5dbe18f21f07ac1c5141f8e8833105c1b'),
          ('0003','xoomshare-resource-quotas','a66daccf6fe2ffd0b238b607faa22b9d2e9efdccfca337c35f150061a7d4bbbd'),
          ('0004','asset-deletion-queue','6a692d84ae50c35c3fed846c42d64e0bcc51bb3bcf343016750296e4bf82ac72')
        )
      ) THEN 'invalid'
      ELSE 'current'
    END
    FROM saveswitch_meta.schema_migrations;")"
fi

case "$schema_state" in
  current)
    printf '%s\n' 'db-deploy-lightsail schema ledger: already current'
    exit 0
    ;;
  empty) ;;
  *) die 'schema ledger is not an accepted empty/current state' ;;
esac

emit_header() {
  cat <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtextextended(current_database() || ':saveswitch-schema-migrations', 0));
SET LOCAL ROLE saveswitch_owner;
CREATE SCHEMA IF NOT EXISTS saveswitch_meta AUTHORIZATION saveswitch_owner;
REVOKE ALL ON SCHEMA saveswitch_meta FROM PUBLIC;
CREATE TABLE IF NOT EXISTS saveswitch_meta.schema_migrations (
  version text PRIMARY KEY CHECK (version ~ '^[0-9]{4}$'),
  name text NOT NULL UNIQUE CHECK (name <> ''),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL
);
REVOKE ALL ON saveswitch_meta.schema_migrations FROM PUBLIC;
DO $$
DECLARE public_relations integer;
BEGIN
  IF EXISTS (SELECT 1 FROM saveswitch_meta.schema_migrations) THEN
    RAISE EXCEPTION 'concurrent or prior partial schema migration detected';
  END IF;
  SELECT count(*) INTO public_relations
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');
  IF public_relations <> 0 THEN
    RAISE EXCEPTION 'refusing baseline on a non-empty public schema';
  END IF;
END $$;
SQL
}

emit_ledger_row() {
  local version="$1" name="$2" hash="$3"
  printf "INSERT INTO saveswitch_meta.schema_migrations(version, name, sha256, applied_by) VALUES ('%s', '%s', '%s', 'saveswitch_migrator');\n" "$version" "$name" "$hash"
}

{
  emit_header
  cat "$repo_root/scripts/db-merge/sql/canonical-schema.sql"
  emit_ledger_row 0000 canonical-baseline b3c7b77b8e6356651556b26c639fd889d6d09ed49c3fafed41ac31ec7caa82bc
  cat "$repo_root/server/drizzle/0001_xoomshare_rooms.sql"
  emit_ledger_row 0001 xoomshare-rooms eb05f6eac5c4eb63cf467fe5b7a2bd93f9bbfec07d3e62d6ad3885470d507da9
  cat "$repo_root/server/drizzle/0002_xoomshare_guest_ownership.sql"
  emit_ledger_row 0002 xoomshare-guest-ownership eaa254064b0760eafbc5f81bb6e02fd5dbe18f21f07ac1c5141f8e8833105c1b
  cat "$repo_root/server/drizzle/0003_xoomshare_resource_quotas.sql"
  emit_ledger_row 0003 xoomshare-resource-quotas a66daccf6fe2ffd0b238b607faa22b9d2e9efdccfca337c35f150061a7d4bbbd
  cat "$repo_root/server/drizzle/0004_asset_deletion_queue.sql"
  emit_ledger_row 0004 asset-deletion-queue 6a692d84ae50c35c3fed846c42d64e0bcc51bb3bcf343016750296e4bf82ac72
  printf '%s\n' 'COMMIT;'
} | role_program saveswitch_migrator migrator-password \
  psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U saveswitch_migrator -d "$PG_DATABASE" -f -

printf '%s\n' 'db-deploy-lightsail schema ledger: current through 0004'
