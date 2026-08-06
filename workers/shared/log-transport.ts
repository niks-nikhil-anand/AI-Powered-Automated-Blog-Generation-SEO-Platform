import Transport from "winston-transport";
import type { Prisma } from "../../app/generated/prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_MAX_BATCH = 50;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Same defensive round-trip as workers/shared/recovery.ts's jsonValue() -
 * a caller can pass anything as log metadata (an Error object, a BigInt),
 * and Prisma's Json column needs something JSON.stringify can actually
 * handle. Falls back to a best-effort string rather than dropping the
 * whole log line if metadata itself isn't serializable.
 */
function safeMeta(value: Record<string, unknown>) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { unserializable: String(value) };
  }
}

/**
 * Winston's level -> the uppercase strings LogEntry.level already uses (set
 * by the one existing write site, app/api/blogs/[id]/override-publish's
 * "WARN"). verbose/silly/http collapse into DEBUG - this pipeline never
 * calls those levels today, but the schema should hold whatever it's given
 * without surprises if it ever does.
 */
const LEVEL_MAP: Record<string, string> = {
  error: "ERROR",
  warn: "WARN",
  info: "INFO",
  http: "DEBUG",
  verbose: "DEBUG",
  debug: "DEBUG",
  silly: "DEBUG",
};

type LogEntryData = {
  timestamp: Date;
  level: string;
  worker: string | null;
  message: string;
  stack: string | null;
  // undefined (not null) when absent - Prisma's Json field distinguishes
  // "no value provided" (undefined) from "DB NULL" (Prisma.JsonNull), and
  // there's no meaningful metadata to store as an explicit null here.
  meta: Prisma.InputJsonValue | undefined;
  workflowRunId: string | null;
  trendId: string | null;
  blogId: string | null;
};

/**
 * Buffered Winston -> LogEntry transport. Referenced by a comment on the
 * LogEntry model in prisma/schema.prisma since that model was added, but
 * never actually implemented until now - see IMPLEMENTATION_PLAN.md-style
 * plan for the dashboard/logs rebuild this exists to support.
 *
 * Batches writes instead of one INSERT per log line, and never throws - a
 * DB hiccup degrades to "this batch of log lines is lost" rather than
 * taking down (or even slowing down) the worker process that's trying to
 * log. Same "accounting must never fail a job" posture as
 * workers/shared/pricing.ts's recordAIUsage.
 */
export class PrismaTransport extends Transport {
  private buffer: LogEntryData[] = [];
  private flushTimer: NodeJS.Timeout;
  private pruneTimer: NodeJS.Timeout;

  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.pruneTimer = setInterval(() => {
      void this.prune();
    }, PRUNE_INTERVAL_MS);
    // Don't let these background timers keep the process alive on their own.
    this.flushTimer.unref();
    this.pruneTimer.unref();
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    this.emit("logged", info);

    const { level, message, timestamp, stack, worker, workflowRunId, trendId, blogId, ...rest } = info;
    // Constant on every single line (winston's defaultMeta) - dropped rather
    // than repeated in every row's `meta` blob.
    delete rest.service;

    this.buffer.push({
      timestamp: typeof timestamp === "string" ? new Date(timestamp) : new Date(),
      level: LEVEL_MAP[String(level).toLowerCase()] ?? "INFO",
      worker: typeof worker === "string" ? worker : null,
      message: typeof message === "string" ? message : String(message ?? ""),
      stack: typeof stack === "string" ? stack : null,
      meta: Object.keys(rest).length > 0 ? safeMeta(rest as Record<string, unknown>) ?? undefined : undefined,
      workflowRunId: typeof workflowRunId === "string" ? workflowRunId : null,
      trendId: typeof trendId === "string" ? trendId : null,
      blogId: typeof blogId === "string" ? blogId : null,
    });

    if (this.buffer.length >= FLUSH_MAX_BATCH) void this.flush();
    callback();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await prisma.logEntry.createMany({ data: batch });
    } catch (error) {
      console.error("PrismaTransport: failed to flush log batch", error);
    }
  }

  private async prune(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - env.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await prisma.logEntry.deleteMany({ where: { timestamp: { lt: cutoff } } });
    } catch (error) {
      console.error("PrismaTransport: failed to prune old logs", error);
    }
  }
}
