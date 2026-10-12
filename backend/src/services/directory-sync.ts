import type { Directory } from "@boxyhq/saml-jackson";

import { isSsoEnabled } from "../env";
import { logActivity } from "../activity";
import { tenantDb, tenantTransaction } from "../tenant-db";
import { companyDirectory } from "../sso/directory";
import { SSO_PRODUCT, ssoControllers } from "../sso/jackson";
import type { CreateDirectoryInput } from "../validators/sso";
import { assertCanAdmin, type TenantContext } from "./context";
import { ConflictError, DomainError, NotFoundError } from "./errors";

const PROVIDER_LABELS: Record<Directory["type"], string> = {
  "okta-scim-v2": "Okta",
  "azure-scim-v2": "Microsoft Entra ID",
  "onelogin-scim-v2": "OneLogin",
  "jumpcloud-scim-v2": "JumpCloud",
  "generic-scim-v2": "SCIM 2.0",
  google: "Google Workspace",
};

export interface DirectorySummary {
  provider: string;
  /** The SCIM base URL the identity provider calls. */
  endpoint: string;
  /** Members whose membership the directory currently manages. */
  managedMembers: number;
}

/** Shown once, at creation: the bearer token isn't displayed again. */
export interface DirectoryCredentials extends DirectorySummary {
  token: string;
}

function assertSsoAvailable(): void {
  if (!isSsoEnabled()) {
    throw new DomainError("Directory sync isn't enabled on this deployment.");
  }
}

async function summarize(ctx: TenantContext, directory: Directory): Promise<DirectorySummary> {
  const managedMembers = await tenantDb(ctx).membership.count({
    where: { companyId: ctx.companyId, directoryUserId: { not: null } },
  });
  return {
    provider: PROVIDER_LABELS[directory.type],
    endpoint: directory.scim.endpoint ?? directory.scim.path,
    managedMembers,
  };
}

export async function getDirectory(ctx: TenantContext): Promise<DirectorySummary | null> {
  assertCanAdmin(ctx);
  if (!isSsoEnabled()) return null;
  const directory = await companyDirectory(ctx.companyId);
  return directory ? summarize(ctx, directory) : null;
}

/**
 * Directory sync only accepts addresses on verified domains, so one has to
 * exist first or every provisioned person would be skipped.
 *
 * The directory lives in the SSO service's own store, which can't join a
 * tenant transaction; the audit row follows a successful create.
 */
export async function createDirectory(
  ctx: TenantContext,
  input: CreateDirectoryInput,
): Promise<DirectoryCredentials> {
  assertCanAdmin(ctx);
  assertSsoAvailable();

  const [existing, verifiedDomains, company] = await Promise.all([
    companyDirectory(ctx.companyId),
    tenantDb(ctx).companyDomain.count({ where: { companyId: ctx.companyId, verifiedAt: { not: null } } }),
    tenantDb(ctx).company.findUnique({ where: { id: ctx.companyId }, select: { name: true } }),
  ]);
  if (existing) throw new ConflictError("Directory sync is already connected. Disconnect it first to start over.");
  if (verifiedDomains === 0) throw new ConflictError("Verify a domain before connecting directory sync.");
  if (!company) throw new NotFoundError("Your company no longer exists.");

  const { directorySyncController } = await ssoControllers();
  const { data: directory, error } = await directorySyncController.directories.create({
    tenant: ctx.companyId,
    product: SSO_PRODUCT,
    name: company.name,
    type: input.type,
  });
  if (error && error.code >= 400 && error.code < 500) {
    throw new DomainError(`Directory sync couldn't be set up: ${error.message}`);
  }
  if (!directory) throw new Error(`Directory create failed: ${error?.message ?? "no directory returned"}`);

  await tenantTransaction(ctx, (tx) =>
    logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "scim.directory_create",
        entityType: "user",
        entityId: ctx.actorId,
        summary: `connected ${PROVIDER_LABELS[directory.type]} directory sync`,
        metadata: { type: directory.type },
      },
      tx,
    ),
  );

  return { ...(await summarize(ctx, directory)), token: directory.scim.secret };
}

/**
 * Stops provisioning. People the directory added stay members — removing a
 * whole team because a token was rotated would be worse than leaving them —
 * and admins manage them by hand from here on.
 */
export async function removeDirectory(ctx: TenantContext): Promise<{ removed: true }> {
  assertCanAdmin(ctx);
  assertSsoAvailable();

  const directory = await companyDirectory(ctx.companyId);
  if (!directory) throw new NotFoundError("Directory sync isn't connected.");

  const { directorySyncController } = await ssoControllers();
  const { error } = await directorySyncController.directories.delete(directory.id);
  if (error) throw new Error(`Directory delete failed: ${error.message}`);

  await tenantTransaction(ctx, async (tx) => {
    await tx.membership.updateMany({
      where: { companyId: ctx.companyId, directoryUserId: { not: null } },
      data: { directoryUserId: null },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "scim.directory_remove",
        entityType: "user",
        entityId: ctx.actorId,
        summary: "disconnected directory sync",
        metadata: { type: directory.type },
      },
      tx,
    );
  });
  return { removed: true };
}
