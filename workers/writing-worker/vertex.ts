import { env, isVertexConfigured } from "../shared/env";
import { logger } from "../shared/logger";
import { generateVertexText, slugify, VertexQuotaError, type VertexTextResult } from "../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../shared/settings";
import { buildSectionPlan, generateAllSections, type SectionArticleContext, DEFAULT_MUST_FOLLOW_RULES } from "./sections";
import type { GroundedSource } from "./citations";
import { ensureKeywordInTitle, ensureKeywordInH1, extractH1 } from "../shared/seo-keyword";
import { buildGlobalRulesBlock } from "../shared/editorial-rules";
import { resolveEditorialPolicy, type EditorialPolicy } from "../shared/editorial-policy";
import { buildBriefDirectivesBlock, readBriefSpecs } from "../shared/brief";

const log = logger.child({ worker: "writing-worker" });

/**
 * Task 10 (docs/VERTEX_429_RESILIENCE_PLAN.md): when the Pro-class writing
 * model is persistently quota-exhausted (VertexQuotaError after the
 * call-level retries in shared/vertex.ts), rerun the same prompt once on
 * VERTEX_FLASH instead of failing the whole job. The returned model is the
 * one that ACTUALLY produced the text - callers record/report that
 * (BlogDraft.model already flows into AIUsage, so the fallback is visible
 * in cost/model rollups, and the error log makes it greppable).
 */
async function generateTextWithQuotaFallback(
  configuredModel: string,
  prompt: string,
  options: { maxOutputTokens: number; temperature: number }
): Promise<{ result: VertexTextResult; model: string }> {
  try {
    return {
      result: await generateVertexText(configuredModel, prompt, { ...options, timeoutMs: env.WRITING_TIMEOUT_MS }),
      model: configuredModel,
    };
  } catch (error) {
    if (!env.VERTEX_MODEL_FALLBACK_ENABLED || !(error instanceof VertexQuotaError) || configuredModel === env.VERTEX_FLASH) {
      throw error;
    }
    log.error("Writing model quota exhausted - falling back to Flash for this call", {
      model: configuredModel,
      fallbackModel: env.VERTEX_FLASH,
      fallback: true,
    });
    return {
      result: await generateVertexText(env.VERTEX_FLASH, prompt, { ...options, timeoutMs: env.WRITING_TIMEOUT_MS }),
      model: env.VERTEX_FLASH,
    };
  }
}

export type BlogDraft = {
  title: string;
  slug: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  markdown: string;
  usage: { promptTokens: number; completionTokens: number };
  /** Actual model used for this draft - the dashboard can override the env default per stage, so index.ts should trust this rather than re-deriving it from env.VERTEX_MODEL. */
  model: string;
  /**
   * Task 5: per-call usage rows when sectioned writing produced the draft
   * (one row per generated section + optional editor pass; cached sections
   * contribute none). When present, index.ts records these individually so
   * per-model cost rollups stay accurate - the aggregate `usage`/`model`
   * fields remain for latency logging and the legacy path.
   */
  usageRecords?: { model: string; usage: { promptTokens: number; completionTokens: number } }[];
};

