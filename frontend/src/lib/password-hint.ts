import type { PasswordPolicy } from "@resumerank/core/auth/password-policy";

/** What a new password must meet, said under the field that sets one. */
export function passwordHint(policy: PasswordPolicy): string {
  const length = `At least ${policy.minLength} characters`;
  return policy.breachCheck ? `${length}, and not one found in a known data breach.` : `${length}.`;
}
