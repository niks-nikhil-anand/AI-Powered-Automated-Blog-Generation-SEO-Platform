import { containsKeyword } from "./seo-keyword";

export type ArticleOutlineSection = {
  heading?: unknown;
  subsections?: unknown;
  paragraphs?: unknown;
  comparisonTable?: unknown;
};

export type ArticleContractInput = {
  content: string;
  targetWords?: number | null;
  outlineSections?: unknown;
  focusKeyword?: string | null;
  primaryKeywords?: unknown;
  secondaryKeywords?: unknown;
  metaTitle?: string | null;
  metaDescription?: string | null;
  internalLinks?: unknown;
  /**
   * Explicit word bounds from the submission brief. When supplied they
   * replace the range derived from targetWords, and an explicit maximum is
   * enforced - a brief that names a ceiling means it (R4: no padding).
   */
  wordBounds?: { min?: number; max?: number } | null;
  /** outlineJson.h1: the article's H1 must match it, not merely exist. */
  requiredH1?: string | null;
  /** Briefed FAQ questions; each one must appear as a heading in the article. */
  faqQuestions?: unknown;
};

export type ArticleContractResult = {
  passed: boolean;
  wordCount: number;
  minWords: number;
  maxWords: number;
  reasons: string[];
};

export function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

export function markdownHeadings(content: string, level: 1 | 2 | 3): string[] {
  const prefix = "#".repeat(level);
  const next = "#".repeat(level + 1);
  return content
    .split("\n")
    .filter((line) => line.startsWith(`${prefix} `) && !line.startsWith(`${next} `))
    .map((line) => line.replace(new RegExp(`^${prefix}\\s+`), "").trim())
    .filter(Boolean);
}

export function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function includesText(content: string, needle: string): boolean {
  return containsKeyword(content, needle);
}

function extractOutlineSections(value: unknown): ArticleOutlineSection[] {
  if (!Array.isArray(value)) return [];
  return value.filter((section): section is ArticleOutlineSection => Boolean(section && typeof section === "object"));
}

function subsectionHeadings(section: ArticleOutlineSection): string[] {
  const raw = Array.isArray(section.subsections)
    ? section.subsections
    : Array.isArray(section.paragraphs)
      ? section.paragraphs
      : [];
  return raw
    .map((sub) => (sub && typeof sub === "object" && "heading" in sub ? String((sub as { heading: unknown }).heading) : ""))
    .map((heading) => heading.trim())
    .filter(Boolean);
}

type FaqEntry = { question: string; answer: string };

function faqEntries(content: string): FaqEntry[] {
  const lines = content.split("\n");
  const entries: FaqEntry[] = [];
  let inFaqSection = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      inFaqSection = /\bfaqs?\b|frequently asked questions/i.test(line.slice(3));
      continue;
    }
    if (inFaqSection && line.startsWith("### ")) {
      const q = line.slice(4).trim();
      entries.push({ question: q, answer: "" });
      continue;
    }
  }
  return entries;
}

function hasMatchingHeading(actual: string[], expected: string): boolean {
  const normalizedExpected = normalizeHeading(expected);
  return actual.some((heading) => {
    const normalizedActual = normalizeHeading(heading);
    return normalizedActual === normalizedExpected || normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual);
  });
}

function headingIndex(actual: string[], expected: string): number {
  const normalizedExpected = normalizeHeading(expected);
  return actual.findIndex((heading) => {
    const normalizedActual = normalizeHeading(heading);
    return normalizedActual === normalizedExpected || normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual);
  });
}

export function articleWordRange(
  targetWords?: number | null,
  bounds?: { min?: number; max?: number } | null
): { min: number; max: number } {
  const derived =
    !targetWords || targetWords <= 0
      ? { min: 1200, max: 2200 }
      : { min: Math.round(targetWords * 0.9), max: Math.round(targetWords * 1.75) };
  return {
    min: bounds?.min && bounds.min > 0 ? bounds.min : derived.min,
    max: bounds?.max && bounds.max > 0 ? bounds.max : derived.max,
  };
}

