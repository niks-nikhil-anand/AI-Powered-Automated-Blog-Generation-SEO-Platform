import assert from "node:assert/strict";
import { reviewArticle, buildGlobalRulesBlock, shingleSimilarity, splitCode } from "../workers/shared/editorial-rules";
import { DEFAULT_EDITORIAL_POLICY, resolveEditorialPolicy } from "../workers/shared/editorial-policy";
import { findDeprecatedTerminology } from "../workers/shared/terminology";

/*
 * The global content rules, as tests. Each block pins one rule: a clean
 * article must stay clean (false positives here stall the pipeline), and a
 * violating article must name the rule it broke.
 */

const KEYWORD = "Next.js SEO";

const rules = (content: string, overrides: Parameters<typeof reviewArticle>[0] | Record<string, unknown> = {}) =>
  reviewArticle({
    content,
    focusKeyword: KEYWORD,
    metaTitle: "Next.js SEO: rendering and metadata",
    metaDescription:
      "How rendering strategy and the Metadata API shape what search engines can crawl, index and display for a Next.js application.",
    ...(overrides as object),
  });

const ruleIds = (content: string, overrides: Record<string, unknown> = {}) =>
  rules(content, overrides).violations.map((violation) => violation.rule);

/* ---------------------------------------------------------------- */
/* A clean article stays clean                                       */
/* ---------------------------------------------------------------- */

const CLEAN = `# Next.js SEO: rendering, metadata and crawlability

Search engines can only rank what they can fetch and parse. Next.js SEO work therefore starts with a rendering decision, because that decision determines whether a crawler receives finished HTML or an empty shell it has to execute first.

This guide walks through the rendering choices, the Metadata API, and the checks worth running before a release. It assumes you are comfortable with the App Router and have a site already deployed somewhere.

## Choosing a rendering strategy

Static generation produces HTML at build time, which suits pages whose content changes infrequently. Server rendering produces HTML per request, which suits pages that depend on the visitor or on data that changes minute to minute. Incremental regeneration sits between the two: a static page with a revalidation window.

None of these choices makes a page rank. They change what a crawler receives and how quickly, which is a precondition for indexing rather than a ranking lever. Whether a page is then indexed depends on the crawler's own scheduling and on the rest of the site.

## Declaring metadata

The App Router exposes metadata as data rather than as markup you assemble by hand:

\`\`\`ts
export const metadata = {
  title: "Rendering strategies in the App Router",
  description: "How static, server and incremental rendering change what a crawler receives.",
  alternates: { canonical: "https://example.com/rendering-strategies" },
};
\`\`\`

Keep the canonical absolute and pointing at the page a visitor would share. The title here is the one search engines may display, so write it for a person deciding whether to click.

## Verifying what crawlers receive

Fetch the deployed page without JavaScript and read the HTML you get back. If the headline, the body copy and the canonical are missing from that response, the rendering strategy is not delivering what you assumed, and no amount of metadata work compensates for it.

Run that check against a production build rather than the development server, since the two can differ in how they stream and cache responses.

## Conclusion

Decide the rendering strategy first, declare metadata as data, then verify the deployed HTML rather than trusting the framework. Start with the single template that generates most of your pages.
`;

const clean = rules(CLEAN);
assert.deepEqual(
  clean.violations.map((violation) => `${violation.rule}: ${violation.message}`),
  [],
  "the clean article should trip no rules"
);
assert.equal(clean.passed, true);

/* ---------------------------------------------------------------- */
/* R2 - keyword restraint                                            */
/* ---------------------------------------------------------------- */

const stuffedParagraph = `Next.js SEO matters because Next.js SEO decides crawlability. Improving Next.js SEO means auditing Next.js SEO signals with Next.js SEO tooling.`;
const STUFFED = `# Next.js SEO guide

${stuffedParagraph}

${stuffedParagraph}

## Next.js SEO basics

${stuffedParagraph}

## Next.js SEO checklist

${stuffedParagraph}

## Next.js SEO tooling

${stuffedParagraph}
`;
const stuffed = ruleIds(STUFFED);
assert.ok(stuffed.includes("R2.density"), "keyword stuffing should be flagged");
assert.ok(stuffed.includes("R2.paragraph-spread"), "keyword in every paragraph should be flagged");
assert.ok(stuffed.includes("R2.heading-stuffing"), "keyword-shaped headings should be flagged");
assert.ok(stuffed.includes("R2.consecutive-sentences"));
assert.equal(rules(STUFFED).passed, false);

