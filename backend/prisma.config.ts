import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

// The repo keeps a single .env at the root; Prisma commands run with the
// backend workspace as cwd, so load it from one level up.
config({ path: resolve(process.cwd(), "../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Migrations need a session-level connection (advisory locks, DDL), which a
  // transaction-mode pooler can't give; DIRECT_URL bypasses it when set.
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
