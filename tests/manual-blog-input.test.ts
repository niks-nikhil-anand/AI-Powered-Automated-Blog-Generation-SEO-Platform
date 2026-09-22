import assert from "node:assert/strict";
import { blogInputSchema, slugifyTitle, splitKeywords } from "../app/dashboard/blogs/new/types";
import { outlineFromUserInput, parseUserOutline } from "../workers/outline-worker/user-outline";
import { OutlineResultSchema, OutlineSectionSchema } from "../workers/outline-worker/types";
import { wordRange } from "../workers/writing-worker/vertex";
import { canonicalEvidenceSources } from "../workers/shared/evidence";

/* ---------------------------------------------------------------- */
/* Submission schema                                                 */
/* ---------------------------------------------------------------- */

const minimal = blogInputSchema.parse({ title: "How to Master React Hooks" });
assert.equal(minimal.tone, "professional");
assert.equal(minimal.contentLength, 2000);
assert.equal(minimal.priority, "NORMAL");
assert.equal(minimal.startNow, true);
assert.deepEqual(minimal.primaryKeywords, []);

// A title under 10 characters is the one thing a submission cannot omit or fudge.
assert.equal(blogInputSchema.safeParse({ title: "Too short" }).success, false);
assert.equal(blogInputSchema.safeParse({}).success, false);
assert.equal(blogInputSchema.safeParse({ title: "A perfectly fine title", contentLength: 400 }).success, false);
assert.equal(blogInputSchema.safeParse({ title: "A perfectly fine title", contentLength: 9000 }).success, false);
assert.equal(blogInputSchema.safeParse({ title: "A perfectly fine title", tone: "snarky" }).success, false);

// Sources are optional context. They can be URL-only now because source
// validation no longer blocks the pipeline by default.
assert.equal(
  blogInputSchema.safeParse({
    title: "A perfectly fine title",
    sources: [{ url: "https://example.com", title: "Example", evidence: [] }],
  }).success,
  true
);
assert.equal(
  blogInputSchema.safeParse({
    title: "A perfectly fine title",
    sources: [{ url: "not-a-url", title: "Example", evidence: ["a fact"] }],
  }).success,
  false
);
assert.equal(
  blogInputSchema.safeParse({
    title: "A perfectly fine title",
    sources: [{ url: "https://example.com", title: "Example", evidence: ["a fact"] }],
  }).success,
  true
);
const stringSources = blogInputSchema.parse({
  title: "A perfectly fine title",
  sources: ["https://example.com/reference"],
});
assert.equal(stringSources.sources?.[0]?.url, "https://example.com/reference");
assert.equal(stringSources.sources?.[0]?.title, "example.com");
assert.ok(stringSources.sources?.[0]?.evidence[0].includes("https://example.com/reference"));
const markdownSourceUrl = blogInputSchema.parse({
  title: "A perfectly fine title",
  sources: [{ url: "[https://example.com/a](https://example.com/a)", title: "Example" }],
});
assert.equal(markdownSourceUrl.sources?.[0]?.url, "https://example.com/a");
assert.deepEqual(markdownSourceUrl.sources?.[0]?.evidence, []);
const plannedClaimAliases = blogInputSchema.parse({
  title: "A perfectly fine title",
  plannedClaims: [{ text: "A directly supported claim.", sourceIds: ["S1"] }],
  outlineJson: {
    sections: [
      {
        heading: "Evidence",
        claims: [{ claim: "A directly supported claim.", sourceIds: ["S1"] }],
      },
    ],
  },
});
assert.deepEqual(plannedClaimAliases.plannedClaims, [
  { claim: "A directly supported claim.", evidenceSourceIds: ["S1"], supportLevel: "direct" },
]);
assert.deepEqual(plannedClaimAliases.outlineJson?.sections[0].claims, [
  { text: "A directly supported claim.", evidenceSourceIds: ["S1"] },
]);

