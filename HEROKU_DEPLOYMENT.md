# Saveswitch - Heroku CLI Deployment Guide

## 1. Overview

This is the CLI-first Heroku deployment path for Saveswitch. It assumes the production credentials already live in the root `.env.local` file and that you want to deploy the current split app without moving code around.

Saveswitch should run as two Heroku apps:

| Heroku app | Repo path | Runtime | Role |
|------------|-----------|---------|------|
| `saveswitch-api` | `server/` | Bun + Elysia | REST API, Google OAuth callback, WebSocket sync, database access |
| `saveswitch-web` | `client/` | Bun + Next.js | UI, dashboard, Xoomshare pages, login/register |

The guide uses the Heroku CLI plus Heroku remote Docker builds. That fits this repo because both apps are Bun-first and live in subdirectories, and it does not require Docker to be installed locally. The repo now includes the deploy helper and container files:

| File | Purpose |
|------|---------|
| `scripts/deploy-heroku.sh` | Loads `.env.local`, pushes config vars, builds images, releases apps, and runs smoke checks. |
| `server/Dockerfile` | Builds the Bun/Elysia API image. |
| `client/Dockerfile` | Builds the Bun/Next.js web image with production `NEXT_PUBLIC_*` values. |
| `server/.dockerignore`, `client/.dockerignore` | Keeps local env files and build output out of container contexts. |

```
Browser
  │
  ├── CLIENT_ORIGIN
  │       Next.js web app
  │
  └── NEXT_PUBLIC_API_BASE
          Elysia API + WebSocket
                  │
                  ├── DATABASE_URL
                  └── CLOUDINARY_URL
```

Official references:

- Heroku Container Registry and Runtime: https://devcenter.heroku.com/articles/container-registry-and-runtime
- Heroku config vars: https://devcenter.heroku.com/articles/config-vars
- Heroku WebSockets: https://devcenter.heroku.com/articles/websockets
- Heroku Postgres: https://devcenter.heroku.com/articles/heroku-postgresql

---

## 2. `.env.local` Contract

The deployment commands below read from the root `.env.local` file. The current app already uses these variables:

| Variable | Used by | Purpose |
|----------|---------|---------|
| `CLIENT_ORIGIN` | API | Production web origin for CORS, for example `https://saveswitch-web.herokuapp.com`. |
| `NEXT_PUBLIC_API_BASE` | Web | Production API origin, for example `https://saveswitch-api.herokuapp.com`. |
| `NEXT_PUBLIC_API_URL` | Web | Optional alias. If missing, use `NEXT_PUBLIC_API_BASE`. |
| `JWT_SECRET` | API | Production JWT signing secret. |
| `GOOGLE_CLIENT_ID` | API | Google OAuth / One Tap audience. |
| `GOOGLE_CLIENT_SECRET` | API | Google OAuth secret. |
| `GOOGLE_REDIRECT_URI` | API | API callback URL, for example `https://saveswitch-api.herokuapp.com/auth/google/callback`. |
| `DATABASE_URL` | API, Drizzle | Neon or Heroku Postgres URL. |
| `CLOUDINARY_URL` | API | Cloudinary upload credentials. |

Optional additions for smoother CLI usage:

```bash
HEROKU_API_APP=saveswitch-api
HEROKU_WEB_APP=saveswitch-web
```

If `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is not set, the CLI helper derives it from `GOOGLE_CLIENT_ID`.

Do not set `PORT` on Heroku. Heroku injects it for each dyno.

---

## 3. Prerequisites

Install and verify the local tools:

```bash
heroku --version
bun --version
git --version
git status --short
```

Log in to Heroku and the container registry:

```bash
heroku login
heroku container:login
```

Load `.env.local` in your shell:

```bash
set -a
source .env.local
set +a

API_APP="${HEROKU_API_APP:-saveswitch-api}"
WEB_APP="${HEROKU_WEB_APP:-saveswitch-web}"
API_URL="${NEXT_PUBLIC_API_BASE%/}"
WEB_URL="${CLIENT_ORIGIN%/}"
PUBLIC_GOOGLE_CLIENT_ID="${NEXT_PUBLIC_GOOGLE_CLIENT_ID:-$GOOGLE_CLIENT_ID}"
```

Quickly verify that the deployment values are present without printing secrets:

```bash
test -n "$API_APP"
test -n "$WEB_APP"
test -n "$API_URL"
test -n "$WEB_URL"
test -n "$DATABASE_URL"
test -n "$JWT_SECRET"
test -n "$GOOGLE_CLIENT_ID"
test -n "$GOOGLE_CLIENT_SECRET"
test -n "$GOOGLE_REDIRECT_URI"
test -n "$CLOUDINARY_URL"
test -n "$PUBLIC_GOOGLE_CLIENT_ID"
```

---

## 4. Fast CLI Path

After the prerequisites are installed and you are logged in, the deploy can be run with the helper:

```bash
bash scripts/deploy-heroku.sh create
bash scripts/deploy-heroku.sh config
bash scripts/deploy-heroku.sh schema
bash scripts/deploy-heroku.sh all
```

What each command does:

| Command | Action |
|---------|--------|
| `create` | Creates both Heroku apps or sets the container stack if they already exist. |
| `config` | Pushes API and web config vars from `.env.local`. |
| `schema` | Runs `bunx drizzle-kit push` against `DATABASE_URL`. |
| `all` | Runs `config`, deploys API, deploys web, then runs smoke checks. |

Use the manual sections below when you want to inspect or run one step at a time.

---

## 5. Create Heroku Apps Manually

Create both apps with the container stack:

```bash
heroku create "$API_APP" --stack container
heroku create "$WEB_APP" --stack container
```

If either app already exists, set the stack instead:

```bash
heroku stack:set container --app "$API_APP"
heroku stack:set container --app "$WEB_APP"
```

---

## 6. Push Config Vars From `.env.local`

Set API config vars:

```bash
heroku config:set --app "$API_APP" \
  DATABASE_URL="$DATABASE_URL" \
  CLIENT_ORIGIN="$WEB_URL" \
  JWT_SECRET="$JWT_SECRET" \
  GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
  GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
  GOOGLE_REDIRECT_URI="$GOOGLE_REDIRECT_URI" \
  CLOUDINARY_URL="$CLOUDINARY_URL"
