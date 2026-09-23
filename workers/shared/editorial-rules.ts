import { containsKeyword, normalizeForKeywordMatch } from "./seo-keyword";
import { DEFAULT_EDITORIAL_POLICY, type EditorialPolicy } from "./editorial-policy";
import { findDeprecatedTerminology } from "./terminology";

/**
 * The global blog rules, as code. `article-contract.ts` answers "is the
 * requested structure present"; this module answers "is the article one a
 * knowledgeable human would sign off on" - keyword restraint, calibrated
 * claims, working code samples, no invented links, no repetition.
 *
 * Two severities, on purpose:
 *  - "blocker": objective and precise enough to fail a draft on (a broken
 *    code fence, an invented URL, a guaranteed-rankings claim).
 *  - "warning": real signal, but judgement-dependent. Warnings never fail a
 *    draft; they are logged and fed back into the repair/rewrite prompt, and
 *    can be promoted once calibrated against real articles.
 *
 * Every check is pure and dependency-free so it can run in the writing gate,
 * in the quality worker, and in tests.
 */
export type EditorialSeverity = "blocker" | "warning";

export type EditorialViolation = {
  /** Stable id, prefixed with the rule number it enforces (e.g. "R2.density"). */
  rule: string;
  severity: EditorialSeverity;
  message: string;
  /** A short quote from the article, when pointing at one helps the fix. */
  evidence?: string;
};

export type EditorialReviewInput = {
  content: string;
  focusKeyword?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  targetWords?: number | null;
  policy?: EditorialPolicy;
  /** Canonical URLs the submission approved (evidence sources). */
  approvedUrls?: string[];
};

export type EditorialReviewResult = {
  passed: boolean;
  violations: EditorialViolation[];
  blockers: EditorialViolation[];
  warnings: EditorialViolation[];
};

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

export type CodeBlock = { lang: string; code: string; complete: boolean };

/**
 * Split the article into prose and fenced code blocks. Prose-level checks
 * (keywords, claims, clichés, terminology) run on the prose only: a keyword
 * inside an identifier is not keyword stuffing, and a deprecated API inside a
 * "migrate away from this" sample is not outdated terminology.
 */
