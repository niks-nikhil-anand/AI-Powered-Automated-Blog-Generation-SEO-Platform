# Auto-Blog: Complete Architecture & Issues Overview

**Project:** Blog Automation  
**Status:** 🔴 NOT PRODUCTION READY  
**Last Audit:** 2026-09-01  
**Assessment:** 45 documented issues across security, pipeline, quality, reliability, UX, SEO, and architecture

---

## 1. ARCHITECTURE AT A GLANCE

### System Architecture
```
┌─────────────────────────────────────────────────────────────────────┐
│                    NEXT.JS DASHBOARD (Port 3000)                    │
│  (/app/dashboard) - Web UI for monitoring, settings, and manual ops │
└────────────────────────────┬────────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
    ┌───▼──────────────────────┐     ┌──────────▼─────────────────┐
    │   API ROUTES (/app/api)   │     │  WORKER PROCESSES         │
    │                           │     │  (separate processes)      │
    │ - Dashboard metrics       │     │                           │
    │ - Trend management        │     │  1. Research Worker       │
    │ - Settings/config         │     │  2. Planning Worker       │
    │ - Manual triggers         │     │  3. Outline Worker        │
    │ - Worker actions          │     │  4. Writing Worker        │
    │                           │     │  5. Image Worker          │
    │                           │     │  6. Quality Worker        │
    │                           │     │  7. Publish Worker        │
    │                           │     │  + Vertex Gateway         │
    └───────────────────────────┘     └──────────────────────────┘
        │ Reads/writes                     │ Queue jobs
        │                                  │
        └──────────────────┬───────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
    ┌───▼────────────────────┐   ┌──────────▼────────────────┐
    │  PostgreSQL Database   │   │  Redis (Job Queue)        │
    │  (Prisma ORM)          │   │  (BullMQ - 7 queues)     │
    │                        │   │                           │
    │  Tables:               │   │ Queues:                   │
    │  - Trend               │   │ - research                │
    │  - ContentPlan         │   │ - planning                │
    │  - ContentOutline      │   │ - outline                 │
    │  - Blog                │   │ - writing                 │
    │  - BlogSEO             │   │ - image                   │
    │  - Asset               │   │ - quality                 │
    │  - QualityReport       │   │ - publish                 │
    │  - WorkflowRun         │   │                           │
    │  - WorkerAttempt       │   │ Secondary:                │
    │  - AIUsage             │   │ - Vertex pacing (Redis)   │
    │  - etc.                │   │ - Rate limiting           │
    └────────────────────────┘   └───────────────────────────┘
                                        │
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
            ┌────────────────┐  ┌──────────────┐  ┌──────────────────┐
            │ Google Trends  │  │ Google News  │  │ GitHub Trending  │
            │ (API)          │  │ (Web scrape) │  │ (Web scrape)     │
            └────────────────┘  └──────────────┘  └──────────────────┘
                    │                   │                   │
                    └───────────────────┼───────────────────┘
                                        │
                                        ▼
                        ┌────────────────────────────┐
                        │  Vertex AI (Google Gemini) │
                        │  - Planning                 │
                        │  - Outline                  │
                        │  - Writing                  │
                        │  - Quality checks           │
                        └────────────────────────────┘
```

### Tech Stack Summary
| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16.2 + React 19 + TypeScript + Tailwind CSS 4 |
| **Job Queue** | BullMQ (Redis-backed) |
| **Database** | PostgreSQL + Prisma ORM (v7.9.1) |
| **AI/LLM** | Vertex AI (Google Gemini 2.5 Pro/Flash) |
| **Image Generation** | SVG rendering (local, $0 cost) |
| **Logging** | Winston + Langfuse analytics |
| **Environment** | Docker Compose for local dev |

---

## 2. THE 7-STAGE PIPELINE FLOW

```
INPUT SOURCES          PROCESSING STAGE                  OUTPUT QUEUE
──────────────────────────────────────────────────────────────────────

Google Trends  ┐
Google News    ├──→ [1. RESEARCH WORKER] ──→ Trend (NEW) ──→ Planning Queue
GitHub Trending┘     • Fetch signals
                     • Normalize
                     • Dedup (7-day window)
                     • Score + promote


                     ┌─────────────────────────────────┐
                     │ PLANNING QUEUE                   │
                     └────────────┬────────────────────┘
                                  │
                                  ▼
                     [2. PLANNING WORKER]
                     • Generate content strategy
                     • Search intent analysis
                     • Audience profiling
                     • Keyword research
                     • Competitor notes
                     
                                  │
                                  ▼
                     ┌─────────────────────────────────┐
                     │ Vertex API (Gemini 2.5 Pro)    │
                     │ • Planning prompts              │
                     └────────────┬────────────────────┘
                                  │
                        Create ContentPlan ────→ Outline Queue
                        (strategy + keywords)


                     ┌─────────────────────────────────┐
                     │ OUTLINE QUEUE                    │
                     └────────────┬────────────────────┘
                                  │
                                  ▼
                     [3. OUTLINE WORKER]
                     • Generate content structure
                     • H2 sections with bullets
                     • FAQ questions
                     • SEO title + meta description
                     • URL slug generation
                     
                                  │
                                  ▼
                     ┌─────────────────────────────────┐
                     │ Vertex API (Gemini 2.5 Pro)    │
                     │ • Outline prompts               │
                     └────────────┬────────────────────┘
                                  │
                        Create ContentOutline ────→ Writing Queue
                        (structure + sections)


                     ┌─────────────────────────────────┐
                     │ WRITING QUEUE                    │
                     └────────────┬────────────────────┘
                                  │
                                  ▼
                     [4. WRITING WORKER]
                     • Expand outline to full article
                     • ~1500-2500 words
                     • Markdown formatting
                     • Citation materialization
                     • Quality self-checks:
                       - Min 1000 words
                       - 8+ H2 sections
                       - FAQ present
                       - CTA present
                     • Markdown → HTML conversion
                     
                                  │
                                  ▼
                     ┌─────────────────────────────────┐
                     │ Vertex API (Gemini 2.5 Pro)    │
                     │ • Writing prompts               │
                     │ • Fact-checking                 │
                     └────────────┬────────────────────┘
                                  │
                    Create Blog + BlogSEO records ────→ Image Queue
                    (article + metadata)


                     ┌─────────────────────────────────┐
                     │ IMAGE QUEUE                      │
                     └────────────┬────────────────────┘
                                  │
                                  ▼
                     [5. IMAGE WORKER]
                     • Generate hero image (SVG)
                     • Title + category + excerpt
                     • Upload to S3 storage
                     • Link to Blog record
                     
                                  │
                                  ▼
                     ┌─────────────────────────────────┐
                     │ Cloud Storage (S3)              │
                     │ • Featured image upload         │
                     └────────────┬────────────────────┘
                                  │
                        Create Asset record ────→ Quality Queue


                     ┌─────────────────────────────────┐
                     │ QUALITY QUEUE                    │
                     └────────────┬────────────────────┘
                                  │
                                  ▼
                     [6. QUALITY WORKER]
                     • 10-point checklist:
                       1. SEO structure
                       2. Content completeness
                       3. Readability
                       4. Content quality
                       5. Keyword optimization
                       6. Technical SEO
                       7. Formatting & UX
                       8. Media quality
                       9. Fact-checking
                       10. Publishing readiness
                     
                                  │
                                  ▼
                     ┌─────────────────────────────────┐
                     │ Vertex API (Gemini 2.5 Flash)  │
                     │ • Quality assessment            │
                     └────────────┬────────────────────┘
                                  │
                    Create QualityReport + ────→ Publish Queue
                    Update Blog.status              (if PASSED)
                    (PUBLISHED or FAILED)


                     ┌─────────────────────────────────┐
                     │ PUBLISH QUEUE                    │
                     └────────────┬────────────────────┘
                                  │
                                  ▼
                     [7. PUBLISH WORKER]
                     • Validate Blog.status = PUBLISHED
                     • Trigger external publish API
                     • Record publish timestamp
                     
                                  │
                                  ▼
                     ┌─────────────────────────────────┐
                     │ PRODUCTION (Blog live)          │
                     │ • Public URL                    │
                     │ • Crawlable by search engines   │
                     └─────────────────────────────────┘
```

