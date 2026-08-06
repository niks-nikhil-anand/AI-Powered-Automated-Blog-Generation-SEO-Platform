import { GoogleGenAI, type GenerateContentConfig, type SchemaUnion } from "@google/genai";
import { env, isVertexConfigured } from "./env";

export type VertexJsonResult<T> = {
  data: T;
  usage: { promptTokens: number; completionTokens: number };
};

export type VertexTextResult = {
  text: string;
  usage: { promptTokens: number; completionTokens: number };
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function extractJson<T>(text: string, fallback?: T): T {
  try {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fenced ? fenced[1] : trimmed;
    return JSON.parse(candidate.trim()) as T;
  } catch (error) {
    if (fallback !== undefined) {
      console.warn(`Failed to parse JSON from Vertex response, using fallback: ${error}`);
      return fallback;
    }
    throw new Error(`Failed to parse JSON from Vertex response: ${error}`);
  }
}

export type VertexJsonOptions = {
  schema?: SchemaUnion;
  maxOutputTokens?: number;
  temperature?: number;
  /** Overrides withVertexTimeout's 30s default - e.g. research-worker's semantic pass uses a longer one for large batches. */
  timeoutMs?: number;
};

/**
 * Wrap a Vertex API call with a 30-second timeout to prevent indefinite hangs.
 * If API stalls, worker will fail fast and be retried instead of blocking forever.
 */
function withVertexTimeout<T>(promise: Promise<T>, timeoutMs: number = 30000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Vertex API timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

export async function generateVertexJson<T>(
  modelName: string,
  prompt: string,
  options: VertexJsonOptions = {}
): Promise<VertexJsonResult<T>> {
  if (!isVertexConfigured) {
    throw new Error("Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT and VERTEX_LOCATION.");
  }

  const ai = new GoogleGenAI({
    vertexai: true,
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.VERTEX_LOCATION,
  });
  const config: GenerateContentConfig = {
    responseMimeType: "application/json",
    temperature: options.temperature ?? 0.4,
    ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.schema ? { responseSchema: options.schema } : {}),
  };

  const result = await withVertexTimeout(
    ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config,
    }),
    options.timeoutMs
  );

  const text = result.text;
  if (!text) throw new Error("Gemini returned no text in response");

  return {
    data: extractJson<T>(text),
    usage: {
      promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

function vertexClient() {
  if (!isVertexConfigured) {
    throw new Error("Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT and VERTEX_LOCATION.");
  }
  return new GoogleGenAI({
    vertexai: true,
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.VERTEX_LOCATION,
  });
}

export type VertexImageResult = {
  buffer: Buffer;
  mimeType: string;
};

export type VertexImageOptions = {
  aspectRatio?: string;
  negativePrompt?: string;
  timeoutMs?: number;
};

/**
 * Uses Gemini's generateContent (responseModalities: ["IMAGE"]) rather than
 * the Imagen predict API - keeps hero-image generation on the same endpoint
 * as the rest of the Gemini calls in this file instead of the separately
 * Model-Garden-gated Imagen publisher models. Runs noticeably slower than a
 * text/JSON completion, so this gets its own default timeout instead of
 * reusing withVertexTimeout's 30s.
 */
export async function generateVertexImage(
  modelName: string,
  prompt: string,
  options: VertexImageOptions = {}
): Promise<VertexImageResult> {
  const ai = vertexClient();
  const fullPrompt = options.negativePrompt ? `${prompt}\n\nAvoid: ${options.negativePrompt}.` : prompt;

  const result = await withVertexTimeout(
    ai.models.generateContent({
      model: modelName,
      contents: fullPrompt,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: options.aspectRatio ?? "16:9",
          outputMimeType: "image/jpeg",
        },
      },
    }),
    options.timeoutMs ?? 90000
  );

  const parts = result.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    const blockReason = result.candidates?.[0]?.finishReason;
    throw new Error(blockReason ? `Vertex image blocked: ${blockReason}` : "Vertex returned no image bytes");
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, "base64"),
    mimeType: imagePart.inlineData.mimeType ?? "image/jpeg",
  };
}

export type VertexVisionOptions = {
  temperature?: number;
  maxOutputTokens?: number;
  schema?: SchemaUnion;
  timeoutMs?: number;
};

/**
 * Same shape as generateVertexJson but for a multimodal (image + text)
 * prompt - used by quality-worker's image-relevance check (see
 * IMPLEMENTATION_PLAN.md's hero-image-quality addendum, Phase C.4).
 */
export async function generateVertexVisionJson<T>(
  modelName: string,
  prompt: string,
  image: { data: string; mimeType: string },
  options: VertexVisionOptions = {}
): Promise<VertexJsonResult<T>> {
  const ai = vertexClient();
  const config: GenerateContentConfig = {
    responseMimeType: "application/json",
    temperature: options.temperature ?? 0.2,
    ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.schema ? { responseSchema: options.schema } : {}),
  };

  const result = await withVertexTimeout(
    ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, { inlineData: { data: image.data, mimeType: image.mimeType } }],
        },
      ],
      config,
    }),
    options.timeoutMs
  );

  const text = result.text;
  if (!text) throw new Error("Gemini returned no text in response");

  return {
    data: extractJson<T>(text),
    usage: {
      promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

export async function generateVertexText(
  modelName: string,
  prompt: string,
  options: Omit<VertexJsonOptions, "schema"> = {}
): Promise<VertexTextResult> {
  if (!isVertexConfigured) {
    throw new Error("Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT and VERTEX_LOCATION.");
  }

  const ai = new GoogleGenAI({
    vertexai: true,
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.VERTEX_LOCATION,
  });
  const result = await withVertexTimeout(
    ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        temperature: options.temperature ?? 0.45,
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
      },
    }),
    options.timeoutMs
  );

  const text = result.text;
  if (!text) throw new Error("Gemini returned no text in response");

  return {
    text: text.trim(),
    usage: {
      promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}
