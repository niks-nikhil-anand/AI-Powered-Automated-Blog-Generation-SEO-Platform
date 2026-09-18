# 🔎 Auto-Blog Project Issues Audit

> **Audit date:** 2026-09-01  
> **Scope:** Entire repository: Next.js application, dashboard UI, API routes, Prisma schema/migrations, BullMQ workers, Vertex gateway, research sources, Docker configuration, tests, and project documentation.  
> **Method:** Static source review, repository searches, TypeScript/test execution, lint execution, production-build attempt, and inspection of the configured local runtime.  
> **Rule:** This file documents findings only. No application code was changed for this audit.

## Status and severity legend

| Icon | Meaning |
|---|---|
| 🔴 **Critical / Open** | Security, data-integrity, or release-blocking problem |
| 🟠 **High / Open** | Major functional or operational risk |
| 🟡 **Medium / Open** | Meaningful weakness, UX problem, or technical debt |
| 🔵 **Low / Open** | Smaller defect or maintainability concern |
| 🟣 **Observed / Partial** | Works in some paths, but behavior is incomplete or unsafe in others |
| ✅ **Verified** | Positive control observed during the audit; not an issue |

## Executive summary

The project has a substantial pipeline and observability foundation, but it is not production-ready. The most urgent concerns are the absence of authentication/authorization on operational APIs, exposed cloud credentials in the local environment, incomplete evidence-contract integration between outline and writing, weak semantic claim matching, and an unverified end-to-end pipeline that has not reached Quality Worker. The frontend also fails lint and the production build could not complete in the sandbox.

| Area | Open findings |
|---|---:|
| 🔐 Security and privacy | 5 |
| 🧩 Pipeline correctness and data integrity | 8 |
| 🤖 LLM/evidence/citation quality | 6 |
| ⚙️ Reliability and operations | 7 |
| 🖥️ UX and accessibility | 7 |
| 🔍 SEO and content | 5 |
| 🛠️ Code quality and architecture | 7 |

## 🔐 Security and privacy

### 🔴 SEC-001 — Operational APIs have no authentication or authorization

**Status:** 🔴 Open  
**Evidence:** Every inspected route directly performs reads or mutations without checking a session, user, role, API key, or signed request. Examples: [`app/api/settings/route.ts`](app/api/settings/route.ts), [`app/api/research/run/route.ts`](app/api/research/run/route.ts), [`app/api/workers/actions/route.ts`](app/api/workers/actions/route.ts), [`app/api/blogs/[id]/override-publish/route.ts`](app/api/blogs/[id]/override-publish/route.ts), and [`app/api/topics-pool/route.ts`](app/api/topics-pool/route.ts).

**Impact:** Anyone who can reach the application can change model settings, retry counts, schedules, topic data, worker state, publish articles, trigger research, or override publishing.

### 🔴 SEC-002 — Cloud service-account private key is present in the local project environment

**Status:** 🔴 Open  
**Evidence:** `.env` contains `GCP_CREDENTIALS_JSON` with a private key and service-account identity. The generated `redsxp-client-80457b588e24.json` is also present in the workspace. Although `.env` is ignored by Git, local presence and accidental copying remain serious exposure risks.

**Impact:** Credential compromise could allow unauthorized Vertex/API usage and cloud-resource access. The key should be revoked/rotated and replaced with secret-manager or workload identity credentials.

### 🔴 SEC-003 — Worker image build pattern can copy environment files into images

**Status:** 🔴 Open  
**Evidence:** [`docker/Dockerfile.worker`](docker/Dockerfile.worker) uses `COPY . .` followed by `COPY .env* ./`. Docker Compose also supplies `.env` through `env_file`.

**Impact:** A future Docker ignore change, build-context mistake, or CI configuration could bake secrets into an image layer, where deleting the file later would not remove it from image history.

### 🟠 SEC-004 — Default database credentials are hard-coded in Compose

**Status:** 🟠 Open  
**Evidence:** [`docker-compose.yml`](docker-compose.yml) defines `POSTGRES_PASSWORD: postgrespassword` and embeds the same password in service `DATABASE_URL` values.

