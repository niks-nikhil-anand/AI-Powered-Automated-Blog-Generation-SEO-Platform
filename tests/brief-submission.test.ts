import assert from "node:assert/strict";
import { blogInputSchema } from "../app/dashboard/blogs/new/types";
import { isBriefSubmission, normalizeBrief, toneFromBrief } from "../app/dashboard/blogs/new/brief";
import { outlineFromUserInput, parseUserOutline } from "../workers/outline-worker/user-outline";
import { buildSectionPlan } from "../workers/writing-worker/sections";
import { validateArticleContract, articleWordRange } from "../workers/shared/article-contract";
import { readBriefSpecs } from "../workers/shared/brief";
import { resolveEditorialPolicy } from "../workers/shared/editorial-policy";
import { reviewArticle } from "../workers/shared/editorial-rules";

/*
 * The nested authoring brief (schemaVersion 1.0), end to end: it must parse,
 * every field must land where the pipeline looks for it, and the writing
 * worker must receive the per-section directives rather than dropping them.
 * Every field is optional - the partial-brief cases at the bottom pin that.
 */

const BRIEF = {
  schemaVersion: "1.0",
  blogTitle: "How to Choose a Next.js SaaS Starter Kit in 2026: Features, Costs, and Architecture",
  contentType: "technical_guide",
  topic: "Choosing a Next.js SaaS starter kit based on product requirements, architecture, features, cost, and maintainability",
  priority: "high",
  metadata: {
    slug: "how-to-choose-nextjs-saas-starter-kit",
    metaTitle: "How to Choose a Next.js SaaS Starter Kit in 2026",
    metaDescription:
      "Learn how to choose a Next.js SaaS starter kit in 2026. Compare authentication, billing, database architecture, pricing, and scalability before buying.",
    language: "en",
    targetCountry: "US",
    category: "Next.js",
    tags: ["Next.js", "SaaS starter kit", "Next.js boilerplate"],
    authorProfile: { role: "Technical content writer", expertise: ["Next.js", "React"] },
  },
  seo: {
    focusKeyword: "Next.js SaaS starter kit",
    primaryKeywords: ["Next.js SaaS starter kit", "Next.js SaaS boilerplate", "Next.js starter kit"],
    secondaryKeywords: ["SaaS starter template", "Next.js boilerplate", "Next.js SaaS template"],
    longTailKeywords: ["how to choose a Next.js SaaS starter kit", "free vs paid Next.js SaaS starter kits"],
    semanticEntities: ["Next.js", "React", "TypeScript", "App Router", "PostgreSQL", "Stripe"],
    keywordInstructions: {
      useFocusKeywordInH1: true,
      useFocusKeywordInIntroduction: true,
      useFocusKeywordInMetaTitle: true,
      useFocusKeywordInMetaDescription: true,
      useFocusKeywordInConclusion: true,
      avoidKeywordStuffing: true,
      useNaturalVariations: true,
      avoidForcedExactMatchInEverySection: true,
    },
    internalLinkPolicy: {
      enabled: true,
      onlyUseVerifiedUrls: true,
      doNotInventUrls: true,
      avoidUnrequestedLinks: true,
      suggestedPages: [
        {
          page: "DevKit Market Next.js Templates",
          url: "https://www.devkitmarket.com/templates",
          anchorSuggestion: "explore Next.js templates and starter kits",
          placement: "After explaining the different types of starter kits",
        },
      ],
    },
    externalLinkPolicy: {
      enabled: true,
      preferOfficialDocumentation: true,
      onlyUseVerifiedUrls: true,
      linkToSourcesForTechnicalClaims: true,
      avoidUnnecessaryExternalLinks: true,
    },
  },
  searchIntent: {
    primary: "Commercial investigation",
    secondary: "Informational",
    userProblem:
      "Developers want to select a Next.js SaaS starter kit without wasting money on a codebase that does not fit their product or technical requirements.",
    expectedAnswer:
      "A practical framework for evaluating starter kits based on features, architecture, pricing, maintainability, and project requirements.",
    readerDecision:
      "Determine whether to use a free starter, purchase a commercial boilerplate, choose a UI template, or build a custom foundation.",
  },
  audience: {
    primary: ["Indie hackers", "SaaS founders", "Full-stack developers", "Freelance developers"],
    secondary: ["Small engineering teams", "Developers building AI SaaS products"],
    experienceLevel: ["Beginner", "Intermediate", "Advanced"],
    painPoints: ["Uncertainty about which features are actually necessary", "Unclear licensing and update policies"],
    readerOutcome: ["Understand the different types of Next.js starter products", "Evaluate a starter kit before purchasing"],
  },
  contentGoal: {
    primary: "Create a genuinely useful decision guide for developers evaluating Next.js SaaS starter kits.",
    secondary: "Introduce DevKit Market as a resource for discovering Next.js templates and starter kits.",
    conversionGoal: "Encourage relevant readers to explore the DevKit Market catalog.",
    editorialPositioning: "Educational, technically grounded, transparent, and product-neutral.",
    successCriteria: ["Satisfy the search intent without relying on a generic ranked list", "Provide a reusable evaluation checklist"],
  },
  competitorAnalysis: {
    status: "initial_web_research_completed",
    observedContentGapsToInvestigate: ["A practical buyer checklist that readers can use before purchasing"],
    competitorResearchRules: ["Do not copy competitor wording or structure.", "Do not reproduce unverified competitor prices or features."],
  },
  researchRequirements: {
    researchBeforeWriting: true,
    preferredSources: ["Official Next.js documentation", "Official React documentation"],
    researchQuestions: ["What distinguishes a UI template from a full-stack SaaS starter kit?"],
    evidenceRules: [
      "Support technical claims with authoritative sources.",
      "Do not fabricate benchmarks, pricing, adoption figures, or time savings.",
      "Do not state that a starter kit guarantees security, scalability, or production readiness.",
    ],
  },
  sourcePolicy: {
    requireSourcesForTechnicalClaims: true,
    doNotInventSources: true,
    doNotInventUrls: true,
    sourceNotes: [
      { sourceName: "DevKit Market", sourceType: "official_product_website", url: "https://www.devkitmarket.com/" },
      { sourceName: "DevKit Market Templates", sourceType: "official_catalog", url: "https://www.devkitmarket.com/templates" },
      { sourceName: "MakerKit SaaS Boilerplate Comparison", sourceType: "secondary_market_research", url: "https://makerkit.dev/blog/saas/best-nextjs-saas-boilerplate" },
    ],
  },
  contentLength: {
    targetWordCount: 2400,
    minimumWordCount: 2000,
    maximumWordCount: 2800,
    countFaqInTotal: true,
    avoidPadding: true,
  },
  outlineJson: {
    h1: "How to Choose a Next.js SaaS Starter Kit in 2026",
    introduction: {
      targetWords: 150,
      intent: "Establish the buyer's problem and explain the purpose of the guide.",
      requirements: [
        "Use the focus keyword naturally in the opening.",
        "Explain why starter-kit selection involves more than comparing feature lists.",
        "Preview the evaluation framework.",
        "Avoid unsupported claims about guaranteed development-time savings.",
      ],
    },
    sections: [
      {
        id: "section_01",
        level: "h2",
        heading: "What Is a Next.js SaaS Starter Kit?",
        targetWords: 220,
        intent: "Define the product category and establish terminology.",
        keyPoints: ["Explain what a Next.js SaaS starter kit provides.", "Distinguish a UI template from a full-stack starter."],
        readerQuestion: "What am I actually buying when I purchase a starter kit?",
        avoidContent: ["Treating every template as a complete SaaS backend", "Claiming all starter kits include authentication and billing"],
      },
      {
        id: "section_02",
        level: "h2",
        heading: "Why Your SaaS Requirements Should Come First",
        targetWords: 230,
        intent: "Help readers define their requirements before comparing products.",
        keyPoints: ["Identify the product type: B2B SaaS, B2C SaaS, AI app, or internal tool."],
        readerQuestion: "How do I know which features my project actually needs?",
        practicalExample: "Contrast a simple single-user AI utility with a multi-tenant B2B SaaS.",
        avoidContent: ["Suggesting every SaaS needs complex enterprise functionality"],
      },
      {
        id: "section_03",
        level: "h2",
        heading: "Essential Features to Check Before Choosing a Starter Kit",
        targetWords: 350,
        intent: "Provide a practical feature-evaluation framework.",
        keyPoints: ["Authentication and session management", "Database integration and schema design", "Billing and payment workflows"],
        readerQuestion: "Which features should I verify before purchasing?",
        requirements: ["Explain why each feature matters.", "Separate essential, optional, and product-specific features."],
      },
      {
        id: "section_04",
        level: "h2",
        heading: "Evaluate the Technology Stack and Architecture",
        targetWords: 330,
        intent: "Explain technical compatibility and long-term architectural trade-offs.",
        keyPoints: ["Check the supported Next.js version and routing approach."],
        readerQuestion: "Will this starter fit my existing stack and scale with my product?",
        evidenceRequirements: ["Verify version-specific Next.js statements.", "Use official documentation for framework and database claims."],
        avoidContent: ["Declaring a particular stack universally superior", "Making unsupported scalability guarantees"],
      },
      {
        id: "section_05",
        level: "h2",
        heading: "Free vs Paid Next.js SaaS Starter Kits",
        targetWords: 250,
        intent: "Help readers evaluate the cost and value of different purchasing models.",
        keyPoints: ["Explain common differences between free and commercial starters."],
        readerQuestion: "Should I use a free starter or pay for a commercial boilerplate?",
        evidenceRequirements: ["Do not publish unverified prices."],
      },
      {
        id: "section_06",
        level: "h2",
        heading: "How to Evaluate Code Quality and Maintainability",
        targetWords: 270,
        intent: "Give readers a way to inspect the codebase beyond marketing claims.",
        keyPoints: ["Review repository structure and code readability."],
        readerQuestion: "How can I tell whether a starter is maintainable?",
        avoidContent: ["Treating repository stars as proof of code quality", "Claiming to have audited code that was not inspected"],
      },
      {
        id: "section_07",
        level: "h2",
        heading: "Common Mistakes When Buying a SaaS Boilerplate",
        targetWords: 230,
        intent: "Prevent common purchasing and architecture mistakes.",
        keyPoints: ["Choosing based only on the number of included features.", "Ignoring license restrictions."],
        readerQuestion: "What mistakes should I avoid before choosing a starter?",
        requirements: ["Explain the consequence of each mistake.", "Provide a practical prevention step."],
      },
      {
        id: "section_08",
        level: "h2",
        heading: "A Practical Checklist for Choosing Your Next.js SaaS Starter Kit",
        targetWords: 250,
        intent: "Convert the guide into a reusable decision tool.",
        keyPoints: ["Product requirements match", "Required features verified", "Stack compatibility confirmed"],
        readerQuestion: "What should I verify before making the final decision?",
        format: "Actionable checklist",
        avoidContent: ["Arbitrary numerical scoring", "Unsupported universal winner recommendations"],
      },
      {
        id: "section_09",
        level: "h2",
        heading: "Where to Find Next.js Starter Kits for Your Project",
        targetWords: 180,
        intent: "Help readers continue their search using relevant catalog resources.",
        keyPoints: ["Explain that starter-kit categories serve different project needs."],
        requiredInternalLink: {
          url: "https://www.devkitmarket.com/templates",
          anchor: "explore Next.js templates and starter kits",
        },
        avoidContent: ["Claiming DevKit Market is the best marketplace"],
      },
      {
        id: "section_10",
        level: "h2",
        heading: "Conclusion: Choose the Starter That Fits Your Product",
        targetWords: 130,
        intent: "Summarize the decision framework and provide a useful next step.",
        keyPoints: ["Reinforce that requirements should drive the choice."],
        avoidContent: ["Repeating the entire article", "Making a guaranteed SEO or development-speed promise"],
      },
    ],
    faq: [
      { question: "What is a Next.js SaaS starter kit?", answerRequirements: ["Give a direct definition.", "Explain that included functionality varies by starter."] },
      { question: "Are free Next.js SaaS starter kits good enough for production?", answerRequirements: ["Avoid blanket guarantees."] },
      { question: "What features should a Next.js SaaS boilerplate include?", answerRequirements: ["Clarify that requirements differ by product."] },
      { question: "Can I customize a Next.js starter kit after purchasing it?", answerRequirements: ["Recommend reviewing the repository and license terms."] },
      { question: "Should I build my SaaS from scratch or use a starter kit?", answerRequirements: ["Avoid declaring a universal winner."] },
    ],
  },
  examplesAndPracticalValue: {
    required: true,
    examples: [
      { scenario: "Solo founder building a simple SaaS MVP", purpose: "Show how to prioritize essential features over unnecessary complexity." },
      { scenario: "Team building a multi-tenant B2B SaaS", purpose: "Explain why organizations, permissions, and tenant isolation deserve careful evaluation." },
    ],
    rules: ["Use illustrative scenarios rather than fabricated customer case studies.", "Do not invent measured performance results."],
  },
  writingInstructions: {
    tone: "Professional, practical, technically informed, and accessible",
    style: "People-first technical guide",
    readingLevel: "Accessible to developers with basic web development knowledge",
    instructions: [
      "Write for developers making a real purchasing or architecture decision.",
      "Use the exact focus keyword naturally in the H1.",
      "Do not create unrequested clickable tables of contents.",
      "Do not present an arbitrary ranked list of starter kits.",
    ],
  },
  generationConfig: {
    generationMode: "section_by_section",
    preserveOutlineStructure: true,
    maxSectionRetries: 3,
    doNotPublishIncompleteDraft: true,
  },
  validationRequirements: {
    blockers: ["Missing or altered H1", "Fabricated statistics, sources, URLs, pricing, or product features"],
    warnings: ["Focus keyword used unnaturally", "Overly promotional DevKit Market mentions"],
  },
  qualityRequirements: {
    promotionalIntensity: "Low",
    requirements: [
      "The article must be useful even if the reader does not purchase a starter kit.",
      "The article must provide a clear and reusable selection framework.",
    ],
  },
  publishing: { status: "draft", requiresEditorialReview: true },
};

