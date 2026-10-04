import { tenantDb } from "../tenant-db";
import { logActivity } from "../activity";
import type { Scorecard } from "../generated/prisma/client";
import type { ScorecardInput } from "../validators/application";
import { assertCanWrite, type TenantContext } from "./context";
import { NotFoundError } from "./errors";

/** The reviewer is always the acting user — a caller-supplied reviewer would let anyone rate as someone else. */
export async function upsertScorecard(
  ctx: TenantContext,
  input: ScorecardInput,
): Promise<Scorecard> {
  assertCanWrite(ctx);
  const { applicationId, rating, notes } = input;

  return tenantDb(ctx).$transaction(async (tx) => {
    const application = await tx.application.findUnique({
      where: { id: applicationId, companyId: ctx.companyId, deletedAt: null },
      select: { id: true, candidate: { select: { name: true } } },
    });
    if (!application) throw new NotFoundError("This application no longer exists.");

    const scorecard = await tx.scorecard.upsert({
      where: { applicationId_reviewerId: { applicationId, reviewerId: ctx.actorId } },
      create: { applicationId, reviewerId: ctx.actorId, rating, notes },
      update: { rating, notes },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "scorecard.upsert",
        entityType: "application",
        entityId: applicationId,
        summary: `rated ${application.candidate.name} ${rating}/5`,
      },
      tx,
    );
    return scorecard;
  });
}