**Impact:** The configuration is unsafe outside a strictly isolated developer machine and encourages promotion of development credentials into shared environments.

### 🟠 SEC-005 — Mutating endpoints lack CSRF and abuse protection

**Status:** 🟠 Open  
**Evidence:** POST/PATCH/DELETE routes accept requests without CSRF tokens, origin checks, rate limits, idempotency controls at the HTTP layer, or authentication. Expensive actions include research runs, regeneration, quality retries, and worker actions.

**Impact:** If browser credentials are added later without adding CSRF protection, cross-site actions become possible. Today, unauthenticated access already permits abuse and cost amplification.

## 🧩 Pipeline correctness and data integrity

### 🔴 PIPE-001 — A fresh real end-to-end run has not been demonstrated

**Status:** 🔴 Open / Release blocker  
**Evidence:** The live Research Worker run fetched 121 signals and found four promotable candidates, but dispatched zero because all were duplicates. The prior downstream run was stale and did not reach Quality Worker. Prior writing attempts scored 70/100 self-check and 65/100 heuristic, with a later Vertex 429.

**Impact:** The evidence-first fix cannot be declared resolved until a newly researched topic passes Research → Planning → Outline → Writing → Image → Quality.

### 🔴 PIPE-002 — Outline and writing workers use different claim field shapes

**Status:** 🔴 Open  
**Evidence:** [`workers/outline-worker/types.ts`](workers/outline-worker/types.ts) defines claims with `text`; [`workers/shared/evidence-validator.ts`](workers/shared/evidence-validator.ts) expects `claim`. Outline validation currently normalizes this shape locally, but [`workers/writing-worker/index.ts`](workers/writing-worker/index.ts) passes persisted outline claims directly to `validatePlannedClaims`.

**Impact:** An outline that passes the outline-stage normalization can be rejected by Writing because its claims still have `text` rather than `claim`. This blocks the normal pipeline at the stage that consumes the persisted artifact.

### 🔴 PIPE-003 — Evidence validation is not persisted as part of the outline artifact

**Status:** 🔴 Open  
**Evidence:** [`workers/outline-worker/index.ts`](workers/outline-worker/index.ts) creates an in-memory `validatedOutline`, but [`ContentOutline`](prisma/schema.prisma) persists only title, metadata, sections, and FAQs.

**Impact:** Later stages cannot inspect the exact validation result, diagnostics, or validated claim set. Runtime state must be recomputed, making auditability and replay/debugging harder.

### 🟠 PIPE-004 — Legacy evidence fallback bypasses the strongest evidence contract

**Status:** 🟠 Open  
**Evidence:** [`workers/shared/evidence.ts`](workers/shared/evidence.ts) returns an empty canonical evidence list for malformed/legacy `evidenceArticles`; writing then retains a legacy `evidenceSummary` path when no full-text sources exist.

**Impact:** Older or partially ingested trends can still proceed with summary-level grounding, even though claim-level source/evidence validation is unavailable. This creates inconsistent trust guarantees across articles.

### 🟠 PIPE-005 — Failed evidence extraction can leave a write-eligible trend without usable evidence

**Status:** 🟠 Open  
**Evidence:** Research evidence ingestion is fail-soft and the runtime observed an openKylin trend with no usable extracted evidence. The pipeline can continue to later stages through legacy summary behavior.

**Impact:** A topic can appear research-qualified by score while lacking source text sufficient to support article claims.

### 🟠 PIPE-006 — Manual-topic research queue endpoint does not verify the topic before enqueueing

**Status:** 🟠 Open  
**Evidence:** [`app/api/topics-pool/[id]/research/route.ts`](app/api/topics-pool/[id]/research/route.ts) enqueues `manualTopicId` directly and does not first verify that the record exists, is eligible, or is not already archived/used.

**Impact:** Invalid or stale requests become queue jobs and errors are deferred to a worker. The API response can claim success for an unusable topic.

### 🟡 PIPE-007 — Topics pool has no uniqueness constraint or duplicate prevention at the API layer

**Status:** 🟡 Open  
**Evidence:** [`prisma/schema.prisma`](prisma/schema.prisma) has no unique key for `ManualTopic.title`; [`app/api/topics-pool/route.ts`](app/api/topics-pool/route.ts) always calls `create`.

