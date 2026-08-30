# Local Langfuse

Auto-Blog uses the self-hosted Langfuse stack as its sole AI telemetry store.
The application PostgreSQL tables (`AIUsage`, `WorkflowRun`, `WorkerAttempt`,
and `LogEntry`) are not used as a Langfuse fallback.

## Start

The local project keys are configured in the ignored `.env` file. Start the
application dependencies and Langfuse stack with:

```bash
docker compose up -d postgres redis langfuse-postgres langfuse-clickhouse langfuse-redis langfuse-minio langfuse-web langfuse-worker
```

Open [http://localhost:3030](http://localhost:3030). The default local login
is `admin@example.com` / `change-me-local`; change it before sharing the
instance. The Langfuse project is initialized as `auto-blog` with the local
project keys from `.env`.

The Next.js app reads Langfuse at `http://localhost:3030`. The Compose-based
Vertex gateway uses `http://langfuse-web:3000` on the internal Compose network.

## Verify

```bash
docker compose config
docker compose ps
docker compose logs -f langfuse-web langfuse-worker
```

Run a real pipeline request, then inspect the `auto-blog` project in Langfuse.
The observability page is available at `/dashboard/observability`.

## Stop and reset

Stop without deleting telemetry:

```bash
docker compose down
```

To intentionally delete all local Langfuse data, including traces, use the
destructive volume command only after confirming the volume names:

```bash
docker compose down -v
```

Prompt and output capture are disabled by default. Set the corresponding
`LANGFUSE_CAPTURE_*` values in `.env` only when raw content capture is
deliberately required.