assert.equal(slugifyTitle("How to Master React Hooks: A Complete Guide!"), "how-to-master-react-hooks-a-complete-guide");
assert.equal(slugifyTitle("  Spaced   Out  "), "spaced-out");
assert.deepEqual(splitKeywords("react, hooks , , useEffect"), ["react", "hooks", "useEffect"]);

/* ---------------------------------------------------------------- */
/* Editor-supplied outline                                           */
/* ---------------------------------------------------------------- */

assert.equal(parseUserOutline(null), null);
assert.equal(parseUserOutline({ sections: [] }), null);
assert.equal(parseUserOutline({ sections: [{ intent: "no heading" }] }), null);

// Only headings are required - everything else is filled in for the editor.
const sparse = parseUserOutline({ sections: [{ heading: "What is X?" }] });
assert.notEqual(sparse, null);

const outline = outlineFromUserInput(sparse!, {
  title: "How to Master React Hooks",
  metaTitle: null,
  metaDescription: null,
  angle: "Explain hooks through implementation impact",
  slug: "react-hooks-guide",
});
// Sections have to satisfy the same schema a generated outline's do, or the
// writing worker would receive two different shapes depending on origin.
// FAQs are the one exception: an editor may deliberately supply none, and the
// writing worker's mandatory skeleton emits the FAQs section regardless.
assert.equal(OutlineSectionSchema.safeParse(outline.sections[0]).success, true);
assert.deepEqual(outline.faqs, []);
assert.equal(outline.sections[0].heading, "What is X?");
assert.deepEqual(outline.sections[0].claims, []);
assert.ok(outline.sections[0].bullets.length > 0);
assert.equal(outline.metaDescription, "Explain hooks through implementation impact");

// An editor's `answer` becomes the answerIntent the writing prompt consumes.
const withFaqs = parseUserOutline({
  sections: [
    {
      heading: "Setup",
      bullets: ["Install", "Configure"],
      claims: [{ claim: "Setup requires installing the package.", sourceIds: ["S1"] }],
    },
  ],
  faqs: [{ question: "Is it free?", answer: "Yes, entirely." }],
})!;
const faqOutline = outlineFromUserInput(withFaqs, {
  title: "A Title",
  metaTitle: "Custom meta title",
  metaDescription: "Custom meta description",
  angle: "angle",
  slug: "a-title",
});
// With FAQs supplied, the whole outline satisfies the strict schema.
assert.equal(OutlineResultSchema.safeParse(faqOutline).success, true);
assert.equal(faqOutline.faqs[0].answerIntent, "Yes, entirely.");
assert.equal(faqOutline.metaTitle, "Custom meta title");
assert.equal(faqOutline.metaDescription, "Custom meta description");
assert.deepEqual(faqOutline.sections[0].claims, [
  { text: "Setup requires installing the package.", evidenceSourceIds: ["S1"] },
]);

import { buildSectionPlan, DEFAULT_MUST_FOLLOW_RULES } from "../workers/writing-worker/sections";
import { scoreBlogQuality } from "../workers/quality-worker/scorer";
import { validateArticleContract } from "../workers/shared/article-contract";

/* ---------------------------------------------------------------- */
/* Word budget                                                       */
/* ---------------------------------------------------------------- */

const targeted = wordRange(2500);
assert.equal(targeted.min, 2250);
assert.equal(targeted.max, 2750);
// No target = fall back to the env range, whatever it is configured to.
const fallback = wordRange(undefined);
assert.ok(fallback.min > 0 && fallback.max >= fallback.min);
assert.deepEqual(wordRange(0), fallback);