/* ---------------------------------------------------------------- */
/* It parses at all                                                  */
/* ---------------------------------------------------------------- */

assert.equal(isBriefSubmission(BRIEF), true);
const parsed = blogInputSchema.safeParse(BRIEF);
assert.equal(
  parsed.success,
  true,
  parsed.success ? "" : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
);
const input = parsed.success ? parsed.data : ({} as never);

/* ---------------------------------------------------------------- */
/* Field mapping                                                     */
/* ---------------------------------------------------------------- */

assert.equal(input.title, BRIEF.blogTitle);
assert.equal(input.slug, "how-to-choose-nextjs-saas-starter-kit");
assert.equal(input.category, "Next.js");
assert.equal(input.metaTitle, BRIEF.metadata.metaTitle);
assert.equal(input.metaDescription, BRIEF.metadata.metaDescription);
assert.equal(input.priority, "HIGH");
assert.equal(input.focusKeyword, "Next.js SaaS starter kit");
assert.deepEqual(input.primaryKeywords, BRIEF.seo.primaryKeywords);
assert.deepEqual(input.secondaryKeywords, BRIEF.seo.secondaryKeywords);
assert.equal(input.contentLength, 2400);
assert.equal(input.tone, "professional");
assert.equal(toneFromBrief("Casual and conversational"), "casual");
assert.equal(toneFromBrief(undefined), undefined);

