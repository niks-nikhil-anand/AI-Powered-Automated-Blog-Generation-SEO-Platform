import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

declare global {
  var __appPgPool: pg.Pool | undefined;
  var __appPrisma: PrismaClient | undefined;
}

function createClient() {
  const connectionString = process.env.DATABASE_URL ?? "";
  let password = "";
  if (connectionString) {
    try {
      password = new URL(connectionString).password || "";
    } catch (e) {
      console.warn("Warning: Failed to parse connectionString as URL. Using empty password fallback.", e);
    }
  }

  const pool =
    globalThis.__appPgPool ??
    new pg.Pool({
      connectionString: connectionString || undefined,
      password,
    });
  globalThis.__appPgPool = pool;
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const prisma = globalThis.__appPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__appPrisma = prisma;
}
