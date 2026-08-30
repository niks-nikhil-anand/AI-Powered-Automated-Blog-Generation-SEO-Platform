# Topic Sourcing — Three-Tier Fallback Plan

> **Status: PROPOSED (2026-08-28)** — design doc, no code written yet.

## 0. Problem statement

User-reported symptom: **"every time, no topics is fetched."** The dashboard's
`RunPipelineModal.tsx` renders this outcome as the string *"No new topic above threshold"*,
which is treated internally as a **normal, silent success** — `dispatchedCount: 0`,
`reason: "no_new_topic_above_write_threshold"` — not an error. That's why it happens
"every time" with no visible failure to chase.

### Root cause (verified from code, not hypothetical)

Today there is exactly **one** topic source: the live research pipeline
(`workers/research-worker/index.ts` → 11 RSS/API sources → dedupe → score → **gate at
`RESEARCH_WRITE_THRESHOLD=90`** → dispatch). Confirmed in `.env`:

```
RESEARCH_WRITE_THRESHOLD=90
RESEARCH_ENGINE_ENABLED=false
```

The score (`pipeline/score.ts`) is a weighted blend that needs near-perfect trend volume,
3+ independent sources agreeing, *and* a strong semantic-relevance score simultaneously to
clear 90 — a bar the promote floor (70) already signals is unusually strict for "write-ready."
Contributing factors compound this:

1. **`RESEARCH_WRITE_THRESHOLD=90`** is a strict single point of failure — no partial credit,
   no adaptive relaxation when the pool is dry.
2. **30-day duplicate suppression** (`RESEARCH_RECENT_DUPLICATE_DAYS`) silently drops
   candidates that would otherwise qualify.
3. **Daily-target ceiling** clamps dispatch to 0 once today's blog quota is already met,
   regardless of candidate quality.
4. **`ANTHROPIC_NEWS_RSS` is permanently dead** (404, no replacement found) — one of 11
   sources contributes 0 signals on every run, no override set in `.env`.
5. **Semantic scoring fails soft to 0** on Vertex quota/429 (`VERTEX_FLASH_RPM` is low),
   silently zeroing 20% of the score for every candidate in that run.
6. **Google Trends RSS** is an undocumented scrape endpoint with no SLA.
7. The **"Manual topic" UI is a dead end** — `ManualTopicModal.tsx`'s `onSubmit` handler
   (wired in `app/dashboard/layout.tsx`) just calls `alert(...)` and discards the input.
   No API call, no `Trend` row created. There is currently no working fallback of any kind
   when the live pipeline comes up empty.
8. **No `Niche` concept exists anywhere in the schema.** The blog's subject matter is
   implicitly hardcoded into RSS URLs and query strings
   (`RESEARCH_GOOGLE_NEWS_QUERY`, `RESEARCH_GITHUB_QUERIES`), not a configurable setting.

**Conclusion:** the live-fetch pipeline is not fundamentally broken — it's a single point of
failure with a strict gate, no persisted "why" report on the default path, and zero fallback.
This plan adds two more tiers plus visibility into which tier actually fired.

---

## 1. Goals

- Guarantee the daily pipeline always has *something* to write about, in this priority order:
  1. **Primary** — live-fetched, scored, high-confidence trend (existing pipeline, tightened).
  2. **Secondary** — a curated, dashboard-managed **predefined topic pool**, matched by niche/category.
  3. **Tertiary** — an **AI-generated topic** synthesized from the configured niche(s) + recent
     topic history (novelty-aware), used only when tiers 1 and 2 both come up short.
- Make "which tier produced this topic" visible everywhere a topic appears (dashboard, logs, `AIUsage`).
- Make "no topics today" distinguishable from "pipeline is broken" — today both look identical.
- Reuse existing infra wherever possible: `AppSetting` for config, `generateVertexJson` /
  `vertex-gateway` for LLM calls, `researchQueue`/BullMQ for orchestration, the `Trend` model
  as the single source of truth for "a topic," so downstream planning/outline/writing workers
  need **no changes** — they already just consume `Trend` rows regardless of provenance.

## 2. Non-goals

- Not rewriting the scoring algorithm's weights (§4.1 proposes one bounded change: making the
  write threshold adaptive, not a redesign of `score.ts`).
- Not building a general-purpose CMS for topics beyond what the pool/niche pages need.
- Not touching `RESEARCH_ENGINE_ENABLED=true` (the stricter, unused engine path) — out of scope,
  covered by a note only (§8).

---

## 3. Architecture overview