### Pipeline Triggers
- **Research**: Cron every 2 hours (`0 */2 * * *`)
- **Manual Research**: API endpoint `/api/research/run`
- **Manual Topic**: Topics Pool editorial queue
- **Auto-cascade**: Each stage dispatches to next queue on success

---

## 3. DATABASE SCHEMA (SIMPLIFIED)

```
┌─────────────────────────────────────────────────────────────────┐
│                      PIPELINE DATA FLOW                         │
└─────────────────────────────────────────────────────────────────┘

Trend (id, topic, source, category, score, status: NEW→PLANNED→PROCESSED)
  │ [Planning]
  ├──→ ContentPlan (searchIntent, audience, angle, keywords, competitors)
  │      │ [Outline]
  │      └──→ ContentOutline (title, slug, metaTitle, metaDescription, sections[], faqs[])
  │            │ [Writing]
  │            └──→ Blog (title, slug, content, html, status: DRAFT→PENDING→PUBLISHED/FAILED)
  │                  │ └──→ BlogSEO (metaTitle, metaDescription, keywords, schema)
  │                  │
  │                  │ [Image]
  │                  ├──→ Asset (fileName, bucket, publicUrl, dimensions, mimeType)
  │                  │
  │                  │ [Quality]
  │                  └──→ QualityReport (overallScore, checks[], passed, recommendations)


┌─────────────────────────────────────────────────────────────────┐
│                      AUDIT & TRACKING                           │
└─────────────────────────────────────────────────────────────────┘

WorkflowRun (trendId, blogId, status, currentStage, failureReason)
  │
  └──→ WorkerAttempt (workflowRunId, worker, status, input, output, error)

AIUsage (worker, model, blogId, promptTokens, completionTokens, cost, latency)

ResearchRun (date, signalsCollected, duplicate_count, trends_promoted)


┌─────────────────────────────────────────────────────────────────┐
│                      CONFIGURATION                              │
└─────────────────────────────────────────────────────────────────┘

AppSetting (key, value, updatedAt)
  - google_trends_enabled, enabled_sources, retry_limits, etc.

Category (id, name, slug, description)

ManualTopic (id, title, keywords, priority, status, archived_at)
```

---

## 4. SECURITY ISSUES (🔴 CRITICAL)

### 🔴 SEC-001: No Authentication/Authorization on Operational APIs
**Severity:** CRITICAL  
**Files:** 
- `app/api/settings/route.ts`
- `app/api/research/run/route.ts`
- `app/api/workers/actions/route.ts`
- `app/api/blogs/[id]/override-publish/route.ts`
- `app/api/topics-pool/route.ts`

**Problem:** Every API endpoint performs database mutations without checking user session, API key, or authorization.

**Impact:** Anyone can change settings, trigger research, retry jobs, override publishing, or modify topics.

**Fix:**
1. Add authentication middleware (NextAuth.js or similar)
2. Add role-based authorization (admin/operator/viewer)
3. Verify user identity on every mutating endpoint
4. Add CSRF tokens to form submissions
5. Rate-limit sensitive endpoints (research trigger, regenerate, etc.)

**Priority:** FIX FIRST before any production deployment

---

### 🔴 SEC-002: Cloud Credentials Exposed in Local Environment
**Severity:** CRITICAL  
**Files:**
- `.env` (GCP_CREDENTIALS_JSON)
- `redsxp-client-80457b588e24.json` (generated)

**Problem:** GCP service account private key is in `.env` file locally. Although `.gitignore` excludes it, accidental copying or workspace sharing is a serious risk.

**Impact:** Compromised credentials allow unauthorized Vertex API access and cloud resource access.

**Fix:**
1. Immediately rotate/revoke the current GCP service account key
2. Remove GCP_CREDENTIALS_JSON from `.env`
3. Replace with Google Cloud Workload Identity or Secret Manager
4. Clean up generated JSON files from workspace
5. Add `.env` pattern to `.dockerignore`

**Priority:** CRITICAL - Do this today

---

### 🔴 SEC-003: Docker Build Can Bake Secrets into Images
**Severity:** CRITICAL  
**Files:**
- `docker/Dockerfile.worker`
- `docker-compose.yml`

**Problem:** Dockerfile uses `COPY . .` which can include `.env`, then `COPY .env* ./` explicitly.

**Impact:** A build-context mistake or CI misconfiguration bakes secrets into image layers.

**Fix:**
1. Remove `.env` from Dockerfile entirely
2. Use Docker secrets or environment variables at runtime
3. Add strict `.dockerignore`:
   ```
   .env
   .env.*
   redsxp-client-*.json
   node_modules
   .git
   ```
