import { AsyncLocalStorage } from "node:async_hooks";
import type { VertexTelemetryContext } from "./langfuse";

type VertexJobTelemetryContext = Omit<VertexTelemetryContext, "requestId">;

const storage = new AsyncLocalStorage<VertexJobTelemetryContext>();

/** Scope stable pipeline identity to every gateway request made while a job runs. */
export function withVertexTelemetryContext<T>(
  context: VertexJobTelemetryContext,
  work: () => Promise<T>
): Promise<T> {
  return storage.run({ ...context }, work);
}

/** Add identity that becomes available after the worker creates its workflow run. */
export function updateVertexTelemetryContext(context: Partial<VertexJobTelemetryContext>): void {
  const active = storage.getStore();
  if (active) Object.assign(active, context);
}

/** A fresh request ID is created by requestVertex for each individual call. */
export function currentVertexTelemetryContext(): VertexJobTelemetryContext | undefined {
  return storage.getStore();
}
