# Quality & SEO Audit Hub — UI/UX Enhancement Plan

`/dashboard/quality`

## 1. Reality check first

Before redesigning anything, three things on the current page are worth calling out because they change what "enhance" should mean here:

1. **"Auto-fix all with Gemini" and "Auto-fix" are fake.** They call `alert(...)`. There is no Gemini auto-fix worker anywhere in `workers/`. The real recovery path, per `workers/quality-worker/index.ts`, is: score `< 90` → requeue the *same outline* to `writing-worker` for a full regeneration (capped at 4 attempts via `writingAttemptCount < 4`) → if still failing after 4, status becomes `FAILED` permanently. There is no per-check "fix," no Gemini call, no manual patch. Shipping a prettier button on top of a fake action is a net negative — it makes the tool feel more trustworthy while doing less. This has to be resolved as part of the plan, not styled around.
2. **"Override & publish" has no backend.** Same problem — `alert()` only. No `/api/quality/*` routes exist at all today.
3. **The page already receives data it never renders.** `/api/dashboard` returns `quality.reports` — *every* scored blog (not just the ~10 that are blocked), each with the full 10-check breakdown, `metaTitle`/`metaDescription`/`keywords`/`schema`, and a `workflow.attempts` timeline naming every worker that touched it, with status/error/timestamps per attempt. `app/dashboard/quality/page.tsx` destructures `quality` into local state but only ever reads `blocked`, `distribution`, `checkRates`, `avgQuality`, `checkedCount`, `failedCount`. `reports` is fetched and thrown away. Separately, `components/shared/BlogDetailModal.tsx` *already* has "SEO & Meta," "Quality QA," and "Worker History" tabs that do almost exactly what's being asked for ("every SEO detail," "worker flow") — for one article at a time, reachable only from the Blogs page. The Quality page has no link into it.

Net implication: most of "show every SEO detail" and "show worker flow" is **wiring and reuse**, not new UI invention. The genuinely new work is (a) an aggregate flow view specific to the quality gate's branching logic, and (b) deciding what to do about the two fake buttons.

## 2. What "every SEO detail" and "worker flow" concretely mean here

Given the data model (`prisma/schema` → `BlogSEO`, `QualityReport`, `WorkflowRun`/`WorkerAttempt`), "every SEO detail" per article is:

