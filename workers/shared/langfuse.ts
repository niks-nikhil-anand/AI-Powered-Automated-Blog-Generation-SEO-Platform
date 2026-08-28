/**
 * Shared Langfuse configuration and metadata contract.
 *
 * This module intentionally has no SDK import. Workers may safely import the
 * request metadata types without receiving Langfuse credentials or creating a
 * tracing client. The gateway is the only process that will initialize the
 * official Langfuse SDK.
 */
import { env } from "./env";

export type VertexTelemetryContext = {
  requestId?: string;
  workflowId?: string;
  jobId?: string;
  queue?: string;
  worker?: string;
  pipeline?: string;
  stage?: string;
};

export type LangfuseConfig = {
  enabled: boolean;
  publicKey?: string;
  secretKey?: string;
  baseUrl: string;
  environment: string;
  release?: string;
  sampleRate: number;
  capturePrompts: boolean;
  captureOutputs: boolean;
};

/**
 * Enabled requires complete credentials. A partial configuration safely acts
 * as disabled so observability can never block a Vertex request.
 */
export const langfuseConfig: LangfuseConfig = {
  enabled: env.LANGFUSE_ENABLED && Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
  publicKey: env.LANGFUSE_PUBLIC_KEY,
  secretKey: env.LANGFUSE_SECRET_KEY,
  baseUrl: env.LANGFUSE_BASE_URL,
  environment: env.LANGFUSE_ENVIRONMENT,
  release: env.LANGFUSE_RELEASE,
  sampleRate: env.LANGFUSE_SAMPLE_RATE,
  capturePrompts: env.LANGFUSE_CAPTURE_PROMPTS,
  captureOutputs: env.LANGFUSE_CAPTURE_OUTPUTS,
};
