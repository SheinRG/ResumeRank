import type { Role } from "../validators/enums";

/**
 * Whether this person may only use single sign-on. Owners are exempt so a
 * broken or misconfigured identity provider can't lock a company out of its
 * own workspace — their password is the way back in to fix it.
 */
export function requiresSso(user: { role: Role; ssoEnforced: boolean }): boolean {
  return user.ssoEnforced && user.role !== "OWNER";
}

/** Why an SSO sign-in was refused; the login page explains each one. */
export type SsoDenial = "SsoDomainNotVerified" | "SsoWrongWorkspace" | "SsoAccountMismatch";
