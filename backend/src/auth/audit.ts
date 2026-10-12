import { db } from "../db";
import { logActivity, type ActivityWriter } from "../activity";
import type { Prisma } from "../generated/prisma/client";
import type { SignInMethod } from "../generated/prisma/enums";

/** Sign-in events. Only admins see them in the activity feed (they carry IP addresses). */
export type AuthAction =
  | "auth.sign_in"
  | "auth.sign_in_failed"
  | "auth.sign_in_refused"
  | "auth.sign_out"
  | "auth.mfa_passed"
  | "auth.mfa_failed";

export const AUTH_ACTION_PREFIX = "auth.";

export interface AuthEvent {
  userId: string;
  action: AuthAction;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}

interface AuthAuditClient extends ActivityWriter {
  user: { findUnique(args: { where: { id: string }; select: { companyId: true } }): PromiseLike<{ companyId: string | null } | null> };
}

/**
 * Records a sign-in event in the user's company trail. Someone without a
 * company (mid-onboarding) has no trail, so their events are only logged.
 */
export async function logAuthEvent(event: AuthEvent, client: AuthAuditClient = db): Promise<void> {
  const user = await client.user.findUnique({ where: { id: event.userId }, select: { companyId: true } });
  if (!user?.companyId) return;
  await logActivity(
    {
      companyId: user.companyId,
      actorId: event.userId,
      action: event.action,
      entityType: "user",
      entityId: event.userId,
      summary: event.summary,
      ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    },
    client,
  );
}

const METHOD_LABELS: Record<SignInMethod, string> = {
  PASSWORD: "a password",
  GOOGLE: "Google",
  SSO: "single sign-on",
};

export function signInMethodLabel(method: SignInMethod): string {
  return METHOD_LABELS[method];
}
