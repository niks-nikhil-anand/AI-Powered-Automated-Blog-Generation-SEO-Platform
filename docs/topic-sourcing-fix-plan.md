# Topic Sourcing — Corrected Diagnosis & Fix Plan

> **Status: PLAN (2026-08-28)** — supersedes the root-cause section of
> `docs/topic-sourcing-fallback-plan.md`. That doc's *goal* (three-tier sourcing) is kept;
> its *diagnosis* and *phase ordering* are corrected here, because building the fallback tiers
> first would have permanently hidden the actual bug rather than fixed it.

---

## 0. What changed vs. the previous plan

The previous doc concluded:

> "the live-fetch pipeline is not fundamentally broken — it's a single point of failure with a
> strict gate"

**That is incorrect.** The pipeline *is* fundamentally broken, in the scoring function. 8 of the
12 configured sources are structurally incapable of producing a score above ~30, against a
promote floor of 70 and a dispatch gate of 90. They contribute nothing but noise. Lowering the
threshold to 78 (the previous doc's §5.1 headline fix) would change nothing for those 8 sources.

Three further defects in the previous plan would have shipped broken code:

| # | Previous plan said | Reality |
|---|---|---|
| A | Tier 2/3 topics get "a synthetic score (e.g. 75)" | Planning, outline, **and** writing workers each independently re-gate on `score >= 90` and drop the job. A score-75 trend is dispatched, then silently discarded one stage later. Tiers 2/3 would appear to work and produce zero blogs. |
| B | "There is currently no working fallback of any kind" | A backlog fallback exists at [index.ts:432](workers/research-worker/index.ts:432) — but it queries `score >= RESEARCH_MIN_SCORE_TO_WRITE` (90), i.e. it re-applies the exact gate that just failed. It is dead code in practice, not missing code. |
| C | The adaptive floor (90 → 78) is the highest-value tier-1 fix | Nothing lands between 78 and 90 except one narrow case (a fresh Google News item with a mid-range semantic score). The floor is worth having, but it is a rounding error next to the scoring fix. |

Everything else in the previous doc — the `Niche` / `TopicPoolItem` models, the AI tier, the
dead `ManualTopicModal`, the tier badges — is sound and is carried forward below.

---

## 1. Verified root cause

### 1.1 The scoring weights are unreachable for most sources

`pipeline/score.ts:46-81` blends four dimensions:

```
score = strongestSourceScore * 0.55      // max of [trendDemand, newsFreshness, githubMomentum]
      + average(sourceScores) * 0.15     // mean of the non-zero ones
      + multiSourceValidation * 0.10     // distinct source count / 3
      + semanticRelevance   * 0.20       // LLM relevance, 0 on any failure
```

The three source-derived dimensions are computed from exactly three fields:

| Dimension | Computed from | Populated by |
|---|---|---|
| `trendDemand` | `signal.volume` | `google_trends` only ([google-trends.ts:75](workers/research-worker/sources/google-trends.ts:75)) |
| `githubMomentum` | `signal.engagement` | `github_trending` only ([github-trending.ts:61](workers/research-worker/sources/github-trending.ts:61)) |
| `newsFreshness` | `signal.publishedAt`, **filtered to `source === "google_news"`** ([score.ts:61-66](workers/research-worker/pipeline/score.ts:61)) | `google_news` only |

So for **techcrunch, the_verge, google_ai_blog, openai_news, anthropic_news, microsoft_ai_blog,
nvidia_blog, hackernews, searxng** — 9 of the 12 sources — all three dimensions are hard 0.
`sourceScores` filters out zeros, leaving an empty array: `strongestSourceScore = 0`,
`average = 0`. That deletes **70% of the available score** before anything is evaluated.

### 1.2 Empirical confirmation

Ran `scoreCluster()` directly against representative clusters (no network, no DB):

```
 23 | 1 pure-RSS item, semantic=100                      | trend 0, news 0, gh 0, multi 33, sem 100
 30 | 3 pure-RSS sources agree on one story, semantic=100| trend 0, news 0, gh 0, multi 100, sem 100
 27 | HN top story (900 points) + The Verge, semantic=100| trend 0, news 0, gh 0, multi 67, sem 100
 93 | google_news fresh (2h) alone, semantic=100         | trend 0, news 100, gh 0, multi 33, sem 100
 87 | google_news fresh (2h) alone, semantic=70          |  -> BLOCKED at 90
 73 | google_news fresh (2h) alone, semantic=0 (Vertex down) -> BLOCKED at 90, passes promote(70)
 92 | trends(20k) + news fresh + github(5k stars), semantic=70
 98 | trends(20k) + news fresh + github(5k stars), semantic=100
100 | absolute ceiling: trends 100k + news 0h + github 355k stars + semantic 100
```

Read that table as the answer to *"why is it zero every single time"*:

- **Three RSS sources reporting the same story with a perfect LLM relevance score = 30.** Not
  promoted (needs 70), never saved as a `Trend`, never eligible for backlog. Those sources are
  decorative.
- The only single-source path over 90 is **a fresh Google News item with semantic ≥ ~85**.
- Semantic scoring fails soft to 0 ([semantic.ts:73-75](workers/research-worker/pipeline/semantic.ts:73)).
  With `VERTEX_FLASH_RPM=5` and one call per 25-cluster batch, a 429 or timeout caps that same
  Google News item at 73 — promoted, saved, and permanently undispatchable.
- The multi-signal path over 90 requires a Google Trends cluster, a Google News item, **and** a
  GitHub repo to merge into one cluster via `titleSimilarity >= 0.55` or 3+ shared keywords
  ([dedupe.ts:9-17](workers/research-worker/pipeline/dedupe.ts:9)). Rare by construction.

**Net effect:** on a typical run the pipeline fetches ~200 signals, clusters them, and produces
a handful of candidates in the 20-40 range plus occasionally one Google News item at 73-93.
`dispatchedCount: 0` is the expected output of this system, not an anomaly.

### 1.3 Supporting defects (each independently verified)

1. **`timestamp` is dead data.** The 8 RSS sources write `timestamp` (ISO string,
   e.g. [techcrunch.ts:67](workers/research-worker/sources/techcrunch.ts:67)); nothing in
   `pipeline/` or `index.ts` ever reads it. The freshness dimension reads `publishedAt`, which
   only `google_news` and `github_trending` set. A one-field mismatch is erasing the freshness
   signal for every RSS source.
2. **Hacker News discards its own strongest signal.** `item.score` (points) goes into the
   `snippet` string ([hackernews.ts:~78](workers/research-worker/sources/hackernews.ts)), not
   into `engagement`. A 900-point HN story scores identically to a 10-point one.
3. **`source-tiers.ts` is unused by the live path.** A curated authority tiering (official
   blogs / quality press / aggregators) already exists and is only consumed by the disabled
   `RESEARCH_ENGINE_ENABLED` path. The legacy scorer has no authority dimension at all.
4. **`ANTHROPIC_NEWS_RSS` is 404** — verified live: `https://www.anthropic.com/research/rss.xml`
   → `404`. It throws every run and lands in `failedSources`. (Google Trends RSS returns `200`;
   OpenAI's feed returns `200`. The previous doc's worry about Trends being dead is unfounded.)
5. **`GOOGLE_NEWS_URL` in `.env` is read nowhere.** Confirmed — not present in `workers/shared/env.ts`.
6. **Downstream re-gating.** `planning-worker:35`, `outline-worker:37`, `writing-worker:540`
   and `daily-target.ts:34,67` all independently require `score >= 90 || manuallyApproved`.
   Any fallback tier must set `manuallyApproved: true` or it is dead on arrival (defect A above).
7. **Manual topic UI is a dead end.** [layout.tsx:71-72](app/dashboard/layout.tsx:71) —
   `onSubmit` calls `alert()` and discards the input. Confirmed as described.

---

## 2. Fix strategy

**Order matters.** Fix the scorer first. If tiers 2/3 ship first, every blog the system produces
comes from a canned pool or an AI hallucination, live research stays broken behind a green
dashboard, and nobody notices for months. The fallback tiers are a *safety net*, and a safety
net installed under a broken floor becomes the floor.

| Phase | Goal | Ships | Risk |
|---|---|---|---|
| **0** | Make the scorer able to see the sources it already fetches | ~1 day, no schema change | Medium — changes what gets published |
| **1** | Honest reasons + working backlog + config hygiene | ~half day, no schema change | Low |
| **2** | Predefined topic pool (tier 2) + fix manual topic UI | ~2-3 days, one migration | Low |
| **3** | AI-generated topic from niche (tier 3) | ~2 days | Low |
| **4** | Observability: tier badges, honest modal copy, settings panel | ~1-2 days | None |

Phase 0 alone should take dispatch from ~0/day to a working rate. Phases 2-3 exist for the days
when the news genuinely is dry, not as the primary engine.

---

## 3. Phase 0 — Fix the scorer (the actual bug)

All changes are in `workers/research-worker/`. No schema migration. Behind a single env flag
(`RESEARCH_SCORING_V2`, default `true`) so it can be reverted without a deploy if output quality
regresses.

### 3.0 Prerequisite: normalize `timestamp` → `publishedAt`

In `pipeline/normalize.ts`, populate `publishedAt` from `timestamp` when it is absent:

```ts
publishedAt: signal.publishedAt ?? (signal.timestamp ? new Date(signal.timestamp) : undefined),
```

Guard against `Invalid Date`. This single line makes freshness computable for all 12 sources and
retires the dead field. (Optionally follow up by deleting `timestamp` from `RawSignal` and having
the RSS sources set `publishedAt` directly — cosmetic, do it after Phase 0 lands.)

Also in `sources/hackernews.ts`: set `engagement: item.score` alongside the existing snippet text.

### 3.1 Universal freshness and universal engagement

- `score.ts:61-66` — drop the `source === "google_news"` filter. Freshness becomes
  `max(freshnessScore(signal.publishedAt))` across *all* signals in the cluster. An OpenAI
  announcement published 2 hours ago is at least as strong a freshness signal as a Google News
  result about it.
- Same for engagement: rename `githubMomentum` → `engagement` and compute it from
  `max(signal.engagement)` across all sources, not just `github_trending`. Without this, the
  HN fix in §3.0 has no effect — `score.ts:55-60` filters engagement to
  `source === "github_trending"`, so HN points would be recorded and then ignored.
- Drop the fake `engagement: 1` sentinel in
  [google-news.ts:57](workers/research-worker/sources/google-news.ts:57) (set it undefined).
  Once engagement is universal, a hardcoded `1` drags the `average(sourceScores)` term down for
  every Google News cluster. Guard the dimension with `bestEngagement > 1`.

### 3.2 New dimension: `sourceAuthority`

Reuse the existing, already-written `pipeline/source-tiers.ts`:

```ts
const authority = Math.max(...evidence.map(s => s.url ? { 1: 100, 2: 70, 3: 40 }[tierForUrl(s.url)] : 30));
```

This is what actually distinguishes "OpenAI announced it on their own blog" from "a Medium
repost." It gives the 9 currently-mute sources a real, defensible contribution.

### 3.3 Reweight

```
                        current   proposed
strongestSourceScore      0.55      0.40   // now spans freshness/engagement/authority/trend
average(sourceScores)     0.15      0.05   // was over-penalizing clusters with one weak dimension
multiSourceValidation     0.10      0.15   // 3 independent sources agreeing matters more
sourceAuthority            —        0.20   // new
semanticRelevance         0.20      0.20   // unchanged
```

with `sourceScores = [trendDemand, freshness, engagement, sourceAuthority].filter(v => v > 0)`.

**Measured, not estimated** — these are real outputs from running the current `scoreCluster()`
and a v2 implementation over identical clusters:

| Cluster | v1 | v2 |
|---|---:|---:|
| Stale Tier-3 blog item (10d old), semantic 40 | 11 | 38 |
| 1 fresh Tier-2 RSS (TechCrunch 6h), semantic 80 | 19 | **79** |
| 1 fresh Tier-1 RSS (OpenAI blog 2h), semantic 90 | 21 | **88** |
| 3 RSS sources agree incl. Tier-1, fresh, semantic 90 | 28 | **98** |
| HN 900pts + The Verge, fresh, semantic 85 | 24 | **85** |
| Fresh Google News alone, semantic 70 | 87 | 70 |
| Fresh Google News alone, **Vertex down** | 73 | 71 |
| Trends(20k) + News + GitHub(5k stars), semantic 70 | 92 | 93 |

Three things to read out of this:

1. **The nine mute sources come alive.** A real multi-source story goes 28 → 98. A Tier-1
   first-party announcement goes 21 → 88. This is the fix.
2. **It is not "everything scores higher."** The stale Tier-3 item stays at 38, and the
   Vertex-down case barely moves (73 → 71) instead of falling off a cliff — that is §3.4's
   renormalization working.
3. **One deliberate regression, flagged honestly:** a lone fresh Google News item with a
   mediocre semantic score drops 87 → 70. That is correct behavior — a single syndicated news
   hit with mid relevance and no corroboration should not be a 90th-percentile blog topic —
   but it *is* a behavior change, and it is the case that currently produces the system's rare
   successful dispatches. Expect the mix of what gets published to shift toward corroborated
   and first-party stories.

**Threshold implication:** under v2, 90 is cleared only by the 3-source-agree and full-signal
cases. A Tier-1 announcement lands at 88 and a strong HN story at 85. Recommend
**`RESEARCH_WRITE_THRESHOLD` = 85** with the adaptive floor at 80, decided from the score report
below rather than from this table.

**Validate before merging.** Add `npm run research:score-report` — a script that runs the real
fetch → normalize → dedupe → score path (semantic stubbed at a fixed value) and prints the full
candidate list with per-dimension breakdowns under both v1 and v2 weights. Eyeball one real run
and confirm the top 10 under v2 are topics you would actually publish. The table above is a
synthetic-cluster comparison, not a live run — it proves the formula behaves, not that today's
feeds produce good topics.

### 3.4 Semantic must not silently zero 20% of the score

Two changes, both small:

- `semantic.ts` — distinguish "scored 0" from "not scored." Return `semanticRelevance: null`
  on failure and have `score.ts` **renormalize the remaining weights** (divide by 0.8) rather
  than multiplying a missing value by 0.2. A Vertex outage should demote confidence, not
  mechanically subtract 20 points from every candidate in the run.
- Record `semanticFailedBatches` on the run output so the dashboard can say *"scored without
  semantic — Vertex was rate-limited"* instead of silently reporting a low score.

### 3.5 Threshold hygiene

- Move `RESEARCH_WRITE_THRESHOLD` and `RESEARCH_MIN_SCORE_TO_PROMOTE` to `AppSetting`-backed
  values with env fallback (existing `getSetting()` convention), so tuning after the reweight
  doesn't need a redeploy.
- Set the write threshold to **85** when v2 lands (see §3.3), then re-tune against the score
  report from one live run. Leaving it at 90 alongside v2 would keep Tier-1 announcements (88)
  and strong HN stories (85) permanently out of reach — a smaller version of the same bug.
- Keep the previous doc's adaptive floor (`RESEARCH_WRITE_THRESHOLD_FLOOR`, default 80) as a
  best-candidate-only retry. It is genuinely useful once §3.1-3.3 put candidates in that band.

---

## 4. Phase 1 — Honest failure reporting + working backlog

No schema change; all in `workers/research-worker/index.ts` and one UI string.

1. **Fix the existing backlog fallback.** [index.ts:432-435](workers/research-worker/index.ts:432)
   queries `score >= RESEARCH_MIN_SCORE_TO_WRITE` — the gate that just failed. Change to
   `score >= RESEARCH_MIN_SCORE_TO_PROMOTE` (70) **and** set `manuallyApproved: true` on the
   trend before dispatch so the three downstream gates don't drop it. This alone resurrects a
   fallback that was written, shipped, and has never once fired.
2. **Split the outcome reasons.** Today every empty outcome is
   `no_new_topic_above_write_threshold`. Replace with a discriminated set, each carrying the
   numbers that explain it:
   - `no_signals_fetched` — every source returned nothing
   - `no_candidate_promoted` — candidates existed, best score < 70 (**today's actual case**)
   - `promoted_but_below_write_threshold` — best score 70-89, includes `bestScore`
   - `all_new_candidates_were_duplicates` — includes `duplicateSkippedCount`
   - `daily_target_already_met` — legitimate success, unchanged
   - `all_tiers_exhausted` — reserved for Phase 2/3
3. **Surface `failedSources` in the run output** with source names, not just messages. Anthropic's
   404 should be visible on the dashboard, not buried in a log line.
4. **Config cleanup:** set `ENABLE_ANTHROPIC_NEWS=false` in `.env` (a disabled source is honest;
   a 404ing one masquerading as active is not), and delete the unused `GOOGLE_NEWS_URL`.

---

## 5. Phase 2 — Predefined topic pool (tier 2)

Carried forward from the previous doc's §4.2 / §5.2 / §5.5 / §6.3, with corrections.

### 5.1 Schema

`TopicPoolItem` and `Niche` exactly as specified in the previous doc §4.2-4.3, plus on `Trend`:

```prisma
enum TrendSourceTier { LIVE_FETCH PREDEFINED_POOL AI_GENERATED MANUAL }

model Trend {
  sourceTier TrendSourceTier @default(LIVE_FETCH)
  poolItemId String?
  nicheId    String?
  // + relations, @@index([sourceTier])
}
```

All nullable/defaulted — backward compatible, no backfill.

### 5.2 The correction that makes tiers 2/3 actually work

Every fallback-tier `Trend` **must** be created with `manuallyApproved: true`. Without it,
`planning-worker:35` drops the job the moment it dequeues, and the dashboard shows a dispatched
topic that never becomes a blog.

Set the synthetic score to `RESEARCH_MIN_SCORE_TO_PROMOTE` (70) rather than the previous doc's
75 — it reads unambiguously as "floor-level, not organically scored," and `manuallyApproved`
(not the number) is what carries it through the gates.

Also extend `daily-target.ts:34,67` to count `score >= threshold OR manuallyApproved`, so pool
and AI trends are visible to the reconcile tick as backlog.

### 5.3 Selection + wiring

`pipeline/pool-fallback.ts` with `selectFromPool()` / `materializePoolItem()` as the previous
doc specified — least-recently-used ordering (`usageCount ASC, lastUsedAt ASC NULLS FIRST`),
niche match, not used within `RESEARCH_RECENT_DUPLICATE_DAYS`. Wire into `runResearch()` after
the tier-1 dispatch block, gated on `getDailyTargetStatus().remaining > 0`.

### 5.4 Fix the manual topic path

`POST /api/topics/manual` accepting `{ title, description?, category, nicheId?, dispatchNow }`;
creates a `TopicPoolItem`, and when `dispatchNow` also a `MANUAL`-tier `Trend`
(`manuallyApproved: true`). Wire `ManualTopicModal`'s `onSubmit` to it and delete the `alert()`.

Plus `/dashboard/topics/pool` CRUD page and a seed script of ~40-60 evergreen topics, per the
previous doc §6.3 / §4.4.

---

## 6. Phase 3 — AI-generated topic (tier 3)

As the previous doc §5.3 / §6.4 specifies — `pipeline/ai-fallback.ts`, `generateVertexJson`
through the existing gateway, Zod-validated, novelty guard from the last 30 days of
`Trend.topic`, `MODEL_SETTING_KEYS.topicGeneration`, `/dashboard/topics/niches` CRUD.

Same `manuallyApproved: true` requirement as §5.2.

**Open question answered:** the previous doc asked whether tier-3 topics should require human
approval. **Yes, initially** — but implement it as a `Trend.status = NEW` + a dashboard approval
queue, not by relying on the score gate (which `manuallyApproved` has to bypass anyway).
Ship it behind `RESEARCH_AI_FALLBACK_AUTO_DISPATCH=false` and flip it once the generated topics
look good for a couple of weeks.

---

## 7. Phase 4 — Observability

Per the previous doc §6.1-6.5, plus one addition: the run-detail view should show the
**score distribution of the run** (how many candidates in each 10-point band, with the promote
and write thresholds marked). That is the single view that would have made this entire bug
obvious in a glance months ago — the failure mode was invisible precisely because the dashboard
only ever reported the dispatch count, never the distribution behind it.

---

## 8. Validation

- **Phase 0:** `research:score-report` against a live fetch, v1-vs-v2 side by side. Unit tests
  for `scoreCluster` covering: pure-RSS cluster, tier-1 authority, missing `publishedAt`, and
  `semanticRelevance: null` renormalization.
- **Phase 1:** force each of the 6 reason branches (mock sources empty / low-scoring /
  duplicate) and assert the reason string and its numeric payload.
- **Phase 2/3:** the end-to-end check that matters — run with all `ENABLE_*` source flags false,
  confirm a pool item is materialized **and that planning-worker actually picks it up and
  produces a blog**. The previous plan's QA step stopped at "dispatched," which is exactly where
  defect A hides.
- **Regression guard:** assert `Trend.manuallyApproved === true` for every non-`LIVE_FETCH`
  tier at creation.

---

## 9. Summary

The system was never short of topics. It fetched ~200 signals per run and then scored 9 of its
12 sources at a structural maximum of ~30 against a floor of 70. The fallback that was supposed
to catch this re-applied the gate that failed. The dashboard reported the whole thing as a
normal, quiet success.

Fix the scorer, make the failures honest, then add the safety net.
