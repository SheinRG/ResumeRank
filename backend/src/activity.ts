import { db } from "./db";
import type { Prisma } from "./generated/prisma/client";

interface ActivityInput {
  companyId: string;
  actorId: string;
  action: string;
  entityType: "job" | "candidate" | "application" | "user";
  entityId: string;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Only the delegate this needs, so both the base client and a tenant-scoped
 * (extended) client — and their transactions — can be passed in.
 */
export interface ActivityWriter {
  activityLog: { create(args: { data: ActivityInput }): PromiseLike<unknown> };
}

/**
 * Append-only: rows are only ever inserted, never updated or deleted. Pass
 * the mutation's transaction client so the write and its audit row commit
 * or roll back together — an unaudited mutation is worse than a failed one.
 */
export async function logActivity(
  input: ActivityInput,
  client: ActivityWriter = db,
): Promise<void> {
  await client.activityLog.create({ data: input });
}
