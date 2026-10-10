import type { OIDCSSORecord, SAMLSSORecord } from "@boxyhq/saml-jackson";
import { parseMetadata } from "@boxyhq/saml20/dist/metadata";

import { db } from "../db";
import { isSsoEnabled } from "../env";
import { logActivity } from "../activity";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { Prisma } from "../generated/prisma/client";
import {
  hasVerificationRecord,
  newVerificationToken,
  verificationRecordName,
  verificationRecordValue,
  type TxtResolver,
} from "../sso/domains";
import {
  jacksonClientError,
  serviceProviderDetails,
  SSO_PRODUCT,
  ssoBaseUrl,
  ssoCallbackUrl,
  ssoControllers,
  type ServiceProviderDetails,
} from "../sso/jackson";
import { isPublicHttpsUrl, type HostResolver } from "../sso/public-url";
import type {
  AddDomainInput,
  DomainIdInput,
  SaveSsoConnectionInput,
  SetDomainAutoJoinInput,
  SetSsoEnforcedInput,
} from "../validators/sso";
import { assertCanAdmin, type TenantContext } from "./context";
import { isPrismaError } from "./prisma-errors";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "./errors";

export interface SsoDomain {
  id: string;
  domain: string;
  verifiedAt: Date | null;
  autoJoin: boolean;
  /** The TXT record that proves control: publish `recordValue` at `recordName`. */
  recordName: string;
  recordValue: string;
}

export interface SsoConnectionSummary {
  type: "saml" | "oidc";
  provider: string;
  /** SAML: the IdP's entity ID. OIDC: the discovery URL. */
  identifier: string;
  /** SAML only: when the IdP's signing certificate expires. */
  certificateExpiresAt: string | null;
}

export interface SsoSettings {
  /** False when the deployment has no SSO_ENCRYPTION_KEY. */
  available: boolean;
  enforced: boolean;
  domains: SsoDomain[];
  connection: SsoConnectionSummary | null;
  serviceProvider: ServiceProviderDetails;
}

const DOMAIN_SELECT = {
  id: true,
  domain: true,
  verifiedAt: true,
  autoJoin: true,
  verificationToken: true,
} satisfies Prisma.CompanyDomainSelect;

type DomainRow = Prisma.CompanyDomainGetPayload<{ select: typeof DOMAIN_SELECT }>;

const DOMAIN_NOT_FOUND = "That domain is no longer on this workspace.";

function toSsoDomain(row: DomainRow): SsoDomain {
  return {
    id: row.id,
    domain: row.domain,
    verifiedAt: row.verifiedAt,
    autoJoin: row.autoJoin,
    recordName: verificationRecordName(row.domain),
    recordValue: verificationRecordValue(row.verificationToken),
  };
}

function summarize(record: SAMLSSORecord | OIDCSSORecord): SsoConnectionSummary {
  if ("idpMetadata" in record) {
    return {
      type: "saml",
      provider: record.idpMetadata.friendlyProviderName ?? record.idpMetadata.provider,
      identifier: record.idpMetadata.entityID,
      certificateExpiresAt: record.idpMetadata.validTo ?? null,
    };
  }
  return {
    type: "oidc",
    provider: record.oidcProvider.friendlyProviderName ?? record.oidcProvider.provider,
    identifier: record.oidcProvider.discoveryUrl ?? "",
    certificateExpiresAt: null,
  };
}

async function listConnections(ctx: TenantContext): Promise<Array<SAMLSSORecord | OIDCSSORecord>> {
  const { connectionAPIController } = await ssoControllers();
  return connectionAPIController.getConnections({ tenant: ctx.companyId, product: SSO_PRODUCT });
}

function assertOwner(ctx: TenantContext): void {
  if (ctx.role !== "OWNER") {
    throw new ForbiddenError("Only an owner can change how members sign in.");
  }
}

