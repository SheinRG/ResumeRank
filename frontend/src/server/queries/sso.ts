import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as directorySync from "@resumerank/core/services/directory-sync";
import * as sso from "@resumerank/core/services/sso";

export type { SsoConnectionSummary, SsoDomain, SsoSettings } from "@resumerank/core/services/sso";
export type { DirectoryCredentials, DirectorySummary } from "@resumerank/core/services/directory-sync";

export async function getSsoSettings(): Promise<sso.SsoSettings> {
  const user = await requireMember();
  return sso.getSsoSettings(tenantContext(user));
}

export async function getSsoEnforcement(): Promise<{ enforced: boolean }> {
  const user = await requireMember();
  return sso.getSsoEnforcement(tenantContext(user));
}

export async function getDirectory(): Promise<directorySync.DirectorySummary | null> {
  const user = await requireMember();
  return directorySync.getDirectory(tenantContext(user));
}