export function splitCode(markdown: string): { prose: string; blocks: CodeBlock[]; unterminated: boolean } {
  const lines = markdown.split("\n");
  const blocks: CodeBlock[] = [];
  const proseLines: string[] = [];
  let open: { lang: string; code: string[] } | null = null;

  for (const line of lines) {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      if (open) {
        blocks.push({ lang: open.lang, code: open.code.join("\n"), complete: true });
        open = null;
      } else {
        open = { lang: fence[1].trim(), code: [] };
      }
      continue;
    }
    if (open) open.code.push(line);
    else proseLines.push(line);
  }

  if (open) blocks.push({ lang: open.lang, code: open.code.join("\n"), complete: false });

  // Inline code is stripped from prose for the same reason as fenced blocks.
  const prose = proseLines.join("\n").replace(/`[^`\n]*`/g, " ");
  return { prose, blocks, unterminated: Boolean(open) };
}

export function headingsOf(markdown: string, level: 1 | 2 | 3): string[] {
  const prefix = "#".repeat(level);
  const next = "#".repeat(level + 1);
  return markdown
    .split("\n")
    .filter((line) => line.startsWith(`${prefix} `) && !line.startsWith(`${next} `))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
}

/** H2-delimited sections. The first entry (heading null) is the H1 + introduction. */
export function sectionsOf(markdown: string): { heading: string | null; body: string }[] {
  const sections: { heading: string | null; body: string }[] = [{ heading: null, body: "" }];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      sections.push({ heading: line.slice(3).trim(), body: "" });
    } else {
      sections[sections.length - 1].body += `${line}\n`;
    }
  }
  return sections;
}

export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    // Headings, blockquotes, tables, and list blocks are valid Markdown
    // structures, not prose that needs terminal-sentence punctuation.
    .filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#") && !/^[|>-]/.test(paragraph));
}

export function sentencesOf(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function countOccurrences(text: string, phrase: string): number {
  const needle = normalizeForKeywordMatch(phrase);
  if (!needle) return 0;
  const haystack = normalizeForKeywordMatch(text);
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function excerpt(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/** Jaccard similarity over 5-word shingles - cheap near-duplicate detection. */
export function shingleSimilarity(a: string, b: string, size = 5): number {
  const shingles = (text: string) => {
    const words = normalizeForKeywordMatch(text).split(" ").filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + size <= words.length; i += 1) set.add(words.slice(i, i + size).join(" "));
    return set;
  };
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const shingle of left) if (right.has(shingle)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/* ------------------------------------------------------------------ */
/* Rule data                                                           */
/* ------------------------------------------------------------------ */

/** R5/R12: claims a technology cannot actually make. Deliberately narrow - each needs a ranking/indexing object. */
const UNSUPPORTED_CLAIM_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /guarantee[sd]?\s+(you\s+)?(a\s+|higher\s+|top\s+|better\s+)?(ranking|rankings|rank|indexing|indexability|traffic|conversions|visibility)/i, message: "claims a guaranteed ranking/indexing outcome" },
  { pattern: /guaranteed\s+(indexability|indexing|rankings?|traffic|visibility)/i, message: "claims a guaranteed ranking/indexing outcome" },
  { pattern: /(automatically|instantly)\s+(improves?|boosts?|increases?)\s+(your\s+)?(rankings?|seo|traffic|visibility)/i, message: "claims an implementation automatically improves rankings" },
  { pattern: /ensure[sd]?\s+(top\s+|higher\s+|better\s+)?(rankings?|indexing|indexability|placement)/i, message: "claims an implementation ensures rankings" },
  { pattern: /will\s+(definitely\s+|certainly\s+)?rank\s+(higher|first|#1|number one|at the top)/i, message: "predicts a specific ranking outcome" },
  { pattern: /always\s+(ranks?|indexes?|outperforms?)\b/i, message: "states an absolute ranking/indexing outcome" },
  { pattern: /never\s+(fails?\s+to\s+(rank|index)|gets?\s+deindexed)/i, message: "states an absolute ranking/indexing outcome" },
  { pattern: /\b(100%|fully)\s+(seo[- ]optimized|indexable|crawlable)\b/i, message: "states an absolute SEO outcome" },
];

/** R19: marketing register in a technical article. */
const MARKETING_SUPERLATIVES = /\b(unparalleled|best-in-class|top-tier|cutting-edge|game-chang(er|ing)|revolutionary|blazing[- ]fast|supercharge[sd]?)\b/i;

/** R14: openers that say nothing. */
const CLICHE_OPENERS = [
  /in today'?s (rapidly evolving|fast[- ]paced|competitive|digital) (digital )?(landscape|world|era)/i,
  /in the (ever[- ]changing|ever[- ]evolving) world of/i,
  /\bis no longer optional\b/i,
  /in today'?s competitive landscape/i,
  /\bin the digital age\b/i,
];

/** R2: "[keyword] X" templates that pile up when a model is chasing density. */
const KEYWORD_TEMPLATE_SUFFIXES = ["seo", "optimization", "optimisation", "best practices", "guide", "performance", "strategy", "tips", "checklist"];

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

function checkHeadings(markdown: string, focusKeyword: string | undefined, out: EditorialViolation[]): void {
  const h1 = headingsOf(markdown, 1);
  const h2 = headingsOf(markdown, 2);
  const h3 = headingsOf(markdown, 3);

  // R13/R17: the H1 rules the contract doesn't cover (it only checks count).
  if (h1.length === 1) {
    const title = h1[0];
    if (title.length > 70) {
      out.push({ rule: "R1.h1-length", severity: "warning", message: `H1 is ${title.length} characters; keep it concise (<= 70)`, evidence: title });
    }
    // A colon subtitle ("Keyword: what this covers") is a normal title shape,
    // so only comma/pipe-separated runs count as a list of terms.
    const segments = title.split(/[|,]/).map((part) => part.trim()).filter(Boolean);
    if (segments.length >= 3) {
      out.push({ rule: "R1.h1-keyword-list", severity: "warning", message: "H1 reads like a list of terms rather than a title", evidence: title });
    }
    if (focusKeyword && countOccurrences(title, focusKeyword) > 1) {
      out.push({ rule: "R1.h1-repetition", severity: "blocker", message: `H1 repeats the focus keyword "${focusKeyword}" more than once`, evidence: title });
    }
  }

  // R13: H3s under no H2 means a skipped level.
  if (h3.length > 0 && h2.length === 0) {
    out.push({ rule: "R13.hierarchy", severity: "blocker", message: "Article uses H3 headings without any H2 section" });
  }

  const seen = new Map<string, number>();
  for (const heading of h2) {
    const key = normalizeForKeywordMatch(heading);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      out.push({ rule: "R16.duplicate-heading", severity: "blocker", message: `H2 heading appears ${count} times`, evidence: key });
    }
  }
}

function checkKeywordUsage(
  prose: string,
  markdown: string,
  focusKeyword: string | undefined,
  out: EditorialViolation[]
): void {
  if (!focusKeyword) return;

  const words = wordCount(prose);
  const occurrences = countOccurrences(prose, focusKeyword);
  // Roughly one mention per 150 words is already generous for a phrase that
  // must also sit in the H1, the intro and a heading.
  const budget = Math.max(5, Math.round(words / 150));
  if (occurrences > budget * 1.5) {
    out.push({
      rule: "R2.density",
      severity: "blocker",
      message: `Focus keyword appears ${occurrences} times in ${words} words (keyword stuffing; aim for <= ${budget})`,
    });
  } else if (occurrences > budget) {
    out.push({
      rule: "R2.density",
      severity: "warning",
      message: `Focus keyword appears ${occurrences} times in ${words} words (aim for <= ${budget})`,
    });
  }

  const paragraphs = paragraphsOf(prose);
  if (paragraphs.length >= 5) {
    const withKeyword = paragraphs.filter((paragraph) => containsKeyword(paragraph, focusKeyword)).length;
    const share = withKeyword / paragraphs.length;
    if (share > 0.8) {
      out.push({
        rule: "R2.paragraph-spread",
        severity: "blocker",
        message: `Focus keyword appears in ${withKeyword}/${paragraphs.length} paragraphs - it does not belong in every paragraph`,
      });
    } else if (share > 0.6) {
      out.push({
        rule: "R2.paragraph-spread",
        severity: "warning",
        message: `Focus keyword appears in ${withKeyword}/${paragraphs.length} paragraphs`,
      });
    }
  }

  const h2 = headingsOf(markdown, 2);
  const h3 = headingsOf(markdown, 3);
  const allHeadings = [...h2, ...h3];
  if (allHeadings.length >= 3) {
    const keyworded = allHeadings.filter((heading) => containsKeyword(heading, focusKeyword)).length;
    if (keyworded / allHeadings.length > 0.4) {
      out.push({
        rule: "R2.heading-stuffing",
        severity: "warning",
        message: `${keyworded}/${allHeadings.length} headings contain the focus keyword - headings should describe their content, not repeat the keyword`,
      });
    }
  }

  // R2: "[keyword] SEO" / "[keyword] guide" templates used over and over.
  for (const suffix of KEYWORD_TEMPLATE_SUFFIXES) {
    const uses = countOccurrences(prose, `${focusKeyword} ${suffix}`) + countOccurrences(markdown, `${focusKeyword} ${suffix}`);
    if (uses >= 6) {
      out.push({
        rule: "R2.template-phrase",
        severity: "warning",
        message: `The phrase "${focusKeyword} ${suffix}" is used repeatedly - vary the wording where it reads naturally`,
      });
    }
  }

  // R2: three sentences in a row all carrying the keyword.
  const sentences = sentencesOf(prose);
  let run = 0;
  for (const sentence of sentences) {
    run = containsKeyword(sentence, focusKeyword) ? run + 1 : 0;
    if (run >= 3) {
      out.push({
        rule: "R2.consecutive-sentences",
        severity: "warning",
        message: "Three consecutive sentences repeat the focus keyword",
        evidence: excerpt(sentence),
      });
      break;
    }
  }
}

function checkClaims(prose: string, out: EditorialViolation[]): void {
  for (const { pattern, message } of UNSUPPORTED_CLAIM_PATTERNS) {
    const match = prose.match(pattern);
    if (match) {
      out.push({
        rule: "R5.unsupported-claim",
        severity: "blocker",
        message: `Article ${message} - describe the mechanism and its dependencies instead`,
        evidence: excerpt(prose.slice(Math.max(0, (match.index ?? 0) - 60), (match.index ?? 0) + 120)),
      });
    }
  }

  const superlative = prose.match(MARKETING_SUPERLATIVES);
  if (superlative) {
    out.push({
      rule: "R19.marketing-tone",
      severity: "warning",
      message: `Marketing language ("${superlative[0]}") in a technical article`,
      evidence: excerpt(prose.slice(Math.max(0, (superlative.index ?? 0) - 60), (superlative.index ?? 0) + 120)),
    });
  }
}

function checkCode(blocks: CodeBlock[], unterminated: boolean, prose: string, out: EditorialViolation[]): void {
  if (unterminated) {
    out.push({ rule: "R7.unterminated-fence", severity: "blocker", message: "A fenced code block is never closed" });
  }

  const abbreviationAcknowledged = /abbreviat|simplified|excerpt|truncated|for brevity|snippet only/i.test(prose);

  blocks.forEach((block, index) => {
    const label = block.lang || `block ${index + 1}`;
    if (!block.lang) {
      out.push({ rule: "R7.missing-language", severity: "warning", message: `Code block ${index + 1} has no language tag` });
    }

    const pairs: [string, string][] = [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ];
    for (const [open, close] of pairs) {
      const opened = block.code.split(open).length - 1;
      const closed = block.code.split(close).length - 1;
      if (opened !== closed) {
        out.push({
          rule: "R7.unbalanced",
          severity: "blocker",
          message: `Code example (${label}) has unbalanced ${open}${close} (${opened} vs ${closed}) - the sample is incomplete`,
        });
        break;
      }
    }

    // `${` with no closing brace is the classic truncated-template artefact.
    const templateOpens = block.code.split("${").length - 1;
    if (templateOpens > 0) {
      const dangling = /\$\{[^}]*$/.test(block.code);
      if (dangling) {
        out.push({ rule: "R7.truncated-template", severity: "blocker", message: `Code example (${label}) contains an unterminated \${...} expression` });
      }
    }

    if (/^(json|jsonc)$/i.test(block.lang)) {
      try {
        JSON.parse(block.code);
      } catch {
        out.push({ rule: "R7.invalid-json", severity: "blocker", message: `Code example (${label}) is not valid JSON` });
      }
    }

    if (/(^|\n)\s*(\.\.\.|\/\/\s*\.\.\.|#\s*\.\.\.)\s*(\n|$)/.test(block.code) && !abbreviationAcknowledged) {
      out.push({
        rule: "R7.unlabelled-ellipsis",
        severity: "warning",
        message: `Code example (${label}) omits code with "..." without saying it is abbreviated`,
      });
    }
  });
}

function checkLinks(markdown: string, policy: EditorialPolicy, approvedUrls: string[], out: EditorialViolation[]): void {
  const links = Array.from(markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g), (match) => match[1]);

  // R9: a table of contents, and anchor navigation, only on request.
  const hasTocHeading = /^##\s+table of contents\s*$/im.test(markdown);
  if (hasTocHeading && !policy.tableOfContents) {
    out.push({ rule: "R9.table-of-contents", severity: "blocker", message: "Article contains a Table of Contents that was not requested" });
  }
  const anchors = links.filter((href) => href.startsWith("#"));
  if (anchors.length > 0 && !policy.anchorLinks) {
    out.push({
      rule: "R9.anchor-links",
      severity: "blocker",
      message: `Article contains ${anchors.length} in-page anchor link(s); headings should stand on their own`,
      evidence: anchors.slice(0, 3).join(", "),
    });
  }

  // R8: an "Internal Linking" section is never article content.
  if (/^##+\s+internal link(ing|s)\b/im.test(markdown)) {
    out.push({ rule: "R8.internal-linking-section", severity: "blocker", message: 'Article contains an "Internal Linking" section' });
  }

  const approved = new Set(
    [...approvedUrls, ...policy.approvedLinks].map((url) => url.trim().replace(/\/+$/, ""))
  );
  // Host-level approval as well as exact-URL: an approved source's article
  // may be linked at a slightly different path (utm stripped, trailing
  // slash, #fragment), and blocking those would be a false positive.
  const approvedHosts = new Set<string>();
  for (const url of [...approvedUrls, ...policy.approvedLinks]) {
    try {
      approvedHosts.add(new URL(url).hostname.toLowerCase().replace(/^www\./, ""));
    } catch {
      // A malformed approved URL simply contributes no host.
    }
  }
  const approvedInternal = new Set(policy.internalLinks.map((link) => link.trim().replace(/\/+$/, "")));

  for (const href of links) {
    if (href.startsWith("#") || href.startsWith("mailto:")) continue;

    if (href.startsWith("/")) {
      // R8: site-relative links are invented unless the editor supplied them.
      if (!approvedInternal.has(href.replace(/\/+$/, ""))) {
        out.push({ rule: "R8.invented-internal-link", severity: "blocker", message: `Article links to "${href}", which was not supplied as an approved internal link` });
      }
      continue;
    }

    if (!/^https?:\/\//i.test(href)) continue;

    let host = "";
    try {
      host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      out.push({ rule: "R10.malformed-url", severity: "blocker", message: `Article contains a malformed URL: ${href}` });
      continue;
    }

    // R10: clearly-labelled placeholders are fine anywhere.
    if (policy.placeholderDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) continue;

    if (policy.externalLinks === "evidence-only" && !approved.has(href.replace(/\/+$/, "")) && !approvedHosts.has(host)) {
      out.push({
        rule: "R12.unapproved-url",
        severity: "blocker",
        message: `Article links to ${href}, which is not one of the submission's approved sources - use example.com placeholders for illustrations`,
      });
    }
  }
}

