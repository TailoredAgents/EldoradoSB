# El Dorado SB Outreach Agent — Build Phases

## Status

This document describes the original phased build-out for the legacy prospect pipeline.

The project has since pivoted to a depositor-first funnel (X outbound engagement → inbound LINK DMs → tracked links, plus optional Reddit feeder).

For day-to-day operations and the current system behavior, use `docs/RUNBOOK.md`.

This document breaks the project into phased milestones with concrete deliverables and “done” criteria. It complements `PROJECT_SPEC.md`.

## Phase 0 — Foundation (repo + conventions)

**Goal:** start clean, make local/dev/prod predictable.

**Deliverables**
- Repo scaffold for a Next.js app + worker code in the same repo.
- Basic docs: how to run locally, required env vars, and how deploy works on Render.

**Tasks**
- Choose package manager (`npm` or `pnpm`) and Node version policy.
- Add `.gitignore`, `.env.example`, and minimal README.
- Decide code layout (recommended):
  - `apps/web` (Next.js)
  - `apps/worker` (cron/worker entrypoint)
  - `packages/shared` (schemas, DB types, scoring helpers)
- Add formatting/linting only if you want it (keep minimal).

**Done when**
- A new dev can run the web app locally and load a placeholder page.

## Phase 1 — Database + core entities

**Goal:** create the data backbone for prospects, statuses, usage, and notes.

**Deliverables**
- Postgres schema + migrations (Prisma recommended).
- Seed/admin utilities as needed.

**Tasks**
- Create tables from `PROJECT_SPEC.md` (MVP):
  - `prospects`, `post_samples`, `score_history`, `outreach_events`, `settings`, `usage_ledger`
- Add idempotency constraints:
  - unique keys on `x_user_id`, `post_id`, and `(prospect_id, computed_at)` or “inputs hash”
- Add “kill switch” default row in `settings`.

**Done when**
- You can create/read/update a prospect and move it across statuses in DB.

## Phase 2 — Web app: login + navigation + CRUD

**Goal:** a usable internal tool even before the agent is “smart”.

**Deliverables**
- Simple password login gate (`APP_PASSWORD`) + signed cookie session.
- UI skeleton with the main tabs and basic tables.

**Tasks**
- Pages:
  - `/login`
  - `/outreach-today`
  - `/prospects` (New/In Progress/Done filters)
  - `/prospects/[id]` (detail + notes + status changes)
  - `/templates`
  - `/usage`
  - `/settings` (kill switch, caps, disclaimer text)
- Actions:
  - Status transitions
  - Assign owner (Devon)
  - Add notes + follow-up date
  - Copy-to-clipboard buttons and “open on X” links

**Done when**
- Devon can log in, browse prospects, update statuses, and record notes.

## Phase 3 — Worker skeleton (no X, no LLM yet)

**Goal:** the “daily trickle” engine exists, is safe, and is observable.

**Deliverables**
- Worker entrypoint that runs on a schedule and writes a trace + usage counters.
- Guardrails implemented in code (not prompts):
  - per-run caps
  - per-day caps
  - backoff/retry framework
  - kill switch honored immediately

**Tasks**
- Implement a run loop:
  - load settings
  - check usage budget
  - execute steps (stubbed)
  - write `usage_ledger` + trace record
- Add “dry run” mode for safe testing.

**Done when**
- You can schedule it and see “runs” recorded without touching external APIs.

## Phase 4 — X API integration (discovery/enrich/sample)

**Goal:** pull real candidates and store them deterministically and cheaply.

**Deliverables**
- X API client wrapper with:
  - request pacing (concurrency=1)
  - rate limit header handling
  - robust retries for 429/5xx
  - caching (don’t re-spend reads)
- Discovery query rotation implemented (from `PROJECT_SPEC.md`).

**Tasks**
- Implement tools:
  - `searchPosts(query, limit)`
  - `getUsers(userIds[])`
  - `getRecentPosts(userId, limit)`
- Persist:
  - discovery posts (lightweight)
  - new prospects + profile cache
  - post samples for shortlisted prospects

**Done when**
- The worker can populate `New` with real prospects and show them in the UI.

## Phase 5 — LLM: Analyzer step (features + scoring + rationale)

**Goal:** convert raw text/posts into structured features + scores and make rankings meaningful.

**Deliverables**
- Analyzer step (Structured Outputs) that produces:
  - `AnalysisFeatures`
  - `Score` (performance/acceptance/overall + tier)
  - short rationale bullets (“why”)
- Model routing and budgets:
  - `MODEL_EXTRACT` for most analysis
  - `MODEL_RANK` for borderline/high-impact candidates only

**Tasks**
- Define schemas in code and validate strictly.
- Store features + scores + rationale to DB and append `score_history`.
- Add safeguards:
  - if the model output fails schema validation, mark candidate “needs review” and skip queueing.

**Done when**
- The “New” list is meaningfully ranked and each prospect has clear “why” bullets.

## Phase 6 — Queue policy + Writer step (Outreach Today = 20/day)

**Goal:** produce a high-signal daily queue and give Devon great drafts.

**Deliverables**
- Deterministic queue builder (12/6/2 mix + diversity caps).
- Writer step that generates DM/email drafts with disclaimer block (assist-only).

**Tasks**
- Implement queue rules as code:
  - thresholds
  - diversity caps
  - exclude contacted/done/dnc
- Generate drafts only for queued items.
- UI polish for queue workflow (fast actions, keyboard-friendly if desired).

**Done when**
- Every day, the app shows exactly 20 queued prospects with DM/email drafts ready.

## Phase 7 — Refresh, de-dupe, and resilience

**Goal:** keep lists fresh without wasting post reads, and keep the system stable.

**Deliverables**
- Periodic refresh scheduler for `New/In Progress`.
- Dedupe strategy (handle changes, similar accounts, repeat discovery).
- Better failure handling: partial runs are safe and idempotent.

**Tasks**
- Add refresh policy (round-robin; small daily budget).
- Handle renamed handles (track by user id).
- (Optional) embeddings-based similarity clustering for diversity caps.

**Done when**
- The worker runs continuously without ballooning API usage and without duplicate spam.

## Phase 8 — Outcome tracking + learning loop

**Goal:** improve quality automatically using Devon’s outcomes.

**Deliverables**
- Outcome logging UI (reply/signed/deposits if you import them).
- Weekly report page: acceptance rate, signed/week, best queries, best archetypes.
- Weight tuning:
  - adjust query rotation by yield
  - adjust scoring weights using observed outcomes

**Tasks**
- Add structured outcome fields to `outreach_events`.
- Compute funnel metrics.
- Implement query replacement workflow (swap bottom 30% weekly).

**Done when**
- The system measurably improves over time (higher acceptance and/or better deposits per outreach).

## Phase 9 — Deployment hardening (Render)

**Goal:** a “set it and forget it” deployment with safe rollouts.

**Deliverables**
- Render service definitions (web + worker + postgres).
- Secrets/env var management and runbook.

**Tasks**
- Document required env vars:
  - `APP_PASSWORD`
  - `DATABASE_URL`
  - X credentials/tokens
  - OpenAI API key + model names (`MODEL_EXTRACT`, `MODEL_RANK`, optional `MODEL_EMBED`)
  - budget caps
- Add a safe migration workflow for prod.

**Done when**
- Deploy is one-click and rollback is straightforward; kill switch works in prod.

