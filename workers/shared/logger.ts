import winston from "winston";
import { env } from "./env";

/**
 * Shared Winston logger for all workers. Each worker should call
 * `logger.child({ worker: "research-worker" })` so log lines are
 * attributable, matching the README's "Worker logs and error traces"
 * dashboard requirement.
 */
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "devkit-market-workers" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, worker, ...meta }) => {
          const scope = worker ? `[${worker}]` : "";
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `${timestamp} ${level} ${scope} ${message}${extra}`;
        })
      ),
    }),
  ],
});
