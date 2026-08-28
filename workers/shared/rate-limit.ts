import { redis } from "./redis";
import { env } from "./env";
import { logger } from "./logger";

const log = logger.child({ worker: "vertex", stage: "rate-limit" });

/**
 * Cross-container quota pacing + circuit breaker
 * (docs/VERTEX_429_RESOLUTION_PLAN.md Steps 3 & 5).
 *
 * Workers run as SEPARATE Docker containers, so the in-process semaphore
 * in shared/vertex.ts can only smooth one process - it cannot stop the
 * research container's semantic burst from 429-ing the planning
 * container. This module coordinates through Redis instead:
 *
 *  - acquireModelSlot(): fixed-window (60s) per-model-class request
 *    pacing. Vertex quotas are per base model per region, so flash / pro /
 *    image are paced independently. Waiters give their over-limit INCR
 *    permit back (DECR) so a waiting herd doesn't inflate the window it
 *    is waiting out.
 *  - tripBreaker()/waitForBreakerProbe(): when any call exhausts all retries
 *    on quota, the breaker opens and every new gateway request waits. After
 *    cooldown exactly one request probes Vertex; a failed probe extends the
 *    cooldown, while a success closes the breaker for the model class.
 *
 * EVERYTHING here fails OPEN: any Redis error logs a warning and allows
 * the call. A limiter bug must never become the pipeline outage.
 */

export type ModelClass = "flash" | "pro" | "image";

/** Vertex quota buckets are per base model - map a model name to its class. */
export function modelClassOf(model: string): ModelClass {
  const normalized = model.toLowerCase();
  if (normalized.includes("image") || normalized.includes("imagen")) return "image";
  if (normalized.includes("pro")) return "pro";
  return "flash"; // flash, flash-lite, embedding, vision-flash, etc.
}

function limitFor(modelClass: ModelClass): number {
  if (modelClass === "pro") return env.VERTEX_PRO_RPM;
  if (modelClass === "image") return env.VERTEX_IMAGE_RPM;
  return env.VERTEX_FLASH_RPM;
}

function paceKey(modelClass: ModelClass): string {
  return `vertex:pace:${modelClass}:nextAt`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ioredis is configured with `maxRetriesPerRequest: null` (BullMQ's
 * requirement - see shared/redis.ts), which means a Redis outage makes
 * commands QUEUE FOREVER instead of rejecting - a plain try/catch would
 * hang the limiter (and with it every Vertex call) instead of failing
 * open. Race every command against a short timeout so an outage trips
 * the fail-open path instead.
 */
const REDIS_CALL_TIMEOUT_MS = 2000;

function redisCall<T>(call: Promise<T>): Promise<T> {
  return Promise.race([
    call,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("rate-limiter Redis call timed out")), REDIS_CALL_TIMEOUT_MS)
    ),
  ]);
}

/**
 * Reserve the next evenly-spaced request slot for this model class, then
 * wait for it. This is intentionally a leaky bucket rather than a fixed
 * 60-second counter: at 5 RPM callers are released roughly every 12 seconds
 * instead of five at a minute boundary and another five a moment later.
 *
 * The Redis script atomically advances the next slot. Never throws: Redis
 * faults fail open so a limiter outage cannot become a pipeline outage.
 */