const postgresMongoInput = blogInputSchema.parse({
  title: "PostgreSQL vs MongoDB for Next.js Applications in 2026",
  slug: "postgresql-vs-mongodb-nextjs-2026",
  targetKeyword: "PostgreSQL vs MongoDB",
  secondaryKeywords: [
    "PostgreSQL vs MongoDB for Next.js",
    "Next.js database comparison",
    "MongoDB with Next.js",
    "PostgreSQL with Next.js",
    "Next.js database selection",
  ],
  metaTitle: "PostgreSQL vs MongoDB for Next.js in 2026",
  metaDescription:
    "Compare PostgreSQL and MongoDB for Next.js applications. Explore data modeling, performance, scalability, and how to choose the right database.",
  targetWordCount: 1800,
  internalLinks: [
    "/blog/nextjs-app-router-guide",
    "/blog/prisma-orm-guide",
    "/blog/nextjs-full-stack-architecture",
  ],
  generationInstructions: {
    tone: "Practical, technical, and developer-friendly",
    audience: "Next.js developers building full-stack applications",
    language: "English",
    writingStyle: "Use clear explanations, concise paragraphs, technical examples, and balanced comparisons.",
    requirements: [
      "Explain the core differences between PostgreSQL and MongoDB.",
      "Compare relational and document-based data modeling.",
      "Discuss querying, indexing, transactions, and schema evolution.",
      "Explain how both databases integrate with Next.js.",
      "Include practical TypeScript examples where useful.",
      "Discuss Prisma and MongoDB or PostgreSQL integration considerations.",
      "Compare common application use cases.",
      "Explain scalability and performance trade-offs without unsupported benchmarks.",
      "Provide a practical database selection checklist.",
      "Use the primary keyword naturally without keyword stuffing.",
      "Avoid repetitive content and generic filler.",
      "End with a concise decision framework rather than declaring one database universally better.",
    ],
  },
  outlineJson: {
    sections: [
      {
        heading: "Introduction",
        level: 2,
        description: "Introduce the database choice and why it matters for full-stack Next.js applications.",
        targetWords: 150,
      },
      {
        heading: "PostgreSQL vs MongoDB: Core Differences",
        level: 2,
        description: "Explain relational tables, document collections, data structure, and query models.",
        targetWords: 250,
      },
      {
        heading: "Data Modeling and Schema Flexibility",
        level: 2,
        description: "Compare relational modeling, document modeling, relationships, and schema evolution.",
        targetWords: 250,
      },
      {
        heading: "Performance, Indexing, and Transactions",
        level: 2,
        description: "Compare indexing, query patterns, transactional capabilities, and performance considerations.",
        targetWords: 250,
      },
      {
        heading: "Using PostgreSQL and MongoDB with Next.js",
        level: 2,
        description: "Explain integration patterns with Next.js server-side code and database clients.",
        targetWords: 300,
      },
      {
        heading: "Real-World Use Cases",
        level: 2,
        description: "Compare suitability for SaaS platforms, dashboards, content systems, and flexible data applications.",
        targetWords: 250,
      },
      {
        heading: "How to Choose the Right Database",
        level: 2,
        description: "Provide a practical checklist based on relationships, query patterns, consistency, and team expertise.",
        targetWords: 200,
      },
      {
        heading: "Conclusion",
        level: 2,
        description: "Summarize the trade-offs and provide a concise decision framework for developers.",
        targetWords: 150,
      },
    ],
  },
});