4. Use `--secret` flag in Docker build for sensitive data
5. Scan images with `docker scan` before deployment

---

### 🟠 SEC-004: Hard-Coded Database Credentials
**Severity:** HIGH  
**Files:** `docker-compose.yml`

**Problem:** `POSTGRES_PASSWORD: postgrespassword` hardcoded in Compose file.

**Fix:**
1. Use `.env.local` for development
2. Use AWS Secrets Manager or Google Secret Manager for production
3. Rotate passwords regularly

---

### 🟠 SEC-005: No CSRF or Rate Limiting on Expensive Operations
**Severity:** HIGH  
**Files:** All `app/api/*` routes

**Problem:** POST/PATCH/DELETE endpoints accept requests without CSRF tokens, rate limits, or idempotency controls.

**Fix:**
1. Add CSRF middleware (NextAuth provides this)
2. Implement rate limiting on expensive endpoints:
   - `/api/research/run` - 1 per hour
   - `/api/blogs/[id]/regenerate` - 1 per hour
   - `/api/workers/actions` - 3 per hour
3. Add idempotency keys to prevent double-processing

---

## 5. PIPELINE CORRECTNESS ISSUES (🔴 CRITICAL)

### 🔴 PIPE-001: No Successful End-to-End Pipeline Run
**Severity:** CRITICAL (Release Blocker)  
**Problem:** The most recent attempt never reached Quality Worker. All researched trends were filtered as duplicates.

**Impact:** Cannot verify that Research → Planning → Outline → Writing → Image → Quality → Publish works.

**Fix:**
1. Run a fresh isolated research cycle
2. Verify at least 1 topic gets promoted
3. Watch it through to Quality Worker
4. Document metrics at each stage
5. Sign off before production

**Test Plan:**
```
npm run worker:research:once
# Wait for trends to be promoted
npm run worker:planning
npm run worker:outline
npm run worker:writing
npm run worker:image
npm run worker:quality
npm run worker:publish
# Verify Blog.status = PUBLISHED in database
```

---

### 🔴 PIPE-002: Claim Field Shape Mismatch (Outline vs Writing)
**Severity:** CRITICAL  
**Files:**
- `workers/outline-worker/types.ts` (uses `text` field)
- `workers/shared/evidence-validator.ts` (expects `claim` field)
- `workers/writing-worker/index.ts` (passes outline directly)

**Problem:** Outline creates claims with `{ text: "..." }` shape. Writing expects `{ claim: "..." }` shape. Outline normalizes this locally but doesn't persist the fix.

**Impact:** Outline passes validation, but when Writing reads persisted outline, validation fails because shape is still `text`.

**Flow:**
```
Outline Stage:
  Generate claims → { text: "..." }  ✅
  Normalize to     → { claim: "..." }  ✅ (in memory)
  Validate        → ✅
  Persist         → { text: "..." }  ❌ (saves original!)

Writing Stage:
  Read outline → { text: "..." }
  Validate    → ❌ (expects { claim: "..." })
  FAILS
```

**Fix:**
1. **Option A (Simple):** Update outline-worker to persist normalized claims
   - In `workers/outline-worker/index.ts`, save `validatedOutline.claims` not original
   
2. **Option B (Robust):** Unify claim shape globally
   - Change `evidence-validator.ts` to accept both `text` and `claim`
   - Document the canonical shape
   - Update all workers to use that shape

**Recommended:** Option B (long-term) + Option A (immediate fix)

---

### 🔴 PIPE-003: Evidence Validation Not Persisted
**Severity:** CRITICAL  
**Files:**
- `workers/outline-worker/index.ts`
- `prisma/schema.prisma` (ContentOutline model)

**Problem:** Outline worker creates `validatedOutline` in memory and validates claims, but `ContentOutline` table only persists title, sections, FAQs—not the validation results or validated claims.

**Impact:** Later stages can't inspect validation state. Runtime state must be recomputed. Auditability is lost.

**Fix:**
1. Add fields to `ContentOutline`:
   ```prisma
   model ContentOutline {
     // ... existing fields
     validationDiagnostics  String?   // JSON: validation results
     validatedClaims        Json?     // claims after normalization
     claimValidationPassed  Boolean   @default(false)
     claimValidationErrors  String[]  @default([])
   }
   ```

2. In outline-worker, persist the validation result:
   ```typescript
   await prisma.contentOutline.update({
     data: {
       validationDiagnostics: JSON.stringify(validation),
       validatedClaims: validatedOutline.claims,
       claimValidationPassed: validation.passed
     }
   });
   ```

3. Writing worker reads this instead of recomputing:
   ```typescript
   if (!outline.claimValidationPassed) {
     throw new Error("Outline claims failed validation");
   }
   ```

---

### 🟠 PIPE-004: Legacy Evidence Fallback Bypasses Strongest Contract
**Severity:** HIGH  
**Files:** `workers/shared/evidence.ts`

**Problem:** When evidence extraction fails, fallback returns empty array. Writing then uses legacy `evidenceSummary` path, bypassing full evidence validation.

**Impact:** Older trends can proceed with weak grounding even when full evidence validation is unavailable.

**Fix:**
1. Make full evidence extraction mandatory
2. If extraction fails, mark Trend as FAILED and don't proceed to writing
3. Log extraction failures separately for debugging

---

### 🟠 PIPE-005: Failed Evidence Can Leave Trend Write-Eligible
**Severity:** HIGH  
**Problem:** Research evidence ingestion is fail-soft. A trend can have no usable extracted evidence but still pass score thresholds.

**Fix:**
1. Add evidence extraction quality check in research stage
2. Only promote trends that have both:
   - Score ≥ threshold
   - At least 1 extractable evidence source
3. Mark trends with failed extraction separately

---

### 🟠 PIPE-006: Manual Topic Enqueue Doesn't Validate
**Severity:** HIGH  
**Files:** `app/api/topics-pool/[id]/research/route.ts`

**Problem:** Endpoint enqueues topic without verifying it exists or is eligible.

**Fix:**
```typescript
// Before enqueuing:
const topic = await prisma.manualTopic.findUnique({ where: { id } });
if (!topic) throw new Error("Topic not found");
if (topic.archived) throw new Error("Topic is archived");
if (topic.status === "PROCESSED") throw new Error("Topic already processed");

// Then enqueue
await enqueueResearchJob({ manualTopicId: id });
```

---