function assertSsoAvailable(): void {
  if (!isSsoEnabled()) {
    throw new DomainError("Single sign-on isn't enabled on this deployment.");
  }
}

/** Whether members must use SSO; every member may read it, the settings page shows it to all. */
export async function getSsoEnforcement(ctx: TenantContext): Promise<{ enforced: boolean }> {
  const company = await tenantDb(ctx).company.findUnique({
    where: { id: ctx.companyId },
    select: { ssoEnforced: true },
  });
  return { enforced: company?.ssoEnforced ?? false };
}

export async function getSsoSettings(ctx: TenantContext): Promise<SsoSettings> {
  assertCanAdmin(ctx);
  const [company, domains] = await Promise.all([
    tenantDb(ctx).company.findUnique({ where: { id: ctx.companyId }, select: { ssoEnforced: true } }),
    tenantDb(ctx).companyDomain.findMany({
      where: { companyId: ctx.companyId },
      select: DOMAIN_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const available = isSsoEnabled();
  const connections = available ? await listConnections(ctx) : [];
  const live = connections.find((connection) => !connection.deactivated);

  return {
    available,
    enforced: company?.ssoEnforced ?? false,
    domains: domains.map(toSsoDomain),
    connection: live ? summarize(live) : null,
    serviceProvider: serviceProviderDetails(),
  };
}

export async function addDomain(ctx: TenantContext, input: AddDomainInput): Promise<SsoDomain> {
  assertCanAdmin(ctx);
  const { domain } = input;

  // A cross-company read on purpose: a verified domain belongs to exactly one
  // workspace, and saying so now beats failing at verification.
  const verifiedElsewhere = await db.companyDomain.count({
    where: { domain, verifiedAt: { not: null }, companyId: { not: ctx.companyId } },
  });
  if (verifiedElsewhere > 0) {
    throw new ConflictError("Another workspace has already verified that domain.");
  }

  try {
    return await tenantTransaction(ctx, async (tx) => {
      const created = await tx.companyDomain.create({
        data: { companyId: ctx.companyId, domain, verificationToken: newVerificationToken() },
        select: DOMAIN_SELECT,
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "sso.domain_add",
          entityType: "user",
          entityId: ctx.actorId,
          summary: `added the domain ${domain}`,
          metadata: { domainId: created.id, domain },
        },
        tx,
      );
      return toSsoDomain(created);
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      throw new ConflictError("That domain is already on this workspace.", {
        domain: ["That domain is already on this workspace."],
      });
    }
    throw error;
  }
}

export async function verifyDomain(
  ctx: TenantContext,
  input: DomainIdInput,
  resolveTxt?: TxtResolver,
): Promise<SsoDomain> {
  assertCanAdmin(ctx);
  const row = await tenantDb(ctx).companyDomain.findFirst({
    where: { id: input.domainId, companyId: ctx.companyId },
    select: DOMAIN_SELECT,
  });
  if (!row) throw new NotFoundError(DOMAIN_NOT_FOUND);
  if (row.verifiedAt) return toSsoDomain(row);

  if (!(await hasVerificationRecord(row.domain, row.verificationToken, resolveTxt))) {
    throw new DomainError(
      `We couldn't find the TXT record at ${verificationRecordName(row.domain)} yet. DNS changes can take a few minutes to appear — try again shortly.`,
    );
  }

  try {
    return await tenantTransaction(ctx, async (tx) => {
      const verified = await tx.companyDomain.update({
        where: { id: row.id, companyId: ctx.companyId },
        data: { verifiedAt: new Date() },
        select: DOMAIN_SELECT,
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "sso.domain_verify",
          entityType: "user",
          entityId: ctx.actorId,
          summary: `verified the domain ${verified.domain}`,
          metadata: { domainId: verified.id, domain: verified.domain },
        },
        tx,
      );
      return toSsoDomain(verified);
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      throw new ConflictError("Another workspace has already verified that domain.");
    }
    throw error;
  }
}

export async function setDomainAutoJoin(
  ctx: TenantContext,
  input: SetDomainAutoJoinInput,
): Promise<SsoDomain> {
  assertCanAdmin(ctx);
  return tenantTransaction(ctx, async (tx) => {
    const row = await tx.companyDomain.findFirst({
      where: { id: input.domainId, companyId: ctx.companyId },
      select: { verifiedAt: true },
    });
    if (!row) throw new NotFoundError(DOMAIN_NOT_FOUND);
    if (input.autoJoin && !row.verifiedAt) {
      throw new ConflictError("Verify the domain before letting people join through it.");
    }

    const updated = await tx.companyDomain.update({
      where: { id: input.domainId, companyId: ctx.companyId },
      data: { autoJoin: input.autoJoin },
      select: DOMAIN_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "sso.domain_auto_join",
        entityType: "user",
        entityId: ctx.actorId,
        summary: `${input.autoJoin ? "turned on" : "turned off"} auto-join for ${updated.domain}`,
        metadata: { domainId: updated.id, domain: updated.domain, autoJoin: input.autoJoin },
      },
      tx,
    );
    return toSsoDomain(updated);
  });
}

export async function removeDomain(ctx: TenantContext, input: DomainIdInput): Promise<{ id: string }> {
  assertCanAdmin(ctx);
  return tenantTransaction(ctx, async (tx) => {
    const [row, company, verifiedCount] = await Promise.all([
      tx.companyDomain.findFirst({
        where: { id: input.domainId, companyId: ctx.companyId },
        select: { domain: true, verifiedAt: true },
      }),
      tx.company.findUnique({ where: { id: ctx.companyId }, select: { ssoEnforced: true } }),
      tx.companyDomain.count({ where: { companyId: ctx.companyId, verifiedAt: { not: null } } }),
    ]);
    if (!row) throw new NotFoundError(DOMAIN_NOT_FOUND);
    // SSO sign-in finds the company by domain; without one, enforced members
    // would have no way in.
    if (company?.ssoEnforced && row.verifiedAt && verifiedCount <= 1) {
      throw new ConflictError("Turn off required SSO before removing your last verified domain.");
    }

    await tx.companyDomain.delete({ where: { id: input.domainId, companyId: ctx.companyId } });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "sso.domain_remove",
        entityType: "user",
        entityId: ctx.actorId,
        summary: `removed the domain ${row.domain}`,
        metadata: { domainId: input.domainId, domain: row.domain },
      },
      tx,
    );
    return { id: input.domainId };
  });
}

/**
 * Parsed up front so a bad file gets a message about the file: the SSO
 * service raises the same parse failures as untyped errors, which would
 * otherwise be indistinguishable from an outage.
 */
async function assertReadableMetadata(metadataXml: string): Promise<void> {
  try {
    await parseMetadata(metadataXml, {});
  } catch (error) {
    const reason = error instanceof Error ? error.message : "it isn't valid SAML metadata";
    throw new DomainError(`We couldn't read that metadata: ${reason}`, { metadataXml: [reason] });
  }
}

/**
 * Creates the company's connection, replacing any previous one only once the
 * new one is stored, so a rejected metadata file never leaves the company
 * without SSO.
 *
 * The connection lives in the SSO service's own store, which can't join a
 * tenant transaction; the audit row is written right after it, and only if
 * the save succeeded.
 */
export async function saveSsoConnection(
  ctx: TenantContext,
  input: SaveSsoConnectionInput,
  resolveHost?: HostResolver,
): Promise<SsoConnectionSummary> {
  assertCanAdmin(ctx);
  assertSsoAvailable();

  if (input.type === "saml") {
    await assertReadableMetadata(input.metadataXml);
  } else if (!(await isPublicHttpsUrl(input.discoveryUrl, resolveHost))) {
    throw new DomainError("The discovery URL must be a public https address.", {
      discoveryUrl: ["Use your identity provider's public https discovery URL."],
    });
  }

  const { connectionAPIController } = await ssoControllers();
  const shared = {
    tenant: ctx.companyId,
    product: SSO_PRODUCT,
    defaultRedirectUrl: `${ssoBaseUrl()}/login`,
    redirectUrl: [ssoCallbackUrl()],
  };

  let created: SAMLSSORecord | OIDCSSORecord;
  try {
    created =
      input.type === "saml"
        ? await connectionAPIController.createSAMLConnection({ ...shared, rawMetadata: input.metadataXml })
        : await connectionAPIController.createOIDCConnection({
            ...shared,
            oidcDiscoveryUrl: input.discoveryUrl,
            oidcClientId: input.clientId,
            oidcClientSecret: input.clientSecret,
          });
  } catch (error) {
    const message = jacksonClientError(error);
    if (message) throw new DomainError(`Your identity provider's settings were rejected: ${message}`);
    throw error;
  }

  const previous = (await listConnections(ctx)).filter(
    (connection) => connection.clientID !== created.clientID,
  );
  for (const connection of previous) {
    await connectionAPIController.deleteConnections({
      clientID: connection.clientID,
      clientSecret: connection.clientSecret,
    });
  }

  const summary = summarize(created);
  await tenantTransaction(ctx, (tx) =>
    logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "sso.connection_save",
        entityType: "user",
        entityId: ctx.actorId,
        summary: `connected ${summary.provider} for single sign-on`,
        metadata: { type: summary.type, provider: summary.provider, identifier: summary.identifier },
      },
      tx,
    ),
  );
  return summary;
}

export async function removeSsoConnection(ctx: TenantContext): Promise<{ removed: true }> {
  assertCanAdmin(ctx);
  assertSsoAvailable();

  const { enforced } = await getSsoEnforcement(ctx);
  if (enforced) {
    throw new ConflictError("Turn off required SSO before removing the connection.");
  }

  const connections = await listConnections(ctx);
  if (connections.length === 0) throw new NotFoundError("There is no SSO connection to remove.");

  const { connectionAPIController } = await ssoControllers();
  for (const connection of connections) {
    await connectionAPIController.deleteConnections({
      clientID: connection.clientID,
      clientSecret: connection.clientSecret,
    });
  }

  await tenantTransaction(ctx, (tx) =>
    logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "sso.connection_remove",
        entityType: "user",
        entityId: ctx.actorId,
        summary: "removed the single sign-on connection",
      },
      tx,
    ),
  );
  return { removed: true };
}

