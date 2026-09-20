import type { EvidenceSource } from "./evidence";
import { validatePlannedClaims, type PlannedEvidenceClaim } from "./evidence-validator";

export type ClaimResolutionSource = "model" | "manual" | "derived";

export type OutlineEvidenceClaim = {
  text: string;
  evidenceSourceIds: string[];
};

type RawClaimRecord = {
  claim?: unknown;
  text?: unknown;
  evidenceSourceIds?: unknown;
  sourceIds?: unknown;
  supportLevel?: unknown;
};

function sourceIdSet(sources: EvidenceSource[]): Set<string> {
  return new Set(sources.map((source) => source.id));
}

function sourceIdsForClaim(raw: RawClaimRecord): string[] {
  const value = Array.isArray(raw.evidenceSourceIds) ? raw.evidenceSourceIds : raw.sourceIds;
  if (!Array.isArray(value)) return [];
  return value.map(String).map((id) => id.trim()).filter(Boolean);
}

export function normalizePlannedClaims(raw: unknown, sources: EvidenceSource[]): PlannedEvidenceClaim[] {
  if (!Array.isArray(raw)) return [];
  const validSourceIds = sourceIdSet(sources);
  return raw.flatMap((claim) => {
    if (!claim || typeof claim !== "object") return [];
    const record = claim as RawClaimRecord;
    const text = typeof record.claim === "string" ? record.claim : typeof record.text === "string" ? record.text : "";
    const evidenceSourceIds = sourceIdsForClaim(record).filter((id) => validSourceIds.has(id));
    const supportLevel = record.supportLevel === "supported" ? "supported" : "direct";
    if (!text.trim() || evidenceSourceIds.length === 0) return [];
    return [{ claim: text.trim(), evidenceSourceIds, supportLevel }];
  });
}

export function normalizeOutlineClaims(raw: unknown, sources?: EvidenceSource[]): OutlineEvidenceClaim[] {
  if (!Array.isArray(raw)) return [];
  const validSourceIds = sources ? sourceIdSet(sources) : null;
  return raw.flatMap((claim) => {
    if (!claim || typeof claim !== "object") return [];
    const record = claim as RawClaimRecord;
    const text = typeof record.text === "string" ? record.text : typeof record.claim === "string" ? record.claim : "";
    const evidenceSourceIds = sourceIdsForClaim(record).filter((id) => !validSourceIds || validSourceIds.has(id));
    if (!text.trim() || evidenceSourceIds.length === 0) return [];
    return [{ text: text.trim(), evidenceSourceIds }];
  });
}

export function derivePlannedClaimsFromEvidence(sources: EvidenceSource[]): PlannedEvidenceClaim[] {
  return sources.flatMap((source) =>
    source.evidence.flatMap((fact) => {
      const claim = fact.trim();
      if (!claim) return [];
      return [{ claim, evidenceSourceIds: [source.id], supportLevel: "direct" as const }];
    })
  );
}

export function readManualPlannedClaims(specs: unknown): unknown {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return [];
  return (specs as { plannedClaims?: unknown }).plannedClaims ?? [];
}

export function resolveEvidenceBackedPlannedClaims({
  modelClaims,
  manualClaims,
  evidenceSources,
}: {
  modelClaims: unknown;
  manualClaims: unknown;
  evidenceSources: EvidenceSource[];
}): { claims: PlannedEvidenceClaim[]; source: ClaimResolutionSource; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const candidates: { source: ClaimResolutionSource; claims: PlannedEvidenceClaim[] }[] = [
    { source: "model", claims: normalizePlannedClaims(modelClaims, evidenceSources) },
    { source: "manual", claims: normalizePlannedClaims(manualClaims, evidenceSources) },
    { source: "derived", claims: derivePlannedClaimsFromEvidence(evidenceSources) },
  ];

  for (const candidate of candidates) {
    if (candidate.claims.length === 0) {
      diagnostics.push(`${candidate.source} plannedClaims empty after normalization`);
      continue;
    }
    const gate = validatePlannedClaims(candidate.claims, evidenceSources);
    if (gate.ok) {
      return { claims: candidate.claims, source: candidate.source, diagnostics };
    }
    diagnostics.push(`${candidate.source} plannedClaims rejected: ${gate.diagnostics.join("; ")}`);
  }

  return { claims: [], source: "derived", diagnostics };
}
