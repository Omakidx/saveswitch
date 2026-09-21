#!/usr/bin/env bash
# Shared, non-secret helpers for the one-time Lightsail PostgreSQL load.
# This file is sourced by the executable scripts in this directory.

set -euo pipefail

readonly CANONICAL_DUMP_SHA256='82cb308843f66341a786f853b74e1a70dc27b92ce2e6d750f74adfe0cbcdadab'
readonly EXPECTED_USERS='4'
readonly EXPECTED_PAGES='39'
readonly EXPECTED_RESOURCES='378'
readonly EXPECTED_QUEUE='0'

die() {
  printf '%s\n' "db-deploy-lightsail: $*" >&2
  exit 1
}

refuse_xtrace() {
  [[ "$-" != *x* ]] || die 'refusing to run while shell xtrace is enabled'
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "$name is required"
}

validate_container_name() {
  [[ "$PG_CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die 'PG_CONTAINER is not a safe Docker container name'
}

validate_database_name() {
  [[ "$PG_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || die 'PG_DATABASE must be a PostgreSQL identifier'
}

require_regular_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || die "required regular non-symlink file is unavailable: $path"
}

verify_sha256() {
  local expected="$1"
  local file="$2"
  require_regular_file "$file"
  local actual
  actual="$(sha256sum "$file" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || die "checksum mismatch for $file"
}

load_environment() {
  require_value PG_CONTAINER
  require_value PG_DATABASE
  require_value PG_SECRETS_DIR
  validate_container_name
  validate_database_name
  [[ "$PG_SECRETS_DIR" == /* && "$PG_SECRETS_DIR" != '/' ]] || die 'PG_SECRETS_DIR must be a non-root absolute path inside the PostgreSQL container'
  docker inspect --format '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null | grep -Fxq true \
    || die "PostgreSQL container is not running: $PG_CONTAINER"
}

# Runs psql through the container's local Unix socket as its administrative
# postgres OS user. It intentionally never receives a password argument.
admin_psql_file() {
  local sql_file="$1"
  shift
  require_regular_file "$sql_file"
  docker exec -i -u postgres "$PG_CONTAINER" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$PG_DATABASE" "$@" -f - <"$sql_file"
}

admin_psql_command() {
  local statement="$1"
  docker exec -i -u postgres "$PG_CONTAINER" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$PG_DATABASE" -c "$statement"
}

admin_psql_scalar() {
  local statement="$1"
  docker exec -i -u postgres "$PG_CONTAINER" \
    psql -X -A -t -q -v ON_ERROR_STOP=1 -U postgres -d "$PG_DATABASE" -c "$statement"
}

# Bootstrap is the sole administrative SQL phase that needs to read password
# material. The three values stay in this immediate container process for psql
# `\\getenv`; neither the host command nor the SQL invocation has a secret arg.
admin_psql_file_with_bootstrap_passwords() {
  local sql_file="$1"
  shift
  require_regular_file "$sql_file"
  for secret_name in migrator-password loader-password app-password; do
    assert_secret_file "$secret_name"
  done
  docker exec -i -u postgres "$PG_CONTAINER" sh -ceu '
    directory=$1
    database=$2
    shift 2
    export SAVESWITCH_MIGRATOR_PASSWORD="$(cat "$directory/migrator-password")"
    export SAVESWITCH_LOADER_PASSWORD="$(cat "$directory/loader-password")"
    export SAVESWITCH_APP_PASSWORD="$(cat "$directory/app-password")"
    exec psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database" "$@" -f -
  ' sh "$PG_SECRETS_DIR" "$PG_DATABASE" "$@" <"$sql_file"
}

# The PostgreSQL container must already hold these files in a root-unreadable
# application-independent runtime directory owned by postgres (0700 directory,
# 0600 files). The password is read only in the exec'd process environment;
# it is never placed in a host command argument or echoed by a script.
assert_secret_file() {
  local secret_name="$1"
  [[ "$secret_name" =~ ^[a-z0-9-]{3,80}$ ]] || die 'invalid secret file name'
  # This check must not attach stdin. role_program can call it while SQL or a
  # dump stream is waiting on the function's stdin; `docker exec -i` would
  # consume that stream before psql/pg_restore receives it.
  docker exec -u postgres "$PG_CONTAINER" sh -ceu '
    directory=$1
    name=$2
    file="$directory/$name"
    [ -d "$directory" ] && [ ! -L "$directory" ]
    [ "$(stat -c %a "$directory")" = 700 ]
    [ "$(stat -c %u "$directory")" = "$(id -u)" ]
    [ -f "$file" ] && [ ! -L "$file" ]
    [ "$(stat -c %a "$file")" = 600 ]
    [ "$(stat -c %u "$file")" = "$(id -u)" ]
    [ -s "$file" ]
    ! LC_ALL=C grep -q "[[:space:]]" "$file"
  ' sh "$PG_SECRETS_DIR" "$secret_name" \
    || die "protected secret-file contract failed: $secret_name"
}

role_program() {
  local role="$1"
  local secret_name="$2"
  shift 2
  assert_secret_file "$secret_name"
  docker exec -i -u postgres "$PG_CONTAINER" sh -ceu '
    secret_file=$1
    database=$2
    login_role=$3
    shift 3
    password=$(cat "$secret_file")
    [ -n "$password" ]
    export PGPASSWORD=$password
    exec "$@"
  ' sh "$PG_SECRETS_DIR/$secret_name" "$PG_DATABASE" "$role" "$@"
}

role_psql_file() {
  local role="$1"
  local secret_name="$2"
  local sql_file="$3"
  shift 3
  require_regular_file "$sql_file"
  role_program "$role" "$secret_name" \
    psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$role" -d "$PG_DATABASE" "$@" -f - <"$sql_file"
}

role_psql_command() {
  local role="$1"
  local secret_name="$2"
  local statement="$3"
  role_program "$role" "$secret_name" \
    psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$role" -d "$PG_DATABASE" -c "$statement"
}
