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

/** Append-only: rows are only ever inserted, never updated or deleted. */
export async function logActivity(input: ActivityInput): Promise<void> {
  await db.activityLog.create({ data: input });
}