```

Optional Cloudinary folders:

```bash
if [ -n "${CLOUDINARY_UPLOAD_FOLDER:-}" ]; then
  heroku config:set --app "$API_APP" CLOUDINARY_UPLOAD_FOLDER="$CLOUDINARY_UPLOAD_FOLDER"
fi

if [ -n "${CLOUDINARY_RESOURCE_FOLDER:-}" ]; then
  heroku config:set --app "$API_APP" CLOUDINARY_RESOURCE_FOLDER="$CLOUDINARY_RESOURCE_FOLDER"
fi
```

Set web config vars:

```bash
heroku config:set --app "$WEB_APP" \
  NEXT_PUBLIC_API_BASE="$API_URL" \
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-$API_URL}" \
  NEXT_PUBLIC_GOOGLE_CLIENT_ID="$PUBLIC_GOOGLE_CLIENT_ID"
```

Confirm names only:

```bash
heroku config --shell --app "$API_APP" | sed 's/=.*//'
heroku config --shell --app "$WEB_APP" | sed 's/=.*//'
```

---

## 7. Google OAuth Checklist

In Google Cloud Console, the OAuth client must match the production URLs:

| Google setting | Value |
|----------------|-------|
| Authorized JavaScript origin | `CLIENT_ORIGIN` |
| Authorized redirect URI | `GOOGLE_REDIRECT_URI` |

For Heroku default domains that usually means:

| Setting | Example |
|---------|---------|
| Authorized JavaScript origin | `https://saveswitch-web.herokuapp.com` |
| Authorized redirect URI | `https://saveswitch-api.herokuapp.com/auth/google/callback` |

If OAuth fails with a redirect mismatch, fix Google Cloud Console first, then update `.env.local`, then rerun section 6.

---

## 8. Container Files

These files are already present in the repo. Keep them committed so the CLI deployment stays repeatable.

### 8.1 `server/Dockerfile`

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

CMD ["bun", "src/index.ts"]
```

The API already binds to Heroku's dynamic port:

```ts
.listen(Number(process.env.PORT) || 5000)
```

### 8.2 `client/Dockerfile`

```dockerfile
FROM oven/bun:1

WORKDIR /app

ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID

ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

CMD bun --bun next start -p ${PORT:-5173}
```

Use this `CMD` instead of the current `client/package.json` `start` script on Heroku. The package script points to `../.env.local` and hardcodes port `5173`, while Heroku requires the app to listen on `$PORT`.

### 8.3 Docker Ignore Files

`server/.dockerignore`:

```gitignore
node_modules
.env
.env.*
*.log
```

`client/.dockerignore`:

```gitignore
node_modules
.next
.env
.env.*
*.log
```

---

## 9. Deploy With Heroku CLI Manually

Make sure `.env.local` is still loaded in the current shell:

```bash
test -n "$API_APP"
test -n "$WEB_APP"
test -n "$API_URL"
test -n "$PUBLIC_GOOGLE_CLIENT_ID"
```

Make sure the deployment files are committed before pushing subtrees:

```bash
git status --short
```

Deploy the API with a Heroku remote Docker build:

```bash
git subtree push --prefix server "https://git.heroku.com/$API_APP.git" main
```

Deploy the web app with a Heroku remote Docker build:

```bash
git subtree push --prefix client "https://git.heroku.com/$WEB_APP.git" main
```

Why `client/heroku.yml` matters: `NEXT_PUBLIC_*` values are compiled into the Next.js client bundle. If `NEXT_PUBLIC_API_BASE` changes, update `client/heroku.yml`, commit it, and redeploy the web app.

---

## 10. Database Schema

The API uses Drizzle with:

| File | Purpose |
|------|---------|
| `server/src/db/schema.ts` | Database schema |
| `server/drizzle/` | Migration SQL |
| `server/drizzle.config.ts` | Drizzle config |

Apply the schema to the production database from the CLI:

```bash
set -a
source .env.local
set +a