// Audience and search intent are flattened into the single lines the plan uses.
assert.ok(input.audience?.includes("Indie hackers"));
assert.ok(input.audience?.includes("experience: Beginner/Intermediate/Advanced"));
assert.ok(input.searchIntent?.startsWith("Commercial investigation (secondary: Informational)"));
assert.ok(input.searchIntent?.includes("without wasting money"));

// Explicit bounds survive into specs for the contract.
assert.deepEqual(input.contentBounds, { min: 2000, max: 2800, countFaqInTotal: true, avoidPadding: true });
assert.equal(input.briefedH1, "How to Choose a Next.js SaaS Starter Kit in 2026");

// The required link is both a requirement (internalLinks) and a permission.
assert.deepEqual(input.internalLinks, ["https://www.devkitmarket.com/templates"]);
const policy = resolveEditorialPolicy(input as unknown as Record<string, unknown>);
assert.equal(policy.tableOfContents, false);
assert.deepEqual(policy.internalLinks, ["https://www.devkitmarket.com/templates"]);
assert.ok(policy.approvedLinks.includes("https://www.devkitmarket.com/"));
assert.ok(policy.approvedLinks.includes("https://makerkit.dev/blog/saas/best-nextjs-saas-boilerplate"));
// onlyUseVerifiedUrls means the external policy stays strict.
assert.equal(policy.externalLinks, "evidence-only");