// An H1 that repeats the keyword is a blocker; a long, list-shaped one is a warning.
const repeatedH1 = rules("# Next.js SEO: The Complete Next.js SEO Guide\n\nBody.\n");
assert.ok(repeatedH1.blockers.some((violation) => violation.rule === "R1.h1-repetition"));
assert.ok(
  ruleIds("# Next.js SEO, Core Web Vitals, Metadata, Sitemaps: Everything for Developers and Teams\n\nBody.\n").includes(
    "R1.h1-keyword-list"
  )
);
// No focus keyword configured: the keyword rules simply don't apply.
assert.deepEqual(
  reviewArticle({ content: STUFFED }).violations.filter((violation) => violation.rule.startsWith("R2.")),
  []
);

/* ---------------------------------------------------------------- */
/* R5/R12 - claims the technology cannot make                        */
/* ---------------------------------------------------------------- */

for (const claim of [
  "Static generation guarantees higher rankings for every page.",
  "This setup ensures top rankings within weeks.",
  "Adding the sitemap automatically improves your rankings.",
  "A prerendered page will rank higher than a client-rendered one.",
  "The App Router offers guaranteed indexability.",
]) {
  const result = rules(`# Next.js SEO basics\n\n${claim}\n\n## Detail\n\nMore prose that explains the mechanism properly for the reader.\n`);
  assert.ok(
    result.blockers.some((violation) => violation.rule === "R5.unsupported-claim"),
    `unsupported claim not caught: ${claim}`
  );
}

// Calibrated phrasing about the same mechanisms must NOT trip the check.
const calibrated = rules(
  "# Next.js SEO basics\n\nPrerendering makes finished HTML available to a crawler, which is a precondition for indexing rather than a ranking guarantee. Whether the page is indexed still depends on crawl scheduling and site quality.\n\n## Detail\n\nMore prose that explains the mechanism properly for the reader of this guide.\n"
);
assert.deepEqual(calibrated.violations.filter((violation) => violation.rule === "R5.unsupported-claim"), []);

assert.ok(
  ruleIds("# Next.js SEO basics\n\nThis blazing-fast setup is best-in-class for crawlability across the board.\n").includes(
    "R19.marketing-tone"
  )
);

/* ---------------------------------------------------------------- */
/* R7 - code examples                                                */
/* ---------------------------------------------------------------- */

const unterminated = rules("# Next.js SEO basics\n\nExample:\n\n```ts\nexport const metadata = {\n");
assert.ok(unterminated.blockers.some((violation) => violation.rule === "R7.unterminated-fence"));

const unbalanced = rules("# Next.js SEO basics\n\nExample:\n\n```ts\nexport function sitemap() {\n  return [{ url: \"https://example.com\" }];\n```\n");
assert.ok(unbalanced.blockers.some((violation) => violation.rule === "R7.unbalanced"));

const dangling = rules("# Next.js SEO basics\n\nExample:\n\n```ts\nconst canonical = `https://example.com/${slug\n```\n");
assert.ok(dangling.blockers.some((violation) => violation.rule === "R7.truncated-template"));

const badJson = rules('# Next.js SEO basics\n\nExample:\n\n```json\n{ "title": "Page", }\n```\n');
assert.ok(badJson.blockers.some((violation) => violation.rule === "R7.invalid-json"));

const goodJson = rules('# Next.js SEO basics\n\nExample:\n\n```json\n{ "title": "Page" }\n```\n');
assert.deepEqual(goodJson.blockers.filter((violation) => violation.rule.startsWith("R7.")), []);

assert.ok(ruleIds("# Next.js SEO basics\n\nExample:\n\n```\nconst a = 1;\n```\n").includes("R7.missing-language"));

// "..." is fine when the prose says the sample is abbreviated.
const ellipsis = "# Next.js SEO basics\n\nAn abbreviated example:\n\n```ts\nconst config = {\n  ...\n};\n```\n";
assert.deepEqual(
  rules(ellipsis).violations.filter((violation) => violation.rule === "R7.unlabelled-ellipsis"),
  []
);

/* ---------------------------------------------------------------- */
/* R8/R9/R10/R12 - links, table of contents, URLs                    */
/* ---------------------------------------------------------------- */

