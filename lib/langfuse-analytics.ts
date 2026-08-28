import "server-only";
import { LangfuseClient } from "@langfuse/client";
import { langfuseConfig } from "@/workers/shared/langfuse";

export type ObservabilityRange = "15m" | "1h" | "6h" | "24h" | "7d" | "30d";

type ObservationRow = Record<string, unknown>;

export type ObservabilityTrace = {
  id: string;
  traceId: string;
  startedAt: string;
  model: string;
  worker: string;
  stage: string;
  status: "success" | "error";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  retries: number;
};

export type ObservabilityDashboard = {
  state: "ready" | "disabled" | "unavailable";
  message?: string;
  generatedAt: string;
  overview: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    averageLatencyMs: number | null;
    successRate: number | null;
    rate429: number;
    retries: number;
    fallbacks: number;
  };
  models: Array<{ model: string; requests: number; totalTokens: number; averageLatencyMs: number | null; errors: number; rate429: number }>;
  stages: Array<{ stage: string; requests: number; totalTokens: number; errors: number }>;
  traces: ObservabilityTrace[];
  nextCursor?: string | null;
};

const RANGE_MS: Record<ObservabilityRange, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
};

const cache = new Map<string, { expiresAt: number; value: ObservabilityDashboard }>();

function numberValue(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function usageOf(row: ObservationRow) {
  const usage = recordValue(row.usageDetails);
  const input = numberValue(usage.input ?? usage.inputTokens ?? row.inputUsage);
  const output = numberValue(usage.output ?? usage.outputTokens ?? row.outputUsage);
  const total = numberValue(usage.total ?? usage.totalTokens ?? row.totalUsage) ?? ((input ?? 0) + (output ?? 0));
  return { input, output, total };
}

function metadataOf(row: ObservationRow) {
  return recordValue(row.metadata);
}

function traceFrom(row: ObservationRow): ObservabilityTrace {
  const metadata = metadataOf(row);
  const usage = usageOf(row);
  const statusMessage = stringValue(row.statusMessage);
  const level = stringValue(row.level);
  const error = level === "ERROR" || metadata.status === "error";
  return {
    id: stringValue(row.id),
    traceId: stringValue(row.traceId),
    startedAt: stringValue(row.startTime),
    model: stringValue(row.providedModelName, "unknown"),
    worker: stringValue(metadata.worker, "gateway"),
    stage: stringValue(metadata.stage, "unknown"),
    status: error ? "error" : "success",
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.total,
    latencyMs: numberValue(row.latency === undefined ? null : Number(row.latency) * 1000),
    retries: numberValue(metadata.retry_count) ?? 0,
  };
}

function emptyDashboard(state: "disabled" | "unavailable", message: string): ObservabilityDashboard {
  return {
    state,
    message,
    generatedAt: new Date().toISOString(),
    overview: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, averageLatencyMs: null, successRate: null, rate429: 0, retries: 0, fallbacks: 0 },
    models: [], stages: [], traces: [], nextCursor: null,
  };
}

/** Server-only query layer. Credentials never cross this module boundary. */
export async function getObservabilityDashboard(params: { range: ObservabilityRange; cursor?: string; limit?: number }): Promise<ObservabilityDashboard> {
  if (!langfuseConfig.enabled) return emptyDashboard("disabled", "Langfuse is not configured for this environment.");

  const limit = Math.min(100, Math.max(1, params.limit ?? 50));
  const cacheKey = `${params.range}:${params.cursor ?? "first"}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const client = new LangfuseClient({
      publicKey: langfuseConfig.publicKey,
      secretKey: langfuseConfig.secretKey,
      baseUrl: langfuseConfig.baseUrl,
    });
    const response = await client.api.observations.getMany({
      fromStartTime: new Date(Date.now() - RANGE_MS[params.range]).toISOString(),
      toStartTime: new Date().toISOString(),
      limit,
      cursor: params.cursor,
      fields: "core,basic,metadata,model,usage,metrics,trace_context",
      type: "GENERATION",
      environment: langfuseConfig.environment,
    });
    const rows = (response.data as unknown as ObservationRow[]).filter((row) => row.type === "GENERATION" || row.type === "EMBEDDING");
    const traces = rows.map(traceFrom);
    const errors = traces.filter((trace) => trace.status === "error");
    const rate429 = rows.filter((row) => {
      const metadata = metadataOf(row);
      return String(metadata.error_code ?? metadata.error_message ?? row.statusMessage ?? "").includes("429");
    }).length;
    const latencies = traces.map((trace) => trace.latencyMs).filter((value): value is number => value !== null);
    const byModel = new Map<string, { requests: number; totalTokens: number; latencyTotal: number; latencyCount: number; errors: number; rate429: number }>();
    const byStage = new Map<string, { requests: number; totalTokens: number; errors: number }>();
    for (const trace of traces) {
      const model = byModel.get(trace.model) ?? { requests: 0, totalTokens: 0, latencyTotal: 0, latencyCount: 0, errors: 0, rate429: 0 };
      model.requests += 1;
      model.totalTokens += trace.totalTokens ?? 0;
      if (trace.latencyMs !== null) { model.latencyTotal += trace.latencyMs; model.latencyCount += 1; }
      if (trace.status === "error") model.errors += 1;
      const row = rows.find((candidate) => stringValue(candidate.id) === trace.id);
      if (String(metadataOf(row ?? {}).error_code ?? metadataOf(row ?? {}).error_message ?? row?.statusMessage ?? "").includes("429")) model.rate429 += 1;
      byModel.set(trace.model, model);

      const stage = byStage.get(trace.stage) ?? { requests: 0, totalTokens: 0, errors: 0 };
      stage.requests += 1;
      stage.totalTokens += trace.totalTokens ?? 0;
      if (trace.status === "error") stage.errors += 1;
      byStage.set(trace.stage, stage);
    }
    const dashboard: ObservabilityDashboard = {
      state: "ready",
      generatedAt: new Date().toISOString(),
      overview: {
        requests: traces.length,
        inputTokens: traces.reduce((sum, trace) => sum + (trace.inputTokens ?? 0), 0),
        outputTokens: traces.reduce((sum, trace) => sum + (trace.outputTokens ?? 0), 0),
        totalTokens: traces.reduce((sum, trace) => sum + (trace.totalTokens ?? 0), 0),
        averageLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
        successRate: traces.length ? Number((((traces.length - errors.length) / traces.length) * 100).toFixed(1)) : null,
        rate429,
        retries: traces.reduce((sum, trace) => sum + trace.retries, 0),
        fallbacks: rows.filter((row) => metadataOf(row).fallback_execution === true).length,
      },
      models: [...byModel.entries()].map(([model, metrics]) => ({ model, requests: metrics.requests, totalTokens: metrics.totalTokens, averageLatencyMs: metrics.latencyCount ? Math.round(metrics.latencyTotal / metrics.latencyCount) : null, errors: metrics.errors, rate429: metrics.rate429 })),
      stages: [...byStage.entries()].map(([stage, metrics]) => ({ stage, ...metrics })),
      traces,
      nextCursor: (response.meta as { cursor?: string | null }).cursor ?? null,
    };
    cache.set(cacheKey, { value: dashboard, expiresAt: Date.now() + 15_000 });
    return dashboard;
  } catch (error) {
    return emptyDashboard("unavailable", error instanceof Error ? error.message : "Langfuse analytics is temporarily unavailable.");
  }
}
