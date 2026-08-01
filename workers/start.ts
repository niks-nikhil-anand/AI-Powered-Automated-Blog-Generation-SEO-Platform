/**
 * Boots every implemented worker (research + writing) plus the daily
 * schedule in a single process. Convenient for local development:
 *
 *   npm run worker:dev
 *
 * In Docker/production, run each worker as its own container instead
 * (see docker-compose.yml `research-worker` / `writing-worker` services)
 * so they can be scaled and restarted independently.
 */
import { startResearchWorker } from "./research-worker/index";
import { startWritingWorker } from "./writing-worker/index";
import { logger } from "./shared/logger";

const log = logger.child({ worker: "start" });

startResearchWorker();
startWritingWorker();

log.info("All workers started (research-worker, writing-worker)");

process.on("SIGTERM", () => {
  log.info("SIGTERM received, exiting");
  process.exit(0);
});
