import { requiresSso } from "../sso/policy";
import type { Role } from "../validators/enums";

/**
 * Which of a user's workspaces a sign-in may open, and which one it has open.
 * Pure, so the guards and sign-in share one set of rules; the database side
 * lives in `auth/workspaces.ts`.
 */

/** What deciding where a sign-in may go needs to know about a membership. */
export interface WorkspaceAccess {
  companyId: string;
  role: Role;
  ssoEnforced: boolean;
}

/**
 * Whether this sign-in may open the workspace. Where the company requires
 * single sign-on, only a sign-in its own identity provider vouched for will
 * do: another company's IdP says nothing about this one's policy.
 */
export function signInMayOpen(workspace: WorkspaceAccess, ssoCompanyId: string | null): boolean {
  return !requiresSso(workspace) || ssoCompanyId === workspace.companyId;
}

/**
 * Where a new sign-in lands: the company whose IdP it came through, else the
 * workspace the user last had open, else their oldest one, considering only
 * those it may open. Memberships are expected oldest first.
 */
export function landingWorkspace<T extends WorkspaceAccess>(
  memberships: readonly T[],
  { preferred, ssoCompanyId }: { preferred: string | null; ssoCompanyId: string | null },
): T | null {
  const openable = memberships.filter((membership) => signInMayOpen(membership, ssoCompanyId));
  return (
    openable.find((membership) => membership.companyId === ssoCompanyId) ??
    openable.find((membership) => membership.companyId === preferred) ??
    openable[0] ??
    null
  );
}

/**
 * The workspace a request runs in: the one this sign-in has open, while the
 * user still belongs to it, else wherever a fresh sign-in would land. The
 * open one is kept even if it now requires SSO, so the guards can end the
 * session as they would for any company that turns enforcement on.
 */
export function resolveWorkspace<T extends WorkspaceAccess>(
  memberships: readonly T[],
  { opened, preferred, ssoCompanyId }: { opened: string | null; preferred: string | null; ssoCompanyId: string | null },
): T | null {
  return (
    memberships.find((membership) => membership.companyId === opened) ??
    landingWorkspace(memberships, { preferred, ssoCompanyId })
  );
}