assert.equal(postgresMongoInput.focusKeyword, "PostgreSQL vs MongoDB");
assert.deepEqual(postgresMongoInput.primaryKeywords, ["PostgreSQL vs MongoDB"]);
assert.equal(postgresMongoInput.contentLength, 1800);
assert.equal(postgresMongoInput.audience, "Next.js developers building full-stack applications");
assert.ok(postgresMongoInput.writingInstructions?.some((item) => item.includes("database selection checklist")));
const postgresMongoOutline = parseUserOutline(postgresMongoInput.outlineJson);
assert.notEqual(postgresMongoOutline, null);
const postgresMongoGeneratedOutline = outlineFromUserInput(postgresMongoOutline!, {
  title: postgresMongoInput.title,
  metaTitle: postgresMongoInput.metaTitle ?? null,
  metaDescription: postgresMongoInput.metaDescription ?? null,
  angle: "Next.js database comparison",
  slug: postgresMongoInput.slug ?? "postgresql-vs-mongodb-nextjs-2026",
});
assert.equal(postgresMongoGeneratedOutline.sections[0].intent, "Introduce the database choice and why it matters for full-stack Next.js applications.");
assert.equal(postgresMongoGeneratedOutline.sections[0].wordTarget, 150);
const postgresMongoSectionPlan = buildSectionPlan({
  title: postgresMongoInput.title,
  topic: postgresMongoInput.title,
  description: "Next.js database comparison",
  outline: { sections: postgresMongoGeneratedOutline.sections, faqs: postgresMongoGeneratedOutline.faqs },
  keywords: postgresMongoInput.primaryKeywords,
  targetWords: postgresMongoInput.contentLength,
  specs: postgresMongoInput as Record<string, unknown>,
});
assert.equal(postgresMongoSectionPlan[0].kind, "intro");
assert.equal(postgresMongoSectionPlan[0].wordTarget, 150);
// No table of contents unless the submission asks for one, so the first
// outline section follows the intro directly.
assert.ok(postgresMongoSectionPlan.every((section) => section.kind !== "toc"));
assert.equal(postgresMongoSectionPlan[1].heading, "PostgreSQL vs MongoDB: Core Differences");

/* ---------------------------------------------------------------- */
/* Full custom user specification with subsections & comparisonTable*/
/* ---------------------------------------------------------------- */

const userFullInput = {
  title: "Next.js vs Nuxt vs SvelteKit: Which Framework Should You Choose in 2026?",
  slug: "nextjs-vs-nuxt-vs-sveltekit-2026",
  category: "Web Development",
  focusKeyword: "Next.js vs Nuxt vs SvelteKit",
  primaryKeywords: [
    "Next.js vs Nuxt",
    "Next.js vs SvelteKit",
    "Nuxt vs SvelteKit",
  ],
  secondaryKeywords: [
    "Next.js alternatives",
    "Nuxt framework",
    "SvelteKit framework",
  ],
  competitorKeywords: [
    "Next.js vs Remix",
    "Next.js vs Astro",
  ],
  contentGoal: "Help developers choose the right framework",
  contentAngle: "Pragmatic, real-world comparison",
  uniqueValueProposition: "Unbiased benchmarked guide",
  contentLength: 2500,
  tone: "technical" as const,
  writingInstructions: [
    "Use deep technical explanations",
    "Compare SSR and hydration strategies",
  ],
  generationInstructions: {
    mustFollow: [
      "Generate every section defined in the outline in the exact specified order.",
      "Do not skip, merge, or rename sections unless explicitly instructed.",
      "Generate the requested word count for each section within a reasonable tolerance.",
      "Include every required comparison table, code example, FAQ, and conclusion.",
      "Do not stop generation until all outline sections have been completed.",
      "Never end a section or article mid-sentence.",
      "Ensure every heading in the outline appears in the final article.",
      "Ensure every FAQ question has a complete answer.",
      "Verify factual claims against the provided evidence sources.",
      "Do not invent benchmark results or unsupported technical claims.",
      "Use SEO keywords naturally without keyword stuffing.",
      "Before returning the article, verify that all required sections are present and complete.",
    ],
  },
  internalLinks: [
    "https://example.com/react-guide",
    "https://example.com/vue-guide",
  ],
  outlineJson: {
    sections: [
      {
        heading: "The Modern Full-Stack JavaScript Landscape in 2026",
        intent: "Set context on modern web frameworks",
        paragraphs: [
          {
            heading: "The Shift Towards Hybrid Rendering",
            discuss: ["Server components", "Edge computing"],
            keywords: ["SSR", "hybrid rendering"],
          },
          {
            heading: "Developer Experience vs Runtime Performance",
            discuss: ["Build times", "Bundle size"],
          },
        ],
      },
      {
        heading: "Next.js vs Nuxt vs SvelteKit: Quick Comparison",
        intent: "Provide a quick comparison table",
        comparisonTable: {
          columns: ["Feature", "Next.js", "Nuxt", "SvelteKit"],
          rows: [
            "Ecosystem Size | Massive | Large | Growing",
            "Performance | Great | Great | Exceptional",
          ],
          instructions: "Render a comprehensive Markdown table comparing all three.",
        },
      },
      {
        heading: "Deep Dive: Architectural Differences",
        intent: "Analyze React vs Vue vs Svelte compilation models",
        subsections: [
          {
            heading: "Next.js and React Server Components",
            discuss: ["RSC execution model", "Streaming SSR"],
          },
          {
            heading: "Nuxt and Vue 3 Reactivity",
            discuss: ["Pinia integration", "Nitro engine"],
          },
          {
            heading: "SvelteKit and Runes",
            discuss: ["Compiler approach", "Zero virtual DOM overhead"],
          },
        ],
      },
      {
        heading: "Frequently Asked Questions",
        isFaq: true,
        subsections: [
          {
            heading: "Which framework is easiest for beginners?",
            discuss: ["SvelteKit has the gentlest learning curve"],
          },
          {
            heading: "Which is best for enterprise SaaS?",
            discuss: ["Next.js due to massive ecosystem and talent pool"],
          },
        ],
      },
      {
        heading: "Final Verdict: Making the Right Choice in 2026",
        intent: "Summary and recommendations",
        bullets: ["Decision matrix based on team and requirements"],
      },
    ],
  },
};

