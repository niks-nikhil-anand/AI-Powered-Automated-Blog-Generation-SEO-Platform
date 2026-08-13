# 🏭 Auto-Blog Pipeline — Flow-by-Flow Review & Ratings

> 📅 Reviewed: 13 Aug 2026 · 🔍 Scope: all 7 workers + shared infrastructure
> 📁 Source of truth: `workers/**` (TypeScript) — **not** the `/prompts/*.md` spec files

---

## 🧭 Legend

| Icon | Meaning |
|---|---|
| ⭐ | Rating star (⭐⭐⭐⭐⭐ = 5/5, ☆ = empty) |
| ✅ | Strength — implemented well |
| ❌ | Problem — broken, missing, or misleading |
| ⚠️ | Risk / partial — works but has a caveat |
| 🔄 | Retry / recovery behavior |
| 💰 | Cost (AI token spend) concern |
| 🛡️ | Quality gate |
| 🧠 | AI/LLM logic |
| 📊 | Observability / audit |

---

## 🗺️ Master Pipeline (As Actually Built)

> ✅ **Update 13 Aug 2026:** the mid-chain job-ID gap below is **FIXED** — see `docs/FIX-PLAN-deterministic-job-ids.md`. Every enqueue now carries a deterministic ID via `JOB_IDS` (`workers/shared/queues.ts`): 🔒 entity-keyed for once-per-entity stages, 🔁 epoch-keyed where re-runs are legitimate (so dedupe can never stall the QA loop).

```
 ⏰ Publish Slots (cron, 1 per daily goal)  +  🔁 Reconcile Tick (every 30m)
        │
        ▼
┌──────────────────┐   plan-${trendId} ✅  ┌──────────────────┐
│ 1️⃣  RESEARCH      │ ───────────────────▶ │ 2️⃣  PLANNING      │
│ research_queue    │                      │ planning_queue    │
└──────────────────┘                      └──────────────────┘
                                                    │ outline-${trendId} ✅
                                                    ▼
┌──────────────────┐  write-${trendId} ✅  ┌──────────────────┐
│ 4️⃣  WRITING       │ ◀────────────────── │ 3️⃣  OUTLINE       │
│ writing_queue     │                      │ outline_queue     │
└──────────────────┘                      └──────────────────┘
        │ image-${blogId}-${attemptId} ✅          ▲
        ▼                                          │ 🔁 QA requeue:
┌──────────────────┐  quality-${blogId}-    ┌──────────────────┐
│ 5️⃣  IMAGE         │ ───────────────────▶ │ 6️⃣  QUALITY       │
│ image_queue       │   ${attemptId} ✅      │ quality_queue     │
└──────────────────┘                      └──────────────────┘
                                                    │ publish-${blogId} ✅
                                                    ▼ (+ ⏳ slot hold delay)
                                          ┌──────────────────┐
                                          │ 7️⃣  PUBLISH       │
                                          │ publish_queue     │
                                          └──────────────────┘
                  (QA requeue ID: write-${trendId}-qa${attemptCount} ✅)
```

---

## 🏆 Scoreboard (Summary)

| # | Worker | 🧠 Logic | 🛡️ Gates | 🔄 Resilience | 💰 Cost | 📊 Audit | **Overall** |
|---|--------|---------|---------|--------------|--------|---------|------------|
| 1️⃣ | Research  | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐⭐ | **⭐⭐⭐⭐⭐ 4.6** |
| 2️⃣ | Planning  | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **⭐⭐⭐⭐☆ 4.4** |
| 3️⃣ | Outline   | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **⭐⭐⭐⭐⭐ 4.5** |
| 4️⃣ | Writing   | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐⭐ | **⭐⭐⭐⭐⭐ 4.8** |
| 5️⃣ | Image     | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐☆ | **⭐⭐⭐⭐⭐ 4.5** |
| 6️⃣ | Quality   | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐⭐ | **⭐⭐⭐⭐⭐ 4.8** |
| 7️⃣ | Publish   | ⭐⭐⭐⭐☆ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **⭐⭐⭐⭐☆ 4.4** |

