#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
run_id="${RANDOM}${RANDOM}"
container="saveswitch-db-migrate-validation-${run_id}"
work_dir="$(mktemp -d /tmp/saveswitch-db-migrate-validation.XXXXXX)"
local_password='local-validation-only'

cleanup() {
  if [[ "$container" == saveswitch-db-migrate-validation-* ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  if [[ "$work_dir" == /tmp/saveswitch-db-migrate-validation.* ]]; then
    rm -rf "$work_dir"
  fi
}
trap cleanup EXIT INT TERM

on_error() {
  for log in "$work_dir"/runner-*.log; do
    if [[ -f "$log" ]]; then
      echo "--- $(basename "$log")" >&2
      sed -n '1,160p' "$log" >&2
    fi
  done
}
trap on_error ERR

docker image inspect postgres:18 >/dev/null
docker run --detach --pull=never --name "$container" \
  --publish 127.0.0.1::5432 \
  --env "POSTGRES_PASSWORD=$local_password" \
  postgres:18 >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d postgres >/dev/null

docker cp "$repo_root/scripts/db-migrate/roles/bootstrap.sql" "$container:/tmp/bootstrap.sql"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -v database_name=postgres \
  -v migrator_valid_until=2099-01-01T00:00:00Z \
  -v loader_valid_until=2099-01-01T00:00:00Z \
  -f /tmp/bootstrap.sql >/dev/null
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "ALTER ROLE saveswitch_migrator PASSWORD '$local_password'; ALTER ROLE saveswitch_loader PASSWORD '$local_password'; ALTER ROLE saveswitch_app PASSWORD '$local_password';" >/dev/null

port_mapping="$(docker port "$container" 5432/tcp)"
host_port="${port_mapping##*:}"
if [[ ! "$host_port" =~ ^[0-9]+$ ]]; then
  echo 'failed to resolve loopback PostgreSQL port' >&2
  exit 1
fi
database_url="postgres://saveswitch_migrator:${local_password}@localhost:${host_port}/postgres"

# Two first-run processes must safely serialize and converge on one exact
# five-row ledger. Logs contain migration identifiers only.
DATABASE_URL="$database_url" bun "$repo_root/scripts/db-migrate/run.ts" >"$work_dir/runner-a.log" 2>&1 &
runner_a=$!
DATABASE_URL="$database_url" bun "$repo_root/scripts/db-migrate/run.ts" >"$work_dir/runner-b.log" 2>&1 &
runner_b=$!
wait "$runner_a"
wait "$runner_b"

# Idempotent rerun must be a no-op and still verify every artifact checksum.
rerun_output="$(DATABASE_URL="$database_url" bun "$repo_root/scripts/db-migrate/run.ts")"
grep -Fq 'migration ledger is current through 0004' <<<"$rerun_output"
if grep -Fq 'applied migration' <<<"$rerun_output"; then
  echo 'idempotent rerun unexpectedly applied a migration' >&2
  exit 1
fi

ledger_count="$(docker exec "$container" psql -X -U postgres -d postgres -Atc 'SELECT count(*) FROM saveswitch_meta.schema_migrations')"
test "$ledger_count" = '5'
docker exec "$container" psql -X -U postgres -d postgres -Atc \
  "SELECT string_agg(version || ':' || name, ',' ORDER BY version) FROM saveswitch_meta.schema_migrations" \
  | grep -Fqx '0000:canonical-baseline,0001:xoomshare-rooms,0002:xoomshare-guest-ownership,0003:xoomshare-resource-quotas,0004:asset-deletion-queue'

docker cp "$repo_root/scripts/db-migrate/roles/after-schema-grants.sql" "$container:/tmp/after-schema-grants.sql"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/after-schema-grants.sql >/dev/null

# App role can perform only the application's expected table lifecycle.
docker exec --env "PGPASSWORD=$local_password" "$container" psql -X -v ON_ERROR_STOP=1 \
  -h 127.0.0.1 -U saveswitch_app -d postgres -c \
  "BEGIN; INSERT INTO users(id,email,name,picture) VALUES ('validation-user','validation@example.invalid','Validation','https://example.invalid/picture'); INSERT INTO pages(user_id,color,name) VALUES ('validation-user','#000000','Validation'); UPDATE users SET name='Updated' WHERE id='validation-user'; DELETE FROM pages WHERE user_id='validation-user'; ROLLBACK;" >/dev/null

for forbidden_sql in \
  'CREATE TABLE forbidden_table(id integer)' \
  'TRUNCATE TABLE users' \
  'DELETE FROM users WHERE false' \
  'SELECT count(*) FROM saveswitch_meta.schema_migrations'; do
  if docker exec --env "PGPASSWORD=$local_password" "$container" psql -X -v ON_ERROR_STOP=1 \
    -h 127.0.0.1 -U saveswitch_app -d postgres -c "$forbidden_sql" >/dev/null 2>&1; then
    echo "application role unexpectedly executed: $forbidden_sql" >&2
    exit 1
  fi
done

# Loader can insert/select the three load tables but cannot write the queue or
# create schema objects. All positive fixture writes are rolled back.
docker exec --env "PGPASSWORD=$local_password" "$container" psql -X -v ON_ERROR_STOP=1 \
  -h 127.0.0.1 -U saveswitch_loader -d postgres -c \
  "BEGIN; INSERT INTO users(id,email,name,picture) VALUES ('loader-user','loader@example.invalid','Loader','https://example.invalid/picture'); SELECT count(*) FROM users; ROLLBACK;" >/dev/null
if docker exec --env "PGPASSWORD=$local_password" "$container" psql -X -v ON_ERROR_STOP=1 \
  -h 127.0.0.1 -U saveswitch_loader -d postgres -c \
  "INSERT INTO asset_deletion_queue(provider_public_id,provider_resource_type) VALUES ('forbidden','raw')" >/dev/null 2>&1; then
  echo 'loader unexpectedly wrote the deletion queue' >&2
  exit 1
fi

# Database constraints reject invalid values even when the application has
# table write privileges.
if docker exec --env "PGPASSWORD=$local_password" "$container" psql -X -v ON_ERROR_STOP=1 \
  -h 127.0.0.1 -U saveswitch_app -d postgres -c \
  "INSERT INTO users(id,email,name,picture,visibility) VALUES ('invalid-user','invalid@example.invalid','Invalid','https://example.invalid/picture','everyone')" >/dev/null 2>&1; then
  echo 'invalid visibility unexpectedly passed its database constraint' >&2
  exit 1
fi

docker cp "$repo_root/scripts/db-migrate/validate-target.sql" "$container:/tmp/validate-target.sql"
docker exec --env "PGPASSWORD=$local_password" "$container" psql -X -v ON_ERROR_STOP=1 \
  -h 127.0.0.1 -U saveswitch_migrator -d postgres \
  -v expected_users=0 -v expected_pages=0 -v expected_resources=0 -v expected_queue=0 \
  -f /tmp/validate-target.sql | grep -Fq '"accepted": true'
if docker exec --env "PGPASSWORD=$local_password" "$container" psql -X -v ON_ERROR_STOP=1 \
  -h 127.0.0.1 -U saveswitch_migrator -d postgres \
  -v expected_users=1 -v expected_pages=0 -v expected_resources=0 -v expected_queue=0 \
  -f /tmp/validate-target.sql >/dev/null 2>&1; then
  echo 'target validator unexpectedly accepted mismatched aggregates' >&2
  exit 1
fi

docker cp "$repo_root/scripts/db-migrate/roles/retire-elevated-roles.sql" "$container:/tmp/retire-elevated-roles.sql"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/retire-elevated-roles.sql >/dev/null
docker exec "$container" psql -X -U postgres -d postgres -Atc \
  "SELECT bool_and(NOT rolcanlogin) FROM pg_roles WHERE rolname IN ('saveswitch_migrator','saveswitch_loader')" \
  | grep -Fqx 't'

echo 'disposable PostgreSQL migration contract: PASS'