/**
 * Turning enforcement on needs a live connection and a verified domain,
 * since SSO sign-in finds the company through its domain. Existing password
 * and Google sessions end on their next request: the guards compare each
 * session's sign-in method against this flag.
 */
export async function setSsoEnforced(
  ctx: TenantContext,
  input: SetSsoEnforcedInput,
): Promise<{ enforced: boolean }> {
  assertCanAdmin(ctx);
  assertOwner(ctx);

  if (input.enforced) {
    assertSsoAvailable();
    const live = (await listConnections(ctx)).some((connection) => !connection.deactivated);
    if (!live) throw new ConflictError("Connect an identity provider before requiring SSO.");
  }

  return tenantTransaction(ctx, async (tx) => {
    if (input.enforced) {
      const verified = await tx.companyDomain.count({
        where: { companyId: ctx.companyId, verifiedAt: { not: null } },
      });
      if (verified === 0) throw new ConflictError("Verify a domain before requiring SSO.");
    }

    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: { ssoEnforced: input.enforced },
      select: { ssoEnforced: true },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "sso.enforce",
        entityType: "user",
        entityId: ctx.actorId,
        summary: input.enforced ? "required single sign-on for members" : "stopped requiring single sign-on",
        metadata: { enforced: input.enforced },
      },
      tx,
    );
    return { enforced: company.ssoEnforced };
  });
}
