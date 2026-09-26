import { env } from "./env";
import {
  generateVertexImage,
  generateVertexJson,
  generateVertexText,
  type VertexImageOptions,
  type VertexImageResult,
  type VertexJsonOptions,
  type VertexJsonResult,
  type VertexTextResult,
} from "./vertex";
import { extractJson } from "./vertex";
import { resolveModelCandidates, type ResolvedModelCandidate } from "./model-resolver";
import type { ModelStage } from "./model-registry";

type Usage = { promptTokens: number; completionTokens: number };
type TextOptions = Omit<VertexJsonOptions, "schema">;
type Routed<T> = T & { model: string; provider: string; modelSource: string; fallbackReasons: string[] };

class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

function unknownUsage(): Usage {
  return { promptTokens: 0, completionTokens: 0 };
}

function openAiHeaders() {
  if (!env.OPENAI_API_KEY) throw new ProviderUnavailableError("OPENAI_API_KEY is missing");
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function openAiText(model: string, prompt: string, options: TextOptions = {}): Promise<VertexTextResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: openAiHeaders(),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned no text");
  return {
    text,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

async function anthropicText(model: string, prompt: string, options: TextOptions = {}): Promise<VertexTextResult> {
  if (!env.ANTHROPIC_API_KEY) throw new ProviderUnavailableError("ANTHROPIC_API_KEY is missing");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxOutputTokens ?? 4096,
      temperature: options.temperature,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic request failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.map((block) => block.text ?? "").join("").trim();
  if (!text) throw new Error("Anthropic returned no text");
  return {
    text,
    usage: {
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

async function callText(candidate: ResolvedModelCandidate, prompt: string, options: TextOptions): Promise<VertexTextResult> {
  if (!candidate.available) throw new ProviderUnavailableError(candidate.reason);
  if (candidate.provider === "google") return generateVertexText(candidate.model, prompt, options);
  if (candidate.provider === "openai") return openAiText(candidate.model, prompt, options);
  if (candidate.provider === "anthropic") return anthropicText(candidate.model, prompt, options);
  throw new ProviderUnavailableError(`${candidate.provider} does not support text generation here`);
}

async function callImage(candidate: ResolvedModelCandidate, prompt: string, options: VertexImageOptions): Promise<VertexImageResult> {
  if (!candidate.available) throw new ProviderUnavailableError(candidate.reason);
  if (candidate.provider === "google") return generateVertexImage(candidate.model, prompt, options);
  throw new ProviderUnavailableError(`${candidate.provider} image generation is not implemented in this worker yet`);
}

async function withFallback<T>(
  stage: ModelStage,
  work: (candidate: ResolvedModelCandidate) => Promise<T>
): Promise<{ value: T; candidate: ResolvedModelCandidate; fallbackReasons: string[] }> {
  const candidates = await resolveModelCandidates(stage);
  const fallbackReasons: string[] = [];
  for (const item of candidates) {
    try {
      const value = await work(item);
      return { value, candidate: item, fallbackReasons };
    } catch (error) {
      fallbackReasons.push(`${item.source}:${item.model}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No usable model for ${stage}. ${fallbackReasons.join(" | ")}`);
}

export async function generateStageText(
  stage: ModelStage,
  prompt: string,
  options: TextOptions = {}
): Promise<Routed<VertexTextResult>> {
  const routed = await withFallback(stage, (candidate) => callText(candidate, prompt, options));
  return {
    ...routed.value,
    model: routed.candidate.model,
    provider: routed.candidate.provider,
    modelSource: routed.candidate.source,
    fallbackReasons: routed.fallbackReasons,
  };
}

export async function generateStageJson<T>(
  stage: ModelStage,
  prompt: string,
  options: VertexJsonOptions = {}
): Promise<Routed<VertexJsonResult<T>>> {
  const routed = await withFallback(stage, async (candidate) => {
    if (!candidate.available) throw new ProviderUnavailableError(candidate.reason);
    if (candidate.provider === "google") return generateVertexJson<T>(candidate.model, prompt, options);
    const text = await callText(candidate, `${prompt}\n\nReturn valid JSON only.`, options);
    return { data: extractJson<T>(text.text), usage: text.usage };
  });
  return {
    ...routed.value,
    model: routed.candidate.model,
    provider: routed.candidate.provider,
    modelSource: routed.candidate.source,
    fallbackReasons: routed.fallbackReasons,
  };
}

export async function generateStageImage(
  stage: ModelStage,
  prompt: string,
  options: VertexImageOptions = {}
): Promise<Routed<VertexImageResult & { usage: Usage }>> {
  const routed = await withFallback(stage, async (candidate) => {
    const image = await callImage(candidate, prompt, options);
    return { ...image, usage: unknownUsage() };
  });
  return {
    ...routed.value,
    model: routed.candidate.model,
    provider: routed.candidate.provider,
    modelSource: routed.candidate.source,
    fallbackReasons: routed.fallbackReasons,
  };
}