export type WritingContext = {
  plan?: {
    searchIntent: string;
    audience: string;
    angle: string;
    primaryKeyword: string;
    secondaryKeywords: unknown;
    competitorNotes: unknown;
  };
  outline?: {
    title: string;
    metaTitle: string;
    metaDescription: string;
    sections: unknown;
    faqs: unknown;
    claims?: unknown;
  };
  /** BlogInput.evidenceSummary - the reference material this article should cite. Empty for unsourced submissions. See IMPLEMENTATION_PLAN.md Phase 2.2. */
  evidenceSummary?: string;
  /**
   * Full-text evidence sources with [S1]-style markers
   * (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 2). When present, this
   * SUPERSEDES evidenceSummary in the prompt: the model cites markers and
   * workers/writing-worker/citations.ts materializes them into real links.
   */
  evidenceSources?: GroundedSource[];
  /** Set when this is a quality-worker-triggered rewrite - see workers/quality-worker/index.ts's recoveryContext. */
  priorAttempt?: { score: number; reasons: string[] };
  /** Needed by sectioned writing (Task 5) for the per-submission section cache key. */
  blogInputId?: string;
  /** BlogInput.tone - professional | casual | technical. */
  tone?: string;
  /** BlogInput.contentLength - the editor's target word count for the article. */
  targetWords?: number;
  /**
   * BlogInput.focusKeyword - the phrase this article must rank for. The
   * article contract (workers/shared/article-contract.ts) requires it
   * verbatim in the H1, the introduction, and at least one H2, so the prompt
   * asks for that placement and enforceSingleH1 guarantees the H1.
   */
  focusKeyword?: string;
  /**
   * Resolved editorial policy (table of contents, anchor links, approved
   * links). Defaults are the house rules - see shared/editorial-policy.ts.
   */
  policy?: EditorialPolicy;
  /**
   * Brief requirements with no column of their own (audience pain points,
   * scenarios to work in, evidence rules) - see shared/brief.ts.
   */
  briefDirectives?: string[];
  /** Full submission specs (writingInstructions, internalLinks, etc.) */
  specs?: Record<string, unknown>;
  internalLinks?: string[];
  writingInstructions?: string[];
  mustFollow?: string[];
};

/**
 * The editor's target word count wins over the BLOG_MIN_WORDS/BLOG_MAX_WORDS
 * env defaults, with a +-10% band so the model has room to land naturally.
 * Falls back to the env range when the submission didn't specify one.
 */
export function wordRange(targetWords?: number): { min: number; max: number } {
  if (!targetWords || targetWords <= 0) return { min: env.BLOG_MIN_WORDS, max: env.BLOG_MAX_WORDS };
  return { min: Math.round(targetWords * 0.9), max: Math.round(targetWords * 1.1) };
}

const TONE_GUIDANCE: Record<string, string> = {
  professional: "Tone: professional and authoritative - plain, confident prose, zero fluff.",
  casual: "Tone: conversational and approachable - second person, short sentences, still precise. Zero fluff.",
  technical: "Tone: technical and precise - assume an engineering reader, favour mechanism over metaphor. Zero fluff.",
};

