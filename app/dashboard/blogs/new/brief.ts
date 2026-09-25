import { cleanBriefText } from "../../../../workers/shared/seo-keyword";

/**
 * The rich authoring brief (schemaVersion "1.0") - the nested JSON an editor
 * writes - normalized onto the flat submission the pipeline speaks.
 *
 * Every field is optional. A brief may carry two keys or two hundred; what is
 * present is mapped, what is absent is left undefined so the existing
 * defaults apply, and unknown keys are preserved on `brief` rather than
 * dropped. A flat submission (the original format) is passed through
 * untouched, so both shapes - and hybrids - stay valid.
 *
 * Nothing here validates: blogInputSchema still does that on the normalized
 * result. This module only moves values to where the pipeline looks for them.
 */

export type BriefNormalizationNote = string;

export type NormalizedBrief = {
  normalized: Record<string, unknown>;
  notes: BriefNormalizationNote[];
};

/* ------------------------------------------------------------------ */
/* Defensive accessors - a brief is user input, not a typed object      */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = cleanBriefText(value);
  return trimmed.length > 0 ? trimmed : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function objArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** First defined value, so brief and flat spellings can both be accepted. */
function first<T>(...values: (T | undefined)[]): T | undefined {
  for (const value of values) if (value !== undefined) return value;
  return undefined;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/** Only set a key when there is something to set - undefined would override a default. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value) && value.length === 0) return;
  target[key] = value;
}

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

/**
 * True when the payload uses the nested brief shape. Deliberately generous:
 * any one nested marker is enough, because a partial brief is still a brief.
 */
export function isBriefSubmission(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (typeof raw.schemaVersion === "string") return true;
  if (typeof raw.blogTitle === "string") return true;
  if (isRecord(raw.seo)) return true;
  if (isRecord(raw.metadata)) return true;
  if (isRecord(raw.contentLength)) return true;
  if (isRecord(raw.writingInstructions)) return true;
  if (isRecord(raw.audience)) return true;
  if (isRecord(raw.searchIntent)) return true;
  if (isRecord(raw.generationConfig) || isRecord(raw.validationRequirements) || isRecord(raw.qualityRequirements)) return true;
  const outline = record(raw.outlineJson ?? raw.outline);
  return Boolean(outline.h1 || outline.introduction || outline.faq);
}

/* ------------------------------------------------------------------ */
/* Field mapping                                                       */
/* ------------------------------------------------------------------ */

const TONE_PATTERNS: [RegExp, "casual" | "technical" | "professional"][] = [
  [/casual|conversational|friendly|informal/i, "casual"],
  [/^technical\b|deeply technical|technical reference|engineering[- ]focused/i, "technical"],
  [/professional|practical|authoritative|expert/i, "professional"],
];

/** Map the brief's free-text tone onto the pipeline's three voices. */
export function toneFromBrief(value: string | undefined): "professional" | "casual" | "technical" | undefined {
  if (!value) return undefined;
  for (const [pattern, tone] of TONE_PATTERNS) {
    if (pattern.test(value)) return tone;
  }
  return undefined;
}

/** "high" -> "HIGH"; anything outside the enum is left for the schema to reject. */
function priorityFromBrief(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  return ["LOW", "NORMAL", "HIGH", "URGENT"].includes(upper) ? upper : raw;
}

/** The brief's audience block, flattened into the one line the plan consumes. */
function audienceLine(audience: Record<string, unknown>): string | undefined {
  const primary = strArray(audience.primary);
  const secondary = strArray(audience.secondary);
  const experience = strArray(audience.experienceLevel);
  const parts: string[] = [];
  if (primary.length > 0) parts.push(primary.join(", "));
  if (secondary.length > 0) parts.push(`also ${secondary.join(", ")}`);
  if (experience.length > 0) parts.push(`experience: ${experience.join("/")}`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function searchIntentLine(intent: Record<string, unknown>): string | undefined {
  const primary = str(intent.primary);
  const secondary = str(intent.secondary);
  const problem = str(intent.userProblem);
  const parts: string[] = [];
  if (primary) parts.push(secondary ? `${primary} (secondary: ${secondary})` : primary);
  if (problem) parts.push(problem);
  return parts.length > 0 ? parts.join(" - ") : undefined;
}

/**
 * Editorial voice instructions. Kept short on purpose: the long-tail brief
 * context (audience pains, examples, evidence rules) goes to briefDirectives
 * so the two can be rendered as separate prompt blocks.
 */
function writingInstructionLines(brief: Record<string, unknown>): string[] {
  const writing = record(brief.writingInstructions);
  const lines = [...strArray(writing.instructions), ...strArray(writing.requirements)];

  const style = str(writing.style);
  const readingLevel = str(writing.readingLevel);
  const tone = str(writing.tone);
  if (tone) lines.unshift(`Tone: ${tone}.`);
  if (style) lines.unshift(`Style: ${style}.`);
  if (readingLevel) lines.push(`Reading level: ${readingLevel}.`);

  return dedupe(lines);
}

const KEYWORD_INSTRUCTION_LINES: Record<string, string> = {
  useFocusKeywordInH1: "The exact focus keyword must appear in the H1.",
  useFocusKeywordInIntroduction: "Use the focus keyword naturally in the introduction.",
  useFocusKeywordInConclusion: "Use the focus keyword naturally in the conclusion.",
  avoidKeywordStuffing: "Do not stuff keywords; readability comes first.",
  useNaturalVariations: "Prefer natural variations over repeating the exact phrase.",
  avoidForcedExactMatchInEverySection: "Do not force the exact keyword into every section.",
};

/**
 * Everything in the brief the writer must honour but that has no column:
 * audience pains, the reader's decision, illustrative scenarios, evidence
 * rules, editorial positioning. Rendered as its own prompt block.
 */
function briefDirectiveLines(brief: Record<string, unknown>): string[] {
  const lines: string[] = [];

  const intent = record(brief.searchIntent);
  const expected = str(intent.expectedAnswer);
  const decision = str(intent.readerDecision);
  if (expected) lines.push(`What the reader must leave with: ${expected}`);
  if (decision) lines.push(`The decision the reader is making: ${decision}`);

  const audience = record(brief.audience);
  const pains = strArray(audience.painPoints);
  const outcomes = strArray(audience.readerOutcome);
  if (pains.length > 0) lines.push(`Reader pain points to address: ${pains.join("; ")}.`);
  if (outcomes.length > 0) lines.push(`By the end the reader should be able to: ${outcomes.join("; ")}.`);

  const goal = record(brief.contentGoal);
  const secondaryGoal = str(goal.secondary);
  const conversionGoal = str(goal.conversionGoal);
  if (secondaryGoal) lines.push(`Secondary goal: ${secondaryGoal}`);
  if (conversionGoal) lines.push(`Conversion goal: ${conversionGoal}`);
  const positioning = str(goal.editorialPositioning);
  if (positioning) lines.push(`Editorial positioning: ${positioning}.`);
  for (const criterion of strArray(goal.successCriteria)) lines.push(`Success criterion: ${criterion}`);

  const quality = record(brief.qualityRequirements);
  const promotional = str(quality.promotionalIntensity);
  if (promotional) {
    lines.push(
      `Promotional intensity: ${promotional}. Mention the product only where it genuinely helps the reader, and never as a recommendation the article has not earned.`
    );
  }

  const examples = record(brief.examplesAndPracticalValue);
  for (const example of objArray(examples.examples)) {
    const scenario = str(example.scenario);
    const purpose = str(example.purpose);
    if (scenario) lines.push(`Work in this scenario: ${scenario}${purpose ? ` - ${purpose}` : ""}.`);
  }
  for (const rule of strArray(examples.rules)) lines.push(rule);

  const keywordInstructions = record(record(brief.seo).keywordInstructions);
  for (const [key, line] of Object.entries(KEYWORD_INSTRUCTION_LINES)) {
    if (keywordInstructions[key] === true) lines.push(line);
  }

  const research = record(brief.researchRequirements);
  for (const rule of strArray(research.evidenceRules)) lines.push(rule);

  const sourcePolicy = record(brief.sourcePolicy);
  if (sourcePolicy.doNotInventSources === true || sourcePolicy.doNotInventUrls === true) {
    lines.push("Do not invent sources or URLs; cite only the supplied ones.");
  }

  const length = record(brief.contentLength);
  if (length.avoidPadding === true) {
    lines.push("Do not pad to reach the word count; cover the brief and stop.");
  }

  const competitor = record(brief.competitorAnalysis);
  for (const rule of strArray(competitor.competitorResearchRules)) lines.push(rule);

  return dedupe(lines);
}

/** Internal links the brief authorised - both a permission and a requirement. */
function internalLinksFromBrief(brief: Record<string, unknown>): string[] {
  const seo = record(brief.seo);
  const policy = record(seo.internalLinkPolicy);
  if (policy.enabled === false) return [];

  const links = objArray(policy.suggestedPages)
    .map((page) => str(page.url))
    .filter((url): url is string => Boolean(url));

  // A section can also pin a required link of its own.
  const outline = record(brief.outlineJson ?? brief.outline);
  for (const section of objArray(outline.sections)) {
    const required = str(record(section.requiredInternalLink).url);
    if (required) links.push(required);
  }

  return dedupe(links);
}

/** URLs the brief vouched for: linkable without counting as research evidence. */
function approvedLinksFromBrief(brief: Record<string, unknown>): string[] {
  const sourcePolicy = record(brief.sourcePolicy);
  const notes = objArray(sourcePolicy.sourceNotes)
    .map((note) => str(note.url))
    .filter((url): url is string => Boolean(url));
  return dedupe([...notes, ...internalLinksFromBrief(brief)]);
}

/** Brief section -> the outline section shape the workers consume. */
function sectionFromBrief(section: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = { ...section };

  put(mapped, "heading", str(section.heading) ?? str(section.title));
  put(mapped, "intent", str(section.intent) ?? str(section.description));
  // keyPoints is the brief's name for what the pipeline calls bullets.
  put(mapped, "bullets", dedupe([...strArray(section.bullets), ...strArray(section.keyPoints)]));
  put(mapped, "wordTarget", first(num(section.wordTarget), num(section.targetWords)));
  put(mapped, "readerQuestion", str(section.readerQuestion));
  put(mapped, "avoid", dedupe([...strArray(section.avoid), ...strArray(section.avoidContent)]));
  put(mapped, "requirements", strArray(section.requirements));
  put(mapped, "evidenceRequirements", strArray(section.evidenceRequirements));
  put(mapped, "practicalExample", str(section.practicalExample));
  put(mapped, "format", str(section.format));

  const requiredLink = record(section.requiredInternalLink);
  const requiredUrl = str(requiredLink.url);
  if (requiredUrl) {
    mapped.requiredInternalLink = { url: requiredUrl, anchor: str(requiredLink.anchor) ?? str(requiredLink.anchorSuggestion) };
  }

  return mapped;
}

function faqsFromBrief(outline: Record<string, unknown>): Record<string, unknown>[] {
  const raw = objArray(outline.faqs).length > 0 ? objArray(outline.faqs) : objArray(outline.faq);
  const faqs: Record<string, unknown>[] = [];
  for (const faq of raw) {
    const question = str(faq.question);
    if (!question) continue;
    const answerIntent =
      str(faq.answerIntent) ??
      str(faq.answer) ??
      (strArray(faq.answerRequirements).length > 0 ? strArray(faq.answerRequirements).join(" ") : undefined);
    faqs.push({ ...faq, question, answerIntent: answerIntent ?? `Answer "${question}" directly and concretely.` });
  }
  return faqs;
}

/**
 * The brief's outline, including its introduction block, as the pipeline's
 * { sections, faqs } shape. The intro becomes section 0 - buildSectionPlan
 * and the article contract both already treat a leading "Introduction"
 * section as the intro rather than as an H2.
 */
function outlineFromBrief(brief: Record<string, unknown>): Record<string, unknown> | undefined {
  const outline = record(brief.outlineJson ?? brief.outline);
  const sections = objArray(outline.sections).map(sectionFromBrief).filter((section) => str(section.heading));
  const intro = record(outline.introduction);

  const introSection = str(intro.intent) || strArray(intro.requirements).length > 0 || num(intro.targetWords)
    ? {
        heading: "Introduction",
        intent: str(intro.intent) ?? "Establish the topic, the reader's problem, and what the article delivers.",
        bullets: strArray(intro.requirements),
        wordTarget: num(intro.targetWords),
        requirements: strArray(intro.requirements),
      }
    : null;

  const allSections = introSection ? [introSection, ...sections] : sections;
  if (allSections.length === 0) return undefined;

  const faqs = faqsFromBrief(outline);
  return { ...outline, sections: allSections, ...(faqs.length > 0 ? { faqs } : {}) };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Map a brief onto the flat submission shape. Flat keys already present on
 * the payload win, so a hybrid submission can override any mapped value.
 */
export function normalizeBrief(raw: unknown): NormalizedBrief {
  if (!isRecord(raw)) return { normalized: {}, notes: [] };

  const brief = raw;
  const notes: BriefNormalizationNote[] = [];
  const metadata = record(brief.metadata);
  const seo = record(brief.seo);
  const length = record(brief.contentLength);
  const generation = record(brief.generationConfig);
  const quality = record(brief.qualityRequirements);
  const validation = record(brief.validationRequirements);

  // Start from the payload so unmapped/flat keys survive untouched.
  const out: Record<string, unknown> = { ...brief };

  // When the modal/API has already selected a title from the pasted JSON,
  // keep that explicit value. Some pasted briefs contain an older top-level
  // blogTitle plus the intended brief nested under `brief`, so letting
  // blogTitle win here can resurrect the stale title during validation.
  put(out, "title", first(str(brief.title), str(brief.blogTitle), str(metadata.title), str(record(brief.outlineJson).h1)));
  put(out, "slug", first(str(brief.slug), str(metadata.slug)));
  put(out, "category", first(str(brief.category), str(metadata.category)));
  put(out, "metaTitle", first(str(brief.metaTitle), str(metadata.metaTitle)));
  put(out, "metaDescription", first(str(brief.metaDescription), str(metadata.metaDescription)));
  put(out, "priority", priorityFromBrief(first(brief.priority, metadata.priority)));

  put(out, "focusKeyword", first(str(brief.focusKeyword), str(seo.focusKeyword), str(brief.targetKeyword)));
  const primaryKeywords = strArray(brief.primaryKeywords).length > 0 ? strArray(brief.primaryKeywords) : strArray(seo.primaryKeywords);
  const focusKeyword = str(out.focusKeyword);
  put(out, "primaryKeywords", primaryKeywords.length > 0 ? primaryKeywords : focusKeyword ? [focusKeyword] : []);
  put(
    out,
    "secondaryKeywords",
    strArray(brief.secondaryKeywords).length > 0 ? strArray(brief.secondaryKeywords) : strArray(seo.secondaryKeywords)
  );
  // Long-tail and semantic terms stay available to the prompt without
  // becoming keywords the article contract then demands verbatim.
  put(out, "longTailKeywords", strArray(seo.longTailKeywords));
  put(out, "semanticKeywords", strArray(seo.semanticEntities));

  put(out, "audience", first(str(brief.audience), audienceLine(record(brief.audience))));
  // The flat submission types these as strings; the brief nests them, so the
  // object form is replaced rather than passed through (it would fail
  // validation) and its detail moves into briefDirectives below.
  put(out, "contentGoal", first(str(brief.contentGoal), str(record(brief.contentGoal).primary)));
  put(out, "contentAngle", first(str(brief.contentAngle), str(record(brief.contentGoal).editorialPositioning)));
  put(
    out,
    "uniqueValueProposition",
    first(str(brief.uniqueValueProposition), str(record(brief.contentGoal).secondary))
  );
  put(out, "searchIntent", first(str(brief.searchIntent), searchIntentLine(record(brief.searchIntent))));
  put(out, "tone", first(str(brief.tone), toneFromBrief(str(record(brief.writingInstructions).tone))));

  put(out, "contentLength", first(num(brief.contentLength), num(length.targetWordCount), num(brief.targetWordCount)));
  const bounds: Record<string, unknown> = {};
  put(bounds, "min", num(length.minimumWordCount));
  put(bounds, "max", num(length.maximumWordCount));
  put(bounds, "countFaqInTotal", bool(length.countFaqInTotal));
  put(bounds, "avoidPadding", bool(length.avoidPadding));
  if (Object.keys(bounds).length > 0) out.contentBounds = bounds;

  const writingInstructions = writingInstructionLines(brief);
  if (writingInstructions.length > 0) out.writingInstructions = writingInstructions;
  const directives = briefDirectiveLines(brief);
  if (directives.length > 0) out.briefDirectives = directives;

  const mustFollow = dedupe([
    ...strArray(record(brief.generationInstructions).mustFollow),
    ...strArray(quality.requirements),
    ...strArray(validation.blockers).map((blocker) => `Must not be true of the finished article: ${blocker}.`),
  ]);
  if (mustFollow.length > 0) {
    out.generationInstructions = { ...record(brief.generationInstructions), mustFollow };
  }

  const internalLinks = internalLinksFromBrief(brief);
  if (internalLinks.length > 0) out.internalLinks = internalLinks;

  const approvedLinks = approvedLinksFromBrief(brief);
  const externalPolicy = record(seo.externalLinkPolicy);
  const editorialPolicy: Record<string, unknown> = { ...record(brief.editorialPolicy) };
  if (editorialPolicy.internalLinks === undefined && internalLinks.length > 0) editorialPolicy.internalLinks = internalLinks;
  if (editorialPolicy.approvedLinks === undefined && approvedLinks.length > 0) editorialPolicy.approvedLinks = approvedLinks;
  if (editorialPolicy.externalLinks === undefined && externalPolicy.enabled === true && externalPolicy.onlyUseVerifiedUrls !== true) {
    editorialPolicy.externalLinks = "allowed";
  }
  if (Object.keys(editorialPolicy).length > 0) out.editorialPolicy = editorialPolicy;
  if (externalPolicy.enabled === true && externalPolicy.onlyUseVerifiedUrls === true) {
    notes.push(
      "External links are restricted to the URLs supplied in sourcePolicy.sourceNotes and internalLinkPolicy - add a URL there to let the article link to it."
    );
  }

  const outline = outlineFromBrief(brief);
  if (outline) out.outlineJson = outline;
  put(out, "briefedH1", first(str(record(brief.outlineJson).h1), str(record(brief.outline).h1)));

  // generationConfig: per-submission overrides of the pipeline's own flags.
  const generationMode = str(generation.generationMode);
  if (generationMode) out.generationMode = generationMode;
  put(out, "maxSectionRetries", num(generation.maxSectionRetries));

  // Notes about what the mapping implies, surfaced on the submission so an
  // editor can see why (for example) an external link may be rejected.
  if (notes.length > 0) out.briefNotes = notes;

  // The original document, kept whole for audit and for anything a later
  // version of this normalizer learns to read.
  out.brief = brief;

  return { normalized: out, notes };
}

/** Normalize only when the payload is a brief; flat submissions pass through. */
export function normalizeSubmission(raw: unknown): Record<string, unknown> | unknown {
  if (!isBriefSubmission(raw)) return raw;
  return normalizeBrief(raw).normalized;
}