const parsedInput = blogInputSchema.parse(userFullInput);
assert.equal(parsedInput.contentLength, 2500);
assert.equal(parsedInput.category, "Web Development");
assert.equal(parsedInput.tone, "technical");
assert.deepEqual(parsedInput.writingInstructions, userFullInput.writingInstructions);
assert.deepEqual(parsedInput.internalLinks, userFullInput.internalLinks);
assert.deepEqual(parsedInput.competitorKeywords, userFullInput.competitorKeywords);
assert.deepEqual(
  parsedInput.generationInstructions?.mustFollow,
  userFullInput.generationInstructions.mustFollow
);

// Outline alias support
const outlineAliasInput = blogInputSchema.parse({
  title: "Test Blog With Outline Alias",
  outline: {
    sections: [{ heading: "Introduction" }, { heading: "Conclusion" }],
  },
});
assert.ok(outlineAliasInput.outlineJson !== undefined);
assert.equal(parseUserOutline(outlineAliasInput.outlineJson)?.sections.length, 2);

// Verify outline preservation
const userOutline = parseUserOutline(parsedInput.outlineJson);
assert.notEqual(userOutline, null);

const generatedOutline = outlineFromUserInput(userOutline!, {
  title: parsedInput.title,
  metaTitle: parsedInput.metaTitle ?? null,
  metaDescription: parsedInput.metaDescription ?? null,
  angle: parsedInput.contentAngle ?? "Comprehensive comparison",
  slug: parsedInput.slug ?? "nextjs-vs-nuxt-vs-sveltekit-2026",
});

assert.equal(generatedOutline.sections.length, 5);
assert.equal(generatedOutline.sections[0].heading, "The Modern Full-Stack JavaScript Landscape in 2026");
assert.equal(generatedOutline.sections[0].subsections?.length, 2);
assert.equal(generatedOutline.sections[0].subsections?.[0].heading, "The Shift Towards Hybrid Rendering");
assert.deepEqual(generatedOutline.sections[0].subsections?.[0].discuss, ["Server components", "Edge computing"]);

assert.equal(generatedOutline.sections[1].comparisonTable?.columns.length, 4);
assert.equal(generatedOutline.sections[1].comparisonTable?.rows.length, 2);

// Auto-extracted FAQs from FAQ section
assert.equal(generatedOutline.faqs.length, 2);
assert.equal(generatedOutline.faqs[0].question, "Which framework is easiest for beginners?");

// Build Section Plan
const sectionPlan = buildSectionPlan({
  title: parsedInput.title,
  topic: parsedInput.title,
  description: "Comprehensive comparison",
  outline: { sections: generatedOutline.sections, faqs: generatedOutline.faqs },
  keywords: parsedInput.primaryKeywords,
  targetWords: 2500,
  specs: parsedInput as Record<string, unknown>,
});

