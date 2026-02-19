# El Dorado SB Outreach Agent

Internal app to discover, rank, and manage outreach to X sports accounts for ambassador recruitment.

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
