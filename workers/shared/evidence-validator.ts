import type { EvidenceSource } from "./evidence";

export type PlannedEvidenceClaim = {
  claim: string;
  evidenceSourceIds: string[];
  supportLevel: "direct" | "supported";
};

export function validatePlannedClaims(raw: unknown, sources: EvidenceSource[]): EvidenceValidation {
  if (!Array.isArray(raw)) {
    return {
      ok: false, status: "NEEDS_RESEARCH", sources, supportedClaims: [], unsupportedClaims: [],
      diagnostics: [`PLANNING_REJECTED: plannedClaims must be an array; received ${raw === null ? "NULL" : typeof raw}`],
      researchSufficiencyScore: 0,
    };
  }
  if (raw.length === 0) {
    return {
      ok: false, status: "NEEDS_RESEARCH", sources, supportedClaims: [], unsupportedClaims: [],
      diagnostics: ["PLANNING_REJECTED: No evidence-backed planned claims were produced"],
      researchSufficiencyScore: 0,
    };
  }
  const parsed = raw
    .filter((claim): claim is PlannedEvidenceClaim => Boolean(claim && typeof claim === "object" && typeof (claim as PlannedEvidenceClaim).claim === "string" && Array.isArray((claim as PlannedEvidenceClaim).evidenceSourceIds) && (claim as PlannedEvidenceClaim).evidenceSourceIds.length > 0 && (!("supportLevel" in claim) || (claim as PlannedEvidenceClaim).supportLevel === "direct" || (claim as PlannedEvidenceClaim).supportLevel === "supported")))
    .map((claim) => ({ ...claim, supportLevel: claim.supportLevel ?? "direct" as const }));
  if (parsed.length !== raw.length) {
    return {
      ok: false, status: "NEEDS_RESEARCH", sources, supportedClaims: [], unsupportedClaims: [],
      diagnostics: ["PLANNING_REJECTED: Every planned claim requires a non-empty evidenceSourceIds array and direct/supported supportLevel"],
      researchSufficiencyScore: 0,
    };
  }
  return validateEvidencePackage(sources, parsed);
}

export type EvidenceValidation = {
  ok: boolean;
  status: "VALID" | "NEEDS_RESEARCH";
  sources: EvidenceSource[];
  supportedClaims: PlannedEvidenceClaim[];
  unsupportedClaims: PlannedEvidenceClaim[];
  diagnostics: string[];
  researchSufficiencyScore: number;
};

export function validateEvidencePackage(
  sources: EvidenceSource[],
  plannedClaims: PlannedEvidenceClaim[] = []
): EvidenceValidation {
  const diagnostics: string[] = [];
  const validSources = sources.filter((source) => Boolean(source.id && source.url && source.evidence.length > 0));
  const researchSufficiencyScore = Math.min(100, validSources.length * 40 + Math.min(60, validSources.reduce((sum, source) => sum + source.evidence.length, 0) * 30));
  if (sources.length === 0) diagnostics.push("sources.length === 0");
  if (validSources.length === 0) diagnostics.push("No source has a URL and extracted evidence statements");
  if (researchSufficiencyScore < 60) diagnostics.push(`Research sufficiency score ${researchSufficiencyScore} is below 60; research more before writing`);

  const supportedClaims = plannedClaims.filter((claim) =>
    claim.evidenceSourceIds.some((id) => {
      const source = validSources.find((candidate) => candidate.id === id);
      return Boolean(source && (claim.supportLevel === "direct" || claim.supportLevel === "supported") && source.evidence.some((fact) => claimMatchesFact(claim.claim, fact)));
    })
  );
  const unsupportedClaims = plannedClaims.filter((claim) => !supportedClaims.includes(claim));
  if (plannedClaims.length > 0 && supportedClaims.length !== plannedClaims.length) {
    diagnostics.push(`${supportedClaims.length}/${plannedClaims.length} planned claims have supported evidence`);
  }

  return {
    ok: diagnostics.length === 0,
    status: diagnostics.length === 0 ? "VALID" : "NEEDS_RESEARCH",
    sources: validSources,
    supportedClaims,
    unsupportedClaims,
    diagnostics,
    researchSufficiencyScore,
  };
}

function claimMatchesFact(claim: string, fact: string): boolean {
  const stop = new Set(["a", "an", "the", "is", "are", "of", "to", "for", "and", "or", "in", "on", "with", "this", "that"]);
  const tokens = claim.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((token) => token.length > 2 && !stop.has(token));
  const normalizedFact = fact.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  return tokens.length > 0 && tokens.every((token) => normalizedFact.includes(token));
}
