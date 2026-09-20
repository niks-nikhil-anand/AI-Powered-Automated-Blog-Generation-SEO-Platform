import assert from "node:assert/strict";
import { blogInputSchema, slugifyTitle, splitKeywords } from "../app/dashboard/blogs/new/types";
import { outlineFromUserInput, parseUserOutline } from "../workers/outline-worker/user-outline";
import { OutlineResultSchema, OutlineSectionSchema } from "../workers/outline-worker/types";
import { wordRange } from "../workers/writing-worker/vertex";

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

console.log("manual-blog-input tests passed");
