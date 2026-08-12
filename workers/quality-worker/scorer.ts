import { env, isVertexConfigured } from "../shared/env";
import { generateVertexVisionJson } from "../shared/vertex";
import { logger } from "../shared/logger";
import { recordAIUsage } from "../shared/pricing";
import { parseEvidenceArticles } from "../shared/evidence";
import { runFactCheck, runFullFactCheck, type FactCheckResult, type FullFactCheckDetail, type FullFactCheckResult } from "./factcheck";
import { judgeBlog, type JudgeResult } from "./judge";

const log = logger.child({ worker: "quality-worker" });

type BlogForQuality = {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  trendId: string | null;
  /** Trend.evidenceSummary - see IMPLEMENTATION_PLAN.md Phase 2.1/2.4. */
  trend?: { evidenceSummary: string | null; evidenceArticles?: unknown } | null;
  /** ContentPlan fields the LLM judge scores usefulness against (Task 4). */
  plan?: { searchIntent: string; audience: string; angle: string } | null;
  featuredImage?: { width: number | null; height: number | null; size: number; publicUrl: string } | null;
  seo?: {
    metaTitle: string;
    metaDescription: string;
    keywords: unknown;
    schema: unknown;
  } | null;
};

type Check = {
  label: string;
  score: number;
  maxScore: 10;
  notes: string[];
};

const requiredSections = [
  "What is",
  "Why it matters",
  "Key Features",
  "Benefits",
  "How it Works",
  "Real World Use Cases",
  "Pros and Cons",
  "Best Practices",
  "Common Mistakes",
  "FAQs",
  "Conclusion",
  "Call To Action",
];

function clamp(score: number) {
  return Math.max(0, Math.min(10, Math.round(score)));
}

function words(content: string) {
  return content.split(/\s+/).filter(Boolean);
}

function headings(content: string, prefix: string) {
  return content.split("\n").filter((line) => line.startsWith(prefix));
}

function keywordList(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function hasDuplicateParagraphs(content: string) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim().toLowerCase())
    .filter((paragraph) => paragraph.length > 80);
  return new Set(paragraphs).size < paragraphs.length;
}

type VisionAssessment = {
  relevant: boolean;
  appealScore: number;
  reason: string;
};

/**
 * A single Gemini vision call covers both issue 55 (does the image
 * plausibly depict the article's subject) and the "visual appeal" part of
 * issue 51 - appealScore is an explicit best-effort proxy for taste, not an
 * objective measurement, and is presented that way wherever it surfaces.
 * Returns null (rather than throwing) on any failure so a Vertex hiccup
 * degrades this one dimension of the score instead of failing the whole
 * quality check.
 */
async function assessFeaturedImage(blog: BlogForQuality): Promise<VisionAssessment | null> {
  if (!blog.featuredImage?.publicUrl || !isVertexConfigured) return null;

  try {
    const response = await fetch(blog.featuredImage.publicUrl);
    if (!response.ok) return null;
    const data = Buffer.from(await response.arrayBuffer()).toString("base64");
    const mimeType = response.headers.get("content-type") || "image/jpeg";

    const startedAt = Date.now();
    // Deferrable: a skipped vision check degrades one score dimension.
    const result = await generateVertexVisionJson<VisionAssessment>(
      env.VERTEX_FLASH,
      `You are reviewing the hero image for a blog post titled "${blog.title}". Assess two things: (1) relevance - does the image plausibly depict this article's subject; (2) visual appeal - is it well-composed and polished (this is a best-effort proxy for taste, not an objective measurement). Return ONLY JSON: {"relevant": boolean, "appealScore": 0-100, "reason": "one sentence"}.`,
      { data, mimeType },
      { priority: "deferrable" }
    );
    await recordAIUsage({
      worker: "quality-worker",
      model: env.VERTEX_FLASH,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
      blogId: blog.id,
      trendId: blog.trendId,
    });
    return result.data;
  } catch (error) {
    log.warn("Featured image vision assessment failed", { error: error instanceof Error ? error.message : error });
    return null;
  }
}

/**
 * Fact-check with cost tracking (same pattern as every other Vertex call
 * site - workers/shared/pricing.ts). Task 3: when FULL_FACTCHECK_ENABLED
 * and the trend carries full-text evidence articles, runs the claim-level
 * full-coverage check; otherwise the legacy sampled check against
 * evidenceSummary. Either way both the score-compatible result and the
 * rich detail (null for legacy) come back.
 */
