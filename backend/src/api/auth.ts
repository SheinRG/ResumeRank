import { db } from "../db";
import type { TenantContext } from "../services/context";
import { isApiScope, type ApiScope } from "../validators/api";
import { parseApiToken, secretMatches } from "./tokens";

export interface ApiPrincipal {
  ctx: TenantContext;
  keyId: string;
  scopes: readonly ApiScope[];
  /** The workspace's IP allowlist; requests from elsewhere are refused, whoever created the key. */
  ipRanges: readonly string[];
  /** Suspended by ResumeRank staff: every request is refused until it's lifted. */
  suspended: boolean;
}

/** Writing `lastUsedAt` on every call would turn each read into a write. */
const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * Resolves a bearer token to the tenant context it acts in, or null for
 * anything that isn't a live key. The key is what names the tenant, so this
 * one read runs on the owner connection, by primary key; everything after
 * it goes through the services under the returned context. The role is the
 * creator's current one in that workspace, read now, so demoting them
 * narrows their keys at once.
 */
export async function authenticateApiKey(token: string, now = new Date()): Promise<ApiPrincipal | null> {
  const parsed = parseApiToken(token);
  if (!parsed) return null;

  const key = await db.apiKey.findUnique({
    where: { id: parsed.id },
    select: {
      id: true,
      companyId: true,
      createdById: true,
      secretHash: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      membership: {
        select: {
          role: true,
          company: { select: { suspendedAt: true, ipAllowlist: { select: { cidr: true } } } },
        },
      },
    },
  });
  if (!key || !secretMatches(parsed.secret, key.secretHash)) return null;
  if (key.revokedAt || (key.expiresAt && key.expiresAt <= now)) return null;

  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db.apiKey.updateMany({ where: { id: key.id, companyId: key.companyId }, data: { lastUsedAt: now } });
  }
  return {
    ctx: { companyId: key.companyId, actorId: key.createdById, role: key.membership.role },
    keyId: key.id,
    scopes: key.scopes.filter(isApiScope),
    ipRanges: key.membership.company.ipAllowlist.map((range) => range.cidr),
    suspended: key.membership.company.suspendedAt !== null,
  };
}
