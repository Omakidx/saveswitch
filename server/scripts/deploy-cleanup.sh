#!/usr/bin/env bash
# Deploy the nightly cleanup cron (Railway service `saveswitch-cleanup`).
#
# The cron's start command, schedule (03:30 UTC) and restart policy live in the
# Railway service settings. server/railway.json belongs to the API (Dockerfile.railway,
# /ready healthcheck, restarts), and Railway applies it to any service deployed from
# this folder, so upload a copy of server/ without it. The cron builds from Dockerfile.
set -euo pipefail

server_dir="$(cd "$(dirname "$0")/.." && pwd)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

tar -C "$server_dir" \
  --exclude=./node_modules --exclude=./railway.json --exclude=./Dockerfile.railway \
  --exclude=./railway-start.ts -cf - . | tar -C "$staging" -xf -

cd "$server_dir/.."  # the Railway project is linked at the repo root
railway up "$staging" --path-as-root --service saveswitch-cleanup --ci "$@"
