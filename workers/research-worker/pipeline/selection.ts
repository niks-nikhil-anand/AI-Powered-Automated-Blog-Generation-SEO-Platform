import { researchConfig } from "../config";
import {
  EngineCandidate,
  ScoreTier,
  TopicFamily,
} from "../types";
import { normalizeText } from "../utils/text";

/**
 * Tiering, diversity, exploration and the final selection algorithm
 * (docs/RESEARCH_ENGINE_UPGRADE.md Phases 12-16).
 *
 * Hard rules honored here:
 *  - Scores are NEVER nudged to reach a threshold. Tiers are honest bands over
 *    the transparent final score (Phase 12).
 *  - Selection is NOT "sort by score desc, take N". It applies quality /
 *    novelty / evidence gates, a per-family diversity cap, and an exploration
 *    quota, then fills the dispatch target with the best genuinely-qualified
 *    NEW topics (Phase 16). Unfilled slots stay empty and are reported, not
 *    back-filled with stale or weak topics (Phase 13).
 */

/** Classify a candidate into a topic family for diversity capping (Phase 14). */
export function classifyFamily(candidate: EngineCandidate["candidate"]): TopicFamily {
  const text = normalizeText(`${candidate.title} ${candidate.keywords.join(" ")} ${candidate.category}`);

  if (/\b(security|vulnerabilit|cve|exploit|malware|ransomware|phishing|zero[- ]?day|breach|encryption|authentication|xss|csrf)\b/.test(text)) return "Security";
  if (/\b(postgres|postgresql|mysql|sqlite|redis|mongodb|database|sql|nosql|vector database|index)\b/.test(text)) return "Databases";
  if (/\b(kubernetes|docker|container|terraform|ci|cd|deploy|devops|helm|ansible|jenkins|github actions)\b/.test(text)) return "DevOps";
  if (/\b(aws|gcp|azure|cloud|serverless|lambda|s3|cloudflare|cdn|edge)\b/.test(text)) return "Cloud";
  if (/\b(react|vue|svelte|angular|css|tailwind|frontend|front[- ]?end|dom|browser|web component|html)\b/.test(text)) return "Frontend";
  if (/\b(node|deno|bun|api|graphql|rest|backend|back[- ]?end|server|microservice|grpc)\b/.test(text)) return "Backend";
  if (/\b(typescript|javascript|python|rust|golang|\bgo\b|java|kotlin|swift|ruby|php|c\+\+|programming language)\b/.test(text)) return "Programming Languages";
  if (/\b(framework|nextjs|next\.js|remix|nuxt|astro|rails|django|laravel|express|fastapi|spring)\b/.test(text)) return "Frameworks";
  if (/\b(ai|llm|gpt|claude|gemini|machine learning|model|agent|neural|inference|transformer|embedding|copilot|rag|fine[- ]?tun)\b/.test(text)) return "AI";
  if (/\b(cli|sdk|ide|editor|vscode|plugin|extension|developer tool|productivity|debugger|linter|formatter|build tool|vite|webpack)\b/.test(text)) return "Developer Tools";
  if (/\b(open source|open[- ]?source|oss|github|self[- ]?host|library|repo)\b/.test(text)) return "Open Source";
  if (/\b(infrastructure|networking|observability|monitoring|logging|tracing|proxy|load balancer)\b/.test(text)) return "Infrastructure";
  return "General";
}

/** Honest quality tier from the final score (Phase 12). */
export function tierForScore(finalScore: number): ScoreTier {
  const cfg = researchConfig.engine;
  if (finalScore >= cfg.tierExcellentScore) return "excellent";
  if (finalScore >= cfg.tierStrongScore) return "strong";
  if (finalScore >= researchConfig.minScoreToPromote) return "weak";
  return "reject";
}

/**
 * Flag exploratory candidates (Phase 15): emerging/niche/early signals rather
 * than obvious high-volume mainstream trends. High novelty + not driven by
 * mainstream trend demand + some concrete signal (GitHub momentum or a primary
 * source). Deterministic so the exploration set is explainable.
 */
export function isExploratory(candidate: EngineCandidate): boolean {
  const b = candidate.candidate.scoreBreakdown;
  const mainstream = b.trendDemand >= 55 || candidate.evidenceProfile.contentOpportunity.resultCount >= 15;
  const earlySignal =
    candidate.candidate.scoreBreakdown.githubMomentum >= 30 || candidate.evidenceProfile.primarySources >= 1;
  return !mainstream && candidate.novelty.noveltyScore >= 75 && earlySignal;
}

/** The hard gates a candidate must clear to be dispatch-eligible (Phase 16). */
function passesGates(candidate: EngineCandidate): { ok: boolean; reason?: string } {
  const cfg = researchConfig.engine;
  if (candidate.novelty.decision === "reject") {
    return { ok: false, reason: "novelty_reject" };
  }
  if (candidate.finalScore.final < cfg.dispatchMinScore) {
    return { ok: false, reason: "below_dispatch_score" };
  }
  if (candidate.evidenceProfile.evidenceQuality.total < cfg.minEvidenceScore) {
    return { ok: false, reason: "insufficient_evidence" };
  }
  if (candidate.novelty.noveltyScore < cfg.minNoveltyScore) {
    return { ok: false, reason: "insufficient_novelty" };
  }
  return { ok: true };
}

