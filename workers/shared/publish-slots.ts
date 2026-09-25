import { env } from "./env";
import { redis } from "./redis";
import { schedulerQueue } from "./queues";
import { DAILY_TARGET_KEY, deleteSetting, getAllSettings, getSetting, setSetting } from "./settings";

/**
 * Dynamic publish slots - one per Daily Blog Goal (docs: settings page).
 *
 * The goal N means "start N blog pipelines per day, each at its own
 * configured run time". A slot fires by pulling the next eligible BlogInput
 * off the submission backlog. Slot n's canonical value is its RUN time,
 * stored in AppSetting as `schedule:blog-slot-<n>` = "M H * * *" (a plain
 * daily cron in env.TIMEZONE). If a time is still in the future today, the
 * worker starts then; if it already passed, BullMQ naturally schedules it
 * for tomorrow at the same wall-clock time.
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

/** AppSetting key holding a slot's run-time cron ("M H * * *"). */
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
  /** Run-time daily cron ("M H * * *") - what the user configured; null = unset. */
  pattern: string | null;
  /** "HH:MM" configured run time; null = unset. */
  publishTime: string | null;
  /** Back-compat alias for clients that still read the old field. */
  generationStart: string | null;
  /** Next scheduler fire time (epoch ms) straight from BullMQ; null = not registered. */
  next: number | null;
  configured: boolean;
};

/**
 * The slot list for the current Daily Blog Goal - exactly N entries, with
 * unset slots present (publishTime/pattern/next null) so the settings UI can
 * render an empty card to configure.
 */
export async function getPublishSlotView(): Promise<PublishSlotView[]> {
  const target = await readDailyTarget();
  const keys = Array.from({ length: target }, (_, i) => slotSettingKey(i + 1));
  const stored = await getAllSettings(keys);
  const schedulers = await schedulerQueue.getJobSchedulers().catch(() => []);
  const nextByKey = new Map(
    schedulers.map((scheduler) => [scheduler.key, typeof scheduler.next === "number" ? scheduler.next : null])
  );

  return keys.map((key, index) => {
    const n = index + 1;
    const id = blogSlotId(n);
    const parsed = parseSlotTime(stored.get(key));
    return {
      id,
      n,
      label: `Blog #${n}`,
      pattern: parsed ? `${parsed.minute} ${parsed.hour} * * *` : null,
      publishTime: parsed ? formatHHMM(parsed.hour, parsed.minute) : null,
      generationStart: parsed ? formatHHMM(parsed.hour, parsed.minute) : null,
      next: nextByKey.get(id) ?? null,
      configured: parsed !== null,
    };
  });
}

/** Registers (or updates) one slot's scheduler from its stored run time. No-op when unset. */
async function registerSlot(n: number): Promise<boolean> {
  const parsed = parseSlotTime(await getSetting<string | null>(slotSettingKey(n), null));
  if (!parsed) return false;
  await schedulerQueue.upsertJobScheduler(
    blogSlotId(n),
    { pattern: `${parsed.minute} ${parsed.hour} * * *`, tz: env.TIMEZONE },
    { name: "scheduled-slot", data: { slot: n } }
  );
  return true;
}

/**
 * Brings Redis in line with (goal, stored run times): slots 1..N with a
 * configured run time get (re)registered; schedulers for slots beyond
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

  const existing = await schedulerQueue.getJobSchedulers();
  for (const scheduler of existing) {
    if (scheduler.key && scheduler.key.startsWith(BLOG_SLOT_PREFIX) && !wanted.has(scheduler.key)) {
      await schedulerQueue.removeJobScheduler(scheduler.key);
    }
  }
  return target;
}

/**
 * Sets one slot's run time: persists the daily cron to
 * AppSetting (so it survives worker restarts) and immediately re-registers
 * the BullMQ scheduler. Returns the updated view entry for the UI.
 */
export async function upsertSlotTime(n: number, hour: number, minute: number): Promise<PublishSlotView> {
  await setSetting(slotSettingKey(n), `${minute} ${hour} * * *`);
  await registerSlot(n);
  const schedulers = await schedulerQueue.getJobSchedulers();
  const registered = schedulers.find((scheduler) => scheduler.key === blogSlotId(n));
  return {
    id: blogSlotId(n),
    n,
    label: `Blog #${n}`,
    pattern: `${minute} ${hour} * * *`,
    publishTime: formatHHMM(hour, minute),
    generationStart: formatHHMM(hour, minute),
    next: typeof registered?.next === "number" ? registered.next : null,
    configured: true,
  };
}

/** Clears one slot's run time (AppSetting row + Redis scheduler). */
export async function clearSlotTime(n: number) {
  await deleteSetting(slotSettingKey(n));
  await schedulerQueue.removeJobScheduler(blogSlotId(n)).catch(() => false);
}

// ---------------------------------------------------------------------------
// Per-input publish target (the "hold until" timestamp a slot's blog carries)
// ---------------------------------------------------------------------------

const PUBLISH_TARGET_PREFIX = "publish-target:";
/**
 * A target only matters same-day (plus room for late retries across
 * midnight); 36h TTL means a stale key can never hold a blog hostage to a
 * long-past time - an expired read just publishes immediately.
 */
const PUBLISH_TARGET_TTL_S = 36 * 60 * 60;

/**
 * Recorded at dispatch time (slot run or backlog fallback) keyed by
 * blogInputId. The quality-worker looks it up via blog.blogInputId when
 * queueing the publish job, so the target flows Input -> ... -> Publish
 * without threading an extra field through every intermediate job payload.
 */
export async function setPublishTarget(blogInputId: string, targetPublishAtMs: number) {
  await redis.set(PUBLISH_TARGET_PREFIX + blogInputId, String(targetPublishAtMs), "EX", PUBLISH_TARGET_TTL_S);
}

/** Null when no slot context exists (manual runs, reconcile dispatches) - publish immediately. */
export async function getPublishTarget(blogInputId: string): Promise<number | null> {
  const raw = await redis.get(PUBLISH_TARGET_PREFIX + blogInputId).catch(() => null);
  const ts = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(ts) ? ts : null;
}
