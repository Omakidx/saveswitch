#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for script in "$script_dir"/*.sh; do
  bash -n "$script"
done
bash -n "$script_dir/tests/disposable-postgres.sh"

(cd "$script_dir" && sha256sum -c artifacts.sha256 --status)

# Exact source/dump pinning and no source provider connection are non-negotiable.
grep -Fqx "readonly CANONICAL_DUMP_SHA256='82cb308843f66341a786f853b74e1a70dc27b92ce2e6d750f74adfe0cbcdadab'" "$script_dir/lib.sh"
grep -Fq 'expected' "$script_dir/sql/validate-target.sql"
grep -Fq "users = 4 AND pages = 39 AND resources = 378 AND queue = 0" "$script_dir/sql/validate-target.sql"
grep -Fq -- '--single-transaction --exit-on-error --no-owner --no-privileges' "$script_dir/run-load.sh"
grep -Fq -- '--use-list="$stage_list"' "$script_dir/run-load.sh"
grep -Fq '3570; 0 16507 TABLE DATA public users postgres' "$script_dir/run-load.sh"
grep -Fq '3571; 0 16525 TABLE DATA public pages postgres' "$script_dir/run-load.sh"
grep -Fq '3572; 0 16556 TABLE DATA public resources postgres' "$script_dir/run-load.sh"
restore_list_marker="' sh \"\$stage_list\" <<'EOF'"
actual_restore_list="$(awk -v marker="$restore_list_marker" '
  $0 == marker { capture = 1; next }
  capture && $0 == "EOF" { exit }
  capture { print }
' "$script_dir/run-load.sh")"
expected_restore_list=$'3570; 0 16507 TABLE DATA public users postgres\n3571; 0 16525 TABLE DATA public pages postgres\n3572; 0 16556 TABLE DATA public resources postgres'
[[ "$actual_restore_list" == "$expected_restore_list" ]]
if rg -n -- '--clean|--create|--disable-triggers|DATABASE_URL' "$script_dir/run-load.sh" "$script_dir/apply-schema.sh" "$script_dir/lib.sh"; then
  printf '%s\n' 'forbidden source/unsafe restore token found in executable workflow' >&2
  exit 1
fi

# Passwords are process-environment-only psql values; they must never become
# shell trace/log arguments or a repository plaintext file.
grep -Fq '\getenv saveswitch_app_password SAVESWITCH_APP_PASSWORD' "$script_dir/sql/bootstrap-roles.sql"
grep -Fq "[[ \"\$-\" != *x* ]]" "$script_dir/lib.sh"
grep -Fq 'chmod 0600' "$script_dir/run-load.sh"
grep -Fq "ALTER ROLE saveswitch_loader NOLOGIN" "$script_dir/sql/retire-elevated-roles.sql"
grep -Fq "REVOKE saveswitch_owner FROM saveswitch_migrator" "$script_dir/sql/retire-elevated-roles.sql"
grep -Fq -- '--pull=never' "$script_dir/tests/disposable-postgres.sh"

printf '%s\n' 'db-deploy-lightsail static contract: PASS'