function checkCompleteness(markdown: string, out: EditorialViolation[]): void {
  const sections = sectionsOf(markdown);

  for (const section of sections) {
    if (section.heading === null) continue;
    const body = section.body.replace(/^###.*$/gm, "").trim();
    if (body.length === 0) {
      out.push({ rule: "R17.empty-section", severity: "blocker", message: `Section "${section.heading}" has a heading but no content` });
    } else if (wordCount(body) < 25 && !/\|/.test(body) && !/```/.test(body)) {
      out.push({ rule: "R17.thin-section", severity: "warning", message: `Section "${section.heading}" is only ${wordCount(body)} words` });
    }
  }

  if (/\b(TBD|TODO|FIXME|lorem ipsum|\[insert\b|\[your\s+\w+\s+here\])/i.test(markdown)) {
    out.push({ rule: "R17.placeholder", severity: "blocker", message: "Article still contains placeholder text" });
  }

  // R17: a paragraph that just stops mid-thought.
  const { prose } = splitCode(markdown);
  for (const paragraph of paragraphsOf(prose)) {
    if (!/[.!?:)"'\]]$/.test(paragraph)) {
      out.push({ rule: "R17.incomplete-paragraph", severity: "warning", message: "A paragraph ends without terminal punctuation", evidence: excerpt(paragraph) });
      break;
    }
  }
}

function checkRepetition(markdown: string, out: EditorialViolation[]): void {
  const sections = sectionsOf(markdown).filter((section) => wordCount(section.body) >= 60);

  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      const similarity = shingleSimilarity(sections[i].body, sections[j].body);
      if (similarity >= 0.45) {
        out.push({
          rule: "R16.duplicate-section",
          severity: "warning",
          message: `"${sections[i].heading ?? "Introduction"}" and "${sections[j].heading ?? "Introduction"}" cover substantially the same ground (${Math.round(similarity * 100)}% overlap)`,
        });
      }
    }
  }

  const { prose } = splitCode(markdown);
  const counts = new Map<string, number>();
  for (const sentence of sentencesOf(prose)) {
    if (wordCount(sentence) < 12) continue;
    const key = normalizeForKeywordMatch(sentence);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count > 1) {
      out.push({ rule: "R16.repeated-sentence", severity: "warning", message: `A sentence is repeated ${count} times`, evidence: excerpt(key) });
      break;
    }
  }
}

function checkIntroAndConclusion(markdown: string, out: EditorialViolation[]): void {
  const sections = sectionsOf(markdown);
  const intro = sections[0]?.body ?? "";

  for (const pattern of CLICHE_OPENERS) {
    const match = intro.match(pattern);
    if (match) {
      out.push({ rule: "R14.cliche-opener", severity: "warning", message: `Introduction opens with a filler phrase ("${match[0]}")` });
      break;
    }
  }

  const conclusion = sections.find((section) => section.heading && /conclusion|final thoughts|wrapping up|summary/i.test(section.heading));
  if (conclusion && wordCount(intro) >= 40 && wordCount(conclusion.body) >= 40) {
    const similarity = shingleSimilarity(intro, conclusion.body);
    if (similarity >= 0.35) {
      out.push({ rule: "R15.conclusion-repeats-intro", severity: "warning", message: `The conclusion restates the introduction (${Math.round(similarity * 100)}% overlap)` });
    }
  }
}

function checkMetadata(input: EditorialReviewInput, markdown: string, out: EditorialViolation[]): void {
  const { metaTitle, metaDescription, focusKeyword } = input;
  if (!focusKeyword) return;

  if (metaTitle && countOccurrences(metaTitle, focusKeyword) > 1) {
    out.push({ rule: "R11.meta-title-stuffing", severity: "warning", message: "Meta title repeats the focus keyword", evidence: metaTitle });
  }
  if (metaDescription && countOccurrences(metaDescription, focusKeyword) > 2) {
    out.push({ rule: "R11.meta-description-stuffing", severity: "warning", message: "Meta description repeats the focus keyword", evidence: metaDescription });
  }

  const h1 = headingsOf(markdown, 1)[0];
  if (h1 && metaTitle && metaDescription && metaTitle.trim() === h1.trim() && metaDescription.trim().startsWith(h1.trim())) {
    out.push({ rule: "R11.duplicated-h1", severity: "warning", message: "H1, meta title and meta description are all the same text" });
  }
}

function checkTerminology(prose: string, out: EditorialViolation[]): void {
  for (const finding of findDeprecatedTerminology(prose)) {
    out.push({
      rule: `R6.deprecated.${finding.id}`,
      severity: "warning",
      message: `Uses ${finding.label} as current; the current standard is ${finding.replacement}`,
      evidence: finding.excerpt,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function reviewArticle(input: EditorialReviewInput): EditorialReviewResult {
  const markdown = input.content ?? "";
  const policy = input.policy ?? DEFAULT_EDITORIAL_POLICY;
  const focusKeyword = input.focusKeyword?.trim() || undefined;
  const approvedUrls = input.approvedUrls ?? [];
  const violations: EditorialViolation[] = [];

  const { prose, blocks, unterminated } = splitCode(markdown);

  checkHeadings(markdown, focusKeyword, violations);
  checkKeywordUsage(prose, markdown, focusKeyword, violations);
  checkClaims(prose, violations);
  checkCode(blocks, unterminated, prose, violations);
  checkLinks(markdown, policy, approvedUrls, violations);
  checkCompleteness(markdown, violations);
  checkRepetition(markdown, violations);
  checkIntroAndConclusion(markdown, violations);
  checkMetadata(input, markdown, violations);
  checkTerminology(prose, violations);

  const blockers = violations.filter((violation) => violation.severity === "blocker");
  const warnings = violations.filter((violation) => violation.severity === "warning");
  return { passed: blockers.length === 0, violations, blockers, warnings };
}

/** One-line rendering for gate reasons, repair notes and logs. */
export function formatViolation(violation: EditorialViolation): string {
  return violation.evidence
    ? `${violation.rule}: ${violation.message} ("${violation.evidence}")`
    : `${violation.rule}: ${violation.message}`;
}

/* ------------------------------------------------------------------ */
/* Prompt block                                                        */
/* ------------------------------------------------------------------ */

/**
 * The same rules, stated for the model. One builder shared by the monolithic
 * writing prompt, the per-section prompt and the outline prompt, so the three
 * can't drift apart. Rules are given with their reason where the reason
 * changes behaviour - "no invented URLs, unapproved domains are rejected"
 * lands better than a bare prohibition.
 */
export function buildGlobalRulesBlock(policy: EditorialPolicy, focusKeyword?: string | null): string {
  const keyword = focusKeyword?.trim();
  const rules: string[] = [];

  if (keyword) {
    rules.push(
      `Use the focus keyword "${keyword}" naturally: it belongs in the H1, the first paragraph and one section heading. Everywhere else use it only where it genuinely reads better than a pronoun or a synonym. Do not put it in every paragraph, do not repeat it in the H1, and do not build headings out of "${keyword} + word" templates.`
    );
  }
  rules.push(
    "Write for a reader, not a crawler: the article must still be worth reading with every keyword removed. Prefer plain, specific prose over keyword-rich phrasing."
  );
  rules.push(
    "Every section must move the reader towards the article's search intent. Do not add a section because it sounds SEO-relevant, and do not explain the same concept twice - reference the earlier explanation instead."
  );
  rules.push(
    "Do not pad to reach the word count. A shorter, denser article is better than a padded one; the target length is a guide, not a quota."
  );
  rules.push(
    "Calibrate claims. Never say a technique guarantees, ensures or automatically improves rankings, indexing, traffic or conversions, and avoid absolute always/never claims. Distinguish what the technology does from what search engines then do with it, and name the dependency (implementation, hosting, configuration, crawler behaviour) when an outcome depends on it."
  );
  rules.push(
    "Do not invent statistics, benchmarks, studies, company names or datasets. If you do not have a sourced number, describe the effect qualitatively."
  );
  rules.push(
    "Use current terminology and current APIs. Do not mix a deprecated pattern and its replacement in one example without saying which is which."
  );
  rules.push(
    "Every code example must be complete and runnable as shown: balanced braces and brackets, no unterminated ${...}, valid JSON in json blocks, and a language tag on the fence. If you abbreviate an example, say so in the surrounding prose."
  );

  if (policy.internalLinks.length > 0) {
    rules.push(`Internal links: use only these, and only where they fit naturally: ${policy.internalLinks.join(", ")}.`);
  } else {
    rules.push(
      "Do not create internal links, an \"Internal Linking\" section, or links to site pages - none exist. Do not invent URLs such as /blog/example or /services."
    );
  }
  if (policy.externalLinks === "evidence-only") {
    rules.push(
      "Do not link to external URLs other than the approved sources supplied above. For illustrative URLs use https://example.com or https://your-domain.com and make clear they are placeholders."
    );
  }
  if (!policy.tableOfContents) {
    rules.push("Do not add a Table of Contents section.");
  } else if (!policy.anchorLinks) {
    rules.push("The Table of Contents must be a plain list of section names - no anchor links.");
  }
  if (!policy.anchorLinks) {
    rules.push("Do not use in-page anchor links anywhere; headings stand on their own.");
  }

  rules.push(
    "Use exactly one H1, then a logical H2/H3 hierarchy. Headings describe the content beneath them; never create a heading to hold a keyword."
  );
  rules.push(
    "Open by establishing the topic, why it matters and what the reader will learn - no \"in today's fast-paced landscape\" filler. Close by summarising the practical takeaways and a concrete next step, without restating the introduction or introducing new concepts."
  );
  rules.push(
    "Before you finish: every section complete, no sentence or code block cut off, no placeholder text, no duplicated sections, no unsupported guarantee, no invented URL."
  );

  return `\nGlobal content rules (non-negotiable - a draft that breaks these is rejected):\n${rules
    .map((rule, index) => `${index + 1}. ${rule}`)
    .join("\n")}\n`;
}