**Impact:** Repeated imports or UI submissions create duplicate editorial work and make pool counts unreliable.

### 🟡 PIPE-008 — The legacy `Job` model is dead storage beside BullMQ audit tables

**Status:** 🟡 Open  
**Evidence:** `Job` exists in [`prisma/schema.prisma`](prisma/schema.prisma), while the dashboard and workers use BullMQ plus `WorkflowRun`/`WorkerAttempt`; the existing pipeline review also documents that no code writes the legacy table.

**Impact:** Two job concepts increase confusion, migration burden, and the risk that a future feature reads an always-empty source of truth.

## 🤖 LLM, evidence, and citation quality

### 🔴 AI-001 — Semantic evidence matching is token containment, not reliable semantic entailment

**Status:** 🔴 Open  
**Evidence:** [`workers/shared/evidence-validator.ts`](workers/shared/evidence-validator.ts) implements `claimMatchesFact` by requiring normalized claim tokens to occur in a fact string.

**Impact:** It can reject valid paraphrases, accept misleading claims that reuse source vocabulary, and cannot determine whether evidence actually entails a capability, benefit, comparison, or causal statement.

### 🟠 AI-002 — Foreign URLs are logged but do not fail the citation gate

**Status:** 🟠 Open  
**Evidence:** [`workers/writing-worker/index.ts`](workers/writing-worker/index.ts) logs `foreignLinks` as a soft signal after citation materialization.

**Impact:** An article can retain unrelated external links while still passing the citation-related writing gate. This conflicts with the stronger requirement that citation coverage resolve to the supporting source.

### 🟠 AI-003 — Citation checking can over-require unused research sources

**Status:** 🟠 Open  
**Evidence:** [`workers/writing-worker/citations.ts`](workers/writing-worker/citations.ts) documents and implements `groundedCitationCheck` as requiring every supplied evidence source to be cited.

**Impact:** Articles are penalized for not citing sources that support no article claim. Coverage should be claim-driven: every evidence-requiring claim needs a supporting citation, while unused research sources need not appear.

### 🟠 AI-004 — Article claim extraction is sentence/marker based and incomplete

**Status:** 🟠 Open  
**Evidence:** `extractArticleClaimMappings` in [`workers/writing-worker/citations.ts`](workers/writing-worker/citations.ts) splits on sentence punctuation and only records sentences containing a source marker.

**Impact:** Claims spanning sentences, bullets, tables, code comments, headings, or citations placed before the claim can be omitted from the audit. Reported coverage can therefore overstate actual support.

### 🟡 AI-005 — Writing and Quality use different factual-check paths

**Status:** 🟡 Open  
**Evidence:** Writing uses self-checks and canonical source evidence; Quality has both legacy summary fact-checking and full fact-checking in [`workers/quality-worker/factcheck.ts`](workers/quality-worker/factcheck.ts), with fail-soft behavior when calls fail.

**Impact:** The same article can receive materially different evidence judgments depending on whether full evidence is present and whether the LLM check is available.

### 🟡 AI-006 — Heuristic writing score is easy to game and mixes format with quality

**Status:** 🟡 Open  
**Evidence:** [`workers/writing-worker/index.ts`](workers/writing-worker/index.ts) scores structural signals such as word count, headings, FAQ, tables/code, and CTA patterns.

**Impact:** Verbose or template-filled content can score well without being accurate, useful, original, or well-supported; conversely, concise high-quality content can fail the fixed format score.

## ⚙️ Reliability and operations

### 🟠 OPS-001 — Production build is not currently verifiable in the audit environment

**Status:** 🟠 Open  
**Evidence:** `npm run build` failed with a Turbopack panic while binding a process port (`Operation not permitted`). This may be sandbox-specific, but there is no successful build artifact from this audit.

**Impact:** Release readiness, route compilation, and production bundling remain unconfirmed.

### 🟠 OPS-002 — Lint fails with 15 errors and 7 warnings

**Status:** 🟠 Open  
**Evidence:** `npm run lint` reported explicit `any` errors in assets, `DataTable`, button variants, and a research source; React hook errors in observability and theme code; and an image alt warning.

