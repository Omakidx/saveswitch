#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"
ACTION="${1:-all}"

usage() {
  cat <<'EOF'
Usage: bash scripts/deploy-heroku.sh <action>

Actions:
  create   Create Heroku apps and set the container stack
  preflight Validate the production environment contract without changing Heroku
  config   Push config vars from .env.local to Heroku
  api      Push the server subtree for a Heroku remote container build
  web      Push the client subtree for a Heroku remote container build
  schema   Push the Drizzle schema to DATABASE_URL
  smoke    Run API and web production checks
  release  Run preflight, api, web, and smoke using existing Heroku config
  all      Run preflight, config, api, web, and smoke

Only config reads secrets from the root .env.local file. Other actions read the
existing non-secret release contract from Heroku and never print secret values.
Run schema separately after a reviewed backup;
schema changes are intentionally not included in all.
EOF
}

load_local_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE; only the config action requires a local secrets file." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

initialize_context() {
  API_APP="${HEROKU_API_APP:-saveswitch-api}"
  WEB_APP="${HEROKU_WEB_APP:-saveswitch-web}"
  API_URL="${NEXT_PUBLIC_API_BASE:-}"
  API_URL="${API_URL%/}"
  WEB_URL="${CLIENT_ORIGIN:-}"
  WEB_URL="${WEB_URL%/}"
  PUBLIC_GOOGLE_CLIENT_ID="${NEXT_PUBLIC_GOOGLE_CLIENT_ID:-${GOOGLE_CLIENT_ID:-}}"
  PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-$API_URL}"
}

need_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required CLI: $1" >&2
    exit 1
  fi
}

require_var() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    echo "Missing required value: $name" >&2
    exit 1
  fi
}

require_common_env() {
  require_var API_APP
  require_var WEB_APP
  require_var API_URL
  require_var WEB_URL
}

require_api_env() {
  require_common_env
  require_var DATABASE_URL
  require_var JWT_SECRET
  require_var GOOGLE_CLIENT_ID
  require_var GOOGLE_CLIENT_SECRET
  require_var GOOGLE_REDIRECT_URI
  require_var CLOUDINARY_URL
}

require_web_env() {
  require_common_env
  require_var PUBLIC_GOOGLE_CLIENT_ID
  require_var PUBLIC_API_URL
}

require_runtime_env() {
  require_common_env
  require_var GOOGLE_REDIRECT_URI
}

hydrate_runtime_contract() {
  need_tool heroku

  if [ -z "${API_URL:-}" ]; then
    API_URL="$(heroku config:get NEXT_PUBLIC_API_BASE --app "$WEB_APP")"
    API_URL="${API_URL%/}"
  fi

  if [ -z "${PUBLIC_API_URL:-}" ]; then
    PUBLIC_API_URL="$(heroku config:get NEXT_PUBLIC_API_URL --app "$WEB_APP")"
    PUBLIC_API_URL="${PUBLIC_API_URL%/}"
  fi

  if [ -z "${WEB_URL:-}" ]; then
    WEB_URL="$(heroku config:get CLIENT_ORIGIN --app "$API_APP")"
    WEB_URL="${WEB_URL%/}"
  fi

  if [ -z "${GOOGLE_REDIRECT_URI:-}" ]; then
    GOOGLE_REDIRECT_URI="$(heroku config:get GOOGLE_REDIRECT_URI --app "$API_APP")"
    GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI%/}"
  fi
}

require_heroku_config_key() {
  local app="$1"
  local key="$2"

  if ! heroku config --shell --app "$app" | sed 's/=.*//' | grep -Fxq "$key"; then
    echo "Missing required Heroku config key on $app: $key" >&2
    exit 1
  fi
}

