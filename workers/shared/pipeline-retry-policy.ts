import { UnrecoverableError } from "bullmq";
import { VertexQuotaError } from "./vertex";

/**
 * BullMQ retries remain useful for ordinary stage failures (database, Redis,
 * S3, transient application faults). A gateway that has already exhausted its
 * Vertex quota retry budget is different: retrying the whole stage amplifies
 * load and repeats completed work. Mark only that outcome unrecoverable.
 */
export async function withPipelineRetryPolicy<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof VertexQuotaError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
}
