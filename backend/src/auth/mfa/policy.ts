/**
 * Where a session stands on two-factor authentication:
 * - `pass`: nothing more to ask;
 * - `challenge`: the user has a second factor this sign-in hasn't proven yet;
 * - `setup`: the company requires one and the user has none.
 */
export type MfaGate = "pass" | "challenge" | "setup";

export interface MfaGateInput {
  /** Single sign-on sessions are exempt: the identity provider owns MFA there. */
  viaSso: boolean;
  /** `User.mfaEnabledAt`. */
  enabledAt: Date | null;
  /** The epoch this session last verified against, if any. */
  verifiedEpoch: number | null;
  /** `Company.mfaRequired`. */
  required: boolean;
}

/**
 * A session is verified only against the current epoch, so turning MFA off
 * and on again, or an admin reset, sends every session back to the challenge.
 */
export function mfaGate({ viaSso, enabledAt, verifiedEpoch, required }: MfaGateInput): MfaGate {
  if (viaSso) return "pass";
  if (enabledAt) return verifiedEpoch === enabledAt.getTime() ? "pass" : "challenge";
  return required ? "setup" : "pass";
}
