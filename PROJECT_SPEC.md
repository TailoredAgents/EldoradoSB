# El Dorado SB Outreach Agent (PROJECT SPEC)

Private, Render-hosted, agentic system that discovers and ranks sports/betting accounts on X and produces a daily **Outreach Today (20)** queue with DM/email drafts (assist-only).

## 1) Goals & non-goals

**Goals**
- Daily: generate **40–80 new ranked prospects** and queue **20/day** for outreach.
- Make Devon fast: “why this pick”, contact methods, suggested DM/email, and a place to log outcomes/notes.
- Stay safe with X limits: **monthly post caps** + **per-second/per-window rate limits**.
- Operate with a hard **kill switch** and clear usage/budget visibility.

**Non-goals (MVP)**
- No automated sending of DMs/emails (assist-only).
- No “perfect” geo/age verification; store confidence + flag unknowns.

## 2) Hosting & services (Render)

- **Web:** Next.js + Tailwind (dark + gold “El Dorado” theme)
- **DB:** Render Postgres
- **Worker:** Render Cron/Worker running a “daily trickle” loop (small runs across the day)

## 3) App UX

**Login**
- Simple password gate (`APP_PASSWORD`) + signed session cookie.
- Add `robots.txt` disallow + `noindex` headers (privacy-by-obscurity, not true security).

**Tabs**
- **Outreach Today (20):** copy DM/email, open X profile, mark status, follow-up date
- **New:** all newly discovered ranked prospects
- **In Progress:** contacted/replied/negotiating (refresh continues until done)
- **Done:** signed/rejected/DNC with Devon notes
- **Templates:** DM/email templates + disclaimer block
- **Usage:** X + LLM usage meters, last run traces/errors
- **Settings:** kill switch, daily caps, queue policy knobs

**Statuses**
- `new → queued → contacted → replied → negotiating → signed|rejected|dnc → done`

## 4) Agent system (agentic design)

Build an agentic workflow, but keep it simple and reliable:
- Use **one orchestrator agent** that can call tools and run the daily trickle loop.
- Use **LLMs only for judgment + writing** (feature extraction/scoring/rationales and outreach drafts).
- Implement **budgets/rate limits/queue rules as hard code guardrails**, not “prompted policies”.

**Agent (LLM-driven)**
- **OrchestratorAgent:** runs the end-to-end loop (discover → enrich → sample → analyze → rank → queue → draft), writes trace + metrics, and persists outputs to Postgres.

**LLM steps (called by the orchestrator)**
- **Analyzer step:** structured feature extraction + scoring + tier + “why” rationale.
- **Writer step:** DM/email drafts (assist-only) + subject line + disclaimer block.

**Guardrails (code, non-negotiable)**
- Rate limit handling and backoff on 429.
- Monthly and daily caps (stop at thresholds).
- Queue policy (12/6/2 mix) and diversity caps.

**Tools**
- X API: search, user lookup, recent posts lookup
- DB: read/write prospects, events, settings, usage ledger
- (Optional) embeddings store for similarity/dedupe

## 5) LLM / model routing (configurable)

Model availability/names depend on your OpenAI account and may change; keep model names in config/env and verify at implementation time.

**Recommended routing**
- **Analyzer step (high volume):** “mini” / low-cost model (e.g., `MODEL_EXTRACT`) for features + first-pass scores.
- **Rank/tie-breaks + final rationales (high quality):** flagship reasoning model (e.g., `MODEL_RANK`) for the daily top set and borderline decisions.
- **Writer step:** usually `MODEL_RANK` (best quality drafts), optionally `MODEL_EXTRACT` if you want cheaper drafts.
- **Hard cases:** do a second-pass with `MODEL_RANK` (optionally with higher reasoning settings) only on borderline/high-upside candidates.
- **Embeddings (optional):** `MODEL_EMBED`

**Usage discipline**
- 80–90% of calls should be on `MODEL_EXTRACT` (Analyzer step).
- Reserve `MODEL_RANK` for: borderline decisions, top candidates, final “Outreach Today” ordering, and high-quality drafts/rationales.

## 6) X API constraints & trickle strategy

Design for two limit types:
- **Monthly post reads** (your “15K posts/month” style cap)
- **Rate limits** (per endpoint; can include per-second caps)

**Trickle loop**
- Run **12–24 small runs/day**.
- Single-flight requests (`concurrency=1`), minimum delay between requests, backoff on 429.
- Always honor rate-limit response headers when available.

**Hard controls**
- `settings.enabled=false` stops workers immediately.
- Per-run and per-day caps: `MAX_POST_READS_PER_RUN`, `MAX_POST_READS_PER_DAY`, plus optional `MAX_$SPEND_PER_DAY` for overage usage.
- Cache aggressively: never re-fetch the same profile or post unless doing a planned refresh.

## 7) Pipeline (daily)

1) **Discovery (cheap, wide; code)**
- Execute scheduled search queries.
- Store discovery posts (id + metrics snapshot) and extract unique author ids.

2) **Enrichment (users-heavy; code)**
- Fetch/cached user profiles for new authors.
- Extract contact signals (email in bio, link-in-bio domains, website).

