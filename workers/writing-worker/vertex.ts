import { env, isVertexConfigured } from "../shared/env";
import { logger } from "../shared/logger";
import { generateVertexText, slugify } from "../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../shared/settings";
import { buildSectionPlan, generateAllSections, type SectionArticleContext } from "./sections";
import type { GroundedSource } from "./citations";

const log = logger.child({ worker: "writing-worker" });

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
  };
  /** Trend.evidenceSummary - the research source material this article should cite. See IMPLEMENTATION_PLAN.md Phase 2.2. */
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
  /** Needed by sectioned writing (Task 5) for the per-trend section cache key. */
  trendId?: string;
};

function buildPrompt(topic: string, description: string, context: WritingContext = {}): string {
  const primaryKeyword = context.plan?.primaryKeyword?.trim();
  const secondaryKeywords = Array.isArray(context.plan?.secondaryKeywords)
    ? context.plan.secondaryKeywords.map(String).filter(Boolean)
    : [];
  const targetKeywords = [primaryKeyword, ...secondaryKeywords].filter(Boolean) as string[];

  // Task 2: when full-text evidence sources are available, the prompt
  // grounds on them with a [S1]-marker citation protocol, and rules 8/10
  // switch from "paste URLs" to "emit markers". Legacy trends (no
  // evidenceArticles) keep the original titles-only evidence block.
  const sources = context.evidenceSources ?? [];
  const grounded = sources.length > 0;
  const markerList = sources.map((source) => source.marker).join(", ");
  const evidenceBlock = grounded
    ? `SOURCES (the ONLY ground truth for specific facts - full-text excerpts of the research evidence):
${sources.map((source) => `${source.marker} ${source.title} - ${source.url}\n    "${source.excerpt}"`).join("\n")}`
    : `Evidence (the research source material this article is grounded in - cite specific facts/statistics/claims to these sources rather than treating the URLs as background color):
${context.evidenceSummary || "No evidence summary provided."}`;
  const citationProtocol = grounded
    ? `
Citation protocol (mandatory):
- When you state a specific fact, number, percentage, date, version, statistic, or capability drawn from the SOURCES, append its source marker inline immediately after the claim (e.g. "... cuts cold-start latency noticeably [S1].").
- Every specific claim MUST carry a marker. If no source covers it, write it qualitatively instead - no invented figures.
- Only these markers exist: ${markerList}. Never invent other markers. Never paste raw URLs into the article - markers only; they are converted into inline links automatically.
- Use at least two distinct markers in the article body when two or more sources are provided.
- Do NOT add a "Sources" or "References" section at the end.
`
    : "";
  const rule8 = grounded
    ? "8. Follow the Citation protocol above for every specific claim - markers, never raw URLs."
    : `8. When you state a specific fact, statistic, or claim drawn from the Evidence above, cite it with an inline Markdown link to its exact source URL from that evidence (e.g. "according to [the source](https://...)"). Cite at least two distinct source URLs from the Evidence if two or more are available there - don't invent URLs that aren't in the Evidence.`;
  const rule10 = grounded
    ? `10. Only state a specific number, percentage, date, version, or named benchmark result if it explicitly appears in the SOURCES above (with its marker attached per the protocol). For anything the SOURCES don't cover, describe it qualitatively instead of inventing a figure (e.g. "adds noticeable memory overhead", not a fabricated "uses 40% more memory"). This also applies to specific product features, architecture, or deployment/technical capabilities of the article's subject (a company, product, or service) - don't assert a specific capability unless a source says so, and don't state what it "is" or "does" as if confirmed when no source covers it. When the SOURCES are thin on the subject's actual product/mechanics, write Key Features, How it Works, and Real World Use Cases about the general category/technology instead, rather than presenting invented specifics as confirmed facts about the named subject. Vagueness on uncovered specifics is fine; invented precision is not.`
    : `10. Only state a specific number, percentage, date, version, or named benchmark result if it is explicitly present in the Evidence above. For anything the Evidence doesn't cover, describe it qualitatively instead of inventing a figure (e.g. "adds noticeable memory overhead", not a fabricated "uses 40% more memory"). This also applies to specific product features, architecture, or deployment/technical capabilities of the article's subject (a company, product, or service) - don't assert a specific capability (e.g. "offers an on-premise deployment option") unless it's in the Evidence, and don't state what it "is" or "does" as if confirmed (e.g. not "Superblocks is a programmable platform for workflows and scheduled jobs" when the Evidence never says that). When the Evidence is thin and doesn't describe the subject's actual product/mechanics (common for fresh news items), write Key Features, How it Works, and Real World Use Cases about the general category/technology instead (e.g. "low-code internal-tooling platforms in this category typically let teams...") rather than presenting invented specifics as confirmed facts about the named subject. Vagueness on uncovered specifics is fine; invented precision is not.`;

  return `You are a Staff Technical Writer for DevKit Market, a developer-focused tech blog.

Write a ${env.BLOG_MIN_WORDS}-${env.BLOG_MAX_WORDS} word technical blog post in GitHub Flavored Markdown.

Topic: "${topic}"
Context: ${description || "No additional context provided."}
Content plan:
${context.plan ? JSON.stringify(context.plan, null, 2) : "No separate content plan provided."}

Target keywords (each must appear verbatim, case-insensitive, at least once somewhere in the article body):
${targetKeywords.length ? targetKeywords.map((keyword) => `- ${keyword}`).join("\n") : "- No target keywords provided."}

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

Guidelines:
1. Tone: technical, practical, zero fluff.
2. Use the approved outline as factual/source context, but reshape the final article into the mandatory structure below.
3. Always include the Table of Contents section below, regardless of article length.
4. Include at least one Markdown comparison table in Pros and Cons.
5. Use proper GitHub Flavored Markdown.
6. Do not invent unsupported facts. Use cautious wording when evidence is incomplete.
7. The Call To Action should be short, practical, and related to DevKit Market.
${rule8}
9. Weave every phrase in "Target keywords" naturally into the body at least once each - in a heading, a sentence, or an FAQ question. Never dump keywords as a list, sentence, or aside (e.g. do NOT write "Keywords: X, Y, Z" or a sentence that just strings the phrases together). If a keyword doesn't fit naturally in a sentence, use it as a subsection heading instead (e.g. under Key Features, Real World Use Cases, or an FAQ question).
${rule10}
11. Keep paragraphs under 100 words - this is a hard limit, not a target. If a paragraph runs long while drafting, split it into two before moving on. Sentences should average 15-20 words.
12. Beyond the mandatory Pros and Cons table, include at least one bullet list and one numbered list elsewhere in the body (e.g. Best Practices as a numbered checklist, Common Mistakes as bullets), and at least one fenced code block showing a command, config snippet, or short example relevant to the topic - place it wherever it's most natural (How it Works or Best Practices). Use "- " (hyphen + space) for every bullet list in the article - never "* " (asterisk) - and "1. ", "2. ", etc. for numbered lists.

Mandatory Markdown structure:
# [SEO-friendly title]

[Introduction: 2-4 paragraphs that explain the topic, reader problem, and practical value.]

## Table of Contents
[Always include this section. List every H2 below as an anchor-style Markdown link.]

## What is [topic]?
[Clear definition and context.]

## Why it matters
[Explain developer/business/security/ecosystem impact.]

## Key Features
### [Feature 1]
### [Feature 2]
### [Feature 3]

## Benefits
### [Benefit 1]
### [Benefit 2]

## How it Works
### Step 1: [Name]
### Step 2: [Name]
### Step 3: [Name]
### Step 4: [Name]

## Real World Use Cases
### [Use Case 1]
### [Use Case 2]
### [Use Case 3]

## Pros and Cons
[Use a Markdown table.]

## Best Practices
[Practical checklist or guidance.]

## Common Mistakes
[Mistakes and how to avoid them.]

## FAQs
[4-6 H3 questions with concise answers.]

## Conclusion
[Summarize the practical takeaway.]

## Call To Action
[One short CTA paragraph.]

Heading rules:
- Use exactly one H1: the first line must start with "# ".
- Never use "# " again after the first line. All main sections must use "## ". Subsections must use "### ".
- Use the H2 labels above exactly, except "[topic]" and bracketed placeholders should be replaced naturally.
- Use H3 only under Key Features, Benefits, How it Works, Real World Use Cases, and FAQs.
- Every H3 must have at least one useful paragraph under it.

Respond with ONLY the article body as Markdown. Do not return JSON. Do not wrap the whole article in a code fence.`;
}

