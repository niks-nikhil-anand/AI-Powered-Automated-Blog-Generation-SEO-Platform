import assert from "node:assert/strict";
import {
  cleanBriefText,
  containsKeyword,
  ensureKeywordInH1,
  ensureKeywordInTitle,
  extractH1,
  truncateAtWordBoundary,
} from "../workers/shared/seo-keyword";
import { validateArticleContract } from "../workers/shared/article-contract";
import { enforceSingleH1, ensureBriefedFaqs, ensureFocusKeywordInH2 } from "../workers/writing-worker/vertex";
import { enforceFocusKeyword } from "../workers/outline-worker/vertex";
import { outlineFromUserInput } from "../workers/outline-worker/user-outline";

/*
 * Focus-keyword placement. The article contract requires the focus keyword
 * verbatim in the H1, the introduction, and at least one H2, and nothing
 * upstream used to guarantee any of it - a draft titled "How to Optimize Your
 * Website for Google" failed the gate and burned a full retry. These tests pin
 * the guarantee, not the prompt wording.
 */

const KEYWORD = "Next.js SEO";

/* ---------------------------------------------------------------- */
/* Matching                                                          */
/* ---------------------------------------------------------------- */

assert.equal(containsKeyword("Next.js SEO: A Practical Guide", KEYWORD), true);
assert.equal(containsKeyword("next.js seo for beginners", KEYWORD), true);
// Editors paste from docs: a non-breaking space, a curly quote or an em dash
// must not decide whether an article passes the gate.
assert.equal(containsKeyword("Next.js SEO in 2026", KEYWORD), true);
assert.equal(containsKeyword("Advanced Next.js SEO — Part 2", KEYWORD), true);
assert.equal(containsKeyword("The developer’s guide to Next.js SEO", "The developer's guide to Next.js SEO"), true);
assert.equal(cleanBriefText("Next.js Middleware to Proxy &#x20;"), "Next.js Middleware to Proxy");
assert.equal(containsKeyword("## Next.js Middleware to Proxy patterns", "Next.js Middleware to Proxy &#x20;"), true);
// The match stays literal: a reworded variant is a different search phrase.
assert.equal(containsKeyword("Next JS SEO tips", KEYWORD), false);
assert.equal(containsKeyword("SEO for Next.js", KEYWORD), false);
assert.equal(containsKeyword("", KEYWORD), false);
assert.equal(containsKeyword("Next.js SEO", ""), false);

/* ---------------------------------------------------------------- */
/* Title repair                                                      */
/* ---------------------------------------------------------------- */

// Already keyworded: byte-identical back, so re-running over a stored title
// can never drift it.
const keyworded = "Next.js SEO: How to Rank in 2026";
assert.equal(ensureKeywordInTitle(keyworded, KEYWORD), keyworded);
assert.equal(ensureKeywordInTitle(ensureKeywordInTitle(keyworded, KEYWORD), KEYWORD), keyworded);

// Missing: prefixed once, then idempotent.
const repaired = ensureKeywordInTitle("How to Optimize Your Website for Google", KEYWORD);
assert.equal(repaired, "Next.js SEO: How to Optimize Your Website for Google");
assert.equal(ensureKeywordInTitle(repaired, KEYWORD), repaired);

// No keyword configured: nothing happens.
assert.equal(ensureKeywordInTitle("Plain Title", undefined), "Plain Title");
assert.equal(ensureKeywordInTitle("Plain Title", "   "), "Plain Title");

// Meta title: within the contract's 60-char limit, cut at a word boundary,
// keyword kept.
const metaTitle = ensureKeywordInTitle("How to Optimize Your Next Website for Google Search in 2026", KEYWORD, {
  maxLength: 60,
});
assert.ok(metaTitle.length <= 60, `meta title too long: ${metaTitle.length}`);
assert.ok(containsKeyword(metaTitle, KEYWORD));
assert.ok(!/[\s:,-]$/.test(metaTitle), `meta title ends mid-phrase: ${metaTitle}`);
// An already-short title is neither padded nor mangled.
assert.equal(ensureKeywordInTitle("Next.js SEO Basics", KEYWORD, { maxLength: 60 }), "Next.js SEO Basics");
// A keyword longer than the cap is kept whole - truncating it would defeat the
// point of having one.
const longKeyword = "a".repeat(70);
assert.equal(ensureKeywordInTitle("Some Title", longKeyword, { maxLength: 60 }), longKeyword);

assert.equal(truncateAtWordBoundary("short", 60), "short");
assert.ok(truncateAtWordBoundary("one two three four five six seven eight", 20).length <= 20);
assert.equal(truncateAtWordBoundary("one two three four five six seven eight", 20), "one two three four");

/* ---------------------------------------------------------------- */
/* H1 repair                                                         */
/* ---------------------------------------------------------------- */

