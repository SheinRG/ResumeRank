import { logActivity } from "../activity";
import { CANDIDATE_REF } from "../audit/candidate-ref";
import { db } from "../db";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { AiPolicyInput, CandidateAiFlagsInput } from "../validators/compliance";
import { assertCan, assertCanAdmin, type TenantContext } from "./context";
import { NotFoundError } from "./errors";
import { isPrismaError } from "./prisma-errors";

export interface AiPolicy {
  aiRedactPii: boolean;
  aiNoticeRequired: boolean;
  /** The company's own wording, or null for the default notice. */
  aiNoticeText: string | null;
  /** Where candidates can read the notice: `/ai-notice/<slug>`. */
  slug: string;
}

const AI_POLICY_SELECT = { aiRedactPii: true, aiNoticeRequired: true, aiNoticeText: true, slug: true } as const;

export async function getAiPolicy(ctx: TenantContext): Promise<AiPolicy> {
  assertCanAdmin(ctx);
  const company = await tenantDb(ctx).company.findUnique({ where: { id: ctx.companyId }, select: AI_POLICY_SELECT });
  if (!company) throw new NotFoundError("Your company no longer exists.");
  return company;
}

/** Applies to runs scored from now on; finished runs keep the inputs they were scored on. */
export async function updateAiPolicy(ctx: TenantContext, input: AiPolicyInput): Promise<AiPolicy> {
  assertCanAdmin(ctx);
  return tenantTransaction(ctx, async (tx) => {
    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: input,
      select: AI_POLICY_SELECT,
    });
    const changes = [
      input.aiRedactPii ? "personal details hidden from the AI" : "personal details visible to the AI",
      input.aiNoticeRequired ? "AI notice required before scoring" : "AI notice optional",
      input.aiNoticeText ? "a custom notice" : "the default notice",
    ];
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "company.ai_policy",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `set the AI policy: ${changes.join(", ")}`,
        metadata: {
          aiRedactPii: input.aiRedactPii,
          aiNoticeRequired: input.aiNoticeRequired,
          customNotice: input.aiNoticeText !== null,
        },
      },
      tx,
    );
    return company;
  });
}

export interface CandidateAiFlags {
  id: string;
  aiNoticeAt: Date | null;
  aiOptOutAt: Date | null;
}

/**
 * Records the notice and the opt-out as facts with dates. A flag that is
 * already set keeps its original date, so re-saving never moves when the
 * candidate was told or when they opted out.
 */
export async function setCandidateAiFlags(ctx: TenantContext, input: CandidateAiFlagsInput): Promise<CandidateAiFlags> {
  assertCan(ctx, "candidate.manage");
  const now = new Date();

  try {
    return await tenantTransaction(ctx, async (tx) => {
      const current = await tx.candidate.findUnique({
        where: { id: input.id, companyId: ctx.companyId },
        select: { aiNoticeAt: true, aiOptOutAt: true },
      });
      if (!current) throw new NotFoundError("This candidate no longer exists.");

      const next = {
        aiNoticeAt: input.noticeGiven ? (current.aiNoticeAt ?? now) : null,
        aiOptOutAt: input.optedOut ? (current.aiOptOutAt ?? now) : null,
      };
      const candidate = await tx.candidate.update({
        where: { id: input.id, companyId: ctx.companyId },
        data: next,
        select: { id: true, aiNoticeAt: true, aiOptOutAt: true },
      });

      const events: Array<[string, string]> = [];
      if (!current.aiNoticeAt && next.aiNoticeAt) events.push(["candidate.ai_notice", `recorded that ${CANDIDATE_REF} was given the AI notice`]);
      if (current.aiNoticeAt && !next.aiNoticeAt) events.push(["candidate.ai_notice_cleared", `cleared the AI notice record for ${CANDIDATE_REF}`]);
      if (!current.aiOptOutAt && next.aiOptOutAt) events.push(["candidate.ai_opt_out", `recorded that ${CANDIDATE_REF} opted out of AI scoring`]);
      if (current.aiOptOutAt && !next.aiOptOutAt) events.push(["candidate.ai_opt_in", `recorded that ${CANDIDATE_REF} withdrew their AI opt-out`]);
      for (const [action, summary] of events) {
        await logActivity(
          {
            companyId: ctx.companyId,
            actorId: ctx.actorId,
            action,
            entityType: "candidate",
            entityId: candidate.id,
            summary,
            metadata: { candidateId: candidate.id },
          },
          tx,
        );
      }
      return candidate;
    });
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw new NotFoundError("This candidate no longer exists.");
    throw error;
  }
}

export interface PublicAiNotice {
  companyName: string;
  /** The company's own words, shown above the standard details; null when it uses only the default. */
  customText: string | null;
  noticeRequired: boolean;
  redactsPii: boolean;
}

/**
 * Public: the notice a company points candidates to. Company settings, not
 * tenant data, so it is read by the slug on the owner connection.
 */
export async function getPublicAiNotice(slug: string): Promise<PublicAiNotice | null> {
  const company = await db.company.findUnique({
    where: { slug },
    select: { name: true, aiNoticeText: true, aiNoticeRequired: true, aiRedactPii: true },
  });
  if (!company) return null;
  return {
    companyName: company.name,
    customText: company.aiNoticeText,
    noticeRequired: company.aiNoticeRequired,
    redactsPii: company.aiRedactPii,
  };
}
