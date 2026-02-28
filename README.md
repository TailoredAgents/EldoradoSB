# El Dorado SB Outreach Agent

Internal tool that runs the Eldorado depositor-first acquisition loop:
auto-posting + outbound engagement (public replies) → inbound DMs (“LINK …”) → per-DM tracked links → reporting.

The legacy “prospect/ambassador discovery + scoring + drafts” pipeline still exists, but is optional/secondary.

## Docs
- `PROJECT_SPEC.md`
- `BUILD_PLAN.md`
- `docs/RENDER_DEPLOY.md`
- `docs/RUNBOOK.md`
- `docs/ENV_VARS.md`

## Requirements
- Node.js 20+ (see `.nvmrc`)

## Local dev
1) Install deps:
   - `npm install`
2) Run the web app:
   - `npm run dev:web`
3) (Optional) Run the worker stub:
   - `npm run dev:worker`

## Database (Phase 1+)
- Set `DATABASE_URL` in `.env` (see `.env.example`).
- Generate client: `npm run db:generate`
- Apply migrations (when DB is available): `npm run db:migrate:dev`
- Seed settings row: `npm run db:seed`

## Environment
- Copy `.env.example` to `.env` and fill in values as phases require.
