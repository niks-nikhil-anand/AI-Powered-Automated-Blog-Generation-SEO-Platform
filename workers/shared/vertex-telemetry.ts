export type VertexTelemetryContext = {
  requestId?: string;
  workflowId?: string;
  jobId?: string;
  queue?: string;
  worker?: string;
  pipeline?: string;
  stage?: string;
};
