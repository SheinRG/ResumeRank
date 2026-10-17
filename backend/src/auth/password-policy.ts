import { db } from "../db";
import { DomainError } from "../services/errors";
import { MIN_PASSWORD_LENGTH } from "../validators/auth";
import { pwnedPasswordsLookup, type BreachLookup } from "./breached-password";

/**
 * What a password must meet. Following NIST SP 800-63B: a minimum length and
 * a breached-password check, and no composition rules or forced rotation,
 * which push people toward predictable passwords.
 */
export interface PasswordPolicy {
  minLength: number;
  breachCheck: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = { minLength: MIN_PASSWORD_LENGTH, breachCheck: false };

export const PASSWORD_POLICY_SELECT = { passwordMinLength: true, passwordBreachCheck: true } as const;

export function passwordPolicyOf(company: { passwordMinLength: number; passwordBreachCheck: boolean }): PasswordPolicy {
  return { minLength: company.passwordMinLength, breachCheck: company.passwordBreachCheck };
}

/** One password serves every workspace a person is in, so it has to satisfy all of them. */
export function strictestPolicy(policies: readonly PasswordPolicy[]): PasswordPolicy {
  return policies.reduce(
    (strictest, policy) => ({
      minLength: Math.max(strictest.minLength, policy.minLength),
      breachCheck: strictest.breachCheck || policy.breachCheck,
    }),
    DEFAULT_PASSWORD_POLICY,
  );
}

/** The policy for this account's password: the strictest among its workspaces. */
export async function accountPasswordPolicy(userId: string): Promise<PasswordPolicy> {
  const memberships = await db.membership.findMany({
    where: { userId },
    select: { company: { select: PASSWORD_POLICY_SELECT } },
  });
  return strictestPolicy(memberships.map((membership) => passwordPolicyOf(membership.company)));
}

/** For an account about to be created in this company (accepting an invite). */
export async function companyPasswordPolicy(companyId: string): Promise<PasswordPolicy> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: PASSWORD_POLICY_SELECT });
  return company ? strictestPolicy([passwordPolicyOf(company)]) : DEFAULT_PASSWORD_POLICY;
}

/**
 * Why the password falls short of the policy, or null when it doesn't. If
 * the breach service can't be reached the password passes: an outage there
 * mustn't stop anyone from setting or using a password.
 */
export async function passwordShortfall(
  password: string,
  policy: PasswordPolicy,
  lookup: BreachLookup = pwnedPasswordsLookup,
): Promise<string | null> {
  if (password.length < policy.minLength) {
    return `Your workspace requires passwords of at least ${policy.minLength} characters.`;
  }
  if (policy.breachCheck && (await lookup(password)) === true) {
    return "This password appears in a known data breach, so it's easy to guess. Choose a different one.";
  }
  return null;
}

/** Throws the shortfall as a field error on `field`, for the form that set the password. */
export async function assertPasswordAllowed(
  password: string,
  policy: PasswordPolicy,
  field: string,
  lookup: BreachLookup = pwnedPasswordsLookup,
): Promise<void> {
  const shortfall = await passwordShortfall(password, policy, lookup);
  if (shortfall) throw new DomainError(shortfall, { [field]: [shortfall] });
}
