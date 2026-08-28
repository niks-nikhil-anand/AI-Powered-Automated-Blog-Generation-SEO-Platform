import { LangfuseSpanProcessor } from "@langfuse/otel";
import { startActiveObservation, startObservation, type LangfuseEmbedding, type LangfuseGeneration } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import { langfuseConfig } from "../shared/langfuse";
import type { ModelClass } from "../shared/rate-limit";
import type { VertexRequest, VertexResponse } from "../shared/vertex-request";
import { logger } from "../shared/logger";

const log = logger.child({ worker: "vertex-gateway", stage: "langfuse" });

let sdk: NodeSDK | undefined;
let processor: LangfuseSpanProcessor | undefined;
let tracingReady = false;

function errorMetadata(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { error_type: error.name, error_message: error.message };
  return { error_type: "VertexUnknownError", error_message: String(error) };
}

function inputFor(request: VertexRequest): unknown {
  if (!langfuseConfig.capturePrompts) return undefined;
  return {
    prompt: request.prompt,
    has_image: Boolean(request.image),
    image_mime_type: request.image?.mimeType,
    negative_prompt: request.negativePrompt,
  };
}

function outputFor(response: VertexResponse): unknown {
  if (!langfuseConfig.captureOutputs) {
    return {
      has_text: Boolean(response.text),
      has_image: Boolean(response.image),
      embedding_count: response.embeddings?.length ?? 0,
    };
  }
  // Avoid sending raw inline image bytes even when output capture is enabled.
  return {
    text: response.text,
    image: response.image ? { mime_type: response.image.mimeType, captured: false } : undefined,
    embedding_dimensions: response.embeddings?.map((embedding) => embedding.length),
  };
}

