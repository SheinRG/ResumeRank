import { db } from "../db";
import { logActivity } from "../activity";
import { isPrismaError } from "../services/prisma-errors";
import { emailDomain } from "./domains";
import { SSO_PRODUCT, ssoControllers } from "./jackson";
import type { SsoDenial } from "./policy";

/**
 * Sign-in runs before there is a tenant: these lookups find *which* company
 * an address belongs to, so they read across companies on the owner
 * connection, the same way a password login looks a user up by email.
 */

/** The company whose verified domain and live SSO connection cover this address, if any. */
export async function findSsoTenant(email: string): Promise<{ companyId: string } | null> {
  const domain = emailDomain(email);
  if (!domain) return null;

  const claim = await db.companyDomain.findFirst({
    where: { domain, verifiedAt: { not: null } },
    select: { companyId: true },
  });
  if (!claim) return null;

  const { connectionAPIController } = await ssoControllers();
  const connections = await connectionAPIController.getConnections({
    tenant: claim.companyId,
    product: SSO_PRODUCT,
  });
  return connections.some((connection) => !connection.deactivated)
    ? { companyId: claim.companyId }
    : null;
}

export interface SsoSignInInput {
  /** The tenant the login was started for, as Jackson recorded it. */
  tenant: string;
  /** The address the identity provider asserted. */
  email: string;
  name: string;
  /** The user Auth.js already matched through a linked SSO account, if any. */
  linkedUserId: string | null;
}

export type SsoSignInResult =
  | { ok: true; joinedCompanyId: string | null }
  | { ok: false; reason: SsoDenial };

/**
 * Decides whether an identity provider's assertion may sign someone in, and
 * prepares their account before Auth.js links it.
 *
 * A company's IdP may only vouch for addresses on a domain that company has
 * verified: otherwise any tenant could configure an IdP that asserts someone
 * else's email and take over their account. People already in another
 * workspace are refused rather than moved. New people are created here (not
 * by Auth.js) so that, on an auto-join domain, they land in the company in
 * the same step.
 */
export async function resolveSsoSignIn(input: SsoSignInInput): Promise<SsoSignInResult> {
  const email = input.email.trim().toLowerCase();
  const domain = emailDomain(email);
  if (!domain) return { ok: false, reason: "SsoDomainNotVerified" };

  const claim = await db.companyDomain.findFirst({
    where: { companyId: input.tenant, domain, verifiedAt: { not: null } },
    select: { autoJoin: true },
  });
  if (!claim) return { ok: false, reason: "SsoDomainNotVerified" };

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, companyId: true, emailVerified: true },
  });

  // Auth.js signs in whoever the linked account points at, whatever email
  // the assertion carries, so the two have to be the same person.
  if (input.linkedUserId && input.linkedUserId !== existing?.id) {
    return { ok: false, reason: "SsoAccountMismatch" };
  }

  if (existing?.companyId && existing.companyId !== input.tenant) {
    return { ok: false, reason: "SsoWrongWorkspace" };
  }

  const verifiedAt = new Date();
  const join = claim.autoJoin && !existing?.companyId;

  try {
    await db.$transaction(async (tx) => {
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              emailVerified: existing.emailVerified ?? verifiedAt,
              ...(join ? { companyId: input.tenant, role: "MEMBER" } : {}),
            },
            select: { id: true, name: true },
          })
        : await tx.user.create({
            data: {
              name: input.name,
              email,
              emailVerified: verifiedAt,
              ...(join ? { companyId: input.tenant, role: "MEMBER" } : {}),
            },
            select: { id: true, name: true },
          });
      if (join) {
        await logActivity(
          {
            companyId: input.tenant,
            actorId: user.id,
            action: "user.join",
            entityType: "user",
            entityId: user.id,
            summary: `${user.name} joined through single sign-on`,
            metadata: { domain },
          },
          tx,
        );
      }
    });
  } catch (error) {
    // A concurrent first sign-in for the same person created the account;
    // Auth.js links to it by email either way.
    if (!isPrismaError(error, "P2002")) throw error;
    return { ok: true, joinedCompanyId: null };
  }

  return { ok: true, joinedCompanyId: join ? input.tenant : null };
}
