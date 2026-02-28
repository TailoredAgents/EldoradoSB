# Render deployment guide

This repo deploys as:
- **Web service**: Next.js app (`apps/web`)
- **Worker/Cron job**: Node worker (`apps/worker`) that runs the hourly loop (autopost + inbound auto-reply + outbound engagement; legacy prospect pipeline is optional)
- **Postgres**: Render Postgres

## 1) Create Postgres

1. Create a Render Postgres database.
2. Copy its `DATABASE_URL` connection string.

## 2) Create the Web service

Service type: **Web Service**

- Root directory: repo root
- Build command:
  - `npm install && npm run db:generate && npm run build:web`
- Start command:
  - `npm run start:web`

Render environment variables for the web service:
- `APP_PASSWORD`
- `SESSION_SECRET` (optional; if omitted, `APP_PASSWORD` is used for signing sessions)
- `DATABASE_URL`
- `X_OAUTH_CLIENT_ID` / `X_OAUTH_CLIENT_SECRET` (required for X connect + posting/DMs)
- `X_OAUTH_REDIRECT_URI` (required; `https://<web>/x/callback`)
- `X_CREDENTIALS_SECRET` (required; encrypts OAuth tokens stored in Postgres)

Recommended:
- Set `NODE_ENV=production` (Render usually sets this).

## 3) Create the Worker (cron)

Preferred: **Cron Job** (hourly loop).

- Root directory: repo root
- Build command:
  - `npm install && npm run db:generate`
- Start command:
  - `npm run run:worker`

Schedule recommendation:
- Every **60–120 minutes** (e.g., `0 * * * *` for hourly).

If you want max throughput, hourly is recommended.

Render environment variables for the worker:
- `DATABASE_URL`
- `X_BEARER_TOKEN`
- `OPENAI_API_KEY` (optional; if omitted, analyzer/writer steps are skipped)
- `MODEL_EXTRACT` (default in `.env.example`)
- `MODEL_RANK` (default in `.env.example`)
- `MODEL_WRITE` (default in `.env.example`)
- `X_OAUTH_CLIENT_ID` / `X_OAUTH_CLIENT_SECRET` / `X_OAUTH_TOKEN_URL` (required if the worker needs to refresh OAuth tokens)
- `X_CREDENTIALS_SECRET` (required if the worker needs to decrypt OAuth tokens)
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USERNAME` / `REDDIT_PASSWORD` (required only if Reddit module is enabled)
- `REDDIT_USER_AGENT` (recommended if Reddit module is enabled)

Optional tuning:
- Use the **X** page in the web UI to enable features + set caps (posts/day, outbound/day, outbound/run, usage guardrail).
- Use the **Settings** page in the web UI for global post-read caps and (optional) prospect pipeline toggle.

## 4) First-time database migration

You have two options:

**Option A (recommended): run migrations from your machine**
- Set `DATABASE_URL` to your Render Postgres URL.
- Run:
  - `npm install`
  - `npm run db:migrate:dev`
  - `npm run db:seed`

**Option B: run migrations as a one-off Render job**
- Create a temporary “one-off” service or shell into the worker environment.
- Run:
  - `npm run db:migrate:dev && npm run db:seed`

## 5) Verify in prod

1. Visit the web service URL → `/login` should load.
2. Log in with `APP_PASSWORD`.
3. Visit `/settings` and confirm the agent is enabled and caps look right.
4. Visit `/usage` and confirm worker runs appear after the first cron run.

## 6) Kill switch

If you need to stop spending money immediately:
- Set `enabled=false` in the web UI `Settings` page.

