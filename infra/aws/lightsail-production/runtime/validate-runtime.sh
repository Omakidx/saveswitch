#!/bin/sh
# Offline validation only. It does not contact registries, Docker daemons,
# Cloudflare, AWS, or a database.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose="$root/compose.yaml"

die() { echo "runtime validation: $*" >&2; exit 1; }
need() { [ -f "$root/$1" ] || die "missing $1"; }

for file in compose.yaml runtime.env.example api.env.example cloudflared.env.example \
  cloudflared.service saveswitch-compose.service saveswitch-cleanup.service \
  saveswitch-cleanup.timer saveswitch-backup.service saveswitch-backup.timer \
  backup-postgres.sh upload-postgres-backup-cloudinary.sh README.md; do
  need "$file"
done

sh -n "$root/backup-postgres.sh"
sh -n "$root/upload-postgres-backup-cloudinary.sh"

# The checked-in templates must remain explicit placeholders, never examples
# containing a credential or a tag-only image reference.
if rg -q '^TUNNEL_TOKEN=' "$root/cloudflared.env.example"; then
  die "tunnel token must not use an environment or argv contract"
fi
rg -q '^GOOGLE_CLIENT_SECRET=REPLACE$' "$root/api.env.example" || die "bad OAuth secret template"
rg -q '^JWT_SECRET=REPLACE$' "$root/api.env.example" || die "bad JWT template"
rg -q '^CLOUDINARY_URL=REPLACE$' "$root/api.env.example" || die "bad Cloudinary template"
rg -q '@sha256:REPLACE_WITH_64_HEX_CHARACTERS$' "$root/runtime.env.example" || die "image digest templates missing"

rg -q '^\s*- "127\.0\.0\.1:5000:5000"$' "$compose" || die "API is not loopback-published"
if sed -n '/^  postgres:/,/^  api:/p' "$compose" | rg -q '^\s*ports:'; then
  die "PostgreSQL must not publish a host port"
fi
[ "$(rg -c '^    read_only: true$' "$compose")" -eq 2 ] || die "API/cleanup read-only filesystem is missing"
rg -q 'POSTGRES_DATA_DIR' "$compose" || die "PostgreSQL data mount is missing"
rg -q 'subnet: 172\.30\.250\.0/24' "$compose" || die "dedicated runtime bridge subnet is missing"
rg -q 'gateway: 172\.30\.250\.1' "$compose" || die "dedicated runtime bridge gateway is missing"
rg -q '^      POSTGRES_USER: postgres$' "$compose" || die "PostgreSQL bootstrap administrator does not match the load workflow"
rg -q 'pg_isready -U postgres -d saveswitch' "$compose" || die "PostgreSQL health identity does not match the bootstrap administrator"
rg -q 'condition: service_healthy' "$compose" || die "startup health dependency is missing"
rg -q 'no-new-privileges:true' "$compose" || die "container privilege hardening is missing"
rg -q -- '--no-autoupdate' "$root/cloudflared.service" || die "cloudflared auto-update is not disabled"
rg -q 'LoadCredential=tunnel-token:/etc/saveswitch/runtime/cloudflared-token' "$root/cloudflared.service" || die "cloudflared token is not a systemd credential"
rg -q -- '--token-file %d/tunnel-token' "$root/cloudflared.service" || die "cloudflared does not read its token from the credential file"
if rg -q -- '--token([ =]|$)|TUNNEL_TOKEN=' "$root/cloudflared.service"; then
  die "cloudflared token would be exposed through argv or environment"
fi
rg -q '^DATABASE_URL=postgres://saveswitch_app:' "$root/api.env.example" || die "API database identity is not the least-privilege application role"
rg -q '^TRUSTED_PROXY_PEERS=172\.30\.250\.1,::ffff:172\.30\.250\.1$' "$root/api.env.example" || die "API trusted proxy peers do not match the dedicated bridge gateway"
rg -q 'upload-postgres-backup' "$root/backup-postgres.sh" || die "backup uploader hook is missing"
rg -q 'api\.cloudinary\.com/v1_1/.*/raw/upload' "$root/upload-postgres-backup-cloudinary.sh" || die "Cloudinary raw backup upload is missing"
rg -q -- '--symmetric --cipher-algo AES256' "$root/upload-postgres-backup-cloudinary.sh" || die "backup encryption is missing"
rg -q 'downloaded encrypted backup checksum mismatch' "$root/upload-postgres-backup-cloudinary.sh" || die "off-instance round-trip verification is missing"
rg -q '^expected_uploaded_id=\$public_id\.gpg$' "$root/upload-postgres-backup-cloudinary.sh" || die "Cloudinary raw public-ID suffix contract is missing"
rg -q 'exec -T --user postgres postgres' "$root/backup-postgres.sh" || die "backup does not use the local PostgreSQL administrator contract"
rg -q '^Unit=saveswitch-cleanup.service$' "$root/saveswitch-cleanup.timer" || die "cleanup timer unit mismatch"
rg -q '^Unit=saveswitch-backup.service$' "$root/saveswitch-backup.timer" || die "backup timer unit mismatch"

# `docker compose config` is YAML interpolation/structure validation only; it
# does not pull an image or contact a Docker daemon. It is optional so static
# validation still works before Docker is installed on a deployment host.
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' EXIT HUP INT TERM
  : >"$scratch/postgres-password"
  : >"$scratch/postgres-server.crt"
  : >"$scratch/postgres-server.key"
  : >"$scratch/api.env"
  mkdir "$scratch/postgres-data"
  cat >"$scratch/runtime.env" <<EOF
RUNTIME_DIR=$scratch
SAVESWITCH_API_IMAGE=example.invalid/saveswitch-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
POSTGRES_IMAGE=postgres:18.0-bookworm@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
POSTGRES_DATA_DIR=$scratch/postgres-data
POSTGRES_PASSWORD_FILE=$scratch/postgres-password
API_ENV_FILE=$scratch/api.env
POSTGRES_TLS_CERT_FILE=$scratch/postgres-server.crt
POSTGRES_TLS_KEY_FILE=$scratch/postgres-server.key
EOF
  docker compose --project-directory "$root" --env-file "$scratch/runtime.env" config --quiet || die "docker compose config failed"
fi

echo "runtime validation: PASS"
