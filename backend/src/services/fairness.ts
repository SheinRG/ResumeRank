import { createHmac, timingSafeEqual } from "node:crypto";

import { logActivity } from "../activity";
import { CANDIDATE_REF } from "../audit/candidate-ref";
import { db } from "../db";
import { env } from "../env";
import { impactReport, type ImpactReport } from "../fairness/impact";
import { subkey } from "../sealed-box";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { ImpactReportInput, SelfIdInput } from "../validators/compliance";
import { applicationAccessWhere } from "./access";
import { assertCan, assertCanAdmin, type TenantContext } from "./context";
import { NotFoundError } from "./errors";

/**
 * Voluntary self-identification for bias audits. Answers are kept apart from
 * everything scoring and recruiting read: no page shows one person's answers,
 * and the only reader is the aggregate impact report for admins.
 */

const KEY_INFO = "resumerank/self-id/v1";
const SIGNATURE_LENGTH = 32;

function signature(applicationId: string): string {
  return createHmac("sha256", subkey(env().AUTH_SECRET, KEY_INFO))
    .update(applicationId)
    .digest("base64url")
    .slice(0, SIGNATURE_LENGTH);
}

/** `<applicationId>.<signature>`: the link proves which application it's for without a stored token. */
export function selfIdToken(applicationId: string): string {
  return `${applicationId}.${signature(applicationId)}`;
}

function applicationIdOf(token: string): string | null {
  const [applicationId, given, ...rest] = token.split(".");
  if (!applicationId || !given || rest.length > 0) return null;
  const expected = Buffer.from(signature(applicationId));
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? applicationId : null;
}

/** For a recruiter to send to the candidate. */
export async function getSelfIdLinkToken(ctx: TenantContext, applicationId: string): Promise<string> {
  assertCan(ctx, "application.manage");
  const application = await tenantDb(ctx).application.findFirst({
    where: { id: applicationId, companyId: ctx.companyId, deletedAt: null, ...applicationAccessWhere(ctx) },
    select: { id: true },
  });
  if (!application) throw new NotFoundError("This application no longer exists.");
  return selfIdToken(application.id);
}

export interface SelfIdInvite {
  companyName: string;
  jobTitle: string;
  answered: boolean;
}

interface ResolvedInvite extends SelfIdInvite {
  applicationId: string;
  companyId: string;
  candidateId: string;
}

/**
 * Read on the owner connection: the link is the only credential, and the
 * tenant isn't known until it's checked.
 */
async function resolve(token: string): Promise<ResolvedInvite | null> {
  const applicationId = applicationIdOf(token);
  if (!applicationId) return null;
  const application = await db.application.findUnique({
    where: { id: applicationId },
    select: {
      companyId: true,
      candidateId: true,
      deletedAt: true,
      job: { select: { title: true } },
      company: { select: { name: true } },
      selfId: { select: { id: true } },
    },
  });
  if (!application || application.deletedAt) return null;
  return {
    applicationId,
    companyId: application.companyId,
    candidateId: application.candidateId,
    companyName: application.company.name,
    jobTitle: application.job.title,
    answered: application.selfId !== null,
  };
}

export async function getSelfIdInvite(token: string): Promise<SelfIdInvite | null> {
  const invite = await resolve(token);
  return invite ? { companyName: invite.companyName, jobTitle: invite.jobTitle, answered: invite.answered } : null;
}

/** Answering again replaces the earlier answers. The audit entry records that an answer was given, never what it was. */
export async function submitSelfId(input: SelfIdInput): Promise<void> {
  const invite = await resolve(input.token);
  if (!invite) throw new NotFoundError("This link is no longer valid. Ask the recruiter for a new one.");
  const answers = {
    sex: input.sex === "DECLINED" ? null : input.sex,
    race: input.race === "DECLINED" ? null : input.race,
  };

  await tenantTransaction({ companyId: invite.companyId }, async (tx) => {
    await tx.selfIdResponse.upsert({
      where: { applicationId: invite.applicationId },
      create: { companyId: invite.companyId, applicationId: invite.applicationId, ...answers },
      update: { ...answers, submittedAt: new Date() },
    });
    await logActivity(
      {
        companyId: invite.companyId,
        actorId: null,
        action: "application.self_id",
        entityType: "application",
        entityId: invite.applicationId,
        summary: `${CANDIDATE_REF} answered the voluntary self-identification form`,
        metadata: { candidateId: invite.candidateId },
      },
      tx,
    );
  });
}

export interface ImpactReportView extends ImpactReport {
  jobTitle: string | null;
  generatedAt: Date;
}

export async function getImpactReport(ctx: TenantContext, input: ImpactReportInput): Promise<ImpactReportView> {
  assertCanAdmin(ctx);
  let jobTitle: string | null = null;
  if (input.jobId) {
    const job = await tenantDb(ctx).job.findFirst({
      where: { id: input.jobId, companyId: ctx.companyId },
      select: { title: true },
    });
    if (!job) throw new NotFoundError("This job no longer exists.");
    jobTitle = job.title;
  }

  const applications = await tenantDb(ctx).application.findMany({
    where: { companyId: ctx.companyId, deletedAt: null, ...(input.jobId ? { jobId: input.jobId } : {}) },
    select: { stage: true, aiScore: true, selfId: { select: { sex: true, race: true } } },
  });
  const report = impactReport(
    applications.map((application) => ({
      stage: application.stage,
      aiScore: application.aiScore,
      sex: application.selfId?.sex ?? null,
      race: application.selfId?.race ?? null,
    })),
  );
  return { ...report, jobTitle, generatedAt: new Date() };
}