### 🟡 PIPE-007: Topics Pool Has No Uniqueness Constraint
**Severity:** MEDIUM  
**Problem:** No unique key on `ManualTopic.title`. Repeated imports create duplicates.

**Fix:**
```prisma
model ManualTopic {
  id      String @id @default(cuid())
  title   String @unique  // ADD THIS
  // ...
}
```

Then in API:
```typescript
// Try update first, then create if not found
const topic = await prisma.manualTopic.upsert({
  where: { title },
  update: { priority },
  create: { title, keywords, priority }
});
```

---

### 🟡 PIPE-008: Legacy `Job` Model Is Dead Storage
**Severity:** MEDIUM  
**Problem:** `Job` table exists in schema but is never written. BullMQ + `WorkflowRun`/`WorkerAttempt` are the real sources.

**Fix:**
1. Remove `Job` model from `prisma/schema.prisma`
2. Run migration: `npx prisma migrate dev --name remove_legacy_job_table`
3. Update code references if any

---

## 6. LLM/EVIDENCE/CITATION QUALITY ISSUES (🔴 to 🟡)

### 🔴 AI-001: Evidence Matching Is Token Containment, Not Entailment
**Severity:** CRITICAL  
**Files:** `workers/shared/evidence-validator.ts`

**Problem:** `claimMatchesFact()` checks if claim tokens appear in fact string. This rejects valid paraphrases and accepts misleading claims that reuse source vocabulary.

**Example:**
- Claim: "Python is faster than Java"
- Fact: "Java is faster than Python for compiled code"
- Result: ✅ PASSES (tokens match) but claim is contradictory!

**Fix:**
```typescript
// Replace token containment with semantic similarity
import { cosineSimilarity } from "some-embedding-lib"; // e.g., @xenova/transformers

async function claimMatchesFact(claim: string, fact: string): Promise<boolean> {
  // Option 1: Use embeddings + cosine similarity
  const claimEmbedding = await embed(claim);
  const factEmbedding = await embed(fact);
  const similarity = cosineSimilarity(claimEmbedding, factEmbedding);
  return similarity > 0.75; // Tunable threshold
  
  // Option 2: Use Vertex AI to check entailment
  const response = await vertex.generateContent(
    `Does this fact entail the claim?\n\nClaim: ${claim}\n\nFact: ${fact}\n\nReply only with YES or NO.`
  );
  return response.text().includes("YES");
}
```

**Cost:** Option 2 adds ~$0.001/check. Worth it for accuracy.

---

### 🟠 AI-002: Foreign URLs Don't Fail Citation Gate
**Severity:** HIGH  
**Files:** `workers/writing-worker/index.ts`

**Problem:** Unrelated external links are logged but don't fail the citation gate.

**Fix:**
```typescript
// In writing-worker, after citation materialization:
if (foreignLinks.length > 0) {
  // Option 1: Fail if ANY foreign links
  throw new Error(`Article contains unrelated citations: ${foreignLinks.join(", ")}`);
  
  // Option 2: Fail if too many foreign links
  if (foreignLinks.length > 2) {
    throw new Error("Too many unrelated external citations");
  }
}
```

---

### 🟠 AI-003: Over-Require All Research Sources to Be Cited
**Severity:** HIGH  
**Files:** `workers/writing-worker/citations.ts`

**Problem:** Citation check requires every supplied evidence source to be cited, even if unused.

**Fix:**
Change from source-centric to claim-centric:
```typescript
// OLD: "Every source must be cited"
function checkCitations(article: string, sources: Source[]): boolean {
  for (const source of sources) {
    if (!article.includes(source.url)) return false; // ❌ Too strict
  }
  return true;
}

// NEW: "Every claim needs a citation"
function checkCitations(article: string, sources: Source[]): boolean {
  const claims = extractClaims(article); // sentences with [1], [2], etc.
  const citedSources = extractCitations(article); // [1], [2], etc.
  
  for (const claim of claims) {
    if (claim.requiresEvidence && !claim.hasCitation) {
      return false; // Claim without citation
    }
  }
  
  // Unused sources are OK
  return true;
}
```

---

### 🟠 AI-004: Incomplete Claim Extraction
**Severity:** HIGH  
**Files:** `workers/writing-worker/citations.ts`

**Problem:** `extractArticleClaimMappings()` only finds claims with sentence markers. Misses bullets, tables, code, headings.

**Fix:**
```typescript
function extractArticleClaimMappings(html: string): Claim[] {
  const claims: Claim[] = [];
  
  // 1. Sentences with markers [1], [2], etc.
  const sentenceRegex = /([^.!?]+[.!?])\s*\[(\d+)\]/g;
  let match;
  while ((match = sentenceRegex.exec(html))) {
    claims.push({ text: match[1], sourceIdx: match[2] });
  }
  
  // 2. Bullet points (often factual claims)
  const bulletRegex = /<li[^>]*>([^<]+)<\/li>/g;
  while ((match = bulletRegex.exec(html))) {
    if (match[1].match(/\[(\d+)\]/)) {
      claims.push({ text: match[1], sourceIdx: match[2] });
    }
  }
  
  // 3. Table cells
  const cellRegex = /<td[^>]*>([^<]+)<\/td>/g;
  while ((match = cellRegex.exec(html))) {
    if (match[1].match(/\[(\d+)\]/)) {
      claims.push({ text: match[1], sourceIdx: match[2] });
    }
  }
  
  return claims;
}
```

---

### 🟡 AI-005: Different Fact-Check Paths Between Writing & Quality
**Severity:** MEDIUM  
**Problem:** Writing uses self-checks + canonical evidence. Quality has legacy fallback. Same article can get different verdicts.

**Fix:**
1. Unify fact-checking logic in shared module: `workers/shared/fact-check.ts`
2. Both Writing and Quality use same checker
3. Deprecate legacy summary path

---

### 🟡 AI-006: Heuristic Score Is Easy to Game
**Severity:** MEDIUM  
**Problem:** Score rewards verbose content with fixed structure, not quality.

**Fix:**
```typescript
// OLD heuristic (gameable):
score = (wordCount / 2000) * 25 + (headingCount / 8) * 25 + ...

// NEW: Mix format + quality signals
function scoreArticle(article: Blog, quality: QualityReport) {
  const structureScore = 
    (article.wordCount >= 1500 ? 20 : 10) +
    (article.headings.length >= 8 ? 20 : 10);
    
  const qualityScore = 
    quality.readabilityScore * 0.2 +
    quality.factualityScore * 0.3 +
    quality.originalityScore * 0.3;
    
  const overallScore = structureScore * 0.4 + qualityScore * 0.6;
  return Math.min(100, overallScore);
}
```

