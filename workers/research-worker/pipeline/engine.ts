import { planningQueue, QUEUE_NAMES } from "../../shared/queues";
import { prisma } from "../../shared/prisma";
import { logger } from "../../shared/logger";
import { env } from "../../shared/env";
import { embedMany } from "../../shared/embeddings";
import { researchConfig } from "../config";
import { getEnabledSources } from "../sources";
import { normalizeSignals } from "./normalize";
import { dedupeSignals } from "./dedupe";
import { semanticEnrich } from "./semantic";
import { scoreClusters } from "./score";
import { fetchEvidenceArticles } from "./evidence";
import { expandQueriesForCandidates } from "./query-expansion";
import { assessNovelty, loadTopicMemory } from "./novelty";
import { heuristicTopicQuality, llmTopicQuality, blendTopicQuality } from "./topic-quality";
import { buildEvidenceProfile, buildOfflineEvidenceProfile } from "./evidence-research";
import { computeFinalScore } from "./final-score";
import { classifyFamily, isExploratory, selectFinalCandidates, tierForScore } from "./selection";
import { buildRunReport, formatRunReport, persistRunReport } from "./report";
import { createSearxngClient, fetchSearxngDiscoverySignals } from "../searxng";
import { canonicalizeUrl, topicFingerprint } from "../utils/similarity";
import {
  EngineCandidate,
  RawSignal,
  ResearchCandidate,
  ResearchDetail,
  ResearchRunReport,
} from "../types";

const log = logger.child({ worker: "research-worker", stage: "engine" });

/**
 * The novelty-driven research engine (docs/RESEARCH_ENGINE_UPGRADE.md).
 *
 * This ORCHESTRATES the pipeline; it does not replace the existing stages -
 * discovery, normalize, heuristic dedupe, semantic enrich and preliminary
 * scoring are the very same modules the legacy path uses. On top of those it
 * adds, in order:
 *
 *   raw -> normalize -> dedupe -> semantic -> preliminary score
 *     -> TOP candidate POOL (Phase 4 - far wider than the final N)
 *     -> topic memory + embeddings (Phase 5)
 *     -> query expansion (Phase 3)
 *     -> SERP/evidence research + evidence quality + content gap (Phases 8-10)
 *     -> topic quality (Phase 7) + novelty verdict + freshness windows (5-6)
 *     -> transparent final score (Phase 11)
 *     -> tier + diversity + exploration selection (Phases 12-16)
 *     -> structured run report (Phase 17)
 *
 * Hard guarantees enforced here:
 *  - SearXNG is additive and its failure never fails the run (shared budgeted
 *    client; budget exhaustion degrades to the offline evidence profile).
 *  - Scores are never inflated to reach 90 (Phase 12) - an under-filled target
 *    is reported via the run outcome, not papered over.
 *  - Every AI/embedding call records AIUsage; every new branch fails soft.
 */

/** Minimal preliminary floor to keep pure-noise clusters out of the SERP pool. */
const PRELIMINARY_POOL_FLOOR = 30;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Human-readable evidence summary persisted on Trend + sent to planning. */
function buildEvidenceSummary(candidate: EngineCandidate): string {
  const c = candidate.candidate;
  const evidenceLines = candidate.evidenceProfile.sources
    .slice(0, 6)
    .map((s) => `- [tier${s.tier}] ${s.domain}: ${s.title} (${s.url})`)
    .join("\n");
  const f = candidate.finalScore;
  return [
    c.reason,
    `Final score: ${f.final} (tier ${candidate.tier}, family ${candidate.family}${candidate.exploratory ? ", exploratory" : ""})`,
    `Dimensions: trend ${f.trendDemand} | fresh ${f.freshness} | search ${f.searchDemand} | github ${f.githubMomentum} | diversity ${f.sourceDiversity} | evidence ${f.evidenceQuality} | topicQuality ${f.topicQuality} | novelty ${f.novelty} | audience ${f.audienceValue}`,
    `Novelty: ${candidate.novelty.reason}`,
    `Keywords: ${c.keywords.join(", ")}`,
    `Evidence:\n${evidenceLines}`,
  ].join("\n\n");
}

function toResearchDetail(candidate: EngineCandidate): ResearchDetail {
  return {
    engine: true,
    finalScore: candidate.finalScore,
    tier: candidate.tier,
    family: candidate.family,
    exploratory: candidate.exploratory,
    novelty: candidate.novelty,
    topicQuality: candidate.topicQuality,
    evidenceQuality: candidate.evidenceProfile.evidenceQuality,
    contentOpportunity: candidate.evidenceProfile.contentOpportunity,
    queries: candidate.queries,
    sources: candidate.evidenceProfile.sources.slice(0, 8).map((s) => ({
      url: s.url,
      title: s.title,
      domain: s.domain,
      tier: s.tier,
    })),
  };
}

