import {
  EvidenceProfile,
  FinalScoreBreakdown,
  NoveltyVerdict,
  ResearchCandidate,
  TopicQuality,
} from "../types";

/**
 * Transparent final score (docs/RESEARCH_ENGINE_UPGRADE.md Phase 11).
 *
 * Every selected topic's score is a weighted sum of nine explainable
 * dimensions, each 0-100, weighted to a /100 total. The weights are the ones
 * from the brief and are FIXED - there is no normalization-to-90, no bonus
 * points, and no per-candidate fudging (Phase 12). A topic with strong trend
 * signal but weak evidence CANNOT reach 90, because evidence quality (15) and
 * topic quality (15) are gated on real data, not hype.
 *
 *   Trend Demand 15 · Freshness 10 · Search Demand 10 · GitHub Momentum 5 ·
 *   Source Diversity 10 · Evidence Quality 15 · Topic Quality 15 · Novelty 10 ·
 *   Audience/Developer Value 10.
 *
 * The pre-existing scoreBreakdown dimensions (trendDemand / newsFreshness /
 * githubMomentum / multiSourceValidation / semanticRelevance) are reused here
 * rather than replaced, so the dashboard's signal bars keep working and the
 * migration path is "add the new dimensions alongside", not "swap scoring".
 */
const WEIGHTS = {
  trendDemand: 0.15,
  freshness: 0.1,
  searchDemand: 0.1,
  githubMomentum: 0.05,
  sourceDiversity: 0.1,
  evidenceQuality: 0.15,
  topicQuality: 0.15,
  novelty: 0.1,
  audienceValue: 0.1,
} as const;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function computeFinalScore(input: {
  candidate: ResearchCandidate;
  evidenceProfile: EvidenceProfile;
  topicQuality: TopicQuality;
  novelty: NoveltyVerdict;
}): FinalScoreBreakdown {
  const { candidate, evidenceProfile, topicQuality, novelty } = input;
  const breakdown = candidate.scoreBreakdown;

  // Freshness blends the news-recency signal with how fresh the gathered
  // evidence actually is.
  const freshness = clamp(breakdown.newsFreshness * 0.6 + evidenceProfile.freshSourceRatio * 100 * 0.4);
  // Search demand comes from the SERP landscape (content opportunity already
  // folds in demand + gap). Offline (no SERP) it stays neutral - it is never
  // back-filled from trend volume, which would double-count trendDemand.
  const searchDemand = clamp(evidenceProfile.contentOpportunity.opportunity);
  // Source diversity blends multi-source validation with evidence domain spread.
  const sourceDiversity = clamp(
    breakdown.multiSourceValidation * 0.5 + evidenceProfile.evidenceQuality.diversity * 0.5
  );
  // Audience/developer value derives from the topic-quality sub-scores.
  const audienceValue = clamp((topicQuality.developerRelevance + topicQuality.practicalUsefulness) / 2);

  const dimensions = {
    trendDemand: clamp(breakdown.trendDemand),
    freshness,
    searchDemand,
    githubMomentum: clamp(breakdown.githubMomentum),
    sourceDiversity,
    evidenceQuality: clamp(evidenceProfile.evidenceQuality.total),
    topicQuality: clamp(topicQuality.total),
    novelty: clamp(novelty.noveltyScore),
    audienceValue,
  };

  const final =
    Math.round(
      (dimensions.trendDemand * WEIGHTS.trendDemand +
        dimensions.freshness * WEIGHTS.freshness +
        dimensions.searchDemand * WEIGHTS.searchDemand +
        dimensions.githubMomentum * WEIGHTS.githubMomentum +
        dimensions.sourceDiversity * WEIGHTS.sourceDiversity +
        dimensions.evidenceQuality * WEIGHTS.evidenceQuality +
        dimensions.topicQuality * WEIGHTS.topicQuality +
        dimensions.novelty * WEIGHTS.novelty +
        dimensions.audienceValue * WEIGHTS.audienceValue) * 10
    ) / 10;

  return { ...dimensions, final };
}
