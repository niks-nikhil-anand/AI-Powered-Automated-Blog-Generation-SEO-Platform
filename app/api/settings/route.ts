import { NextResponse } from "next/server";
import { env } from "@/workers/shared/env";
import { DAILY_TARGET_KEY, MODEL_SETTING_KEYS, getSetting, setSetting } from "@/workers/shared/settings";

export const dynamic = "force-dynamic";

/**
 * Only planning/outline/writing actually call an LLM (see the comment in
 * workers/shared/settings.ts) - research/image/quality/publish have no
 * model to override, so there's nothing to expose or accept for them here.
 */
const MODEL_DEFAULTS: Record<keyof typeof MODEL_SETTING_KEYS, string> = {
  planning: env.VERTEX_FLASH,
  outline: env.VERTEX_FLASH,
  writing: env.VERTEX_MODEL,
};

const MODEL_STAGES = Object.keys(MODEL_SETTING_KEYS) as (keyof typeof MODEL_SETTING_KEYS)[];

export async function GET() {
  const models: Record<string, string> = {};
  for (const stage of MODEL_STAGES) {
    models[stage] = await getSetting(MODEL_SETTING_KEYS[stage], MODEL_DEFAULTS[stage]);
  }
  const dailyBlogTarget = await getSetting(DAILY_TARGET_KEY, Number(env.DAILY_BLOG_TARGET));

  return NextResponse.json({ models, dailyBlogTarget });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { key, value } = body as { key?: string; value?: unknown };

  if (key === "dailyBlogTarget") {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 1 || num > 20) {
      return NextResponse.json(
        { ok: false, error: "dailyBlogTarget must be a number between 1 and 20." },
        { status: 422 }
      );
    }
    await setSetting(DAILY_TARGET_KEY, Math.round(num));
    return NextResponse.json({ ok: true, key, value: Math.round(num) });
  }

  const stage = MODEL_STAGES.find((s) => MODEL_SETTING_KEYS[s] === key);
  if (stage) {
    if (typeof value !== "string" || !value.trim()) {
      return NextResponse.json({ ok: false, error: "Model name must be a non-empty string." }, { status: 422 });
    }
    await setSetting(MODEL_SETTING_KEYS[stage], value.trim());
    return NextResponse.json({ ok: true, key, value: value.trim() });
  }

  return NextResponse.json(
    { ok: false, error: `Unknown setting key "${key}".` },
    { status: 422 }
  );
}