async function factCheckContent(
  blog: BlogForQuality
): Promise<{ result: FactCheckResult | FullFactCheckResult; detail: FullFactCheckDetail | null } | null> {
  const startedAt = Date.now();
  const articles = parseEvidenceArticles(blog.trend?.evidenceArticles);

  if (env.FULL_FACTCHECK_ENABLED && articles.length > 0) {
    const full = await runFullFactCheck(blog.content, articles);
    if (!full) return null;
    await recordAIUsage({
      worker: "quality-worker",
      model: full.model,
      usage: full.usage,
      latencyMs: Date.now() - startedAt,
      blogId: blog.id,
      trendId: blog.trendId,
    });
    return { result: full, detail: full.detail };
  }

  const evidenceSummary = blog.trend?.evidenceSummary;
  if (!evidenceSummary) return null;
  const legacy = await runFactCheck(blog.content, evidenceSummary);
  if (!legacy) return null;
  await recordAIUsage({
    worker: "quality-worker",
    model: legacy.model,
    usage: legacy.usage,
    latencyMs: Date.now() - startedAt,
    blogId: blog.id,
    trendId: blog.trendId,
  });
  return { result: legacy, detail: null };
}

function recommendation(score: number) {
  if (score >= 95) return "Excellent - Auto Publish";
  if (score >= 90) return "Passed - Ready to Publish";
  if (score >= 80) return "Good - Needs Minor Improvements";
  if (score >= 70) return "Review Required - Manual Review";
  return "Failed - Regenerate Article";
}

