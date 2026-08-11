# Research Worker — Flow Documentation

The research worker is **Stage 1** of the auto-blog pipeline. It discovers trending
developer topics from multiple sources, filters them through dedupe / novelty /
quality gates, scores them transparently, persists the winners as `Trend` rows,
and dispatches the best ones to the planning queue.

```
Sources → Normalize → Dedupe → Semantic Enrich → Score → [Engine stages] → Select → Persist → Dispatch
```

There are **two execution paths**, switched by the `RESEARCH_ENGINE_ENABLED` env flag:

| Path | Flag | Description |
|------|------|-------------|
| **Legacy pipeline** | `RESEARCH_ENGINE_ENABLED=false` (default) | The original 5-stage funnel: fetch → normalize → dedupe → semantic → score → promote. |
| **Research engine** | `RESEARCH_ENGINE_ENABLED=true` | The novelty-driven engine (`pipeline/engine.ts`) — reuses the legacy stages, then adds topic memory, query expansion, SERP evidence research, topic quality, a 9-dimension final score, and a gated selection algorithm. See `docs/RESEARCH_ENGINE_UPGRADE.md`. |

Both paths share the same audit wrapper (`startWorkerAttempt` / `passWorkerAttempt` /
`failWorkerAttempt` from `workers/shared/recovery.ts`), so every run is recorded in
`WorkflowRun` + `WorkerAttempt` regardless of which path executed.

---

## Entry Points & Scheduling

**File:** `workers/research-worker/index.ts`

- **BullMQ worker** listening on the `research` queue (`startResearchWorker()`).
- **Three cron slots per day** (registered via BullMQ Job Schedulers, in `env.TIMEZONE`):
  - `research-overnight` — `RESEARCH_CRON_OVERNIGHT` ("overnight sweep")
  - `research-midday` — `RESEARCH_CRON_MIDDAY`
  - `research-us-daytime` — `RESEARCH_CRON_US_DAYTIME`
- **Daily-target reconcile job** (`reconcile-daily-target`, `RECONCILE_CRON`) reuses the
  same queue; the job router dispatches on `job.name`.
- Stale schedulers (renamed/removed slots) are pruned on boot.
- **Manual trigger:** `npm run worker:research:once` (via `trigger-once.ts`), or
  `POST /api/research/run`.
- **Smoke test:** `workers/research-worker/smoke-test.ts`.

---

## Discovery Sources

**File:** `sources/index.ts` — each source is toggled by an `ENABLE_*` env flag
(see `config.ts`). All sources are fetched in parallel with `Promise.allSettled`;
a single failing source never fails the run (but **all** sources failing does throw
and burns the retry budget).

| Source | Name | Type |
|--------|------|------|
| Google Trends | `google_trends` | Trending searches (geo via `GOOGLE_TRENDS_GEO`) |
| Google News | `google_news` | News coverage (query/language/country configurable) |
| GitHub Trending | `github_trending` | Repository momentum (stars/engagement) |
| Hacker News | `hackernews` | Firebase API (score + comment count) |
| TechCrunch | `techcrunch` | RSS (AI + Startups feeds) |
| The Verge | `the_verge` | RSS (AI feed) |
| Google AI Blog | `google_ai_blog` | RSS |
| OpenAI News | `openai_news` | RSS |
| Anthropic News | `anthropic_news` | RSS |
| Microsoft AI Blog | `microsoft_ai_blog` | RSS |
| NVIDIA Blog | `nvidia_blog` | RSS |
| SearXNG | `searxng` | Web search discovery — **additive**, only when both `SEARXNG_ENABLED` and `ENABLE_SEARXNG` are on |

---