function buildPrompt(topic: string, description: string, context: WritingContext = {}): string {
  const focusKeyword = context.focusKeyword?.trim();
  const policy = context.policy ?? resolveEditorialPolicy(context.specs);
  const primaryKeyword = context.plan?.primaryKeyword?.trim();
  const secondaryKeywords = Array.isArray(context.plan?.secondaryKeywords)
    ? context.plan.secondaryKeywords.map(String).filter(Boolean)
    : [];
  const targetKeywords = [primaryKeyword, ...secondaryKeywords].filter(Boolean) as string[];

  // Task 2: when full-text evidence sources are available, the prompt
  // grounds on them with a [S1]-marker citation protocol, and rules 8/10
  // switch from "paste URLs" to "emit markers". Unsourced submissions (no
  // evidenceArticles) keep the original titles-only evidence block.
  const sources = context.evidenceSources ?? [];
  const grounded = sources.length > 0;
  const markerList = sources.map((source) => source.marker).join(", ");
  const evidenceBlock = grounded
    ? `SOURCES (ground truth for specific facts; use only the FACTS listed under each source):
${sources.map((source) => `${source.marker} ${source.title} - ${source.url}\nFACTS:\n${source.evidence.map((fact) => `- ${fact}`).join("\n")}`).join("\n")}`
    : `Evidence (the research source material this article is grounded in - cite specific facts/statistics/claims to these sources rather than treating the URLs as background color):
${context.evidenceSummary || "No evidence summary provided."}`;
  const citationProtocol = grounded
    ? `
Citation protocol (mandatory):
- When you state a specific fact, number, percentage, date, version, statistic, or capability drawn from the SOURCES, append its source marker inline immediately after the claim (e.g. "... cuts cold-start latency noticeably [S1].").
- Every specific claim drawn from sources MUST carry a marker. If no source covers it, write it qualitatively instead - no invented figures.
- Only these markers exist: ${markerList}. Never invent other markers. Never paste raw URLs into the article - markers only; they are converted into inline links automatically.
- Use at least two distinct markers in the article body when two or more sources are provided.
- Do NOT add a "Sources" or "References" section at the end.
`
    : "";
  const rule8 = grounded
    ? "8. Follow the Citation protocol above for every specific claim - markers, never raw URLs."
    : `8. When you state a specific fact, statistic, or claim drawn from the Evidence above, cite it with an inline Markdown link to its exact source URL from that evidence (e.g. "according to [the source](https://...)"). Cite at least two distinct source URLs from the Evidence if two or more are available there - don't invent URLs that aren't in the Evidence.`;
  const rule10 = grounded
    ? `10. Only state a specific number, percentage, date, version, or named benchmark result if it explicitly appears in the SOURCES above (with its marker attached per the protocol). For anything the SOURCES don't cover, describe it qualitatively instead of inventing a figure. Explain architectural concepts, official framework features, and standard developer paradigms thoroughly with technical depth. Avoid unsupported benchmark speed rankings or declaring an unqualified "best" framework without evidence.`
    : `10. Only state a specific number, percentage, date, version, or named benchmark result if it is explicitly present in the Evidence above. For anything the Evidence doesn't cover, describe it qualitatively instead of inventing a figure. Explain architectural concepts, official framework features, and standard developer paradigms thoroughly with technical depth. Avoid unsupported benchmark speed rankings or declaring an unqualified "best" framework without evidence.`;

  const { min: minWords, max: maxWords } = wordRange(context.targetWords);

  const rawSpecs = (context.specs ?? {}) as Record<string, unknown>;
  const nestedSpecs = (rawSpecs.specs ?? {}) as Record<string, unknown>;
  const writingInstructions: string[] =
    context.writingInstructions ??
    (Array.isArray(rawSpecs.writingInstructions)
      ? (rawSpecs.writingInstructions as string[])
      : Array.isArray(nestedSpecs.writingInstructions)
      ? (nestedSpecs.writingInstructions as string[])
      : []);
  const writingInstructionsBlock =
    writingInstructions.length > 0
      ? `\nEditorial Writing Instructions:\n${writingInstructions.map((inst) => `- ${inst}`).join("\n")}\n`
      : "";

  const internalLinks: string[] =
    context.internalLinks ??
    (Array.isArray(rawSpecs.internalLinks)
      ? (rawSpecs.internalLinks as string[])
      : Array.isArray(nestedSpecs.internalLinks)
      ? (nestedSpecs.internalLinks as string[])
      : []);
  const internalLinksBlock =
    internalLinks.length > 0
      ? `\nInternal links to naturally weave into text where contextually appropriate: ${internalLinks.join(", ")}.\n`
      : "";

  const rawGenInst = (rawSpecs.generationInstructions ?? nestedSpecs.generationInstructions) as Record<string, unknown> | undefined;
  const userMustFollow = Array.isArray(rawGenInst?.mustFollow)
    ? (rawGenInst.mustFollow as string[])
    : Array.isArray(context.mustFollow)
    ? context.mustFollow
    : [];
  const mustFollowRules = Array.from(new Set([...DEFAULT_MUST_FOLLOW_RULES, ...userMustFollow]));
  const mustFollowBlock = `
Mandatory Generation Instructions (Must Follow):
${mustFollowRules.map((rule, idx) => `${idx + 1}. ${rule}`).join("\n")}
`;

  // The article contract rejects a draft that places the focus keyword
  // loosely, so the placement is spelled out rather than left to the model's
  // SEO instincts. enforceSingleH1 is the safety net for the H1; the
  // introduction and H2 placements can only come from the model.
  const focusKeywordBlock = focusKeyword
    ? `
Focus keyword placement (mandatory - the draft is rejected automatically when any of these is missing):
- Focus keyword: "${focusKeyword}"
- The H1 (first line) MUST contain "${focusKeyword}" verbatim, e.g. "# ${focusKeyword}: [rest of the title]".
- The FIRST paragraph of the introduction MUST contain "${focusKeyword}" verbatim.
- At least one "## " heading MUST contain "${focusKeyword}" verbatim.
- Use the exact phrase; a reworded variant does not count. Everywhere else use it only where it reads naturally - no keyword stuffing.
`
    : "";

  const globalRulesBlock = buildGlobalRulesBlock(policy, focusKeyword);
  const briefBlock = buildBriefDirectivesBlock(context.briefDirectives ?? readBriefSpecs(context.specs).directives);

  const outlineSections = Array.isArray(context.outline?.sections)
    ? (context.outline.sections as Array<Record<string, unknown>>)
    : [];

  const tocInstruction = !policy.tableOfContents
    ? "- Do not include a Table of Contents section."
    : policy.anchorLinks
      ? "- Include a Table of Contents (## Table of Contents) with anchor links to every H2 section, right after the introduction."
      : "- Include a Table of Contents (## Table of Contents) listing every H2 section as plain text - no links - right after the introduction.";

  const structureSection =
    outlineSections.length > 0
      ? `Article Structure Instructions:
- Follow the approved outline sections and subsections exactly as given in the Approved outline above.
${tocInstruction}
- If an outline section specifies a comparisonTable, render the full Markdown comparison table with the specified columns and rows.
- If an outline section has subsections or paragraphs, emit each as an "### [Heading]" subsection with detailed technical prose addressing the discussion points.
- Aim for ${minWords}-${maxWords} words, but do not pad: cover the outline properly and stop. A shorter article beats a padded one.`
      : `Article structure - choose the sections this topic actually needs:
# [Article title]

[Introduction: 2-4 paragraphs establishing the topic, the reader's problem, and what they will be able to do by the end.]
${policy.tableOfContents ? `
## Table of Contents
[${policy.anchorLinks ? "List every H2 below as an anchor-style Markdown link." : "List every H2 below as plain text - no links."}]
` : ""}
Then 4-7 "## " sections, named after what they actually cover and ordered the way a reader needs them. Shapes that tend to work - pick only the ones this topic needs, and never all of them:
- what the thing is, and when it applies
- how it works, broken into named "### " steps
- implementation guidance with short, complete code examples
- trade-offs, or a comparison table when there is a real comparison to make
- pitfalls and how to avoid them
- a short FAQ of questions readers actually ask

## Conclusion
[The practical takeaways and one concrete next step.]

Do not add a section that repeats another section's ground, and do not add a section merely because it is a common blog heading.`;

  return `You are a Staff Technical Writer for DevKit Market, a developer-focused tech blog.

Write a ${minWords}-${maxWords} word technical blog post in GitHub Flavored Markdown.

Topic: "${topic}"
Context: ${description || "No additional context provided."}
Content plan:
${context.plan ? JSON.stringify(context.plan, null, 2) : "No separate content plan provided."}

Target keywords (each must appear verbatim, case-insensitive, at least once somewhere in the article body):
${targetKeywords.length ? targetKeywords.map((keyword) => `- ${keyword}`).join("\n") : "- No target keywords provided."}
${focusKeywordBlock}
Approved outline:
${context.outline ? JSON.stringify(context.outline, null, 2) : "No separate outline provided."}

${evidenceBlock}
${citationProtocol}${
  context.priorAttempt
    ? `
This is a REWRITE. The previous attempt scored ${context.priorAttempt.score}/100 and failed the quality gate for these reasons:
${context.priorAttempt.reasons.map((reason) => `- ${reason}`).join("\n")}
Fix the weak areas listed above. Preserve anything that was already working - this is a targeted rewrite, not a fresh take.
`
    : ""
}
${writingInstructionsBlock}${internalLinksBlock}${briefBlock}${mustFollowBlock}${globalRulesBlock}
Guidelines:
1. ${TONE_GUIDANCE[context.tone ?? "professional"] ?? TONE_GUIDANCE.professional}
2. Use the approved outline as the authoritative article structure.
3. ${policy.tableOfContents ? (policy.anchorLinks ? "Include the Table of Contents section, linking every H2 as a Markdown anchor." : "Include the Table of Contents section as a plain list of H2 names, with no links.") : "Do not include a Table of Contents section."}
4. Use proper GitHub Flavored Markdown.
5. Do not invent unsupported facts. Use cautious wording when evidence is incomplete.
6. If the article ends with a call to action, keep it to one short, practical paragraph related to DevKit Market.
${rule8}
9. Use the target keywords only where they read naturally - the global content rules above take precedence over keyword coverage.
${rule10}
11. Keep paragraphs under 100 words each. Sentences should average 15-20 words.
12. Include comparison tables, lists, and short code snippets where appropriate.

${structureSection}

Heading rules:
- Use exactly one H1: the first line must start with "# ".
- Never use "# " again after the first line. All main sections must use "## ". Subsections must use "### ".
- Every H3 must have substantial technical paragraphs under it.

Respond with ONLY the article body as Markdown. Do not return JSON. Do not wrap the whole article in a code fence.`;
}

