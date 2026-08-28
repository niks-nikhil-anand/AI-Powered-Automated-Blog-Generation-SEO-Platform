/**
 * Boots every implemented worker plus the daily
 * schedule in a single process. Convenient for local development:
 *
 *   npm run worker:dev
 *
 * In Docker/production, run each worker as its own container instead
 * (see docker-compose.yml worker services)
 * so they can be scaled and restarted independently.
 */
import { startResearchWorker } from "./research-worker/index";
import { startPlanningWorker } from "./planning-worker/index";
import { startOutlineWorker } from "./outline-worker/index";
import { startWritingWorker } from "./writing-worker/index";
import { startImageWorker } from "./image-worker/index";
import { startQualityWorker } from "./quality-worker/index";
import { startPublishWorker } from "./publish-worker/index";
import { startVertexGateway } from "./vertex-gateway/index";
import { logger } from "./shared/logger";
import { logVertexRuntimeConfig } from "./shared/vertex";

const log = logger.child({ worker: "start" });

startVertexGateway();
startResearchWorker();
startPlanningWorker();
startOutlineWorker();
startWritingWorker();
startImageWorker();
startQualityWorker();
startPublishWorker();

// Boot fingerprint (docs/VERTEX_429_RESOLUTION_PLAN.md Step 1.2): proves at a
// glance whether a running process has the 429-resilience build. Each
// worker's own start* logs it too (Docker runs one worker per container);
// this covers the all-in-one `npm run worker:dev` process.
logVertexRuntimeConfig(log);
log.info("All workers started (vertex-gateway, research-worker, planning-worker, outline-worker, writing-worker, image-worker, quality-worker, publish-worker)");

process.on("SIGTERM", () => {
  log.info("SIGTERM received, exiting");
  process.exit(0);
});
