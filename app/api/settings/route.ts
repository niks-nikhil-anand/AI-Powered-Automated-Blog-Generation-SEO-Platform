import { NextResponse } from "next/server";
import { env } from "@/workers/shared/env";
import {
  DAILY_TARGET_KEY,
  MODEL_BACKUP_SETTING_KEYS,
  MODEL_PRIMARY_SETTING_KEYS,
  MODEL_SETTING_KEYS,
  RETRY_ATTEMPTS_KEY,
  deleteSetting,
  getAllSettings,
  setSetting,
} from "@/workers/shared/settings";
import {
  MODEL_REGISTRY,
  STAGE_MODEL_KEYS,
  envModelValue,
  modelById,
  modelStatus,
  modelsForStage,
  supportsCapabilities,
  type ModelStage,
} from "@/workers/shared/model-registry";
import { reconcilePublishSlots } from "@/workers/shared/publish-slots";
import { getRetryAttempts, refreshRetryAttempts } from "@/workers/shared/retry-config";

export const dynamic = "force-dynamic";

const MODEL_STAGES = Object.keys(STAGE_MODEL_KEYS) as ModelStage[];
const MODEL_DEFAULTS = Object.fromEntries(
  MODEL_STAGES.map((stage) => [stage, envModelValue(STAGE_MODEL_KEYS[stage].envFallback)])
) as Record<ModelStage, string>;

function visibleModel(modelId: string) {
  const entry = modelById(modelId);
  return entry
    ? { ...entry, status: modelStatus(modelId) }
    : { id: modelId, label: modelId, provider: "google" as const, capabilities: [], status: { ok: false, reason: "unknown_model" } };
}

function validateStageModel(stage: ModelStage, value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false as const, error: "Model name must be a non-empty string." };
  }
  const model = value.trim();
  const entry = modelById(model);
  if (!entry) return { ok: false as const, error: `"${model}" is not in the model registry.` };
  if (!supportsCapabilities(entry, STAGE_MODEL_KEYS[stage].capabilities)) {
    return { ok: false as const, error: `"${model}" cannot be used for ${stage}; it does not support the required capability.` };
  }
  return { ok: true as const, model };
}

