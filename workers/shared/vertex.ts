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

export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate.trim()) as T;
}

export type VertexJsonOptions = {
  schema?: SchemaUnion;
  maxOutputTokens?: number;
  temperature?: number;
};

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

  const result = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config,
  });

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
  const result = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      temperature: options.temperature ?? 0.45,
      ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    },
  });

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
