import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

declare global {
  var __appPgPool: pg.Pool | undefined;
  var __appPrisma: PrismaClient | undefined;
}

function createClient() {
  const connectionString = process.env.DATABASE_URL ?? "";
  let poolConnectionString = connectionString;
  let password = "";
  let ssl: pg.PoolConfig["ssl"] | undefined;
  if (connectionString) {
    try {
      const url = new URL(connectionString);
      password = url.password || "";
      const sslMode = url.searchParams.get("sslmode");
      if (sslMode === "require" || sslMode === "no-verify") {
        ssl = { rejectUnauthorized: false };
        url.searchParams.delete("sslmode");
        poolConnectionString = url.toString();
      } else if (sslMode === "verify-full" || sslMode === "verify-ca") {
        ssl = { rejectUnauthorized: true };
      }
    } catch (e) {
      console.warn("Warning: Failed to parse connectionString as URL. Using empty password fallback.", e);
    }
  }

  const pool =
    globalThis.__appPgPool ??
    new pg.Pool({
      connectionString: poolConnectionString || undefined,
      password,
      ssl,
    });
  globalThis.__appPgPool = pool;
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const prisma = globalThis.__appPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__appPrisma = prisma;
}