**Impact:** The repository has no clean static-quality baseline and CI cannot treat lint as a release gate until the violations are triaged.

### 🟠 OPS-003 — Vertex quota failures can consume expensive stage attempts

**Status:** 🟠 Open / Partially mitigated  
**Evidence:** A real prior writing attempt failed with Vertex `429 RESOURCE_EXHAUSTED`. The project has Redis pacing, gateway retries, a breaker, and bounded BullMQ backoff, but the observed writing attempt still spent stage capacity before failing.

**Impact:** Quota exhaustion delays jobs, increases cost, and can obscure evidence-quality failures. Infrastructure failures must remain separately classified and observable.

### 🟡 OPS-004 — Rate limiter fails open on Redis failures

**Status:** 🟡 Open by design  
**Evidence:** [`workers/shared/rate-limit.ts`](workers/shared/rate-limit.ts) explicitly allows Vertex calls when Redis is unavailable.

**Impact:** A Redis outage can remove quota coordination across containers and trigger a burst of 429s. This trades pipeline availability for cloud-cost and quota safety.

### 🟡 OPS-005 — Research source health is degraded in the configured environment

**Status:** 🟡 Open  
**Evidence:** The live run observed SearXNG fetch failures, Anthropic News HTTP 404, and GitHub Trending 401. The source modules fail soft and return zero signals.

**Impact:** Topic diversity, freshness, and evidence quality silently degrade while the run can still look successful.

### 🟡 OPS-006 — Dashboard queries can grow expensive as audit data accumulates

**Status:** 🟡 Open  
**Evidence:** [`app/api/dashboard/route.ts`](app/api/dashboard/route.ts) loads recent AI usage without an explicit limit and loads workflow runs with all nested attempts. Logs are bounded separately, but worker/audit history grows indefinitely except for log pruning.

**Impact:** Dashboard latency and database memory/transfer cost will increase with usage.

### 🟡 OPS-007 — Background timers and polling are widespread

**Status:** 🟡 Open  
**Evidence:** Dashboard pages repeatedly use `setInterval` for 3–15 second polling; [`workers/shared/log-transport.ts`](workers/shared/log-transport.ts) runs flush and prune timers.

**Impact:** Multiple open dashboard tabs multiply API/database load, and polling provides no backoff or visibility-aware pause behavior.

## 🖥️ UX and accessibility

### 🟠 UX-001 — Topics pool has no bulk import UI despite the intended use case

**Status:** 🟠 Open  
**Evidence:** [`app/dashboard/topics/pool/page.tsx`](app/dashboard/topics/pool/page.tsx) supports one topic at a time; the bulk route only supports archive/priority actions and does not import topic rows.

**Impact:** Curating a large editorial pool requires repetitive manual entry and creates more opportunity for inconsistent metadata.

### 🟡 UX-002 — Topics pool error handling is inconsistent and often silent

**Status:** 🟡 Open  
**Evidence:** `update()` in [`app/dashboard/topics/pool/page.tsx`](app/dashboard/topics/pool/page.tsx) ignores the response body/status; research only displays a generic message and does not refresh topic state.

**Impact:** Users cannot tell whether an update failed, whether a topic was accepted, or what action is currently in progress.

### 🟡 UX-003 — Modal components do not consistently implement dialog semantics/focus management

**Status:** 🟡 Open  
**Evidence:** Several custom modal wrappers use ordinary `div` containers and click-to-close behavior. [`components/shared/AssetDetailModal.tsx`](components/shared/AssetDetailModal.tsx) has no visible `role="dialog"`, focus trap, or Escape-key handling in the inspected section.

**Impact:** Keyboard and screen-reader users can lose context, tab behind dialogs, or fail to discover how to close them.

### 🟡 UX-004 — Missing image alternative text remains in the asset modal

**Status:** 🟡 Open  
**Evidence:** ESLint reported `jsx-a11y/alt-text` at [`components/shared/AssetDetailModal.tsx`](components/shared/AssetDetailModal.tsx).

**Impact:** The asset preview is not reliably understandable to screen-reader users.

