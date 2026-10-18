import { tenantTransaction } from "../tenant-db";
import { logActivity } from "../activity";
import { CANDIDATE_REF } from "../audit/candidate-ref";
import type { Scorecard } from "../generated/prisma/client";
import type { ScorecardInput } from "../validators/application";
import { assertCan, type TenantContext } from "./context";
import { applicationAccessWhere } from "./access";
import { NotFoundError } from "./errors";

/** The reviewer is always the acting user — a caller-supplied reviewer would let anyone rate as someone else. */
export async function upsertScorecard(
  ctx: TenantContext,
  input: ScorecardInput,
): Promise<Scorecard> {
  assertCan(ctx, "scorecard.submit");
  const { applicationId, rating, notes } = input;

  return tenantTransaction(ctx, async (tx) => {
    const application = await tx.application.findFirst({
      where: { id: applicationId, companyId: ctx.companyId, deletedAt: null, ...applicationAccessWhere(ctx) },
      select: { id: true, candidateId: true },
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
        summary: `rated ${CANDIDATE_REF} ${rating}/5`,
        metadata: { candidateId: application.candidateId },
      },
      tx,
    );
    return scorecard;
  });
}