**🎯 System Overall: ⭐⭐⭐⭐½ (4.6 / 5)** — production-grade pipeline with sophisticated self-healing. The mid-chain dedupe hole is **closed** (deterministic `JOB_IDS` everywhere); the main remaining gap is the unused `/prompts/*.md` specs.

---

# 1️⃣ Research Worker — `workers/research-worker/`

**🎯 Job:** Discover trending dev topics → normalize → dedupe → score → save `Trend` rows → dispatch top N to planning. Also owns **all scheduling** (publish slots + daily-target reconcile).

### 🔄 Flow

1. **⏰ Three entry modes** — `scheduled-slot` (one blog for a slot time), `reconcile-daily-target` (backfill), default manual/full run.
2. **🧬 Dual pipeline** — `RESEARCH_ENGINE_ENABLED` ? new novelty-driven engine (`pipeline/engine.ts`) : legacy path. Same audit wrapper either way. ✅
3. **🌐 Fetch** — all enabled sources via `Promise.allSettled` (Google Trends, News, GitHub…). Partial failure tolerated ✅; **all sources down → throw** (burns retry budget only for genuine faults) ✅
4. **🧹 Normalize → ✂️ Dedupe (heuristic) → 🧠 Semantic enrich (Vertex clustering) → 💯 Score → 🎯 Promote**
5. **📄 Evidence ingestion** (`EVIDENCE_FETCH_ENABLED`) — fetches **full article text** for top evidence URLs so later stages ground on real sources, fail-open. ✅
6. **🚫 DB duplicate checks** — same-day exact match + recent N-day fuzzy (`contains`, insensitive). ✅
7. **💾 Persist** `Trend` (score, scoreBreakdown, evidenceArticles, evidenceSummary) → status `NEW`.
8. **🎯 Daily-target ceiling** — dispatch capped at day's remaining need; overflow stays as backlog for reconcile ticks. ✅ (previously 3/day goal could publish 9 ❌→✅ fixed)
9. **📤 Dispatch** — `planningQueue.add` with **deterministic `jobId: plan-${trendId}`** → retry can never double-enqueue ✅; slot runs record `targetPublishAt` in Redis for the publish hold.
10. **🕳️ Slot backfill** — if a slot finds nothing new, best qualified backlog trend is dispatched so the day still gets its blog. ✅
11. **🗓️ Schedule reconciliation** — `upsertJobScheduler` (idempotent) + removes stale/legacy schedulers on boot. ✅

### ✅ Strengths
- ✅ Deterministic job IDs = queue-level duplicate-blog guard
- ✅ "Nothing new found" is a **normal outcome**, not an error — smart distinction between `no_new_topic` vs `daily_target_met` vs `all_sources_failed`
- ✅ `bestScore` computed from *all promotable*, not just newly-saved — logs don't lie about "best: 0" on duplicate-heavy runs
- ✅ Legacy scheduler auto-cleanup (`RESEARCH_CRON` deprecated gracefully)

### ⚠️ Weaknesses / Risks
- ⚠️ **Sequential duplicate checks** — one `findFirst` per candidate per check (N+1 pattern; fine at current volume, would not scale to hundreds/run)
- ⚠️ Fuzzy dedupe via `topic: { contains }` can over-suppress (e.g. "Next.js 15" blocks "Next.js 15.1 caching deep-dive")
- 💰 Semantic enrichment + evidence fetching are Vertex/network heavy — but gated behind promotable-only, which is the right call

### ⭐ Rating: **4.6 / 5** ⭐⭐⭐⭐⭐

---

# 2️⃣ Planning Worker — `workers/planning-worker/`

**🎯 Job:** Trend payload → 🧠 Vertex (`gemini-flash`, model from Settings) → structured **SEO content plan** → outline queue.

### 🔄 Flow

1. 📊 `startWorkerAttempt` audit (WorkflowRun + Attempt rows)
2. 🔍 Trend lookup → ❶ **score gate**: below `RESEARCH_MIN_SCORE_TO_WRITE` → skip, *unless* `manuallyApproved` (dashboard human override survives the gate ✅)
3. 🧠 `generateContentPlan(topic, category, score, evidenceSummary)` → JSON: searchIntent, audience, angle, primary/secondary keywords, competitorNotes
4. 🛡️ **Required-fields gate** — all 6 fields must be present, else `QualityGateError` (retryable)
5. 💾 `ContentPlan` **upsert by trendId** (retry-safe ✅)
6. 💰 `recordAIUsage` (model, tokens, latency, trendId)
7. 📤 `outlineQueue.add("outline_blog")` → trend stays `PLANNED`

