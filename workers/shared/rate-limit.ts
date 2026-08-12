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
 *  - tripBreaker()/isBreakerOpen(): when any call exhausts all retries on
 *    quota, the breaker opens for VERTEX_BREAKER_COOLDOWN_MS and
 *    "deferrable" calls fail fast WITHOUT hitting the API - their
 *    fail-soft contracts (heuristic scores, null dimensions, procedural
 *    SVG) absorb it, and the scarce quota is left for the critical
 *    publish path.
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

function windowKey(modelClass: ModelClass): string {
  return `vertex:rpm:${modelClass}`;
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
 * Wait until the caller holds a permit for this model class's current
 * 60s window, then return. Never throws (fail-open on Redis errors).
 */
export async function acquireModelSlot(modelClass: ModelClass): Promise<void> {
  const limit = limitFor(modelClass);
  if (!Number.isFinite(limit) || limit <= 0) return; // limiter disabled

  const key = windowKey(modelClass);
  try {
    for (;;) {
      const count = await redisCall(redis.incr(key));
      if (count === 1) {
        // First touch of this window - start its 60s expiry.
        await redisCall(redis.expire(key, 60));
      }
      if (count <= limit) return;

      // Over the limit: give the permit back so waiting callers don't
      // inflate the window they're waiting out, then sleep to the next
      // window edge (+ jitter so a waking herd doesn't re-collide).
      await redis.decr(key).catch(() => undefined);
      const ttlMs = await redisCall(redis.pttl(key));
      const waitMs = (ttlMs > 0 ? ttlMs : 1000) + Math.floor(Math.random() * 500);
      log.warn("Vertex RPM limit reached, waiting for next window", { modelClass, limit, waitMs });
      await sleep(waitMs);
    }
  } catch (error) {
    log.warn("Rate limiter unavailable, failing open", {
      modelClass,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const BREAKER_KEY = "vertex:breaker:openUntil";

/**
 * Open the breaker for VERTEX_BREAKER_COOLDOWN_MS. Called by
 * withVertexRetry when a call exhausts every retry on quota errors -
 * i.e. the quota pool is genuinely exhausted, not just contended.
 */
export async function tripBreaker(): Promise<void> {
  try {
    const openUntil = Date.now() + env.VERTEX_BREAKER_COOLDOWN_MS;
    await redisCall(redis.set(BREAKER_KEY, String(openUntil), "PX", env.VERTEX_BREAKER_COOLDOWN_MS + 5000));
    log.error("Vertex quota circuit breaker OPEN - deferrable calls will fail fast", {
      cooldownMs: env.VERTEX_BREAKER_COOLDOWN_MS,
    });
  } catch (error) {
    log.warn("Failed to trip the quota breaker (ignored)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** True while the breaker is open. Fails open = false (calls proceed). */
export async function isBreakerOpen(): Promise<boolean> {
  try {
    const value = await redisCall(redis.get(BREAKER_KEY));
    return value !== null && Number(value) > Date.now();
  } catch {
    return false;
  }
}
