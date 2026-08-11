# Worker Enhancement Guide — Auto-Blog Pipeline

> **Scope**: A complete technical review of all 7 pipeline workers plus the
> shared infrastructure, with concrete, code-grounded enhancements targeting:
> **factual accuracy · SEO · content quality · reliability · hallucination
> reduction · publishing success rate · API cost · execution speed · fault
> tolerance · enterprise architecture.**
>
> Every finding below references the actual file/behavior in this repository.
> No source code was modified to produce this document.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Systemic Root-Cause Findings](#2-systemic-root-cause-findings)
3. [Goal Framework & Scoring Model](#3-goal-framework--scoring-model)
4. [Worker 1: Research Worker](#4-worker-1-research-worker)
5. [Worker 2: Planning Worker](#5-worker-2-planning-worker)
6. [Worker 3: Outline Worker](#6-worker-3-outline-worker)
7. [Worker 4: Writing Worker](#7-worker-4-writing-worker)
8. [Worker 5: Image Worker](#8-worker-5-image-worker)
9. [Worker 6: Quality Worker](#9-worker-6-quality-worker)
10. [Worker 7: Publish Worker](#10-worker-7-publish-worker)
11. [Cross-Cutting Infrastructure Enhancements](#11-cross-cutting-infrastructure-enhancements)
12. [Enterprise Architecture Roadmap](#12-enterprise-architecture-roadmap)
13. [Phased Implementation Plan](#13-phased-implementation-plan)
14. [KPI Targets & Measurement](#14-kpi-targets--measurement)

---

## 1. Executive Summary

The pipeline is architecturally sound: queue-per-stage isolation, idempotent
upserts, deterministic job IDs, persisted audit trails (`WorkflowRun` /
`WorkerAttempt`), per-stage quality gates, and real cost accounting
(`AIUsage`) are already in place — patterns many production systems lack.

The dominant weakness is **grounding**. The pipeline discovers topics from
headlines/RSS metadata but **never fetches the underlying articles**. Every
downstream stage — planning, outlining, writing, fact-checking — operates on
`Trend.evidenceSummary`, which is a text blob of source *titles and URLs*
built by `candidateDescription()` in `workers/research-worker/index.ts`.
The writing prompt (rule 10 in `workers/writing-worker/vertex.ts`) explicitly
forbids inventing facts, and the quality worker fact-checks against the same
thin evidence — but with only headlines to ground in, the model must either
write vaguely or hallucinate specifics. This single gap caps factual
accuracy, hallucination rate, and publishing success simultaneously.

The second systemic weakness is that **quality evaluation is ~90% regex
heuristics** (`workers/quality-worker/scorer.ts`). Heading counts, word
counts, and pattern matches are cheap and deterministic, but they measure
*shape*, not *quality* — a well-formatted but shallow article passes, and a
genuinely excellent article missing one mandatory H2 fails and burns a
rewrite cycle (real money, since writing uses `gemini-2.5-pro` by default).

The third is **operational**: single concurrency per worker
(`workerOptions(1)` everywhere), no health checks, no graceful shutdown
drain, `tsx` (JIT TypeScript) in production containers, and hand-rolled AWS
SigV4 signing in `workers/image-worker/storage.ts`.

### Maturity assessment (1–5 scale)

| Dimension | Today | Achievable | Key lever |
|---|---|---|---|
| Factual accuracy | 2 | 4.5 | Full-text evidence ingestion + RAG grounding |
| SEO | 3 | 4.5 | SERP/PAA data, internal linking, schema depth |
| Content quality | 2.5 | 4.5 | LLM-as-judge + section-wise generation |
| Reliability | 3.5 | 4.5 | Concurrency, health checks, DLQ triage |
| Hallucination rate | 2 | 4.5 | Evidence corpus + claim-level citation binding |
| Publishing success | 3 | 4.5 | Real CMS integration + pre-publish verification |
| API cost | 3 | 4.5 | Model tiering, caching, fixing cost-accounting gaps |
| Execution speed | 2.5 | 4 | Parallelism, pipeline overlap, concurrency tuning |
| Fault tolerance | 3.5 | 4.5 | Circuit breakers, in-call retries, graceful shutdown |
| Enterprise architecture | 2.5 | 4.5 | Observability, secrets, IaC, multi-env |

---

## 2. Systemic Root-Cause Findings

These five findings affect multiple workers and should be understood before
the per-worker sections.

### F1 — No full-text evidence ingestion (highest impact)
`workers/research-worker/index.ts` builds `evidenceSummary` from signal
titles + URLs only. Consequences observed in code:
- Writing prompt rule 8 requires citing "specific facts/statistics/claims"
  to source URLs — but the model has never seen those sources' content.
- `factcheck.ts` judges claims against the same titles-only evidence, so
  "unsupported" verdicts are common even for true statements, and genuinely
  fabricated statements can be marked "uncertain" rather than "unsupported".
- Prompt rule 10 has an elaborate escape hatch ("write about the general
  category instead") — a workaround for missing evidence, not a fix.

### F2 — Regex-based quality scoring
`scorer.ts` computes 9 of 11 dimensions from regular expressions:
`requiredSections` uses `startsWith` matching (a heading "What is X and why
care?" passes; "Understanding X" fails), keyword checks are substring
matches (`includes`), readability is sentence-length arithmetic. Only
Fact Verification and the vision check use a model. The score is therefore
weakly correlated with reader-perceived quality, causing both false
negatives (good articles rewritten at Pro prices) and false positives
(formulaic articles published).

### F3 — Cost-accounting leak on validation failure
In `workers/planning-worker/vertex.ts` and `workers/outline-worker/vertex.ts`,
when the model response fails Zod validation, the functions return
`model: "fallback"` **with the real token usage**. `priceForModel("fallback")`
returns $0 (see `workers/shared/pricing.ts` `MODEL_PRICING`), so burned
tokens vanish from the dashboard. Same pattern exists anywhere a fallback is
returned after a real API call. Costs are under-reported exactly when the
pipeline misbehaves.

### F4 — Retry granularity is too coarse for LLM calls
`workers/shared/vertex.ts` has per-call timeouts (30s default, 120s writing,
45s semantic) but **zero in-call retries**. Any transient 429/500 from
Vertex fails the whole BullMQ job, which re-runs the entire stage —
including its DB reads and, for writing, a full ~8k-token regeneration.
The BullMQ backoff (`0s, 30s, 60s` in `worker-options.ts`) is job-level,
so one flaky second at Vertex costs an entire stage re-execution.

### F5 — Single-flight execution
Every worker is constructed with `workerOptions(1)` (concurrency 1). With
`TRENDS_TO_WRITE_PER_RUN=5` and 3 research runs/day, up to 15 blogs/day are
processed strictly serially through each stage. Writing at ~60–120s per
draft plus image (~10–90s) plus quality (~10–20s) means the pipeline has a
hard ceiling far above the daily target — but with zero headroom for
retries, recovery loops, or a backlog catch-up, and no horizontal
parallelism despite the queue-per-stage design already supporting it.

---

## 3. Goal Framework & Scoring Model

Throughout this document, each enhancement is tagged with the goals it
serves:

| Tag | Goal |
|---|---|
| **FA** | Higher factual accuracy |
| **SEO** | Better SEO |
| **CQ** | Better content quality |
| **REL** | Higher reliability |
| **HAL** | Lower hallucination rate |
| **PUB** | Higher publishing success rate |
| **COST** | Lower API cost |
| **SPD** | Faster execution |
| **FT** | Stronger fault tolerance |
| **ENT** | Enterprise-grade architecture |

Priority legend: **P0** = do first (high impact, low effort) · **P1** = high
impact · **P2** = valuable · **P3** = nice to have.

---

## 4. Worker 1: Research Worker

**Current design** (`workers/research-worker/`): 11 sources →
`normalizeSignals` → heuristic `dedupeSignals` (title similarity ≥ 0.55,
keyword overlap ≥ 3, URL/fingerprint match) → Vertex `semanticEnrich`
(batches of 15, relevance 0–100 + intra-batch duplicate detection,
union-find merge) → weighted `scoreClusters` (strongest×0.55 + avg×0.15 +
multi-source×0.10 + semantic×0.20) → `promotableCandidates` (≥70) → DB
dedupe (same-day exact + 30-day `contains`) → save `Trend(NEW)` → dispatch
top-N (≥90) to planning.

### Observed weaknesses

1. **Headline-only evidence** (F1). `candidateDescription()` keeps top-5
   evidence lines; article bodies are never fetched.
2. **`dedupeSignals` is O(n²)** — `clusters.find(...)` per signal, each
   scanning every member of a cluster. At 11 sources × 25 signals = 275
   signals it's fine; it will not scale to more sources or larger
   `RESEARCH_MAX_SIGNALS_PER_SOURCE`.
3. **Semantic dedup only works within a batch** (documented trade-off in
   `semantic.ts`): the same story appearing in two different 15-cluster
   batches survives as two trends.
4. **DB dedupe uses `topic: { contains: ... }`** — a case-insensitive
   substring scan against 30 days of trends per candidate. Both a false
   positive risk ("Gemini" matching "Gemini CLI" vs "Google Gemini") and a
   query-plan risk (`%...%` can't use the `(topic, createdAt)` index).
5. **Scoring is source-shape-driven, not outcome-driven**: weights are
   hand-picked constants; there is no feedback loop from "did the resulting
   blog pass QA / get published / get traffic".
6. **`fetchWithRetry` retries on any non-OK status** (including permanent
   404s — `ANTHROPIC_NEWS_RSS` is *known* to 404 and burns
   `RESEARCH_RETRY_COUNT` attempts every run) with linear `attempt × 500ms`
   backoff and no jitter — a thundering-herd pattern against rate-limited
   hosts.
7. **Evidence truncation at 5 lines** (`candidateDescription` slices
   `evidence.slice(0, 5)`) — cross-source corroboration beyond 5 signals is
   silently discarded even though it's the strongest accuracy signal.

### Enhancements

**R1 · Full-text evidence ingestion — P0 · FA HAL CQ COST(paradoxically lowers rewrite spend)**
Add an `evidence-fetch` sub-stage after promotion: for each promoted
cluster, fetch the top 2–3 source URLs with a readability extractor
(Mozilla Readability + `jsdom`, or `@extractus/article-extractor`), cap at
~4k chars each, and store as structured JSON on `Trend`
(`evidenceArticles: [{url, title, excerpt, fetchedAt}]`) alongside the
existing summary. Every downstream prompt gets real grounding material
instead of headlines. Failure mode: fetch fails → fall back to today's
titles-only behavior (no regression risk).

**R2 · Cross-run embedding dedupe — P1 · FA COST**
Replace substring DB dedupe with embedding-based similarity: embed each new
cluster title+keywords (Gemini embedding model, ~$0.00001/call), store a
`vector` column via `pgvector`, and dedupe with cosine distance ≥ ~0.9
within the 30-day window. Kills both the false-positive substring matches
and the cross-batch semantic-dedup gap (F3 in `semantic.ts`). Index with
IVFFlat/HNSW for O(log n) lookups.

**R3 · Smarter fetch retry policy — P1 · FT SPD COST**
- Classify errors: retry only 429/5xx/timeouts; fail fast on 4xx (404s are
  permanent — the Anthropic feed currently wastes 2 retries × 15s per run).
- Exponential backoff with full jitter: `min(cap, base × 2^attempt) × random()`.
- Honor `Retry-After` headers on 429.
- Add a per-source circuit breaker: after N consecutive failures, disable
  the source for M hours (persist in `AppSetting` so it survives restarts)
  and surface it on the dashboard — dead feeds currently fail silently
  forever (see the env.ts comment about previously dead defaults).

**R4 · Outcome-feedback scoring — P2 · CQ PUB**
Join `Trend` → `Blog.qualityReport.overallScore` / `status` and feed the
realized pass rate per `(source, category)` back into `score.ts` weights.
Start as a nightly rollup into `AppSetting`; graduate to a learned model
later. Today a source that reliably produces QA-failing trends is scored
identically to one that reliably publishes.

**R5 · Signal freshness + velocity — P2 · CQ PUB**
`freshnessScore` buckets by age only. Add velocity: re-fetch the same story
across runs and score the *delta* in engagement (HN score delta, GitHub
stars delta). Breakout stories mid-day currently wait for the next slot
with no priority boost.

**R6 · Structured source health metrics — P1 · REL ENT**
Persist per-source run stats (signals fetched, latency, error class) into a
`SourceHealth` table or `LogEntry.meta` with a fixed schema, and chart it in
`/dashboard/workers`. "Failed sources" currently exist only as strings in
one worker log line.

**R7 · Cluster-aware evidence budget — P2 · FA COST**
When a cluster merges 8 signals, keep all 8 in DB but select evidence for
prompts by diversity (max 1–2 per domain) instead of "first 5". More
corroboration into the writer = fewer single-source hallucinations.

---

## 5. Worker 2: Planning Worker

**Current design** (`workers/planning-worker/`): one Flash JSON call → Zod
validate → fallback plan on parse failure → field gate (6 fields, −15/miss,
≥90) → upsert `ContentPlan` → outline queue.

### Observed weaknesses

1. **Cost-accounting leak (F3)**: schema-failure path returns
   `model: "fallback"` with real usage → $0 recorded for burned tokens.
2. **No `responseSchema` passed to `generateVertexJson`** — relies on
   prompt-only JSON shaping, then Zod catches the fallout. Vertex supports
   constrained decoding (`responseSchema`); using it would push the schema-
   failure rate to ~zero.
3. **Keywords are invented, not measured**: `primaryKeyword` /
   `secondaryKeywords` come from the model's intuition. No search volume,
   difficulty, or SERP composition data informs the choice — the core SEO
   decision of the whole pipeline is currently ungrounded.
4. **`competitorNotes` are generic** ("how to make this better than generic
   coverage") because the planner has never seen the actual competitors.
5. **Fallback plan silently passes the gate** — `fallbackPlan()` fills all
   6 gated fields, so a degraded plan proceeds downstream indistinguishably
   from a real one. Downstream stages can't tell.

### Enhancements

**P1-1 · Use constrained decoding — P0 · REL COST SPD**
Pass a Zod-derived JSON schema as `responseSchema` in the
`generateVertexJson` call (planning, outline, semantic, fact-check — all
four). Eliminates the retry-worthy parse-failure class entirely and removes
the fallback-plan path in production.

**P1-2 · Record real model on fallback — P0 · COST**
When validation fails after a real call, record usage against the actual
model string and add a `fallbackUsed: true` flag (new nullable column on
`AIUsage` or a `LogEntry` WARN). Dashboard then shows true spend *and* an
alertable degradation signal.

**P1-3 · SERP-grounded keyword strategy — P1 · SEO FA**
Integrate a SERP/keyword API (DataForSEO, SerpAPI, or scraping Google
"People Also Ask"): fetch top-10 results + PAA questions for the candidate
primary keyword, and pass them into the planning prompt. `competitorNotes`
become real gap analyses ("SERP lacks an implementation-focused guide"),
and keyword choice gets volume/difficulty data. Cache SERP responses 24h in
a table — the same keyword repeats across related trends (COST).

**P1-4 · Plan quality gate upgrade — P2 · CQ**
Extend `scoreRequiredFields` with substance checks: primary keyword ≤ 6
words (long-tail keyword stuffing shows up as sentence-length "keywords"),
secondary keywords count within 4–8 (per the prompt contract), angle must
not contain the topic verbatim (catches lazy paraphrase plans).

**P1-5 · Mark degraded plans — P2 · REL ENT**
Add `ContentPlan.degraded: Boolean` set when the fallback path ran.
Dashboard badge + the writing worker can lower its expectations or skip
(cheaper to skip than to generate a Pro-priced article from a hollow plan).

---

## 6. Worker 3: Outline Worker

**Current design** (`workers/outline-worker/`): one Flash JSON call from
the plan → gate (title/slug/meta present, sections ≥ 6, FAQs ≥ 3) → upsert
`ContentOutline` → writing queue.

### Observed weaknesses

1. **Prompt/gate mismatch**: prompt asks for "5–8 sections and 3–5 FAQs",
   gate requires ≥ 6 sections — a compliant 5-section response fails the
   gate and retries the whole job.
2. **Mandatory structure lives in the writer, not the outliner**: the
   writing prompt dictates 13 fixed H2s (What is / Why it matters / …),
   ignoring the outline's section design. So the outline stage generates
   sections the writer is instructed to reshape — wasted tokens and a
   contradiction that confuses both models.
3. **No search-feature targeting**: FAQs are model-invented rather than
   sourced from PAA data; no featured-snippet optimization (definition
   blocks, step lists); no internal-link plan.
4. **Slug collisions discovered late**: outline proposes a slug but
   uniqueness is only resolved in the writing worker (`uniqueSlug`), so the
   outline's slug is advisory at best.

### Enhancements

**O1 · Align prompt contract with gate — P0 · REL COST**
Prompt for "6–8 sections and at least 3 FAQs" (or relax the gate to ≥5).
One-line change; removes a guaranteed-failure band.

**O2 · Make outline the single source of structure — P1 · CQ SEO COST**
Move the mandatory H2 skeleton from the writing prompt into the outline
stage: the outline emits the *final* section list (respecting the required
sections) with per-section intent, bullets, target word counts, and the
evidence URLs each section must cite. The writer then expands section by
section (see W2) instead of re-deriving structure. This removes the
prompt-contradiction failure mode and shrinks the writing prompt
measurably.

**O3 · PAA-driven FAQs — P1 · SEO**
When P1-3 (SERP data) lands, generate FAQ questions from real PAA entries
(matched to the primary keyword), not model intuition. This directly
targets Google's "People also ask" boxes — the cheapest organic-traffic win
available to this pipeline.

**O4 · Snippet & schema planning — P2 · SEO**
Have the outline designate: (a) a 40–60 word definition paragraph for the
"What is" section (featured-snippet shaped), (b) which sections get
HowTo/FAQPage JSON-LD, (c) 3–5 internal link anchors pointing at existing
published blogs (query `Blog` for same-category slugs). Internal linking is
currently zero — every published post is an orphan.

**O5 · Early slug reservation — P3 · REL**
Check slug availability during outline and store the resolved unique slug
on `ContentOutline.slug`, letting the writer reuse it. Removes one
failure/retry edge from writing.

---

## 7. Worker 4: Writing Worker

**Current design** (`workers/writing-worker/`): single Pro text call
(8192 max tokens, temp 0.35, 120s timeout) → cost recorded → heuristic gate
(score ≥ 90: H1, ≥8 H2s, FAQ, CTA, ≥2 verbatim evidence URLs, word/table/
code heuristics) → markdown→HTML via `marked` → unique slug → upsert
`Blog(DRAFT)` + `BlogSEO` → image queue. QA recovery feeds prior failure
reasons back as `priorAttempt`.

### Observed weaknesses

1. **One-shot monolithic generation**: a 1200–2000-word article in a single
   completion. Long outputs degrade mid-document (repetition, section
   thinning) — and `hasDuplicateParagraphs` in the scorer exists precisely
   because this happens.
2. **Citation check is verbatim-URL substring matching** (`citationCheck`):
   `markdown.includes(url)`. A model that cites `https://example.com/a`
   with a trailing slash difference, or as a reference-style link, fails
   the gate despite genuinely citing the source. Conversely, URL-dropping
   without substantive use passes.
3. **Hallucination control is prompt-only**: rule 10 (don't invent numbers)
   is advisory. There is no post-generation verification between writing
   and quality — a fabricated claim travels all the way to the fact-check
   stage before anyone looks.
4. **Gate requires ≥8 H2s but prompt mandates ~13** — and the scorer's
   `requiredSections` check is `startsWith`-based, so natural paraphrases
   ("Understanding X") fail and force a Pro-priced rewrite.
5. **`generateMock` produces gate-failing content by design** ("Draft
   unavailable" markdown can never pass 90) — in an unconfigured
   environment the pipeline burns 4 BullMQ attempts per blog on a
   guaranteed failure instead of failing fast.
6. **No regeneration targeting**: the recovery loop reuses the *same*
   prompt plus failure reasons. If the failure is structural (missing
   section), a full 8k-token regeneration fixes a 200-word problem.
7. **Temperature 0.35 with no variation across retries** — attempt 2 asks
   the same model at the same temperature with a scolding appended; lexical
   diversity gains are marginal.
8. **SEO fields are outline hand-me-downs**: `metaTitle`/`metaDescription`
   truncated to 60/160 with `slice()` — a hard cut mid-word is possible.
   No canonical URL, no OpenGraph/Twitter metadata, no `datePublished` in
   the JSON-LD (the `checkJsonLd` helper in `lib/seo.ts` already flags
   `datePublished` as recommended but the writer never sets it).

### Enhancements

**W1 · Evidence-grounded drafting (depends on R1) — P0 · FA HAL CQ**
Pass the fetched article excerpts (structured, URL-keyed) into
`buildPrompt` instead of the titles-only summary. Require claims to bind to
`[S1]…[Sn]` source markers, then post-process markers into real inline
Markdown links. This converts citations from "hope the model pastes a URL"
to deterministic, verifiable link construction — and lets the citation gate
check *claims*, not substrings.

**W2 · Section-wise generation with assembly — P1 · CQ SPD COST**
Generate the article in parallel per-section calls (each 150–400 tokens,
Flash-class), driven by the outline's section plan (O2): intro + N sections
+ FAQ + conclusion. Benefits: (a) parallelism cuts wall-clock time ~3–4×;
(b) a failed section retries alone instead of the whole article;
(c) per-section temperature control (lower for "How it Works", higher for
"Why it matters"); (d) cheaper model per section with a single Pro-class
"editor pass" at the end for voice cohesion. Net cost typically *drops*
while quality rises.

**W3 · Targeted repair instead of full rewrite — P1 · COST SPD PUB**
On QA failure with structural reasons (missing section, missing FAQ),
generate *only the missing pieces* and splice them into the existing
markdown (the Blog row is already upserted — extend this to section-level
patches). Reserve full regeneration for fact-check/voice failures. Cuts
recovery cost by ~80% for the most common failure class.

**W4 · Robust citation verification — P1 · FA HAL REL**
Replace substring matching: extract all Markdown link URLs from the draft,
normalize (strip trailing slash, `www.`, protocol, tracking params), and
compare against the normalized evidence URL set. Require ≥2 distinct
*domains*. Simultaneously reject citations to domains not in evidence
(possible fabricated-URL detection) as a soft warning into the gate
`reasons`.

**W5 · Pre-gate self-check pass — P2 · CQ COST**
Before the heuristic gate, run a cheap Flash self-review: "Does this draft
contain any specific number/date/version not present in EVIDENCE? List
them." Cheap (~1k tokens), catches the exact hallucination class the
pipeline is most exposed to *before* the draft hardens into a Blog row.

**W6 · Fail fast when unconfigured — P1 · COST REL**
If `!isVertexConfigured`, throw a non-retryable error (BullMQ
`UnrecoverableError`) instead of returning mock content that can never pass
the gate. Saves 4 attempts × N queued blogs of pure waste in misconfigured
deployments.

**W7 · Complete the SEO metadata — P1 · SEO**
Generate (or derive deterministically): canonical URL from a configured
`SITE_BASE_URL`, OG/Twitter card fields, `datePublished`/`dateModified` and
`image` in the TechArticle JSON-LD, FAQPage schema from the FAQ section,
and clean truncation of meta fields at word boundaries. All are
near-free (string ops) and `lib/seo.ts`'s own checker already expects them.

**W8 · Retry diversity — P2 · CQ HAL**
Vary the retry prompt: temperature 0.35 → 0.5 on attempt 2+, and rotate the
"angle" instruction (e.g., emphasize a different secondary keyword). A
deterministic retry of a failed draft converges to a similar draft.

---

## 8. Worker 5: Image Worker

**Current design** (`workers/image-worker/`): idempotent skip → subject
from `plan.primaryKeyword || trend.topic || title` → up to 3 AI generations
(gemini-2.5-flash-image, 8 rotating style directions hashed by
`trendId:attempt`) → dimension check → dHash uniqueness vs last 50 assets
(Hamming < 10 = duplicate) → procedural SVG fallback (up to 5 salted seeds)
→ S3 upload (hand-rolled SigV4) → gate → `Asset` + link → quality queue.

### Observed weaknesses

1. **Hand-rolled SigV4 signer** (`storage.ts`) — the highest-risk single
   file in the repo: signing bugs surface as intermittent 403s, it can't
   handle every S3-compatible endpoint, and it re-implements what the AWS
   SDK guarantees.
2. **Uniqueness check burns paid generations**: each too-similar result
   costs a full image call (up to 3/blog). The dHash pool is only the last
   50 assets, so duplicates beyond that window pass anyway.
3. **No alt text anywhere**: `Asset` has no `altText` column and the writer
   never emits one — an accessibility and image-SEO hole for every article.
4. **Subject is a bare keyword**: `buildHeroPrompt` gets
   `"isometric illustration depicting: kubernetes cost optimization"` —
   workable, but title/angle context (available on the payload) is unused,
   so art direction is generic.
5. **No responsive variants**: one 16:9 asset serves all breakpoints; no
   WebP/AVIF, no srcset sizes, no blur placeholder (LQIP) — LCP suffers on
   the eventual frontend.
6. **S3 delete on gate failure has no retry** (`deleteFromS3(...).catch(log)`)
   — orphaned objects leak slowly.
7. **Vision QA happens in the quality worker after upload** — a bad image
   is discovered two stages later, after S3 upload + Asset row creation.

### Enhancements

**I1 · Adopt AWS SDK v3 (`@aws-sdk/client-s3`) — P0 · REL FT ENT**
Delete the SigV4 implementation. Gains: automatic retries with jitter,
regional endpoint resolution, IAM-role credentials (no long-lived keys in
env — see ENT section), multipart for large assets, and maintained
correctness. Same for the delete path.

**I2 · Generate alt text in the same flow — P1 · SEO FA**
After a successful generation, one tiny Flash text call ("Describe this
image for alt text, ≤125 chars, for an article about {title}") — or reuse
the quality worker's vision call by *moving it here*: assess relevance +
appeal + produce alt text in one vision call, pre-upload. Store on
`Asset.altText`; write it into the article HTML `<img alt>` and OG tags.

**I3 · Pre-upload vision gate — P1 · COST PUB SPD**
Move the vision relevance check (`assessFeaturedImage` in scorer.ts) into
the image worker *before* S3 upload: reject/regenerate irrelevant images
while regeneration is still cheap and local, instead of failing Media
Quality in QA and looping the article. Quality worker keeps a lightweight
confirmation using the stored assessment.

**I4 · Cheap-first uniqueness — P2 · COST**
Before each paid regeneration, perturb the *prompt* (style direction +
composition adjective + palette) and only then call the model. Also
increase `UNIQUENESS_LOOKBACK` or persist hashes to a Redis set for O(1)
lookup — 50-row lookback is arbitrary and query-bound.

**I5 · Responsive image pipeline — P2 · SPD(user-perceived) SEO ENT**
Use the already-present `sharp` dependency to emit 3 widths
(768/1200/1920) + WebP/AVIF + a 20px LQIP base64, stored as one `Asset`
with a `variants` JSON column. Upload all variants in parallel.

**I6 · Orphan reaper — P3 · FT COST**
A nightly job listing `blogs/` prefixes vs `Asset.path` and deleting
unreferenced objects; closes the leak from I1's predecessor and any future
gate-failure cleanup misses.

---

## 9. Worker 6: Quality Worker

**Current design** (`workers/quality-worker/`): 11 checks (9 regex
heuristics + vision relevance/appeal + Vertex fact-check vs
`evidenceSummary`) → normalized 0–100 → pass = `overall ≥ 90 && factCheck
≥ 70` → publish queue (deterministic jobId) / writing requeue (≤4 attempts)
/ `FAILED` + daily-target reconcile.

### Observed weaknesses

1. **Heuristic-dominant scoring (F2)** — shape over substance.
2. **Fact-check grounds against headlines** (F1): verdict quality is capped
   by evidence thinness; "unsupported" often means "not mentioned in the 5
   title lines".
3. **Fact-check samples only 5–8 claims** and the *choice* of claims is
   model-made — a draft with one egregious fabrication among 20 claims can
   dodge extraction.
4. **Fails open on fact-check outage** (by design, documented) — acceptable
   for availability, but there's no alerting when the null-rate climbs;
   unverified articles could publish silently for days.
5. **Threshold 90 with an averaged score** means one dimension at 4/10 is
   fine if others are 10s — a readability disaster with perfect formatting
   passes.
6. **Recovery requeues carry the full gate report into the writing prompt**
   — good — but reasons are label/score pairs ("Readability: 6/10"), not
   actionable edits ("split the 180-word paragraph in section 3").
7. **Vision assessment fetches the image over the public internet**
   (`fetch(publicUrl)`) right after the worker uploaded it — an avoidable
   egress + latency cost, and it breaks if the CDN URL isn't yet
   propagated (returns null → silently skips the check).

### Enhancements

**Q1 · LLM-as-judge holistic dimension — P1 · CQ FA**
Add a 12th check: a Pro/Flash judge prompted with a rubric (depth,
accuracy-of-tone, originality, usefulness vs the plan's search intent)
returning scored sub-dimensions + *specific, actionable critique*. Weight
it ~20–30% of the overall score. Keep the regex checks as cheap floor
guards. This is the single biggest quality-measurement upgrade available.

**Q2 · Per-dimension floors — P1 · CQ PUB**
Replace "average ≥ 90" with "average ≥ 90 AND every dimension ≥ 6 AND
factVerification ≥ 7". Prevents a collapse in any single dimension from
being averaged into a pass.

**Q3 · Claim-coverage fact-check (depends on R1) — P1 · FA HAL**
With full-text evidence: extract claims deterministically first (regex for
numbers/dates/versions + model extraction for capability claims), verify
*every* extracted claim (batched), and report coverage %. Keep the 70
hard-gate but compute it over all claims, not a 5–8 sample. Flag
claims with no evidence binding as `unverifiable` and cap the score when
unverifiable > 30%.

**Q4 · Actionable recovery payloads — P1 · COST SPD PUB**
Have the judge (Q1) emit machine-actionable fixes:
`{section: "How it Works", issue: "missing step detail", fix: "expand step 2 with the config example"}`.
Feed these into W3's targeted repair. Rewrites stop being blind.

**Q5 · Fact-check health telemetry — P1 · REL ENT**
Track null-rate of `runFactCheck` and vision assessment (emit a metric per
run); alert when null-rate > 20% over a day. Failing open is only safe if
someone knows it's open.

**Q6 · Pass the image bytes directly — P2 · COST SPD REL**
Image worker already holds the buffer — store it (or its S3 key) and let
the quality worker fetch via S3 GET (or accept base64 through a short-lived
Redis key) instead of the public CDN URL. Removes the propagation race and
external fetch. (Subsumed by I3 if vision moves to the image worker.)

**Q7 · Calibrated thresholds — P2 · PUB COST**
Log the joint distribution (overallScore, pass/fail outcome, human override
decisions from `override-publish`) for 2–4 weeks, then set thresholds from
data. The current 90/85/70 constants are uncalibrated guesses; the
override-publish route already collects the human ground truth needed.

---

## 10. Worker 7: Publish Worker

**Current design** (`workers/publish-worker/index.ts`): integrity checks
(report exists, ID matches) → gate (QA ≥ 90, image, SEO, content, HTML) →
atomic `updateMany` status flip → PUBLISHED. No external integration exists
yet — "deploy to production" is a DB update.

### Observed weaknesses

1. **No actual publication surface**: no CMS webhook, no static-site
   rebuild trigger, no git-based content commit — nothing leaves the
   database. `PUBLISH_WEBHOOK_URL` from the README isn't even read in
   `env.ts`.
2. **No post-publish SEO actions**: no sitemap regeneration, no Google
   Indexing API / IndexNow ping, no canonical registration.
3. **No post-publish verification**: nothing confirms the URL is live and
   renders (200 + expected title) before declaring success.
4. **No rollback path**: unpublishing requires manual DB edits; no
   `ARCHIVED` flow is wired to any API route.
5. **Failure → PENDING_REVIEW is silent**: a publication outage loops
   articles back to review with no operator notification beyond logs.

### Enhancements

**PB1 · Publisher adapter interface — P1 · PUB ENT**
Define a `Publisher` port: `publish(blog) → { url }`, `unpublish(blog)`,
`verify(url) → boolean`. Ship two adapters: (a) webhook adapter
(`PUBLISH_WEBHOOK_URL` with HMAC signature + retries), (b) file/git adapter
(markdown+frontmatter commit to a content repo, triggering a static build).
Keep the DB flip as the transactional core; adapters are side effects
*after* the commit point, with their own retry queue (`publish_retry`)
rather than failing the job.

**PB2 · Post-publish verification loop — P1 · PUB REL**
After adapter success: fetch the URL (retry 3× over 5 min), assert 200 +
`<title>` match + JSON-LD presence. Only then set
`WorkflowRun.currentStage = "complete"`; otherwise `PENDING_REVIEW` +
alert. Turns "published" from a claim into a checked fact.

**PB3 · Indexing & syndication — P1 · SEO SPD(discovery)**
On verified publish: regenerate sitemap, call IndexNow (Bing/Yandex) and
Google Indexing API (allowed for JobPosting/BroadcastEvent — otherwise rely
on sitemap ping), and optionally fan out to social/webhook channels
(Zapier/Make-compatible). Zero of these exist today.

**PB4 · Rollback + archive API — P2 · REL ENT**
`POST /api/blogs/[id]/archive` → adapter `unpublish` → status ARCHIVED +
LogEntry audit. Completes the Blog status state machine's un-wired edge.

**PB5 · Publish notifications — P2 · REL ENT**
Slack/email webhook on publish success/failure with title, score, URL. The
dashboard is pull-only; production systems need push for the terminal stage.

---

## 11. Cross-Cutting Infrastructure Enhancements

### 11.1 Vertex call layer (`workers/shared/vertex.ts`)

| Change | Goals | Priority |
|---|---|---|
| In-call retry with exponential backoff + jitter for 429/5xx (2 attempts) before surfacing to BullMQ — reuses the same prompt, avoids whole-stage reruns | FT COST SPD | **P0** |
| Singleton `GoogleGenAI` client (currently constructed per call — extra auth handshakes per request) | SPD | **P0** |
| Use `responseSchema` constrained decoding for all JSON calls (planning, outline, semantic, fact-check, vision) | REL COST | **P0** |
| Distinguish timeout vs rate-limit vs content-block errors (typed errors) so BullMQ backoff can differ: long backoff for 429, immediate for parse, never-retry for `SAFETY` blocks | FT COST | P1 |
| Response caching: hash(model+prompt) → Redis, 24h TTL, for idempotent calls (semantic scoring identical clusters across runs; SERP data; fact-check on unchanged content) | COST SPD | P1 |
| Token budgets per stage per day (circuit breaker on spend): if today's `AIUsage.cost` > `DAILY_COST_CAP`, degrade gracefully (skip semantic pass, drop to Flash for writing) instead of discovering the bill later | COST ENT | P1 |
| `isVertexConfigured` startup probe (documented gap in env.ts): one lightweight authenticated call at boot, cached — detects ADC-only setups and fails loudly | REL ENT | P1 |

### 11.2 Queue & worker runtime

| Change | Goals | Priority |
|---|---|---|
| Raise concurrency per stage from measured bottleneck data (e.g., writing 2–3, research semantic batches already parallel) — `workerOptions(1)` everywhere is the throughput ceiling (F5) | SPD | **P0** |
| Graceful shutdown: on SIGTERM call `worker.close()` (drains active jobs, stops lock renewal) before `process.exit` — `start.ts` currently exits immediately, forfeiting in-flight jobs to stalled-job recovery | FT REL | **P0** |
| Real dead-letter handling: after `attempts: 4`, move to a `dlq_*` queue with a `/dashboard/workers` triage action (re-drive with original payload) instead of the unbounded failed set | FT ENT | P1 |
| Job-level progress reporting (`job.updateProgress`) in long stages (writing section-wise, image attempts) → live dashboard stage bars | ENT REL | P2 |
| Queue pause/resume API for maintenance windows | ENT | P3 |

### 11.3 Data & persistence

| Change | Goals | Priority |
|---|---|---|
| `pgvector` for trend dedupe + future semantic blog similarity ("have we already covered this angle?") | FA CQ | P1 |
| Archive partitions / retention jobs for `WorkerAttempt`, `AIUsage`, `LogEntry` (attempts grow unbounded today; only LogEntry is pruned) | ENT COST(DB) | P1 |
| Soft-delete/audit columns on Blog (`publishedAt`, `publishedUrl`, `archivedAt`) — publish timestamp currently doesn't exist as a column | ENT PUB | P1 |
| DB indexes review: `Blog(status, updatedAt)` composite for the daily-target queries; `AIUsage(worker, createdAt)` exists but dashboard's model rollup scans `createdAt`-first | SPD | P2 |

### 11.4 Observability

| Change | Goals | Priority |
|---|---|---|
| Structured metrics export (Prometheus `/metrics` on each worker: job durations by stage, queue depth, Vertex latency/error rate, cost burn rate) | ENT REL | P1 |
| Distributed tracing: propagate `workflowRunId` as a trace ID through job payloads; adopt OpenTelemetry with a Jaeger/Tempo exporter | ENT | P2 |
| Sentry (or equivalent) for worker exceptions with `workflowRunId`/`blogId` tags | REL ENT | P1 |
| Alerting rules: queue depth > N for > 30 min; daily published < target at 21:00 checkpoint; fact-check null-rate; cost/day > cap | REL ENT | P1 |
| The existing 10am/4pm/9pm expectation checkpoints (in `app/api/dashboard/route.ts`) should emit WARN logs when behind — currently UI-only | REL | P2 |

### 11.5 Security & configuration

| Change | Goals | Priority |
|---|---|---|
| Secrets manager (GCP Secret Manager / AWS SSM / Doppler) instead of `.env` + bind-mounted service-account key; rotate `redsxp-client-*.json` out of the repo tree | ENT | **P0** |
| Dashboard/API authentication (currently zero auth on every route — anyone who can reach the port can approve trends, override-publish, and edit settings) | ENT | **P0** |
| Zod-validate all env at boot (`env.ts` currently falls back silently; a typo'd number becomes NaN deep in a worker) | REL ENT | P1 |
| Network egress policy for workers (only Vertex/S3/source domains) in production | ENT | P2 |
| Rate limiting on mutation API routes | ENT | P2 |

### 11.6 Deployment

| Change | Goals | Priority |
|---|---|---|
| Compile workers (`tsc`/`esbuild` bundle) and run `node dist/...` in containers — `tsx` JIT in production costs startup time and hides type errors until runtime | REL SPD ENT | P1 |
| Container healthchecks + `depends_on: condition: service_healthy` for postgres/redis (compose currently starts workers against not-yet-ready services; the restart:always loop papers over it) | FT ENT | P1 |
| Resource limits/requests per worker; writing + quality are memory-heavier (large prompts) | ENT FT | P2 |
| Multi-stage Dockerfile already implied — extend with a dedicated worker build stage that prunes devDependencies | ENT COST | P2 |
| IaC for the real environment (Terraform/Pulumi for Cloud Run/GKE + Memorystore + Cloud SQL) — docker-compose is a dev topology | ENT | P2 |

---

## 12. Enterprise Architecture Roadmap

Where the system is heading if the enterprise dimension is fully pursued:

```
                        ┌────────────────────────────┐
                        │  Control Plane (Next.js)   │
                        │  AuthN/Z · RBAC · Audit UI │
                        └─────────────┬──────────────┘
                                      │
        ┌─────────────────────────────┼──────────────────────────────┐
        │                             │                              │
┌───────▼────────┐         ┌──────────▼─────────┐         ┌──────────▼─────────┐
│ Postgres HA     │         │ Redis (queues)     │         │ Observability      │
│ Cloud SQL +     │         │ Memorystore +      │         │ OTel → traces      │
│ PITR + pgvector │         │ persistence + ACL  │         │ Prometheus → alerts│
└───────▲────────┘         └──────────▲─────────┘         │ Sentry → exceptions│
        │                             │                    └──────────────────────┘
┌───────┴─────────────────────────────┴─────────┐
│              Worker Fleet (GKE/Cloud Run)      │
│  HPA per stage · spot pools for research ·     │
│  secrets from Secret Manager · Workload Ident. │
└───────┬───────────────────────────┬───────────┘
        │                           │
┌───────▼────────┐        ┌─────────▼──────────┐
│ Evidence Store │        │ Publisher Mesh     │
│ (article text, │        │ webhook / git-CMS  │
│ embeddings,    │        │ adapters + verify  │
│ SERP cache)    │        │ + IndexNow fan-out │
└────────────────┘        └────────────────────┘
```

Key transitions:
1. **From scripts to services** — workers become long-running services with
   health endpoints, metrics, and graceful lifecycle (currently CLI
   processes with `restart: always`).
2. **From env vars to configuration service** — `AppSetting` grows versioned
   config with change audit (who changed the writing model, when, what was
   it before).
3. **From prompts in code to prompt registry** — the 8 files in `prompts/`
   become versioned, A/B-testable artifacts with evaluation harnesses
   (promptfoo-style golden sets per stage).
4. **From one-tenant to brand-voice profiles** — the DevKit persona
   hardcoded in `buildPrompt` moves to a `BrandProfile` table (tone, banned
   phrases, CTA templates, required disclaimers).
5. **From best-effort to SLOs** — e.g., "95% of trends reaching planning
   before 09:00 are published or terminally failed by 21:00", measured from
   `WorkflowRun` timestamps, with error budgets governing retry policy.

---

## 13. Phased Implementation Plan

### Phase 0 — Correctness & cost hygiene (1 week, pure wins, no behavior risk)
1. Pass `responseSchema` to all JSON Vertex calls (P1-1, 11.1).
2. Fix cost accounting on validation-fallback paths (P1-2).
3. Align outline prompt with its gate (O1).
4. Singleton GenAI client + in-call retry with typed errors (11.1).
5. Fail fast with `UnrecoverableError` when Vertex unconfigured (W6).
6. Graceful shutdown drain (11.2).
7. Auth middleware on dashboard/API + secrets migration (11.5).
8. Fix `fetchWithRetry` to skip permanent 4xx + jittered backoff (R3).

**Expected effect**: true cost visibility, elimination of the guaranteed-
waste paths, ~10–20% fewer job-level retries.

### Phase 1 — Grounding (2–3 weeks, the accuracy/hallucination leap)
1. Full-text evidence ingestion + `evidenceArticles` storage (R1).
2. Claim-marker citation protocol in writing (W1) + robust citation
   verification (W4).
3. Fact-check over full claim coverage with unverifiable-cap (Q3).
4. pgvector trend dedupe (R2).
5. Pre-upload vision gate + alt text (I2, I3).

**Expected effect**: factual accuracy 2→4, hallucination rate cut by an
order of magnitude for numeric/capability claims, citation gate stops
producing false rewrites.

### Phase 2 — Quality measurement & SEO depth (2–3 weeks)
1. LLM-as-judge dimension + per-dimension floors (Q1, Q2).
2. Actionable recovery payloads + targeted repair (Q4, W3).
3. SERP/PAA integration for planning + outline FAQs (P1-3, O3).
4. Outline as single source of structure; snippet/schema/internal-link
   planning (O2, O4).
5. Complete metadata: canonical, OG, datePublished, FAQPage JSON-LD (W7).
6. AWS SDK migration (I1).

**Expected effect**: QA pass/fail correlates with human judgment (measured
against override-publish history), rewrite cost per failure −60–80%,
organic search features (PAA, snippets, rich results) become reachable.

### Phase 3 — Throughput & publish surface (2 weeks)
1. Section-wise parallel writing (W2) + concurrency tuning from metrics
   (11.2).
2. Publisher adapter + verification + indexing fan-out (PB1–PB3).
3. Responsive image variants (I5).
4. DLQ + triage UI, alerting rules (11.2, 11.4).

**Expected effect**: 3–4× pipeline throughput, publication becomes real and
verified, daily target resilient to retry storms.

### Phase 4 — Enterprise hardening (ongoing)
Prompt registry + eval harnesses · brand profiles · SLOs/error budgets ·
IaC + HA topology · RBAC · cost analytics per brand/model · feedback loop
from published-article performance into research scoring (R4).

---

## 14. KPI Targets & Measurement

Instrument first, then manage. All measurable from existing tables
(`AIUsage`, `WorkerAttempt`, `QualityReport`, `WorkflowRun`) plus the
proposed additions.

| KPI | Today (est.) | Phase 1 | Phase 3 | Source |
|---|---|---|---|---|
| Fact-check supported-claim rate | ~unknown (thin evidence) | ≥ 85% | ≥ 92% | `QualityReport.checks` |
| Citation-gate false-failure rate | high (substring match) | < 5% | < 2% | writing gate reasons |
| First-pass QA rate | baseline TBD | +10 pts | +25 pts | `QualityReport.passed` |
| Avg writing attempts to pass | up to 4 | ≤ 2.2 | ≤ 1.5 | `WorkerAttempt` count |
| Cost per published blog | baseline TBD | −20% | −45% | `AIUsage` ÷ published |
| Wall time trend→publish | hours (serial) | −30% | −60% | `WorkflowRun` timestamps |
| Publish success (verified live) | unmeasured | n/a | ≥ 98% | PB2 verification |
| Vertex job-failure rate (429/5xx/timeout) | baseline TBD | −50% | −80% | typed error metrics |
| Daily target attainment | checkpoint UI only | alert on miss | ≥ 95% of days | daily-target status |
| Fact-check/vision null-rate | unmeasured | < 20% alerted | < 10% | Q5 telemetry |

---

## Appendix A — Goal-to-Enhancement Index

| Goal | Primary enhancements |
|---|---|
| **FA** Factual accuracy | R1, R7, W1, W4, W5, Q3, P1-3 |
| **SEO** Search optimization | P1-3, O3, O4, W7, I2, PB3 |
| **CQ** Content quality | W2, W8, Q1, Q2, O2, R4 |
| **REL** Reliability | P1-1, W6, Q5, Q6, I1, 11.2 |
| **HAL** Hallucination reduction | R1, W1, W4, W5, Q3 |
| **PUB** Publishing success | PB1, PB2, PB4, Q7, W3, I3 |
| **COST** API cost | P1-2, W2, W3, I4, 11.1 (caching, caps), O1 |
| **SPD** Speed | W2, 11.2 concurrency, 11.1 client reuse/caching, I5 |
| **FT** Fault tolerance | R3, 11.1 retries/typed errors, 11.2 shutdown/DLQ, I6 |
| **ENT** Enterprise architecture | 11.4, 11.5, 11.6, §12 roadmap |

## Appendix B — Quick file reference for findings

| Finding | File(s) |
|---|---|
| Headline-only evidence | `workers/research-worker/index.ts` (`candidateDescription`) |
| O(n²) dedupe | `workers/research-worker/pipeline/dedupe.ts` |
| Batch-scoped semantic dedup | `workers/research-worker/pipeline/semantic.ts` |
| Substring DB dedupe | `workers/research-worker/index.ts` (`recentDuplicate`) |
| Cost leak on fallback | `workers/planning-worker/vertex.ts`, `workers/outline-worker/vertex.ts` + `workers/shared/pricing.ts` |
| No constrained decoding | `workers/shared/vertex.ts` (schema param unused by callers) |
| Prompt/gate mismatch | `workers/outline-worker/vertex.ts` vs `workers/outline-worker/index.ts` |
| Structure split-brain | `workers/writing-worker/vertex.ts` (mandatory skeleton) vs outline stage |
| Verbatim-URL citation check | `workers/writing-worker/index.ts` (`citationCheck`) |
| Mock-content retry waste | `workers/writing-worker/vertex.ts` (`generateMock`) |
| Hand-rolled SigV4 | `workers/image-worker/storage.ts` |
| Regex-dominant scoring | `workers/quality-worker/scorer.ts` |
| Sampled fact-check | `workers/quality-worker/factcheck.ts` (5–8 claims) |
| No publish surface | `workers/publish-worker/index.ts` |
| Concurrency = 1 | `workers/shared/worker-options.ts` + all worker `index.ts` |
| No graceful drain | `workers/start.ts` (SIGTERM → immediate exit) |

---

*Prepared from static analysis of the repository. Every enhancement is
backward-compatible with the current schema unless explicitly noted as
requiring a migration (pgvector, `Asset.altText`, `AIUsage.fallbackUsed`,
`Blog.publishedAt/Url`, `ContentPlan.degraded`).*