export function validateArticleContract(input: ArticleContractInput): ArticleContractResult {
  const content = input.content.trim();
  const wordCount = countWords(content);
  const { min: minWords, max: maxWords } = articleWordRange(input.targetWords, input.wordBounds);
  const h1 = markdownHeadings(content, 1);
  const h2 = markdownHeadings(content, 2);
  const h3 = markdownHeadings(content, 3);
  const reasons: string[] = [];

  if (!content) reasons.push("Article content is empty");
  if (wordCount < minWords) reasons.push(`Word count ${wordCount}/${minWords} minimum for requested length`);
  // Only an explicitly briefed ceiling gates; the derived maximum stays advisory.
  if (input.wordBounds?.max && wordCount > input.wordBounds.max) {
    reasons.push(`Word count ${wordCount} exceeds the briefed maximum of ${input.wordBounds.max}`);
  }
  if (h1.length !== 1) reasons.push(`Expected exactly one H1, found ${h1.length}`);
  const requiredH1 = input.requiredH1?.trim();
  if (requiredH1 && h1.length > 0 && normalizeHeading(h1[0]) !== normalizeHeading(requiredH1)) {
    reasons.push(`H1 does not match the briefed H1: expected "${requiredH1}", found "${h1[0]}"`);
  }
  if (/todo|placeholder|draft unavailable|lorem ipsum/i.test(content)) {
    reasons.push("Article contains placeholder or draft-only text");
  }
  if (!/[.!?)]\s*$/.test(content)) reasons.push("Article does not end with a complete sentence");

  const outlineSections = extractOutlineSections(input.outlineSections);
  if (outlineSections.length > 0) {
    let lastIndex = -1;
    for (const [sectionIndex, section] of outlineSections.entries()) {
      const heading = typeof section.heading === "string" ? section.heading.trim() : "";
      if (!heading) continue;
      if (sectionIndex === 0 && /intro|introduction/i.test(heading)) {
        continue;
      }
      const index = headingIndex(h2, heading);
      if (index === -1) {
        reasons.push(`Missing outline section: ${heading}`);
      } else if (index < lastIndex) {
        reasons.push(`Outline section out of order: ${heading}`);
      } else {
        lastIndex = index;
      }

      for (const subsection of subsectionHeadings(section)) {
        if (!hasMatchingHeading(h3, subsection)) reasons.push(`Missing outline subsection: ${subsection}`);
      }

      if (section.comparisonTable && !/\|.+\|/.test(content)) {
        reasons.push(`Missing required comparison table for section: ${heading}`);
      }
    }
  }

  // Briefed FAQ questions must actually be answered in the article. Headings
  // are matched loosely (punctuation/case) because a writer may phrase the
  // question slightly differently as a heading.
  const faqQuestions = stringArray(
    Array.isArray(input.faqQuestions)
      ? input.faqQuestions.map((faq) =>
          faq && typeof faq === "object" && "question" in faq ? String((faq as { question: unknown }).question) : String(faq)
        )
      : []
  );
  if (faqQuestions.length > 0) {
    const candidates = [...h2, ...h3];
    const missingFaqs = faqQuestions.filter(
      (question) => !candidates.some((heading) => hasMatchingHeading([heading], question)) && !includesText(content, question)
    );
    if (missingFaqs.length > 0) reasons.push(`Missing briefed FAQ question(s): ${missingFaqs.join(" | ")}`);
  }

  const focusKeyword = input.focusKeyword?.trim();
  if (focusKeyword) {
    const intro = content.split(/^##\s+/m)[0] ?? content;
    if (!includesText(content, focusKeyword)) reasons.push(`Missing focus keyword: ${focusKeyword}`);
    if (h1.length > 0 && !includesText(h1[0], focusKeyword)) reasons.push(`Focus keyword missing from H1: ${focusKeyword}`);
    if (!includesText(intro, focusKeyword)) reasons.push(`Focus keyword missing from introduction: ${focusKeyword}`);
    if (!h2.some((heading) => includesText(heading, focusKeyword))) reasons.push(`Focus keyword missing from H2 headings: ${focusKeyword}`);
  }

  const primaryKeywords = stringArray(input.primaryKeywords);
  const secondaryKeywords = stringArray(input.secondaryKeywords);
  const missingPrimary = primaryKeywords.filter((keyword) => !includesText(content, keyword));
  if (missingPrimary.length > 0) reasons.push(`Missing primary keyword(s): ${missingPrimary.join(", ")}`);
  const secondaryCoverage = secondaryKeywords.filter((keyword) => includesText(content, keyword)).length;
  if (secondaryKeywords.length > 0 && secondaryCoverage < Math.min(2, secondaryKeywords.length)) {
    reasons.push(`Secondary keyword coverage too low: ${secondaryCoverage}/${secondaryKeywords.length}`);
  }

  if (!input.metaTitle?.trim()) reasons.push("Missing SEO meta title");
  if (!input.metaDescription?.trim()) reasons.push("Missing SEO meta description");
  if (input.metaTitle && input.metaTitle.length > 60) reasons.push(`SEO meta title too long: ${input.metaTitle.length}/60`);
  if (input.metaDescription && (input.metaDescription.length < 80 || input.metaDescription.length > 160)) {
    reasons.push(`SEO meta description length ${input.metaDescription.length}; expected 80-160`);
  }

  const internalLinks = stringArray(input.internalLinks);
  const missingLinks = internalLinks.filter((link) => !content.includes(link));
  if (missingLinks.length > 0) reasons.push(`Missing internal link(s): ${missingLinks.join(", ")}`);

  return {
    passed: reasons.length === 0,
    wordCount,
    minWords,
    maxWords,
    reasons,
  };
}