// Voice instructions vs. the rest of the brief.
assert.ok(input.writingInstructions?.includes("Style: People-first technical guide."));
assert.ok(input.writingInstructions?.some((line) => line.startsWith("Tone: Professional")));
assert.ok(input.writingInstructions?.includes("Do not present an arbitrary ranked list of starter kits."));

const directives = input.briefDirectives ?? [];
assert.ok(directives.some((line) => line.includes("A practical framework for evaluating starter kits")));
assert.ok(directives.some((line) => line.includes("Reader pain points")));
assert.ok(directives.some((line) => line.includes("Promotional intensity: Low")));
assert.ok(directives.some((line) => line.includes("Solo founder building a simple SaaS MVP")));
assert.ok(directives.some((line) => line.includes("Do not fabricate benchmarks")));
assert.ok(directives.some((line) => line.includes("Do not stuff keywords")));
assert.ok(directives.some((line) => line.includes("Do not pad to reach the word count")));

// Quality requirements and blockers become mandatory generation rules.
const mustFollow = (input.generationInstructions?.mustFollow ?? []) as string[];
assert.ok(mustFollow.includes("The article must be useful even if the reader does not purchase a starter kit."));
assert.ok(mustFollow.some((rule) => rule.includes("Missing or altered H1")));

/* ---------------------------------------------------------------- */
/* Outline fidelity                                                  */
/* ---------------------------------------------------------------- */