const draftWithoutKeyword = [
  "# How to Optimize Your Website for Google",
  "",
  "Intro paragraph about Next.js SEO and rendering.",
  "",
  "## Why Next.js SEO matters",
  "",
  "Body.",
].join("\n");

const h1Fixed = ensureKeywordInH1(draftWithoutKeyword, KEYWORD);
assert.equal(h1Fixed.repairedH1, "Next.js SEO: How to Optimize Your Website for Google");
assert.equal(extractH1(h1Fixed.markdown), "Next.js SEO: How to Optimize Your Website for Google");
// Only the H1 line changes - headings and body are untouched.
assert.ok(h1Fixed.markdown.includes("## Why Next.js SEO matters"));
assert.equal(h1Fixed.markdown.split("\n").length, draftWithoutKeyword.split("\n").length);

// A compliant draft comes back exactly as it went in.
const compliant = "# Next.js SEO: The 2026 Guide\n\nBody about Next.js SEO.";
assert.equal(ensureKeywordInH1(compliant, KEYWORD).markdown, compliant);
assert.equal(ensureKeywordInH1(compliant, KEYWORD).repairedH1, null);
// No keyword configured, or no H1 at all: no-op.
assert.equal(ensureKeywordInH1(draftWithoutKeyword, undefined).markdown, draftWithoutKeyword);
assert.equal(ensureKeywordInH1("## Only an H2\n\nBody.", KEYWORD).repairedH1, null);
// A title carrying regex replacement syntax survives verbatim.
const dollarTitle = ensureKeywordInH1("# Pricing $& Plans\n\nBody.", KEYWORD);
assert.equal(extractH1(dollarTitle.markdown), "Next.js SEO: Pricing $& Plans");