### 🟡 UX-005 — React effect patterns trigger lint errors and unnecessary render work

**Status:** 🟡 Open  
**Evidence:** ESLint reported `react-hooks/set-state-in-effect` in [`app/dashboard/observability/page.tsx`](app/dashboard/observability/page.tsx) and [`components/shared/ThemeProvider.tsx`](components/shared/ThemeProvider.tsx).

**Impact:** Initial state synchronization can cause cascading renders and complicate hydration behavior.

### 🟡 UX-006 — Tables and dense dashboard views need a documented responsive/accessibility baseline

**Status:** 🟡 Open  
**Evidence:** Topics pool renders a dense table with very small text and horizontal overflow; several pages use icon-only controls and custom styling. There is no automated accessibility test configuration.

**Impact:** Mobile users and users with low vision or motor impairments may struggle with navigation, target size, and information hierarchy.

### 🔵 UX-007 — Generic loading/error states lack recovery guidance

**Status:** 🔵 Open  
**Evidence:** Many pages collapse failures to short strings such as “Failed to load topics” or “Failed to fetch settings,” with no retry context, request identity, or operational explanation.

**Impact:** Operators cannot distinguish transient infrastructure failure from validation failure or permission failure.

## 🔍 SEO and content

### 🟠 SEO-001 — No sitemap, robots policy, or route-level canonical strategy is present

**Status:** 🟠 Open  
**Evidence:** The repository contains no `app/sitemap.ts`, `app/robots.ts`, or equivalent route. [`app/layout.tsx`](app/layout.tsx) only defines global title and description metadata.

**Impact:** Search crawlers receive no explicit crawl guidance, and generated/public content has no systematic canonical URL management.

### 🟠 SEO-002 — Global metadata is generic and not page-specific

**Status:** 🟠 Open  
**Evidence:** [`app/layout.tsx`](app/layout.tsx) defines one dashboard-oriented title/description for the whole application. Dashboard routes do not expose route-specific metadata.

**Impact:** Search previews and browser titles are weak or misleading, especially if public blog routes are added.

### 🟡 SEO-003 — Generated article SEO schema is incomplete for production publishing

**Status:** 🟡 Open  
**Evidence:** [`workers/writing-worker/index.ts`](workers/writing-worker/index.ts) creates a minimal `TechArticle` schema with headline, keywords, and author, but no canonical URL, image, dates, publisher/logo, or main entity URL.

**Impact:** Search engines receive limited article identity and eligibility context.

### 🟡 SEO-004 — Content quality gates encourage fixed template shape

**Status:** 🟡 Open  
**Evidence:** Writing and quality gates require fixed counts/headings such as at least eight H2s, FAQs, CTA, and hard-coded required section names.

**Impact:** Articles can become repetitive, bloated, or poorly matched to intent; useful topic-specific structures may be rejected.

### 🟡 SEO-005 — Content may publish without a verified public rendering path

**Status:** 🟡 Open  
**Evidence:** The repository contains dashboard/blog management views and publishing workers, but no clear public article route in the file inventory. Blog HTML is stored in the database.

**Impact:** The pipeline can mark content published without a confirmed crawlable page, metadata integration, or public URL lifecycle.

## 🛠️ Code quality and architecture

### 🟠 ARCH-001 — API input validation relies heavily on casts instead of schemas

**Status:** 🟠 Open  
**Evidence:** Routes use patterns such as `as never` in [`app/api/topics-pool/route.ts`](app/api/topics-pool/route.ts), [`app/api/topics-pool/[id]/route.ts`](app/api/topics-pool/[id]/route.ts), and bulk actions. Only selected numeric fields receive explicit validation.

**Impact:** Invalid enum values, oversized strings, unexpected object shapes, and future schema drift can reach Prisma or queue payloads.

### 🟡 ARCH-002 — `any` and generic row types weaken the UI type boundary

**Status:** 🟡 Open  
**Evidence:** ESLint reports `any` in [`components/ui/DataTable.tsx`](components/ui/DataTable.tsx), [`components/ui/button.tsx`](components/ui/button.tsx), and [`app/dashboard/assets/page.tsx`](app/dashboard/assets/page.tsx).

