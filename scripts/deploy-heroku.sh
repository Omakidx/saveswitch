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
  config   Push config vars from .env.local to Heroku
  api      Build, push, and release the API app
  web      Build, push, and release the web app
  schema   Push the Drizzle schema to DATABASE_URL
  smoke    Run basic production checks
  all      Run config, api, web, and smoke

The script reads credentials from the root .env.local file.
EOF
}

load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE" >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

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

create_apps() {
  need_tool heroku
  require_common_env

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
  need_tool docker
  need_tool heroku
  require_api_env

  docker build \
    -f "$ROOT_DIR/server/Dockerfile" \
    -t "registry.heroku.com/$API_APP/web" \
    "$ROOT_DIR/server"

  docker push "registry.heroku.com/$API_APP/web"
  heroku container:release web --app "$API_APP"
}

deploy_web() {
  need_tool docker
  need_tool heroku
  require_web_env

  docker build \
    -f "$ROOT_DIR/client/Dockerfile" \
    --build-arg NEXT_PUBLIC_API_BASE="$API_URL" \
    --build-arg NEXT_PUBLIC_API_URL="$PUBLIC_API_URL" \
    --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID="$PUBLIC_GOOGLE_CLIENT_ID" \
    -t "registry.heroku.com/$WEB_APP/web" \
    "$ROOT_DIR/client"

  docker push "registry.heroku.com/$WEB_APP/web"
  heroku container:release web --app "$WEB_APP"
}

push_schema() {
  need_tool bun
  require_var DATABASE_URL

  (
    cd "$ROOT_DIR/server"
    bunx drizzle-kit push
  )
}

smoke_test() {
  need_tool heroku
  require_common_env

  heroku ps --app "$API_APP"
  heroku ps --app "$WEB_APP"

  if command -v curl >/dev/null 2>&1; then
    curl "$API_URL/health"
    echo
  else
    echo "curl is not installed; open $API_URL/health manually."
  fi

  echo "Web app: $WEB_URL"
}

main() {
  if [ "$ACTION" = "-h" ] || [ "$ACTION" = "--help" ]; then
    usage
    exit 0
  fi

  load_env

  case "$ACTION" in
    create)
      create_apps
      ;;
    config)
      push_config
      ;;
    api)
      deploy_api
      ;;
    web)
      deploy_web
      ;;
    schema)
      push_schema
      ;;
    smoke)
      smoke_test
      ;;
    all)
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