/**
 * Exactly one H1 - and, when the submission has a focus keyword, an H1 that
 * actually contains it. The prompt asks for that placement, but "asked for"
 * is not "guaranteed": an H1 that drops the keyword fails the article
 * contract and burns a full retry, so the title is repaired here instead.
 * The repair only fires when the model didn't place the keyword itself, and
 * logs when it does - a prompt that drifts stays visible rather than being
 * silently patched on every article.
 */
export function enforceSingleH1(markdown: string, title: string, focusKeyword?: string): string {
  const lines = markdown.trim().split("\n");
  let seenH1 = false;
  const normalized = lines.map((line, index) => {
    if (!line.startsWith("# ")) return line;
    if (!seenH1 && index === 0) {
      seenH1 = true;
      return line;
    }
    if (!seenH1) {
      seenH1 = true;
      return line;
    }
    return `## ${line.slice(2).trim()}`;
  });

  const body = seenH1
    ? normalized.join("\n").trim()
    : `# ${ensureKeywordInTitle(title, focusKeyword)}\n\n${normalized.join("\n").trim()}`;

  const repaired = ensureKeywordInH1(body, focusKeyword);
  if (repaired.repairedH1) {
    log.warn("Draft H1 was missing the focus keyword - title repaired", {
      focusKeyword,
      h1: repaired.previousH1,
      repairedH1: repaired.repairedH1,
    });
  }
  return repaired.markdown;
}