export type EngineRunOutput = {
  engine: true;
  report: ResearchRunReport;
  savedCount: number;
  dispatchedCount: number;
  failedSources: string[];
};

export async function runResearchEngine(workflowRunId?: string): Promise<EngineRunOutput> {
  const startedAt = Date.now();
  const searxng = createSearxngClient();
  const searxngDiscoveryEnabled = researchConfig.enabledSources.includes("searxng");

  // --- 1. Discovery (existing sources + additive SearXNG discovery) --------
  const genericSources = getEnabledSources().filter((s) => s.name !== "searxng");
  const failedSources: string[] = [];
  const rawSignals: RawSignal[] = [];

  const sourceResults = await Promise.allSettled(
    genericSources.map(async (source) => ({
      source: source.name,
      signals: await (source.fetchSignals?.() ?? source.fetch?.() ?? []),
    }))
  );
  for (const result of sourceResults) {
    if (result.status === "fulfilled") {
      rawSignals.push(...result.value.signals);
    } else {
      failedSources.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }
  if (searxngDiscoveryEnabled) {
    try {
      rawSignals.push(...(await fetchSearxngDiscoverySignals(searxng)));
    } catch (error) {
      failedSources.push(error instanceof Error ? error.message : String(error));
    }
  }

  // A genuine fault (every discovery source down) still burns the retry budget;
  // finding nothing new is a normal outcome, not an error.
  const totalSources = genericSources.length + (searxngDiscoveryEnabled ? 1 : 0);
  if (totalSources > 0 && failedSources.length === totalSources) {
    throw new Error(`All ${totalSources} research sources failed: ${failedSources.join("; ")}`);
  }

  // --- 2. Shared normalization / dedupe / scoring (unchanged stages) -------
  const normalized = normalizeSignals(rawSignals);
  const clusters = dedupeSignals(normalized);
  const enriched = await semanticEnrich(clusters);
  const scored = scoreClusters(enriched);

  // --- 3. Candidate POOL (Phase 4) - wider than the final dispatch set -----
  const pool = scored
    .filter((c) => c.score >= PRELIMINARY_POOL_FLOOR)
    .slice(0, env.RESEARCH_CANDIDATE_POOL_SIZE);

  // --- 4. Topic memory + embeddings (Phase 5) ------------------------------
  const memory = await loadTopicMemory();
  const fingerprints = pool.map((c) => topicFingerprint(c.title, c.evidence[0]?.description));
  const canonicalUrls = pool.map((c) => canonicalizeUrl(bestUrl(c)));
  const embeddingInputs = pool.map((c) => `${c.title} ${c.keywords.slice(0, 6).join(" ")}`);
  const embeddings = env.RESEARCH_EMBEDDING_ENABLED ? await embedMany(embeddingInputs) : pool.map(() => null);

  // --- 5. Query expansion (Phase 3) ----------------------------------------
  const expandedQueries = await expandQueriesForCandidates(pool);

  // --- 6. Optional batched LLM topic-quality (Phase 7) ---------------------
  const llmQuality = await llmTopicQuality(pool);

  // --- 7. Enrich each pool candidate ---------------------------------------
  let historicalDuplicatesRemoved = 0;
  let freshnessRejected = 0;
  const engineCandidates: EngineCandidate[] = [];

  for (let i = 0; i < pool.length; i += 1) {
    const candidate = pool[i];
    const embedding = embeddings[i] ?? undefined;

    // Evidence profile (SERP when budget allows, else offline) - Phases 8-10.
    const evidenceProfile =
      env.SEARXNG_ENABLED && searxng.hasBudget
        ? await buildEvidenceProfile(searxng, candidate, expandedQueries[i])
        : buildOfflineEvidenceProfile(candidate);

    // Topic quality (Phase 7) - heuristic + optional LLM blend.
    const topicQuality = blendTopicQuality(heuristicTopicQuality(candidate), llmQuality.get(i) ?? 0);

    // Novelty verdict (Phases 5-6).
    const novelty = await assessNovelty(memory, candidate, {
      canonicalUrl: canonicalUrls[i] || undefined,
      topicFingerprint: fingerprints[i],
      embedding,
    });
    if (novelty.decision === "reject") {
      historicalDuplicatesRemoved += 1;
      if (/today|within/i.test(novelty.reason)) freshnessRejected += 1;
    }

    const finalScore = computeFinalScore({ candidate, evidenceProfile, topicQuality, novelty });
    const family = classifyFamily(candidate);

    const engineCandidate: EngineCandidate = {
      candidate,
      canonicalUrl: canonicalUrls[i] || undefined,
      topicFingerprint: fingerprints[i],
      embedding,
      queries: expandedQueries[i],
      evidenceProfile,
      topicQuality,
      novelty,
      family,
      exploratory: false, // set below once the object exists
      finalScore,
      tier: tierForScore(finalScore.final),
    };
    engineCandidate.exploratory = isExploratory(engineCandidate);
    engineCandidates.push(engineCandidate);
  }

  // --- 8. Selection (Phases 12-16) ------------------------------------------
  const dispatchTarget = Math.max(1, env.TRENDS_TO_WRITE_PER_RUN);
  const selection = selectFinalCandidates(engineCandidates, dispatchTarget);

  // --- 9. Run report (Phase 17) ---------------------------------------------
  const serpStats = searxng.stats;
  const report = buildRunReport({
    startedAt,
    rawCandidates: rawSignals.length,
    normalized: normalized.length,
    semanticClusters: enriched.length,
    poolSize: pool.length,
    exactDuplicatesRemoved: Math.max(0, normalized.length - clusters.length),
    semanticDuplicatesRemoved: Math.max(0, clusters.length - enriched.length),
    historicalDuplicatesRemoved,
    freshnessRejected,
    serpQueries: serpStats.queries,
    serpResults: serpStats.results,
    uniqueDomains: serpStats.uniqueDomains,
    failedSources,
    dispatchTarget,
    allCandidates: engineCandidates,
    selection,
  });

  // --- 10. Persist trends + dispatch ----------------------------------------
  const since = startOfToday();
  const savedFingerprints = new Set<string>();
  const saved: { candidate: EngineCandidate; trendId: string }[] = [];

  // Save the strong-and-up novel candidates (excellent + strong tiers) as the
  // dispatchable backlog. Rejected-duplicate topics are already in history, and
  // weak/reject topics are not worth persisting.
  const savable = engineCandidates.filter(
    (c) => c.finalScore.final >= researchConfig.engine.tierStrongScore && c.novelty.decision !== "reject"
  );

  for (const candidate of savable) {
    if (savedFingerprints.has(candidate.topicFingerprint)) continue;
    // Defense-in-depth against an exact same-day re-save (novelty memory was
    // loaded at run start, before anything this run wrote).
    const alreadySaved = await prisma.trend.findFirst({
      where: {
        createdAt: { gte: since },
        OR: [
          { topic: candidate.candidate.title },
          { topicFingerprint: candidate.topicFingerprint },
          ...(candidate.canonicalUrl ? [{ canonicalUrl: candidate.canonicalUrl }] : []),
        ],
      },
      select: { id: true },
    });
    if (alreadySaved) continue;

    const evidenceArticles = env.EVIDENCE_FETCH_ENABLED
      ? await fetchEvidenceArticles(candidate.candidate)
      : [];
    const evidenceSummary = buildEvidenceSummary(candidate);

    const trend = await prisma.trend.create({
      data: {
        topic: candidate.candidate.title,
        source: candidate.candidate.evidence.map((s) => s.source).join(","),
        category: candidate.candidate.category,
        score: candidate.finalScore.final,
        status: "NEW",
        // Keep the legacy 5-dimension breakdown so the dashboard signal bars
        // keep rendering; the 9-dimension final score lives in researchDetail.
        scoreBreakdown: candidate.candidate.scoreBreakdown,
        evidenceSummary,
        ...(evidenceArticles.length > 0 ? { evidenceArticles } : {}),
        canonicalUrl: candidate.canonicalUrl ?? null,
        topicFingerprint: candidate.topicFingerprint,
        ...(candidate.embedding ? { topicEmbedding: candidate.embedding } : {}),
        researchDetail: JSON.parse(JSON.stringify(toResearchDetail(candidate))),
      },
    });
    savedFingerprints.add(candidate.topicFingerprint);
    saved.push({ candidate, trendId: trend.id });
  }

  // Dispatch the selected topics (excellent tier, gate-passing) to planning.
  const selectedIds = new Set(
    selection.selected.map((c) => c.topicFingerprint)
  );
  let dispatchedCount = 0;
  for (const entry of saved) {
    if (!selectedIds.has(entry.candidate.topicFingerprint)) continue;
    await planningQueue.add("plan_blog", {
      trendId: entry.trendId,
      topic: entry.candidate.candidate.title,
      category: entry.candidate.candidate.category,
      score: entry.candidate.finalScore.final,
      evidenceSummary: buildEvidenceSummary(entry.candidate),
    });
    await prisma.trend.update({ where: { id: entry.trendId }, data: { status: "PLANNED" } });
    dispatchedCount += 1;
  }

  await persistRunReport(report, workflowRunId);
  log.info(formatRunReport(report));
  log.info(
    `Research engine run complete: ${saved.length} saved, ${dispatchedCount} dispatched to ${QUEUE_NAMES.planning} (outcome: ${report.outcome})`
  );

  return { engine: true, report, savedCount: saved.length, dispatchedCount, failedSources };
}

/** Best representative URL for a candidate (first URL-bearing evidence signal). */
function bestUrl(candidate: ResearchCandidate): string | undefined {
  return candidate.evidence.find((s) => s.url)?.url;
}