export async function GET() {
  try {
    const stored = await getAllSettings([
      ...MODEL_STAGES.flatMap((stage) => [
        MODEL_PRIMARY_SETTING_KEYS[stage],
        MODEL_BACKUP_SETTING_KEYS[stage],
        MODEL_SETTING_KEYS[stage],
      ]),
      DAILY_TARGET_KEY,
      RETRY_ATTEMPTS_KEY,
    ]);

    const models: Record<string, string> = {};
    const modelOverridden: Record<string, boolean> = {};
    const stageModels: Record<string, {
      primary: string | null;
      backup: string | null;
      envDefault: string;
      effective: string;
      primaryKey: string;
      backupKey: string;
      primaryOverridden: boolean;
      backupOverridden: boolean;
    }> = {};
    const modelOptionsByStage: Record<string, ReturnType<typeof visibleModel>[]> = {};
    for (const stage of MODEL_STAGES) {
      const legacy = stored.get(MODEL_SETTING_KEYS[stage]);
      const primaryValue = stored.get(MODEL_PRIMARY_SETTING_KEYS[stage]) ?? legacy;
      const backupValue = stored.get(MODEL_BACKUP_SETTING_KEYS[stage]);
      const primary = typeof primaryValue === "string" && primaryValue.trim() ? primaryValue : null;
      const backup = typeof backupValue === "string" && backupValue.trim() ? backupValue : null;
      const envDefault = MODEL_DEFAULTS[stage];
      models[stage] = primary ?? envDefault;
      modelOverridden[stage] = primary !== null;
      stageModels[stage] = {
        primary,
        backup,
        envDefault,
        effective: primary ?? backup ?? envDefault,
        primaryKey: MODEL_PRIMARY_SETTING_KEYS[stage],
        backupKey: MODEL_BACKUP_SETTING_KEYS[stage],
        primaryOverridden: primary !== null,
        backupOverridden: backup !== null,
      };
      const optionIds = new Set([
        ...modelsForStage(stage).map((entry) => entry.id),
        envDefault,
        ...(primary ? [primary] : []),
        ...(backup ? [backup] : []),
      ]);
      modelOptionsByStage[stage] = Array.from(optionIds).map(visibleModel);
    }

    const storedTarget = stored.get(DAILY_TARGET_KEY);
    const dailyBlogTarget =
      typeof storedTarget === "number" && Number.isFinite(storedTarget)
        ? storedTarget
        : Number(env.DAILY_BLOG_TARGET);

    return NextResponse.json({
      models,
      modelDefaults: MODEL_DEFAULTS,
      modelOverridden,
      stageModels,
      modelOptions: MODEL_REGISTRY.map((entry) => entry.id),
      modelRegistry: MODEL_REGISTRY.map((entry) => ({ ...entry, status: modelStatus(entry.id) })),
      modelOptionsByStage,
      dailyBlogTarget,
      dailyBlogTargetDefault: Number(env.DAILY_BLOG_TARGET),
      dailyBlogTargetOverridden: storedTarget !== undefined,
      // Retries after the initial attempt per pipeline stage (drives BullMQ
      // attempts + the QA regeneration budget via workers/shared/retry-config.ts).
      retryAttempts: await getRetryAttempts(),
      retryAttemptsDefault: Number(env.PIPELINE_RETRY_ATTEMPTS),
      retryAttemptsOverridden: stored.get(RETRY_ATTEMPTS_KEY) !== undefined,
      // Env-flag snapshot so the page's "no model call" notes can be truthful
      // about which stages actually call an LLM right now (they were stale
      // hardcoded strings before - e.g. claiming Image "draws an SVG locally"
      // while IMAGE_AI_GENERATION_ENABLED defaults true).
      flags: {
        imageAiEnabled: env.IMAGE_AI_GENERATION_ENABLED,
        judgeEnabled: env.JUDGE_ENABLED,
        sectionedWritingEnabled: env.SECTIONED_WRITING_ENABLED,
        selfcheckEnabled: env.WRITING_SELFCHECK_ENABLED,
      },
    });
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { key, value } = body as { key?: string; value?: unknown };

    if (key === DAILY_TARGET_KEY) {
      // Goal change = slot-count change: reconcilePublishSlots resizes the
      // publish schedule to exactly N slots (existing times on slots 1..N
      // are kept, schedulers beyond N are removed; brand-new slots start
      // unset so the UI asks for their publish times).
      // value === null resets to the env default (removes the override row).
      if (value === null) {
        await deleteSetting(DAILY_TARGET_KEY);
        const slotCount = await reconcilePublishSlots();
        return NextResponse.json({
          ok: true,
          key,
          value: Number(env.DAILY_BLOG_TARGET),
          overridden: false,
          publishSlots: slotCount,
        });
      }
      const num = Number(value);
      if (!Number.isFinite(num) || num < 1 || num > 20) {
        return NextResponse.json(
          { ok: false, error: "dailyBlogTarget must be a number between 1 and 20." },
          { status: 422 }
        );
      }
      await setSetting(DAILY_TARGET_KEY, Math.round(num));
      const slotCount = await reconcilePublishSlots();
      return NextResponse.json({
        ok: true,
        key,
        value: Math.round(num),
        overridden: true,
        publishSlots: slotCount,
      });
    }

    if (key === RETRY_ATTEMPTS_KEY) {
      // value === null resets to the env default (PIPELINE_RETRY_ATTEMPTS).
      // refreshRetryAttempts() keeps this process's queue-getter cache in
      // step immediately; worker processes refresh per job via
      // startWorkerAttempt (15s settings cache).
      if (value === null) {
        await deleteSetting(RETRY_ATTEMPTS_KEY);
        await refreshRetryAttempts();
        return NextResponse.json({
          ok: true,
          key,
          value: Number(env.PIPELINE_RETRY_ATTEMPTS),
          overridden: false,
        });
      }
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0 || num > 10) {
        return NextResponse.json(
          { ok: false, error: "retryAttempts must be an integer between 0 and 10." },
          { status: 422 }
        );
      }
      await setSetting(RETRY_ATTEMPTS_KEY, num);
      await refreshRetryAttempts();
      return NextResponse.json({ ok: true, key, value: num, overridden: true });
    }

    const stage = MODEL_STAGES.find((s) =>
      MODEL_SETTING_KEYS[s] === key ||
      MODEL_PRIMARY_SETTING_KEYS[s] === key ||
      MODEL_BACKUP_SETTING_KEYS[s] === key
    );
    if (stage) {
      const targetKey = key === MODEL_BACKUP_SETTING_KEYS[stage]
        ? MODEL_BACKUP_SETTING_KEYS[stage]
        : key === MODEL_SETTING_KEYS[stage]
          ? MODEL_SETTING_KEYS[stage]
          : MODEL_PRIMARY_SETTING_KEYS[stage];
      if (value === null) {
        await deleteSetting(targetKey);
        return NextResponse.json({
          ok: true,
          key: targetKey,
          value: targetKey === MODEL_BACKUP_SETTING_KEYS[stage] ? null : MODEL_DEFAULTS[stage],
          overridden: false,
        });
      }
      const validated = validateStageModel(stage, value);
      if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 422 });
      await setSetting(targetKey, validated.model);
      return NextResponse.json({ ok: true, key: targetKey, value: validated.model, overridden: true });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown setting key "${key}".` },
      { status: 422 }
    );
  } catch (error) {
    console.error("Failed to update settings:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
