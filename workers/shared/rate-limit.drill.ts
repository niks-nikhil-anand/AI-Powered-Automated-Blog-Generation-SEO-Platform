/**
 * Step 3.4 drill (docs/VERTEX_429_RESOLUTION_PLAN.md): exercises the
 * Redis-backed RPM pacer in workers/shared/rate-limit.ts against a REAL
 * Redis, proving the two behaviors the 429 fix relies on:
 *
 *   pacing    - with the flash limit at 5 RPM, each acquire is released at
 *               roughly 12-second intervals. This avoids minute-boundary
 *               bursts while keeping every worker container under one quota.
 *   fail-open - with Redis unreachable, acquires still proceed (each after
 *               the ~2s limiter timeout) instead of hanging the pipeline on
 *               a limiter outage (edge case EC11).
 *
 * Run (needs local/compose Redis for the pacing part):
 *
 *   npm run worker:drill:rate-limit            # pacing + breaker + fail-open
 *   VERTEX_FLASH_RPM=5 npx tsx workers/shared/rate-limit.drill.ts pacing
 *   REDIS_URL=redis://127.0.0.1:6390 npx tsx workers/shared/rate-limit.drill.ts fail-open
 *
 * "pacing" waits out evenly-spaced slots by design. Knobs: DRILL_LIMIT sets
 * the RPM limit for the spawned drills (default 5); DRILL_CALLS sets the
 * acquire count (default limit+3).
 *
 * The leaf modes read the limit from VERTEX_FLASH_RPM (the value the
 * limiter itself uses, bound at process start), so assertions always match
 * the real limiter config; the default "all" mode re-spawns itself per
 * mode with the right environment (fail-open needs a dead REDIS_URL, which
 * only takes effect in a fresh process).
 */
import { spawnSync } from "node:child_process";
import { redis } from "./redis";

const REDIS_TIMEOUT_GRACE_MS = 1000; // grace on top of the limiter's 2s per-call race timeout

async function pacingDrill(): Promise<void> {
  const limit = Number(process.env.VERTEX_FLASH_RPM ?? "20");
  const calls = Number(process.env.DRILL_CALLS ?? String(limit + 3));
  const { acquireModelSlot, isBreakerOpen, tripBreaker } = await import("./rate-limit");

  // Pacing proves nothing against a dead Redis (every acquire fails open and
  // looks "fast"), so refuse to run without a live one.
  await Promise.race([
    redis.ping(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Redis unreachable - start it (docker compose up -d redis) first")), 3000)
    ),
  ]);

  // Clean slate: a previous run's window would make early acquires wait.
  await redis.del(
    "vertex:pace:flash:nextAt", "vertex:pace:pro:nextAt", "vertex:pace:image:nextAt",
    "vertex:breaker:flash:openUntil", "vertex:breaker:pro:openUntil", "vertex:breaker:image:openUntil",
    "vertex:breaker:flash:failures", "vertex:breaker:pro:failures", "vertex:breaker:image:failures",
    "vertex:breaker:flash:probe", "vertex:breaker:pro:probe", "vertex:breaker:image:probe"
  );

  const startedAt = Date.now();
  const timings: number[] = [];
  for (let i = 1; i <= calls; i += 1) {
    await acquireModelSlot("flash");
    timings.push(Date.now() - startedAt);
    console.log(`[pacing] acquire ${i}/${calls} at +${Date.now() - startedAt}ms`);
  }

  const intervalMs = Math.ceil(60_000 / limit);
  const toleranceMs = 2_000 + REDIS_TIMEOUT_GRACE_MS;
  const spacingOk = timings.every((timing, index) => Math.abs(timing - index * intervalMs) <= toleranceMs);
  if (!spacingOk) throw new Error(`acquires should be spaced about ${intervalMs}ms, got ${JSON.stringify(timings)}`);
  console.log(`[pacing] PASS: ${timings.length} acquires evenly paced at about ${intervalMs}ms (limit ${limit} RPM)`);

  // Breaker round-trip: tripped => open; gateway calls wait before probing.
  await tripBreaker("flash");
  if (!(await isBreakerOpen("flash"))) throw new Error("flash breaker should be open right after tripBreaker()");
  if (await isBreakerOpen("pro")) throw new Error("pro breaker must stay closed when flash trips");
  console.log("[pacing] PASS: circuit breaker is scoped to the Flash quota lane");
}

async function failOpenDrill(): Promise<void> {
  const calls = Number(process.env.DRILL_CALLS ?? "3");
  const { acquireModelSlot } = await import("./rate-limit");

  const startedAt = Date.now();
  for (let i = 1; i <= calls; i += 1) {
    await acquireModelSlot("flash");
    console.log(`[fail-open] acquire ${i}/${calls} proceeded at +${Date.now() - startedAt}ms (Redis down)`);
  }
  const elapsed = Date.now() - startedAt;

  // Each call pays the limiter's 2s Redis race timeout, then proceeds. The
  // failure mode this guards against is hanging FOREVER on queued commands.
  const budget = calls * (2000 + REDIS_TIMEOUT_GRACE_MS);
  if (elapsed > budget) throw new Error(`fail-open acquires too slow: ${elapsed}ms > ${budget}ms budget`);
  console.log(`[fail-open] PASS: ${calls} acquires proceeded with Redis unreachable in ${elapsed}ms`);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "all";

  if (mode === "pacing") {
    await pacingDrill();
    return;
  }
  if (mode === "fail-open") {
    await failOpenDrill();
    return;
  }
  if (mode === "all") {
    // Each mode needs its own process: the shared env/redis singletons bind
    // VERTEX_FLASH_RPM and REDIS_URL at import time, so the overrides only
    // take effect in a freshly spawned process. Spawn the local tsx binary
    // explicitly - process.execPath is plain node, which can't parse this
    // TypeScript file or its extensionless imports.
    const tsxBin = `${process.cwd()}/node_modules/.bin/tsx`;
    const limit = process.env.DRILL_LIMIT ?? "5";
    for (const [name, envOverrides] of [
      ["pacing", { VERTEX_FLASH_RPM: limit }],
      ["fail-open", { VERTEX_FLASH_RPM: limit, REDIS_URL: "redis://127.0.0.1:6390" }],
    ] as const) {
      console.log(`\n=== ${name} drill ===`);
      const result = spawnSync(tsxBin, [process.argv[1], name], {
        stdio: "inherit",
        env: { ...process.env, ...envOverrides },
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${name} drill failed (exit ${result.status})`);
    }
    console.log("\nAll rate-limit drills passed");
    return;
  }
  throw new Error(`Unknown drill mode "${mode}" - use pacing | fail-open | all`);
}

main()
  .catch((err) => {
    console.error(`[drill] FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    redis.disconnect();
  });
