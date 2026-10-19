"use server";

import { revalidatePath } from "next/cache";

import { getSignedInSession, requireStaff, requireStaffSession } from "@/lib/auth/guards";
import type { AiBudget } from "@resumerank/core/ai-budget";
import type { FlagOverrideChange } from "@resumerank/core/flags/overrides";
import { setAiBudgetOverride, setSuspension, type SuspensionState } from "@resumerank/core/staff/companies";
import { liftSuppression, setCompanyFlag, signOutMember } from "@resumerank/core/staff/support";
import {
  endSupportSession,
  startSupportSession,
  type StartedSupportSession,
} from "@resumerank/core/staff/support-sessions";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import {
  aiBudgetOverrideSchema,
  liftSuppressionSchema,
  staffFlagOverrideSchema,
  staffMemberActionSchema,
  supportSessionStartSchema,
  suspensionSchema,
} from "@resumerank/core/validators/staff";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";

const INVALID = "Check the highlighted fields.";

function revalidateCompany(companyId: string): void {
  revalidatePath(`/staff/companies/${companyId}`);
  revalidatePath("/staff");
}

export async function staffSetSuspensionAction(input: unknown): Promise<ActionResult<SuspensionState>> {
  return runAction("staffSetSuspension", async () => {
    const parsed = suspensionSchema.safeParse(input);
    if (!parsed.success) return actionError(INVALID, parsed.error.flatten().fieldErrors);
    const actor = await requireStaff("ADMIN", { recentAuth: true });
    const state = await setSuspension(actor, parsed.data);
    revalidateCompany(state.companyId);
    expireTenantReads(state.companyId);
    return actionOk(state);
  });
}

export async function staffSetAiBudgetAction(input: unknown): Promise<ActionResult<AiBudget>> {
  return runAction("staffSetAiBudget", async () => {
    const parsed = aiBudgetOverrideSchema.safeParse(input);
    if (!parsed.success) return actionError(INVALID, parsed.error.flatten().fieldErrors);
    const actor = await requireStaff("ADMIN", { recentAuth: true });
    const budget = await setAiBudgetOverride(actor, parsed.data);
    revalidateCompany(parsed.data.companyId);
    expireTenantReads(parsed.data.companyId);
    return actionOk(budget);
  });
}

export async function staffSetFlagAction(input: unknown): Promise<ActionResult<FlagOverrideChange>> {
  return runAction("staffSetFlag", async () => {
    const parsed = staffFlagOverrideSchema.safeParse(input);
    if (!parsed.success) return actionError(INVALID, parsed.error.flatten().fieldErrors);
    const actor = await requireStaff("ADMIN", { recentAuth: true });
    const change = await setCompanyFlag(actor, parsed.data);
    revalidateCompany(parsed.data.companyId);
    expireTenantReads(parsed.data.companyId);
    return actionOk(change);
  });
}

export async function staffLiftSuppressionAction(input: unknown): Promise<ActionResult<{ lifted: boolean }>> {
  return runAction("staffLiftSuppression", async () => {
    const parsed = liftSuppressionSchema.safeParse(input);
    if (!parsed.success) return actionError(INVALID, parsed.error.flatten().fieldErrors);
    const actor = await requireStaff("SUPPORT");
    const result = await liftSuppression(actor, parsed.data);
    revalidateCompany(parsed.data.companyId);
    return actionOk(result);
  });
}

export async function staffSignOutMemberAction(input: unknown): Promise<ActionResult<{ revoked: number }>> {
  return runAction("staffSignOutMember", async () => {
    const parsed = staffMemberActionSchema.safeParse(input);
    if (!parsed.success) return actionError(INVALID, parsed.error.flatten().fieldErrors);
    const actor = await requireStaff("SUPPORT", { recentAuth: true });
    const result = await signOutMember(actor, parsed.data);
    revalidateCompany(parsed.data.companyId);
    return actionOk(result);
  });
}

export async function staffStartSupportSessionAction(input: unknown): Promise<ActionResult<StartedSupportSession>> {
  return runAction("staffStartSupportSession", async () => {
    const parsed = supportSessionStartSchema.safeParse(input);
    if (!parsed.success) return actionError(INVALID, parsed.error.flatten().fieldErrors);
    const { actor, loginId } = await requireStaffSession("SUPPORT", { recentAuth: true });
    const session = await startSupportSession(actor, loginId, parsed.data);
    revalidateCompany(session.companyId);
    revalidatePath("/", "layout");
    return actionOk(session);
  });
}

/**
 * Ends the support session this sign-in is in. Needs no staff check beyond
 * the session itself: whoever is in one may always leave it.
 */
export async function endSupportSessionAction(): Promise<ActionResult<{ companyId: string | null }>> {
  return runAction("endSupportSession", async () => {
    const { staff, loginId, clientIp } = await getSignedInSession();
    if (!staff) return actionOk({ companyId: null });
    const companyId = await endSupportSession({ userId: staff.userId, email: staff.email, ipAddress: clientIp }, loginId);
    if (companyId) revalidateCompany(companyId);
    revalidatePath("/", "layout");
    return actionOk({ companyId });
  });
}
