"use server";

import { revalidatePath } from "next/cache";
import { refreshSession } from "@/lib/auth";
import {
  requireAdmin,
  requireMfaChallenge,
  requireMfaEnrollment,
  requireUser,
  tenantContext,
  type CurrentUser,
} from "@/lib/auth/guards";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  removeTotp,
  verifyTotpChallenge,
  type TotpEnrollment,
} from "@resumerank/core/auth/mfa/authenticator-app";
import { regenerateRecoveryCodes, verifyRecoveryCode } from "@resumerank/core/auth/mfa/factors";
import {
  beginPasskeyChallenge,
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  removePasskey,
  verifyPasskeyChallenge,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@resumerank/core/auth/mfa/passkeys";
import { mintMfaProof } from "@resumerank/core/auth/mfa/proof";
import type { MfaActor } from "@resumerank/core/auth/mfa/state";
import { resetMemberMfa, setMfaRequired, type MfaPolicy } from "@resumerank/core/services/mfa";
import type { TeamMember } from "@resumerank/core/services/team";
import {
  confirmTotpSchema,
  finishPasskeyRegistrationSchema,
  mfaCodeChallengeSchema,
  passkeyChallengeSchema,
  passkeyIdSchema,
  resetMemberMfaSchema,
  setMfaRequiredSchema,
} from "@resumerank/core/validators/mfa";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

const SECURITY_PATH = "/settings/security";

/** What a newly added factor reports back: recovery codes only when it turned MFA on. */
interface FactorAddedResult {
  recoveryCodes: string[] | null;
}

function mfaActor(user: CurrentUser): MfaActor {
  return { userId: user.id, companyId: user.companyId };
}

/**
 * Marks this sign-in as having proven its second factor. The jwt callback
 * accepts the flag only with a proof signed for this sign-in and epoch.
 */
async function markSessionVerified(loginId: string, epoch: number): Promise<void> {
  await refreshSession({ mfaProof: mintMfaProof(loginId, epoch) });
}

function afterFactorChange(user: CurrentUser): void {
  revalidatePath(SECURITY_PATH);
  revalidatePath("/settings/team");
  expireTenantReads(user.companyId);
}

export async function beginTotpEnrollmentAction(): Promise<ActionResult<TotpEnrollment>> {
  return runAction("beginTotpEnrollment", async () => {
    const { user } = await requireMfaEnrollment();
    return actionOk(await beginTotpEnrollment(mfaActor(user)));
  });
}

export async function confirmTotpEnrollmentAction(input: unknown): Promise<ActionResult<FactorAddedResult>> {
  return runAction("confirmTotpEnrollment", async () => {
    const parsed = confirmTotpSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const { user, loginId } = await requireMfaEnrollment();
    const added = await confirmTotpEnrollment(mfaActor(user), parsed.data);
    await markSessionVerified(loginId, added.epoch);
    afterFactorChange(user);
    return actionOk({ recoveryCodes: added.recoveryCodes });
  });
}

export async function removeTotpAction(): Promise<ActionResult<{ enabledAt: Date | null }>> {
  return runAction("removeTotp", async () => {
    const user = await requireUser();
    const state = await removeTotp(mfaActor(user));
    afterFactorChange(user);
    return actionOk(state);
  });
}

export async function beginPasskeyRegistrationAction(): Promise<
  ActionResult<PublicKeyCredentialCreationOptionsJSON>
> {
  return runAction("beginPasskeyRegistration", async () => {
    const { user } = await requireMfaEnrollment();
    return actionOk(await beginPasskeyRegistration(mfaActor(user)));
  });
}

export async function finishPasskeyRegistrationAction(
  input: unknown,
): Promise<ActionResult<FactorAddedResult>> {
  return runAction("finishPasskeyRegistration", async () => {
    const parsed = finishPasskeyRegistrationSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const { user, loginId } = await requireMfaEnrollment();
    const added = await finishPasskeyRegistration(mfaActor(user), parsed.data);
    await markSessionVerified(loginId, added.epoch);
    afterFactorChange(user);
    return actionOk({ recoveryCodes: added.recoveryCodes });
  });
}

export async function removePasskeyAction(
  input: unknown,
): Promise<ActionResult<{ id: string; enabledAt: Date | null }>> {
  return runAction("removePasskey", async () => {
    const parsed = passkeyIdSchema.safeParse(input);
    if (!parsed.success) return actionError("That passkey no longer exists.");
    const user = await requireUser();
    const removed = await removePasskey(mfaActor(user), parsed.data);
    afterFactorChange(user);
    return actionOk(removed);
  });
}

export async function regenerateRecoveryCodesAction(): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runAction("regenerateRecoveryCodes", async () => {
    const user = await requireUser();
    const result = await regenerateRecoveryCodes(mfaActor(user));
    afterFactorChange(user);
    return actionOk(result);
  });
}

export async function verifyMfaCodeAction(
  input: unknown,
): Promise<ActionResult<{ recoveryCodesRemaining: number | null }>> {
  return runAction("verifyMfaCode", async () => {
    const parsed = mfaCodeChallengeSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const { user, loginId } = await requireMfaChallenge();
    const actor = mfaActor(user);
    if (parsed.data.method === "totp") {
      const verified = await verifyTotpChallenge(actor, parsed.data.code);
      await markSessionVerified(loginId, verified.epoch);
      return actionOk({ recoveryCodesRemaining: null });
    }
    const verified = await verifyRecoveryCode(actor, parsed.data.code);
    await markSessionVerified(loginId, verified.epoch);
    expireTenantReads(user.companyId);
    return actionOk({ recoveryCodesRemaining: verified.remaining });
  });
}

export async function beginPasskeyChallengeAction(): Promise<
  ActionResult<PublicKeyCredentialRequestOptionsJSON>
> {
  return runAction("beginPasskeyChallenge", async () => {
    const { user } = await requireMfaChallenge();
    return actionOk(await beginPasskeyChallenge(user.id));
  });
}

export async function verifyPasskeyChallengeAction(input: unknown): Promise<ActionResult<{ verified: true }>> {
  return runAction("verifyPasskeyChallenge", async () => {
    const parsed = passkeyChallengeSchema.safeParse(input);
    if (!parsed.success) return actionError("Your browser sent an unexpected passkey response. Try again.");
    const { user, loginId } = await requireMfaChallenge();
    const verified = await verifyPasskeyChallenge(mfaActor(user), parsed.data);
    await markSessionVerified(loginId, verified.epoch);
    return actionOk({ verified: true });
  });
}

export async function setMfaRequiredAction(input: unknown): Promise<ActionResult<MfaPolicy>> {
  return runAction("setMfaRequired", async () => {
    const parsed = setMfaRequiredSchema.safeParse(input);
    if (!parsed.success) return actionError("Choose whether to require two-factor authentication.");
    const admin = await requireAdmin();
    const policy = await setMfaRequired(tenantContext(admin), parsed.data);
    revalidatePath(SECURITY_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(policy);
  });
}

export async function resetMemberMfaAction(input: unknown): Promise<ActionResult<TeamMember>> {
  return runAction("resetMemberMfa", async () => {
    const parsed = resetMemberMfaSchema.safeParse(input);
    if (!parsed.success) return actionError("That user no longer exists.");
    const admin = await requireAdmin();
    const member = await resetMemberMfa(tenantContext(admin), parsed.data);
    revalidatePath("/settings/team");
    revalidatePath(SECURITY_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(member);
  });
}
