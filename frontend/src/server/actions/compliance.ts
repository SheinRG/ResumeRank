"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireAdmin, requireCan, requireRecentAuth, tenantContext } from "@/lib/auth/guards";
import { siteUrl } from "@/lib/site";
import { rateLimit, SELF_ID_LIMIT } from "@resumerank/core/rate-limit";
import { clientIp } from "@resumerank/core/request-ip";
import { setCandidateAiFlags, updateAiPolicy, type AiPolicy, type CandidateAiFlags } from "@resumerank/core/services/compliance";
import { setCandidateRetention, type CandidateRetention } from "@resumerank/core/services/data-rights";
import { getSelfIdLinkToken, submitSelfId } from "@resumerank/core/services/fairness";
import { deleteWorkspace } from "@resumerank/core/services/offboarding";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import {
  aiPolicySchema,
  candidateAiFlagsSchema,
  candidateRetentionSchema,
  deleteWorkspaceSchema,
  selfIdSchema,
} from "@resumerank/core/validators/compliance";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";

export async function updateAiPolicyAction(input: unknown): Promise<ActionResult<AiPolicy>> {
  return runAction("updateAiPolicy", async () => {
    const parsed = aiPolicySchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    await requireRecentAuth();
    const policy = await updateAiPolicy(tenantContext(admin), parsed.data);
    revalidatePath("/settings/compliance");
    expireTenantReads(admin.companyId);
    return actionOk(policy);
  });
}

export async function setCandidateAiFlagsAction(input: unknown): Promise<ActionResult<CandidateAiFlags>> {
  return runAction("setCandidateAiFlags", async () => {
    const parsed = candidateAiFlagsSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireCan("candidate.manage");
    const flags = await setCandidateAiFlags(tenantContext(user), parsed.data);
    revalidatePath(`/candidates/${flags.id}`);
    expireTenantReads(user.companyId);
    return actionOk(flags);
  });
}

export async function getSelfIdLinkAction(applicationId: unknown): Promise<ActionResult<{ url: string }>> {
  return runAction("getSelfIdLink", async () => {
    if (typeof applicationId !== "string" || applicationId.length === 0) {
      return actionError("This application no longer exists.");
    }
    const user = await requireCan("application.manage");
    const token = await getSelfIdLinkToken(tenantContext(user), applicationId);
    return actionOk({ url: `${siteUrl()}/self-id/${token}` });
  });
}

/** Public: the signed link is the only credential, so attempts are limited per IP. */
export async function submitSelfIdAction(input: unknown): Promise<ActionResult<{ saved: true }>> {
  return runAction("submitSelfId", async () => {
    const parsed = selfIdSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Choose an answer for each question, or “Prefer not to say”.", parsed.error.flatten().fieldErrors);
    }
    const limited = await rateLimit(`self-id:${clientIp(await headers())}`, SELF_ID_LIMIT);
    if (!limited.allowed) return actionError("Too many attempts. Try again in a few minutes.");
    await submitSelfId(parsed.data);
    return actionOk({ saved: true });
  });
}

export async function setCandidateRetentionAction(input: unknown): Promise<ActionResult<CandidateRetention>> {
  return runAction("setCandidateRetention", async () => {
    const parsed = candidateRetentionSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    await requireRecentAuth();
    const retention = await setCandidateRetention(tenantContext(admin), parsed.data);
    revalidatePath("/settings/compliance");
    return actionOk(retention);
  });
}

/** The workspace is gone afterwards, so the client sends the person on to onboarding. */
export async function deleteWorkspaceAction(input: unknown): Promise<ActionResult<{ deleted: true }>> {
  return runAction("deleteWorkspace", async () => {
    const parsed = deleteWorkspaceSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    await requireRecentAuth();
    const result = await deleteWorkspace(tenantContext(admin), parsed.data);
    expireTenantReads(admin.companyId);
    return actionOk(result);
  });
}
