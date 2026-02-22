# Runbook

## Common operations

**Pause the agent**
- UI: `Settings` → uncheck **Enabled**.

**Resume the agent**
- UI: `Settings` → check **Enabled**.

**Adjust daily spend**
- UI: `Settings` → change `maxPostReadsPerRun` and `maxPostReadsPerDay`.

**Troubleshoot**
- UI: `Usage` → check recent worker runs and statuses.
- If worker is erroring: check Render logs for the worker service.

## Database migrations

This repo stores SQL migrations in `prisma/migrations/*/migration.sql`.

Recommended approach:
- Run migrations from your machine against Render Postgres using `DATABASE_URL`.

Commands:
- `npm run db:generate`
- `npm run db:migrate:dev`
- `npm run db:seed`

## Emergency stop checklist

1. Disable agent: `Settings.enabled=false`
2. (Optional) Disable/unschedule the Render cron
3. Rotate tokens if needed:
   - `X_BEARER_TOKEN`
   - `OPENAI_API_KEY`

## Weekly results (manual learning loop)

If the sportsbook provider cannot attribute deposits automatically yet, log outcomes manually so the system can learn:

1. Open the signed ambassador prospect in the web UI.
2. In **Log outreach**, set **Event** to `weekly_results`.
3. Fill `depositors` and `depositsUsd` (optional) and add notes if useful.
4. Use the **Reports** page to see top ambassadors and trends.

