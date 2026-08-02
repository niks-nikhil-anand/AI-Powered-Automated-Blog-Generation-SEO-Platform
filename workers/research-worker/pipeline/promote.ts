import { researchConfig } from "../config";
import { ResearchCandidate } from "../types";

export function promotableCandidates(candidates: ResearchCandidate[]): ResearchCandidate[] {
  return candidates.filter((candidate) => candidate.score >= researchConfig.minScoreToPromote);
}
