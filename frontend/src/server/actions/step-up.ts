"use server";

import { beginPasskeyChallenge, type PublicKeyCredentialRequestOptionsJSON } from "@resumerank/core/auth/mfa/passkeys";
import { reauthenticate, reauthMethods, type ReauthMethods } from "@resumerank/core/auth/step-up";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import { reauthSchema } from "@resumerank/core/validators/step-up";
import { requireRecentAuth, requireUserSession } from "@/lib/auth/guards";
import { runAction } from "@/server/run-action";

export async function getReauthMethodsAction(): Promise<ActionResult<ReauthMethods>> {
  return runAction("getReauthMethods", async () => {
    const { user } = await requireUserSession();
    return actionOk(await reauthMethods(user.id));
  });
}

export async function beginReauthPasskeyAction(): Promise<ActionResult<PublicKeyCredentialRequestOptionsJSON>> {
  return runAction("beginReauthPasskey", async () => {
    const { user } = await requireUserSession();
    return actionOk(await beginPasskeyChallenge(user.id));
  });
}

export async function reauthenticateAction(input: unknown): Promise<ActionResult<{ confirmedAt: Date }>> {
  return runAction("reauthenticate", async () => {
    const parsed = reauthSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const { user, loginId } = await requireUserSession();
    const confirmedAt = await reauthenticate({ userId: user.id, companyId: user.companyId, loginId }, parsed.data);
    return actionOk({ confirmedAt });
  });
}

/** For flows that end in a navigation (exports): confirms first, through the dialog, then the link is followed. */
export async function confirmRecentAuthAction(): Promise<ActionResult<{ confirmed: true }>> {
  return runAction("confirmRecentAuth", async () => {
    await requireUserSession();
    await requireRecentAuth();
    return actionOk({ confirmed: true });
  });
}