---

## 7. RELIABILITY & OPERATIONS ISSUES (🟠 to 🟡)

### 🟠 OPS-001: Production Build Not Verifiable
**Severity:** HIGH  
**Problem:** `npm run build` fails in test environment (Turbopack panic).

**Fix:**
```bash
# 1. Run locally first
npm run build

# 2. Check for errors
# 3. If you hit port binding error, use non-standard port
PORT=3001 npm run build

# 4. Verify build output
ls -la .next/

# 5. Test start
npm run start

# 6. Test routes in browser or with curl
curl http://localhost:3000/dashboard
```

---

### 🟠 OPS-002: Lint Failures (15 errors, 7 warnings)
**Severity:** HIGH  
**Problem:** ESLint not passing. CI cannot gate on it.

**Files with issues:**
- `components/ui/DataTable.tsx` - `any` types
- `components/ui/button.tsx` - `any` types
- `app/dashboard/assets/page.tsx` - `any` types
- `components/shared/AssetDetailModal.tsx` - missing alt text
- `app/dashboard/observability/page.tsx` - React hook error
- `components/shared/ThemeProvider.tsx` - React hook error
- Research sources - `any` types

**Fix:**
```bash
# 1. Run lint
npm run lint

# 2. Fix each error:
# For 'any' types: replace with explicit types
// ❌ const data: any = ...
// ✅ const data: BlogRow[] = ...

# For alt text: add missing alt
// ❌ <img src={url} />
// ✅ <img src={url} alt="Featured image for blog" />

# For react-hooks: check dependencies
// ❌ useEffect(() => { setState(...) }, [])
// ✅ useEffect(() => { 
//   const loadData = async () => { setState(...) };
//   loadData();
// }, []);

# 3. Verify clean
npm run lint
# Should output: "No warnings or errors"

# 4. Add to CI/CD gate
```

---

### 🟠 OPS-003: Vertex Quota Can Consume Expensive Attempts
**Severity:** HIGH  
**Problem:** When Vertex hits 429, stage capacity is spent before failure is visible.

**Current mitigations:**
- Redis-backed rate limiter
- Circuit breaker (if too many 429s)
- Bounded exponential backoff
- Max 1 concurrent Vertex call

**Additional fixes:**
```typescript
// In workers/shared/vertex-request.ts:

async function callVertexWithFallback(prompt: string) {
  try {
    return await callVertexWithRetry(prompt);
  } catch (error) {
    if (error.status === 429) {
      // Don't retry 429 — mark as quota exhausted
      logger.error("QUOTA_EXHAUSTED", { error });
      throw new QuotaExhaustedError("Vertex quota exceeded. Try again in 1 hour.");
    }
    throw error;
  }
}

// Surface quota exhaustion separately in UI
if (error instanceof QuotaExhaustedError) {
  updateDashboard({ quotaStatus: "EXHAUSTED", retryAt: futureTime });
}
```

---

### 🟡 OPS-004: Rate Limiter Fails Open
**Severity:** MEDIUM  
**Problem:** When Redis is down, rate limiting is disabled.

**Trade-off:** Availability vs cost control. This is documented in code.

**Fix (if switching to cost-safety-first):**
```typescript
// In workers/shared/rate-limit.ts:
async function checkQuota() {
  try {
    const remaining = await redis.get("vertex:quota:remaining");
    return remaining > 0;
  } catch (redisError) {
    // Option 1: Fail closed (strict)
    logger.error("Rate limiter unavailable. Blocking Vertex calls.");
    throw new Error("Rate limiter unavailable");
    
    // Option 2: Use in-process fallback
    return inProcessQuotaCheck();
    
    // Option 3: Current (fail open)
    logger.warn("Redis unavailable. Rate limiting disabled.");
    return true; // Allow call
  }
}
```

---

### 🟡 OPS-005: Research Source Health Degraded
**Severity:** MEDIUM  
**Problem:** SearXNG, Anthropic News, GitHub API failing in current environment. Degrades signal quality silently.

**Current failures:**
- SearXNG fetch failures
- Anthropic News HTTP 404
- GitHub Trending 401

**Fix:**
1. Add health checks to each source in research stage
2. Log source failure separately
3. If all sources fail, don't promote trends
4. Dashboard shows source health status

```typescript
// workers/research-worker/pipeline/engine.ts:
const sourceStatus = {
  google_trends: await checkGoogleTrends(),
  google_news: await checkGoogleNews(),
  github_trending: await checkGitHubTrending()
};

if (Object.values(sourceStatus).every(s => !s.healthy)) {
  logger.error("ALL_SOURCES_DOWN", sourceStatus);
  // Don't promote any trends
  return [];
}
```

---

### 🟡 OPS-006: Dashboard Queries Can Become Expensive
**Severity:** MEDIUM  
**Files:** `app/api/dashboard/route.ts`

**Problem:** Loads recent AI usage without limit. Workflow runs load all nested attempts. Grows unbounded.

**Fix:**
```typescript
// app/api/dashboard/route.ts:

async function getDashboard() {
  // ❌ Old: No limit
  // const aiUsage = await prisma.aiUsage.findMany({
  //   where: { createdAt: { gte: oneDayAgo } }
  // });
  
  // ✅ New: Explicit limits
  const aiUsage = await prisma.aiUsage.findMany({
    where: { createdAt: { gte: oneDayAgo } },
    take: 500, // Limit to 500 records
    orderBy: { createdAt: "desc" }
  });
  
  const workflows = await prisma.workflowRun.findMany({
    where: { createdAt: { gte: oneDayAgo } },
    take: 50,
    select: { id: true, status: true, currentStage: true }, // Don't load attempts
    orderBy: { createdAt: "desc" }
  });
  
  return { aiUsage, workflows };
}

// Also add database indexes:
// CREATE INDEX idx_aiusage_createdat ON "AIUsage"("createdAt");
// CREATE INDEX idx_workflow_createdat ON "WorkflowRun"("createdAt");
```

---

### 🟡 OPS-007: Widespread Background Polling
**Severity:** MEDIUM  
**Problem:** Multiple dashboard tabs polling every 3-15 seconds. Multiplies load.

