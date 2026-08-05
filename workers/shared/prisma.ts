import pg from "pg";
import { PrismaClient } from "../../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

/**
 * Single shared Prisma Client instance for all worker processes.
 * Prisma 7's "prisma-client" generator requires an explicit driver
 * adapter instead of a bare connection string - see
 * .claude/skills/prisma-postgres-setup/references/prisma7-client.md
 *
 * NOTE: as of writing, this repo's .env DATABASE_URL is a
 * `prisma+postgres://...` URL from a local `prisma dev` session, not the
 * `postgresql://postgres:postgres@postgres:5432/blog_agent` URL that
 * docker-compose.yml's `postgres` service expects. Those are two
 * different databases - point DATABASE_URL at whichever Postgres you
 * actually want the workers writing blogs into before running them.
 */
declare global {
  var __workerPgPool: pg.Pool | undefined;
  var __workerPrisma: PrismaClient | undefined;
}

function createClient() {
  let password = "";
  if (env.DATABASE_URL) {
    try {
      password = new URL(env.DATABASE_URL).password || "";
    } catch (e) {
      console.warn("Warning: Failed to parse DATABASE_URL as URL. Using empty password fallback.", e);
    }
  }

  const pool =
    globalThis.__workerPgPool ??
    new pg.Pool({
      connectionString: env.DATABASE_URL || undefined,
      password,
    });
  const adapter = new PrismaPg(pool);
  globalThis.__workerPgPool = pool;
  return new PrismaClient({ adapter });
}

export const prisma = globalThis.__workerPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__workerPrisma = prisma;
}