```
runScheduledSlot(n) / manual trigger
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ TIER 1 — Primary: live fetch (existing, tightened)         │
│  11 sources → normalize → dedupe → semantic → score        │
│  → promote (>=70) → dispatch (>= adaptive write threshold) │
└───────────────────────────────────────────────────────────┘
        │ dispatchedCount for this slot?
        │  >= 1  → done, tier="live_fetch"
        │  == 0  ▼
┌───────────────────────────────────────────────────────────┐
│ TIER 2 — Secondary: predefined topic pool                  │
│  Select best unused TopicPoolItem matching active niche(s) │
│  → materialize as Trend (source="predefined_pool")         │
│  → mark pool item usageCount++/lastUsedAt                  │
└───────────────────────────────────────────────────────────┘
        │ pool had a usable, unused, on-niche item?
        │  yes → done, tier="predefined_pool"
        │  no  ▼
┌───────────────────────────────────────────────────────────┐
│ TIER 3 — Tertiary: AI-generated from niche                 │
│  generateVertexJson(prompt built from Niche + recent       │
│  Trend.topic history for novelty) → validate → persist as  │
│  Trend (source="ai_generated")                              │
└───────────────────────────────────────────────────────────┘
        │
        ▼
   dispatch to planningQueue (unchanged downstream)
```

Each tier writes a normal `Trend` row; downstream workers (planning/outline/writing/publish)
are untouched because they already only care about `Trend.status = PLANNED` /
`Trend.id`, not where it came from. The **only** new downstream-visible field is
`Trend.sourceTier`, used purely for display/analytics.

Orchestration lives in `workers/research-worker/index.ts`, called from the existing
`runScheduledSlot()` (per-publish-slot) and the manual `POST /api/research/run` path — both
already call `runResearch()` and already have "fall back to backlog" logic
(`index.ts:406-460`) that this plan extends rather than replaces.

---

## 4. Schema changes (`prisma/schema.prisma`)

### 4.1 `Trend` — add provenance + adaptive-threshold support

```prisma
enum TrendSourceTier {
  LIVE_FETCH
  PREDEFINED_POOL
  AI_GENERATED
  MANUAL
}

model Trend {
  // ...existing fields unchanged...
  sourceTier TrendSourceTier @default(LIVE_FETCH)
  poolItemId String?
  poolItem   TopicPoolItem?  @relation(fields: [poolItemId], references: [id])
  nicheId    String?
  niche      Niche?          @relation(fields: [nicheId], references: [id])

  @@index([sourceTier])
}
```

- `sourceTier` replaces guessing from `source` (a free-text, comma-joined RSS-source string
  today — unaffected, still populated for tier 1 as-is).