function seoMetaDescription(candidate: string | undefined, title: string, keywords: string[]): string {
  const trimmed = candidate?.trim() ?? "";
  if (trimmed.length >= 80 && trimmed.length <= 160) return trimmed;

  const keywordText = keywords.length > 0 ? `, including ${keywords.slice(0, 3).join(", ")},` : "";
  return `A practical technical guide to ${title}${keywordText} with architecture trade-offs, examples, and decision guidance for developers.`.slice(
    0,
    160
  );
}

let warnedMock = false;

async function generateMock(topic: string, description: string, context: WritingContext = {}): Promise<BlogDraft> {
  if (!warnedMock) {
    log.warn(
      "Vertex AI is not configured - using local writer fallback. Set GOOGLE_CLOUD_PROJECT and VERTEX_LOCATION, and authenticate with GOOGLE_APPLICATION_CREDENTIALS or ADC."
    );
    warnedMock = true;
  }

  const title = context.outline?.title ?? topic;
  const markdown = `## Draft unavailable\n\nWriter credentials are not configured for this environment.${
    description ? `\n\nTopic note: ${description}` : ""
  }\n\nSet \`GOOGLE_CLOUD_PROJECT\`, \`VERTEX_LOCATION\`, and \`GOOGLE_APPLICATION_CREDENTIALS\` in \`.env\` to generate a full ${wordRange(context.targetWords).min}-${wordRange(context.targetWords).max} word article with Vertex AI.`;

  return {
    title,
    slug: slugify(title),
    excerpt: `Configure Vertex AI credentials to generate content for "${topic}".`,
    metaTitle: title.slice(0, 60),
    metaDescription: `Article generation is pending credentials for ${topic}.`.slice(0, 160),
    keywords: [topic.toLowerCase()],
    markdown,
    usage: { promptTokens: 0, completionTokens: 0 },
    model: "fallback",
  };
}