- Meta title / meta description, with length gauges (Google truncates ~60 / ~160 chars — currently not validated anywhere)
- Target keywords + whether each one actually appears in the rendered content (the scorer already computes this — `keywords.some(...)` — it's just not surfaced)
- JSON-LD schema — currently dumped as a raw `JSON.stringify` blob in the modal; not validated, not previewed
- All 10 quality-worker checks with their `notes[]` (structure, completeness, readability, content quality, keyword optimization, technical SEO, formatting/UX, media quality, AI/fact quality, publishing readiness) — today only the failing 3 are shown, only for blocked articles, only as short text chips

"Worker flow," concretely, is the `WorkflowRun.attempts` chain: `research → planning → outline → writing → image → quality → publish`, with the quality-worker able to branch back to `writing` (regeneration loop, max 4x) instead of moving forward. The dashboard home page (`app/dashboard/page.tsx`, "Real-time worker pipeline") already renders this exact 7-stage strip with live counts, animated connector arrows (`animate-dkflow`), and per-stage progress bars — it's a proven, existing visual pattern. The Quality page should reuse it, not invent a new diagram language, but it needs to show the *branch* (quality ↔ writing loop, quality → FAILED after 4 attempts) that the generic strip doesn't.

## 3. Section-by-section plan

### 3.1 Header
Keep the gate-threshold subhead. Add a live "regeneration loop" count (blogs currently mid-retry, i.e. `status === PENDING_REVIEW` with a workflow attempt count `1–3`) next to "blocked" — right now "blocked" conflates "will never auto-recover" (4/4 attempts used, `FAILED`) with "still auto-retrying" (attempt 1–3, `PENDING_REVIEW`), and the UI treats them identically. That distinction is exactly what an "enhanced" quality page should make legible, since it changes what action a human should take (wait vs. intervene).

### 3.2 Score distribution + stats (keep, refine)
The histogram and 4 stat cards are structurally fine. Refinements:
- Replace the fixed-pixel-height CSS bars with a real chart (Chart.js, already used elsewhere in this stack) so bar height is computed client-side and doesn't silently break on window resize/zoom, and so hovering shows exact counts instead of relying on a `title` attribute tooltip.
- Add a 5th stat: **"Regenerating"** (attempt 1–3, mid-loop) so the four cards read as a clean funnel: Median → Checked → Regenerating → Failed.

### 3.3 Check pass-rate panel → Check matrix
Today: 10 skinny bars, one aggregate `%` each, no drill-down. Enhancement: make each row clickable to filter the failed-checks queue below to "articles failing *this* check" (the data for this is already computed server-side in `qualityParameters`; the click just needs to set a client-side filter). This turns a static readout into the actual diagnostic tool the page's name promises ("Audit Hub").

### 3.4 NEW — SEO detail explorer
A second, separate list from "failed checks" — because `quality.reports` includes *passing* articles too, and right now there is no way to inspect a passing article's SEO metadata on this page at all.
- Table (reuse `DataTable`, `Pagination`, `Skeleton` — all already built into this app) of every scored article: title, category, score, meta-title length badge (green/amber/red vs. 60-char budget), meta-description length badge (vs. 160), keyword-hit ratio (`n / total keywords found in content`), schema present/valid yes-no.
- Row click opens `BlogDetailModal` on the "SEO & Meta" tab directly (the modal already accepts a `blog` prop shaped exactly like these rows — no new modal needed, just pass `initialTab="seo"` or similar and reuse it).
- Inside that reused modal, upgrade the raw `JSON.stringify(schema)` block to a real JSON-LD preview (pretty-printed + a "copy" button + a basic shape check: has `@type`, `headline`, `datePublished`) and add a Google-SERP-style snippet preview (title/url/description mock) — this is the one genuinely new sub-component the plan needs.

### 3.5 NEW — Quality worker flow panel
Purpose-built branch diagram, visually consistent with the dashboard's existing pipeline strip:
`Writing → Quality Gate` with two exits: **Pass (≥90) → Publish**, **Fail → back to Writing (attempt n/4)**, and a terminal **Fail after 4/4 → Failed, needs manual override**. Each node shows a live count pulled from data already computed in `/api/dashboard` (`stageTotals`, `qualityQueue` counts) plus one new aggregate: average attempts-to-pass across recently-passed blogs (derivable from `WorkerAttempt` rows grouped by `blogId`, worker `quality-worker` — needs a small addition to the dashboard API, not a new endpoint). This is the piece that actually answers "how does the SEO worker flow" rather than just "how many workers exist," which is what `/dashboard/workers` already answers generically.

### 3.6 Failed-checks queue (rework, don't just restyle)
- Add the `Skeleton` and `Pagination` components (already built for Trends/Blogs/Assets this session) — this list has no pagination or loading state today and will misbehave once blocked counts grow.
- Each row becomes clickable → opens `BlogDetailModal` (Quality QA tab) instead of only showing 3 truncated reason chips inline.
- Resolve the fake-button problem (see §4) before shipping new visual treatment for them — a nicer-looking `alert()` is not an improvement.
- Add category + "failing check" filters (the latter wired to §3.3's click-to-filter).

## 4. The fake-button decision (blocking, needs your call)

Two options, both legitimate, but the plan can't finish without picking one:

- **A — Build it for real.** "Override & publish" is cheap: one `POST /api/blogs/:id/override-publish` route that sets `status: PUBLISHED` and logs who/why (needs an audit trail field — none exists on `Blog` today). "Auto-fix with Gemini" is not cheap: it doesn't exist as a concept in the current architecture at all; it would mean either (a) a genuinely new worker that takes the `notes[]` per failing check and asks Gemini to patch specific sections, or (b) relabeling the button to what the system actually does — "Regenerate via writing-worker" — which just calls the existing retry path on demand instead of waiting for the next scheduled run.
- **B — Remove/relabel now, build later.** Replace "Auto-fix" with an honest "Regenerate now" (real, calls existing retry logic, ships fast) and remove "Auto-fix all"/"Override & publish" until there's a real endpoint, so the page never lies about what it can do.

Recommendation: B for the initial ship (fast, honest, unblocks everything else in this plan), A's "Override & publish" as a fast-follow (small, well-scoped), A's real Gemini auto-fix as a separate, larger proposal if there's actual appetite for it — it's a new worker, not a UI task.

## 5. New components needed (small list — most of this is reuse)

- `PipelineFlowBranch` — the quality↔writing loop diagram from §3.5. Everything else (`DataTable`, `Pagination`, `Skeleton`, `Select`, `BlogDetailModal`) already exists in `components/ui` / `components/shared` and was fixed/added earlier this session.
- `SeoSnippetPreview` — SERP-style title/url/description preview, used inside `BlogDetailModal`'s SEO tab.
- Minor: a JSON-LD pretty-printer + shape-check helper (function, not a component) for the schema block.

## 6. Backend additions required

- Small addition to `/api/dashboard`: average attempts-to-pass per blog (group `WorkerAttempt` by `blogId`/`worker=quality-worker`) — needed for §3.5.
- Only if Option A is chosen: `POST /api/blogs/:id/override-publish`; a new `AuditLog`-style field/table for who/why on manual overrides.
- No backend change needed for §3.1–3.4, §3.6 — all data already exists in the current `/api/dashboard` payload, just unused.

## 7. Suggested phasing

1. **Phase 1 (no backend changes):** wire `quality.reports` into a real SEO explorer table, add pagination/skeleton to the blocked queue, make rows open the existing `BlogDetailModal`, split "blocked" vs. "regenerating," fix/relabel the two fake buttons (Option B).
2. **Phase 2:** build the quality↔writing flow diagram (§3.5) and the SERP/JSON-LD preview upgrades inside the modal (§3.4).
3. **Phase 3 (only if wanted):** real "Override & publish" endpoint + audit trail; decide separately whether a real Gemini auto-fix worker is worth building.

## 8. Open questions for you

- Do you actually want a real Gemini "auto-fix per check" worker, or was that button aspirational copy that should just be relabeled to match the real regenerate-via-writing-worker behavior?
- Is manual "Override & publish" (bypassing the ≥90 gate) something you want end users to be able to do at all, or should failed-after-4-attempts articles require a code-level intervention only?
