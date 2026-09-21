#!/usr/bin/env bash
# One controlled, non-rerunnable data-load execution. It never contacts Heroku
# or Neon; the canonical dump is the sole data input. It does not start an API.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

refuse_xtrace
require_command docker
require_command sha256sum
require_value CANONICAL_DUMP_PATH
require_value SAVESWITCH_API_DISABLED_CONFIRM
[[ "$SAVESWITCH_API_DISABLED_CONFIRM" == 'API-DISABLED' ]] || die 'API must be disabled before data load (set SAVESWITCH_API_DISABLED_CONFIRM=API-DISABLED only after stopping it)'
load_environment
"$script_dir/verify-artifacts.sh"
require_regular_file "$CANONICAL_DUMP_PATH"
verify_sha256 "$CANONICAL_DUMP_SHA256" "$CANONICAL_DUMP_PATH"

for secret in migrator-password loader-password app-password; do
  assert_secret_file "$secret"
done

# A target may be pristine or a checksum-ledger-confirmed empty recovery state;
# it must never contain application rows. This is checked before role mutation.
admin_psql_file "$script_dir/sql/target-preflight.sql"

require_value SAVESWITCH_MIGRATOR_VALID_UNTIL
require_value SAVESWITCH_LOADER_VALID_UNTIL
admin_psql_file_with_bootstrap_passwords "$script_dir/sql/bootstrap-roles.sql" \
  -v "database_name=$PG_DATABASE" \
  -v "migrator_valid_until=$SAVESWITCH_MIGRATOR_VALID_UNTIL" \
  -v "loader_valid_until=$SAVESWITCH_LOADER_VALID_UNTIL"

"$script_dir/apply-schema.sh"
role_psql_file saveswitch_migrator migrator-password "$script_dir/sql/after-schema-grants.sql"

# Ensure a restore cannot append a second copy when an operator reruns only this
# stage. The loader itself cannot see the deletion queue, so the admin checks all
# four tables immediately before opening the custom archive.
admin_psql_command "
  DO \$\$ BEGIN
    IF (SELECT count(*) FROM public.users) <> 0
       OR (SELECT count(*) FROM public.pages) <> 0
       OR (SELECT count(*) FROM public.resources) <> 0
       OR (SELECT count(*) FROM public.asset_deletion_queue) <> 0 THEN
      RAISE EXCEPTION 'refusing data restore into a non-empty target';
    END IF;
  END \$\$;"

stage_dir="/var/lib/postgresql/saveswitch-load-${CANONICAL_DUMP_SHA256:0:16}"
stage_dump="$stage_dir/canonical-public.dump"
stage_list="$stage_dir/ordered-data.list"
docker exec -i -u root "$PG_CONTAINER" sh -ceu '
  directory=$1
  [ ! -e "$directory" ]
  mkdir -m 0700 "$directory"
  chown postgres:postgres "$directory"
' sh "$stage_dir" || die 'refusing to reuse a prior in-container dump staging directory'

cleanup_stage() {
  # The target is an explicit checksum-derived directory below PostgreSQL data;
  # the source dump remains untouched at CANONICAL_DUMP_PATH.
  docker exec -i -u root "$PG_CONTAINER" sh -ceu '
    directory=$1
    case "$directory" in /var/lib/postgresql/saveswitch-load-[0-9a-f][0-9a-f]*) ;; *) exit 1;; esac
    [ -d "$directory" ] && [ ! -L "$directory" ]
    rm -rf -- "$directory"
  ' sh "$stage_dir" >/dev/null 2>&1 || true
}
trap cleanup_stage EXIT INT TERM

docker cp "$CANONICAL_DUMP_PATH" "$PG_CONTAINER:$stage_dump"
docker exec -i -u root "$PG_CONTAINER" sh -ceu '
  file=$1
  [ -f "$file" ] && [ ! -L "$file" ]
  chown postgres:postgres "$file"
  chmod 0600 "$file"
' sh "$stage_dump"
docker exec -i -u postgres "$PG_CONTAINER" sh -ceu '
  expected=$1
  file=$2
  actual=$(sha256sum "$file" | awk "{print \$1}")
  [ "$actual" = "$expected" ]
' sh "$CANONICAL_DUMP_SHA256" "$stage_dump" || die 'in-container canonical dump checksum mismatch'

# The pinned archive's natural TOC order places pages before users. Because the
# target schema already has validated foreign keys, restore the three data
# entries in dependency order while retaining pg_restore's single transaction.
docker exec -i -u postgres "$PG_CONTAINER" sh -ceu '
  file=$1
  umask 077
  cat >"$file"
' sh "$stage_list" <<'EOF'
3570; 0 16507 TABLE DATA public users postgres
3571; 0 16525 TABLE DATA public pages postgres
3572; 0 16556 TABLE DATA public resources postgres
EOF

# Table restrictions plus the exact archive SHA make unexpected archive content
# unable to reach the target; restore behavior is deliberately additive only.
role_program saveswitch_loader loader-password \
  pg_restore --data-only --single-transaction --exit-on-error --no-owner --no-privileges \
    --use-list="$stage_list" \
    --host=127.0.0.1 --username=saveswitch_loader --dbname="$PG_DATABASE" "$stage_dump"

role_psql_file saveswitch_migrator migrator-password "$script_dir/sql/validate-target.sql" \
  | grep -Fq '"accepted": true' || die 'aggregate target validation did not accept the restored database'

admin_psql_file "$script_dir/sql/retire-elevated-roles.sql"
admin_psql_file "$script_dir/sql/post-retire-verify.sql" \
  | grep -Fq '"accepted": true' || die 'post-retirement role validation did not accept the target'

# Proves the final runtime credential can authenticate without selecting a
# record. DDL and migration-ledger privilege checks are done above as admin.
role_psql_command saveswitch_app app-password 'SELECT 1' >/dev/null
printf '%s\n' 'db-deploy-lightsail: load and validation completed; API remains disabled pending separate application deployment approval'