/** Initialize once in the gateway before the BullMQ worker starts processing. */
export function initializeLangfuse(): void {
  if (sdk || !langfuseConfig.enabled) return;
  try {
    processor = new LangfuseSpanProcessor({
      publicKey: langfuseConfig.publicKey,
      secretKey: langfuseConfig.secretKey,
      baseUrl: langfuseConfig.baseUrl,
      environment: langfuseConfig.environment,
      release: langfuseConfig.release,
      mediaUploadEnabled: false,
      exportMode: "batched",
    });
    sdk = new NodeSDK({
      sampler: new TraceIdRatioBasedSampler(langfuseConfig.sampleRate),
      spanProcessors: [processor],
    });
    sdk.start();
    tracingReady = true;
    log.info("Langfuse tracing enabled", {
      environment: langfuseConfig.environment,
      release: langfuseConfig.release,
      sampleRate: langfuseConfig.sampleRate,
      capturePrompts: langfuseConfig.capturePrompts,
      captureOutputs: langfuseConfig.captureOutputs,
    });
  } catch (error) {
    tracingReady = false;
    log.warn("Langfuse initialization failed; Vertex requests remain available", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Flush pending telemetry during an orderly gateway shutdown. Never throws. */
export async function shutdownLangfuse(): Promise<void> {
  try {
    await processor?.forceFlush();
    await sdk?.shutdown();
  } catch (error) {
    log.warn("Langfuse shutdown flush failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    sdk = undefined;
    processor = undefined;
    tracingReady = false;
  }
}

/**
 * Wrap one actual Google SDK call. Retries intentionally create separate
 * generations, so Langfuse reflects the request sequence Vertex received.
 */
export async function traceVertexInvocation<T extends VertexResponse>(params: {
  request: VertexRequest;
  modelClass: ModelClass;
  attempt: number;
  probe: boolean;
  work: () => Promise<T>;
}): Promise<T> {
  if (!tracingReady) return params.work();

  let observation: LangfuseGeneration | LangfuseEmbedding | undefined;
  const metadata = {
    provider: "google",
    model_type: params.modelClass,
    operation: params.request.operation,
    request_id: params.request.telemetry?.requestId,
    workflow_id: params.request.telemetry?.workflowId,
    job_id: params.request.telemetry?.jobId,
    queue: params.request.telemetry?.queue,
    worker: params.request.telemetry?.worker,
    pipeline: params.request.telemetry?.pipeline,
    stage: params.request.telemetry?.stage,
    retry_count: params.attempt - 1,
    probe_attempt: params.probe,
  };

  try {
    observation = params.request.operation === "embedding"
      ? startObservation("vertex.embedding", {
          model: params.request.model,
          input: inputFor(params.request),
          metadata,
        }, { asType: "embedding" })
      : startObservation("vertex.generate", {
          model: params.request.model,
          input: inputFor(params.request),
          modelParameters: {
            ...(params.request.temperature !== undefined ? { temperature: params.request.temperature } : {}),
            ...(params.request.maxOutputTokens !== undefined ? { max_output_tokens: params.request.maxOutputTokens } : {}),
          },
          metadata,
        }, { asType: "generation" });
  } catch (error) {
    log.warn("Langfuse observation creation failed; continuing Vertex request", {
      ...errorMetadata(error),
      requestId: params.request.telemetry?.requestId,
    });
  }

  try {
    const response = await params.work();
    try {
      observation?.update({
        output: outputFor(response),
        usageDetails: {
          input: response.usage.promptTokens,
          output: response.usage.completionTokens,
          total: response.usage.promptTokens + response.usage.completionTokens,
        },
        metadata: { ...metadata, status: "success" },
      });
    } catch (error) {
      log.warn("Langfuse success update failed", { ...errorMetadata(error), requestId: params.request.telemetry?.requestId });
    }
    return response;
  } catch (error) {
    try {
      observation?.update({
        level: "ERROR",
        statusMessage: error instanceof Error ? error.message : String(error),
        metadata: { ...metadata, status: "error", ...errorMetadata(error) },
      });
    } catch (updateError) {
      log.warn("Langfuse error update failed", { ...errorMetadata(updateError), requestId: params.request.telemetry?.requestId });
    }
    throw error;
  } finally {
    try {
      observation?.end();
    } catch (error) {
      log.warn("Langfuse observation close failed", { ...errorMetadata(error), requestId: params.request.telemetry?.requestId });
    }
  }
}

/**
 * Root span for one gateway request. Child generation observations cover each
 * retry attempt, producing a trace timeline of waits, retries, and the final
 * result without requiring workers to initialize the Langfuse SDK.
 */
export async function traceGatewayRequest<T>(params: {
  request: VertexRequest;
  work: () => Promise<T>;
}): Promise<T> {
  if (!tracingReady) return params.work();

  const metadata = {
    provider: "google",
    request_id: params.request.telemetry?.requestId,
    workflow_id: params.request.telemetry?.workflowId,
    job_id: params.request.telemetry?.jobId,
    queue: params.request.telemetry?.queue,
    worker: params.request.telemetry?.worker,
    pipeline: params.request.telemetry?.pipeline,
    stage: params.request.telemetry?.stage,
    operation: params.request.operation,
    queue_wait_ms: Math.max(0, Date.now() - (params.request.enqueuedAt ?? Date.now())),
  };

  let businessStarted = false;
  try {
    return await startActiveObservation("vertex.gateway.request", async (span) => {
      try {
        span.update({ input: inputFor(params.request), metadata });
      } catch (error) {
        log.warn("Langfuse root trace initialization update failed", { ...errorMetadata(error) });
      }
      businessStarted = true;
      try {
        const result = await params.work();
        try {
          span.update({ output: outputFor(result as VertexResponse), metadata: { ...metadata, status: "success" } });
        } catch (error) {
          log.warn("Langfuse root trace success update failed", { ...errorMetadata(error) });
        }
        return result;
      } catch (error) {
        try {
          span.update({
            level: "ERROR",
            statusMessage: error instanceof Error ? error.message : String(error),
            metadata: { ...metadata, status: "error", ...errorMetadata(error) },
          });
        } catch (updateError) {
          log.warn("Langfuse root trace error update failed", { ...errorMetadata(updateError) });
        }
        throw error;
      }
    });
  } catch (error) {
    // A failure before the callback begins is purely telemetry-related.
    // Once business work has started, preserve its original success/error.
    if (!businessStarted) {
      log.warn("Langfuse root trace failed; continuing Vertex request", { ...errorMetadata(error) });
      return params.work();
    }
    throw error;
  }
}
