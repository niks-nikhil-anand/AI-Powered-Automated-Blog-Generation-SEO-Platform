import { env } from "./env";

/**
 * Canonical metadata for the three research-worker schedule slots. This used
 * to be duplicated across workers/research-worker/index.ts (boot
 * registration), app/api/pipeline/run-context/route.ts (read), and
 * app/api/pipeline/schedules/[id]/route.ts (edit) - three copies of the same
 * id->label map that could silently drift. This module is a plain constants
 * file (no BullMQ Worker construction), so API routes can import it without
 * becoming a second consumer of the queue.
 */
export const RESEARCH_SLOTS = [
  { id: "research-overnight", label: "Overnight sweep" },
  { id: "research-midday", label: "Midday" },
  { id: "research-us-daytime", label: "US daytime" },
] as const;

export type ResearchSlotId = (typeof RESEARCH_SLOTS)[number]["id"];

export const RESEARCH_SLOT_IDS: string[] = RESEARCH_SLOTS.map((slot) => slot.id);

export const RESEARCH_SLOT_LABELS: Record<string, string> = Object.fromEntries(
  RESEARCH_SLOTS.map((slot) => [slot.id, slot.label])
);

/** BullMQ scheduler id for the Daily Target Controller's 30-min safety-net tick. */
export const RECONCILE_SLOT_ID = "daily-target-reconcile";

export function isResearchSlotId(id: string): id is ResearchSlotId {
  return RESEARCH_SLOT_IDS.includes(id);
}

/**
 * AppSetting key holding a dashboard-edited cron override for one slot
 * (e.g. "schedule:research-midday" -> "0 14 * * *"). Written by
 * PATCH /api/pipeline/schedules/[id], read by registerSchedules() at worker
 * boot so an edit survives restarts; the slot's env var stays the fallback.
 */
export function scheduleSettingKey(id: string): string {
  return `schedule:${id}`;
}

/** The env-var default pattern for a slot - the value a "Reset" restores. */
export function envPatternForSlot(id: ResearchSlotId): string {
  switch (id) {
    case "research-overnight":
      return env.RESEARCH_CRON_OVERNIGHT;
    case "research-midday":
      return env.RESEARCH_CRON_MIDDAY;
    case "research-us-daytime":
      return env.RESEARCH_CRON_US_DAYTIME;
  }
}

/**
 * Loose 5-field cron sanity check. Guards against a corrupt AppSetting row
 * crashing BullMQ's cron parser at boot - anything that isn't five plain
 * cron fields falls back to the env default instead of bricking registration.
 */
export function isValidCronPattern(pattern: unknown): pattern is string {
  if (typeof pattern !== "string") return false;
  const parts = pattern.trim().split(/\s+/);
  return parts.length === 5 && parts.every((part) => /^[\d*/,-]+$/.test(part));
}
