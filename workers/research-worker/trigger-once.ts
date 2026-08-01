/**
 * Manual test trigger: runs the research pipeline once, immediately,
 * without waiting for the 8am cron or needing the BullMQ worker process
 * running. Useful for local testing:
 *
 *   npm run worker:research:once
 */
import { runResearch } from "./index";
import { logger } from "../shared/logger";
import { prisma } from "../shared/prisma";
import { redis } from "../shared/redis";

const log = logger.child({ worker: "research-worker" });

runResearch()
  .then((result) => {
    log.info("Manual research run complete", result);
  })
  .catch((err) => {
    log.error(`Manual research run failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