// The plan MUST follow the user's custom outline, not the generic 14-section skeleton!
assert.equal(sectionPlan[0].kind, "intro");
// A table of contents is opt-in now (global content rules R9), so the body
// sections follow the introduction directly.
assert.ok(sectionPlan.every((section) => section.kind !== "toc"));
assert.equal(sectionPlan[1].heading, "The Modern Full-Stack JavaScript Landscape in 2026");
assert.equal(sectionPlan[1].kind, "subsections");
assert.equal(sectionPlan[1].subsections?.length, 2);

assert.equal(sectionPlan[2].heading, "Next.js vs Nuxt vs SvelteKit: Quick Comparison");
assert.equal(sectionPlan[2].kind, "table");
assert.ok(sectionPlan[2].comparisonTable !== undefined);

assert.equal(sectionPlan[3].heading, "Deep Dive: Architectural Differences");
assert.equal(sectionPlan[3].subsections?.length, 3);

assert.equal(sectionPlan[4].heading, "Frequently Asked Questions");
assert.equal(sectionPlan[4].kind, "faq");

assert.equal(sectionPlan[5].heading, "Final Verdict: Making the Right Choice in 2026");

// Opting in restores the table of contents, right after the introduction.
const tocPlan = buildSectionPlan({
  title: userFullInput.title,
  topic: userFullInput.title,
  description: "Framework comparison",
  outline: { sections: generatedOutline.sections, faqs: generatedOutline.faqs },
  keywords: userFullInput.primaryKeywords,
  targetWords: userFullInput.contentLength,
  specs: { ...userFullInput, editorialPolicy: { tableOfContents: true } } as Record<string, unknown>,
});
assert.equal(tocPlan[1].kind, "toc");

// Total word targets must sum to approximately 2500 words
const totalBudgetedWords = sectionPlan.reduce((sum, s) => sum + s.wordTarget, 0);
assert.ok(
  totalBudgetedWords >= 2300 && totalBudgetedWords <= 2700,
  `Budgeted words ${totalBudgetedWords} should be around 2500`
);

const shortContract = validateArticleContract({
  content: `# ${parsedInput.title}

Short intro.

## The Modern Full-Stack JavaScript Landscape in 2026
Tiny section.`,
  targetWords: parsedInput.contentLength,
  outlineSections: generatedOutline.sections,
  focusKeyword: parsedInput.focusKeyword,
  primaryKeywords: parsedInput.primaryKeywords,
  secondaryKeywords: parsedInput.secondaryKeywords,
  metaTitle: parsedInput.title.slice(0, 60),
  metaDescription: "Too short.",
  internalLinks: parsedInput.internalLinks,
});
assert.equal(shortContract.passed, false);
assert.ok(shortContract.reasons.some((reason) => reason.startsWith("Word count")));
assert.ok(shortContract.reasons.some((reason) => reason.includes("Missing outline section")));
assert.ok(shortContract.reasons.some((reason) => reason.includes("SEO meta description")));