**Impact:** API/UI shape changes can compile while breaking renderers at runtime.

### 🟡 ARCH-003 — Inline LLM prompts drift from design documentation

**Status:** 🟡 Open  
**Evidence:** [`docs/PIPELINE-FLOWS-REVIEW.md`](docs/PIPELINE-FLOWS-REVIEW.md) notes that prompt specifications are not loaded by workers and that runtime prompts are inline template literals.

**Impact:** Prompt behavior is difficult to review, version, test, and keep synchronized across planning, outline, writing, and quality stages.

### 🟡 ARCH-004 — Writing worker has excessive responsibility and high maintenance risk

**Status:** 🟡 Open  
**Evidence:** [`workers/writing-worker/index.ts`](workers/writing-worker/index.ts) contains drafting, self-checking, multiple repair modes, citation materialization, gating, persistence, SEO record creation, and queue chaining in one large module.

**Impact:** Changes are difficult to isolate and test; failures in one concern can affect retries, data persistence, or queue progression.

### 🟡 ARCH-005 — Error taxonomy is not consistently preserved to the UI and audit trail

**Status:** 🟡 Open  
**Evidence:** Workers use typed/structured errors in places, but API routes generally return generic 500/503 messages and prior runtime failures surfaced as generic writing quality errors even when the underlying cause was Vertex 429.

**Impact:** Operators cannot reliably distinguish evidence failure, model quota failure, infrastructure failure, and application defects.

### 🟡 ARCH-006 — Test coverage is narrow and lacks integration/browser coverage

**Status:** 🟡 Open  
**Evidence:** The repository has one explicit `test:evidence` script and a single `tests/evidence-pipeline.test.ts`; no unit-test framework, API integration suite, worker integration suite, or browser accessibility test is configured in `package.json`.

**Impact:** Queue transitions, Prisma persistence, authorization, rendering, and real worker interactions are largely untested.

### 🔵 ARCH-007 — Generated credentials and runtime artifacts can pollute the workspace

**Status:** 🔵 Open  
**Evidence:** The workspace contains `redsxp-client-80457b588e24.json`, generated by the worker auth path, while the repository status shows it as untracked.

**Impact:** Developers can accidentally commit, upload, or share a runtime credential artifact; cleanup policy is unclear.

## ✅ Verified controls

These are not open issues, but are recorded to avoid misclassifying working controls:

- ✅ `npm run test:evidence` passed.
- ✅ `npx tsc --noEmit` passed during the audit.
- ✅ `git diff --check` passed.
- ✅ Worker image was rebuilt and the real Research, Planning, Outline, Writing, Quality, and Vertex containers were recreated on the same image.
- ✅ Vertex gateway has bounded retry/backoff, Redis-backed pacing, a circuit breaker, and concurrency `1` in the inspected configuration.
- ✅ Citation markers are materialized by code rather than trusting arbitrary LLM-pasted URLs.
- ✅ The prior unsupported outline was confirmed to be stale, not evidence that the rebuilt outline path had already passed bad claims.

## Recommended remediation order

1. 🔴 Rotate/revoke exposed cloud credentials and remove secret material from build contexts and workspace artifacts.
2. 🔴 Add authentication, authorization, CSRF protection, and rate limits to every operational API.
3. 🔴 Unify the claim contract across Planning, Outline, Writing, and Quality; persist validation diagnostics.
4. 🔴 Run a truly fresh isolated pipeline job and require it to reach Quality Worker before calling the evidence fix resolved.
5. 🟠 Replace token containment with a stronger claim-to-evidence entailment strategy and claim-driven citation coverage.
6. 🟠 Restore a clean build/lint baseline and add API/worker/browser integration tests.
7. 🟡 Bound dashboard queries, reduce polling, and improve operator-facing error taxonomy.
8. 🟡 Add public SEO infrastructure and accessibility validation before exposing generated content publicly.

## Audit conclusion

**Overall status: 🔴 NOT READY FOR PRODUCTION.** The project has useful foundations and several verified safeguards, but open security, pipeline-contract, runtime-validation, quality, and release-verification issues remain.
