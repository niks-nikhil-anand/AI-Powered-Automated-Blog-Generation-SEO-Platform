import { env, isVertexConfigured } from "../shared/env";
import { logger } from "../shared/logger";
import { generateVertexText, slugify } from "../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../shared/settings";

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
};

function buildPrompt(topic: string, description: string, context: WritingContext = {}): string {
  return `You are a Staff Technical Writer for DevKit Market, a developer-focused tech blog.

Write a ${env.BLOG_MIN_WORDS}-${env.BLOG_MAX_WORDS} word technical blog post in GitHub Flavored Markdown.

Topic: "${topic}"
Context: ${description || "No additional context provided."}
Content plan:
${context.plan ? JSON.stringify(context.plan, null, 2) : "No separate content plan provided."}

Approved outline:
${context.outline ? JSON.stringify(context.outline, null, 2) : "No separate outline provided."}

Guidelines:
1. Tone: technical, practical, zero fluff.
2. Use the approved outline as factual/source context, but reshape the final article into the mandatory structure below.
3. Include a short Table of Contents when the article is longer than 1,200 words.
4. Include at least one Markdown comparison table in Pros and Cons.
5. Use proper GitHub Flavored Markdown.
6. Do not invent unsupported facts. Use cautious wording when evidence is incomplete.
7. The Call To Action should be short, practical, and related to DevKit Market.

Mandatory Markdown structure:
# [SEO-friendly title]

[Introduction: 2-4 paragraphs that explain the topic, reader problem, and practical value.]

## Table of Contents
[Optional. Include only when useful. Use anchor-style Markdown links.]

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

export async function generateBlogDraft(
  topic: string,
  description: string,
  context: WritingContext = {}
): Promise<BlogDraft> {
  return isVertexConfigured
    ? generateWithVertex(topic, description, context)
    : generateMock(topic, description, context);
}
