#!/usr/bin/env bash
# End-to-end disposable validation. It uses only a pre-cached postgres:18
# image and the protected canonical archive named by CANONICAL_DUMP_PATH.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
container="saveswitch-db-deploy-lightsail-test-${RANDOM}${RANDOM}"
local_admin_password='local-validation-admin-only'

cleanup() {
  if [[ "$container" == saveswitch-db-deploy-lightsail-test-* ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

[[ "$-" != *x* ]] || { printf '%s\n' 'refusing xtrace' >&2; exit 1; }
[[ -n "${CANONICAL_DUMP_PATH:-}" && -f "$CANONICAL_DUMP_PATH" && ! -L "$CANONICAL_DUMP_PATH" ]] \
  || { printf '%s\n' 'CANONICAL_DUMP_PATH must name the protected canonical archive' >&2; exit 1; }
docker image inspect postgres:18 >/dev/null
docker run --detach --pull=never --name "$container" \
  --env POSTGRES_DB=saveswitch --env "POSTGRES_PASSWORD=$local_admin_password" \
  postgres:18 >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres -d saveswitch >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d saveswitch >/dev/null

docker exec -i -u root "$container" sh -ceu '
  mkdir -p /run/saveswitch/db-bootstrap
  chown postgres:postgres /run/saveswitch /run/saveswitch/db-bootstrap
  chmod 0700 /run/saveswitch /run/saveswitch/db-bootstrap
  umask 077
  printf %s local-validation-migrator-9GmQ > /run/saveswitch/db-bootstrap/migrator-password
  printf %s local-validation-loader-5VnKr > /run/saveswitch/db-bootstrap/loader-password
  printf %s local-validation-app-3XwLp > /run/saveswitch/db-bootstrap/app-password
  chown postgres:postgres /run/saveswitch/db-bootstrap/*
  chmod 0600 /run/saveswitch/db-bootstrap/*
'

export PG_CONTAINER="$container"
export PG_DATABASE='saveswitch'
export PG_SECRETS_DIR='/run/saveswitch/db-bootstrap'
export SAVESWITCH_API_DISABLED_CONFIRM='API-DISABLED'
export SAVESWITCH_MIGRATOR_VALID_UNTIL='2099-01-01T00:00:00Z'
export SAVESWITCH_LOADER_VALID_UNTIL='2099-01-01T00:00:00Z'
"$script_dir/run-load.sh" >/dev/null

docker exec -u postgres "$container" psql -X -q -U postgres -d saveswitch -Atc \
  "SELECT (SELECT count(*) FROM users) || ',' || (SELECT count(*) FROM pages) || ',' || (SELECT count(*) FROM resources) || ',' || (SELECT count(*) FROM asset_deletion_queue)" \
  | grep -Fqx '4,39,378,0'
docker exec -u postgres "$container" psql -X -q -U postgres -d saveswitch -Atc \
  "SELECT bool_and(NOT rolcanlogin) FROM pg_roles WHERE rolname IN ('saveswitch_loader','saveswitch_migrator')" \
  | grep -Fqx t

printf '%s\n' 'db-deploy-lightsail disposable PostgreSQL 18 contract: PASS'