export async function acquireModelSlot(modelClass: ModelClass): Promise<void> {
  const limit = limitFor(modelClass);
  if (!Number.isFinite(limit) || limit <= 0) return; // limiter disabled

  const intervalMs = Math.ceil(60_000 / limit);
  const key = paceKey(modelClass);
  try {
    const now = Date.now();
    const scheduledAt = Number(await redisCall(redis.eval(
      // KEYS[1] stores the first unreserved millisecond. ARGV[2] bounds
      // stale state so an idle bucket starts immediately on its next call.
      "local previous = tonumber(redis.call('GET', KEYS[1]) or '0'); " +
      "local scheduled = math.max(previous, tonumber(ARGV[1])); " +
      "redis.call('SET', KEYS[1], scheduled + tonumber(ARGV[2]), 'PX', tonumber(ARGV[3])); " +
      "return scheduled",
      1,
      key,
      now,
      intervalMs,
      Math.max(intervalMs * 2, 60_000)
    )));
    const waitMs = Math.max(0, scheduledAt - now);
    if (waitMs > 0) {
      log.warn("Vertex RPM pace slot reserved", { modelClass, limit, waitMs });
      await sleep(waitMs);
    }
  } catch (error) {
    log.warn("Rate limiter unavailable, failing open", {
      modelClass,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function breakerKey(modelClass: ModelClass): string {
  return `vertex:breaker:${modelClass}:openUntil`;
}

function breakerFailuresKey(modelClass: ModelClass): string {
  return `vertex:breaker:${modelClass}:failures`;
}

function breakerProbeKey(modelClass: ModelClass): string {
  return `vertex:breaker:${modelClass}:probe`;
}

/**
 * Open the breaker for VERTEX_BREAKER_COOLDOWN_MS. Called by
 * withVertexRetry when a call exhausts every retry on quota errors -
 * i.e. the quota pool is genuinely exhausted, not just contended.
 */
export async function tripBreaker(modelClass: ModelClass): Promise<void> {
  try {
    const failures = Number(await redisCall(redis.incr(breakerFailuresKey(modelClass))));
    const cooldownMs = Math.min(
      env.VERTEX_BREAKER_MAX_COOLDOWN_MS,
      env.VERTEX_BREAKER_COOLDOWN_MS * 2 ** Math.max(0, failures - 1)
    );
    const openUntil = Date.now() + cooldownMs;
    // Keep the key alive briefly past openUntil so only one gateway replica
    // can atomically claim the half-open probe.
    await redisCall(redis.set(breakerKey(modelClass), String(openUntil), "PX", cooldownMs + 5000));
    await redisCall(redis.pexpire(breakerFailuresKey(modelClass), env.VERTEX_BREAKER_MAX_COOLDOWN_MS + 5000));
    await redisCall(redis.del(breakerProbeKey(modelClass)));
    log.error("Vertex quota circuit breaker OPEN - gateway requests are waiting", {
      modelClass,
      cooldownMs,
      failures,
    });
  } catch (error) {
    log.warn("Failed to trip the quota breaker (ignored)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** True while the breaker is open. Fails open = false (calls proceed). */
export async function breakerRemainingMs(modelClass: ModelClass): Promise<number> {
  try {
    const value = await redisCall(redis.get(breakerKey(modelClass)));
    return value === null ? 0 : Math.max(0, Number(value) - Date.now());
  } catch {
    return 0;
  }
}

/**
 * Wait for an open breaker, then let exactly one gateway instance perform the
 * half-open probe. Other instances continue waiting for its success/failure.
 * Returns true only to the caller that owns that probe.
 */
export async function waitForBreakerProbe(modelClass: ModelClass): Promise<boolean> {
  for (;;) {
    try {
      const openUntil = await redisCall(redis.get(breakerKey(modelClass)));
      if (openUntil === null) return false;

      const waitMs = Number(openUntil) - Date.now();
      if (waitMs > 0) {
        log.warn("Vertex quota lane paused; gateway request waiting", { modelClass, waitMs });
        await sleep(waitMs + Math.floor(Math.random() * 250));
        continue;
      }

      const probeAcquired = await redisCall(redis.set(
        breakerProbeKey(modelClass),
        String(Date.now()),
        "PX",
        Math.min(env.VERTEX_RETRY_BUDGET_MS, 5 * 60_000),
        "NX"
      ));
      if (probeAcquired === "OK") return true;

      // Another gateway replica is probing. Its result will either clear the
      // breaker or install a new openUntil value.
      await sleep(250);
    } catch {
      // Fail open if Redis is unavailable; normal gateway retry handling is
      // still safer than turning a Redis issue into a total pipeline outage.
      return false;
    }
  }
}

/** True while this model class's quota breaker is open. */
export async function isBreakerOpen(modelClass: ModelClass): Promise<boolean> {
  return (await breakerRemainingMs(modelClass)) > 0;
}

/** A confirmed success closes a stale breaker early for this model class. */
export async function resetBreaker(modelClass: ModelClass): Promise<void> {
  try {
    await redisCall(redis.del(breakerKey(modelClass), breakerFailuresKey(modelClass), breakerProbeKey(modelClass)));
  } catch {
    // Fail open: recovery bookkeeping must never block a successful request.
  }
}
