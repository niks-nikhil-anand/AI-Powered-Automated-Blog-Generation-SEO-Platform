import { env } from "./env";
import { redis } from "./redis";
import { researchQueue } from "./queues";
import { DAILY_TARGET_KEY, deleteSetting, getAllSettings, getSetting, setSetting } from "./settings";

/**
 * Dynamic publish slots - one per Daily Blog Goal (docs: settings page).
 *
 * The goal N means "publish N blogs per day, each at its own configured
 * target publish time". Slot n's canonical value is its PUBLISH time, stored
 * in AppSetting as `schedule:blog-slot-<n>` = "M H * * *" (a plain daily
 * cron of the wall-clock publish time in env.TIMEZONE). The BullMQ job
 * scheduler registered in Redis fires GENERATION earlier than that by
 * env.SLOT_GENERATION_LEAD_MINUTES (default 30) - the quality-worker then
 * holds the finished blog (BullMQ `delay`) until the target publish time,
 * or publishes immediately if retries already ran past it.
 *
 * Redis is the live scheduling truth; AppSetting is the boot-time persistence
 * layer (same pattern as the rest of the settings system). Slot count always
 * tracks the goal: reconcilePublishSlots() is called at worker boot and on
 * every goal change, adding/removing schedulers to match.
 */

export const BLOG_SLOT_PREFIX = "blog-slot-";
/** Matches the Daily Blog Goal slider max in Settings. */
export const MAX_BLOG_SLOTS = 20;

/** BullMQ scheduler id for the Daily Target Controller's safety-net tick. */
export const RECONCILE_SLOT_ID = "daily-target-reconcile";

export function blogSlotId(n: number): string {
  return `${BLOG_SLOT_PREFIX}${n}`;
}

export function isBlogSlotId(id: string): boolean {
  const match = /^blog-slot-(\d{1,2})$/.exec(id);
  if (!match) return false;
  const n = Number(match[1]);
  return n >= 1 && n <= MAX_BLOG_SLOTS;
}

export function slotNumberFromId(id: string): number {
  return Number(id.slice(BLOG_SLOT_PREFIX.length));
}

/** AppSetting key holding a slot's publish-time cron ("M H * * *"). */
export function slotSettingKey(n: number): string {
  return `schedule:blog-slot-${n}`;
}

/** Parses the stored publish cron into an hour/minute pair; null for anything else. */
export function parseSlotTime(value: unknown): { hour: number; minute: number } | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  return { hour, minute };
}

export function formatHHMM(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Timezone-safe wall-clock math (no date library in this repo - Intl only).
// ---------------------------------------------------------------------------

function tzDateParts(tz: string, atMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(atMs));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
  };
}

/** UTC timestamp for a wall-clock time in `tz` (two offset-refinement passes for DST edges). */
function zonedWallTimeToUtc(tz: string, year: number, month: number, day: number, hour: number, minute: number): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i += 1) {
    const parts = tzDateParts(tz, guess);
    const offsetMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - guess;
    guess = Date.UTC(year, month - 1, day, hour, minute) - offsetMs;
  }
  return guess;
}

/** Next timestamp strictly after `fromMs` at which wall-clock `hour:minute` occurs in `tz`. */
export function nextOccurrenceOf(hour: number, minute: number, tz: string, fromMs: number): number {
  const today = tzDateParts(tz, fromMs);
  let ts = zonedWallTimeToUtc(tz, today.year, today.month, today.day, hour, minute);
  if (ts <= fromMs) {
    const tomorrow = tzDateParts(tz, fromMs + 24 * 60 * 60 * 1000);
    ts = zonedWallTimeToUtc(tz, tomorrow.year, tomorrow.month, tomorrow.day, hour, minute);
  }
  return ts;
}

/**
 * The wall-clock time generation must start so a blog can plausibly finish
 * (including a retry or two) before its publish time. Wraps past midnight
 * (23:45 fire for a 00:15 publish) - runScheduledSlot computes the target
 * as the NEXT occurrence of the publish time after firing, so wrap-around
 * still lands on the intended publish moment.
 */