- `poolItemId` / `nicheId` are nullable back-references for analytics ("which pool item gets
  reused most," "which niche is AI tier leaning on").

### 4.2 New model: `TopicPoolItem` (the secondary tier's pool)

```prisma
model TopicPoolItem {
  id           String    @id @default(cuid())
  title        String
  description  String?   @db.Text
  category     String                       // reuses the existing 7-value category enum-as-string
  nicheId      String?
  niche        Niche?    @relation(fields: [nicheId], references: [id])
  tags         String[]  @default([])
  isActive     Boolean   @default(true)
  usageCount   Int       @default(0)
  lastUsedAt   DateTime?
  createdBy    String?                      // "seed" | user email, for audit
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  trends       Trend[]

  @@index([isActive, nicheId])
  @@index([usageCount, lastUsedAt])
}
```

- Selection rule (tier 2 logic): `isActive=true`, niche matches active niche (or any, if no
  niche set), not used in the last `RESEARCH_RECENT_DUPLICATE_DAYS`, ordered by
  `usageCount ASC, lastUsedAt ASC NULLS FIRST` — i.e. round-robin the least-recently-used items
  first, so the pool doesn't repeat the same 3 topics every day.
- This is a real table (not just pre-seeded `Trend` rows) so pool items can be reused across
  many dispatches without polluting `Trend`'s 30-day-dedupe window semantics, and so the
  dashboard can manage/edit/deactivate pool entries independent of dispatch history.

### 4.3 New model: `Niche`

```prisma
model Niche {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?  @db.Text
  keywords    String[] @default([])   // seeds the AI-generation prompt + pool matching
  isActive    Boolean  @default(true)
  priority    Int      @default(0)    // multiple active niches: higher priority tried first
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  poolItems   TopicPoolItem[]
  trends      Trend[]
}
```

- Supports multiple niches (e.g. a multi-topic blog) with a priority order, without forcing a
  single hardcoded niche.
- Migration seeds one default `Niche` row from the current implicit niche (`"Developer Tools &
  AI"`, keywords derived from today's `RESEARCH_GOOGLE_NEWS_QUERY` defaults) so tier 3 has
  something to work with on day one without requiring the user to configure anything first.

### 4.4 Migration plan

- Single Prisma migration adding the enum + 2 tables + `Trend` columns (all nullable/defaulted,
  fully backward compatible — no backfill required beyond the one seeded default `Niche`).
- Seed script (`prisma/seed-topic-pool.ts`, run once manually / via `npm run db:seed`) loads an
  initial predefined pool — a curated static list of ~40-60 evergreen dev/AI topics grouped by
  the existing 7 categories, so tier 2 isn't empty on day one either.

---

## 5. Backend / logic changes

### 5.1 Tighten tier 1 without redesigning it

- **Adaptive write threshold** instead of a fixed 90: if a slot's tier-1 run promotes
  candidates (score ≥ 70) but none clear the write threshold, and no dispatch has happened for
  that slot yet, retry the gate check once at a lower floor (e.g. `RESEARCH_WRITE_THRESHOLD_FLOOR`,
  default 78) *only* for the single best-scoring candidate — not a blanket loosening. This alone
  will likely resolve a meaningful fraction of "no topics" cases without touching `score.ts`'s
  weights.
- Fix `ANTHROPIC_NEWS_RSS`: either find a working replacement feed (e.g. Anthropic's blog
  sitemap or a third-party aggregator) or explicitly set `ENABLE_ANTHROPIC_NEWS=false` so it
  stops silently contributing zero — a disabled source is honest; a broken one masquerading as
  active is not.
- Remove or wire up the dead `GOOGLE_NEWS_URL` env var (currently set in `.env` but read
  nowhere — likely leftover config someone assumed was live).
- No change to `RESEARCH_ENGINE_ENABLED=false` path — out of scope (§2).

### 5.2 New module: `workers/research-worker/pipeline/pool-fallback.ts`

```ts
export async function selectFromPool(activeNiches: Niche[]): Promise<TopicPoolItem | null>
export async function materializePoolItem(item: TopicPoolItem, niche?: Niche): Promise<Trend>
```
- Mirrors the shape of existing pipeline modules (`promote.ts`, `dedupe.ts`) — pure functions
  taking Prisma-fetched data, no direct queue/env access, easy to unit test.
- `materializePoolItem` creates a `Trend` with `sourceTier: PREDEFINED_POOL`, `status: NEW`,
  a synthetic `score` (e.g. 75, above promote floor, below write threshold — visibly
  distinguishable from a live-scored trend), then increments `usageCount`/`lastUsedAt` on the
  pool item in the same transaction.

### 5.3 New module: `workers/research-worker/pipeline/ai-fallback.ts`

```ts
export async function generateNicheTopic(niche: Niche, recentTopics: string[]): Promise<Trend | null>
```
- Follows the exact pattern of `workers/planning-worker/vertex.ts`'s `generateContentPlan()`:
  checks `isVertexConfigured`, calls `generateVertexJson(model, prompt)` routed through the
  existing `vertex-gateway`/`vertex_queue` (so it automatically respects `VERTEX_FLASH_RPM`,
  retry, and circuit-breaker behavior — zero new infra), validates the response against a Zod
  schema (`{ title: string, angle: string, category: string }`), and returns `null` on schema
  failure or Vertex being unconfigured rather than throwing — mirroring the "fail soft to
  nothing usable, let the caller decide" convention already used there.
- Prompt includes the niche's `keywords`/`description` and the last ~30 days of `Trend.topic`
  values (across all tiers) explicitly as "topics already covered, do not repeat" — this is the
  novelty guard, analogous to what `pipeline/semantic.ts` already does for live candidates.
- Add `topicGeneration` to `MODEL_SETTING_KEYS` (`workers/shared/settings.ts`) so the model used
  for this call is dashboard-configurable exactly like the other 7 stages — one-line addition,
  established pattern.
- Persists as `Trend` with `sourceTier: AI_GENERATED`, `nicheId` set, score defaulted similarly
  to §5.2's synthetic-score convention.

### 5.4 Orchestrator changes: `workers/research-worker/index.ts`

- After the existing tier-1 dispatch logic (`index.ts:226-282`) resolves to
  `dispatchedCount === 0` for a slot that still has daily-target headroom remaining
  (reuse the existing `getDailyTargetStatus()` check already at `index.ts:291-326` — don't
  fall back if the day's quota is already met, that's a legitimate "done for today," not a
  failure):
  1. Call `selectFromPool()` for the slot's active niche(s). If found → materialize, dispatch,
     stop.
  2. Else call `generateNicheTopic()`. If it returns a `Trend` → dispatch, stop.
  3. Else — **only now** is it a genuine "nothing available" outcome — log a distinct reason
     (`"all_tiers_exhausted"`) so the dashboard can tell "pool is empty and AI failed" apart
     from today's ambiguous "no new topic above threshold."
- Every tier transition gets a structured log line (extends the existing
  `passWorkerAttempt`/`WorkerAttempt` audit trail — no new table needed, `WorkerAttempt` already
  has a JSON detail column per the existing pattern used elsewhere).

### 5.5 Fix the dead "Manual topic" UI → real tier-2 write path

- `POST /api/topics/manual` (new route, mirrors `app/api/research/run/route.ts`'s shape):
  accepts `{ title, description?, category, nicheId? }`, creates a `TopicPoolItem`
  (`createdBy: <user email>`) **and**, if the caller wants it dispatched immediately rather than
  just pooled, also materializes a `Trend` with `sourceTier: MANUAL` in the same call (a
  `dispatchNow: boolean` flag in the request body covers both "add to pool for later" and
  "use this today" from one form).
- `ManualTopicModal.tsx`'s `onSubmit` gets wired to actually `fetch()` this route instead of
  `alert()`-and-discard.

---

## 6. UI changes

### 6.1 Sidebar navigation (`components/shared/Sidebar.tsx`)

Expand the existing single **"Trend Research"** item into a small section (matches the existing
pattern of grouped nav items already in the file):

- **Trend Research** → `/dashboard/trends` (existing page, extended — see 6.2)
- **Topic Pool** → `/dashboard/topics/pool` (new)
- **Niches** → `/dashboard/topics/niches` (new)

### 6.2 `/dashboard/trends` (existing page — extend, don't replace)

- Add a **source-tier badge** per row (`Live` / `Pool` / `AI` / `Manual`), small colored pill
  next to the existing score column — this is the single highest-value UI change, since it's
  what finally answers "did today's topic come from real research or a fallback?" at a glance.
- Replace the current binary "dispatched > 0 / No new topic above threshold" copy in
  `RunPipelineModal.tsx:268-272` with a 3-state message reflecting which tier actually resolved
  the slot (`"Live research found a topic"` / `"Live research came up empty — used the topic
  pool"` / `"Live research and pool were empty — AI generated a topic from your niche"` /
  `"All sources exhausted — no topic available"`), sourced from the new structured reason field
  in §5.4.

### 6.3 `/dashboard/topics/pool` (new page)

- Table of `TopicPoolItem` rows: title, category, niche, tags, `isActive` toggle, usage count,
  last used date, actions (edit, deactivate, delete).
- "+ Add topic" — reuses the fixed `ManualTopicModal` (§5.5) with `dispatchNow: false` as the
  default in this context.
- Bulk import (CSV/JSON paste) for seeding many topics at once — matches the "curated pool"
  intent from the user's request.
- Filter by category/niche/active status; sort by usage (surfaces stale/never-used items).

### 6.4 `/dashboard/topics/niches` (new page)

- CRUD table for `Niche`: name, description, keywords (tag input), priority, `isActive` toggle.
- Inline preview of "what tier-3 will generate" — a "Preview AI topic" button that calls
  `generateNicheTopic()` in dry-run mode (no persistence) so the user can sanity-check a niche's
  keywords before relying on it live.

### 6.5 `/dashboard/settings` (existing page — new section)

Add a **"Topic Sourcing"** panel alongside the existing Research Schedule / Worker Activity /
AI Model / Daily Blog Goal panels (same `AppSetting`-backed pattern as the rest of that page):

- Write threshold + adaptive floor (§5.1) as editable numeric fields (currently env-only).
- Per-tier enable/disable toggles (e.g. temporarily turn off tier 3 if AI-generated topics need
  review before trusting them unattended).
- Default niche selector (which `Niche` tier 3 uses when a slot doesn't specify one).
- Model override for `topicGeneration` stage (§5.3), placed in the existing "AI Model Per
  Pipeline Stage" panel alongside the other 7 stages rather than duplicated here.

---

## 7. Config / environment changes

| Var | Change |
|---|---|
| `RESEARCH_WRITE_THRESHOLD` | unchanged (90), now paired with... |
| `RESEARCH_WRITE_THRESHOLD_FLOOR` | **new**, default 78 — adaptive retry floor (§5.1) |
| `ENABLE_ANTHROPIC_NEWS` | set to `false` until a working feed is found, or fix `ANTHROPIC_NEWS_RSS` |
| `GOOGLE_NEWS_URL` | remove (dead, unused) or wire it into `sources/google-trends.ts`/`google-news.ts` if it was meant to override the query URL |
| `RESEARCH_POOL_FALLBACK_ENABLED` | **new**, default `true` — matches the settings-page toggle in §6.5 |
| `RESEARCH_AI_FALLBACK_ENABLED` | **new**, default `true` |
| `TOPIC_GENERATION_MODEL` | **new**, env fallback for the `topicGeneration` `AppSetting` key (§5.3), same convention as `VERTEX_FLASH` etc. |

All new settings also get an `AppSetting` row so they're dashboard-editable without a restart,
per the established `getSetting()`/env-fallback convention already used for every other
worker-tunable value in this codebase.

---

## 8. Phased implementation plan

**Phase 1 — Stop the bleeding (no schema changes, ships fastest)**
1. Fix `ANTHROPIC_NEWS_RSS` / disable the source.
2. Remove dead `GOOGLE_NEWS_URL`.
3. Add `RESEARCH_WRITE_THRESHOLD_FLOOR` adaptive retry (§5.1).
4. Add the distinct `"all_tiers_exhausted"` vs `"no_new_topic_above_write_threshold"` reason
   split even before tiers 2/3 exist, so the dashboard message stops being misleading today.

**Phase 2 — Schema + secondary tier**
1. Prisma migration: `TrendSourceTier` enum, `Trend.sourceTier`/`poolItemId`/`nicheId`,
   `TopicPoolItem` table, `Niche` table + seed migration.
2. Seed script with ~40-60 curated evergreen topics.
3. `pipeline/pool-fallback.ts` + orchestrator wiring in `index.ts`.
4. Fix `ManualTopicModal` + `POST /api/topics/manual`.
5. `/dashboard/topics/pool` page + CRUD API.

**Phase 3 — Tertiary AI tier**
1. `/dashboard/topics/niches` page + CRUD API, seeded default niche.
2. `pipeline/ai-fallback.ts`, `MODEL_SETTING_KEYS.topicGeneration`.
3. Orchestrator wiring (tier 3 after tier 2 in `index.ts`).

**Phase 4 — Observability polish**
1. Source-tier badges on `/dashboard/trends`.
2. 3-state `RunPipelineModal` messaging.
3. "Topic Sourcing" settings panel (thresholds, per-tier toggles, default niche).
4. `AIUsage`/cost dashboard already picks up tier-3 Vertex calls automatically once routed
   through `generateVertexJson` — verify it shows up correctly, no new plumbing expected.

Each phase is independently shippable and backward compatible — Phase 1 alone should visibly
reduce "no topics" incidents; Phases 2-4 build the actual three-tier guarantee the user asked for.

---

## 9. Testing / validation plan

- Unit tests for `pool-fallback.ts` (selection ordering, niche matching, no-eligible-items case)
  and `ai-fallback.ts` (schema validation failure → `null`, novelty prompt construction).
- Integration test: force tier 1 to promote 0 candidates (mock all sources empty) → assert tier
  2 fires; force pool also empty/inactive → assert tier 3 fires; force Vertex unconfigured too →
  assert the new `"all_tiers_exhausted"` reason is recorded and no exception is thrown (matches
  existing "empty run is not a fault" philosophy at `index.ts:226-282`, just now with an honest
  terminal reason instead of a silent one).
- Manual QA: run `npm run worker:research:once` locally with `ENABLE_*` source flags all false
  to force tier 1 empty, confirm a pool item gets materialized end-to-end into a dispatched
  `Trend`, then downstream planning-worker picks it up unmodified (proves no downstream changes
  needed, per §1 goals).
- Dashboard smoke test: verify tier badges render for all 4 `sourceTier` values, verify the
  "+ Add topic" flow round-trips (create → appears in pool table → dispatch-now variant appears
  in `/dashboard/trends`).

## 10. Open questions for the user

- Should tier-3 AI-generated topics require manual approval before dispatch (like the existing
  below-threshold approve flow at `app/api/trends/[id]/approve/route.ts`), at least initially,
  given they're synthesized rather than evidence-backed? Recommend **yes** for the first few
  weeks, toggle-able off later once trust is established.
- Should the predefined pool support recurring auto-replenishment (e.g. a monthly batch-generate
  of new pool items via AI, reviewed before activation) so it doesn't need manual curation
  forever? Out of scope for this plan but a natural Phase 5.