require_https_url() {
  local name="$1"
  local value="$2"

  case "$value" in
    https://*) ;;
    *)
      echo "$name must be an https URL for production." >&2
      exit 1
      ;;
  esac

  if [[ "$value" =~ ^https://(localhost|127\.0\.0\.1)(:|/|$) ]]; then
    echo "$name must not point at a local development server." >&2
    exit 1
  fi
}

validate_production_contract() {
  hydrate_runtime_contract
  require_runtime_env
  require_https_url API_URL "$API_URL"
  require_https_url WEB_URL "$WEB_URL"
  require_https_url GOOGLE_REDIRECT_URI "$GOOGLE_REDIRECT_URI"

  if [ "$PUBLIC_API_URL" != "$API_URL" ]; then
    echo "NEXT_PUBLIC_API_URL must match NEXT_PUBLIC_API_BASE for this release." >&2
    exit 1
  fi

  if [ "$GOOGLE_REDIRECT_URI" != "$API_URL/auth/google/callback" ]; then
    echo "GOOGLE_REDIRECT_URI must be $API_URL/auth/google/callback." >&2
    exit 1
  fi
}

preflight() {
  need_tool git
  need_tool heroku
  validate_production_contract

  test -f "$ROOT_DIR/server/Dockerfile"
  test -f "$ROOT_DIR/client/Dockerfile"
  git -C "$ROOT_DIR" rev-parse --verify HEAD >/dev/null
  heroku apps:info --app "$API_APP" >/dev/null
  heroku apps:info --app "$WEB_APP" >/dev/null
  require_heroku_config_key "$API_APP" DATABASE_URL
  require_heroku_config_key "$API_APP" JWT_SECRET
  require_heroku_config_key "$API_APP" GOOGLE_CLIENT_ID
  require_heroku_config_key "$API_APP" GOOGLE_CLIENT_SECRET
  require_heroku_config_key "$API_APP" CLOUDINARY_URL

  if ! grep -Fq "NEXT_PUBLIC_API_BASE: $API_URL" "$ROOT_DIR/client/heroku.yml" ||
    ! grep -Fq "NEXT_PUBLIC_API_URL: $PUBLIC_API_URL" "$ROOT_DIR/client/heroku.yml"; then
    echo "client/heroku.yml does not match the active public API URL contract." >&2
    exit 1
  fi

  echo "Preflight passed for $API_APP and $WEB_APP."
}

create_apps() {
  need_tool heroku

  heroku create "$API_APP" --stack container || heroku stack:set container --app "$API_APP"
  heroku create "$WEB_APP" --stack container || heroku stack:set container --app "$WEB_APP"
}

push_config() {
  need_tool heroku
  require_api_env
  require_web_env

  heroku config:set --app "$API_APP" \
    DATABASE_URL="$DATABASE_URL" \
    CLIENT_ORIGIN="$WEB_URL" \
    JWT_SECRET="$JWT_SECRET" \
    GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
    GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
    GOOGLE_REDIRECT_URI="$GOOGLE_REDIRECT_URI" \
    CLOUDINARY_URL="$CLOUDINARY_URL" >/dev/null

  if [ -n "${CLOUDINARY_UPLOAD_FOLDER:-}" ]; then
    heroku config:set --app "$API_APP" CLOUDINARY_UPLOAD_FOLDER="$CLOUDINARY_UPLOAD_FOLDER" >/dev/null
  fi

  if [ -n "${CLOUDINARY_RESOURCE_FOLDER:-}" ]; then
    heroku config:set --app "$API_APP" CLOUDINARY_RESOURCE_FOLDER="$CLOUDINARY_RESOURCE_FOLDER" >/dev/null
  fi

  heroku config:set --app "$WEB_APP" \
    NEXT_PUBLIC_API_BASE="$API_URL" \
    NEXT_PUBLIC_API_URL="$PUBLIC_API_URL" \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID="$PUBLIC_GOOGLE_CLIENT_ID" >/dev/null

  echo "Config vars pushed for $API_APP and $WEB_APP."
}

deploy_api() {
  need_tool git
  need_tool heroku
  validate_production_contract

  git -C "$ROOT_DIR" subtree push --prefix server "https://git.heroku.com/$API_APP.git" main
  smoke_api
}

deploy_web() {
  need_tool git
  need_tool heroku
  validate_production_contract

  git -C "$ROOT_DIR" subtree push --prefix client "https://git.heroku.com/$WEB_APP.git" main
  smoke_web
}

push_schema() {
  need_tool bun
  need_tool heroku
  if [ -z "${DATABASE_URL:-}" ]; then
    DATABASE_URL="$(heroku config:get DATABASE_URL --app "$API_APP")"
    export DATABASE_URL
  fi
  require_var DATABASE_URL

  (
    cd "$ROOT_DIR/server"
    bunx drizzle-kit push
  )
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempt

  for attempt in $(seq 1 12); do
    if curl --fail --silent --show-error --max-time 15 "$url" >/dev/null; then
      echo "$label is healthy."
      return 0
    fi
    sleep 5
  done

  echo "$label did not become healthy at $url." >&2
  return 1
}

smoke_api() {
  need_tool heroku
  validate_production_contract

  heroku ps --app "$API_APP"

  if command -v curl >/dev/null 2>&1; then
    wait_for_url "$API_URL/health" "API"
  else
    echo "curl is not installed; open $API_URL/health manually."
  fi
}

smoke_web() {
  need_tool heroku
  validate_production_contract

  heroku ps --app "$WEB_APP"

  if command -v curl >/dev/null 2>&1; then
    wait_for_url "$WEB_URL/login" "Web app"
  else
    echo "curl is not installed; open $WEB_URL/login manually."
  fi
}

smoke_test() {
  smoke_api
  smoke_web
}

main() {
  if [ "$ACTION" = "-h" ] || [ "$ACTION" = "--help" ]; then
    usage
    exit 0
  fi

  case "$ACTION" in
    create)
      initialize_context
      create_apps
      ;;
    preflight)
      initialize_context
      preflight
      ;;
    config)
      load_local_env
      initialize_context
      push_config
      ;;
    api)
      initialize_context
      deploy_api
      ;;
    web)
      initialize_context
      deploy_web
      ;;
    schema)
      initialize_context
      push_schema
      ;;
    smoke)
      initialize_context
      smoke_test
      ;;
    release)
      initialize_context
      preflight
      deploy_api
      deploy_web
      smoke_test
      ;;
    all)
      load_local_env
      initialize_context
      preflight
      push_config
      deploy_api
      deploy_web
      smoke_test
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