export function fireClockTime(publishHour: number, publishMinute: number, leadMinutes: number) {
  const total = (((publishHour * 60 + publishMinute - leadMinutes) % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

function clampTarget(value: number): number {
  return Math.min(MAX_BLOG_SLOTS, Math.max(1, Math.round(value)));
}

async function readDailyTarget(): Promise<number> {
  const raw = await getSetting(DAILY_TARGET_KEY, Number(env.DAILY_BLOG_TARGET));
  return clampTarget(Number(raw));
}

export type PublishSlotView = {
  id: string;
  n: number;
  label: string;
  /** Publish-time daily cron ("M H * * *") - what the user configured; null = unset. */
  pattern: string | null;
  /** "HH:MM" target publish time; null = unset. */
  publishTime: string | null;
  /** "HH:MM" wall-clock generation start (publish minus lead); null = unset. */
  generationStart: string | null;
  /** Next generation fire time (epoch ms) straight from BullMQ; null = not registered. */
  next: number | null;
  configured: boolean;
};

/**
 * The slot list for the current Daily Blog Goal - exactly N entries, with
 * unset slots present (publishTime/pattern/next null) so the settings UI can
 * render an empty card to configure. Display times come from AppSetting (the
 * publish time the user picked), never from the Redis pattern (which is the
 * fire time = publish minus lead and would confuse the editor).
 */
export async function getPublishSlotView(): Promise<PublishSlotView[]> {
  const target = await readDailyTarget();
  const keys = Array.from({ length: target }, (_, i) => slotSettingKey(i + 1));
  const stored = await getAllSettings(keys);
  const schedulers = await researchQueue.getJobSchedulers().catch(() => []);
  const nextByKey = new Map(
    schedulers.map((scheduler) => [scheduler.key, typeof scheduler.next === "number" ? scheduler.next : null])
  );

  return keys.map((key, index) => {
    const n = index + 1;
    const id = blogSlotId(n);
    const parsed = parseSlotTime(stored.get(key));
    const fire = parsed ? fireClockTime(parsed.hour, parsed.minute, env.SLOT_GENERATION_LEAD_MINUTES) : null;
    return {
      id,
      n,
      label: `Blog #${n}`,
      pattern: parsed ? `${parsed.minute} ${parsed.hour} * * *` : null,
      publishTime: parsed ? formatHHMM(parsed.hour, parsed.minute) : null,
      generationStart: fire ? formatHHMM(fire.hour, fire.minute) : null,
      next: nextByKey.get(id) ?? null,
      configured: parsed !== null,
    };
  });
}

/** Registers (or updates) one slot's scheduler from its stored publish time. No-op when unset. */
async function registerSlot(n: number): Promise<boolean> {
  const parsed = parseSlotTime(await getSetting<string | null>(slotSettingKey(n), null));
  if (!parsed) return false;
  const fire = fireClockTime(parsed.hour, parsed.minute, env.SLOT_GENERATION_LEAD_MINUTES);
  await researchQueue.upsertJobScheduler(
    blogSlotId(n),
    { pattern: `${fire.minute} ${fire.hour} * * *`, tz: env.TIMEZONE },
    { name: "scheduled-slot", data: { slot: n } }
  );
  return true;
}

/**
 * Brings Redis in line with (goal, stored publish times): slots 1..N with a
 * configured publish time get (re)registered; schedulers for slots beyond
 * the goal or without a configured time are removed. Called at worker boot
 * (registerSchedules) and on every Daily Blog Goal change. Returns the
 * current slot count N.
 */
export async function reconcilePublishSlots(): Promise<number> {
  const target = await readDailyTarget();
  const wanted = new Set<string>();
  for (let n = 1; n <= target; n += 1) {
    if (await registerSlot(n)) wanted.add(blogSlotId(n));
  }

  const existing = await researchQueue.getJobSchedulers();
  for (const scheduler of existing) {
    if (scheduler.key && scheduler.key.startsWith(BLOG_SLOT_PREFIX) && !wanted.has(scheduler.key)) {
      await researchQueue.removeJobScheduler(scheduler.key);
    }
  }
  return target;
}

/**
 * Sets one slot's target publish time: persists the publish cron to
 * AppSetting (so it survives worker restarts) and immediately re-registers
 * the BullMQ scheduler at the computed fire time. Returns the updated view
 * entry for the UI.
 */
export async function upsertSlotTime(n: number, hour: number, minute: number): Promise<PublishSlotView> {
  await setSetting(slotSettingKey(n), `${minute} ${hour} * * *`);
  await registerSlot(n);
  const schedulers = await researchQueue.getJobSchedulers();
  const registered = schedulers.find((scheduler) => scheduler.key === blogSlotId(n));
  const fire = fireClockTime(hour, minute, env.SLOT_GENERATION_LEAD_MINUTES);
  return {
    id: blogSlotId(n),
    n,
    label: `Blog #${n}`,
    pattern: `${minute} ${hour} * * *`,
    publishTime: formatHHMM(hour, minute),
    generationStart: formatHHMM(fire.hour, fire.minute),
    next: typeof registered?.next === "number" ? registered.next : null,
    configured: true,
  };
}

/** Clears one slot's publish time (AppSetting row + Redis scheduler). */
export async function clearSlotTime(n: number) {
  await deleteSetting(slotSettingKey(n));
  await researchQueue.removeJobScheduler(blogSlotId(n)).catch(() => false);
}

// ---------------------------------------------------------------------------
// Per-trend publish target (the "hold until" timestamp a slot's blog carries)
// ---------------------------------------------------------------------------

const PUBLISH_TARGET_PREFIX = "publish-target:";
/**
 * A target only matters same-day (plus room for late retries across
 * midnight); 36h TTL means a stale key can never hold a blog hostage to a
 * long-past time - an expired read just publishes immediately.
 */
const PUBLISH_TARGET_TTL_S = 36 * 60 * 60;

/**
 * Recorded at dispatch time (slot run or backlog fallback) keyed by trendId.
 * The quality-worker looks it up via blog.trendId when queueing the publish
 * job, so the target flows Research -> ... -> Publish without threading an
 * extra field through every intermediate job payload.
 */
export async function setPublishTarget(trendId: string, targetPublishAtMs: number) {
  await redis.set(PUBLISH_TARGET_PREFIX + trendId, String(targetPublishAtMs), "EX", PUBLISH_TARGET_TTL_S);
}

/** Null when no slot context exists (manual runs, reconcile dispatches) - publish immediately. */
export async function getPublishTarget(trendId: string): Promise<number | null> {
  const raw = await redis.get(PUBLISH_TARGET_PREFIX + trendId).catch(() => null);
  const ts = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(ts) ? ts : null;
}