export type SelectionResult = {
  selected: EngineCandidate[];
  /** Candidates that cleared every gate (the "qualified" set, pre-diversity). */
  qualified: EngineCandidate[];
  explorationCount: number;
  familyMix: Record<string, number>;
  /** Why the dispatch target was/wasn't filled (Phase 13 reporting). */
  outcome: "ok" | "insufficient_qualified" | "no_new_topics";
  outcomeReason: string;
  /** Rejection-bucket counts for the run report. */
  rejectedForScore: number;
  rejectedForEvidence: number;
  rejectedForNovelty: number;
  rejectedAsDuplicate: number;
};

/**
 * The final selection algorithm (Phase 16). Gate -> sort -> exploration quota
 * -> family-diversity cap -> fill target. Maximizes QUALITY + NOVELTY +
 * DIVERSITY + EVIDENCE rather than raw score alone.
 */
export function selectFinalCandidates(
  candidates: EngineCandidate[],
  target: number
): SelectionResult {
  const cfg = researchConfig.engine;
  const dispatchTarget = Math.max(1, target);

  // Bucket every candidate for the report, and keep only the gate-passing set.
  let rejectedForScore = 0;
  let rejectedForEvidence = 0;
  let rejectedForNovelty = 0;
  let rejectedAsDuplicate = 0;
  const qualified: EngineCandidate[] = [];

  for (const candidate of candidates) {
    const gate = passesGates(candidate);
    if (gate.ok) {
      qualified.push(candidate);
      continue;
    }
    if (gate.reason === "novelty_reject") rejectedAsDuplicate += 1;
    else if (gate.reason === "insufficient_evidence") rejectedForEvidence += 1;
    else if (gate.reason === "insufficient_novelty") rejectedForNovelty += 1;
    else rejectedForScore += 1;
  }

  // Sort by final score (ties broken by novelty, then evidence) - deterministic.
  const sorted = [...qualified].sort(
    (a, b) =>
      b.finalScore.final - a.finalScore.final ||
      b.novelty.noveltyScore - a.novelty.noveltyScore ||
      b.evidenceProfile.evidenceQuality.total - a.evidenceProfile.evidenceQuality.total
  );

  const explorationTarget = Math.round(dispatchTarget * cfg.explorationRatio);
  const familyCount = new Map<TopicFamily, number>();
  const selected: EngineCandidate[] = [];
  let explorationCount = 0;

  const familyHasRoom = (c: EngineCandidate) =>
    (familyCount.get(c.family) ?? 0) < cfg.maxPerFamily;
  const take = (c: EngineCandidate) => {
    familyCount.set(c.family, (familyCount.get(c.family) ?? 0) + 1);
    selected.push(c);
    if (c.exploratory) explorationCount += 1;
  };

  // Pass 1: reserve up to explorationTarget slots for exploratory topics so a
  // run isn't only the obvious high-volume stories. Family cap still applies.
  for (const candidate of sorted) {
    if (explorationCount >= explorationTarget) break;
    if (selected.length >= dispatchTarget) break;
    if (!candidate.exploratory || !familyHasRoom(candidate)) continue;
    take(candidate);
  }

  // Pass 2: fill the remaining slots with the best remaining candidates of any
  // kind, honoring the family cap. If exploration ran short, exploit topics
  // back-fill those slots (we never leave a slot empty for want of explorers).
  for (const candidate of sorted) {
    if (selected.length >= dispatchTarget) break;
    if (selected.includes(candidate) || !familyHasRoom(candidate)) continue;
    take(candidate);
  }

  const familyMix: Record<string, number> = {};
  for (const [family, count] of familyCount) familyMix[family] = count;

  // Honest outcome (Phase 13): never manufacture topics to hit the target.
  let outcome: SelectionResult["outcome"] = "ok";
  let outcomeReason = `Selected ${selected.length}/${dispatchTarget} qualified topic(s)`;
  if (candidates.length === 0) {
    outcome = "no_new_topics";
    outcomeReason = "No candidates survived the research funnel this run";
  } else if (qualified.length === 0) {
    outcome = "insufficient_qualified";
    outcomeReason = `0/${candidates.length} candidates cleared the quality/novelty/evidence gates (score<${cfg.dispatchMinScore}, evidence>=${cfg.minEvidenceScore}, novelty>=${cfg.minNoveltyScore})`;
  } else if (selected.length < dispatchTarget) {
    outcome = "insufficient_qualified";
    outcomeReason = `Only ${selected.length}/${dispatchTarget} genuine ${cfg.dispatchMinScore}+ topics available after diversity/exploration - dispatched the best valid candidates rather than manufacturing scores`;
  }

  return {
    selected,
    qualified,
    explorationCount,
    familyMix,
    outcome,
    outcomeReason,
    rejectedForScore,
    rejectedForEvidence,
    rejectedForNovelty,
    rejectedAsDuplicate,
  };
}