export async function scoreBlogQuality(blog: BlogForQuality) {
  const content = blog.content;
  const wordList = words(content);
  const wordCount = wordList.length;
  const h1 = headings(content, "# ");
  const h2 = headings(content, "## ").map((line) => line.replace(/^##\s+/, ""));
  const h3 = headings(content, "### ");
  const keywords = keywordList(blog.seo?.keywords);
  const lowerContent = content.toLowerCase();
  const missingSections = requiredSections.filter(
    (section) => !h2.some((heading) => heading.toLowerCase().startsWith(section.toLowerCase()))
  );
  const paragraphs = content.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const longParagraphs = paragraphs.filter((paragraph) => paragraph.split(/\s+/).length > 130);
  const sentences = content.split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
  const averageSentenceWords = sentences.length
    ? sentences.reduce((sum, sentence) => sum + sentence.split(/\s+/).filter(Boolean).length, 0) / sentences.length
    : 0;
  const imageAssessment = await assessFeaturedImage(blog);
  const factCheckOutcome = await factCheckContent(blog);
  const factCheck = factCheckOutcome?.result ?? null;

  // Task 4: holistic LLM editorial judgment. Runs alongside the heuristics;
  // in JUDGE_SHADOW_MODE (the default) it is computed and persisted but does
  // NOT affect overallScore/passed - the mandatory calibration window before
  // the judge is allowed to gate.
  let judge: JudgeResult | null = null;
  if (env.JUDGE_ENABLED) {
    const judgeStartedAt = Date.now();
    judge = await judgeBlog({ title: blog.title, content: blog.content, plan: blog.plan });
    if (judge) {
      await recordAIUsage({
        worker: "quality-worker",
        model: judge.model,
        usage: judge.usage,
        latencyMs: Date.now() - judgeStartedAt,
        blogId: blog.id,
        trendId: blog.trendId,
      });
    }
  }
  const judgeLive = Boolean(judge && !env.JUDGE_SHADOW_MODE);

  const checks: Check[] = [
    {
      label: "SEO Structure",
      score: clamp(
        (h1.length === 1 ? 2 : 0) +
          (h2.length >= 10 ? 2 : 0) +
          (h3.length >= 8 ? 1 : 0) +
          (blog.seo?.metaTitle ? 1 : 0) +
          (blog.seo?.metaDescription ? 1 : 0) +
          (blog.slug ? 1 : 0) +
          (keywords.some((keyword) => lowerContent.includes(keyword.toLowerCase())) ? 2 : 0)
      ),
      maxScore: 10,
      notes: [`H1 count: ${h1.length}`, `H2 count: ${h2.length}`, `Keyword count: ${keywords.length}`],
    },
    {
      label: "Content Completeness",
      score: clamp(10 - missingSections.length * 0.8),
      maxScore: 10,
      notes: missingSections.length ? [`Missing: ${missingSections.join(", ")}`] : ["All required sections covered"],
    },
    {
      label: "Readability",
      score: clamp(10 - longParagraphs.length - Math.max(0, averageSentenceWords - 24) / 3),
      maxScore: 10,
      notes: [`Average sentence length: ${averageSentenceWords.toFixed(1)} words`, `Long paragraphs: ${longParagraphs.length}`],
    },
    {
      label: "Content Quality",
      score: clamp((wordCount >= 1200 ? 3 : 0) + (wordCount >= 1800 ? 2 : 0) + (h2.length >= 10 ? 2 : 0) + (!hasDuplicateParagraphs(content) ? 3 : 0)),
      maxScore: 10,
      notes: [`Word count: ${wordCount}`, hasDuplicateParagraphs(content) ? "Duplicate paragraph risk found" : "No duplicate paragraphs found"],
    },
    {
      label: "Keyword Optimization",
      score: clamp(keywords.reduce((sum, keyword) => sum + (lowerContent.includes(keyword.toLowerCase()) ? 1.5 : 0), 0)),
      maxScore: 10,
      notes: [`Keywords checked: ${keywords.length}`],
    },
    {
      label: "Technical SEO",
      score: clamp((blog.seo?.schema ? 2 : 0) + (blog.featuredImage ? 2 : 0) + (/\]\(https?:\/\//.test(content) ? 2 : 0) + (blog.seo?.metaTitle ? 2 : 0) + (blog.seo?.metaDescription ? 2 : 0)),
      maxScore: 10,
      notes: [blog.featuredImage ? "Featured image ready" : "Missing featured image", /\]\(https?:\/\//.test(content) ? "External links found" : "No external links found"],
    },
    {
      label: "Formatting & UX",
      score: clamp((/\|.+\|/.test(content) ? 2 : 0) + (/^- /m.test(content) ? 2 : 0) + (/^\d+\. /m.test(content) ? 2 : 0) + (/```/.test(content) ? 2 : 0) + (/table of contents/i.test(content) ? 2 : 0)),
      maxScore: 10,
      notes: ["Checked table, lists, code blocks, and table of contents"],
    },
    {
      label: "Media Quality",
      score: clamp(
        blog.featuredImage
          ? (blog.featuredImage.width && blog.featuredImage.width >= 1200 ? 3 : 1) +
              (blog.featuredImage.publicUrl ? 2 : 0) +
              (blog.featuredImage.size < 500_000 ? 1 : 0) +
              (imageAssessment ? (imageAssessment.relevant ? 2 : 0) + (imageAssessment.appealScore >= 50 ? 2 : 0) : 0)
          : 0
      ),
      maxScore: 10,
      notes: blog.featuredImage
        ? [
            `Image: ${blog.featuredImage.width ?? "-"}x${blog.featuredImage.height ?? "-"}`,
            imageAssessment
              ? `AI relevance/appeal check (best-effort, not an exact measurement): relevant=${imageAssessment.relevant}, appeal=${imageAssessment.appealScore}/100 - ${imageAssessment.reason}`
              : "AI relevance/appeal check unavailable",
          ]
        : ["Missing featured image"],
    },
    {
      label: "AI & Fact Quality",
      score: clamp((!/(as an ai|i cannot|i don't have access)/i.test(content) ? 4 : 0) + (!hasDuplicateParagraphs(content) ? 3 : 0) + (!/(placeholder|todo|lorem ipsum)/i.test(content) ? 3 : 0)),
      maxScore: 10,
      notes: ["Checked AI disclaimers, duplicate paragraphs, and placeholders"],
    },
    {
      label: "Publishing Readiness",
      score: clamp((wordCount >= 1200 ? 3 : 0) + (h1.length === 1 ? 2 : 0) + (missingSections.length === 0 ? 2 : 0) + (!/(todo|placeholder|draft unavailable)/i.test(content) ? 2 : 0) + (blog.excerpt ? 1 : 0)),
      maxScore: 10,
      notes: [`Word count: ${wordCount}`, missingSections.length ? "Required sections missing" : "Required sections ready"],
    },
    {
      // 11th check (IMPLEMENTATION_PLAN.md Phase 2.5) - a real Vertex-verified
      // claims check against Trend.evidenceSummary. Distinct from "AI & Fact
      // Quality" above, which stays a cheap regex heuristic; this is the
      // "actually checks facts" dimension. Scores a neutral 7 (not 0) when
      // there's no evidence to check against or the call fails - "couldn't
      // verify" is not the same as "verified as wrong", and a 0 here drags
      // the overall score down ~9 points for something that isn't the
      // draft's fault.
      label: "Fact Verification",
      score: clamp(factCheck ? factCheck.score / 10 : 7),
      maxScore: 10,
      notes: factCheck
        ? [
            `${factCheck.claims.filter((c) => c.verdict === "supported").length}/${factCheck.claims.length} claims supported by evidence`,
            ...factCheck.claims
              .filter((c) => c.verdict !== "supported")
              .slice(0, 3)
              .map((c) => `${c.verdict}: "${c.claim}" - ${c.note ?? "no note"}`),
          ]
        : [
            blog.trend?.evidenceSummary
              ? "Fact-check unavailable (Vertex call failed or returned no claims) - scored neutral 7/10"
              : "Fact-check skipped (trend has no persisted evidence) - scored neutral 7/10",
          ],
    },
  ];

  // Task 4: the judge appears in the persisted checks for dashboard
  // display, but it does NOT join the flat average - it enters overallScore
  // through the weight below, and only when live (not shadow mode).
  if (judge) {
    checks.push({
      label: "Editorial Judgment",
      score: clamp(judge.overall / 10),
      maxScore: 10,
      notes: [
        `${judge.critique}${env.JUDGE_SHADOW_MODE ? " (shadow mode - not gated)" : ""}`,
        `depth ${judge.scores.depth}/10 · tone ${judge.scores.accuracyOfTone}/10 · originality ${judge.scores.originality}/10 · usefulness ${judge.scores.usefulness}/10`,
      ],
    });
  }

  // Normalized to 0-100 regardless of check count, rather than a raw sum
  // (which would drift past the historical 0-100 range now that there are
  // 11 checks instead of 10) - the dashboard (app/dashboard/page.tsx,
  // app/dashboard/quality/page.tsx) hardcodes "/100" and uses this value
  // directly as a percentage-width, so overallScore has to stay a true
  // percentage no matter how many checks contribute to it. When the judge
  // is live, it carries JUDGE_WEIGHT of the overall and the heuristics the
  // rest (judge check excluded from the heuristic average to avoid
  // double-counting it).
  const heuristicChecks = judge ? checks.slice(0, -1) : checks;
  const rawSum = heuristicChecks.reduce((sum, check) => sum + check.score, 0);
  const heuristicScore = (rawSum / (heuristicChecks.length * 10)) * 100;
  const overallScore = judgeLive
    ? Math.round((1 - env.JUDGE_WEIGHT) * heuristicScore + env.JUDGE_WEIGHT * (judge?.overall ?? 0))
    : Math.round(heuristicScore);

  // A hard gate independent of the averaged score - 10 good checks
  // shouldn't be able to outvote a fact-check that actually ran and found
  // problems. Fails open (factCheckOk = true) when there was nothing to
  // check against or the Vertex call itself failed, same "not the draft's
  // fault" philosophy as citationCheck in writing-worker/index.ts - this
  // gate is about claims found to be wrong, not about missing evidence.
  // 70 (not 100) tolerates the occasional "uncertain" verdict rather than
  // demanding every single claim read as fully "supported".
  const CRITICAL_FACT_CHECK_THRESHOLD = 70;
  const factCheckOk = !factCheck || factCheck.score >= CRITICAL_FACT_CHECK_THRESHOLD;

  // Task 4 (live mode only): per-dimension floor - one collapsed dimension
  // (e.g. Readability 4/10) can no longer be averaged into a pass. Fact
  // Verification is exempt: it has its own hard gate above.
  const floorsOk =
    !judgeLive ||
    heuristicChecks.every((check) => check.score >= env.DIMENSION_FLOOR || check.label === "Fact Verification");

  const passed = overallScore >= 90 && factCheckOk && floorsOk;

  return {
    overallScore,
    passed,
    recommendation: !factCheckOk ? "Blocked - unverified facts" : recommendation(overallScore),
    checks,
    factCheckDetail: factCheckOutcome?.detail ?? null,
    judgeDetail: judge
      ? { scores: judge.scores, overall: judge.overall, critique: judge.critique, fixes: judge.fixes, shadowMode: env.JUDGE_SHADOW_MODE }
      : null,
    /** Task 5 consumes these for targeted repair on QA failure. */
    judgeFixes: judge?.fixes ?? [],
    scores: {
      seoStructure: checks[0].score,
      contentCompleteness: checks[1].score,
      readability: checks[2].score,
      contentQuality: checks[3].score,
      keywordOptimization: checks[4].score,
      technicalSeo: checks[5].score,
      formattingUx: checks[6].score,
      mediaQuality: checks[7].score,
      aiFactQuality: checks[8].score,
      publishingReadiness: checks[9].score,
      factVerification: checks[10].score,
    },
  };
}