## Legacy Pipeline Flow (default)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. FETCH     Promise.allSettled over enabled sources            │
│              → RawSignal[] (failures collected, not fatal)      │
├─────────────────────────────────────────────────────────────────┤
│ 2. NORMALIZE pipeline/normalize.ts                              │
│              normalizeText → keywords → category → slug →       │
│              fingerprint(normalizedTitle + top keywords + url)  │
├─────────────────────────────────────────────────────────────────┤
│ 3. DEDUPE    pipeline/dedupe.ts (heuristic clustering)          │
│              Cluster signals that overlap by: same URL, same    │
│              fingerprint, title similarity ≥ 0.55, or ≥ 3       │
│              shared keywords                                    │
├─────────────────────────────────────────────────────────────────┤
│ 4. SEMANTIC  pipeline/semantic.ts (Vertex AI, batched)          │
│              One batched Gemini call per semanticBatchSize      │
│              clusters: relevance 0-100 + cross-cluster          │
│              duplicate detection (union-find merge).            │
│              Fail-soft: failed batches → semanticRelevance = 0  │
├─────────────────────────────────────────────────────────────────┤
│ 5. SCORE     pipeline/score.ts (preliminary 5-dimension score)  │
│              trendDemand · newsFreshness · githubMomentum ·     │
│              multiSourceValidation · semanticRelevance          │
│              final = strongest*0.55 + avg*0.15 +                │
│                      multiSource*0.10 + semantic*0.20           │
├─────────────────────────────────────────────────────────────────┤
│ 6. PROMOTE   pipeline/promote.ts                                │
│              Keep candidates with score ≥ RESEARCH_MIN_SCORE_   │
│              TO_PROMOTE                                         │
├─────────────────────────────────────────────────────────────────┤
│ 7. PERSIST   For each promotable candidate:                     │
│              - Skip if same topic saved today                   │
│              - Skip if similar topic within                     │
│                RESEARCH_RECENT_DUPLICATE_DAYS                   │
│              - Optionally fetch full-text evidence articles     │
│                (EVIDENCE_FETCH_ENABLED, pipeline/evidence.ts)   │
│              - INSERT Trend (status=NEW, scoreBreakdown,        │
│                evidenceSummary, evidenceArticles)               │
├─────────────────────────────────────────────────────────────────┤
│ 8. DISPATCH  Top N saved trends with score ≥                    │
│              RESEARCH_MIN_SCORE_TO_WRITE (max                   │
│              TRENDS_TO_WRITE_PER_RUN)                           │
│              → planningQueue.add("plan_blog", {...})            │
│              → Trend.status = PLANNED                           │
└─────────────────────────────────────────────────────────────────┘
```

**Empty-run handling:** finding nothing new is a *normal* outcome (not an error) —
the run passes with `nextStage: "stopped"` and a reason like
`no_new_topic_above_write_threshold`. Only a genuine fault (every source down) throws.

---

## Research Engine Flow (`RESEARCH_ENGINE_ENABLED=true`)

**File:** `pipeline/engine.ts` — orchestrates the shared stages, then adds the
upgraded phases on top. Hard guarantees: SearXNG failure never fails the run,
scores are never inflated to hit a target, every AI/embedding call records
`AIUsage`, and every new branch fails soft.

```
raw → normalize → dedupe → semantic → preliminary score   (shared legacy stages)
  │
  ├─ 1. CANDIDATE POOL (Phase 4)
  │     score ≥ 30 (PRELIMINARY_POOL_FLOOR), capped at
  │     RESEARCH_CANDIDATE_POOL_SIZE — deliberately wider than the final N
  │
  ├─ 2. TOPIC MEMORY + EMBEDDINGS (Phase 5)   pipeline/novelty.ts
  │     Load recent Trends + published Blogs (RESEARCH_NOVELTY_LOOKBACK_DAYS,
  │     capped by RESEARCH_NOVELTY_MAX_HISTORY). Compute per-candidate
  │     topicFingerprint, canonicalUrl, and (if RESEARCH_EMBEDDING_ENABLED)
  │     a topic embedding via workers/shared/embeddings.ts
  │
  ├─ 3. QUERY EXPANSION (Phase 3)             pipeline/query-expansion.ts
  │     Deterministic intent-tagged templates first (DISCOVERY, OFFICIAL,
  │     DOCUMENTATION, GITHUB, TECHNICAL, BENCHMARK, COMMUNITY,
  │     ALTERNATIVE); optional batched LLM extras when
  │     RESEARCH_LLM_QUERY_EXPANSION_ENABLED
  │
  ├─ 4. LLM TOPIC QUALITY (Phase 7, optional) pipeline/topic-quality.ts
  │     One batched Vertex call scoring "is this a good developer article?"
  │     when RESEARCH_LLM_TOPIC_QUALITY_ENABLED
  │
  ├─ 5. PER-CANDIDATE ENRICHMENT (loop over the pool)
  │     │
  │     ├─ a. EVIDENCE PROFILE (Phases 8-10)  pipeline/evidence-research.ts
  │     │     If SEARXNG_ENABLED and budget remains: search the expanded
  │     │     queries via the budgeted SearXNG client, merge SERP results
  │     │     with first-party signals (deduped by canonical URL), tier
  │     │     every source (pipeline/source-tiers.ts: tier1 official/docs,
  │     │     tier2 reputable media, tier3 forums/listicles).
  │     │     Else: buildOfflineEvidenceProfile (signals only, neutral-low
  │     │     content opportunity — never manufactures demand).
  │     │     Derives:
  │     │       • Evidence Quality = completeness·0.2 + authority·0.3 +
  │     │         diversity·0.2 + freshness·0.1 + relevance·0.2
  │     │         (counts INDEPENDENT DOMAINS, not raw links — five
  │     │         re-posts of one announcement ≠ five validations)
  │     │       • Content Opportunity = demand·0.5 + gap·0.45 ±
  │     │         authoritativeBonus (bell-shaped demand curve; gap from
  │     │         domain concentration + shallow-content ratio)
  │     │
  │     ├─ b. TOPIC QUALITY (Phase 7)
  │     │     Heuristic sub-scores (specificity, technicalDepth,
  │     │     informationRichness, developerRelevance, explainerPotential,
  │     │     evergreenValue, practicalUsefulness) blended 50/50 with the
  │     │     optional LLM score. Penalizes vague/listicle framing
  │     │     ("AI is changing software development") and pure
  │     │     financial/legal news.
  │     │
  │     ├─ c. NOVELTY VERDICT (Phases 5-6)    pipeline/novelty.ts
  │     │     Compare against topic memory across 7 layers, cheapest to
  │     │     most semantic:
  │     │       1. exact normalized title   5. embedding cosine
  │     │       2. canonical URL            6. entity overlap
  │     │       3. topic fingerprint        7. published-blog similarity
  │     │       4. keyword Jaccard
  │     │     Freshness windows decide reject / penalize / allow:
  │     │       • same-day & sim ≥ 0.85            → reject (score 5)
  │     │       • ≤ FRESHNESS_VERY_SIMILAR_DAYS    → reject (score 10)
  │     │       • ≤ FRESHNESS_HIGHLY_SIMILAR_DAYS  → reject (score 20)
  │     │       • ≤ FRESHNESS_SIMILAR_DAYS         → penalize
  │     │       • older/weaker                     → allow (55-95)
  │     │     Escape hatch: a materially NEW development (deterministic
  │     │     signal, or one optional LLM confirmation when
  │     │     RESEARCH_LLM_NOVELTY_ENABLED) survives a match at score 75.
  │     │
  │     ├─ d. FINAL SCORE (Phase 11)          pipeline/final-score.ts
  │     │     Transparent weighted sum of nine 0-100 dimensions —
  │     │     fixed weights, no normalization-to-90, no fudging:
  │     │       trendDemand 15% · freshness 10% · searchDemand 10% ·
  │     │       githubMomentum 5% · sourceDiversity 10% ·
  │     │       evidenceQuality 15% · topicQuality 15% ·
  │     │       novelty 10% · audienceValue 10%
  │     │
  │     └─ e. FAMILY + EXPLORATORY FLAGS      pipeline/selection.ts
  │           classifyFamily: Security, Databases, DevOps, Cloud, Frontend,
  │           Backend, Programming Languages, Frameworks, AI,
  │           Developer Tools, Open Source, Infrastructure, General.
  │           isExploratory: high novelty + non-mainstream + concrete
  │           early signal (GitHub momentum or a primary source).
  │
  ├─ 6. SELECTION (Phases 12-16)              pipeline/selection.ts
  │     Honest tiers over the final score:
  │       excellent ≥ RESEARCH_TIER_EXCELLENT_SCORE
  │       strong    ≥ RESEARCH_TIER_STRONG_SCORE
  │       weak      ≥ RESEARCH_MIN_SCORE_TO_PROMOTE
  │       reject    below that
  │     Hard gates (all must pass to be dispatch-eligible):
  │       novelty.decision ≠ reject · final ≥ RESEARCH_DISPATCH_MIN_SCORE ·
  │       evidenceQuality ≥ RESEARCH_MIN_EVIDENCE_SCORE ·
  │       noveltyScore ≥ RESEARCH_MIN_NOVELTY_SCORE
  │     Then: sort (score → novelty → evidence) → reserve
  │     RESEARCH_EXPLORATION_RATIO of slots for exploratory topics →
  │     per-family cap RESEARCH_MAX_PER_FAMILY → fill the dispatch target
  │     (TRENDS_TO_WRITE_PER_RUN). Unfilled slots stay EMPTY and are
  │     reported (outcome: ok | insufficient_qualified | no_new_topics) —
  │     never back-filled with weak topics.
  │
  ├─ 7. RUN REPORT (Phase 17)                 pipeline/report.ts
  │     Structured ResearchRunReport: funnel counts (raw → normalized →
  │     clusters → pool), duplicates removed (exact / semantic /
  │     historical / freshness), SERP stats, rejection buckets, family
  │     mix, exploration count, outcome + reason. Persisted and logged.
  │
  └─ 8. PERSIST + DISPATCH
        SAVE: all novel candidates at strong tier or above
        (final ≥ RESEARCH_TIER_STRONG_SCORE, novelty ≠ reject) become
        Trend rows — the dispatchable backlog — with canonicalUrl,
        topicFingerprint, topicEmbedding, researchDetail (the full
        9-dimension breakdown + sources + queries), scoreBreakdown
        (legacy 5-dim, keeps dashboard signal bars working),
        evidenceSummary, and optional evidenceArticles.
        Same-run fingerprint dupes and same-day DB dupes are skipped.
        DISPATCH: selected (excellent-tier, gate-passing) saved trends →
        planningQueue.add("plan_blog", { trendId, topic, category,
        score, evidenceSummary }) → Trend.status = PLANNED.