const completeContractContent = `# ${parsedInput.title}

Next.js vs Nuxt vs SvelteKit is the central decision for teams choosing a modern full-stack JavaScript framework in 2026. This guide compares the frameworks through architecture, rendering strategy, ecosystem maturity, and team fit. Developers weighing Next.js vs Nuxt, Next.js vs SvelteKit, and Nuxt vs SvelteKit need a practical view of trade-offs, not a generic ranking.

## Table of Contents
- [The Modern Full-Stack JavaScript Landscape in 2026](#the-modern-full-stack-javascript-landscape-in-2026)
- [Next.js vs Nuxt vs SvelteKit: Quick Comparison](#nextjs-vs-nuxt-vs-sveltekit-quick-comparison)
- [Deep Dive: Architectural Differences](#deep-dive-architectural-differences)
- [Frequently Asked Questions](#frequently-asked-questions)
- [Final Verdict: Making the Right Choice in 2026](#final-verdict-making-the-right-choice-in-2026)

## The Modern Full-Stack JavaScript Landscape in 2026
The modern JavaScript landscape is shaped by SSR, hybrid rendering, routing conventions, deployment adapters, and developer experience. Teams compare Next.js alternatives because each framework makes different choices about compilation, data loading, caching, and runtime placement.

### The Shift Towards Hybrid Rendering
Server components and edge computing changed how teams split work between servers, clients, and deployment platforms.

### Developer Experience vs Runtime Performance
Build times, bundle size, and local feedback loops matter because developer experience eventually affects production quality.

## Next.js vs Nuxt vs SvelteKit: Quick Comparison
The quick comparison shows where each framework tends to fit.

| Feature | Next.js | Nuxt | SvelteKit |
| --- | --- | --- | --- |
| Ecosystem Size | Massive | Large | Growing |
| Performance | Great | Great | Exceptional |

## Deep Dive: Architectural Differences
Architecture is the real difference between the three frameworks.

### Next.js and React Server Components
Next.js uses React Server Components, streaming SSR, and file-system routing to support large React applications.

### Nuxt and Vue 3 Reactivity
Nuxt framework applications build on Vue 3 reactivity, Nitro server routes, and convention-driven modules.

### SvelteKit and Runes
SvelteKit framework applications lean on compilation and fine-grained reactivity instead of a virtual DOM.

## Frequently Asked Questions
These questions cover common framework selection concerns.

### Which framework is easiest for beginners?
SvelteKit has a smaller conceptual surface for many teams, though Vue developers may prefer Nuxt.

### Which is best for enterprise SaaS?
Next.js is often practical for enterprise SaaS because the React ecosystem and hiring pool are broad.

## Final Verdict: Making the Right Choice in 2026
Choose based on team skill, rendering needs, deployment model, and long-term maintenance. Review related guides at https://example.com/react-guide and https://example.com/vue-guide. ` + "Next.js vs Nuxt vs SvelteKit architecture trade-offs help teams choose wisely. ".repeat(190);

const completeContract = validateArticleContract({
  content: completeContractContent,
  targetWords: parsedInput.contentLength,
  outlineSections: generatedOutline.sections,
  focusKeyword: parsedInput.focusKeyword,
  primaryKeywords: parsedInput.primaryKeywords,
  secondaryKeywords: parsedInput.secondaryKeywords,
  metaTitle: parsedInput.title.slice(0, 60),
  metaDescription: "A practical technical comparison of Next.js, Nuxt, and SvelteKit for developers choosing a full-stack JavaScript framework in 2026.",
  internalLinks: parsedInput.internalLinks,
});
assert.equal(completeContract.passed, true, completeContract.reasons.join("; "));

// Quality Scorer with Custom Outline
const sampleContent = `# ${parsedInput.title}

In 2026, choosing a JavaScript framework is harder than ever.

## Table of Contents
- [The Modern Full-Stack JavaScript Landscape in 2026](#the-modern-full-stack-javascript-landscape-in-2026)
- [Next.js vs Nuxt vs SvelteKit: Quick Comparison](#nextjs-vs-nuxt-vs-sveltekit-quick-comparison)
- [Deep Dive: Architectural Differences](#deep-dive-architectural-differences)
- [Frequently Asked Questions](#frequently-asked-questions)
- [Final Verdict: Making the Right Choice in 2026](#final-verdict-making-the-right-choice-in-2026)

## The Modern Full-Stack JavaScript Landscape in 2026
Modern web development demands agility and speed.

### The Shift Towards Hybrid Rendering
Edge rendering and server components dominate.

### Developer Experience vs Runtime Performance
DX and user performance must be balanced.

## Next.js vs Nuxt vs SvelteKit: Quick Comparison
| Feature | Next.js | Nuxt | SvelteKit |
| :--- | :--- | :--- | :--- |
| Ecosystem | Massive | Large | Growing |

## Deep Dive: Architectural Differences
Let us examine the compilation paradigms.

### Next.js and React Server Components
React Server Components minimize client bundles.

### Nuxt and Vue 3 Reactivity
Reactivity in Vue 3 is powered by Proxies.

### SvelteKit and Runes
Runes provide granular compiler-driven reactivity.

## Frequently Asked Questions
Common queries from developers.

### Which framework is easiest for beginners?
SvelteKit has the gentlest learning curve.

### Which is best for enterprise SaaS?
Next.js offers the widest tooling support.

## Final Verdict: Making the Right Choice in 2026
Select based on your team's background and project requirements.
` + "word ".repeat(1800);

