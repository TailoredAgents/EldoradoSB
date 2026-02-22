# Environment variables

## Web

- `APP_PASSWORD` (required): password gate for the site.
- `SESSION_SECRET` (optional): if omitted, `APP_PASSWORD` is used for signing sessions.
- `APP_TIME_ZONE` (optional): timezone for "today" boundaries (queue + usage). Default `America/New_York`.
- `DATABASE_URL` (required): Postgres connection string.
- `X_OAUTH_CLIENT_ID` (required for X autopost/DM): X OAuth client id.
- `X_OAUTH_CLIENT_SECRET` (optional): X OAuth client secret (if configured as a confidential client).
- `X_OAUTH_REDIRECT_URI` (required for X autopost/DM): callback URL (e.g., `https://<web>/x/callback`).
- `X_OAUTH_SCOPES` (optional): default includes tweet + dm read/write + offline access.
- `X_OAUTH_AUTHORIZE_URL` / `X_OAUTH_TOKEN_URL` (optional): override OAuth endpoints if needed.
- `X_CREDENTIALS_SECRET` (required for X autopost/DM): encrypts OAuth tokens stored in Postgres.

## Worker

- `DATABASE_URL` (required)
- `X_BEARER_TOKEN` (required for X discovery/sampling)
- `OPENAI_API_KEY` (optional; if missing, analysis/drafts are skipped)
- `MODEL_EXTRACT` (optional; default `gpt-5-mini`)
- `MODEL_RANK` (optional; default `gpt-5.2`)
- `MODEL_WRITE` (optional; default `MODEL_RANK`)
- `X_OAUTH_CLIENT_ID` / `X_OAUTH_CLIENT_SECRET` / `X_OAUTH_TOKEN_URL` (required if the worker needs to refresh OAuth tokens)
- `X_CREDENTIALS_SECRET` (required if the worker needs to decrypt OAuth tokens)
- `X_API_BASE_URL` (optional): default `https://api.x.com/2`

## Notes

- Budget caps live in the DB `settings` row and can be edited in the web UI.

