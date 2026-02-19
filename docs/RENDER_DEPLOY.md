# Render deployment guide

This repo deploys as:
- **Web service**: Next.js app (`apps/web`)
- **Worker/Cron job**: Node worker (`apps/worker`) that runs the trickle loop (discover → sample → analyze → queue → drafts)
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

Recommended:
- Set `NODE_ENV=production` (Render usually sets this).

## 3) Create the Worker (cron)

Preferred: **Cron Job** (daily trickle via schedule).

- Root directory: repo root
- Build command:
  - `npm install && npm run db:generate`
- Start command:
  - `npm run run:worker`

Schedule recommendation:
- Every **60–120 minutes** (e.g., `0 * * * *` for hourly).

Render environment variables for the worker:
- `DATABASE_URL`
- `X_BEARER_TOKEN`
- `OPENAI_API_KEY` (optional; if omitted, analyzer/writer steps are skipped)
- `MODEL_EXTRACT` (default in `.env.example`)
- `MODEL_RANK` (default in `.env.example`)
- `MODEL_WRITE` (default in `.env.example`)

Optional tuning:
- Use the **Settings** page in the web UI for queue counts + post caps.

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