### ✅ Strengths
- ✅ Manual-approval bypass is consistent across planning/outline/writing — one human decision isn't silently undone downstream
- ✅ Upsert + gate + audit + cost tracking = textbook stage template
- ✅ Model selectable from Settings (no redeploy to change models)

### ⚠️ Weaknesses / Risks
- ✅ ~~No deterministic job ID on `outlineQueue.add`~~ — **FIXED**: `outline-${trendId}` via `JOB_IDS`; a redelivered planning job now dedupes instead of double-spending
- ⚠️ Gate checks *presence* only — `secondaryKeywords: ["x"]` passes; no quality floor on the plan itself

### ⭐ Rating: **4.4 / 5** ⭐⭐⭐⭐☆

---

# 3️⃣ Outline Worker — `workers/outline-worker/`

**🎯 Job:** ContentPlan → 🧠 Vertex → full **article skeleton** (title, slug, meta, H2/H3 sections, FAQs) → writing queue.

### 🔄 Flow

1. 📊 Audit start → load `ContentPlan` (with trend)
2. ❶ Same score gate + `manuallyApproved` bypass ✅
3. 🧠 `generateContentOutline(topic, category, plan)` — plan's angle/keywords steer the skeleton
4. 🛡️ **Structural gate** — title ✅ slug ✅ metaTitle ✅ metaDescription ✅ **≥ 6 H2/H3 sections** ✅ **≥ 3 FAQs** ✅ — this is what makes the quality scorer's `requiredSections` achievable later
5. 💾 `ContentOutline` upsert by trendId
6. 💰 Usage recorded
7. 📤 `writingQueue.add("write_blog", { trendId, outlineId, topic: saved.title, description: plan.angle })` — note: **topic becomes the outline's SEO title**, description becomes the **angle** (nice chaining ✅)

### ✅ Strengths
- ✅ Quantitative gate (≥6 sections, ≥3 FAQs) — not just "field exists"
- ✅ Passes the *plan's angle* downstream as the writing brief — plan → outline → draft coherence
- ✅ Idempotent via upsert

### ⚠️ Weaknesses / Risks
- ✅ ~~Missing job ID on `writingQueue.add`~~ — **FIXED**: `write-${trendId}` via `JOB_IDS` (QA requeues use epoch-keyed `write-${trendId}-qaN`, so the guard never blocks recovery)
- ⚠️ No slug-uniqueness check here — slugs are only made unique at blog-write time (fine, but a retry with an unchanged title relies on `excludeBlogId` logic downstream)

### ⭐ Rating: **4.5 / 5** ⭐⭐⭐⭐⭐

---

# 4️⃣ Writing Worker — `workers/writing-worker/` 🏆 *(most sophisticated stage)*

**🎯 Job:** Outline + plan + evidence → grounded, cited, self-checked **full article** → image queue. Also the pipeline's **repair shop** — three repair modes before any full rewrite.

### 🔄 Flow

1. ❶ Score gate + manual-approval bypass ✅
2. 📥 Load outline + plan; build `priorAttempt` from QA's `recoveryContext` (score + reasons + **concrete failing claims**)
3. 🩹 **Repair mode A — Targeted repair** (`TARGETED_REPAIR_ENABLED` + judge fixes ≤ 3): maps each judge fix to a concrete section → regenerates **only those sections** → splices back, **preserving original headings** (scorer depends on them ✅) → 200-word problem no longer costs an 8k-token rewrite 💰✅
4. 🩹 **Repair mode B — Claim repair** (fact-check issues ≤ 10): locates each unverified claim's section → splice-fix → **verifies with self-check before persisting** (a bad repair doesn't burn a QA round-trip ✅)
5. ✍️ **Full draft** — `generateBlogDraft` with plan + outline + evidence + priorAttempt reasons
6. 🔬 **Self-check loop** (`WRITING_SELFCHECK_ENABLED`):
   - 🏷️ Marker enforcement — finds specific claims lacking `[S]` evidence markers
   - 🧠 `selfCheckClaims` — scores draft claims vs sources
   - 🔁 **Bounded repair passes** (`MAX_REPAIR_PASSES`) — regenerate only failing sections, re-verify
   - 🆘 Last resort: **one qualitative redraft** carrying the exact failing claims as rewrite instructions