**Fix:**
```typescript
// ✅ Smart polling with visibility detection
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.hidden) {
      clearInterval(interval); // Stop polling when tab hidden
    } else {
      startPolling(); // Resume when tab visible
    }
  };
  
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}, []);

// ✅ Exponential backoff for repeated failures
let interval = 3000; // Start at 3s
useEffect(() => {
  const poll = async () => {
    try {
      await fetchDashboard();
      interval = 3000; // Reset on success
    } catch (error) {
      interval = Math.min(interval * 1.5, 60000); // Cap at 60s
    }
  };
  const timer = setInterval(poll, interval);
  return () => clearInterval(timer);
}, []);
```

---

## 8. UX & ACCESSIBILITY ISSUES (🟠 to 🔵)

### 🟠 UX-001: No Bulk Import UI for Topics Pool
**Severity:** HIGH  
**Files:** `app/dashboard/topics/pool/page.tsx`

**Problem:** Editorial workflow requires bulk import (CSV/paste), but UI only supports one topic at a time.

**Fix:**
1. Add "Bulk Import" button
2. Modal with textarea for CSV/JSON
3. Parse and create topics
4. Show import summary (success/failures)

```typescript
// Add to TopicsPool component:
<button onClick={() => setShowBulkImport(true)}>
  Bulk Import
</button>

{showBulkImport && (
  <BulkImportModal
    onImport={async (topics) => {
      const results = await Promise.allSettled(
        topics.map(t => 
          fetch("/api/topics-pool", {
            method: "POST",
            body: JSON.stringify(t)
          })
        )
      );
      setImportResults(results);
    }}
  />
)}
```

---

### 🟡 UX-002: Inconsistent Error Handling
**Severity:** MEDIUM  
**Problem:** API responses often ignored in UI. Research updates don't refresh state.

**Fix:**
```typescript
// ✅ Better error handling
const update = async (topicId: string, data: any) => {
  try {
    const res = await fetch(`/api/topics-pool/${topicId}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Update failed");
    }
    
    const updated = await res.json();
    setTopics(prev => prev.map(t => t.id === topicId ? updated : t));
    showToast({ type: "success", message: "Updated" });
  } catch (error) {
    showToast({ type: "error", message: error.message });
  }
};
```

---

### 🟡 UX-003 to UX-007: Modal & Accessibility Issues
**Severity:** MEDIUM  
**Files:**
- `components/shared/AssetDetailModal.tsx` - No dialog semantics
- `app/dashboard/observability/page.tsx` - React hook errors

**Fixes:**
1. Use native `<dialog>` element or Radix Dialog
2. Add `role="dialog"`, `aria-labelledby`, `aria-describedby`
3. Trap focus within modal
4. Close on Escape key
5. Add alt text to all images
6. Test with keyboard only (Tab, Escape, Enter)

---

## 9. SEO & CONTENT ISSUES (🟠 to 🟡)

### 🟠 SEO-001: No Sitemap or Robots Policy
**Severity:** HIGH  
**Files:** None (missing files!)

**Fix:**
1. Create `app/sitemap.ts`:
```typescript
import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://yourdomain.com',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    // ... blog URLs from database
  ];
}
```

2. Create `app/robots.ts`:
```typescript
import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/blogs', '/categories'],
        disallow: ['/dashboard', '/api', '/admin'],
      },
    ],
    sitemap: 'https://yourdomain.com/sitemap.xml',
  };
}
```

---

### 🟠 SEO-002: Generic Global Metadata
**Severity:** HIGH  
**Files:** `app/layout.tsx`

**Fix:**
```typescript
// app/layout.tsx
export const metadata: Metadata = {
  title: "Auto-Blog - AI-Powered Content Generation",
  description: "Automated blog generation from trending topics",
};

// Then per-page: app/dashboard/page.tsx
export const metadata: Metadata = {
  title: "Dashboard | Auto-Blog",
  description: "Monitor pipeline performance and content metrics",
};

// app/blogs/[slug]/page.tsx
export async function generateMetadata({ params }): Promise<Metadata> {
  const blog = await getBlog(params.slug);
  return {
    title: blog.seo.metaTitle || blog.title,
    description: blog.seo.metaDescription,
    openGraph: {
      title: blog.title,
      description: blog.seo.metaDescription,
      images: [blog.featuredImage],
    },
  };
}
```

---

### 🟡 SEO-003: Incomplete Article Schema
**Severity:** MEDIUM  
**Problem:** Minimal TechArticle schema. Missing canonical, dates, publisher.

**Fix in writing-worker:**
```typescript
const schema = {
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  headline: blog.title,
  description: blog.seo.metaDescription,
  image: blog.featuredImage,
  datePublished: new Date().toISOString(),
  dateModified: new Date().toISOString(),
  author: {
    "@type": "Organization",
    name: "Your Site Name",
    logo: "https://yourdomain.com/logo.png"
  },
  publisher: {
    "@type": "Organization",
    name: "Your Site Name",
    logo: "https://yourdomain.com/logo.png"
  },
  mainEntity: {
    "@type": "WebPage",
    "@id": `https://yourdomain.com/blogs/${blog.slug}`
  }
};
```

---

### 🟡 SEO-004: Fixed Template Gates Too Restrictive
**Severity:** MEDIUM  
**Problem:** Quality gates require 8+ H2s, FAQ, CTA—forces template bloat for some topics.

**Fix:**
1. Make gates configurable per category
2. Allow variance based on word count
3. Reduce minimum H2s for short-form content

```typescript
// workers/quality-worker/index.ts:
const qualityGates = {
  tech: { minHeadings: 8, requireFaq: true, minWords: 2000 },
  news: { minHeadings: 5, requireFaq: false, minWords: 800 },
  tutorial: { minHeadings: 6, requireFaq: true, minWords: 1500 }
};

const gate = qualityGates[blog.category] || qualityGates.tech;
if (blog.headings.length < gate.minHeadings) {
  return fail("Insufficient sections");
}
```

---

### 🟡 SEO-005: No Confirmed Public Rendering Path
**Severity:** MEDIUM  
**Problem:** No clear route for rendering published blogs publicly.

**Fix:**
1. Create `app/blogs/[slug]/page.tsx`:
```typescript
export default async function BlogPage({ params }) {
  const blog = await prisma.blog.findUnique({
    where: { slug: params.slug },
    include: { seo: true, category: true, asset: true }
  });
  
  if (!blog) return notFound();
  
  return (
    <article>
      <img src={blog.asset.publicUrl} alt={blog.title} />
      <h1>{blog.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: blog.html }} />
    </article>
  );
}
```

2. Verify blog URL in `publish-worker` before marking PUBLISHED

---

## 10. CODE QUALITY & ARCHITECTURE ISSUES (🟠 to 🔵)

### 🟠 ARCH-001: Input Validation Relies on Type Casts
**Severity:** HIGH  
**Files:** Multiple API routes

**Problem:** Uses `as never` casts instead of runtime validation.

**Fix - Use Zod:**
```typescript
import { z } from "zod";