```

---

## Scoring Summary

### Preliminary score (both paths) — `pipeline/score.ts`

| Dimension | Derivation |
|-----------|-----------|
| `trendDemand` | `log10(best trend volume + 1) * 20` |
| `newsFreshness` | Age of freshest Google News signal (≤24h→100, ≤72h→80, ≤7d→55, else 20) |
| `githubMomentum` | `log10(best GitHub engagement + 1) * 18` |
| `multiSourceValidation` | `distinctSources / 3 * 100` |
| `semanticRelevance` | Batched Vertex relevance score (0 when disabled/failed) |

`score = strongestSource*0.55 + avgSource*0.15 + multiSource*0.10 + semantic*0.20`
(priority: ≥85 high, ≥70 medium, else low)

### Final score (engine only) — `pipeline/final-score.ts`

Nine dimensions, fixed weights, fully explainable — persisted on
`Trend.researchDetail` and surfaced in the dashboard trend-detail modal:

```
final = trendDemand·15% + freshness·10% + searchDemand·10% + githubMomentum·5%
      + sourceDiversity·10% + evidenceQuality·15% + topicQuality·15%
      + novelty·10% + audienceValue·10%
```

---

## Outputs & Side Effects

| Effect | Detail |
|--------|--------|
| `Trend` rows | status `NEW` (backlog) → `PLANNED` (dispatched); includes `score`, `scoreBreakdown`, `evidenceSummary`, optional `evidenceArticles`, and (engine) `canonicalUrl`, `topicFingerprint`, `topicEmbedding`, `researchDetail` |
| Queue dispatch | `planningQueue.add("plan_blog", …)` per selected trend |
| Audit | `WorkflowRun` + `WorkerAttempt` via `startWorkerAttempt` / `passWorkerAttempt` / `failWorkerAttempt`; `nextStage` = `planning-worker` or `stopped` |
| Cost tracking | `AIUsage` rows for every Vertex/embedding call (semantic scoring, LLM query expansion, LLM topic quality, LLM novelty confirmation) |
| Run report | Engine path persists a structured `ResearchRunReport` (`pipeline/report.ts`) |

---

## Key Configuration (env)

**Shared / legacy**
- `RESEARCH_MIN_SCORE_TO_PROMOTE` — floor for persisting candidates
- `RESEARCH_MIN_SCORE_TO_WRITE` — floor for dispatching to planning
- `TRENDS_TO_WRITE_PER_RUN` — dispatch target per run
- `RESEARCH_RECENT_DUPLICATE_DAYS` — recent-duplicate window (legacy)
- `RESEARCH_SEMANTIC_ENABLED`, `RESEARCH_SEMANTIC_BATCH_SIZE`, `RESEARCH_SEMANTIC_TIMEOUT_MS`
- `EVIDENCE_FETCH_ENABLED` — full-text evidence article ingestion
- `ENABLE_<SOURCE>` — per-source toggles

**Engine**
- `RESEARCH_ENGINE_ENABLED` — master switch for the engine path
- `RESEARCH_CANDIDATE_POOL_SIZE`, `RESEARCH_MAX_QUERIES_PER_CANDIDATE`
- `RESEARCH_EMBEDDING_ENABLED`, `RESEARCH_LLM_QUERY_EXPANSION_ENABLED`,
  `RESEARCH_LLM_TOPIC_QUALITY_ENABLED`, `RESEARCH_LLM_NOVELTY_ENABLED`
- `RESEARCH_NOVELTY_LOOKBACK_DAYS`, `RESEARCH_NOVELTY_MAX_HISTORY`,
  `RESEARCH_SEMANTIC_SIMILARITY_THRESHOLD`, `RESEARCH_KEYWORD_SIMILARITY_THRESHOLD`
- `RESEARCH_FRESHNESS_VERY_SIMILAR_DAYS`, `RESEARCH_FRESHNESS_HIGHLY_SIMILAR_DAYS`,
  `RESEARCH_FRESHNESS_SIMILAR_DAYS`
- `RESEARCH_TIER_EXCELLENT_SCORE`, `RESEARCH_TIER_STRONG_SCORE`,
  `RESEARCH_DISPATCH_MIN_SCORE`, `RESEARCH_MIN_EVIDENCE_SCORE`,
  `RESEARCH_MIN_NOVELTY_SCORE`, `RESEARCH_MAX_PER_FAMILY`,
  `RESEARCH_EXPLORATION_RATIO`

**SearXNG** (additive; never fatal on failure)
- `SEARXNG_ENABLED` + `ENABLE_SEARXNG` (both required), `SEARXNG_BASE_URL`,
  `SEARXNG_MAX_QUERIES` (run-wide budget), `SEARXNG_RESULTS_PER_QUERY`,
  `SEARXNG_TIMEOUT_MS`, `SEARXNG_LANGUAGE`, `SEARXNG_CATEGORIES`,
  `SEARXNG_ENGINES`, `SEARXNG_SAFESEARCH`, `SEARXNG_TIME_RANGE`,
  `SEARXNG_DISCOVERY_QUERIES`

---

## File Map

```
workers/research-worker/
├── index.ts                    # Worker entry, scheduling, legacy orchestration
├── config.ts                   # researchConfig: sources, searxng, engine settings
├── types.ts                    # RawSignal, ResearchCandidate, EngineCandidate, …
├── trigger-once.ts             # Manual one-shot run
├── smoke-test.ts               # Smoke test
├── pipeline/
│   ├── normalize.ts            # Text normalization, keywords, category, fingerprint
│   ├── dedupe.ts               # Heuristic signal clustering
│   ├── semantic.ts             # Batched Vertex relevance + semantic dedupe
│   ├── score.ts                # Preliminary 5-dimension score
│   ├── promote.ts              # minScoreToPromote filter (legacy)
│   ├── evidence.ts             # Full-text evidence article fetching
│   ├── engine.ts               # Research-engine orchestrator
│   ├── query-expansion.ts      # Intent-tagged query templates + LLM extras
│   ├── novelty.ts              # Topic memory, 7-layer novelty verdict
│   ├── topic-quality.ts        # Heuristic + LLM topic quality
│   ├── evidence-research.ts    # SERP merge, source tiering, evidence quality,
│   │                           #   content opportunity
│   ├── source-tiers.ts         # URL → authority tier (1/2/3)
│   ├── final-score.ts          # Transparent 9-dimension final score
│   ├── selection.ts            # Tiers, gates, diversity, exploration, selection
│   └── report.ts               # Structured run report
├── searxng/
│   ├── client.ts               # Budgeted, fail-soft SearXNG client
│   ├── serp.ts                 # Per-candidate SERP research
│   ├── source.ts               # SearXNG as a discovery source
│   └── index.ts
├── sources/                    # One module per discovery source
└── utils/                      # text, fingerprint, similarity, fetch-with-retry
```
