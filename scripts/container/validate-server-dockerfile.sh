#!/usr/bin/env bash
# Static contract checks only. This script never invokes Docker or resolves an
# image, so it is safe to run where the registry or daemon is unavailable.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dockerfile="$repo_root/server/Dockerfile"
dockerignore="$repo_root/server/.dockerignore"
base='oven/bun:1.3.14@sha256:50317d83cd5a5ae1d8b35b3379c69f57ce1a0dbf4def91f0965653d767851834'

test "$(grep -Fxc "FROM $base AS dependencies" "$dockerfile")" -eq 1
test "$(grep -Fxc "FROM $base AS runtime" "$dockerfile")" -eq 1
grep -Fqx 'RUN bun install --frozen-lockfile --production' "$dockerfile"
test "$(grep -Fc 'bun install ' "$dockerfile")" -eq 1
grep -Fqx 'USER 10001:10001' "$dockerfile"
grep -Fqx 'RUN chmod 1777 /tmp' "$dockerfile"
grep -Fqx 'EXPOSE 5000' "$dockerfile"
grep -Fqx 'CMD ["bun", "src/index.ts"]' "$dockerfile"
grep -Fq 'NODE_ENV=production' "$dockerfile"
grep -Fq 'PORT=5000' "$dockerfile"
grep -Fq 'TMPDIR=/tmp' "$dockerfile"
grep -Fqx 'COPY --chown=0:0 --from=dependencies /app/node_modules ./node_modules' "$dockerfile"
grep -Fqx 'COPY --chown=0:0 package.json bun.lock tsconfig.json ./' "$dockerfile"
grep -Fq 'COPY --chown=0:0 src ./src' "$dockerfile"
! grep -Eq '^[[:space:]]*HEALTHCHECK[[:space:]]' "$dockerfile"

for ignored_path in node_modules/ .env '.env.*' '*.env' .git/ '*.orig' '*.map' \
  '*.data' data/ \
  .saveswitch-dev-db/ '*.db' '*.sqlite' '*.sqlite3' '*.dump' '*.backup' \
  '*.sql' neon.db.md 'src/**/*.test.ts' .terraform/ .terraform.lock.hcl \
  '*.tfstate' '*.tfplan' '*.tfvars' '*.tfvars.json'; do
  grep -Fqx "$ignored_path" "$dockerignore"
done

printf '%s\n' 'server Dockerfile static contract: PASS'