const createTopicSchema = z.object({
  title: z.string().min(5).max(200),
  keywords: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  archived: z.boolean().default(false)
});

// app/api/topics-pool/route.ts:
export async function POST(req: Request) {
  const data = await req.json();
  
  try {
    const validated = createTopicSchema.parse(data);
    await prisma.manualTopic.create({ data: validated });
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.errors }, { status: 400 });
    }
    throw error;
  }
}
```

---

### 🟡 ARCH-002: `any` Types in Components
**Severity:** MEDIUM  
**Files:**
- `components/ui/DataTable.tsx`
- `components/ui/button.tsx`
- `app/dashboard/assets/page.tsx`

**Fix:**
```typescript
// ❌ Before
function DataTable({ data }: { data: any[] }) {
  return data.map((row) => <tr>{row.name}</tr>);
}

// ✅ After
interface BlogRow {
  id: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "FAILED";
}

function DataTable({ data }: { data: BlogRow[] }) {
  return data.map((row) => <tr>{row.title}</tr>);
}
```

---

### 🟡 ARCH-003: Inline LLM Prompts
**Severity:** MEDIUM  
**Problem:** Prompts are template literals in worker code. Hard to version, test, review.

**Fix:**
1. Create `workers/prompts/` directory
2. Move each prompt to a file:
   ```
   workers/prompts/planning.ts
   workers/prompts/outline.ts
   workers/prompts/writing.ts
   workers/prompts/quality.ts
   ```

3. Load at startup:
   ```typescript
   // workers/shared/prompts.ts
   export const prompts = {
     planning: loadPrompt("planning.ts"),
     outline: loadPrompt("outline.ts"),
     // ...
   };
   
   // workers/planning-worker/index.ts
   const prompt = prompts.planning({ topic, audience });
   ```

4. Version prompts with database:
   ```prisma
   model PromptVersion {
     id String @id
     name String
     version Int
     content String
     model String
     temperature Float
     createdAt DateTime
   }
   ```

---

### 🟡 ARCH-004: Writing Worker Has Excessive Responsibility
**Severity:** MEDIUM  
**Files:** `workers/writing-worker/index.ts` (~800+ lines)

**Problem:** Drafting, self-checking, repair, citation materialization, gating, persistence, SEO creation in one file.

**Fix - Split into modules:**
```
workers/writing-worker/
  ├── index.ts           (orchestration)
  ├── draft.ts           (LLM call + markdown generation)
  ├── self-check.ts      (heuristic quality gates)
  ├── repair.ts          (retry logic for failed gates)
  ├── citations.ts       (extract & materialize)
  ├── persist.ts         (save Blog + BlogSEO)
  └── queue.ts           (dispatch to next stage)
```

Each module has single responsibility, easier to test and debug.

---

### 🟡 ARCH-005: Error Taxonomy Not Preserved
**Severity:** MEDIUM  
**Problem:** Generic 500/503 errors. Original causes lost (Vertex 429, validation failure, etc.).

**Fix:**
```typescript
// workers/shared/errors.ts
export class WorkerError extends Error {
  constructor(
    public code: string, // "EVIDENCE_VALIDATION", "VERTEX_QUOTA", etc.
    message: string,
    public retriable: boolean = false
  ) {
    super(message);
  }
}

// In workers
throw new WorkerError("OUTLINE_VALIDATION_FAILED", "Claims failed validation", false);

// In API error handler
try {
  await worker();
} catch (error) {
  if (error instanceof WorkerError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.retriable ? 503 : 400 }
    );
  }
}
```

---

### 🟡 ARCH-006: Narrow Test Coverage
**Severity:** MEDIUM  
**Problem:** Only one test file (`evidence-pipeline.test.ts`). No API, worker, or browser tests.

**Fix - Add test suites:**
```bash
# Unit tests
npm run test:unit

# API integration tests
npm run test:api

# Worker integration tests
npm run test:workers

# End-to-end tests
npm run test:e2e

# Browser accessibility tests
npm run test:a11y
```

**Setup:**
```bash
npm install -D vitest @testing-library/react @testing-library/node jest
```

---

### 🔵 ARCH-007: Generated Credentials Pollute Workspace
**Severity:** LOW  
**Problem:** `redsxp-client-*.json` generated but untracked.

**Fix:**
```bash
# Add to .gitignore
echo "redsxp-client-*.json" >> .gitignore
echo "secrets-*.json" >> .gitignore

# Add cleanup to package.json scripts
"clean": "rm -f redsxp-client-*.json secrets-*.json"

# Run after auth setup
npm run clean
```

---

## 11. REMEDIATION PRIORITY ORDER

```
PHASE 1: CRITICAL SECURITY & BLOCKING (Do immediately)
├─ SEC-001: Add authentication/authorization to all APIs
├─ SEC-002: Rotate/revoke exposed credentials
├─ SEC-003: Remove .env from Docker build
├─ PIPE-001: Run end-to-end pipeline test
├─ PIPE-002: Fix claim field shape mismatch
└─ AI-001: Replace token containment with semantic matching

PHASE 2: CORRECTNESS & RELIABILITY (Next week)
├─ PIPE-003: Persist evidence validation
├─ PIPE-004-008: Fix evidence handling & fallbacks
├─ OPS-001: Fix production build
├─ OPS-002: Clean up lint errors
├─ ARCH-001: Add input validation with Zod
└─ SEC-004 & SEC-005: Add CSRF + rate limiting

PHASE 3: QUALITY & OBSERVABILITY (2 weeks)
├─ AI-002 to AI-006: Improve claim/citation logic
├─ OPS-003 to OPS-007: Improve reliability & monitoring
├─ Dashboard & error taxonomy improvements
└─ Add API/worker/browser test suites