// enforceSingleH1 keeps its original job - one H1, extras demoted, a missing
// one synthesised - while adding the keyword guarantee.
const multiH1 = "# First Title\n\nBody.\n\n# Second Title\n\nMore body.";
const single = enforceSingleH1(multiH1, "Fallback Title", KEYWORD);
assert.equal((single.match(/^# /gm) ?? []).length, 1);
assert.equal(extractH1(single), "Next.js SEO: First Title");
assert.ok(single.includes("## Second Title"));

const noH1 = enforceSingleH1("Body only, no heading at all.", "How to Optimize Your Website", KEYWORD);
assert.equal(extractH1(noH1), "Next.js SEO: How to Optimize Your Website");

// Without a focus keyword the behaviour is exactly what it was before.
assert.equal(extractH1(enforceSingleH1(multiH1, "Fallback Title")), "First Title");

/* ---------------------------------------------------------------- */
/* Outline enforcement                                               */
/* ---------------------------------------------------------------- */

const rawOutline = {
  title: "How to Optimize Your Website for Google",
  slug: "how-to-optimize",
  metaTitle: "How to Optimize Your Website for Google in 2026 and Beyond, Fully",
  metaDescription: "A guide.",
  sections: [
    { heading: "Introduction", intent: "set up", bullets: ["b"], claims: [] },
    { heading: "Rendering strategies", intent: "explain", bullets: ["b"], claims: [] },
    { heading: "Metadata", intent: "explain", bullets: ["b"], claims: [] },
  ],
  faqs: [{ question: "q", answerIntent: "a" }],
};

const enforced = enforceFocusKeyword(rawOutline, KEYWORD);
assert.equal(enforced.title, "Next.js SEO: How to Optimize Your Website for Google");
assert.ok(containsKeyword(enforced.metaTitle, KEYWORD));
assert.ok(enforced.metaTitle.length <= 60);
// The introduction's heading is never the one that gets prefixed.
assert.equal(enforced.sections[0].heading, "Introduction");
assert.equal(enforced.sections[1].heading, "Next.js SEO: Rendering strategies");
assert.equal(enforced.sections[2].heading, "Metadata");
// Idempotent, and exactly one heading is ever touched.
const twice = enforceFocusKeyword(enforced, KEYWORD);
assert.deepEqual(
  twice.sections.map((section) => section.heading),
  enforced.sections.map((section) => section.heading)
);
assert.equal(twice.title, enforced.title);

// A model that placed the keyword itself is left alone entirely.
const compliantOutline = {
  ...rawOutline,
  title: "Next.js SEO in 2026",
  metaTitle: "Next.js SEO in 2026",
  sections: [
    { heading: "Introduction", intent: "set up", bullets: ["b"], claims: [] },
    { heading: "Next.js SEO fundamentals", intent: "explain", bullets: ["b"], claims: [] },
  ],
};
assert.deepEqual(
  enforceFocusKeyword(compliantOutline, KEYWORD).sections.map((section) => section.heading),
  compliantOutline.sections.map((section) => section.heading)
);
// No focus keyword: the outline passes through untouched.
assert.deepEqual(enforceFocusKeyword(rawOutline, null), rawOutline);

// An editor-supplied outline keeps its own headings, but the title it
// contributes to the H1 still gets the keyword.
const fromUser = outlineFromUserInput(
  { sections: [{ heading: "Rendering strategies" }, { heading: "Metadata" }] },
  {
    title: "How to Optimize Your Website for Google",
    angle: "practical",
    slug: "how-to-optimize",
    focusKeyword: KEYWORD,
  }
);
assert.equal(fromUser.title, "Next.js SEO: How to Optimize Your Website for Google");
assert.ok(containsKeyword(fromUser.metaTitle, KEYWORD));
assert.deepEqual(
  fromUser.sections.map((section) => section.heading),
  ["Rendering strategies", "Metadata"]
);

/* ---------------------------------------------------------------- */
/* The reported contract failure, end to end                         */
/* ---------------------------------------------------------------- */

const body = [
  "Next.js SEO is the discipline of making a Next.js application legible to search engines.",
  "This guide covers rendering strategies, metadata, and measurement.",
  "",
  "## Why Next.js SEO matters",
  "",
  "Search visibility follows rendering choices, so the framework's defaults matter.",
  "",
  "## Rendering strategies",
  "",
  "Static generation, server rendering, and incremental regeneration each trade freshness for latency.",
].join("\n");

const contractInput = {
  targetWords: 40,
  focusKeyword: KEYWORD,
  metaTitle: "Next.js SEO: How to Optimize for Google",
  metaDescription:
    "A practical guide to Next.js SEO covering rendering strategies, metadata, structured data, and how to measure search performance.",
};

// The reported failure: an H1 that dropped the focus keyword.
const failing = validateArticleContract({
  ...contractInput,
  content: `# How to Optimize Your Website for Google\n\n${body}`,
});
assert.equal(failing.passed, false);
assert.deepEqual(failing.reasons, [`Focus keyword missing from H1: ${KEYWORD}`]);

// After enforcement the same draft passes, and nothing else about it changed.
const fixed = validateArticleContract({
  ...contractInput,
  content: ensureKeywordInH1(`# How to Optimize Your Website for Google\n\n${body}`, KEYWORD).markdown,
});
assert.deepEqual(fixed.reasons, []);
assert.equal(fixed.passed, true);

// The H2 rule is the outline's job, not the H1 fix's: a draft whose headings
// omit the keyword is still reported (enforceFocusKeyword is what prevents it).
const noKeywordH2 = validateArticleContract({
  ...contractInput,
  content: [
    "# Next.js SEO: How to Optimize Your Website",
    "",
    "Next.js SEO is the discipline of making a Next.js application legible to search engines.",
    "This guide covers rendering, metadata, and measurement in enough depth to act on today.",
    "",
    "## Rendering strategies",
    "",
    "Static generation, server rendering, and incremental regeneration trade freshness for latency.",
  ].join("\n"),
});
assert.deepEqual(noKeywordH2.reasons, [`Focus keyword missing from H2 headings: ${KEYWORD}`]);

const repairedH2 = ensureFocusKeywordInH2(
  [
    "# Next.js Middleware to Proxy Guide",
    "",
    "Next.js Middleware to Proxy helps teams reason about routing behavior.",
    "",
    "## Security patterns",
    "",
    "Body.",
  ].join("\n"),
  "Next.js Middleware to Proxy &#x20;"
);
assert.ok(repairedH2.includes("## Next.js Middleware to Proxy: Security patterns"));
assert.deepEqual(
  validateArticleContract({
    targetWords: 20,
    focusKeyword: "Next.js Middleware to Proxy &#x20;",
    metaTitle: "Next.js Middleware to Proxy Guide",
    metaDescription: "A practical guide to Next.js Middleware to Proxy behavior, security considerations, and production implementation details.",
    content: repairedH2,
  }).reasons,
  []
);

const faqRepaired = ensureBriefedFaqs(
  [
    "# Next.js Server Actions",
    "",
    "Next.js Server Actions can mutate application state when called from the application interface.",
    "",
    "## Next.js Server Actions security",
    "",
    "Validate inputs and authorize the operation near the server-side mutation.",
  ].join("\n"),
  [{ question: "Are Next.js Server Actions public endpoints?" }]
);
assert.ok(faqRepaired.includes("## FAQs"));
assert.ok(faqRepaired.includes("### Are Next.js Server Actions public endpoints?"));
assert.ok(
  !validateArticleContract({
    targetWords: 40,
    focusKeyword: "Next.js Server Actions",
    metaTitle: "Next.js Server Actions security",
    metaDescription: "A practical guide to Next.js Server Actions security, validation, authorization, and production behavior for developers.",
    faqQuestions: [{ question: "Are Next.js Server Actions public endpoints?" }],
    content: faqRepaired,
  }).reasons.some((reason) => reason.startsWith("Missing briefed FAQ question(s)"))
);

console.log("All focus-keyword tests passed successfully!");
// The Prisma/pg client imported transitively by the worker modules keeps a
// handle open, so exit explicitly - same as tests/manual-blog-input.test.ts.
process.exit(0);