async function generateWithVertex(topic: string, description: string, context: WritingContext = {}): Promise<BlogDraft> {
  const configuredModel = await getSetting(MODEL_SETTING_KEYS.writing, env.VERTEX_MODEL);
  const prompt = buildPrompt(topic, description, context);
  const { result, model } = await generateTextWithQuotaFallback(configuredModel, prompt, {
    maxOutputTokens: 8192,
    temperature: 0.35,
  });

  const focusKeyword = context.focusKeyword?.trim();
  const title = ensureKeywordInTitle(context.outline?.title ?? topic, focusKeyword);
  const keywords = [
    context.plan?.primaryKeyword,
    ...(Array.isArray(context.plan?.secondaryKeywords) ? context.plan.secondaryKeywords.map(String) : []),
  ].filter(Boolean) as string[];

  const markdown = enforceSingleH1(result.text, title, focusKeyword);
  // The stored title and slug must match the article a reader sees, so they
  // follow the final H1 rather than the outline's working title - the two
  // can differ, and the H1 is the one that was keyword-enforced.
  const articleTitle = extractH1(markdown) ?? title;

  return {
    title: articleTitle,
    slug: slugify(articleTitle),
    excerpt: (context.outline?.metaDescription || `Technical guide to ${topic}`).slice(0, 200),
    metaTitle: ensureKeywordInTitle(context.outline?.metaTitle || articleTitle, focusKeyword, { maxLength: 60 }),
    metaDescription: seoMetaDescription(context.outline?.metaDescription, articleTitle, keywords),
    keywords: keywords.length > 0 ? keywords.slice(0, 8) : [topic.toLowerCase()],
    markdown,
    usage: result.usage,
    model,
  };
}

/**
 * Task 5: section-by-section drafting. Decomposes the article into the
 * mandatory section skeleton (sections.ts), generates each section in
 * parallel with per-section retry + Redis caching, assembles in order, and
 * optionally runs a Pro-class editor pass for voice cohesion. Returns the
 * same BlogDraft shape as the monolithic path - downstream wiring in
 * index.ts is unchanged apart from per-section cost recording.
 */
