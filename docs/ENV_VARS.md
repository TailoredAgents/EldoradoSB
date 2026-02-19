# Environment variables

## Web

- `APP_PASSWORD` (required): password gate for the site.
- `SESSION_SECRET` (optional): if omitted, `APP_PASSWORD` is used for signing sessions.
- `DATABASE_URL` (required): Postgres connection string.

## Worker

- `DATABASE_URL` (required)
- `X_BEARER_TOKEN` (required for X discovery/sampling)
- `OPENAI_API_KEY` (optional; if missing, analysis/drafts are skipped)
- `MODEL_EXTRACT` (optional; default `gpt-5-mini`)
- `MODEL_RANK` (optional; default `gpt-5.2`)
- `MODEL_WRITE` (optional; default `MODEL_RANK`)

## Notes

- Budget caps live in the DB `settings` row and can be edited in the web UI.

