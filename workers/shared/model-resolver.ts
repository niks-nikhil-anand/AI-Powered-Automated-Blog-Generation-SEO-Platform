import { getSetting } from "./settings";
import {
  STAGE_MODEL_KEYS,
  envModelValue,
  modelAvailable,
  modelById,
  modelStatus,
  supportsCapabilities,
  type ModelCapability,
  type ModelProvider,
  type ModelSource,
  type ModelStage,
} from "./model-registry";

export type ResolvedModelCandidate = {
  model: string;
  provider: ModelProvider;
  source: ModelSource;
  available: boolean;
  reason: string;
};

function candidate(model: string, source: ModelSource, capabilities: readonly ModelCapability[]): ResolvedModelCandidate | null {
  const entry = modelById(model);
  if (!entry) return { model, provider: model.startsWith("claude") ? "anthropic" : model.startsWith("gpt") ? "openai" : "google", source, available: false, reason: "unknown_model" };
  if (!supportsCapabilities(entry, capabilities)) return { model, provider: entry.provider, source, available: false, reason: "unsupported_capability" };
  const status = modelStatus(model);
  return { model, provider: entry.provider, source, available: status.ok && modelAvailable(entry), reason: status.reason };
}

export async function resolveModelCandidates(stage: ModelStage): Promise<ResolvedModelCandidate[]> {
  const config = STAGE_MODEL_KEYS[stage];
  const primary = await getSetting<string | null>(config.primary, null);
  const legacy = await getSetting<string | null>(config.legacy, null);
  const backup = await getSetting<string | null>(config.backup, null);
  const envFallback = envModelValue(config.envFallback);
  const seen = new Set<string>();
  const candidates = [
    primary || legacy ? candidate(primary || legacy!, "primary", config.capabilities) : null,
    backup ? candidate(backup, "backup", config.capabilities) : null,
    candidate(envFallback, "env", config.capabilities),
  ].filter((item): item is ResolvedModelCandidate => Boolean(item));

  return candidates.filter((item) => {
    const key = `${item.source}:${item.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function resolveEffectiveModel(stage: ModelStage): Promise<ResolvedModelCandidate> {
  const candidates = await resolveModelCandidates(stage);
  return candidates.find((item) => item.available) ?? candidates[0];
}