function enforceSingleH1(markdown: string, title: string): string {
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

  if (!seenH1) {
    return `# ${title}\n\n${normalized.join("\n").trim()}`;
  }

  return normalized.join("\n").trim();
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
  }\n\nSet \`GOOGLE_CLOUD_PROJECT\`, \`VERTEX_LOCATION\`, and \`GOOGLE_APPLICATION_CREDENTIALS\` in \`.env\` to generate a full ${env.BLOG_MIN_WORDS}-${env.BLOG_MAX_WORDS} word article with Vertex AI.`;

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
  const model = await getSetting(MODEL_SETTING_KEYS.writing, env.VERTEX_MODEL);
  const prompt = buildPrompt(topic, description, context);
  const result = await generateVertexText(model, prompt, {
    maxOutputTokens: 8192,
    temperature: 0.35,
    timeoutMs: env.WRITING_TIMEOUT_MS,
  });

  const title = context.outline?.title ?? topic;
  const keywords = [
    context.plan?.primaryKeyword,
    ...(Array.isArray(context.plan?.secondaryKeywords) ? context.plan.secondaryKeywords.map(String) : []),
  ].filter(Boolean) as string[];

  return {
    title,
    slug: slugify(title),
    excerpt: (context.outline?.metaDescription || `Technical guide to ${topic}`).slice(0, 200),
    metaTitle: (context.outline?.metaTitle || title).slice(0, 60),
    metaDescription: (context.outline?.metaDescription || `Technical guide to ${topic}`).slice(0, 160),
    keywords: keywords.length > 0 ? keywords.slice(0, 8) : [topic.toLowerCase()],
    markdown: enforceSingleH1(result.text, title),
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
  const title = context.outline?.title ?? topic;
  const keywords = [
    context.plan?.primaryKeyword,
    ...(Array.isArray(context.plan?.secondaryKeywords) ? context.plan.secondaryKeywords.map(String) : []),
  ].filter(Boolean) as string[];

  const sectionContext: SectionArticleContext = {
    title,
    topic,
    description,
    plan: context.plan,
    outline: context.outline ? { sections: context.outline.sections, faqs: context.outline.faqs } : undefined,
    sources: context.evidenceSources,
    keywords,
  };

  const plan = buildSectionPlan(sectionContext);
  const { drafts, usage, models } = await generateAllSections(plan, sectionContext, context.trendId ?? "unknown");

  const usageRecords = drafts
    .filter((draft) => !draft.fromCache)
    .map((draft) => ({ model: draft.model, usage: draft.usage }));

  let markdown = enforceSingleH1(drafts.map((draft) => draft.markdown).join("\n\n"), title);

  // Optional Pro-class cohesion pass over the assembled article. Off by
  // default - enable only after measuring its value against its cost.
  if (env.EDITOR_PASS_ENABLED) {
    const editorModel = await getSetting(MODEL_SETTING_KEYS.writing, env.VERTEX_MODEL);
    const edited = await generateVertexText(
      editorModel,
      `You are the editor of a developer blog. Polish this assembled article for voice cohesion and transitions between sections; remove any sentence duplicated across sections. Do not add, remove, or alter any specific claim (numbers, dates, versions, capabilities) - polish transitions and voice only. Preserve every "## " heading, every [S1]-style citation marker, every table, and every code block exactly as-is. Return ONLY the full article Markdown.\n\n${markdown}`,
      { maxOutputTokens: 8192, temperature: 0.2, timeoutMs: env.WRITING_TIMEOUT_MS }
    );
    markdown = enforceSingleH1(edited.text, title);
    usage.promptTokens += edited.usage.promptTokens;
    usage.completionTokens += edited.usage.completionTokens;
    usageRecords.push({ model: editorModel, usage: edited.usage });
    models.push(editorModel);
  }

  log.info("Sectioned draft assembled", {
    sections: drafts.length,
    cached: drafts.filter((draft) => draft.fromCache).length,
    models,
    editorPass: env.EDITOR_PASS_ENABLED,
  });

  return {
    title,
    slug: slugify(title),
    excerpt: (context.outline?.metaDescription || `Technical guide to ${topic}`).slice(0, 200),
    metaTitle: (context.outline?.metaTitle || title).slice(0, 60),
    metaDescription: (context.outline?.metaDescription || `Technical guide to ${topic}`).slice(0, 160),
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
  // the exact pre-Task-5 single-call behavior.
  if (env.SECTIONED_WRITING_ENABLED) return generateSectionedDraft(topic, description, context);
  return generateWithVertex(topic, description, context);
}
