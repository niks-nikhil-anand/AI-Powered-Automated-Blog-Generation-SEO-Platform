import { env, isVertexConfigured } from "../shared/env";
import { logger } from "../shared/logger";
import { generateVertexText, slugify } from "../shared/vertex";

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
2. Follow the approved outline when provided.
3. Include at least one Markdown comparison table or code snippet where relevant.
4. Use proper GitHub Flavored Markdown (H2/H3 headings, lists, bold).
5. End with a short FAQ section and a one-paragraph conclusion.
6. Do not invent unsupported facts. Use cautious wording when evidence is incomplete.

Respond with ONLY the article body as Markdown. Do not return JSON. Do not wrap the whole article in a code fence.`;
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
  };
}

async function generateWithVertex(topic: string, description: string, context: WritingContext = {}): Promise<BlogDraft> {
  const prompt = buildPrompt(topic, description, context);
  const result = await generateVertexText(env.VERTEX_MODEL, prompt, {
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
    markdown: result.text,
    usage: result.usage,
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
