# Runbook

## Common operations

**Pause the agent**
- UI: `Settings` → uncheck **Enabled**.

**Resume the agent**
- UI: `Settings` → check **Enabled**.

**Adjust throughput + spend (primary knobs)**
- UI: `X` → tune:
  - `Max outbound/day` (target comment replies/day)
  - `Max outbound/run` (hourly pacing)
  - `Max posts consumed/day (UTC)` (pay-per-use guardrail)
- UI: `Settings` → tune:
  - `maxPostReadsPerRun` / `maxPostReadsPerDay` (internal read budget safety cap)

**Troubleshoot**
- UI: `Usage` → check recent worker runs and statuses.
- If worker is erroring: check Render logs for the worker service.

## What the agent does (depositor-first)

1. **Auto-posts** up to 6/day (ET schedule) to look legitimate (mix of promos + normal content).
2. **Outbound engagement**: replies under high-intent threads and asks users to DM `LINK PAYOUT`, `LINK PICKS`, or `LINK GEN`.
3. **Inbound auto-reply**:
   - Mentions: tells users to DM `LINK` (no public links).
   - DMs: sends a tracked signup link (when `publicBaseUrl` is set) and logs attribution by bucket.
4. **Reporting**: `Reports` shows outbound → LINK DMs → clicks, plus a manual weekly deposits log.
5. **Legacy prospect pipeline** (optional): discovery/scoring/drafts; disabled by default in `Settings`.

## Recommended ramp schedule (hourly cron)

Goal: get to ~200 outbound replies/day without triggering restrictions.

- Days 1–2:
  - `Max outbound/day`: 80–120
  - `Max outbound/run`: 6–8
  - `Max posts consumed/day (UTC)`: set a conservative cap (start low, raise once you see real costs)
- Days 3–5:
  - `Max outbound/day`: 150
  - `Max outbound/run`: 8–10
- Day 6+:
  - `Max outbound/day`: 200
  - `Max outbound/run`: 10

If your cron runs hourly, a rough pacing guide is:
- `Max outbound/day = 200` and `Max outbound/run = 10` (up to ~240/day possible, so daily cap remains the limiter).

## How to tune `Max posts consumed/day (UTC)`

This uses X’s usage endpoint (`/2/usage/tweets`) to throttle when you hit your configured cap.

Recommended process:
1. Set a low cap for 24 hours.
2. Check X billing/usage and your actual $ spend.
3. Increase in small steps until you’re near your desired spend/day.

Notes:
- The cap is **UTC day**; your posting/outbound schedule is ET.
- If you want the system to keep running even after the cap, leave it blank (no guardrail).

## What to reduce first (if X starts restricting you)

Symptoms: sudden outbound errors, replies failing, or reduced reach.

Reduce in this order:
1. `Max outbound/run` (spreads activity out)
2. `Max outbound/day`
3. `Max posts/day` (autopost)
4. Disable features temporarily in `X`:
   - turn off **Outbound engagement**
   - turn off **Auto-reply**
   - (last) turn off **Enabled**

## Database migrations

This repo stores SQL migrations in `prisma/migrations/*/migration.sql`.

Recommended approach:
- Local dev: `npm run db:migrate:dev`
- Render/prod: `npm run db:migrate:deploy`

Commands:
- `npm run db:generate`
- `npm run db:migrate:dev` (dev)
- `npm run db:migrate:deploy` (prod)
- `npm run db:seed`

## Emergency stop checklist

1. Disable agent: `Settings.enabled=false`
2. (Optional) Disable/unschedule the Render cron
3. Rotate tokens if needed:
   - `X_BEARER_TOKEN`
   - `OPENAI_API_KEY`

## Weekly results (manual learning loop)

If the sportsbook provider cannot attribute deposits automatically yet, log outcomes manually so the system can learn:

Preferred (depositor-first):
1. Open `Reports`.
2. Under **Manual weekly deposits**, enter a week + tier (or campaign) + depositor/deposit totals.
3. Use the **Depositor funnel (X)** table to see what’s working (outbound → LINK DMs → clicks).

Legacy (ambassador pipeline):
1. Open the signed ambassador prospect in the web UI.
2. In **Log outreach**, set **Event** to `weekly_results`.
3. Fill `depositors` and `depositsUsd` (optional) and add notes if useful.

