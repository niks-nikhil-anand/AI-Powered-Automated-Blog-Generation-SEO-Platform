# Settings Page — Worker Schedule UI Plan

`/dashboard/settings`

## 1. Reality check first

Before designing clocks and timelines, the request needs to be checked against what actually runs in this codebase, because "show the times of the worker run" and "for each worker" don't map cleanly onto it:

Only **one** of the seven workers runs on a schedule. `research-worker` registers three BullMQ Job Schedulers at boot (`workers/research-worker/index.ts`, `RESEARCH_SLOTS`): `overnight` (env `RESEARCH_CRON_OVERNIGHT`, default `30 6 * * *`), `midday` (`RESEARCH_CRON_MIDDAY`, default `0 14 * * *`), and `US daytime` (`RESEARCH_CRON_US_DAYTIME`, default `30 23 * * *`), all in `env.TIMEZONE` (default `Asia/Kolkata`). A code comment points to a `SCHEDULING_PLAN.md` for why these three times were chosen — that file does not exist anywhere in the repo, so the rationale is currently undocumented.

`planning-worker`, `outline-worker`, `writing-worker`, `image-worker`, `quality-worker`, and `publish-worker` have **no schedule at all**. They are pure BullMQ queue consumers: each one wakes up the instant a job lands in its queue (put there by the previous stage finishing), processes it, and goes idle. There is no "9am writing-worker run" to show a clock for, because writing-worker doesn't run at 9am — it runs whenever research → planning → outline finishes producing something for it, which could be seconds or hours after the schedule fires. Building a 24-hour timeline for these six workers would mean inventing schedule data that isn't real.