const TOC_ARTICLE = `# Next.js SEO basics

Intro prose about rendering and metadata for the reader of this guide.

## Table of Contents

- [Rendering](#rendering)

## Rendering

Prose about rendering that is long enough to count as a real section of the article.
`;
const withToc = rules(TOC_ARTICLE);
assert.ok(withToc.blockers.some((violation) => violation.rule === "R9.table-of-contents"));
assert.ok(withToc.blockers.some((violation) => violation.rule === "R9.anchor-links"));

// Opted in, both are fine.
const tocAllowed = rules(TOC_ARTICLE, {
  policy: { ...DEFAULT_EDITORIAL_POLICY, tableOfContents: true, anchorLinks: true },
});
assert.deepEqual(tocAllowed.blockers.filter((violation) => violation.rule.startsWith("R9.")), []);

const invented = rules("# Next.js SEO basics\n\nSee our [services page](/services) and [pricing](/pricing).\n");
assert.equal(invented.blockers.filter((violation) => violation.rule === "R8.invented-internal-link").length, 2);

const approvedInternal = rules("# Next.js SEO basics\n\nSee our [services page](/services).\n", {
  policy: { ...DEFAULT_EDITORIAL_POLICY, internalLinks: ["/services"] },
});
assert.deepEqual(approvedInternal.blockers.filter((violation) => violation.rule === "R8.invented-internal-link"), []);

assert.ok(
  ruleIds("# Next.js SEO basics\n\n## Internal Linking\n\nLink to the pillar page from each cluster article as described.\n").includes(
    "R8.internal-linking-section"
  )
);

const unapproved = rules("# Next.js SEO basics\n\nAccording to [this study](https://made-up-research.example-not-real.io/report), rankings doubled.\n");
assert.ok(unapproved.blockers.some((violation) => violation.rule === "R12.unapproved-url"));

// An approved source - matched by host, so a different path on the same
// domain is still fine - and placeholder domains are always allowed.
const approvedSource = rules(
  "# Next.js SEO basics\n\nSee [the docs](https://nextjs.org/docs/app/api-reference/functions/generate-metadata) and [your site](https://example.com/page).\n",
  { approvedUrls: ["https://nextjs.org/docs"] }
);
assert.deepEqual(approvedSource.blockers.filter((violation) => violation.rule === "R12.unapproved-url"), []);

// External linking can be opened up explicitly.
const openLinks = rules("# Next.js SEO basics\n\nSee [a post](https://some-blog.dev/post).\n", {
  policy: { ...DEFAULT_EDITORIAL_POLICY, externalLinks: "allowed" },
});
assert.deepEqual(openLinks.blockers.filter((violation) => violation.rule === "R12.unapproved-url"), []);

/* ---------------------------------------------------------------- */
/* R16/R17 - completeness and repetition                             */
/* ---------------------------------------------------------------- */

assert.ok(
  rules("# Next.js SEO basics\n\nIntro prose for the reader.\n\n## Rendering\n\n## Metadata\n\nReal prose under this heading that says something useful about metadata.\n")
    .blockers.some((violation) => violation.rule === "R17.empty-section")
);

assert.ok(
  rules("# Next.js SEO basics\n\nIntro prose.\n\n## Rendering\n\nTODO: write this section.\n").blockers.some(
    (violation) => violation.rule === "R17.placeholder"
  )
);

assert.ok(
  rules("# Next.js SEO basics\n\nIntro prose.\n\n## Rendering\n\nProse.\n\n## Rendering\n\nMore prose.\n").blockers.some(
    (violation) => violation.rule === "R16.duplicate-heading"
  )
);

const repeated = `Static generation builds HTML at build time and serves the same response to every visitor, which keeps the crawler's job simple and fast in practice.`;
const DUPLICATED = `# Next.js SEO basics

Intro prose for the reader of this article about rendering choices.

## Rendering strategies

${repeated} ${repeated} ${repeated}

## Static generation explained

${repeated} ${repeated} ${repeated}
`;
const duplicated = ruleIds(DUPLICATED);
assert.ok(duplicated.includes("R16.duplicate-section"));
assert.ok(duplicated.includes("R16.repeated-sentence"));

/* ---------------------------------------------------------------- */
/* R14/R15 - introduction and conclusion                             */
/* ---------------------------------------------------------------- */

