#!/bin/sh
# Root-run backup hook. It treats lack of off-instance upload as failure and
# never deletes an existing dump.
set -eu

runtime_dir=/opt/saveswitch/runtime
runtime_env=/etc/saveswitch/runtime/runtime.env
backup_dir=/srv/saveswitch/postgres/backups
upload_hook=/usr/local/libexec/saveswitch/upload-postgres-backup

umask 077
[ "$(id -u)" -eq 0 ] || { echo "backup must run as root" >&2; exit 1; }
[ -d "$runtime_dir" ] || { echo "runtime directory missing" >&2; exit 1; }
[ -r "$runtime_env" ] || { echo "runtime environment missing" >&2; exit 1; }
[ -d "$backup_dir" ] || { echo "backup directory missing" >&2; exit 1; }
[ -x "$upload_hook" ] || { echo "off-instance upload hook missing or not executable" >&2; exit 1; }

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary=$(mktemp "$backup_dir/.saveswitch-$timestamp.XXXXXX.dump")
# The random suffix comes from atomically creating the temporary file. The
# root-only backup directory prevents another writer from replacing its final
# non-hidden counterpart between validation and upload.
final="$backup_dir/${temporary##*/.}"
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT HUP INT TERM

cd "$runtime_dir"
/usr/bin/docker compose --env-file "$runtime_env" exec -T --user postgres postgres \
  pg_dump --format=custom --no-owner --no-privileges --username=postgres --dbname=saveswitch >"$temporary"
# The dump lives on the host's attached disk, not in the database container.
# Send it over stdin for structural verification before it is uploaded.
/usr/bin/docker compose --env-file "$runtime_env" exec -T --user postgres postgres \
  pg_restore --list <"$temporary" >/dev/null
mv -- "$temporary" "$final"
trap - EXIT HUP INT TERM

# The hook receives one absolute dump path and must encrypt, transfer, and
# durably verify it before returning zero.
"$upload_hook" "$final"