Separately, the current Settings page itself is mostly decorative: the single "Cron Schedule Expression" text field is local `useState`, wired to nothing — it doesn't read from or write to the three real research schedules. "Daily blog generation limit" doesn't connect to `DAILY_BLOG_TARGET` (the env var actually used in `/api/dashboard`'s metrics). "Auto-publish on QA Pass" and "Slack / Email Alerts" are toggles with no backing logic — there is no Slack/email integration anywhere in this codebase to alert through. The "AI Model Per Pipeline Stage" dropdowns show `defaultValue`d selects that reset on reload; the actual model per stage is hardcoded in each worker's own `vertex.ts` via `VERTEX_MODEL`/`VERTEX_FLASH` env vars, not read from anything this page could write to. "Save configuration" and "Discard" both just call `alert()`.

The good news, and the part of this request that's genuinely buildable: BullMQ's `upsertJobScheduler(id, { pattern, tz }, ...)` is idempotent and safe to call at any time — including from a Next.js API route, not just from the worker process at boot. `researchQueue` is already imported into other API routes in this app (`app/api/research/run/route.ts`). So editing one of the three research time slots from the dashboard and having it take effect immediately, with no worker restart, is real and low-risk. That's the feature to build. A literal "24-hour schedule for every worker, editable from Settings" is not something that exists to edit — building it for real would mean inventing new schedulers for six reactive workers, which is a fundamentally different (and much larger) project than a Settings page redesign.

## 2. What this plan actually proposes

Given the above, "show the times of the worker run in 24 hrs, editable, with a real digital watch" becomes two honestly-different things:

- For **research-worker** (the one with real times): a 24-hour visual timeline with the three actual slots plotted on it, a live-ticking digital clock cluster for temporal context (current time, per timezone), and a real edit path — pick a new time, save, the BullMQ scheduler updates immediately.
- For the **other six workers** (no times to show): a "Worker Activity" panel showing what's actually true about them — current state (idle/active/queued/failed), last time they ran, and average duration — pulled from data `/api/dashboard` already computes (`queues`, `stageStatus`, `workflows`). No fake clock, because there's no fixed time to put on it.

## 3. Section-by-section redesign

### 3.1 Research Schedule (new, real)
Replaces the current single fake "Cron Schedule Expression" field.
- A 24-hour horizontal timeline (0:00–24:00) with three markers for overnight/midday/US-daytime, each showing its current time and a live countdown to next fire (`countdown()` — logic already exists in `RunPipelineModal.tsx`, just needs extracting).
- A digital clock cluster above it: current time in `Asia/Kolkata` (primary, since that's `env.TIMEZONE`) plus US Eastern/Pacific (since "US daytime" targets the US news cycle) — this is the exact `CLOCKS`/`timeIn()` logic already built and ticking in `RunPipelineModal.tsx`. Rather than duplicate it, extract it into a shared `components/shared/WorldClocks.tsx` used by both the modal and this page.
- Each slot becomes an editable card: label, a large digital-style `HH:MM` readout (not raw cron text — nobody should have to hand-write cron syntax to change "run at 6:30am" to "run at 7am"), a timezone tag, last-fired status, and an Edit control (hour/minute picker) with its own Save button per slot.
- Editing calls a new endpoint (see §4) that calls `upsertJobScheduler` directly — takes effect immediately, confirmed back to the UI with the newly computed next-fire time.

### 3.2 Worker Activity (new, real, replaces the implied "all workers have schedules" framing)
- One row per reactive worker (planning/outline/writing/image/quality/publish): live state dot (idle/active/queued/failed — same color language as `/dashboard/workers`), last-ran timestamp, and average duration, computed from `WorkerAttempt` rows already available.
- Explicitly labeled as event-driven ("runs when handed a job from the previous stage"), not "next run at HH:MM," so the UI doesn't claim something false.

### 3.3 AI Model Per Pipeline Stage
This section has no persistence layer to save to today. Two honest options, not a UI polish:
- **Mark read-only**, with a note ("configured via environment variables, not editable here") — fast, ships with everything else, doesn't lie.
- **Make it real**: add a small `AppSetting` key/value table (one new Prisma model, e.g. `AppSetting { key String @id, value Json }`), a settings-read helper each worker's `vertex.ts` checks before falling back to its env var, and a real `PATCH /api/settings/models` route. This is a legitimate feature, but it touches five worker files plus a migration — bigger than a Settings-page redesign and should be scoped separately if wanted.

### 3.4 General toggles (daily limit, auto-publish, alerts)
Same fork as 3.3, per toggle:
- **Daily limit**: could realistically wire to `DAILY_BLOG_TARGET` through the same `AppSetting` mechanism as 3.3, since that value is already read and displayed elsewhere (`/api/dashboard` metrics) — just not currently writable.
- **Auto-publish on QA pass**: this is arguably not a toggle at all — `quality-worker`'s `overallScore >= 90` gate already *always* auto-publishes on pass (`workers/quality-worker/index.ts`). There's no "off" state to build; the toggle as designed implies a choice that doesn't exist in the pipeline. Recommend removing it or reframing it as informational ("Auto-publish is always on above the quality gate — see the Quality page to change the threshold").
- **Slack/Email alerts**: no integration exists to turn on. Recommend removing until there's an actual notification channel to wire, rather than shipping a switch that does nothing.

### 3.5 Save bar
Once sections hit different real endpoints (schedule PATCH, settings PATCH) instead of one shared fake button, a single global "Save configuration" stops making sense — it would imply one atomic save across unrelated systems. Recommend per-section save actions (already implied by 3.1's per-slot Save) instead of a page-wide bar that saves nothing coherent.

## 4. Backend additions required

- `PATCH /api/pipeline/schedules/[id]` — body `{ hour, minute }` (or a raw cron string for power users), validated against the three known slot ids (`research-overnight`, `research-midday`, `research-us-daytime`), builds the cron pattern, calls `researchQueue.upsertJobScheduler(id, { pattern, tz: env.TIMEZONE }, { name: "scheduled-research", data: { slot: id } })`, returns the updated `next` fire time. No schema migration — BullMQ schedulers live in Redis, not Postgres.
- No backend change needed for §3.2 (Worker Activity) — derivable from data `/api/dashboard` already returns.
- Only if §3.3/§3.4 are made real: one new `AppSetting` Prisma model + migration, plus a read helper wired into each worker that currently hardcodes its model/threshold from env vars.

## 5. New components needed

- `WorldClocks` — extracted from `RunPipelineModal.tsx`'s existing `CLOCKS`/`timeIn()`/`useSyncExternalStore` clock logic, so it's shared instead of duplicated between the run-pipeline modal and this page.
- `ScheduleTimeline` — the 24-hour strip with three plotted slot markers.
- `ScheduleSlotCard` — per-slot digital time readout + edit control + save, calling the new PATCH endpoint.
- `WorkerActivityRow` — reused row layout for the six reactive workers (state dot, last-ran, avg duration) — largely the same visual language already used on `/dashboard/workers`, just condensed.

## 6. Suggested phasing

1. **Phase 1 (real, no schema changes):** Research Schedule section (§3.1) with live clocks, 24h timeline, and working edit-and-save against the real BullMQ schedulers. Worker Activity panel (§3.2) from existing data. Remove or relabel the Auto-publish and Slack/Email toggles per §3.4's finding that they don't correspond to a real on/off state or integration.
2. **Phase 2 (only if wanted):** `AppSetting` table + wiring so the AI-model-per-stage selects and the daily limit are actually persisted and read by the workers — this is a real backend feature, not a styling pass, and should be scoped on its own.

## 7. Open questions for you

- For Phase 2, do you want the AI-model-per-stage picker and daily limit to actually control the workers, or would documenting them as "set via environment variable" be enough for now?
- Should "Auto-publish on QA pass" and "Slack/Email alerts" be removed from Settings entirely (since neither has a real backing today), or do you want them scoped as new features — meaning a configurable quality threshold, and an actual Slack webhook integration, as real follow-up work?
- Is `Asia/Kolkata` the timezone that should always be primary in the clock cluster, or should that be configurable per user viewing the dashboard?