PHASE 4: UX & SEO (3-4 weeks)
├─ UX-001-007: Bulk import, accessibility fixes
├─ SEO-001-005: Sitemap, metadata, public routes
└─ Documentation & operational runbook
```

---

## 12. SUCCESS CRITERIA CHECKLIST

- [ ] Fresh end-to-end pipeline run (Research → Quality) completes successfully
- [ ] All API endpoints require authentication
- [ ] Cloud credentials rotated and removed from workspace
- [ ] Lint passes clean (`npm run lint`)
- [ ] Production build succeeds (`npm run build`)
- [ ] Evidence validation persisted and contracts unified
- [ ] Claim-to-evidence entailment working (not token containment)
- [ ] Dashboard queries have explicit limits
- [ ] Worker errors categorized and preserved to UI
- [ ] SEO infrastructure (sitemap, robots, schemas) in place
- [ ] Accessibility: modals use dialog semantics, focus management, alt text
- [ ] Test suite covers API, workers, and critical flows (70%+ coverage)
- [ ] Operational runbook: troubleshooting, quota exhaustion, failure recovery

---

## 13. QUICK START: WHERE TO FIX EACH ISSUE

| Issue | File(s) | Lines Approx | Complexity |
|-------|---------|------------|-----------|
| SEC-001 Auth | All `app/api/*/route.ts` | N/A | Medium |
| SEC-002 Creds | `.env`, `.dockerignore` | N/A | Low |
| SEC-003 Docker | `docker/Dockerfile.worker` | 5-10 | Low |
| PIPE-001 E2E | Run commands | - | Low (ops) |
| PIPE-002 Claims | `workers/outline-worker/index.ts` | 50-80 | Low |
| PIPE-003 Persist | `prisma/schema.prisma`, outline-worker | 30-50 | Medium |
| AI-001 Entailment | `workers/shared/evidence-validator.ts` | 100+ | High |
| OPS-002 Lint | Various | 15 issues | Low |
| ARCH-001 Validation | All API routes | N/A | Medium |
| SEO-001 Sitemap | Create `app/sitemap.ts`, `app/robots.ts` | 20-30 | Low |

---

## 14. PROJECT FILE STRUCTURE

```
auto-blog/
├── app/
│   ├── api/               # API routes (needs auth!)
│   │   ├── dashboard/
│   │   ├── research/
│   │   ├── workers/
│   │   ├── settings/
│   │   ├── blogs/
│   │   └── topics-pool/
│   ├── dashboard/         # Main UI
│   │   ├── page.tsx       # Dashboard home
│   │   ├── blogs/         # Blog manager
│   │   ├── trends/        # Trend management
│   │   ├── topics/        # Editorial topics pool
│   │   ├── quality/       # QA reports
│   │   ├── workers/       # Queue inspector
│   │   ├── settings/      # Configuration
│   │   ├── assets/        # Image gallery
│   │   ├── logs/          # Worker logs
│   │   └── observability/ # Monitoring
│   ├── layout.tsx         # Global layout
│   ├── page.tsx           # Home (redirects to dashboard)
│   └── globals.css        # Styling
│
├── workers/               # 7-stage pipeline
│   ├── research-worker/   # Stage 1: Fetch trends
│   │   ├── index.ts
│   │   ├── pipeline/      # Normalize, dedup, score, promote
│   │   └── trigger-once.ts
│   ├── planning-worker/   # Stage 2: Content strategy
│   ├── outline-worker/    # Stage 3: Structure
│   ├── writing-worker/    # Stage 4: Full article
│   ├── image-worker/      # Stage 5: Hero image
│   ├── quality-worker/    # Stage 6: QA validation
│   ├── publish-worker/    # Stage 7: Deploy
│   ├── vertex-gateway/    # Vertex AI rate limiter
│   ├── shared/            # Shared utilities
│   │   ├── queues.ts      # BullMQ queue setup
│   │   ├── vertex.ts      # Vertex API client
│   │   ├── evidence-validator.ts
│   │   ├── rate-limit.ts
│   │   ├── logger.ts
│   │   └── ...
│   └── start.ts           # Start all workers
│
├── lib/                   # Utilities
│   ├── db.ts              # Prisma client
│   ├── queues.ts          # Queue type definitions
│   ├── seo.ts             # SEO utilities
│   └── utils.ts
│
├── components/            # React components
│   ├── ui/                # shadcn/ui components (has `any` types!)
│   ├── shared/            # Custom components
│   └── ...
│
├── prisma/                # Database
│   ├── schema.prisma      # Data model (11 tables)
│   └── migrations/        # Migration history
│
├── docker/                # Container setup
│   ├── Dockerfile.worker  # Worker image (has secret leak risk!)
│   └── searxng/           # SearXNG service
│
├── docs/                  # Documentation
│   ├── MICRO_FLOWS.md     # Stage-by-stage details
│   ├── PIPELINE-FLOWS-REVIEW.md
│   ├── topic-sourcing-fix-plan.md
│   └── ...
│
├── docker-compose.yml     # Local dev environment
├── .env                   # Secrets (EXPOSED!)
├── .gitignore
├── package.json
├── tsconfig.json
├── eslint.config.mjs      # Lint config (15 errors currently)
├── next.config.ts
├── tailwind.config.ts
├── prisma.config.ts
│
├── README.md              # Architecture overview
└── PROJECT_ISSUES.md      # This audit (45 issues)
```

---

## 15. RUNNING THE PROJECT

```bash
# Setup
npm install
npx prisma migrate dev

# Development (3 terminals needed)

# Terminal 1: Next.js dashboard
npm run dev

# Terminal 2: All workers
npm run worker:dev

# Terminal 3: Manual commands as needed
npm run worker:research:once
npm run worker:planning
npm run worker:outline
npm run worker:writing
npm run worker:image
npm run worker:quality
npm run worker:publish

# Testing
npm run lint
npm run build
npm run test:evidence

# Production build
npm run build
npm run start
```

---

## 16. FINAL CHECKLIST: PRE-PRODUCTION

- [ ] All 🔴 issues resolved
- [ ] All 🟠 issues resolved or deferred
- [ ] Authentication working + tested
- [ ] Credentials rotated
- [ ] E2E pipeline test passed
- [ ] Build + lint clean
- [ ] Tests passing (70%+ coverage)
- [ ] Security audit signed off
- [ ] Load tested at expected scale
- [ ] Monitoring/alerting configured
- [ ] Runbook documented
- [ ] Stakeholders sign-off

**Status: 🔴 NOT READY FOR PRODUCTION**  
**Estimated effort to fix Phase 1: 3-5 days**  
**Estimated effort to fix all issues: 3-4 weeks**

---

**Generated:** 2026-09-18  
**Scope:** Complete auto-blog project assessment  
**Next step:** Start Phase 1 (security + blocking issues)