# Auto-Blog — Complete Micro-Flow Documentation

> This document maps **every micro-flow** in the Auto-Blog system: the 7-stage
> worker pipeline, scheduling, recovery/retry loops, manual dashboard
> interventions, state machines, cost tracking, and the supporting
> infrastructure. Each flow is documented with its trigger, step-by-step
> process, decision gates, database mutations, and queue dispatches.

---

## Table of Contents

1. [System Topology](#1-system-topology)
2. [Master Pipeline Flow (Bird's Eye)](#2-master-pipeline-flow-birds-eye)
3. [Stage 1: Research Worker](#3-stage-1-research-worker)
4. [Stage 2: Planning Worker](#4-stage-2-planning-worker)
5. [Stage 3: Outline Worker](#5-stage-3-outline-worker)
6. [Stage 4: Writing Worker](#6-stage-4-writing-worker)
7. [Stage 5: Image Worker](#7-stage-5-image-worker)
8. [Stage 6: Quality Worker](#8-stage-6-quality-worker)
9. [Stage 7: Publish Worker](#9-stage-7-publish-worker)
10. [Scheduling Flows (Cron & Job Schedulers)](#10-scheduling-flows)
11. [Daily Target Controller Flow](#11-daily-target-controller-flow)
12. [Recovery & Retry Flows](#12-recovery--retry-flows)
13. [Manual Intervention Flows (Dashboard APIs)](#13-manual-intervention-flows-dashboard-apis)
14. [State Machines (Status Lifecycles)](#14-state-machines-status-lifecycles)
15. [Quality Gate Framework](#15-quality-gate-framework)
16. [Audit Trail & Observability Flow](#16-audit-trail--observability-flow)
17. [AI Cost Tracking Flow](#17-ai-cost-tracking-flow)
18. [Settings & Model Override Flow](#18-settings--model-override-flow)
19. [Dashboard Data Flow](#19-dashboard-data-flow)
20. [Queue Reference](#20-queue-reference)

---

## 1. System Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Next.js 16 App (app/)                        │
│  Dashboard UI (React 19)  +  API Routes (app/api/*)                 │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │ reads/writes                 │ enqueue jobs
               ▼                              ▼
┌──────────────────────────┐      ┌───────────────────────────────────┐
│   PostgreSQL (Prisma)    │      │        Redis (BullMQ queues)      │
│  Trend, ContentPlan,     │      │  research → planning → outline →  │
│  ContentOutline, Blog,   │      │  writing → image → quality →      │
│  BlogSEO, QualityReport, │      │  publish                          │
│  Asset, WorkflowRun,     │      └──────────────┬────────────────────┘
│  WorkerAttempt, AIUsage, │                     │ consumed by
│  LogEntry, AppSetting    │                     ▼
└──────────────────────────┘      ┌───────────────────────────────────┐
               ▲                  │   7 Worker Processes (workers/)   │
               │ writes           │   research / planning / outline / │
               └──────────────────│   writing / image / quality /     │
                                  │   publish                         │
                                  └──────────────┬────────────────────┘
                                                 │ calls
                    ┌────────────────────────────┼───────────────────┐
                    ▼                            ▼                   ▼
            ┌───────────────┐          ┌─────────────────┐   ┌────────────┐
            │  Vertex AI    │          │  11 Research    │   │  S3 + CDN  │
            │  (Gemini Pro/ │          │  Sources (RSS/  │   │  (hero     │
            │  Flash,       │          │  scraping/APIs) │   │  images)   │
            │  vision)      │          └─────────────────┘   └────────────┘
            └───────────────┘
```

**Runtime models:**
- **Local dev**: `npm run worker:dev` boots all 7 workers in one process (`workers/start.ts`)
- **Docker/prod**: each worker runs as its own container (see `docker-compose.yml`, `docker/Dockerfile.worker`) for independent scaling/restarts

---

## 2. Master Pipeline Flow (Bird's Eye)

```
 Cron (3 slots/day)        Manual triggers (dashboard APIs)
        │                           │
        ▼                           ▼
┌──────────────┐  plan_blog   ┌──────────────┐
│ 1. RESEARCH  │─────────────▶│ 2. PLANNING  │
│  discover    │              │  strategy    │
└──────────────┘              └──────┬───────┘
                                     │ outline_blog
                                     ▼
                              ┌──────────────┐
                              │ 3. OUTLINE   │
                              │  structure   │
                              └──────┬───────┘
                                     │ write_blog
                                     ▼
                              ┌──────────────┐◀────────────┐
                              │ 4. WRITING   │             │ QA recovery
                              │  full draft  │             │ requeue
                              └──────┬───────┘             │ (max 4
                                     │ generate_blog_image │  attempts)
                                     ▼                     │
                              ┌──────────────┐             │
                              │ 5. IMAGE     │             │
                              │  hero image  │             │
                              └──────┬───────┘             │
                                     │ quality_check_blog  │
                                     ▼                     │
                              ┌──────────────┐─────────────┘
                              │ 6. QUALITY   │  fail → requeue writing
                              │  11 checks   │  fail×4 → FAILED + backfill
                              └──────┬───────┘
                                     │ publish_blog (pass only)
                                     ▼
                              ┌──────────────┐
                              │ 7. PUBLISH   │
                              │  go live     │
                              └──────────────┘
```

**One Trend → one Blog** (enforced by `Blog.trendId @unique` and upserts at
every stage, so retries never create duplicates).

---

## 3. Stage 1: Research Worker

**File**: `workers/research-worker/index.ts`
**Queue**: `research_queue` | **Job names**: `scheduled-research`, `manual-research`, `reconcile-daily-target`
**Trigger**: 3 cron slots/day (registered via BullMQ Job Schedulers) + dashboard manual run

### Micro-flow

```
runResearch()
│
├─ 1. startWorkerAttempt({ worker: "research-worker", input: {sources, geo} })
│     → get-or-create WorkflowRun, create WorkerAttempt #N (status=RUNNING)
│
├─ 2. getEnabledSources() → filter 11 sources by researchConfig.enabledSources:
│     google_trends, google_news, github_trending, techcrunch, the_verge,
│     google_ai_blog, openai_news, anthropic_news, microsoft_ai_blog,
│     nvidia_blog, hackernews
│
├─ 3. Promise.allSettled( sources.map(fetchSignals) )
│     → rawSignals[] collected; failed sources logged (fault-tolerant)
│     → GATE: if ALL sources failed → throw (burns BullMQ retry budget)
│
├─ 4. PIPELINE (pure transforms, workers/research-worker/pipeline/):
│     a. normalizeSignals(rawSignals)      → unified RawSignal shape
│     b. dedupeSignals(normalized)         → heuristic cluster merge
│     c. semanticEnrich(clusters)          → Vertex Flash: semantic dedupe
│                                            + relevance score (falls back
│                                            to 0 on outage → demotes, not
│                                            zeroes, the candidate)
│     d. scoreClusters(enriched)           → weighted score per cluster:
│         • trendDemand   = clamp(log10(bestVolume+1) × 20)
│         • newsFreshness = 100 (≤24h) / 80 (≤72h) / 55 (≤7d) / 20 (older)
│         • githubMomentum= clamp(log10(engagement+1) × 18)
│         • multiSource   = (distinctSources / 3) × 100
│         • semantic      = cluster.semanticRelevance
│         final = strongest×0.55 + avg×0.15 + multiSource×0.10 + semantic×0.20
│         priority: ≥85 high, ≥70 medium, else low
│     e. promotableCandidates(scored)      → filter score ≥ minScoreToPromote
│
├─ 5. DEDUPE against DB for each promotable candidate:
│     a. skip if same topic already saved TODAY
│     b. skip if same/contains topic within RESEARCH_RECENT_DUPLICATE_DAYS
│
├─ 6. prisma.trend.create({ status: "NEW", score, source, category,
│     evidenceSummary }) — evidenceSummary persists source titles/URLs so
│     writing-worker's citation check and quality-worker's fact-check can
│     reference original evidence later
│
├─ 7. SELECT top N: score ≥ RESEARCH_MIN_SCORE_TO_WRITE, sorted desc,
│     take max(1, TRENDS_TO_WRITE_PER_RUN)
│     → if none qualify: passWorkerAttempt(nextStage: "stopped"), return
│
└─ 8. For each selected trend:
      ├─ planningQueue.add("plan_blog", { trendId, topic, category, score,
      │                                  evidenceSummary })
      ├─ prisma.trend.update(status: "PLANNED")
      └─ passWorkerAttempt(qualityReport: researchGate,
                           nextStage: "planning-worker")
```

### Side flow — job router
The BullMQ `Worker` routes by job name:
- `scheduled-research` / `manual-research` → `runResearch()`
- `reconcile-daily-target` → `reconcileDailyTarget()` (see §11)

### Side flow — scheduler reconciliation (boot)
`registerSchedules()` upserts 4 schedulers (idempotent) and **removes any
stale scheduler** in Redis not in the wanted set — renamed slots can't fire
forever.

### DB writes
`Trend` (insert), `WorkflowRun`, `WorkerAttempt`, plus `AIUsage` when the
semantic pass calls Vertex.

---

## 4. Stage 2: Planning Worker

**File**: `workers/planning-worker/index.ts`
**Queue**: `planning_queue` | **Job name**: `plan_blog`
**Payload**: `{ trendId, topic, category, score, evidenceSummary }`

### Micro-flow

```
planTopic(payload)
│
├─ 1. startWorkerAttempt({ worker: "planning-worker", trendId, input })
│
├─ 2. Fetch Trend; throw if missing
│
├─ 3. SCORE GATE: if trend.score < RESEARCH_MIN_SCORE_TO_WRITE
│     AND NOT trend.manuallyApproved
│     → passWorkerAttempt(nextStage: "stopped"), return { skipped: true }
│     (manual approval flag lets human-approved below-threshold trends
│      survive — see §13 approve flow)
│
├─ 4. generateContentPlan(topic, category, score, evidenceSummary)
│     → Vertex AI (default Gemini Flash, dashboard-overridable model
│       "model:planning") returns:
│       searchIntent, audience, angle, primaryKeyword,
│       secondaryKeywords[], competitorNotes[], internalNotes
│
├─ 5. FIELD GATE (scoreRequiredFields): all 6 required fields present?
│     Each missing field = −15 pts; need ≥90 → max 0 missing allowed
│     (100−15 = 85 < 90). Fail → QualityGateError
│
├─ 6. prisma.contentPlan.upsert(where: trendId) — idempotent on retry
│
├─ 7. recordAIUsage({ worker, model, usage, latencyMs, trendId })
│     → AIUsage row with cost computed at write time
│
├─ 8. outlineQueue.add("outline_blog", { trendId, planId })
│
├─ 9. prisma.trend.update(status: "PLANNED")
│
└─ 10. passWorkerAttempt(qualityReport: gate, nextStage: "outline-worker")
```

### DB writes
`ContentPlan` (upsert), `Trend.status → PLANNED`, `AIUsage`, `WorkerAttempt`, `WorkflowRun`

---

## 5. Stage 3: Outline Worker

**File**: `workers/outline-worker/index.ts`
**Queue**: `outline_queue` | **Job name**: `outline_blog`
**Payload**: `{ trendId, planId }`

### Micro-flow

```
outlineTopic(payload)
│
├─ 1. startWorkerAttempt({ worker: "outline-worker", trendId, input })
│
├─ 2. Fetch ContentPlan (include Trend); throw if missing
│
├─ 3. SCORE GATE: same score-or-manuallyApproved check as planning
│     → skip with nextStage: "stopped" if below threshold & not approved
│
├─ 4. generateContentOutline(topic, category, plan)
│     → Vertex AI (default Flash, setting key "model:outline") returns:
│       title, slug, metaTitle, metaDescription, sections[], faqs[]
│
├─ 5. FIELD GATE (scoreRequiredFields):
│     title ✓, slug ✓, metaTitle ✓, metaDescription ✓,
│     sections ≥ 6 ✓, faqs ≥ 3 ✓   (−15 per miss, need ≥90)
│
├─ 6. prisma.contentOutline.upsert(where: trendId) — idempotent
│
├─ 7. recordAIUsage(...)
│
├─ 8. writingQueue.add("write_blog", { trendId, outlineId,
│     topic: outline.title, description: plan.angle })
│
└─ 9. passWorkerAttempt(nextStage: "writing-worker")
```

### DB writes
`ContentOutline` (upsert), `AIUsage`, `WorkerAttempt`, `WorkflowRun`

---

## 6. Stage 4: Writing Worker

**File**: `workers/writing-worker/index.ts`
**Queue**: `writing_queue` | **Job name**: `write_blog`
**Payload**: `{ trendId, outlineId?, topic, description, recoveryContext? }`

### Micro-flow

```
generateBlogForTrend(trendId, topic, description, outlineId, recoveryContext)
│
├─ 1. startWorkerAttempt({ worker: "writing-worker", trendId, input })
│
├─ 2. Fetch Trend; throw if missing
│
├─ 3. SCORE GATE: same score-or-manuallyApproved check
│
├─ 4. Load ContentOutline (by outlineId, else by trendId) + ContentPlan
│
├─ 5. generateBlogDraft(topic, description, { plan, outline,
│     evidenceSummary, priorAttempt })
│     → Vertex AI (default Gemini Pro via VERTEX_MODEL, setting key
│       "model:writing")
│     → recoveryContext.qualityReport is fed back as `priorAttempt`
│       (score + failure reasons) so the model fixes what QA flagged
│     → returns: title, slug, excerpt, markdown, metaTitle,
│       metaDescription, keywords[], model, usage
│
├─ 6. recordAIUsage() — recorded BEFORE the gate, because a rejected
│     draft still burned tokens
│
├─ 7. WRITING GATE (writingGate) — all must pass (threshold 90):
│     a. heuristicScore: base 60
│        +15 if words ≥ BLOG_MIN_WORDS
│        +10 if contains code fence ```
│        +10 if contains markdown table
│        +5  if contains FAQ heading        → max 100
│     b. H1 present (/^#\s+/m)
│     c. ≥8 H2 sections (/^##\s+/gm)
│     d. FAQ section (/^##\s+FAQs?/im)
│     e. Call-to-action text present
│     f. CITATION CHECK: ≥ min(2, available) of the trend's actual
│        evidence URLs appear verbatim in the markdown (skipped when
│        trend has no persisted evidence)
│     → any failure: score capped at 89, QualityGateError thrown
│
├─ 8. marked.parse(markdown) → html
│
├─ 9. uniqueSlug(draft.slug, excludeBlogId) — appends -1, -2… on
│     collision; excludeBlogId prevents a retry colliding with ITSELF
│
├─ 10. getOrCreateCategory(trend.category) — slugified, "general" fallback
│
├─ 11. prisma.blog.upsert(where: trendId):
│     create/update: { title, slug, excerpt, content, html, categoryId,
│     status: "DRAFT", byline: AI_BYLINE,
│     seo: { metaTitle, metaDescription, keywords,
│            schema: schema.org TechArticle + AI author disclosure, score } }
│     → upsert means QA recovery requeues UPDATE the row, never duplicate
│
├─ 12. attachUsageToBlog(usageRecordId, blogId) — links AIUsage → Blog
│
├─ 13. prisma.trend.update(status: "PROCESSED")
│
├─ 14. imageQueue.add("generate_blog_image",
│     { blogId, trendId, title, slug, category, excerpt })
│
└─ 15. passWorkerAttempt(qualityReport: gate, nextStage: "image-worker",
                         blogId)
```

### DB writes
`Blog` (upsert, DRAFT), `BlogSEO` (upsert), `Category` (maybe insert),
`Trend.status → PROCESSED`, `AIUsage`, `WorkerAttempt`, `WorkflowRun`

---

## 7. Stage 5: Image Worker

**File**: `workers/image-worker/index.ts`
**Queue**: `image_queue` | **Job name**: `generate_blog_image`
**Payload**: `{ blogId, trendId?, title, slug, category, excerpt? }`

### Micro-flow

```
generateImageForBlog(payload)
│
├─ 1. startWorkerAttempt({ worker: "image-worker", trendId, blogId, input })
│
├─ 2. Fetch Blog (include featuredImage, trend.plan); throw if missing
│
├─ 3. IDEMPOTENCY SKIP: if blog.featuredImageId already set
│     → qualityQueue.add("quality_check_blog", { blogId })
│     → passWorkerAttempt(nextStage: "quality-worker"), return
│
├─ 4. subject = plan.primaryKeyword || trend.topic || payload.title
│
├─ 5. recentImageHashes() → hashes of recent assets (uniqueness pool)
│
├─ 6. selectHeroImage(payload, subject, recentHashes)
│     → picks an art direction (STYLE_DIRECTIONS) + renders editorial
│       hero (local SVG generator, deterministic, $0 — or AI generator
│       if swapped in); returns { image, styleDirection, imageHash }
│     → imageHash = difference-hash; Hamming distance vs recent assets
│       guards against near-duplicate heroes (image-worker/quality.ts)
│
├─ 7. key = blogs/{YYYY}/{MM}/{slug}/{fileName}; uploadToS3(key, buffer,
│     mimeType) → { bucket, key, publicUrl, size }
│
├─ 8. UPLOAD GATE (scoreRequiredFields): buffer non-empty, mimeType,
│     bucket, key, publicUrl all present
│     → on gate failure: deleteFromS3(key) to avoid orphan objects,
│       then throw
│
├─ 9. prisma.asset.create({ fileName, bucket, path, publicUrl, mimeType,
│     width, height, size, imageHash, styleDirection })
│
├─ 10. prisma.blog.update(featuredImageId: asset.id)
│
├─ 11. qualityQueue.add("quality_check_blog", { blogId })
│
└─ 12. passWorkerAttempt(qualityReport: uploadGate,
                         nextStage: "quality-worker")
```

### DB writes
`Asset` (insert), `Blog.featuredImageId`, `WorkerAttempt`, `WorkflowRun`
(No AI usage — procedural SVG by default)

---

## 8. Stage 6: Quality Worker

**File**: `workers/quality-worker/index.ts` + `scorer.ts` + `factcheck.ts`
**Queue**: `quality_queue` | **Job name**: `quality_check_blog`
**Payload**: `{ blogId }`

### Micro-flow

```
runQualityCheck(payload)
│
├─ 1. startWorkerAttempt({ worker: "quality-worker", blogId, input })
│
├─ 2. Fetch Blog (include seo, featuredImage, trend)
│
├─ 3. scoreBlogQuality(blog) → 11-dimension report:
│     1.  SEO Structure          (title/meta/keywords/schema)
│     2.  Content Completeness   (word count, required sections*)
│     3.  Readability            (sentence length, passive voice)
│     4.  Content Quality        (originality, duplicate paragraphs)
│     5.  Keyword Optimization   (placement, density)
│     6.  Technical SEO          (headers, links)
│     7.  Formatting & UX        (lists, code blocks, spacing)
│     8.  Media Quality          (image dimensions/size + Gemini
│     │                           VISION check: relevance + appeal of
│     │                           the hero against the article)
│     9.  AI Fact Quality        (regex heuristics: AI disclaimers,
│     │                           placeholder text)
│     10. Publishing Readiness   (final gate check)
│     11. Fact Verification      (Vertex-verified claims check against
│                                 Trend.evidenceSummary — factcheck.ts;
│                                 can HARD-BLOCK with recommendation
│                                 "Blocked - unverified facts")
│     * required sections include: What is, Why it matters, Key Features,
│       Benefits, How it Works, Real World Use Cases, Pros and Cons,
│       Best Practices, Common Mistakes, FAQs, Conclusion, Call To Action
│     → overallScore (0–100), passed boolean, recommendation, checks[]
│
├─ 4. prisma.qualityReport.upsert(where: blogId)
│
├─ 5. If blog.seo exists → blogSEO.update(score: overallScore)
│
├─ 6. Build QualityGateReport; reasons = every check scoring < 9/10
│
├─ 7. DECISION:
│
│   ┌─ PASSED ────────────────────────────────────────────────────┐
│   │ publishQueue.add("publish_blog", { blogId, qualityReportId },│
│   │   { jobId: `publish-${blogId}` })  ← deterministic jobId =   │
│   │   built-in idempotency (BullMQ rejects duplicate enqueue)    │
│   │ passWorkerAttempt(nextStage: "publish-worker")               │
│   └─────────────────────────────────────────────────────────────┘
│
│   └─ FAILED ────────────────────────────────────────────────────┐
│   │ a. Find latest WorkflowRun for blog + its writing attempts   │
│   │ b. If writingAttemptCount < 4:                               │
│   │    → writingQueue.add("write_blog", { ...lastWritingInput,   │
│   │       recoveryContext: { reason:                             │
│   │         "final_quality_below_threshold", qualityReport } })  │
│   │    → blog.status = "PENDING_REVIEW"                          │
│   │    → passWorkerAttempt(nextStage: "writing-worker")          │
│   │ c. Else (budget exhausted):                                  │
│   │    → blog.status = "FAILED"                                  │
│   │    → failWorkerAttempt(error)                                │
│   │    → reconcileDailyTarget() ← immediately backfill the dead  │
│   │      article from backlog so today's target doesn't shrink   │
│   └─────────────────────────────────────────────────────────────┘
```

### DB writes
`QualityReport` (upsert), `BlogSEO.score`, `Blog.status` (PENDING_REVIEW/FAILED), `AIUsage` (vision + fact-check calls), `WorkerAttempt`, `WorkflowRun`

---

## 9. Stage 7: Publish Worker

**File**: `workers/publish-worker/index.ts`
**Queue**: `publish_queue` | **Job name**: `publish_blog`
**Payload**: `{ blogId, qualityReportId }`

### Micro-flow

```
publishBlog(payload)
│
├─ 1. startWorkerAttempt({ worker: "publish-worker", blogId, input })
│
├─ 2. Fetch Blog (include qualityReport, featuredImage, seo)
│
├─ 3. INTEGRITY CHECKS:
│     a. qualityReport must exist
│     b. qualityReport.id must match payload.qualityReportId
│        (stale-job protection: a superseded report can't publish)
│
├─ 4. PUBLISH GATE (scoreRequiredFields):
│     QA score ≥ 90 ✓, featured image ✓, SEO record ✓, content ✓, HTML ✓
│
├─ 5. ATOMIC PUBLISH (double-processing guard):
│     prisma.blog.updateMany(where: { id, status: { not: "PUBLISHED" } },
│                            data: { status: "PUBLISHED" })
│     → count = 0 means a redelivered job after crash already won:
│       skip side effects, pass with alreadyPublished: true
│
├─ 6. passWorkerAttempt(qualityReport: gate) — no nextStage:
│     WorkflowRun.status → "PASSED", currentStage → "complete"
│
└─ ON FAILURE:
    ├─ blog.status → "PENDING_REVIEW" (not FAILED — publish failures
    │  are transient/ops issues, not content issues)
    ├─ failWorkerAttempt(error)
    └─ reconcileDailyTarget() ← backfill immediately (blog dropped out
       of today's published count)
```

### DB writes
`Blog.status → PUBLISHED` (or PENDING_REVIEW on error), `WorkerAttempt`, `WorkflowRun`
(No AI calls — publish is a pure DB status flip; external webhook/CMS
integration point lives here)

---

## 10. Scheduling Flows

### Research cron slots (BullMQ Job Schedulers, registered at worker boot)

| Scheduler ID            | Env var                    | Purpose                |
|-------------------------|----------------------------|------------------------|
| `research-overnight`    | `RESEARCH_CRON_OVERNIGHT`  | Overnight news sweep   |
| `research-midday`       | `RESEARCH_CRON_MIDDAY`     | Midday cycle           |
| `research-us-daytime`   | `RESEARCH_CRON_US_DAYTIME` | US daytime news cycle  |
| `daily-target-reconcile`| `RECONCILE_CRON` (30 min)  | Daily target top-up    |

**Micro-flow — `registerSchedules()` (research worker boot):**

```
if !SCHEDULER_ENABLED → skip
for each slot → researchQueue.upsertJobScheduler(id, {pattern, tz: TIMEZONE},
                                                 {name, data})
reconcile pass: getJobSchedulers() → remove any scheduler NOT in the
wanted set (retires stale/renamed slots from Redis)
```

- All times in `env.TIMEZONE`
- Legacy `RESEARCH_CRON` env var is deprecated & ignored (warn logged)
- Schedulers are editable at runtime via `PATCH /api/pipeline/schedules/[id]`
  (hour/minute → new cron pattern → upsert)

### Manual triggers
- `POST /api/research/run` → `researchQueue.add("manual-research", …)`
- CLI: `npm run worker:research:once` (`trigger-once.ts`)

---

## 11. Daily Target Controller Flow

**File**: `workers/shared/daily-target.ts`
**Triggers**: 30-min cron (`reconcile-daily-target` job on research_queue) +
immediate invocation after permanent QA failure or publish failure.

### Micro-flow — `reconcileDailyTarget()`

```
1. getDailyTargetStatus():
   ├─ target         = AppSetting["dailyBlogTarget"] ?? env.DAILY_BLOG_TARGET
   ├─ publishedToday = count(Blog: status=PUBLISHED, updatedAt ≥ today 00:00)
   ├─ inFlight       = count(Blog: status ∈ {DRAFT, PENDING_REVIEW})
   ├─ backlogAvailable = count(Trend: status=NEW,
   │                           score ≥ RESEARCH_MIN_SCORE_TO_WRITE)
   └─ remaining      = max(0, target − publishedToday − inFlight)
   (no double-counting: publish moves inFlight→publishedToday;
    permanent failure drops out of both)

2. if remaining ≤ 0 → log "on track", return (dispatched: 0)

3. if backlogAvailable = 0 → log warn "waiting on next research run"

4. take = min(remaining, backlogAvailable)
   trends = top `take` NEW trends by score desc

5. for each trend:
   ├─ planningQueue.add("plan_blog", {...}, { jobId: `plan-${trend.id}` })
   │  ← deterministic jobId prevents double-dispatch across reconcile ticks
   └─ trend.status → "PLANNED"
```

**Why the backlog exists**: research-worker saves *every* promotable
candidate as `NEW`, but only dispatches the top `TRENDS_TO_WRITE_PER_RUN`.
The leftover pool is what the controller draws from.

---

## 12. Recovery & Retry Flows

### 12a. BullMQ transport retries (all queues)
Every queue is created with `attempts: 4`, custom `backoff: { type: "recovery" }`,
`removeOnComplete: 5000`, `removeOnFail: 10000`. A thrown job is retried up
to 4 times by BullMQ before landing in the failed set (visible in
`/dashboard/workers`).

### 12b. QA recovery loop (content-level rewrite)
```
quality-worker FAIL
   └─ writing attempts < 4?
      ├─ YES → requeue write_blog with recoveryContext:
      │        { reason: "final_quality_below_threshold",
      │          qualityReport: {score, reasons[]} }
      │        → writing-worker passes priorAttempt into the Vertex prompt
      │        → blog.upsert on trendId rewrites the same Blog row
      │        → flows through image (skip) → quality again
      └─ NO  → Blog.status = FAILED + reconcileDailyTarget()
```

### 12c. Idempotency mechanisms (crash-safe design)

| Mechanism                          | Where                                    |
|------------------------------------|------------------------------------------|
| Upsert on `trendId`                | ContentPlan, ContentOutline, Blog        |
| Upsert on `blogId`                 | BlogSEO, QualityReport                   |
| Deterministic jobId `publish-{id}` | quality → publish dispatch               |
| Deterministic jobId `plan-{id}`    | daily-target reconcile dispatch          |
| `updateMany` status guard          | publish-worker double-delivery guard     |
| `excludeBlogId` in slug check      | writing-worker self-collision prevention |
| featuredImageId skip               | image-worker re-run shortcut             |
| S3 delete on gate failure          | image-worker orphan cleanup              |
| qualityReportId match              | publish-worker stale-job protection      |

### 12d. WorkerAttempt numbering
`startWorkerAttempt` counts prior attempts for the same
(workflowRunId, worker) and stores `attempt = count + 1` — this powers the
"4 writing attempts" budget and per-stage audit.

---

## 13. Manual Intervention Flows (Dashboard APIs)

### 13a. Approve a trend — `POST /api/trends/[id]/approve`
```
1. Load trend (404 if missing)
2. If score < RESEARCH_MIN_SCORE_TO_WRITE → body.reason REQUIRED (422)
3. Transaction:
   ├─ contentPlan.findUnique(trendId) → if exists, abort (409 ALREADY_PLANNED)
   └─ trend.update(status=PLANNED, manuallyApproved=true if below threshold)
4. If below threshold → LogEntry(level=WARN, worker="manual-override",
   meta={reason, score, threshold})  ← audit trail
5. planningQueue.add("plan_blog", { trendId, ..., evidenceSummary with
   human-override NOTE })
→ The manuallyApproved flag then carries the trend through the score gates
  in planning, outline, AND writing workers.
```

### 13b. Regenerate a failed blog — `POST /api/blogs/[id]/regenerate`
```
1. Load blog (404)
2. Find latest WorkflowRun + writing attempts
3. No writing input found → 422 (can't auto-regenerate)
4. attempts ≥ 4 → 409 "retry budget exhausted, use manual override"
5. writingQueue.add("write_blog", { ...lastInput,
     recoveryContext: { reason: "manual_regenerate_requested" } })
6. blog.status → PENDING_REVIEW
(Same code path as the quality-worker's automatic recovery — the button
 is honest about what it does.)
```

### 13c. Override publish — `POST /api/blogs/[id]/override-publish`
```
1. Load blog + qualityReport
2. Already PUBLISHED → 409
3. No quality report yet → 422 ("it will auto-publish if it passes")
4. If report.passed → normal "publish now"
5. If NOT passed → override is only allowed for BORDERLINE articles:
   ├─ recommendation = "Blocked - unverified facts" → refused
   │  (fact-check hard gate needs a real rewrite)
   └─ score < 85 → refused (not a backdoor to hit targets)
6. LogEntry(level=WARN, worker="manual-override") audit
7. Blog.status → PUBLISHED
```

### 13d. Requeue quality — `POST /api/blogs/[id]/requeue-quality`
Re-enqueues `quality_check_blog` for a blog (e.g., after editing settings).

### 13e. Trigger research — `POST /api/research/run`
Enqueues `manual-research` on `research_queue` (same handler as cron).

### 13f. Edit schedule — `PATCH /api/pipeline/schedules/[id]`
```
1. id must be one of research-overnight / research-midday / research-us-daytime
2. Validate hour (0–23), minute (0–59) → 422 on bad input
3. pattern = "{minute} {hour} * * *" → researchQueue.upsertJobScheduler
```

### 13g. Settings — `GET/PATCH /api/settings`
```
GET  → { models: {planning, outline, writing, semantic}, dailyBlogTarget }
PATCH key="dailyBlogTarget" → number 1–20 (422 otherwise)
PATCH key="model:{stage}"   → model id string for one of the 4 LLM stages
```

---

## 14. State Machines (Status Lifecycles)

### Trend.status
```
NEW ──dispatch──▶ PLANNED ──writing done──▶ PROCESSED
 │                   ▲
 │                   └── manual approve (POST /trends/[id]/approve)
 ├─▶ IGNORED (dashboard triage)
 └─▶ REJECTED (dashboard triage)
```

### Blog.status
```
DRAFT (writing-worker created)
  │  image done → quality queued
  ├─ QA pass → (publish queued) → PUBLISHED
  ├─ QA fail, retries left → PENDING_REVIEW ──▶ DRAFT (rewrite upsert)
  ├─ QA fail, budget exhausted → FAILED
  ├─ publish-worker error → PENDING_REVIEW
  ├─ manual override → PUBLISHED
  └─▶ ARCHIVED (housekeeping)
```

### WorkflowRun.status
```
RUNNING (created by first startWorkerAttempt; currentStage tracks
         the active worker as the item flows through stages)
  ├─ stage passed with nextStage → stays RUNNING, currentStage = next
  ├─ final pass (no nextStage)   → PASSED,  currentStage = "complete"
  └─ any failWorkerAttempt       → FAILED,  failureReason = error
```

### WorkerAttempt.status
`RUNNING → PASSED | FAILED`, with `input`, `output`, `qualityReport`,
`error`, `startedAt`/`finishedAt` persisted per attempt.

---

## 15. Quality Gate Framework

**File**: `workers/shared/recovery.ts` — `QUALITY_THRESHOLD = 90`

```typescript
QualityGateReport = { stage, score, passed, reasons[] }
```

| Helper | Behavior |
|---|---|
| `scoreRequiredFields(stage, checks)` | 100 − 15 per missing field; passed = score ≥ 90 (i.e. **zero** missing allowed) |
| `assertGate(report)` | throws `QualityGateError` when `!passed` or score < 90 |
| `QualityGateError` | carries the report → `failWorkerAttempt` persists it on the attempt |

**Gates by stage:**

| Stage | Gate | Content |
|---|---|---|
| research | soft | best-score reporting only; never blocks (empty day = normal) |
| planning | hard | 6 required plan fields |
| outline | hard | title/slug/meta + sections ≥ 6 + FAQs ≥ 3 |
| writing | hard | heuristic ≥ 90, H1, ≥8 H2s, FAQ, CTA, ≥2 evidence citations |
| image | hard | buffer, mimeType, bucket, key, publicUrl (S3 cleanup on fail) |
| quality | hard | 11-dimension score ≥ 90 + fact-check not blocked |
| publish | hard | QA ≥ 90, image, SEO, content, HTML |

---

## 16. Audit Trail & Observability Flow

```
every worker run:
  startWorkerAttempt() ──▶ WorkflowRun (get-or-create, transaction-safe)
                       └─▶ WorkerAttempt #N (input snapshot)
        │
        ├─ success → passWorkerAttempt() → attempt PASSED (output,
        │            qualityReport, finishedAt) + workflow currentStage
        │            advanced
        └─ failure → failWorkerAttempt() → attempt FAILED (error,
                     qualityReport) + workflow FAILED (failureReason)

Winston logs → log-transport.ts (buffered PrismaTransport)
             → LogEntry rows (pruned to LOG_RETENTION_DAYS)
             → GET /api/logs → /dashboard/logs viewer
             (manual overrides also write here as worker="manual-override")

GET /api/pipeline/run-context → per-item workflow/attempt timeline
/dashboard/workers            → BullMQ queue inspector (active/waiting/
                                failed/completed counts per queue)
```

---

## 17. AI Cost Tracking Flow

```
LLM call site (planning / outline / writing / semantic / vision / factcheck)
   │
   ▼
recordAIUsage({ worker, model, usage, latencyMs, trendId? })
   │  cost = MODEL_PRICING[model] × token counts   (workers/shared/pricing.ts)
   ▼
AIUsage row { worker, model, promptTokens, completionTokens, cost(USD),
              latency(ms), trendId, blogId? }
   │
   ├─ writing-worker: attachUsageToBlog(usageId, blogId) after Blog upsert
   │  (usage recorded before blog exists, linked after)
   │
   ▼
GET /api/dashboard aggregates:
   • today's spend, 7-day stacked spend by model
   • input/output tokens today
   • cost per blog, projected monthly spend
   • spend by worker stage, per-model calls/tokens/latency/share
```

Model defaults: planning/outline/semantic → `VERTEX_FLASH`;
writing → `VERTEX_MODEL` (Pro); vision (quality) → Flash;
all four text stages overridable via dashboard settings.

---

## 18. Settings & Model Override Flow

**File**: `workers/shared/settings.ts` — backed by the `AppSetting` table.

```
Keys:
  "model:planning" | "model:outline" | "model:writing" | "model:semantic"
  "dailyBlogTarget"

getSetting(key, fallback):
  15-second in-memory cache → prisma.appSetting.findUnique →
  on DB error: silently return env fallback (never throws mid-job)

setSetting(key, value): upsert + refresh cache

Shared by BOTH Next.js API routes and worker processes (same module
imported from both sides), so key spellings can't drift apart.
```

---

## 19. Dashboard Data Flow

### Main dashboard — `GET /api/dashboard` (polled every 3s by UI)
Aggregates:
- **Daily target status** (`getDailyTargetStatus`) + time-based expectation
  checkpoints (10am ≈ ⅓, 4pm ≈ ⅔, 9pm ≈ full target, in `TIMEZONE`)
- **Queue counts** for all 7 queues (active/waiting/completed/failed)
- **Recent blogs** (latest 6 with category, trend score, quality, status)
- **Cost analytics** from `AIUsage` (7-day spend, tokens, per-model table)

### Sub-pages → data sources

| Page | Route / source |
|---|---|
| `/dashboard` | `GET /api/dashboard` |
| `/dashboard/blogs` | Blog list + `BlogDetailModal`; regenerate / override-publish actions |
| `/dashboard/trends` | Trend list; approve flow (`POST /api/trends/[id]/approve`) |
| `/dashboard/quality` | `QualityReport` viewer + `QualityFlowDiagram` |
| `/dashboard/assets` | `Asset` gallery + `AssetDetailModal` |
| `/dashboard/workers` | BullMQ queue inspector + retry/dead-letter |
| `/dashboard/settings` | `GET/PATCH /api/settings` + schedule editor |
| `/dashboard/logs` | `GET /api/logs` (LogEntry, filterable by level/worker) |

---

## 20. Queue Reference

**File**: `workers/shared/queues.ts` — all queues share
`{ attempts: 4, backoff: recovery, removeOnComplete: 5000, removeOnFail: 10000 }`

| Queue | Name | Job name | Payload | Producer → Consumer |
|---|---|---|---|---|
| Research | `research_queue` | `scheduled-research` / `manual-research` / `reconcile-daily-target` | `{ slot? }` | cron/API → research |
| Planning | `planning_queue` | `plan_blog` | `{ trendId, topic, category, score, evidenceSummary }` | research / approve API / daily-target → planning |
| Outline | `outline_queue` | `outline_blog` | `{ trendId, planId }` | planning → outline |
| Writing | `writing_queue` | `write_blog` | `{ trendId, outlineId?, topic, description, recoveryContext? }` | outline / quality (recovery) / regenerate API → writing |
| Image | `image_queue` | `generate_blog_image` | `{ blogId, trendId?, title, slug, category, excerpt? }` | writing → image |
| Quality | `quality_queue` | `quality_check_blog` | `{ blogId }` | image / requeue API → quality |
| Publish | `publish_queue` | `publish_blog` (jobId `publish-{blogId}`) | `{ blogId, qualityReportId }` | quality → publish |

**Worker concurrency**: every worker runs `workerOptions(1)` — one job at a
time per worker process; scale horizontally by running more containers.

---

## Appendix: Key Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | all | PostgreSQL connection |
| `REDIS_URL` | all | BullMQ connection |
| `TIMEZONE` | research, dashboard | Cron + daily-target timezone |
| `SCHEDULER_ENABLED` | research | Toggle cron registration |
| `RESEARCH_CRON_OVERNIGHT / _MIDDAY / _US_DAYTIME` | research | 3 daily research slots |
| `RECONCILE_CRON` | daily-target | 30-min reconcile tick |
| `RESEARCH_MIN_SCORE_TO_WRITE` | research, planning, outline, writing, daily-target | Write threshold gate |
| `RESEARCH_RECENT_DUPLICATE_DAYS` | research | Dedupe window |
| `TRENDS_TO_WRITE_PER_RUN` | research | Top-N dispatch per run |
| `DAILY_BLOG_TARGET` | daily-target | Default daily publish goal (dashboard-overridable) |
| `BLOG_MIN_WORDS` | writing | Word-count gate input |
| `VERTEX_API_KEY` / `VERTEX_MODEL` / `VERTEX_FLASH` | AI stages | Vertex AI config |
| `STORAGE_BUCKET` (+ S3 creds) | image | Hero image storage |
| `LOG_RETENTION_DAYS` | logging | LogEntry pruning |

---

*Generated from source code analysis of the auto-blog repository. For the
high-level architecture and setup instructions, see `README.md`.*