assert.ok(
  ruleIds("# Next.js SEO basics\n\nIn today's rapidly evolving digital landscape, search visibility is everything.\n\n## Rendering\n\nProse that explains the rendering options available to a team in practice.\n").includes(
    "R14.cliche-opener"
  )
);

const introText =
  "Search engines can only rank what they can fetch, so the rendering decision comes first and everything else about metadata follows from it in practice.";
assert.ok(
  ruleIds(`# Next.js SEO basics\n\n${introText} ${introText}\n\n## Rendering\n\nProse about the rendering options a team can pick between.\n\n## Conclusion\n\n${introText} ${introText}\n`).includes(
    "R15.conclusion-repeats-intro"
  )
);

/* ---------------------------------------------------------------- */
/* R6 - terminology, R11 - metadata                                  */
/* ---------------------------------------------------------------- */

const outdated = findDeprecatedTerminology("Core Web Vitals covers LCP, CLS and First Input Delay across the site.");
assert.equal(outdated.length, 1);
assert.equal(outdated[0].id, "fid");
// Mentioning the replacement makes it a history lesson, not an error.
assert.deepEqual(
  findDeprecatedTerminology("Core Web Vitals replaced First Input Delay with Interaction to Next Paint (INP)."),
  []
);
// Out of scope: no Core Web Vitals context, no finding.
assert.deepEqual(findDeprecatedTerminology("The FID sensor reports engine data."), []);

assert.ok(
  rules("# Next.js SEO basics\n\nIntro prose about rendering for this guide.\n", {
    metaTitle: "Next.js SEO: the Next.js SEO guide",
  }).warnings.some((violation) => violation.rule === "R11.meta-title-stuffing")
);

/* ---------------------------------------------------------------- */
/* Helpers                                                           */
/* ---------------------------------------------------------------- */

const split = splitCode("Prose here.\n\n```ts\nconst a = 1;\n```\n\nMore prose with `inline code` in it.\n");
assert.equal(split.blocks.length, 1);
assert.equal(split.blocks[0].lang, "ts");
assert.equal(split.unterminated, false);
assert.ok(!split.prose.includes("const a = 1"));
assert.ok(!split.prose.includes("inline code"));

assert.equal(shingleSimilarity("one two three four five six", "one two three four five six"), 1);
assert.equal(shingleSimilarity("one two three four five", "nothing alike here at all"), 0);

/* ---------------------------------------------------------------- */
/* Policy resolution                                                 */
/* ---------------------------------------------------------------- */

assert.deepEqual(resolveEditorialPolicy(undefined), DEFAULT_EDITORIAL_POLICY);
assert.equal(resolveEditorialPolicy({ editorialPolicy: { tableOfContents: true } }).tableOfContents, true);
assert.equal(resolveEditorialPolicy({ specs: { editorialPolicy: { anchorLinks: true } } }).anchorLinks, true);
// A bare internalLinks array is the editor approving those links.
assert.deepEqual(resolveEditorialPolicy({ internalLinks: ["/blog/a"] }).internalLinks, ["/blog/a"]);
assert.equal(resolveEditorialPolicy({ editorialPolicy: { externalLinks: "allowed" } }).externalLinks, "allowed");
assert.equal(resolveEditorialPolicy({ editorialPolicy: { externalLinks: "nonsense" } }).externalLinks, "evidence-only");

/* ---------------------------------------------------------------- */
/* Prompt block                                                      */
/* ---------------------------------------------------------------- */

const defaultRules = buildGlobalRulesBlock(DEFAULT_EDITORIAL_POLICY, KEYWORD);
assert.ok(defaultRules.includes(KEYWORD));
assert.ok(/Do not add a Table of Contents/i.test(defaultRules));
assert.ok(/Do not create internal links/i.test(defaultRules));
assert.ok(/example@\.?com|example\.com/i.test(defaultRules));

const linkedRules = buildGlobalRulesBlock(
  { ...DEFAULT_EDITORIAL_POLICY, internalLinks: ["/blog/a"], tableOfContents: true },
  KEYWORD
);
assert.ok(linkedRules.includes("/blog/a"));
assert.ok(/plain list of section names/i.test(linkedRules));
assert.ok(!/Do not add a Table of Contents/i.test(linkedRules));

console.log("All editorial-rules tests passed successfully!");