async function generateSectionedDraft(topic: string, description: string, context: WritingContext): Promise<BlogDraft> {
  const focusKeyword = context.focusKeyword?.trim();
  const policy = context.policy ?? resolveEditorialPolicy(context.specs);
  const title = ensureKeywordInTitle(context.outline?.title ?? topic, focusKeyword);
  const keywords = [
    context.plan?.primaryKeyword,
    ...(Array.isArray(context.plan?.secondaryKeywords) ? context.plan.secondaryKeywords.map(String) : []),
  ].filter(Boolean) as string[];

  const rawSpecs = (context.specs ?? {}) as Record<string, unknown>;
  const nestedSpecs = (rawSpecs.specs ?? {}) as Record<string, unknown>;
  const writingInstructions: string[] =
    context.writingInstructions ??
    (Array.isArray(rawSpecs.writingInstructions)
      ? (rawSpecs.writingInstructions as string[])
      : Array.isArray(nestedSpecs.writingInstructions)
      ? (nestedSpecs.writingInstructions as string[])
      : []);
  const internalLinks: string[] =
    context.internalLinks ??
    (Array.isArray(rawSpecs.internalLinks)
      ? (rawSpecs.internalLinks as string[])
      : Array.isArray(nestedSpecs.internalLinks)
      ? (nestedSpecs.internalLinks as string[])
      : []);

  const rawGenInst = (rawSpecs.generationInstructions ?? nestedSpecs.generationInstructions) as Record<string, unknown> | undefined;
  const userMustFollow = Array.isArray(rawGenInst?.mustFollow)
    ? (rawGenInst.mustFollow as string[])
    : Array.isArray(context.mustFollow)
    ? context.mustFollow
    : [];
  const mustFollowRules = Array.from(new Set([...DEFAULT_MUST_FOLLOW_RULES, ...userMustFollow]));

  const sectionContext: SectionArticleContext = {
    title,
    topic,
    description,
    plan: context.plan,
    outline: context.outline ? { sections: context.outline.sections, faqs: context.outline.faqs } : undefined,
    sources: context.evidenceSources,
    evidenceSummary: context.evidenceSummary,
    keywords,
    focusKeyword,
    policy,
    briefDirectives: context.briefDirectives ?? readBriefSpecs(context.specs).directives,
    tone: context.tone,
    targetWords: context.targetWords,
    specs: context.specs,
    internalLinks,
    writingInstructions,
    mustFollow: mustFollowRules,
  };

  const plan = buildSectionPlan(sectionContext);
  const { drafts, usage, models } = await generateAllSections(plan, sectionContext, context.blogInputId ?? "unknown");

  const usageRecords = drafts
    .filter((draft) => !draft.fromCache)
    .map((draft) => ({ model: draft.model, usage: draft.usage }));

  const assemble = () => enforceSingleH1(drafts.map((draft) => draft.markdown).join("\n\n"), title, focusKeyword);
  let markdown = assemble();

  // Optional Pro-class cohesion pass over the assembled article. Off by
  // default - enable only after measuring its value against its cost.
  // Deferrable (docs/VERTEX_429_RESOLUTION_PLAN.md Step 5): polish is
  // enrichment, not correctness - under quota exhaustion the pass is
  // SKIPPED and the assembled sections ship as-is, rather than failing
  // the whole draft or burning the scarce Pro pool on a nice-to-have.
  if (env.EDITOR_PASS_ENABLED) {
    const editorModel = await getSetting(MODEL_SETTING_KEYS.writing, env.VERTEX_MODEL);
    try {
      const edited = await generateVertexText(
        editorModel,
        `You are the editor of a developer blog. Polish this assembled article for voice cohesion and transitions between sections; remove any sentence duplicated across sections. Do not add, remove, or alter any specific claim (numbers, dates, versions, capabilities) - polish transitions and voice only. Preserve every "## " heading, every [S1]-style citation marker, every table, and every code block exactly as-is. Return ONLY the full article Markdown.\n\n${markdown}`,
        { maxOutputTokens: 8192, temperature: 0.2, timeoutMs: env.WRITING_TIMEOUT_MS, priority: "deferrable" }
      );
      markdown = enforceSingleH1(edited.text, title, focusKeyword);
      usage.promptTokens += edited.usage.promptTokens;
      usage.completionTokens += edited.usage.completionTokens;
      usageRecords.push({ model: editorModel, usage: edited.usage });
      models.push(editorModel);
    } catch (error) {
      if (error instanceof VertexQuotaError) {
        log.warn("Editor pass skipped - quota exhausted (circuit breaker)", { model: editorModel });
      } else {
        throw error;
      }
    }
  }

  log.info("Sectioned draft assembled", {
    sections: drafts.length,
    cached: drafts.filter((draft) => draft.fromCache).length,
    models,
    editorPass: env.EDITOR_PASS_ENABLED,
  });

  const articleTitle = extractH1(markdown) ?? title;

  return {
    title: articleTitle,
    slug: slugify(articleTitle),
    excerpt: (context.outline?.metaDescription || `Technical guide to ${topic}`).slice(0, 200),
    metaTitle: ensureKeywordInTitle(context.outline?.metaTitle || articleTitle, focusKeyword, { maxLength: 60 }),
    metaDescription: seoMetaDescription(context.outline?.metaDescription, articleTitle, keywords),
    keywords: keywords.length > 0 ? keywords.slice(0, 8) : [topic.toLowerCase()],
    markdown,
    usage,
    model: models.join("+") || env.VERTEX_FLASH,
    usageRecords,
  };
}

export async function generateBlogDraft(
  topic: string,
  description: string,
  context: WritingContext = {}
): Promise<BlogDraft> {
  if (!isVertexConfigured) return generateMock(topic, description, context);
  // Task 5 flag: sectioned writing replaces the monolithic draft. Off =
  // the exact pre-Task-5 single-call behavior. A brief's
  // generationConfig.generationMode overrides the flag for that submission.
  const mode = readBriefSpecs(context.specs).generationMode;
  if (mode === "section_by_section") return generateSectionedDraft(topic, description, context);
  if (mode === "single_pass" || mode === "monolithic") return generateWithVertex(topic, description, context);
  if (env.SECTIONED_WRITING_ENABLED) return generateSectionedDraft(topic, description, context);
  return generateWithVertex(topic, description, context);
}