const outlineJson = input.outlineJson as { sections: Record<string, unknown>[]; faqs: Record<string, unknown>[] };
// Introduction becomes section 0; the ten briefed H2s follow in order.
assert.equal(outlineJson.sections.length, 11);
assert.equal(outlineJson.sections[0].heading, "Introduction");
assert.equal(outlineJson.sections[0].wordTarget, 150);
assert.equal(outlineJson.sections[1].heading, "What Is a Next.js SaaS Starter Kit?");
assert.equal(outlineJson.sections[10].heading, "Conclusion: Choose the Starter That Fits Your Product");

// keyPoints became bullets; targetWords became wordTarget; avoidContent became avoid.
assert.deepEqual(outlineJson.sections[1].bullets, BRIEF.outlineJson.sections[0].keyPoints);
assert.equal(outlineJson.sections[1].wordTarget, 220);
assert.deepEqual(outlineJson.sections[1].avoid, BRIEF.outlineJson.sections[0].avoidContent);
assert.equal(outlineJson.sections[1].readerQuestion, "What am I actually buying when I purchase a starter kit?");
assert.equal(outlineJson.sections[8].format, "Actionable checklist");
assert.deepEqual(outlineJson.sections[9].requiredInternalLink, {
  url: "https://www.devkitmarket.com/templates",
  anchor: "explore Next.js templates and starter kits",
});

// faq -> faqs, answerRequirements -> answerIntent.
assert.equal(outlineJson.faqs.length, 5);
assert.equal(outlineJson.faqs[0].question, "What is a Next.js SaaS starter kit?");
assert.equal(outlineJson.faqs[0].answerIntent, "Give a direct definition. Explain that included functionality varies by starter.");

/* ---------------------------------------------------------------- */
/* The writing worker receives all of it                             */
/* ---------------------------------------------------------------- */

const userOutline = parseUserOutline(input.outlineJson);
assert.ok(userOutline, "the normalized outline must parse as a user outline");
const outline = outlineFromUserInput(userOutline!, {
  title: input.title,
  metaTitle: input.metaTitle,
  metaDescription: input.metaDescription,
  angle: "buyer decision guide",
  slug: input.slug ?? "how-to-choose-nextjs-saas-starter-kit",
  focusKeyword: input.focusKeyword,
});

