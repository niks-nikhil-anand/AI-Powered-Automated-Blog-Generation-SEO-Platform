import { env, isVertexConfigured } from "./env";

export type ModelProvider = "google" | "openai" | "anthropic" | "flux";
export type ModelCapability = "text" | "json" | "vision" | "image";
export type ModelSource = "primary" | "backup" | "env" | "default";

export type ModelRegistryEntry = {
  id: string;
  label: string;
  provider: ModelProvider;
  capabilities: ModelCapability[];
  requiresEnv?: keyof typeof env | "GOOGLE_VERTEX";
};

export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google", capabilities: ["text", "json", "vision"], requiresEnv: "GOOGLE_VERTEX" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", capabilities: ["text", "json", "vision"], requiresEnv: "GOOGLE_VERTEX" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", provider: "google", capabilities: ["text", "json"], requiresEnv: "GOOGLE_VERTEX" },
  { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", provider: "google", capabilities: ["image"], requiresEnv: "GOOGLE_VERTEX" },

  { id: "gpt-5", label: "GPT-5", provider: "openai", capabilities: ["text", "json", "vision"], requiresEnv: "OPENAI_API_KEY" },
  { id: "gpt-5-mini", label: "GPT-5 mini", provider: "openai", capabilities: ["text", "json"], requiresEnv: "OPENAI_API_KEY" },
  { id: "gpt-5-nano", label: "GPT-5 nano", provider: "openai", capabilities: ["text", "json"], requiresEnv: "OPENAI_API_KEY" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", capabilities: ["text", "json", "vision"], requiresEnv: "OPENAI_API_KEY" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai", capabilities: ["text", "json", "vision"], requiresEnv: "OPENAI_API_KEY" },

  { id: "claude-opus-4.1", label: "Claude Opus 4.1", provider: "anthropic", capabilities: ["text", "json", "vision"], requiresEnv: "ANTHROPIC_API_KEY" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", provider: "anthropic", capabilities: ["text", "json", "vision"], requiresEnv: "ANTHROPIC_API_KEY" },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5", provider: "anthropic", capabilities: ["text", "json"], requiresEnv: "ANTHROPIC_API_KEY" },
  { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", provider: "anthropic", capabilities: ["text", "json", "vision"], requiresEnv: "ANTHROPIC_API_KEY" },
  { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", provider: "anthropic", capabilities: ["text", "json"], requiresEnv: "ANTHROPIC_API_KEY" },

  { id: "flux-pro-1.1", label: "FLUX Pro 1.1", provider: "flux", capabilities: ["image"], requiresEnv: "FLUX_API_KEY" },
  { id: "flux-dev", label: "FLUX Dev", provider: "flux", capabilities: ["image"], requiresEnv: "FLUX_API_KEY" },
  { id: "flux-schnell", label: "FLUX Schnell", provider: "flux", capabilities: ["image"], requiresEnv: "FLUX_API_KEY" },
];

export const STAGE_MODEL_KEYS = {
  planning: { primary: "model:planning:primary", backup: "model:planning:backup", legacy: "model:planning", envFallback: "VERTEX_FLASH", capabilities: ["json"] },
  outline: { primary: "model:outline:primary", backup: "model:outline:backup", legacy: "model:outline", envFallback: "VERTEX_FLASH", capabilities: ["json"] },
  writing: { primary: "model:writing:primary", backup: "model:writing:backup", legacy: "model:writing", envFallback: "VERTEX_MODEL", capabilities: ["text"] },
  writingSections: { primary: "model:writingSections:primary", backup: "model:writingSections:backup", legacy: "model:writingSections", envFallback: "VERTEX_FLASH", capabilities: ["text"] },
  writingSelfcheck: { primary: "model:writingSelfcheck:primary", backup: "model:writingSelfcheck:backup", legacy: "model:writingSelfcheck", envFallback: "VERTEX_FLASH", capabilities: ["json"] },
  judge: { primary: "model:judge:primary", backup: "model:judge:backup", legacy: "model:judge", envFallback: "VERTEX_FLASH", capabilities: ["json"] },
  image: { primary: "model:image:primary", backup: "model:image:backup", legacy: "model:image", envFallback: "VERTEX_IMAGE_MODEL", capabilities: ["image"] },
} as const satisfies Record<string, {
  primary: string;
  backup: string;
  legacy: string;
  envFallback: "VERTEX_FLASH" | "VERTEX_MODEL" | "VERTEX_IMAGE_MODEL";
  capabilities: ModelCapability[];
}>;

export type ModelStage = keyof typeof STAGE_MODEL_KEYS;

export function modelById(modelId: string): ModelRegistryEntry | null {
  return MODEL_REGISTRY.find((entry) => entry.id === modelId) ?? null;
}

export function envModelValue(name: (typeof STAGE_MODEL_KEYS)[ModelStage]["envFallback"]): string {
  if (name === "VERTEX_MODEL") return env.VERTEX_MODEL;
  if (name === "VERTEX_IMAGE_MODEL") return env.VERTEX_IMAGE_MODEL;
  return env.VERTEX_FLASH;
}

export function providerAvailable(provider: ModelProvider): boolean {
  if (provider === "google") return isVertexConfigured;
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY);
  if (provider === "anthropic") return Boolean(env.ANTHROPIC_API_KEY);
  if (provider === "flux") return Boolean(env.FLUX_API_KEY);
  return false;
}

export function modelAvailable(entry: ModelRegistryEntry): boolean {
  return providerAvailable(entry.provider);
}

export function supportsCapabilities(entry: ModelRegistryEntry, capabilities: readonly ModelCapability[]): boolean {
  return capabilities.every((capability) => entry.capabilities.includes(capability));
}

export function modelsForStage(stage: ModelStage): ModelRegistryEntry[] {
  const required = STAGE_MODEL_KEYS[stage].capabilities;
  return MODEL_REGISTRY.filter((entry) => supportsCapabilities(entry, required));
}

export function modelStatus(modelId: string) {
  const entry = modelById(modelId);
  if (!entry) return { ok: false, reason: "unknown_model" };
  if (!modelAvailable(entry)) return { ok: false, reason: `${entry.provider}_credentials_missing` };
  return { ok: true, reason: "ready" };
}
