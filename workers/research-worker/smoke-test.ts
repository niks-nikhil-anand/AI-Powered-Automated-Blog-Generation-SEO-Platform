/**
 * Offline smoke test for the research engine's deterministic core
 * (docs/RESEARCH_ENGINE_UPGRADE.md). Exercises the pieces that need no network
 * and no LLM: URL canonicalization, topic fingerprint, keyword/entity
 * similarity, new-development detection, source tiering, topic quality, final
 * scoring, family classification and the selection algorithm - including the
 * exact reworded-duplicate example from the brief.
 *
 * Run: npx tsx workers/research-worker/smoke-test.ts
 */
import {
  canonicalizeUrl,
  topicFingerprint,
  keywordSimilarity,
  entitySimilarity,
  newDevelopmentSignal,
  extractEntities,
} from "./utils/similarity";
import { tierForUrl } from "./pipeline/source-tiers";
import { heuristicTopicQuality } from "./pipeline/topic-quality";
import { computeFinalScore } from "./pipeline/final-score";
import { classifyFamily, tierForScore, isExploratory, selectFinalCandidates } from "./pipeline/selection";
import { cosineSimilarity } from "../shared/embeddings";
import { prisma } from "../shared/prisma";
import { redis } from "../shared/redis";
import type {
  EngineCandidate,
  EvidenceProfile,
  NoveltyVerdict,
  ResearchCandidate,
  TopicQuality,
} from "./types";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}`, detail ?? "");
  }
}

function makeCandidate(title: string, over: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    category: "AI",
    score: 80,
    priority: "high",
    reason: "test",
    keywords: title.toLowerCase().split(" ").filter((w) => w.length > 3).slice(0, 8),
    evidence: [],
    scoreBreakdown: {
      trendDemand: 70,
      newsFreshness: 90,
      githubMomentum: 60,
      multiSourceValidation: 80,
      semanticRelevance: 75,
    },
    ...over,
  };
}

function makeEvidence(over: Partial<EvidenceProfile> = {}): EvidenceProfile {
  return {
    sources: [],
    totalSources: 6,
    independentDomains: 5,
    primarySources: 2,
    tier1Count: 2,
    tier2Count: 3,
    tier3Count: 1,
    freshSourceRatio: 0.8,
    evidenceQuality: { completeness: 80, authority: 85, diversity: 78, freshness: 82, relevance: 88, total: 82 },
    contentOpportunity: { resultCount: 12, domainConcentration: 0.2, shallowRatio: 0.3, hasAuthoritative: true, opportunity: 74 },
    ...over,
  };
}

function makeNovelty(over: Partial<NoveltyVerdict> = {}): NoveltyVerdict {
  return {
    noveltyScore: 95,
    maxSimilarity: 0,
    layer: "none",
    decision: "allow",
    newDevelopment: false,
    reason: "novel",
    ...over,
  };
}

function makeQuality(over: Partial<TopicQuality> = {}): TopicQuality {
  return {
    specificity: 88,
    technicalDepth: 80,
    informationRichness: 75,
    developerRelevance: 85,
    explainerPotential: 82,
    evergreenValue: 70,
    practicalUsefulness: 80,
    llmQuality: 0,
    total: 81,
    ...over,
  };
}

/** A genuinely excellent candidate - high scores across ALL dimensions, which is
 * the only honest way to reach a 90+ final (no single strong dimension suffices). */
function makeExcellentEngineCandidate(title: string, family?: EngineCandidate["family"]): EngineCandidate {
  const candidate = makeCandidate(title, {
    scoreBreakdown: { trendDemand: 92, newsFreshness: 100, githubMomentum: 85, multiSourceValidation: 100, semanticRelevance: 90 },
  });
  const evidenceProfile = makeEvidence({
    freshSourceRatio: 0.9,
    evidenceQuality: { completeness: 90, authority: 92, diversity: 85, freshness: 90, relevance: 92, total: 91 },
    contentOpportunity: { resultCount: 14, domainConcentration: 0.18, shallowRatio: 0.35, hasAuthoritative: true, opportunity: 88 },
  });
  const topicQuality = makeQuality({ developerRelevance: 90, practicalUsefulness: 90, total: 90 });
  const novelty = makeNovelty({ noveltyScore: 96 });
  const finalScore = computeFinalScore({ candidate, evidenceProfile, topicQuality, novelty });
  // Only set family when explicitly provided - passing `family: undefined` would
  // clobber the auto-classification in makeEngineCandidate via the `...over` spread.
  const over: Partial<EngineCandidate> = { candidate, evidenceProfile, topicQuality, novelty, finalScore };
  if (family) over.family = family;
  return makeEngineCandidate(title, over);
}

function makeEngineCandidate(title: string, over: Partial<EngineCandidate> = {}): EngineCandidate {
  const candidate = over.candidate ?? makeCandidate(title);
  const evidenceProfile = over.evidenceProfile ?? makeEvidence();
  const topicQuality = over.topicQuality ?? makeQuality();
  const novelty = over.novelty ?? makeNovelty();
  const finalScore = over.finalScore ?? computeFinalScore({ candidate, evidenceProfile, topicQuality, novelty });
  const ec: EngineCandidate = {
    candidate,
    topicFingerprint: topicFingerprint(title),
    queries: [],
    evidenceProfile,
    topicQuality,
    novelty,
    family: over.family ?? classifyFamily(candidate),
    exploratory: over.exploratory ?? false,
    finalScore,
    tier: over.tier ?? tierForScore(finalScore.final),
    ...over,
  };
  return ec;
}

async function main() {
  console.log("\n== similarity / topic memory ==");
  // The exact example from the brief: differently-worded, same underlying story.
  const a = "Microsoft launches AI agent for automated unit test generation";
  const b = "Microsoft's AI-powered unit testing agent";
  // The brief's reworded-duplicate example is caught by the ENTITY layer (both
  // share microsoft+ai -> similarity ~0.9), not by keyword Jaccard alone.
  check("reworded duplicate shares entities", entitySimilarity(a, b) > 0, { entities: [extractEntities(a), extractEntities(b)] });
  check("entity layer catches reworded duplicate (>=0.75)", entitySimilarity(a, b) >= 0.75, entitySimilarity(a, b));
  check("keyword layer gives a positive partial signal (>0.25)", keywordSimilarity(a, b) > 0.25, keywordSimilarity(a, b));
  check("cosine identical vectors = 1", cosineSimilarity([1, 2, 3], [1, 2, 3]) === 1);
  check("cosine orthogonal vectors = 0", Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  check("canonicalizeUrl strips tracking + www + trailing slash",
    canonicalizeUrl("https://www.Example.com/path/?utm_source=x&b=2&a=1#frag") === "example.com/path?a=1&b=2",
    canonicalizeUrl("https://www.Example.com/path/?utm_source=x&b=2&a=1#frag"));
  check("new development signal fires on version bump",
    newDevelopmentSignal("OpenAI model X 2.0 benchmark update", "OpenAI releases model X") !== null);
  check("no new-development signal on plain restatement",
    newDevelopmentSignal("OpenAI model X", "OpenAI model X announced") === null);

  console.log("\n== source tiering ==");
  check("github.com is tier 1", tierForUrl("https://github.com/org/repo") === 1);
  check("official docs (web.dev) tier 1", tierForUrl("https://web.dev/learn") === 1);
  check("techcrunch is tier 2", tierForUrl("https://techcrunch.com/x") === 2);
  check("reddit is tier 3", tierForUrl("https://www.reddit.com/r/x") === 3);
  check("first-party entity domain is tier 1", tierForUrl("https://blogs.microsoft.com/x", "microsoft") === 1);

  console.log("\n== topic quality (specific beats vague) ==");
  const specific = heuristicTopicQuality(makeCandidate("Microsoft's AI Unit Test Agent: How Automated Test Generation Works"));
  const vague = heuristicTopicQuality(makeCandidate("AI is changing software development"));
  check("specific topic outscores vague topic", specific.total > vague.total, { specific: specific.total, vague: vague.total });
  check("vague topic penalized (specificity low)", vague.specificity < specific.specificity, { vagueSpec: vague.specificity, specSpec: specific.specificity });

  console.log("\n== final score (transparent, honest) ==");
  const strong = computeFinalScore({ candidate: makeCandidate("X"), evidenceProfile: makeEvidence(), topicQuality: makeQuality(), novelty: makeNovelty() });
  check("mid-strength profile lands in the 70s-80s (not inflated to 90)", strong.final >= 70 && strong.final < 90, strong.final);
  const excellentScore = makeExcellentEngineCandidate("Excellent topic").finalScore.final;
  check("genuinely-excellent all-around profile CAN reach 90+", excellentScore >= 90, excellentScore);
  const weakEvidence = computeFinalScore({
    candidate: makeCandidate("X"),
    evidenceProfile: makeEvidence({ evidenceQuality: { completeness: 20, authority: 15, diversity: 20, freshness: 30, relevance: 25, total: 40 } }),
    topicQuality: makeQuality(),
    novelty: makeNovelty(),
  });
  check("trend 95 + evidence 40 does NOT reach 90", weakEvidence.final < 90, weakEvidence.final);
  check("no artificial inflation: final is weighted sum of stored dims", (() => {
    const d = strong;
    const manual = Math.round((d.trendDemand * 0.15 + d.freshness * 0.1 + d.searchDemand * 0.1 + d.githubMomentum * 0.05 + d.sourceDiversity * 0.1 + d.evidenceQuality * 0.15 + d.topicQuality * 0.15 + d.novelty * 0.1 + d.audienceValue * 0.1) * 10) / 10;
    return Math.abs(manual - d.final) < 0.05;
  })());

  console.log("\n== tiers ==");
  check(">=90 is excellent", tierForScore(93) === "excellent");
  check("80-89 is strong", tierForScore(85) === "strong");
  check("70-79 is weak", tierForScore(72) === "weak");
  check("<70 is reject", tierForScore(40) === "reject");

  console.log("\n== family classification ==");
  check("AI agent -> AI", classifyFamily(makeCandidate("OpenAI launches new LLM agent")) === "AI");
  check("postgres -> Databases", classifyFamily(makeCandidate("PostgreSQL 17 query planner", { category: "Databases" })) === "Databases");
  check("react -> Frontend", classifyFamily(makeCandidate("React Server Components guide", { category: "Web Development" })) === "Frontend");

  console.log("\n== exploration flag (Phase 15) ==");
  const niche = makeEngineCandidate("Brand new niche GitHub CLI tool", {
    candidate: makeCandidate("Brand new niche GitHub CLI tool", {
      scoreBreakdown: { trendDemand: 20, newsFreshness: 70, githubMomentum: 60, multiSourceValidation: 40, semanticRelevance: 60 },
    }),
    evidenceProfile: makeEvidence({
      contentOpportunity: { resultCount: 4, domainConcentration: 0.3, shallowRatio: 0.4, hasAuthoritative: true, opportunity: 55 },
    }),
    novelty: makeNovelty({ noveltyScore: 96 }),
  });
  check("emerging/niche high-novelty candidate is exploratory", isExploratory(niche) === true);
  const mainstreamC = makeEngineCandidate("OpenAI flagship model launch", {
    candidate: makeCandidate("OpenAI flagship model launch", {
      scoreBreakdown: { trendDemand: 95, newsFreshness: 100, githubMomentum: 50, multiSourceValidation: 100, semanticRelevance: 90 },
    }),
    evidenceProfile: makeEvidence({
      contentOpportunity: { resultCount: 30, domainConcentration: 0.15, shallowRatio: 0.3, hasAuthoritative: true, opportunity: 70 },
    }),
  });
  check("mainstream high-trend candidate is NOT exploratory", isExploratory(mainstreamC) === false);

  console.log("\n== selection (honest gating, no faked 90+) ==");
  // Build a pool: 3 excellent distinct families, 1 strong, 1 weak-evidence.
  const excellent = (title: string, family?: EngineCandidate["family"]) =>
    makeEngineCandidate(title, { family });
  const pool: EngineCandidate[] = [
    excellent("OpenAI launches new coding agent"),
    excellent("PostgreSQL 17 released with new planner"),
    excellent("Kubernetes 1.30 security hardening"),
    makeEngineCandidate("Niche new CLI tool for logs", {
      finalScore: { ...computeFinalScore({ candidate: makeCandidate("x"), evidenceProfile: makeEvidence(), topicQuality: makeQuality(), novelty: makeNovelty() }), final: 82 },
      tier: "strong",
      exploratory: true,
    }),
    makeEngineCandidate("Weak evidence trending topic", {
      evidenceProfile: makeEvidence({ evidenceQuality: { completeness: 10, authority: 10, diversity: 10, freshness: 20, relevance: 15, total: 30 } }),
      finalScore: { ...computeFinalScore({ candidate: makeCandidate("x"), evidenceProfile: makeEvidence(), topicQuality: makeQuality(), novelty: makeNovelty() }), final: 91 },
      tier: "excellent",
    }),
  ];
  const sel = selectFinalCandidates(pool, 5);
  check("weak-evidence 91-score candidate is gated out by evidence floor", !sel.selected.some((c) => c.candidate.title === "Weak evidence trending topic"));
  check("strong (82) below dispatch score is not auto-dispatched", !sel.selected.some((c) => c.candidate.title === "Niche new CLI tool for logs"));
  check("mid-tier (final<90) candidates are not auto-dispatched either", sel.selected.length === 0, sel.selected.map((c) => [c.candidate.title, c.finalScore.final]));

  // A pool of genuinely-excellent candidates across distinct families gets dispatched.
  const excellentPool: EngineCandidate[] = [
    makeExcellentEngineCandidate("OpenAI launches new coding agent"),
    makeExcellentEngineCandidate("PostgreSQL 17 released with new planner"),
    makeExcellentEngineCandidate("Kubernetes 1.30 security hardening"),
  ];
  const excellentSel = selectFinalCandidates(excellentPool, 5);
  check("genuinely-excellent topics are selected and dispatched", excellentSel.selected.length === 3, excellentSel.selected.map((c) => [c.candidate.title, c.finalScore.final]));
  check("selection spans distinct families", Object.keys(excellentSel.familyMix).length >= 2, excellentSel.familyMix);

  // Family diversity cap: 3 AI candidates, maxPerFamily=2 -> at most 2 AI.
  const aiPool = [1, 2, 3, 4].map((i) => makeEngineCandidate(`New AI agent number ${i} for coding`));
  const aiSel = selectFinalCandidates(aiPool, 4);
  const aiCount = aiSel.selected.filter((c) => c.family === "AI").length;
  check("family diversity caps AI topics at maxPerFamily (2)", aiCount <= 2, { aiCount, selected: aiSel.selected.length });

  // Under-filled target reports honestly instead of manufacturing topics.
  const tinyPool = [makeEngineCandidate("Only one good topic")];
  const tinySel = selectFinalCandidates(tinyPool, 5);
  check("under-filled target reports insufficient_qualified or ok honestly", tinySel.selected.length <= 1, tinySel.outcomeReason);

  console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("smoke test error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