const checklistSection = outline.sections.find((section) => section.heading.startsWith("A Practical Checklist"));
assert.equal(checklistSection?.format, "Actionable checklist");
const catalogSection = outline.sections.find((section) => section.heading.startsWith("Where to Find"));
assert.equal(catalogSection?.requiredInternalLink?.url, "https://www.devkitmarket.com/templates");

const plan = buildSectionPlan({
  title: outline.title,
  topic: input.title,
  description: "buyer decision guide",
  outline: { sections: outline.sections, faqs: outline.faqs },
  keywords: input.primaryKeywords,
  focusKeyword: input.focusKeyword,
  targetWords: input.contentLength,
  specs: input as unknown as Record<string, unknown>,
  briefDirectives: input.briefDirectives,
});

// Intro first, no table of contents, ten body sections.
assert.equal(plan[0].kind, "intro");
assert.equal(plan[0].wordTarget, 150);
assert.ok(plan.every((section) => section.kind !== "toc"));
assert.equal(plan.length, 12);

const planChecklist = plan.find((section) => section.heading?.startsWith("A Practical Checklist"));
assert.equal(planChecklist?.format, "Actionable checklist");
assert.deepEqual(planChecklist?.avoid, ["Arbitrary numerical scoring", "Unsupported universal winner recommendations"]);

const planDefinition = plan.find((section) => section.heading === "What Is a Next.js SaaS Starter Kit?");
assert.equal(planDefinition?.readerQuestion, "What am I actually buying when I purchase a starter kit?");
assert.equal(planDefinition?.wordTarget, 220);

const planStack = plan.find((section) => section.heading?.startsWith("Evaluate the Technology"));
assert.deepEqual(planStack?.evidenceRequirements, [
  "Verify version-specific Next.js statements.",
  "Use official documentation for framework and database claims.",
]);

const planRequirements = plan.find((section) => section.heading?.startsWith("Why Your SaaS Requirements"));
assert.equal(planRequirements?.practicalExample, "Contrast a simple single-user AI utility with a multi-tenant B2B SaaS.");

const planCatalog = plan.find((section) => section.heading?.startsWith("Where to Find"));
assert.equal(planCatalog?.requiredInternalLink?.url, "https://www.devkitmarket.com/templates");

/* ---------------------------------------------------------------- */
/* Contract: briefed bounds, H1 and FAQ coverage                     */
/* ---------------------------------------------------------------- */

const brief = readBriefSpecs(input as unknown as Record<string, unknown>);
assert.deepEqual(brief.wordBounds, { min: 2000, max: 2800, countFaqInTotal: true, avoidPadding: true });
assert.equal(brief.briefedH1, "How to Choose a Next.js SaaS Starter Kit in 2026");
assert.ok(brief.directives.length > 0);
// generationConfig overrides the pipeline's own defaults for this submission.
assert.equal(brief.generationMode, "section_by_section");
assert.equal(brief.maxSectionRetries, 3);
// The strict external-link consequence is reported back to the editor.
assert.ok(input.briefNotes?.some((note) => note.includes("External links are restricted")));

// The briefed bounds replace the derived 0.9x/1.75x range.
assert.deepEqual(articleWordRange(2400), { min: 2160, max: 4200 });
assert.deepEqual(articleWordRange(2400, { min: 2000, max: 2800 }), { min: 2000, max: 2800 });

const contractBase = {
  targetWords: input.contentLength,
  wordBounds: brief.wordBounds,
  requiredH1: brief.briefedH1,
  faqQuestions: outline.faqs,
  focusKeyword: input.focusKeyword,
  metaTitle: input.metaTitle,
  metaDescription: input.metaDescription,
};

const wrongH1 = validateArticleContract({
  ...contractBase,
  content: "# Choosing a Next.js SaaS starter kit\n\nBody.\n",
});
assert.ok(wrongH1.reasons.some((reason) => reason.startsWith("H1 does not match the briefed H1")));

const missingFaqs = validateArticleContract({
  ...contractBase,
  content: `# ${brief.briefedH1}\n\nBody about the Next.js SaaS starter kit decision.\n`,
});
assert.ok(missingFaqs.reasons.some((reason) => reason.startsWith("Missing briefed FAQ question(s)")));

