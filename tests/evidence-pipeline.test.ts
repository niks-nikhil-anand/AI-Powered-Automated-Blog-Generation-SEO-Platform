import assert from "node:assert/strict";
import { canonicalEvidenceSources } from "../workers/shared/evidence";
import {
  derivePlannedClaimsFromEvidence,
  normalizeOutlineClaims,
  normalizePlannedClaims,
  resolveEvidenceBackedPlannedClaims,
} from "../workers/shared/evidence-claims";
import { validateEvidencePackage, validatePlannedClaims } from "../workers/shared/evidence-validator";
import { materializeCitations, groundedCitationCheck, toGroundedSources } from "../workers/writing-worker/citations";

const sources = canonicalEvidenceSources([
  {
    url: "https://example.com/openkylin",
    title: "openKylin 3.0 Deepens AI Agent Integration",
    excerpt: "openKylin 3.0 deepens AI agent integration.",
    evidence: ["openKylin 3.0 deepens AI agent integration."],
    fetchedAt: new Date().toISOString(),
    extractor: "test",
    chars: 52,
  },
]);

function result(claim: string) {
  return validateEvidencePackage(sources, [{ claim, evidenceSourceIds: ["S1"], supportLevel: "direct" }]);
}

assert.equal(result("openKylin 3.0 deepens AI agent integration.").ok, true);
assert.equal(result("openKylin 3.0 improves developer productivity.").ok, false);
assert.equal(result("The AI integration creates a more intuitive user experience.").ok, false);
assert.equal(result("The integration improves resource utilization.").ok, false);
assert.equal(result("Use the built-in openKylin command to configure the AI agent.").ok, false);
assert.equal(validateEvidencePackage([{ ...sources[0], evidence: [] }]).status, "NEEDS_RESEARCH");
for (const invalid of [null, undefined, {}, []]) {
  assert.equal(validatePlannedClaims(invalid, sources).ok, false);
}
assert.equal(validatePlannedClaims([{ claim: "AI improves productivity", evidenceSourceIds: [] }], sources).ok, false);
assert.equal(validatePlannedClaims([{ claim: "AI improves productivity", evidenceSourceIds: ["S999"] }], sources).ok, false);
assert.equal(validatePlannedClaims([{ claim: "openKylin 3.0 deepens AI agent integration.", evidenceSourceIds: ["S1"] }], sources).ok, true);
assert.equal(validatePlannedClaims([{ claim: "openKylin improves scalability.", evidenceSourceIds: ["S1"] }], sources).ok, false);

const aliasClaims = normalizePlannedClaims(
  [{ text: "openKylin 3.0 deepens AI agent integration.", sourceIds: ["S1", "S999"] }],
  sources
);
assert.deepEqual(aliasClaims, [
  { claim: "openKylin 3.0 deepens AI agent integration.", evidenceSourceIds: ["S1"], supportLevel: "direct" },
]);
assert.deepEqual(normalizeOutlineClaims([{ claim: "openKylin 3.0 deepens AI agent integration.", sourceIds: ["S1"] }], sources), [
  { text: "openKylin 3.0 deepens AI agent integration.", evidenceSourceIds: ["S1"] },
]);
assert.deepEqual(derivePlannedClaimsFromEvidence(sources), [
  { claim: "openKylin 3.0 deepens AI agent integration.", evidenceSourceIds: ["S1"], supportLevel: "direct" },
]);
const resolved = resolveEvidenceBackedPlannedClaims({
  modelClaims: [],
  manualClaims: [],
  evidenceSources: sources,
});
assert.equal(resolved.source, "derived");
assert.equal(resolved.claims.length, 1);
assert.equal(validatePlannedClaims(resolved.claims, sources).ok, true);

// Production outline claims are shaped as { text, evidenceSourceIds } and
// must be normalized before using the shared semantic validator.
const outlineClaims = [
  { text: "openKylin 3.0 deepens AI agent integration.", evidenceSourceIds: ["S1"] },
  { text: "openKylin 3.0 improves scalability.", evidenceSourceIds: ["S1"] },
  { text: "openKylin 3.0 improves developer productivity.", evidenceSourceIds: ["S1"] },
];
const outlineValidation = validatePlannedClaims(
  outlineClaims.map((claim) => ({ claim: claim.text, evidenceSourceIds: claim.evidenceSourceIds, supportLevel: "direct" as const })),
  sources,
);
assert.equal(outlineValidation.supportedClaims.length, 1);
assert.equal(outlineValidation.unsupportedClaims.length, 2);
assert.equal(outlineValidation.ok, false);

const grounded = toGroundedSources(sources);
const materialized = materializeCitations("openKylin 3.0 deepens AI agent integration.[S1]", grounded);
assert.match(materialized.markdown, /https:\/\/example\.com\/openkylin/);
assert.deepEqual(groundedCitationCheck(materialized.citedMarkers, grounded), { ok: true, found: 1, required: 1 });
const wrong = materializeCitations("Claim [S1] and [S9]", grounded);
assert.deepEqual(wrong.droppedMarkers, ["[S9]"]);
const foreign = materializeCitations("Claim [S1] and [other](https://unrelated.example)", grounded);
assert.deepEqual(foreign.foreignLinks, ["https://unrelated.example"]);

console.log("evidence-pipeline tests passed");
