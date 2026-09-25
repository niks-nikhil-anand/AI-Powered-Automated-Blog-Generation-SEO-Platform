import pg from "pg";
import fs from "fs";
import path from "path";
import { PrismaClient } from "../../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

/**
 * Single shared Prisma Client instance for all worker processes.
 * Prisma 7's "prisma-client" generator requires an explicit driver
 * adapter instead of a bare connection string - see
 * .claude/skills/prisma-postgres-setup/references/prisma7-client.md
 *
 * Local processes use localhost from .env; Docker Compose overrides
 * DATABASE_URL to connect through the postgres service hostname.
 */
declare global {
  var __workerPgPool: pg.Pool | undefined;
  var __workerPrisma: PrismaClient | undefined;
}

function createClient() {
  let poolConnectionString = env.DATABASE_URL;
  let password = "";
  let ssl: pg.PoolConfig["ssl"] | undefined;
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      const sslRootCert = url.searchParams.get("sslrootcert");
      if (sslRootCert && !fs.existsSync(sslRootCert)) {
        const containerCertPath = path.join(process.cwd(), path.basename(sslRootCert));
        if (fs.existsSync(containerCertPath)) {
          url.searchParams.set("sslrootcert", containerCertPath);
        }
      }
      password = url.password || "";
      const sslMode = url.searchParams.get("sslmode");
      if (sslMode === "require" || sslMode === "no-verify") {
        ssl = { rejectUnauthorized: false };
        url.searchParams.delete("sslmode");
        poolConnectionString = url.toString();
      } else if (sslMode === "verify-full" || sslMode === "verify-ca") {
        ssl = { rejectUnauthorized: true };
        poolConnectionString = url.toString();
      }
    } catch (e) {
      console.warn("Warning: Failed to parse DATABASE_URL as URL. Using empty password fallback.", e);
    }
  }

  const pool =
    globalThis.__workerPgPool ??
    new pg.Pool({
      connectionString: poolConnectionString || undefined,
      password,
      ssl,
    });
  const adapter = new PrismaPg(pool);
  globalThis.__workerPgPool = pool;
  return new PrismaClient({ adapter });
}

export const prisma = globalThis.__workerPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__workerPrisma = prisma;
}
