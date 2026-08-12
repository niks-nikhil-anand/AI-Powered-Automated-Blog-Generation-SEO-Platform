# Settings Page — "Properly Dynamic" Plan

> **Status: IMPLEMENTED (2026-08-12)** — Phases A, B and C all shipped and verified live
> (tsc clean, eslint clean on touched files, API round-trips verified with curl: override →
> overridden-flag → reset for schedules/models/goal; 422/404 validation guards; reconcile
> scheduler no longer leaks into the schedule UI). Files touched:
> `workers/shared/research-slots.ts` (new), `workers/shared/settings.ts` (+deleteSetting),
> `workers/research-worker/index.ts` (boot override read + dispatch clamp),
> `workers/research-worker/pipeline/engine.ts` (dispatch clamp),
> `app/api/pipeline/run-context/route.ts` (filter + reconcile + overridden),
> `app/api/pipeline/schedules/[id]/route.ts` (persist + reset),
> `app/api/settings/route.ts` (7 stages, flags, options, validation, reset),
> `app/dashboard/settings/page.tsx`, `components/shared/ScheduleSlotCard.tsx`.

`/dashboard/settings` — audit + implementation plan for the four panels:
**Research Schedule**, **Worker Activity**, **AI Model Per Pipeline Stage**, **Daily Blog Goal**.

This doc assumes the Phase-1/Phase-2 work from `docs/settings-page-uiux-plan.md` (already shipped:
AppSetting table, `/api/settings`, `/api/pipeline/schedules/[id]`, live clocks/timeline). What follows
is the *next* pass: verifying what is actually dynamic today, listing the gaps where the page is
static, stale, or logically disconnected, and the concrete fixes in dependency order.

---

## 1. Verified current state (what "dynamic" means today)

| Panel | Reads from | Writes to | Verdict |
|---|---|---|---|
| Research Schedule | `GET /api/pipeline/run-context` → BullMQ `getJobSchedulers()` (Redis), polled every 5s | `PATCH /api/pipeline/schedules/[id]` → `researchQueue.upsertJobScheduler()` — immediate, no restart | **Dynamic, but not persistent** (Gap S1) |
| Worker Activity | `GET /api/dashboard` → `workerActivity[]` + `queues[]`, polled every 5s | read-only | **Dynamic, but lossy data source** (Gap W1) |
| AI Model Per Stage | `GET /api/settings` → AppSetting rows (fallback env) | `PATCH /api/settings` `model:<stage>` → AppSetting; workers re-read per job (15s cache) | **Dynamic end-to-end, but UI shows 4 of 7 stages + stale notes** (Gaps M1–M4) |
| Daily Blog Goal | `GET /api/settings` → `dailyBlogTarget` | `PATCH /api/settings` → AppSetting; consumed by `getDailyTargetStatus()` → drives dashboard pace card **and** `reconcileDailyTarget()` (every-30-min BullMQ scheduler + after QA/publish failure) | **Dynamic and enforced — but the UI copy denies it, and dispatch isn't clamped** (Gaps D1–D3) |

Key evidence:
- `workers/shared/settings.ts` — `getSetting` (15s per-process cache, env fallback), `MODEL_SETTING_KEYS` has **7** stages: `planning, outline, writing, semantic, judge, writingSections, writingSelfcheck`.
- `workers/shared/daily-target.ts` — `reconcileDailyTarget()` tops up today's pipeline from `Trend` backlog toward the AppSetting target. Wired in `workers/research-worker/index.ts` (`daily-target-reconcile` scheduler, `RECONCILE_CRON` default `*/30 * * * *`), `quality-worker/index.ts`, `publish-worker/index.ts`.
- `workers/research-worker/index.ts` `registerSchedules()` — upserts the 3 slot patterns from **env vars at every boot** (this is the persistence bug, S1).
- All 7 model stages are genuinely read per-job: `planning-worker/vertex.ts`, `outline-worker/vertex.ts`, `writing-worker/vertex.ts` + `sections.ts` + `selfcheck.ts`, `research-worker/pipeline/{semantic,query-expansion,novelty,topic-quality}.ts`, `quality-worker/judge.ts`.

---

## 2. Gap list (the "not properly dynamic / not logical" parts)