3) **Sampling (posts-scarce; code)**
- For shortlisted prospects only: fetch **5–10 recent posts**.

4) **Analyze + score (LLM: Analyzer step)**
- From profile + sampled posts, extract normalized features (below), compute scores/tier, and write “why” bullets.

5) **Queue selection (code)**
- Select daily queue using policy + diversity caps.

6) **Draft outreach (LLM: Writer step; assist-only)**
- Generate DM + email subject/body with disclaimer block + placeholders (code, tracking link, etc.).

7) **Periodic refresh (code)**
- Refresh a small rotating subset of `New/In Progress` each day until moved to `Done`.

## 8) Discovery query schedule (starter)

Run **16 trickle runs/day**. Each run: **2 discovery queries × 5 posts** (10 discovery post reads/run). Sampling is separate.

Note: exact query syntax depends on the X v2 endpoint you use; treat these as logical templates.

**General query pool (rotate)**
1. `(POTD OR "pick of the day" OR "best bet")`
2. `(parlay OR teaser OR "same game parlay" OR SGP)`
3. `(props OR "player prop" OR "shot prop" OR "points prop")`
4. `("closing line" OR CLV OR ROI OR "units")`
5. `(tail OR tailing OR fade OR fading)`
6. `("live bet" OR "live betting" OR "2H" OR "second half")`
7. `("model" OR sim OR projection OR edge) (odds OR line)`
8. `("bet slip" OR ticket OR cashed) (parlay OR props OR ML)`

**Sport query pool (rotate)**
- NBA: `(NBA) (props OR parlay OR POTD OR units)`
- NFL: `(NFL) (spread OR total OR ML OR parlay OR POTD)`
- MLB: `(MLB) (NRFI OR YRFI OR "run line" OR ML OR POTD)`
- NHL: `(NHL) ("puck line" OR ML OR parlay OR POTD)`
- Soccer: `(EPL OR UCL OR MLS OR soccer) (BTTS OR "Asian handicap" OR POTD)`
- Golf: `(PGA OR golf) (outright OR "top 10" OR "top 20")`
- Tennis: `(ATP OR WTA OR tennis) (sets OR games OR ML OR POTD)`

**Rotation**
- Each run: pick 1 general + 1 sport query (round-robin sports).

**Yield optimization (weekly)**
- Track per query: `yield = (# prospects reaching Tier B+) / (discovery post reads spent)`.
- Keep top ~70% queries; replace bottom ~30% with variants.

## 9) Scoring model (rev-share optimized)

Compute two scores and multiply:

**Performance score (0–100): “will they drive deposits?”**
- Engagement quality (replies/post weighted > likes)
- Posting consistency
- Betting + sports relevance

**Acceptance score (0–100): “will they accept rev-share only?”**
- **Monetization gap**: low promo density, few affiliate pushes
- Not primarily paywalled (VIP/Discord/Patreon dominance can reduce acceptance)
- Operator readiness (email/link-in-bio, consistent posting)

**Overall**
- `overall_score = (performance_score * acceptance_score) / 100`
- Tier A/B/C thresholds are configurable; start with:
  - Tier A: `overall ≥ 70`, `performance ≥ 65`, `acceptance ≥ 50`
  - Tier B: `overall ≥ 55`, `performance ≥ 55`, `acceptance ≥ 45`
  - Tier C: otherwise (not filtered out)

## 10) Queue policy (20/day)

Objective: maximize expected deposits while keeping acceptance workable.

**Daily mix**
- **12 Value picks:** highest `overall_score`, require `acceptance_score ≥ 45`
- **6 Acceptance-tilted picks:** highest `acceptance_score`, require `performance_score ≥ 50`
- **2 Exploration picks:** novel niches/queries/archetypes, require `performance_score ≥ 45`

**Diversity caps**
- Max 6 per sport/day
- Max 8 per archetype/day (capper/analyst/meme/news/media/athlete/etc.)
- Max 3 very-similar accounts/day (use embeddings if enabled; otherwise approximate via shared bio/link keywords)

## 11) Outreach drafts (assist-only)

Generate:
- DM text
- Email subject + body
- Disclaimer block (configurable)

No sending; the UI provides copy buttons + “open X profile” links.

## 12) Data model (Postgres, MVP)

Tables (suggested):
- `prospects`: x_user_id, handle, profile cache, current scores, tier, status, owner, notes
- `post_samples`: post_id, prospect_id, text, metrics snapshot, sampled_at
- `score_history`: prospect_id, scores, computed_at, inputs hash
- `outreach_events`: prospect_id, channel (dm/email), event_type, event_at, follow_up_at, notes
- `settings`: enabled, caps, refresh cadence, queue mix, disclaimer text, templates
- `usage_ledger`: date, x_post_reads, x_user_lookups, llm_tokens_by_model, estimated_cost

## 13) Operational controls

- Kill switch in `settings.enabled`
- Usage page: daily/monthly post reads remaining, recent errors, last-run trace id
- Alerts (optional): notify at 50/75/90% of daily and monthly caps
