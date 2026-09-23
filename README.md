# Auto-Blog: Automated Blog Generation Pipeline

## Project Overview

**Auto-Blog** is an end-to-end blog generation system. An editor submits a blog specification — title, keywords, audience, tone, target length, optionally a structure and reference sources — and the pipeline plans, outlines, writes, illustrates, scores and publishes the article. It uses **Vertex AI (Google's Gemini)** for content generation.

Topics are **editor-supplied**, not discovered: automated trend research was removed in favour of a manual submission form at `/dashboard/blogs/new` (see [Submitting a blog](#submitting-a-blog)).

The system is built as a **Next.js application** with a **BullMQ-based job queue** (Redis), **Prisma ORM** for data persistence (PostgreSQL), and modular worker processes for each pipeline stage.

---

## Architecture Overview

### Tech Stack
- **Frontend/Framework**: Next.js 16.2 + React 19 + TypeScript
- **Job Queue**: BullMQ + Redis
- **Database**: PostgreSQL + Prisma ORM
- **AI Models**: Google Vertex AI (Gemini 2.5 Pro / Flash) for text; Vertex Imagen for
  hero images, with a locally rendered SVG fallback.
- **Styling**: Tailwind CSS 4 + shadcn/ui components
- **Logging**: Winston

### Core Components
1. **Next.js App** (`/app`) - Web UI dashboard & API endpoints
2. **Workers** (`/workers`) - 6 content stages plus a scheduler
3. **Shared Libraries** - Queue management, Prisma client, logging, environment config
4. **Database Schema** - models tracking submissions, content, blogs, and metrics

---

## Data Flow: The Pipeline

A submission is created by the editor and then walks six stages, each consuming
jobs from its own queue, doing work, and dispatching to the next.

```
Manual Input (UI/API) → Planning → Outline → Writing → Image → Quality → Publish
```

### Stage 0: Scheduler Worker
**Purpose**: Decide *when* an already-submitted blog starts moving. It generates nothing itself.

**Input**: Two cron jobs on `scheduler_queue`
- `reconcile-daily-target` (`RECONCILE_CRON`, default every 30 min) - tops today's
  pipeline up from the PENDING submission backlog, up to the Daily Blog Goal
- `scheduled-slot` - one publish slot fired; takes the next PENDING submission and
  aims it at that slot's publish time

**Output**: Dispatches `BlogInput` rows to the **Planning Queue**, records the slot's
target publish time in Redis so quality-worker can hold the publish job until then.

> A submission with "Start now" selected skips the scheduler entirely - the submit
> API dispatches it to planning immediately.

---

### Stage 1: Planning Worker
**Purpose**: Turn the editor's specification into a content strategy

**Input**: Jobs from Planning Queue (one per `BlogInput`)

**Process**:
- Loads the `BlogInput` and calls **Vertex AI** (Gemini) to fill in what the editor
  left blank: search intent, audience, angle, keywords, competitor notes
- Fields the editor *did* specify (audience, search intent, focus keyword, secondary
  keywords) are applied verbatim over the model's answer - they are decisions, not suggestions
- **Sourced** submissions (those carrying reference articles) additionally produce
  `plannedClaims`, each mapped to a source, and are rejected if any claim is unsupported.
  **Unsourced** submissions skip the evidence gates entirely.

**Output**: Creates `ContentPlan` linked to the `BlogInput`, dispatches to **Outline Queue**

---

### Stage 2: Outline Worker
**Purpose**: Build the detailed content structure

**Input**: Jobs from Outline Queue (ContentPlan data)

**Process**:
- If the editor supplied `outlineJson`, it is used **verbatim** and no Vertex call is made
- Otherwise calls **Vertex AI** for an SEO title, meta description, H2 sections
  (heading + intent + bullets) and FAQs

**Output**: Creates `ContentOutline`, dispatches to **Writing Queue**

---

### Stage 3: Writing Worker
**Purpose**: Generate the full blog post markdown

**Input**: Jobs from Writing Queue (Outline + Plan data)

**Process**:
- Calls **Vertex AI** to expand the outline into a full markdown article, honouring
  the submission's `tone` and `contentLength` (±10%)
- Applies a **quality gate**: H1 present, ≥8 H2 sections, FAQ section, call to action,
  heuristic score, citation coverage (sourced submissions only)
- Write-time claim self-check and section-level repair before the draft is persisted
- Creates `Blog` + `BlogSEO`, converts markdown → HTML

**Output**: Creates `Blog` (status `DRAFT`) + `BlogSEO`, dispatches to **Image Queue**

---

### Stage 4: Image Worker
**Purpose**: Generate the hero image and upload it

**Input**: Jobs from Image Queue (Blog metadata)

**Process**:
- Generates the hero image with Vertex Imagen when `IMAGE_AI_GENERATION_ENABLED` is on,
  falling back to a locally rendered editorial SVG (`image-worker/generator.ts`)
- Checks dimensions and perceptual-hash uniqueness against recent assets, retrying
  with a fresh art direction on a collision
- Uploads to **S3** (bucket path + CDN public URL) and links it as `featuredImage`

**Output**: Updates Blog with `featuredImageId`, dispatches to **Quality Queue**

---

### Stage 5: Quality Worker (QA Validator)
**Purpose**: Comprehensive content quality scoring

**Input**: Jobs from Quality Queue

**Process**:
- Runs an 11-point checklist (SEO structure, completeness, readability, content
  quality, keyword optimization, technical SEO, formatting, media, AI/fact quality,
  publishing readiness, and a Vertex-verified **fact verification** check), plus an
  optional LLM editorial judge
- Fact verification scores a neutral 7/10 for unsourced submissions - "couldn't
  verify" is not the same as "verified wrong"
- On failure, requeues writing with the concrete failing claims and judge fixes,
  up to the configured retry budget

**Output**: Creates `QualityReport`; on pass, dispatches to **Publish Queue** (held
until the slot's target publish time when one was set)

---

### Stage 6: Publish Worker
**Purpose**: Take the blog live

**Process**:
- Re-validates the QA score, featured image, SEO row and content
- Flips `Blog.status` → `PUBLISHED` (guarded against double-processing)
- Marks the originating `BlogInput` → `COMPLETED`

---

## Submitting a blog

### From the dashboard
Open **/dashboard/blogs/new**, fill in the form, and choose **Start now** (dispatch
immediately) or **Queue for the next publish slot**. Recent submissions, their stage
and their failures are listed underneath; each links to a detail page at
`/dashboard/blogs/input/<id>`.

### From the API

```bash
curl -X POST http://localhost:3000/api/blogs/input \
  -H "Content-Type: application/json" \
  -d @spec.json
```

`spec.json` — only `title` is required:

```json
{
  "title": "How to Master React Hooks: A Complete Guide",
  "slug": "react-hooks-guide",
  "category": "tech",
  "focusKeyword": "React hooks",
  "primaryKeywords": ["React hooks", "useEffect", "useState", "custom hooks"],
  "secondaryKeywords": ["React development", "state management"],
  "metaTitle": "React Hooks Mastery: Complete Guide for Developers",
  "metaDescription": "Learn React hooks from basics to advanced patterns.",
  "audience": "Junior to mid-level React developers",
  "searchIntent": "Understand React hooks deeply with practical examples",
  "tone": "technical",
  "contentLength": 2500,
  "priority": "NORMAL",
  "startNow": true,
  "outlineJson": {
    "sections": [
      {
        "heading": "What are React Hooks?",
        "intent": "Define hooks and why they matter",
        "bullets": ["Introduced in React 16.8", "State in function components"]
      }
    ],
    "faqs": [
      { "question": "Can I use hooks in class components?", "answer": "No." }
    ]
  },
  "sources": [
    {
      "url": "https://react.dev/reference/react/useEffect",
      "title": "useEffect - React",
      "evidence": ["useEffect runs after the browser paints the screen."]
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `title` | Required, 10-200 chars, unique across submissions |
| `slug` | Optional; derived from the title and de-duplicated when omitted |
| `tone` | `professional` \| `casual` \| `technical` |
| `contentLength` | 500-5000; drives the writer's word budget (±10%) |
| `outlineJson` | Optional. Used **verbatim** — no outline is generated. Only section `heading`s are required |
| `sources` | Optional. Supplying these switches the pipeline into **grounded mode** |
| `priority` | `LOW` \| `NORMAL` \| `HIGH` \| `URGENT` — backlog drain order |
| `startNow` | `true` dispatches immediately; `false` leaves it PENDING for the next publish slot |

**Sourced vs unsourced.** Without `sources`, the article is written from the
specification alone: the evidence/claim gates are skipped, the writer is told to stay
conceptual rather than assert figures it cannot justify, and QA's fact check scores
neutral. With `sources`, every planned claim must map to a supplied source's
`evidence` facts, the draft cites them inline via `[S1]`-style markers that are
materialized into links, and QA fact-checks each extracted claim against them.

Other endpoints:
- `GET /api/blogs/input` - recent submissions
- `GET /api/blogs/input/[id]` - one submission with its plan, outline, blog and attempts
- `PATCH /api/blogs/input/[id]` - `{"action": "start" | "retry" | "cancel"}`
- `DELETE /api/blogs/input/[id]` - delete a submission that never produced a blog

---

## Database Schema

### Key Models

**BlogInput** (the editor's submission — the pipeline's entry point)
- `id`, `title` (unique), `slug` (unique), `specs` (the raw validated submission)
- Denormalized spec columns: `keywords`, `secondaryKeywords`, `audience`, `searchIntent`,
  `tone`, `contentLength`, `category`, `focusKeyword`, `metaTitle`, `metaDescription`
- `outlineJson` - optional editor-supplied structure, used verbatim when present
- `evidenceArticles` / `evidenceSummary` - optional reference sources (grounded mode)
- `priority` (LOW|NORMAL|HIGH|URGENT), `status` (PENDING→PROCESSING→COMPLETED|FAILED|CANCELLED),
  `failureReason`, `dispatchedAt`, `processedAt`

**ContentPlan** (strategy)
- `blogInputId` (FK), `searchIntent`, `audience`, `angle`, `primaryKeyword`, `secondaryKeywords` (JSON), `competitorNotes` (JSON), `plannedClaims` (JSON)

**ContentOutline** (structure)
- `blogInputId` (FK), `planId` (FK), `title`, `slug`, `metaTitle`, `metaDescription`, `sections` (JSON), `faqs` (JSON)

**Blog** (final article)
- `title`, `slug`, `content` (markdown), `html`, `categoryId` (FK), `featuredImageId` (FK), `blogInputId` (FK, unique), `status` (DRAFT|PENDING_REVIEW|PUBLISHED|FAILED|ARCHIVED)

**BlogSEO** (metadata)
- `blogId` (FK), `metaTitle`, `metaDescription`, `keywords` (JSON), `schema` (JSON), `score`

**QualityReport** (validation)
- `blogId` (FK), `overallScore`, 11 individual scores, `passed` (boolean), `checks` (JSON with details), `factCheckDetail`, `judgeDetail`

**Asset** (images)
- `fileName`, `bucket`, `path`, `publicUrl`, `mimeType`, `width`, `height`, `size`

**WorkflowRun** (execution tracking)
- `blogInputId` (FK), `blogId`, `status`, `currentStage`, `failureReason`

**WorkerAttempt** (per-stage audit)
- `workflowRunId` (FK), `worker`, `status`, `input` (JSON), `output` (JSON), `error` (if failed)

**AIUsage** (cost tracking)
- `worker`, `model`, `blogId` (FK), `blogInputId`, `promptTokens`, `completionTokens`,
  `cost` (USD, computed at write time), `latency` (ms)
- Indexed on `blogId`, `createdAt`, `(worker, createdAt)`, `(model, createdAt)` for
  fast dashboard rollups

---

## Queue Architecture (BullMQ + Redis)

Each stage has its own **job queue**:

```typescript
schedulerQueue     // Cron: daily-target reconcile + publish slots
planningQueue      // Content strategy
outlineQueue       // Structure generation
writingQueue       // Blog draft creation
imageQueue         // Feature image generation
qualityQueue       // Quality validation
publishQueue       // Publication
```

**Job Lifecycle**:
1. Worker pushes job to queue with payload
2. BullMQ worker process picks up job
3. Worker executes; on success → passes to next queue
4. On failure → retries or logs to `WorkerAttempt` with error

**Payload Types** (in `workers/shared/queues.ts`):
- `PlanningJobPayload` - blogInputId + title/category/evidence
- `OutlineJobPayload` - blogInputId + planId
- `WritingJobPayload` - blogInputId + outlineId (+ recoveryContext on a QA requeue)
- `ImageJobPayload` - blogId + title + slug + category
- `QualityJobPayload` - blogId
- `PublishJobPayload` - blogId + qualityReportId

---

## Dashboard & Monitoring

### Executive Dashboard (`/app/dashboard/page.tsx`)

**Real-time metrics** (polls `/api/dashboard` every 3 seconds):
- Daily published count (against the Daily Blog Goal)
- Success rate (% passed QA)
- AI cost today (Gemini + Imagen spend)
- Average quality score (0-100)

**Pipeline visualization**:
- Live stage status (Submissions → Publish)
- Queue counts per stage
- Active/waiting/failed/completed jobs
- Animated progress bars + color-coded health states

**Recent generations table**:
- Latest 6 blogs with title, category, quality, status
- Links to detailed blog view

**Cost analytics** (real data, from the `AIUsage` table):
- 7-day stacked spend chart, segmented by model
- Input / output token counts for today
- Cost per blog and projected monthly spend
- Spend by worker (which stage is expensive)
- Model performance table: calls, tokens, avg latency, share of spend, cost

Costs are computed at write time from `workers/shared/pricing.ts` using Vertex AI
list prices, so the numbers are real rather than placeholders.

### Sub-pages
- `/dashboard/blogs` - Browse all generated blogs (search, filter, detail modal)
- `/dashboard/blogs/new` - Submit a blog specification; lists recent submissions
- `/dashboard/blogs/input/[id]` - One submission: specs, plan, stage progress, attempt log
- `/dashboard/workers` - Queue inspector (active jobs, retry logs, dead-letter queue)
- `/dashboard/quality` - QA report viewer (scores, checks, recommendations)
- `/dashboard/assets` - Image gallery (generated feature images)
- `/dashboard/settings` - Configuration (enabled sources, quality gates, publish endpoints)
- `/dashboard/logs` - Worker execution logs (errors, gate failures, timing)

---

## API Endpoints

**Dashboard Data**
- `GET /api/dashboard` - Aggregate metrics, pipeline status, recent blogs, submissions

**Blog Submissions**
- `POST /api/blogs/input` - Submit a blog specification (see [Submitting a blog](#submitting-a-blog))
- `GET /api/blogs/input` - Recent submissions
- `GET /api/blogs/input/[id]` - One submission with plan, outline, blog and attempts
- `PATCH /api/blogs/input/[id]` - `{"action": "start" | "retry" | "cancel"}`
- `DELETE /api/blogs/input/[id]` - Delete a submission that never produced a blog

**Pipeline Trigger**
- `POST /api/pipeline/run` - Run the daily-target reconcile now (dispatches PENDING submissions)

---

## Worker Commands

Start individual workers or all at once:

```bash
npm run worker:scheduler     # Cron: reconcile tick + publish slots
npm run worker:planning      # Generate content plans
npm run worker:outline       # Build content structures
npm run worker:writing       # Write full blog posts
npm run worker:image         # Generate feature images
npm run worker:quality       # Validate quality & assign scores
npm run worker:publish       # Publish to production
npm run worker:dev           # Start all workers concurrently
```

**Post-refactor cutover check** (after `npx prisma migrate deploy`):
```bash
npm run migrate:manual-input
```

---

## Configuration & Environment

Key environment variables (`workers/shared/env.ts`):
- `DAILY_BLOG_TARGET` - Blogs/day goal, and the number of publish slots
- `RECONCILE_CRON` - Daily-target safety-net tick (default `*/30 * * * *`)
- `SLOT_GENERATION_LEAD_MINUTES` - How early a slot starts generating before its publish time
- `TIMEZONE` - Wall-clock timezone for publish slots
- `BLOG_MIN_WORDS` / `BLOG_MAX_WORDS` - Word budget when a submission specifies no `contentLength`
- `VERTEX_API_KEY` - Google Cloud API credentials
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection for BullMQ
- `STORAGE_BUCKET` - Cloud storage for images
- `PUBLISH_WEBHOOK_URL` - External publish endpoint

---

## Error Handling & Recovery

**Quality Gates** (per stage):
- Planning/Outline: required fields, plus the evidence contract for sourced submissions
- Writing: H1/H2/FAQ/CTA validation, word count, citation coverage, claim self-check
- Quality: Multi-point checklist with a hard fact-verification gate

**Failed Job Handling**:
- `WorkerAttempt` logs error + attempt count
- BullMQ auto-retries configurable times
- Failed jobs visible in `/dashboard/workers` (dead-letter queue)
- Manual retry option available

**Failure Tracking**:
- `Blog.status = FAILED` if QA doesn't pass
- `WorkflowRun.failureReason` stores error message
- `AIUsage` tracks cost even on failed runs

---

## Key Features & Design Patterns

### 1. Idempotent Workers
- Each worker can safely re-run on same input
- Uses `WorkerAttempt` to prevent duplicate processing
- Output stored in database before queue dispatch

### 2. Editor-Controlled Input
- Every article starts from a submitted specification, not a discovered topic
- Fields the editor specifies are applied verbatim; the model only fills the gaps
- An editor-supplied outline replaces the generated one entirely

### 3. Quality Gates at Each Stage
- Writing validates structure (H1, H2s, FAQ, CTA)
- Quality worker runs an 11-point checklist
- Failed articles marked FAILED, not published

### 4. Cost Transparency
- `AIUsage` tracks every API call (model, tokens, cost)
- Dashboard shows daily spend + cost per blog
- Helps optimize prompts + batch operations

### 5. Audit Trail
- `WorkflowRun` + `WorkerAttempt` track execution flow
- `WorkerAttempt.input/output` store payloads for debugging
- Timestamps enable latency analysis

### 6. SEO-First Content Generation
- Planning stage develops keyword strategy
- Outline stage includes meta descriptions + schema
- Quality checker validates SEO metrics
- BlogSEO model stores structured metadata

---

## Content Lifecycle States

```
BlogInput (PENDING)
  ↓ [submit with "Start now", or a publish slot / reconcile tick]
BlogInput (PROCESSING)
  ↓ [Planning Worker]
ContentPlan created
  ↓ [Outline Worker]
ContentOutline created
  ↓ [Writing Worker]
Blog (DRAFT) + BlogSEO created
  ↓ [Image Worker]
Blog + Asset (featured image) created
  ↓ [Quality Worker]
QualityReport created
  ├→ PASSED: Blog.status = PUBLISHED
  └→ FAILED: Blog.status = FAILED
  ↓ [Publish Worker]
Blog.status = PUBLISHED, BlogInput.status = COMPLETED
```

---

## Next Steps (Potential Improvements)

1. **Bulk Submission** - CSV/JSON import for a month of briefs at once
2. **A/B Testing** - Test multiple outlines per submission, publish top performer
3. **Personalization** - Audience segmentation (tech vs business vs lifestyle)
4. **Analytics Integration** - Track published blog performance (views, clicks)
5. **Feedback Loop** - Low-performing blogs inform future submission templates
6. **Multi-language Support** - Generate blogs in Spanish, French, German
7. **Monetization** - Ad placement, affiliate links, sponsored content hooks
8. **Real-time Alerts** - Notify the editor when a submission fails permanently
9. **SEO Competitor Analysis** - Scrape SERP data to inform outlines
10. **Custom Brand Voice** - Fine-tune prompts per publication brand

---

## Running the Project

```bash
# Install dependencies
npm install

# Start local PostgreSQL and Redis
docker compose up -d --wait postgres redis

# Initialize/update the local database
npx prisma migrate deploy

# Start Next.js dev server (dashboard UI)
npm run dev

# Start all Docker workers (after migrations)
docker compose up -d --build

# Or run workers locally in a separate terminal
npm run worker:dev

# Or individually:
npm run worker:scheduler
npm run worker:planning
# ... etc
```

The local `.env` uses `postgresql://postgres:postgres@localhost:5432/blog_agent`.
Docker Compose overrides the workers' database hostname to `postgres`. PostgreSQL
credentials, database name, and host port are configured with `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT`; keep the local
`DATABASE_URL` in sync when changing them. Data persists in the `postgres_data`
volume across container restarts. Credentials initialize a new volume only.
This local database starts empty; hosted database data is not copied automatically.

Then submit your first blog at http://localhost:3000/dashboard/blogs/new

**Dashboard**: http://localhost:3000/dashboard
**API**: http://localhost:3000/api/...

---

## Summary

**Auto-Blog** is a **production-grade content engine** that turns an editor's blog specification into a publication-ready article through six autonomous pipeline stages. The editor decides *what* to write; the pipeline handles planning, structure, drafting, illustration, quality validation and publishing, with real-time dashboarding throughout. The modular BullMQ-based architecture scales horizontally, audit trails enable debugging, and transparent cost tracking ensures economic viability.
