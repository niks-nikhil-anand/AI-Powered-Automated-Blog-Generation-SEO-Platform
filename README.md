# Auto-Blog: Automated Blog Generation Pipeline

## Project Overview

**Auto-Blog** is an end-to-end automated blog generation system that discovers trending topics, plans content, writes articles, generates images, performs quality checks, and publishes blogs. It uses **Google Trends**, **Google News**, and **GitHub Trending** as research sources, and **Vertex AI (Google's Gemini)** for content generation.

The system is built as a **Next.js application** with a **BullMQ-based job queue** (Redis), **Prisma ORM** for data persistence (PostgreSQL), and modular worker processes for each pipeline stage.

---

## Architecture Overview

### Tech Stack
- **Frontend/Framework**: Next.js 16.2 + React 19 + TypeScript
- **Job Queue**: BullMQ + Redis
- **Database**: PostgreSQL + Prisma ORM
- **AI Models**: Google Vertex AI (Gemini 2.5 Pro / Flash). Hero images are rendered
  locally as SVG — no image model is called.
- **Styling**: Tailwind CSS 4 + shadcn/ui components
- **Logging**: Winston
- **XML Parsing**: fast-xml-parser

### Core Components
1. **Next.js App** (`/app`) - Web UI dashboard & API endpoints
2. **Workers** (`/workers`) - 7 autonomous processing stages
3. **Shared Libraries** - Queue management, Prisma client, logging, environment config
4. **Database Schema** - 11 models tracking trends, content, blogs, and metrics

---

## Data Flow: The 7-Stage Pipeline

The system runs a **continuous workflow loop** where each stage processes jobs from a queue, performs work, and passes results to the next stage.

```
Research → Planning → Outline → Writing → Image → Quality → Publish
```

### Stage 1: Research Worker
**Purpose**: Discover trending topics and validate research signals

**Input**: Cron trigger (every 2 hours: `0 */2 * * *`)

**Process**:
- Fetches trending topics from:
  - **Google Trends** (via `sources/google-trends.ts`)
  - **Google News** (via `sources/google-news.ts`)  
  - **GitHub Trending** (via `sources/github-trending.ts`)
- Normalizes raw signals into a unified shape (`pipeline/normalize.ts`)
- Deduplicates signals within recent cutoff window (`pipeline/dedupe.ts`)
- Scores clusters based on signal strength (`pipeline/score.ts`)
- Promotes top N candidates as `Trend` rows (`pipeline/promote.ts`)

**Output**: Creates `Trend` records with status `NEW`, dispatches to **Planning Queue**

**Database Impact**:
- Inserts `Trend` rows (topic, source, category, score, status=NEW)
- Logs worker attempt in `WorkerAttempt`
- Records AI usage metrics in `AIUsage`

---

### Stage 2: Planning Worker
**Purpose**: Develop content strategy for each trend

**Input**: Jobs from Planning Queue (one per Trend)

**Process**:
- Receives `trendId` + trend metadata
- Calls **Vertex AI** (Gemini) to generate:
  - Search intent analysis
  - Target audience profile
  - Content angle/hook
  - Primary + secondary keywords
  - Competitor research notes
  - Internal notes for writers

**Output**: Creates `ContentPlan` row linked to Trend, dispatches to **Outline Queue**

**Database Impact**:
- Inserts `ContentPlan` with JSON fields (keywords, competitors, notes)
- Updates `Trend.status` → `PLANNED`

---

### Stage 3: Outline Worker
**Purpose**: Build detailed content structure

**Input**: Jobs from Outline Queue (ContentPlan data)

**Process**:
- Calls **Vertex AI** to generate:
  - SEO-optimized title
  - Meta description
  - H2 sections (heading + intent + bullet points)
  - FAQ section (questions + answer intents)
  - Slug for blog URL

**Output**: Creates `ContentOutline` row with structured JSON sections, dispatches to **Writing Queue**

**Database Impact**:
- Inserts `ContentOutline` with sections and FAQ structure

---

### Stage 4: Writing Worker
**Purpose**: Generate full blog post markdown

**Input**: Jobs from Writing Queue (Outline + Plan data)

**Process**:
- Calls **Vertex AI** to expand outline into:
  - Full-length markdown blog post (min 1000 words, target 2000+)
  - SEO metadata (title, slug, category)
  - HTML rendering
- Applies **quality gate**:
  - Checks for minimum word count
  - Validates H1 presence + H2 count (≥8 sections)
  - Confirms FAQ section exists
  - Verifies call-to-action present
  - Calculates heuristic score (0-100)
- Creates `Blog` record + `BlogSEO` metadata
- Converts markdown → HTML

**Output**: Creates `Blog` + `BlogSEO` rows, dispatches to **Image Queue** if passed gate

**Database Impact**:
- Inserts `Blog` (title, slug, content, html, status=DRAFT)
- Inserts `BlogSEO` (metaTitle, metaDescription, keywords, schema)
- Inserts `Category` if new
- Logs attempt with quality gate results

---

### Stage 5: Image Worker
**Purpose**: Generate the hero image and upload it

**Input**: Jobs from Image Queue (Blog metadata)

**Process**:
- Renders an editorial hero image locally as SVG (`image-worker/generator.ts`) from
  the blog title, category and excerpt — deterministic, no API call, **$0 cost**
- Uploads to **S3** (bucket path + CDN public URL)
- Links image to Blog as `featuredImage`

> Swapping this for Vertex Imagen is a drop-in change to `generateEditorialHeroImage`;
> until then the dashboard correctly reports zero image spend.

**Output**: Updates Blog with `featuredImageId`, dispatches to **Quality Queue**

**Database Impact**:
- Inserts `Asset` (fileName, bucket, path, publicUrl, dimensions)
- Updates `Blog.featuredImageId` foreign key

---

### Stage 6: Quality Worker (QA Validator)
**Purpose**: Comprehensive content quality scoring

**Input**: Jobs from Quality Queue (published Blog)

**Process**:
- Runs 10-point quality checklist:
  1. SEO Structure (title, meta, keywords, schema)
  2. Content Completeness (word count, sections, depth)
  3. Readability (avg sentence length, passive voice %)
  4. Content Quality (originality, relevance, depth)
  5. Keyword Optimization (placement, density, LSI)
  6. Technical SEO (headers, alt text, links)
  7. Formatting & UX (spacing, lists, code blocks)
  8. Media Quality (image resolution, compression)
  9. AI Fact Quality (factual accuracy, citations)
  10. Publishing Readiness (final gate check)
- Generates overall score (0-100) and pass/fail recommendation
- Detailed notes per check

**Output**: Creates `QualityReport`, updates Blog status → `PUBLISHED` or `FAILED`

**Database Impact**:
- Inserts `QualityReport` with individual scores + checks array
- Updates `Blog.status` based on report.passed

---

### Stage 7: Publish Worker
**Purpose**: Deploy blog to production

**Input**: Jobs from Publish Queue (approved blogs)

**Process**:
- Validates Blog.status = `PUBLISHED`
- Triggers external publishing API (e.g., CMS, CDN, webhook)
- Records publish timestamp + URL
- Marks job complete

**Output**: Blog is live on website

**Database Impact**:
- Final `Blog.status` update
- WorkflowRun completion

---

## Database Schema

### Key Models

**Trend** (discovered topics)
- `id`, `topic`, `source` (google_trends|google_news|github_trending), `category`, `score`, `status` (NEW→PLANNED→PROCESSED)

**ContentPlan** (strategy)
- `trendId` (FK), `searchIntent`, `audience`, `angle`, `primaryKeyword`, `secondaryKeywords` (JSON), `competitorNotes` (JSON)

**ContentOutline** (structure)
- `trendId` (FK), `planId` (FK), `title`, `slug`, `metaTitle`, `metaDescription`, `sections` (JSON), `faqs` (JSON)

**Blog** (final article)
- `title`, `slug`, `content` (markdown), `html`, `categoryId` (FK), `featuredImageId` (FK), `status` (DRAFT|PENDING_REVIEW|PUBLISHED|FAILED|ARCHIVED)

**BlogSEO** (metadata)
- `blogId` (FK), `metaTitle`, `metaDescription`, `keywords` (JSON), `schema` (JSON), `score`

**QualityReport** (validation)
- `blogId` (FK), `overallScore`, 10 individual scores, `passed` (boolean), `checks` (JSON with details)

**Asset** (images)
- `fileName`, `bucket`, `path`, `publicUrl`, `mimeType`, `width`, `height`, `size`

**WorkflowRun** (execution tracking)
- `trendId` (FK), `blogId` (FK), `status`, `currentStage`

**WorkerAttempt** (per-stage audit)
- `workflowRunId` (FK), `worker`, `status`, `input` (JSON), `output` (JSON), `error` (if failed)

**AIUsage** (cost tracking)
- `worker`, `model`, `blogId` (FK), `trendId`, `promptTokens`, `completionTokens`,
  `cost` (USD, computed at write time), `latency` (ms)
- Indexed on `blogId`, `createdAt`, `(worker, createdAt)`, `(model, createdAt)` for
  fast dashboard rollups

---

## Queue Architecture (BullMQ + Redis)

Each stage has its own **job queue**:

```typescript
researchQueue      // Trend discovery (cron-triggered)
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
- `ResearchJobPayload` - sources config
- `PlanningJobPayload` - trendId
- `OutlineJobPayload` - planId + content
- `WritingJobPayload` - outlineId + trend data
- `ImageJobPayload` - blogId + title + topic
- `QualityJobPayload` - blogId
- `PublishJobPayload` - blogId + publishUrl

---

## Dashboard & Monitoring

### Executive Dashboard (`/app/dashboard/page.tsx`)

**Real-time metrics** (polls `/api/dashboard` every 3 seconds):
- Daily published count (goal: 20/day)
- Success rate (% passed QA)
- AI cost today (Gemini + Imagen spend)
- Average quality score (0-100)

**Pipeline visualization**:
- Live stage status (Research → Publish)
- Queue counts per stage
- Active/waiting/failed/completed jobs
- Animated progress bars + color-coded health states

**Recent generations table**:
- Latest 6 blogs with title, category, trend score, quality, status
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
- `/dashboard/workers` - Queue inspector (active jobs, retry logs, dead-letter queue)
- `/dashboard/trends` - Trend management (approve/reject, category assignment)
- `/dashboard/quality` - QA report viewer (scores, checks, recommendations)
- `/dashboard/assets` - Image gallery (generated feature images)
- `/dashboard/settings` - Configuration (enabled sources, quality gates, publish endpoints)
- `/dashboard/logs` - Worker execution logs (errors, gate failures, timing)

---

## API Endpoints

**Dashboard Data**
- `GET /api/dashboard` - Aggregate metrics, pipeline status, recent blogs

**Trend Management**
- `GET /api/trends/[id]` - Fetch trend details
- `POST /api/trends/[id]/approve` - Promote trend to planning

**Research Trigger**
- `POST /api/research/run` - Manually trigger research cycle

---

## Worker Commands

Start individual workers or all at once:

```bash
npm run worker:research      # Fetch trends from sources
npm run worker:planning      # Generate content plans
npm run worker:outline       # Build content structures
npm run worker:writing       # Write full blog posts
npm run worker:image         # Generate feature images
npm run worker:quality       # Validate quality & assign scores
npm run worker:publish       # Publish to production
npm run worker:dev           # Start all workers concurrently
```

**Manual research trigger**:
```bash
npm run worker:research:once
```

---

## Configuration & Environment

Key environment variables (`workers/shared/env.ts`):
- `GOOGLE_TRENDS_GEO` - Country code (e.g., "US")
- `RESEARCH_MIN_SCORE_TO_WRITE` - Score threshold to generate blog
- `RESEARCH_RECENT_DUPLICATE_DAYS` - Dedup cutoff window
- `BLOG_MIN_WORDS` - Minimum word count for publishing
- `VERTEX_API_KEY` - Google Cloud API credentials
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection for BullMQ
- `STORAGE_BUCKET` - Cloud storage for images
- `PUBLISH_WEBHOOK_URL` - External publish endpoint

---

## Error Handling & Recovery

**Quality Gates** (per stage):
- Research: Score threshold
- Writing: H1/H2/FAQ validation + word count
- Quality: Multi-point checklist

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

### 2. Multi-Source Research
- Aggregates signals from 3+ sources
- Deduplication logic prevents duplicate trends
- Scoring model weights signals by source quality

### 3. Quality Gates at Each Stage
- Writing validates structure (H1, H2s, FAQ, CTA)
- Quality worker runs 10-point checklist
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
Trend (NEW)
  ↓ [Planning Worker]
Trend (PLANNED) + ContentPlan created
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
Blog deployed to production
```

---

## Next Steps (Potential Improvements)

1. **Expand Research Sources** - RSS feeds, Substack, Product Hunt, HackerNews
2. **A/B Testing** - Test multiple outlines per trend, publish top performer
3. **Personalization** - Audience segmentation (tech vs business vs lifestyle)
4. **Analytics Integration** - Track published blog performance (views, clicks)
5. **Feedback Loop** - Low-performing blogs inform future research filters
6. **Multi-language Support** - Generate blogs in Spanish, French, German
7. **Monetization** - Ad placement, affiliate links, sponsored content hooks
8. **Real-time Alerts** - Notify on viral trends before competitors
9. **SEO Competitor Analysis** - Scrape SERP data to inform outlines
10. **Custom Brand Voice** - Fine-tune prompts per publication brand

---

## Running the Project

```bash
# Install dependencies
npm install

# Run migrations (if updating schema)
npx prisma migrate dev

# Start Next.js dev server (dashboard UI)
npm run dev

# In separate terminals, start workers
npm run worker:dev

# Or individually:
npm run worker:research
npm run worker:planning
# ... etc
```

**Dashboard**: http://localhost:3000/dashboard
**API**: http://localhost:3000/api/...

---

## Summary

**Auto-Blog** is a **production-grade automated content engine** that turns trending topics into publication-ready blogs through 7 autonomous pipeline stages. It combines multi-source research discovery with AI-powered content generation, rigorous quality validation, and real-time dashboarding. The modular BullMQ-based architecture scales horizontally, audit trails enable debugging, and transparent cost tracking ensures economic viability.