### Research Schedule
- **S1 — Dashboard edits silently revert on worker restart (the big one).**
  `PATCH /api/pipeline/schedules/[id]` writes only to Redis. `registerSchedules()` re-upserts
  `env.RESEARCH_CRON_*` patterns on every boot, so a restart/deploy wipes the user's edit with no
  trace. Fix: persist edited patterns in AppSetting; boot reads AppSetting first, env as fallback.
- **S2 — The `daily-target-reconcile` scheduler leaks into the schedule UI.**
  `run-context` returns *all* schedulers with a numeric `next`, which includes the 30-min reconcile
  job. The page renders it as a 4th card labeled "daily target reconcile" showing `--:--`
  (`parseDailyCron` can't parse `*/30 * * * *`), and its Edit button → PATCH 404 ("Unknown
  schedule"). Fix: filter server-side to the three `research-*` slot ids.
- **S3 — No research-worker liveness signal.** `run-context` already returns `workersConnected`
  (BullMQ consumer count); the page ignores it. "No schedules registered — worker may not have
  booted" conflates "worker down" with "SCHEDULER_ENABLED=false". Show an explicit status pill.
- **S4 — Slot labels duplicated in 3 files** (`research-worker/index.ts`, `run-context/route.ts`,
  `schedules/[id]/route.ts`). Drift risk when a slot is renamed. Fix: one shared constant.

### Worker Activity
- **W1 — Built from the lossy source when a better one exists in the same payload.**
  `workerActivity` is derived from `workflowRuns` scoped to the 50 latest blogs (attempts without a
  recent blogId vanish — admitted in the code comment). The same `/api/dashboard` response already
  includes `workerHealth[]`, built from the 300 latest `WorkerAttempt` rows **plus** live BullMQ
  consumer/pause state (`live`, `consumers`, `paused`, `state`, `lastRanAt`, `avgDurationMs`,
  `p95DurationMs`). Fix: render the panel from `workerHealth` — zero backend change, strictly more
  accurate, and adds "worker process not connected" detection which today is invisible.
- **W2 — Hardcoded copy.** "No recent activity in the last 50 blogs" hardcodes the 50; with
  `workerHealth` the sample window changes. Make the empty-state copy match the real source.
- **W3 — Research worker absent everywhere.** It's excluded from this panel (by design) but its
  liveness isn't shown in the Schedule section either (see S3 — one pill fixes both).

### AI Model Per Pipeline Stage
- **M1 — UI exposes 4 of 7 editable stages.** `MODEL_STAGES` in the page lists only
  `planning/outline/writing/semantic`. The API returns all 7 — `judge` (quality editorial judge),
  `writingSections` (per-section drafting), `writingSelfcheck` (claim self-check) are
  dashboard-writable via API but have no UI. Either add all 7 rows or consciously trim the API.
  Plan: show all 7, grouped by worker.
- **M2 — The "no model call" notes are factually stale.** `NO_MODEL_STAGES` claims:
  - "Quality QA — deterministic scorer, no AI model call" → **false** when `JUDGE_ENABLED=true`
    (`model:judge`); also the featured-image vision check runs on `env.VERTEX_FLASH`.
  - "Image — draws an SVG locally, no AI model call" → **false** when
    `IMAGE_AI_GENERATION_ENABLED=true` (the default): image-worker calls Imagen via
    `env.VERTEX_IMAGE_MODEL`.
  Fix: make these notes env-aware (server renders them) or reword to name the env flag that
  controls each ("LLM judge off — set JUDGE_ENABLED=true to enable; uses model:judge when on").
- **M3 — PATCH accepts any string.** A typo'd model name is saved and the next job fails at Vertex.
  Add server-side validation (format regex `/^gemini-[\w.:-]+$/` at minimum; ideally an allowlist
  shared with the dropdown options).
- **M4 — Hardcoded dropdown options can render blank.** If the effective value (env default or a
  previously saved custom string) isn't one of the 3 hardcoded `MODEL_OPTIONS`, the Select shows an
  empty placeholder. Fix: server returns `modelOptions` (env-derived known list) and the UI always
  appends the current value if missing.
- **M5 — One shared save message.** `settingsMessage` renders only inside the model card, so a
  Daily-goal save error surfaces under the wrong card. Give each card its own message state.

### Daily Blog Goal
- **D1 — The disclaimer is now false.** The card says "nothing currently stops the pipeline from
  generating more or fewer than this in a day." Stale copy from before the Daily Target Controller
  existed: `reconcileDailyTarget()` *does* steer the day toward the target (top-up from backlog
  every 30 min + on QA/publish failure), and the home page pace card/`behindPace` banner both read
  it. Fix: rewrite the copy to describe what the number actually does.
- **D2 — No live progress in the card.** The page already fetches `/api/dashboard` every 5s;
  `metrics.dailyTarget{,Remaining,InFlight,BacklogAvailable}` + `todayPublishedCount` are in that
  payload but not rendered here. Show "today: X published · Y in flight · Z to go" under the slider
  so changing the goal visibly connects to reality.
- **D3 — Research dispatch ignores the goal (the logical-dynamism gap).**
  `runResearch()` dispatches `topN = TRENDS_TO_WRITE_PER_RUN` (env, currently 3) regardless of
  `getDailyTargetStatus().remaining`. So with goal = 1, a research run still pushes 3 into
  planning; the goal acts as a *floor* the reconcile loop tops up to, never a *ceiling*. Decision
  needed (§4, item C1) — recommendation: clamp dispatch to `max(remaining, 0)` and let un-dispatched
  qualified trends stay `NEW` as backlog (reconcile uses them later the same day).

### Cross-cutting
- **X1 — Propagation expectations undocumented in UI.** Schedule edits are instant (Redis); model /
  goal edits propagate to workers within the 15s `getSetting` cache TTL. One line of copy per card
  ("applies to new jobs within ~15s") prevents "I saved and nothing changed" confusion.
- **X2 — No reset path.** Once a model/goal/schedule is overridden there's no "back to default"
  affordance (AppSetting row can't be deleted from the UI). Small but rounds out "properly dynamic".

---

## 3. Implementation plan — Phase A: correctness (no behavior change)

Order is dependency-safe; each item is independently shippable.

**A1. Stop the reconcile scheduler leaking into the schedule UI** — `app/api/pipeline/run-context/route.ts`:
filter `schedules` to the three known slot ids (share the id→label map, see S4). Optionally return
`reconcile: { pattern, next }` as a separate field so the page *can* show it as an informational
"system tick" line later.

**A2. Shared slot metadata** — new `workers/shared/research-slots.ts` exporting
`RESEARCH_SLOT_IDS` + labels; import it from `research-worker/index.ts`, `run-context/route.ts`,
`schedules/[id]/route.ts`. (Importing a plain constants file, not the worker entrypoint, so no
second BullMQ consumer gets created.)

**A3. Worker Activity → `workerHealth`** — `app/dashboard/settings/page.tsx`: read
`data.workerHealth` instead of `data.workerActivity`; render state dot from `state`/`live`/`paused`
(add a "paused" / "no consumer" visual state), last-ran + avg duration as today, p95 as a new
mono chip; fix empty-state copy (W2). No API change. Optionally leave `workerActivity` in the API
(other consumers don't use it — verify with a grep before deleting anything).

**A4. Model card shows all 7 stages + truthful notes** — `app/dashboard/settings/page.tsx`:
drive rows from the GET response keys (grouped: Planning / Outline / Writing / Writing sections /
Writing self-check / Research semantic / Quality judge); replace hardcoded `NO_MODEL_STAGES` notes
with env-aware text returned by `GET /api/settings` (the route already imports `env` — add
`flags: { judgeEnabled, imageAiEnabled, semanticEnabled, sectionedWritingEnabled, selfcheckEnabled }`
to the response and compute notes client-side, or compute server-side).

**A5. Model validation + options from server** — `app/api/settings/route.ts`: reject model strings
failing `/^gemini-[\w.:-]+$/` (422 with a clear message); include `modelOptions` in GET (union of the
three known 2.5 models + any env-configured `VERTEX_MODEL`/`VERTEX_FLASH`). Page renders options
from the response, appending the current value when absent (M4).

**A6. Per-card save messages + propagation copy (X1)** — split `settingsMessage` into
`modelMessage` and `goalMessage`; add the "~15s to reach running workers" line under both cards.

**A7. Daily-goal card: honest copy + live progress (D1, D2)** — render
`todayPublishedCount / dailyTarget · inFlight · remaining` from the already-polled dashboard payload;
replace the disclaimer with: "The Daily Target Controller tops today's pipeline up to this number
from the research backlog (checks every 30 min and after every QA/publish failure). Research runs
stockpile qualified trends as backlog."

**A8. Research-worker liveness pill (S3/W3)** — in the Research Schedule header, use
`workersConnected` from `run-context`: emerald "worker connected" / rose "no consumer — schedules
won't fire". (This is the single most operationally useful line on the page.)

## 4. Implementation plan — Phase B: make schedule edits survive restarts (S1)

**B1.** New AppSetting key `schedule:<slotId>` (e.g. `schedule:research-midday` → `"0 14 * * *"`).
`workers/shared/settings.ts` needs no change — generic get/set already handles it.

**B2.** `PATCH /api/pipeline/schedules/[id]`: after a successful `upsertJobScheduler`, also
`setSetting("schedule:" + id, pattern)`. Response unchanged. (Keep Redis as the live source of
truth for reads — AppSetting is only the boot-time override.)

**B3.** `registerSchedules()` in `workers/research-worker/index.ts`: for each slot, pattern =
`await getSetting("schedule:" + slot.id, env<slot default>)` before upserting. Boot now restores
dashboard edits; a `.env` change still wins whenever no override row exists (document this
precedence in the env comment).

**B4.** Reset affordance (X2): `DELETE /api/pipeline/schedules/[id]` (or `{ reset: true }` in PATCH)
that deletes the AppSetting row and re-upserts the env default; small "Reset" link on each
`ScheduleSlotCard` shown only when an override exists (the PATCH/GET can flag `overridden: boolean`).

## 5. Implementation plan — Phase C: logical coupling (D3) + polish

**C1. Clamp research dispatch by the remaining goal** — in `runResearch()`
(`workers/research-worker/index.ts`), after computing `topN`:
`const { remaining } = await getDailyTargetStatus(); const dispatch = topN.slice(0, remaining);`
- `remaining === 0` → save trends as `NEW` (backlog), pass attempt with
  `reason: "daily_target_already_met"`, `dispatchedCount: 0`, `nextStage: "stopped"`.
- Keep the existing `RESEARCH_MIN_SCORE_TO_WRITE` gate untouched.
- The engine path (`runResearchEngine`) needs the same clamp at its dispatch site.
- **Decide first:** this changes daily output shape (goal becomes a ceiling *and* a floor). With
  goal=3 and 3 runs/day the pipeline converges to exactly 3/day instead of up to 9. That's the
  logically coherent behavior the request asks for, but it is a real behavior change — call it out
  in the PR description.

**C2. Reset-to-default for models/goal** — `DELETE` handling (or `{ value: null }`) in
`/api/settings` that removes the AppSetting row so env defaults re-apply; "Reset" links in the UI.

**C3. Copy pass** — header line, per-card subtitles, and the timeline empty state reviewed against
the new truths (scheduler disabled vs worker down; goal semantics after C1).

## 6. Verification checklist (run after each phase)

1. `npx tsc --noEmit` clean; `npm run lint` clean.
2. **Schedule:** `curl localhost:3000/api/pipeline/run-context | jq '.schedules'` → exactly 3
   `research-*` entries. Edit midday to +5 min via UI → countdown updates within 5s;
   `docker compose restart` the worker (or `npm run worker:*` restart) → edited time **persists**
   (Phase B). Settings page shows no 4th `--:--` card.
3. **Worker Activity:** with a job running, row dot pulses indigo; with the worker container
   stopped, row shows "no consumer" within one 5s poll.
4. **Models:** change Writing → flash-lite, run a pipeline job, confirm `AIUsage` rows for
   writing-worker show the new model (Logs/usage on the dashboard). Save `gpt-4o` via curl → 422.
   All 7 stages render; notes match current env flags.
5. **Goal:** set goal to 5 → home page card shows `x / 5` within one poll; worker log shows
   reconcile dispatching up to the new `remaining`; (after C1) a research run at goal dispatches 0
   and logs `daily_target_already_met`.
6. **Persistence:** `SELECT key, value FROM "AppSetting";` shows rows for every override; Reset
   removes them and env defaults re-apply.

## 7. Open questions

1. C1 changes the daily goal from a floor into a ceiling+floor — confirm that's the intended
   "logically dynamic" behavior before implementing (alternative: keep dispatch uncapped and only
   fix the copy).
2. Should the 30-min `daily-target-reconcile` tick be visible (read-only) in the Research Schedule
   section, or hidden entirely?
3. Model dropdown: free-form validated string (any future `gemini-*`) or strict allowlist of the
   three 2.5 models?
4. Reset affordances (B4/C2): want them in this pass or later?