cd server
bunx drizzle-kit push
```

This uses `DATABASE_URL` from `.env.local`. Treat this as a production database change: review schema diffs and take a backup before applying risky changes.

If you decide to use Heroku Postgres instead of Neon:

```bash
heroku addons:plans heroku-postgresql
heroku addons:create heroku-postgresql:<plan-name> --app "$API_APP"
heroku config:get DATABASE_URL --app "$API_APP"
```

Then copy that `DATABASE_URL` back into `.env.local` and rerun the API config command in section 6.

---

## 11. Smoke Test

After each deploy:

```bash
heroku ps --app "$API_APP"
heroku ps --app "$WEB_APP"
curl "$API_URL/health"
heroku open --app "$WEB_APP"
```

Manual checks:

| Check | Expected result |
|-------|-----------------|
| API health | `/health` returns `{"status":"ok", ...}`. |
| Web app | Login/register page renders. |
| CORS | Creating a Xoomshare room has no browser CORS error. |
| OAuth | Google login redirects back to `GOOGLE_REDIRECT_URI`. |
| WebSocket | Opening one Xoomshare room in two tabs syncs new resources. |
| Uploads | Image resources upload to Cloudinary and survive refresh. |
| Public profile | `/@username` loads public pages/resources. |

Useful logs:

```bash
heroku logs --tail --app "$API_APP"
heroku logs --tail --app "$WEB_APP"
```

Rollback:

```bash
heroku rollback --app "$API_APP"
heroku rollback --app "$WEB_APP"
```

---

## 12. Scaling Notes

Start simple:

```bash
heroku ps:scale web=1 --app "$API_APP"
heroku ps:scale web=1 --app "$WEB_APP"
```

Keep the API at one dyno for launch unless you add shared pub/sub. WebSocket room subscriptions currently live inside one API process, so multiple API dynos can split room events across processes.

Before scaling the API above one dyno:

| Concern | Why |
|---------|-----|
| WebSocket fanout | Add Redis, Postgres NOTIFY/LISTEN, or another shared pub/sub layer. |
| Cleanup timers | Each API dyno runs the Xoomshare cleanup interval. |
| Rate limiting | Shared limits need shared storage. |

The web app is easier to scale horizontally because it does not own room state.

---

## 13. Common Failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| API crashes on boot | Missing `DATABASE_URL` | Reload `.env.local`, rerun section 6, inspect `heroku logs --tail --app "$API_APP"`. |
| Browser CORS error | `CLIENT_ORIGIN` does not equal the web origin | Update `.env.local`, rerun API config, restart API. |
| Google redirect mismatch | Google Console and `GOOGLE_REDIRECT_URI` disagree | Update Google Console and rerun section 6. |
| One Tap missing | Missing `NEXT_PUBLIC_GOOGLE_CLIENT_ID` at build time | Reload env, rebuild, redeploy the web image. |
| Client calls localhost | Web image was built without the production API URL | Update `client/heroku.yml`, commit it, and redeploy web. |
| Next app fails to bind | It is not listening on Heroku's `$PORT` | Use the Docker `CMD` from section 8.2. |
| Image upload fails | Cloudinary value is wrong or lacks upload permission | Verify `CLOUDINARY_URL` and API key permissions. |
| WebSocket sync works in one tab but not another user/session | API was scaled across dynos without shared pub/sub | Scale API back to one dyno or add shared fanout. |

---

## 14. Release Checklist

- [ ] `.env.local` has production values.
- [ ] `HEROKU_API_APP` and `HEROKU_WEB_APP` are set or you are using the default app names.
- [ ] Heroku CLI is logged in.
- [ ] Heroku browser login succeeded.
- [ ] Heroku config vars were pushed from `.env.local`.
- [ ] Google OAuth origin and redirect URI match production.
- [ ] `server/Dockerfile` and `client/Dockerfile` exist.
- [ ] Database schema has been applied.
- [ ] API image was built, pushed, and released.
- [ ] Web image was built with production `NEXT_PUBLIC_*` values, pushed, and released.
- [ ] `/health` returns `ok`.
- [ ] Login, Xoomshare, WebSocket sync, and uploads pass smoke testing.

---

## 15. CLI Helper Reference

The deploy helper supports focused actions:

```bash
bash scripts/deploy-heroku.sh create
bash scripts/deploy-heroku.sh config
bash scripts/deploy-heroku.sh api
bash scripts/deploy-heroku.sh web
bash scripts/deploy-heroku.sh schema
bash scripts/deploy-heroku.sh smoke
bash scripts/deploy-heroku.sh all
```

The script does the same core work as the manual sections:

1. Load `.env.local`.
2. Derive `API_APP`, `WEB_APP`, `API_URL`, `WEB_URL`, and `PUBLIC_GOOGLE_CLIENT_ID`.
3. Push Heroku config vars.
4. Push the selected subtree so Heroku builds and releases the image remotely.
5. Run the smoke-test commands.
