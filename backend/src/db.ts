import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";
import { log } from "./observability/log";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const SERVERLESS_POOL_MAX = 3;
const DEFAULT_POOL_MAX = 10;

function createClient(): PrismaClient {
  const config = env();
  const serverless = Boolean(config.VERCEL);
  // Each serverless instance holds its own pool, so a big pool per instance
  // multiplies into the database's connection limit; the pooler fans out instead.
  if (serverless && !config.DIRECT_URL) {
    log.warn("db.unpooled_url", {
      hint: "Set DATABASE_URL to the pooled connection string and DIRECT_URL to the direct one.",
    });
  }
  const adapter = new PrismaPg({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX ?? (serverless ? SERVERLESS_POOL_MAX : DEFAULT_POOL_MAX),
    connectionTimeoutMillis: 10_000,
    ...(config.DATABASE_STATEMENT_TIMEOUT_MS > 0
      ? { statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS }
      : {}),
  });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