const mentionedFaqOnly = validateArticleContract({
  ...contractBase,
// An explicit ceiling is enforced; without one the derived maximum stays advisory.
const tooLong = validateArticleContract({
  ...contractBase,
  content: `# ${brief.briefedH1}\n\n${"word ".repeat(3000)}.\n`,
});
assert.ok(tooLong.reasons.some((reason) => reason.includes("exceeds the briefed maximum of 2800")));

// Regression: the reported production failure was an assembled 3,932-word
const noCeiling = validateArticleContract({
  ...contractBase,
  wordBounds: { min: 2000 },
  content: `# ${brief.briefedH1}\n\n${"word ".repeat(3000)}.\n`,
});
assert.ok(!noCeiling.reasons.some((reason) => reason.includes("exceeds the briefed maximum")));

/* ---------------------------------------------------------------- */
/* The required link must not be rejected as an invented URL         */
/* ---------------------------------------------------------------- */

const withRequiredLink = reviewArticle({
  content:
    "# How to Choose a Next.js SaaS Starter Kit in 2026\n\nIntro prose about picking a starter kit for a new product.\n\n## Where to Find Next.js Starter Kits\n\nYou can [explore Next.js templates and starter kits](https://www.devkitmarket.com/templates) to see how categories differ in practice.\n",
  focusKeyword: input.focusKeyword,
  policy,
});
assert.deepEqual(
  withRequiredLink.blockers.filter((violation) => violation.rule.startsWith("R12.") || violation.rule.startsWith("R8.")),
  []
);

// An invented sibling URL on the same site is still a blocker.
const inventedPage = reviewArticle({
  content: "# Next.js SaaS starter kit guide\n\nSee our [pricing page](/pricing) for details.\n",
  focusKeyword: input.focusKeyword,
  policy,
});
assert.ok(inventedPage.blockers.some((violation) => violation.rule === "R8.invented-internal-link"));

/* ---------------------------------------------------------------- */
/* Every field is optional                                           */
/* ---------------------------------------------------------------- */

// An empty brief normalizes to nothing rather than throwing.
assert.deepEqual(normalizeBrief({}).normalized.brief, {});
assert.equal(normalizeBrief(null).normalized.title, undefined);
assert.equal(isBriefSubmission(null), false);
assert.equal(isBriefSubmission({ title: "A flat submission title" }), false);

// A two-field brief is valid: everything absent falls back to the defaults.
const minimal = blogInputSchema.parse({
  blogTitle: "A minimal brief that still has a long enough title",
  seo: { focusKeyword: "minimal brief" },
});
assert.equal(minimal.focusKeyword, "minimal brief");
assert.deepEqual(minimal.primaryKeywords, ["minimal brief"]);
assert.equal(minimal.contentLength, 2000);
assert.equal(minimal.tone, "professional");
assert.equal(minimal.priority, "NORMAL");
assert.equal(minimal.outlineJson, undefined);
assert.equal(minimal.briefDirectives, undefined);
assert.equal(minimal.contentBounds, undefined);

// Partial nesting: only an outline, only a length, only links.
const outlineOnly = blogInputSchema.parse({
  blogTitle: "A brief with only an outline block",
  outlineJson: { h1: "A brief with only an outline block", sections: [{ heading: "First section", keyPoints: ["a point"] }] },
});
assert.equal((outlineOnly.outlineJson as { sections: { heading: string }[] }).sections[0].heading, "First section");
assert.equal(outlineOnly.briefedH1, "A brief with only an outline block");

const lengthOnly = blogInputSchema.parse({
  blogTitle: "A brief with only a content length block",
  contentLength: { targetWordCount: 1500, minimumWordCount: 1200 },
});
assert.equal(lengthOnly.contentLength, 1500);
assert.deepEqual(lengthOnly.contentBounds, { min: 1200 });

// A flat submission is untouched by the normalizer.
const flat = blogInputSchema.parse({
  title: "A flat submission that still works exactly as before",
  focusKeyword: "flat submission",
  contentLength: 1800,
  internalLinks: ["/blog/a"],
});
assert.equal(flat.contentLength, 1800);
assert.equal(flat.briefedH1, undefined);
assert.deepEqual(flat.internalLinks, ["/blog/a"]);

console.log("All brief-submission tests passed successfully!");
process.exit(0);
