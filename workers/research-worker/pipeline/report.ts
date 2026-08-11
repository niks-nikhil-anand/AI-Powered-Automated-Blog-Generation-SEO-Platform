import { prisma } from "../../shared/prisma";
import { logger } from "../../shared/logger";
import { EngineCandidate, ResearchRunReport } from "../types";
import { SelectionResult } from "./selection";

const log = logger.child({ worker: "research-worker", stage: "report" });

/**
 * Structured research-run report (docs/RESEARCH_ENGINE_UPGRADE.md Phase 17).
 * Every engine run emits a metrics object capturing the raw->selected funnel,
 * the per-bucket rejection counts, SERP usage, score/novelty/evidence averages
 * and the topic-family mix, plus an explicit outcome + reason when the dispatch
 * target wasn't met. Persisted to the ResearchRun table so "why did we only
 * get N topics today" is answerable from data, and so the similarity/score
 * thresholds can be calibrated against real runs instead of guessed.
 */

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

export type RunReportInput = {
  startedAt: number;
  rawCandidates: number;
  normalized: number;
  semanticClusters: number;
  poolSize: number;
  exactDuplicatesRemoved: number;
  semanticDuplicatesRemoved: number;
  historicalDuplicatesRemoved: number;
  freshnessRejected: number;
  serpQueries: number;
  serpResults: number;
  uniqueDomains: number;
  failedSources: string[];
  dispatchTarget: number;
  allCandidates: EngineCandidate[];
  selection: SelectionResult;
};

export function buildRunReport(input: RunReportInput): ResearchRunReport {
  const { allCandidates, selection } = input;
  const finishedAt = Date.now();

  const gte80 = allCandidates.filter((c) => c.finalScore.final >= 80).length;
  const gte90 = allCandidates.filter((c) => c.finalScore.final >= 90).length;

  const outcomeMap: Record<SelectionResult["outcome"], ResearchRunReport["outcome"]> = {
    ok: "ok",
    insufficient_qualified: "insufficient_qualified",
    no_new_topics: "no_new_topics",
  };

  return {
    startedAt: new Date(input.startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - input.startedAt,
    engine: true,
    rawCandidates: input.rawCandidates,
    normalized: input.normalized,
    semanticClusters: input.semanticClusters,
    poolSize: input.poolSize,
    exactDuplicatesRemoved: input.exactDuplicatesRemoved,
    semanticDuplicatesRemoved: input.semanticDuplicatesRemoved,
    historicalDuplicatesRemoved: input.historicalDuplicatesRemoved,
    freshnessRejected: input.freshnessRejected,
    lowQualityRejected: selection.rejectedForScore,
    insufficientEvidenceRejected: selection.rejectedForEvidence,
    lowNoveltyRejected: selection.rejectedForNovelty,
    serpQueries: input.serpQueries,
    serpResults: input.serpResults,
    uniqueDomains: input.uniqueDomains,
    candidatesGte80: gte80,
    candidatesGte90: gte90,
    selectedCount: selection.selected.length,
    avgFinalScore: average(selection.selected.map((c) => c.finalScore.final)),
    avgNovelty: average(selection.selected.map((c) => c.novelty.noveltyScore)),
    avgEvidenceQuality: average(selection.selected.map((c) => c.evidenceProfile.evidenceQuality.total)),
    topicFamilies: selection.familyMix,
    explorationCount: selection.explorationCount,
    dispatchTarget: input.dispatchTarget,
    dispatched: selection.selected.length,
    outcome: outcomeMap[selection.outcome],
    outcomeReason: selection.outcomeReason,
    failedSources: input.failedSources,
  };
}

/**
 * Persist the report to ResearchRun. Best-effort - reporting must never fail a
 * research run, so any DB error is logged and swallowed.
 */
export async function persistRunReport(report: ResearchRunReport, workflowRunId?: string): Promise<void> {
  try {
    await prisma.researchRun.create({
      data: {
        workflowRunId: workflowRunId ?? null,
        metrics: JSON.parse(JSON.stringify(report)),
        selectedCount: report.selectedCount,
        bestScore: report.selectedCount > 0 ? report.avgFinalScore : 0,
        outcome: report.outcome,
      },
    });
  } catch (error) {
    log.warn("Failed to persist research run report", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Human-readable summary for the run log (mirrors the brief's example). */
export function formatRunReport(report: ResearchRunReport): string {
  const lines = [
    `Research run report (${report.durationMs}ms, outcome: ${report.outcome})`,
    `  raw candidates: ${report.rawCandidates} | normalized: ${report.normalized} | clusters: ${report.semanticClusters} | pool: ${report.poolSize}`,
    `  removed - exact:${report.exactDuplicatesRemoved} semantic:${report.semanticDuplicatesRemoved} historical:${report.historicalDuplicatesRemoved} freshness:${report.freshnessRejected}`,
    `  rejected - lowQuality:${report.lowQualityRejected} insufficientEvidence:${report.insufficientEvidenceRejected} lowNovelty:${report.lowNoveltyRejected}`,
    `  serp - queries:${report.serpQueries} results:${report.serpResults} uniqueDomains:${report.uniqueDomains}`,
    `  candidates >=80:${report.candidatesGte80} >=90:${report.candidatesGte90} | selected:${report.selectedCount}/${report.dispatchTarget}`,
    `  avg - final:${report.avgFinalScore} novelty:${report.avgNovelty} evidence:${report.avgEvidenceQuality} | exploration:${report.explorationCount}`,
    `  families: ${Object.entries(report.topicFamilies).map(([f, n]) => `${f}:${n}`).join(", ") || "none"}`,
    `  reason: ${report.outcomeReason}`,
  ];
  return lines.join("\n");
}
