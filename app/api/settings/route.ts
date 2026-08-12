import { NextResponse } from "next/server";
import { env } from "@/workers/shared/env";
import {
  DAILY_TARGET_KEY,
  MODEL_SETTING_KEYS,
  deleteSetting,
  getAllSettings,
  setSetting,
} from "@/workers/shared/settings";

export const dynamic = "force-dynamic";

/**
 * planning/outline/writing/semantic/judge/writingSections/writingSelfcheck
 * are the stages that actually call an LLM (see the comment in
 * workers/shared/settings.ts) - image/publish have no dashboard-editable
 * model, so there's nothing to expose or accept for them here. "semantic" is
 * research-worker's relevance/dedup pass, "judge" is quality-worker's
 * editorial pass (Task 4), "writingSections" is per-section drafting
 * (Task 5), "writingSelfcheck" the write-time claim check (Task 6).
 */
const MODEL_DEFAULTS: Record<keyof typeof MODEL_SETTING_KEYS, string> = {
  planning: env.VERTEX_FLASH,
  outline: env.VERTEX_FLASH,
  writing: env.VERTEX_MODEL,
  semantic: env.VERTEX_FLASH,
  judge: env.VERTEX_FLASH,
  writingSections: env.VERTEX_FLASH,
  writingSelfcheck: env.VERTEX_FLASH,
};

const MODEL_STAGES = Object.keys(MODEL_SETTING_KEYS) as (keyof typeof MODEL_SETTING_KEYS)[];

/**
 * Every text model this deployment plausibly runs - the three known 2.5
 * variants plus whatever VERTEX_MODEL/VERTEX_FLASH are configured to. The
 * settings page renders its dropdowns from this list (appending a saved
 * custom value if one exists) instead of a hardcoded client-side list that
 * could render blank when the effective value wasn't in it.
 */
const MODEL_OPTIONS = [
  ...new Set(["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", env.VERTEX_MODEL, env.VERTEX_FLASH]),
];

/**
 * Rejects obvious typos before they reach the queue - an invalid model name
 * used to save fine and then fail every job at Vertex call time. Loose
 * enough to allow dated/future Gemini ids, strict enough to catch "gpt-4o".
 */
const MODEL_NAME_PATTERN = /^gemini-[a-z0-9][\w.:-]*$/i;

export async function GET() {
  try {
    const stored = await getAllSettings([...MODEL_STAGES.map((stage) => MODEL_SETTING_KEYS[stage]), DAILY_TARGET_KEY]);

    const models: Record<string, string> = {};
    const modelOverridden: Record<string, boolean> = {};
    for (const stage of MODEL_STAGES) {
      const key = MODEL_SETTING_KEYS[stage];
      const value = stored.get(key);
      models[stage] = typeof value === "string" && value.trim() ? value : MODEL_DEFAULTS[stage];
      modelOverridden[stage] = value !== undefined;
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
      modelOptions: MODEL_OPTIONS,
      dailyBlogTarget,
      dailyBlogTargetDefault: Number(env.DAILY_BLOG_TARGET),
      dailyBlogTargetOverridden: storedTarget !== undefined,
      // Env-flag snapshot so the page's "no model call" notes can be truthful
      // about which stages actually call an LLM right now (they were stale
      // hardcoded strings before - e.g. claiming Image "draws an SVG locally"
      // while IMAGE_AI_GENERATION_ENABLED defaults true).
      flags: {
        semanticEnabled: env.RESEARCH_SEMANTIC_ENABLED,
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
      // value === null resets to the env default (removes the override row).
      if (value === null) {
        await deleteSetting(DAILY_TARGET_KEY);
        return NextResponse.json({ ok: true, key, value: Number(env.DAILY_BLOG_TARGET), overridden: false });
      }
      const num = Number(value);
      if (!Number.isFinite(num) || num < 1 || num > 20) {
        return NextResponse.json(
          { ok: false, error: "dailyBlogTarget must be a number between 1 and 20." },
          { status: 422 }
        );
      }
      await setSetting(DAILY_TARGET_KEY, Math.round(num));
      return NextResponse.json({ ok: true, key, value: Math.round(num), overridden: true });
    }

    const stage = MODEL_STAGES.find((s) => MODEL_SETTING_KEYS[s] === key);
    if (stage) {
      // value === null resets the stage to its env default.
      if (value === null) {
        await deleteSetting(MODEL_SETTING_KEYS[stage]);
        return NextResponse.json({ ok: true, key, value: MODEL_DEFAULTS[stage], overridden: false });
      }
      if (typeof value !== "string" || !value.trim()) {
        return NextResponse.json({ ok: false, error: "Model name must be a non-empty string." }, { status: 422 });
      }
      const model = value.trim();
      if (!MODEL_NAME_PATTERN.test(model)) {
        return NextResponse.json(
          { ok: false, error: `"${model}" doesn't look like a Gemini model id (e.g. gemini-2.5-flash).` },
          { status: 422 }
        );
      }
      await setSetting(MODEL_SETTING_KEYS[stage], model);
      return NextResponse.json({ ok: true, key, value: model, overridden: true });
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