async function runAsyncTests() {
  const qualityReport = await scoreBlogQuality({
    id: "test-blog",
    title: parsedInput.title,
    slug: parsedInput.slug ?? "nextjs-vs-nuxt-vs-sveltekit-2026",
    content: sampleContent,
    excerpt: "Comparison of top frameworks",
    blogInputId: "test-input",
    outline: { sections: generatedOutline.sections },
    seo: {
      metaTitle: parsedInput.title,
      metaDescription: "Guide to Next.js vs Nuxt vs SvelteKit in 2026",
      keywords: parsedInput.primaryKeywords,
      schema: {},
    },
  });
  assert.ok(qualityReport.checks.some((check) => check.label === "Article Contract"));

  assert.equal(DEFAULT_MUST_FOLLOW_RULES.length, 12);
  assert.ok(
    DEFAULT_MUST_FOLLOW_RULES.includes(
      "Generate every section defined in the outline in the exact specified order."
    )
  );

  const defaultSectionsContent = `# A Complete Guide to Modern Web Tools

Introduction text.

## Table of Contents
- [What is Web Tools](#what-is-web-tools)
- [Why it matters](#why-it-matters)
- [Key Features](#key-features)
- [Benefits](#benefits)
- [How it Works](#how-it-works)
- [Real World Use Cases](#real-world-use-cases)
- [Pros and Cons](#pros-and-cons)
- [Best Practices](#best-practices)
- [Common Mistakes](#common-mistakes)
- [FAQs](#faqs)
- [Conclusion](#conclusion)
- [Call To Action](#call-to-action)

## What is Web Tools
Definition.

## Why it matters
Importance.

## Key Features
Features.

## Benefits
Benefits.

## How it Works
Workflow.

## Real World Use Cases
Use cases.

## Pros and Cons
| Pro | Con |
| --- | --- |
| Fast | Complex |

## Best Practices
1. Practice 1.

## Common Mistakes
- Mistake 1.

## FAQs
### Question 1?
Answer 1.

## Conclusion
Wrap up.

## Call To Action
CTA paragraph.
` + "word ".repeat(1800);

  const defaultReport = await scoreBlogQuality({
    id: "test-default-blog",
    title: "A Complete Guide to Modern Web Tools",
    slug: "a-complete-guide-to-modern-web-tools",
    content: defaultSectionsContent,
    excerpt: "Overview of modern web tools",
    blogInputId: "default-input",
    seo: {
      metaTitle: "A Complete Guide to Modern Web Tools",
      metaDescription: "Guide to modern web tools",
      keywords: ["web tools"],
      schema: {},
    },
  });
  const defaultCompleteness = defaultReport.checks.find((c) => c.label === "Content Completeness");
  assert.ok(defaultCompleteness !== undefined);
  assert.equal(
    defaultCompleteness.score,
    10,
    `Standard 12 sections should score 10/10, got ${defaultCompleteness.score} (${defaultCompleteness.notes.join(", ")})`
  );
  // Verify that an unsourced submission (evidenceArticles: null/undefined) does not trigger evidence gate
  const unsourcedSources = canonicalEvidenceSources(null);
  assert.equal(unsourcedSources.length, 0);
  const isSourced = unsourcedSources.length > 0;
  assert.equal(isSourced, false);

  console.log("All manual-blog-input tests passed successfully!");
  process.exit(0);
}

runAsyncTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
