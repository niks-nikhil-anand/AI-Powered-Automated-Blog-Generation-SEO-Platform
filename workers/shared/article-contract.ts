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
  return content.toLowerCase().includes(needle.trim().toLowerCase());
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

export function articleWordRange(targetWords?: number | null): { min: number; max: number } {
  if (!targetWords || targetWords <= 0) return { min: 1200, max: 2200 };
  return {
    min: Math.round(targetWords * 0.9),
    max: Math.round(targetWords * 1.75),
  };
}

export function validateArticleContract(input: ArticleContractInput): ArticleContractResult {
  const content = input.content.trim();
  const wordCount = countWords(content);
  const { min: minWords, max: maxWords } = articleWordRange(input.targetWords);
  const h1 = markdownHeadings(content, 1);
  const h2 = markdownHeadings(content, 2);
  const h3 = markdownHeadings(content, 3);
  const reasons: string[] = [];

  if (!content) reasons.push("Article content is empty");
  if (wordCount < minWords) reasons.push(`Word count ${wordCount}/${minWords} minimum for requested length`);
  if (h1.length !== 1) reasons.push(`Expected exactly one H1, found ${h1.length}`);
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