7. 🔗 **Citation materialization** — `[S1]` markers → real Markdown links **by code** (not by the LLM); invented markers stripped & logged ✅; foreign-domain links logged as soft signal ⚠️
8. 💰 **Per-call usage recording** (sectioned drafts record each call; latency split evenly)
9. 🛡️ **Writing gate** — heuristic ≥ 90, H1, ≥ 8 H2s, FAQ, CTA, evidence citations, self-check ≥ threshold. **Fails here** (with the concrete claim list) instead of burning a QA round-trip ✅
10. 💾 Unique slug (`excludeBlogId` so a retry doesn't bump its *own* slug to `-1` ✅), category get-or-create, SEO schema (`TechArticle` + 🤖 **AI byline disclosure**), blog **upsert by trendId**
11. 📤 `imageQueue.add` → trend `PROCESSED`

### ✅ Strengths
- ✅ **Three-tier repair economics**: section splice → claim splice → bounded repair loop → single redraft — full blind rewrite is the *last* resort, not the default 💰
- ✅ Grounded writing: citations materialized by deterministic code — the LLM can't fake a URL
- ✅ Pre-QA fact gate: drafts that would be "Blocked — unverified facts" fail *here* with specifics
- ✅ Retry-safe at every level (upsert, slug exclusion, idempotent materialization)

### ⚠️ Weaknesses / Risks
- ⚠️ `heuristicScore` is crude (word count + regex for ```code```/tables/FAQ) — the real quality measurement lives in the quality worker
- 💰 Worst-case token path is heavy: draft + N repair passes + redraft + self-checks (each a Vertex call) — bounded, but a bad topic can still 3-4× a normal draft's cost
- ⚠️ Complexity: ~900 lines with 4 intertwined recovery paths — highest bus-factor in the codebase

### ⭐ Rating: **4.8 / 5** ⭐⭐⭐⭐⭐

---

# 5️⃣ Image Worker — `workers/image-worker/`

**🎯 Job:** Blog → hero image (🧠 Imagen AI or 🎨 procedural SVG) → S3/CDN → `Asset` → quality queue.

### 🔄 Flow

1. ⏭️ **Pass-through skip** — blog already has `featuredImageId` (e.g. after a writing repair) → straight to quality queue ✅
2. 🎯 Subject = `plan.primaryKeyword` → fallback `trend.topic` → fallback title
3. 🖼️ **Selection** (`selectHeroImage`):
   - 🧠 **AI path** (flag ON + Vertex configured): up to **3 attempts**, each with a **fresh style direction** (no repeats) → generate → title/branding **overlay composite** → 📐 dimension check → 🧬 **dHash uniqueness** vs last 50 assets (hamming < 10/72 bits = too similar → regenerate)
   - 🎨 **Fallback**: procedural SVG generator, seed **salted up to 5×** until it clears the *same* uniqueness check
4. ☁️ S3 upload (`blogs/YYYY/MM/slug/file`) → 🛡️ upload gate (buffer, mime, bucket, key, CDN URL)
5. 🧹 **Orphan cleanup** — gate failure **deletes the S3 object** before throwing ✅
6. 💾 `Asset` row (stores `imageHash` + `styleDirection` for future uniqueness) → blog link → 📤 quality queue

### ✅ Strengths
- ✅ Visual uniqueness is **enforced by perceptual hash**, not hoped for
- ✅ Graceful degradation: Imagen → retried styles → procedural SVG — a blog *never* dies for want of an image
- ✅ S3 orphan cleanup on gate failure — rare attention to detail
- ✅ Repair-aware pass-through (writing repairs don't regenerate images 💰)

### ⚠️ Weaknesses / Risks
- ⚠️ Uniqueness lookback is only 50 assets — very old images can recur (acceptable for a daily blog)
- 💰 Up to 3 Imagen calls per blog on dimension/uniqueness misses
- ⚠️ Overlay/composite failures count against the same 3-attempt budget as generation failures

### ⭐ Rating: **4.5 / 5** ⭐⭐⭐⭐⭐

---

# 6️⃣ Quality Worker — `workers/quality-worker/` 🏆 *(the brain of the trust layer)*

**🎯 Job:** Score the blog across **11 heuristic dimensions + LLM fact-check + LLM editorial judge** → pass → publish (with slot hold) / fail → targeted writing requeue → permanent fail → backlog backfill.

### 🔄 Flow

1. 📥 Load blog + SEO + image + trend.plan (judge scores usefulness *against the plan's stated intent*, not in a vacuum ✅)
2. 👁️ **Vision assessment** — Gemini checks hero-image relevance + appeal; `deferrable` priority, fail-open (degrades one dimension, never the run) ✅
3. 🔍 **Fact check** — `FULL_FACTCHECK_ENABLED` + evidence articles → **claim-level full-coverage** check; else legacy sampled vs evidenceSummary; unavailable → **neutral 7/10, not 0** ("couldn't verify" ≠ "wrong" ✅)
4. ⚖️ **LLM judge** — depth/tone/originality/usefulness + actionable fixes; **shadow mode by default** (persisted, displayed, *not gated*) until calibration ✅ — live mode blends via `JUDGE_WEIGHT` + enforces **per-dimension floors** (one collapsed dimension can't be averaged into a pass; Fact Verification exempt — it has its own gate)
5. 🧮 **11 checks**: SEO Structure · Completeness (12 required sections) · Readability · Content Quality · Keyword Opt · Technical SEO · Formatting/UX · Media Quality · AI & Fact Quality · Publishing Readiness · Fact Verification — normalized to a true **0-100** regardless of check count (dashboard-safe ✅)
6. 🛡️ **Triple pass condition**: `overall ≥ 90` **AND** `factCheck ≥ 70` (hard gate — 10 good checks can't outvote wrong facts ✅) **AND** dimension floors (judge-live only)
7. ✅ **Pass** → `publishQueue.add` with **deterministic `publish-${blog.id}`** + ⏳ **`delay` = hold until slot's target publish time** (finishing early waits; finishing late publishes immediately — never abandoned ✅)
8. ❌ **Fail** → requeue writing with `recoveryContext` = { judge fixes + **top-10 concrete failing claims** } — retry budget = Settings' Retry Attempts + 1, **no hard-coded counts** ✅
9. 💀 **Permanent fail** → blog `FAILED` → **immediate `reconcileDailyTarget`** — a dead article doesn't shrink today's goal ✅

### ✅ Strengths
- ✅ Fail-open philosophy everywhere it isn't the draft's fault (vision, fact-check, judge)
- ✅ Fail-*closed* where it matters: the fact hard-gate
- ✅ Shadow-mode judge rollout = textbook safe AI gating
- ✅ Recovery payloads carry **concrete fixes**, not bare scores — retries are targeted, not blind
- ✅ Recommendation bands ("Blocked — unverified facts", "Excellent — Auto Publish", …)

### ⚠️ Weaknesses / Risks
- ⚠️ Several checks are regex-grade heuristics (tables, lists, "call to action" substring) — gameable by verbose-but-mediocre content; the judge (when live) is the mitigation
- 💰 Up to 3 Vertex calls per scoring run (vision + fact-check + judge)
- ⚠️ `requiredSections` list is hard-coded English headings — outline prompt and scorer must never drift apart

### ⭐ Rating: **4.8 / 5** ⭐⭐⭐⭐⭐

---

# 7️⃣ Publish Worker — `workers/publish-worker/`

**🎯 Job:** Final verification → mark `PUBLISHED`. Deliberately the dumbest stage. 🔒

### 🔄 Flow

1. 📥 Load blog + qualityReport + image + SEO
2. 🔐 **Stale-job guard** — payload's `qualityReportId` must match the blog's *current* report (a re-scored blog can't be published by an old job ✅)
3. 🛡️ **Final gate** — QA ≥ 90 · featured image · SEO record · content · HTML
4. 🔁 **Idempotent publish** — `updateMany({ status: { not: "PUBLISHED" } })`; `count === 0` → already published, skip side effects (crash-between-write-and-ack safe ✅)
5. ❌ Any failure → blog `PENDING_REVIEW` + **immediate daily-target backfill** ✅

### ✅ Strengths
- ✅ Redelivery-proof via atomic conditional update — no hand-rolled Redis idempotency key needed
- ✅ Re-verifies everything at the last moment instead of trusting the queue payload
- ✅ Publish failure tops up the day from backlog immediately

### ⚠️ Weaknesses / Risks
- ⚠️ **"Publish" = a DB status flip only** — no sitemap ping, no CDN invalidation, no webhook/RSS refresh, no external distribution. If a frontend reads the DB directly this is fine; anything else needs a real publisher
- ⚠️ On gate failure the blog lands in `PENDING_REVIEW` but there's no automated re-drive after a human fixes it (manual path only, via `OverridePublishModal`)

### ⭐ Rating: **4.4 / 5** ⭐⭐⭐⭐☆

---

# 🧩 Cross-Cutting Infrastructure

| Concern | Status | Notes |
|---|---|---|
| 🔄 Retry counts | ✅ | **Fully dynamic** from Settings (`retryAttempts`) via a getter on `defaultJobOptions` — zero hard-coded counts, no restart needed |
| 📊 Audit trail | ✅ | Every stage wrapped in `startWorkerAttempt`/`pass`/`fail` → `WorkflowRun` + `Attempt` rows with input/output/gate reports |
| 💰 Cost tracking | ✅ | Every Vertex call site records model + tokens + latency; usage attached to blogs; per-model rollups stay accurate even for sectioned drafts |
| 🔁 Recovery loop | ✅ | QA → writing requeue carries judge fixes + failing claims; permanent failure → instant backlog backfill; slot holds via BullMQ delayed jobs |
| 🛡️ Duplicate blogs | ✅ | Deterministic job IDs at **every** enqueue via `JOB_IDS` (`workers/shared/queues.ts`) + DB upserts by `trendId` everywhere |
| ✅ Mid-chain job IDs | ✅ | **FIXED** (`docs/FIX-PLAN-deterministic-job-ids.md`): 🔒 entity-keyed IDs for once-per-entity stages (`plan/outline/write/publish-*`), 🔁 epoch-keyed IDs where re-runs are legitimate (`write-*-qaN`, `image-*-attemptId`, `quality-*-attemptId`) so dedupe can never stall the QA loop; dashboard triggers covered too |
| ❌ `/prompts/*.md` | ❌ | **Not loaded by any worker** — design specs only; runtime prompts are inline `buildPrompt()` template literals and have **drifted** from the specs |
| ⏰ Scheduling | ✅ | Publish slots (from Settings) + reconcile cron; stale schedulers auto-removed; legacy `RESEARCH_CRON` deprecated cleanly |

---

# 🏁 Final Verdict

| Area | Verdict |
|---|---|
| Architecture | ⭐⭐⭐⭐⭐ — clean queue-per-stage, single-responsibility workers |
| Self-healing | ⭐⭐⭐⭐⭐ — repair loops, backlog backfill, slot holds, dynamic retries |
| Trust layer | ⭐⭐⭐⭐⭐ — grounded citations, claim-level fact-checks, shadow-mode judge |
| Cost discipline | ⭐⭐⭐⭐☆ — repair-first economics; worst-case paths bounded but heavy |
| Documentation | ⭐⭐☆☆☆ — `/prompts/*.md` are stale specs, **not** runtime truth ❌ |
| Distribution | ⭐⭐⭐☆☆ — "publish" stops at a DB status |

**🎯 Overall: ⭐⭐⭐⭐½ (4.6/5)** — a genuinely production-grade autonomous content pipeline. ~~Fix the mid-chain job IDs~~ ✅ **done** — the remaining gap: either delete or wire up the `/prompts` specs, and decide what "publish" should really do (distribution).
