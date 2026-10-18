import { db } from "../db";
import { logActivity } from "../activity";
import { stripeGateway, type BillingGateway } from "../billing/gateway";
import { isBillingEnabled } from "../env";
import { errorFields, log } from "../observability/log";
import { forgetSsoTenant } from "../sso/forget";
import { configuredBlobStore, type BlobStore } from "../storage/blob";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { DeleteWorkspaceInput } from "../validators/compliance";
import type { TenantContext } from "./context";
import { DomainError, ForbiddenError, NotFoundError } from "./errors";

/**
 * Tenant offboarding: a complete export a company can take with it, then
 * deletion of everything it had here. Owners only, since both act on the
 * whole workspace.
 */

const BATCH = 500;

function assertOwner(ctx: TenantContext, action: string): void {
  if (ctx.role !== "OWNER") throw new ForbiddenError(`Only an owner can ${action}.`);
}

/** Pages through one tenant table by id, so the export never holds a whole table in memory. */
async function* paged<T extends { id: string }>(fetch: (after: string | undefined) => Promise<T[]>): AsyncGenerator<T> {
  let after: string | undefined;
  for (;;) {
    const rows = await fetch(after);
    yield* rows;
    if (rows.length < BATCH) return;
    after = rows[rows.length - 1]?.id;
  }
}

const page = (companyId: string, after: string | undefined) => ({
  where: { companyId, ...(after ? { id: { gt: after } } : {}) },
  orderBy: { id: "asc" as const },
  take: BATCH,
});

async function* workspaceRecords(ctx: TenantContext): AsyncGenerator<{ type: string; data: unknown }> {
  const scoped = tenantDb(ctx);
  const { companyId } = ctx;

  const company = await scoped.company.findUnique({ where: { id: companyId } });
  yield { type: "workspace", data: company };

  for await (const row of paged((after) =>
    scoped.membership.findMany({ ...page(companyId, after), include: { user: { select: { name: true, email: true } } } }),
  )) {
    yield { type: "member", data: { role: row.role, joinedAt: row.createdAt, name: row.user.name, email: row.user.email } };
  }
  for await (const row of paged((after) => scoped.department.findMany(page(companyId, after)))) yield { type: "department", data: row };
  for await (const row of paged((after) => scoped.departmentMember.findMany(page(companyId, after)))) yield { type: "department_member", data: row };
  for await (const row of paged((after) =>
    scoped.job.findMany({ ...page(companyId, after), include: { requirements: { orderBy: { order: "asc" } } } }),
  )) {
    yield { type: "job", data: row };
  }
  for await (const row of paged((after) => scoped.jobAssignment.findMany(page(companyId, after)))) yield { type: "job_assignment", data: row };
  for await (const row of paged((after) => scoped.candidate.findMany(page(companyId, after)))) yield { type: "candidate", data: row };
  for await (const row of paged((after) => scoped.resumeFile.findMany(page(companyId, after)))) yield { type: "resume_file", data: row };
  for await (const row of paged((after) =>
    scoped.application.findMany({ ...page(companyId, after), include: { scorecards: true, selfId: true } }),
  )) {
    yield { type: "application", data: row };
  }
  for await (const row of paged((after) =>
    scoped.scoringRun.findMany({ ...page(companyId, after), include: { evaluations: true } }),
  )) {
    yield { type: "scoring_run", data: row };
  }
  for await (const row of paged((after) => scoped.activityLog.findMany(page(companyId, after)))) yield { type: "audit_entry", data: row };
  for await (const row of paged((after) =>
    scoped.apiKey.findMany({ ...page(companyId, after), omit: { secretHash: true } }),
  )) {
    yield { type: "api_key", data: row };
  }
  for await (const row of paged((after) =>
    scoped.webhookEndpoint.findMany({ ...page(companyId, after), omit: { secret: true } }),
  )) {
    yield { type: "webhook_endpoint", data: row };
  }
}

// Audit sequence numbers are BigInts, which JSON can't carry.
function jsonLine(record: { type: string; data: unknown }): string {
  return `${JSON.stringify(record, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))}\n`;
}

export interface WorkspaceExport {
  filename: string;
  stream: ReadableStream<Uint8Array>;
}

/**
 * Everything the workspace holds, as JSON Lines (`{"type": …, "data": …}`
 * per record), read in pages as it streams. Uploaded resume originals are
 * listed, not embedded; secrets (API key hashes, webhook signing secrets)
 * are left out. The export is audited before the first byte goes out.
 */
export async function exportWorkspace(ctx: TenantContext): Promise<WorkspaceExport> {
  assertOwner(ctx, "export the whole workspace");
  const company = await tenantDb(ctx).company.findUnique({ where: { id: ctx.companyId }, select: { slug: true } });
  if (!company) throw new NotFoundError("Your company no longer exists.");

  await tenantTransaction(ctx, (tx) =>
    logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "company.export",
        entityType: "company",
        entityId: ctx.companyId,
        summary: "exported all of the workspace's data",
      },
      tx,
    ),
  );

  const records = workspaceRecords(ctx);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await records.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(jsonLine(next.value)));
    },
    async cancel() {
      await records.return(undefined);
    },
  });
  return { filename: `${company.slug}-export-${new Date().toISOString().slice(0, 10)}.jsonl`, stream };
}

export interface WorkspaceDeletionDeps {
  gateway?: BillingGateway;
  store?: BlobStore | null;
}

/**
 * Deletes the workspace and everything in it. In order, so a failure leaves
 * nothing half-gone that matters:
 *
 * 1. the Stripe subscription is cancelled, so nobody is billed for a
 *    workspace that no longer exists (a Stripe error stops here);
 * 2. the identity provider connection and directory are removed from the
 *    SSO service, which keeps them outside the company's rows;
 * 3. the company row is deleted, and every tenant row cascades with it,
 *    scoring records and the audit log included (their guards let a cascade
 *    through), after the sessions open in it are revoked;
 * 4. uploaded resume originals are deleted from blob storage.
 *
 * People keep their accounts: they may belong to other workspaces, and one
 * whose only workspace this was is sent to onboarding. The company's own
 * audit log goes with it, so the deletion is recorded in the service log.
 */
export async function deleteWorkspace(
  ctx: TenantContext,
  input: DeleteWorkspaceInput,
  deps: WorkspaceDeletionDeps = {},
): Promise<{ deleted: true }> {
  assertOwner(ctx, "delete the workspace");
  const company = await tenantDb(ctx).company.findUnique({
    where: { id: ctx.companyId },
    select: { name: true, billingAccount: { select: { stripeSubscriptionId: true, status: true } } },
  });
  if (!company) throw new NotFoundError("Your company no longer exists.");
  if (input.confirmName !== company.name.trim()) {
    throw new DomainError("Check the highlighted fields.", {
      confirmName: [`Type ${company.name} exactly to confirm`],
    });
  }

  const blobKeys = (
    await tenantDb(ctx).resumeFile.findMany({ where: { companyId: ctx.companyId }, select: { blobKey: true } })
  ).map((file) => file.blobKey);

  const subscriptionId = company.billingAccount?.stripeSubscriptionId;
  if (subscriptionId && company.billingAccount?.status !== "CANCELED" && isBillingEnabled()) {
    try {
      await (deps.gateway ?? stripeGateway()).cancelSubscription(subscriptionId);
    } catch (error) {
      log.error("offboarding.cancel_failed", { companyId: ctx.companyId, ...errorFields(error) });
      throw new DomainError(
        "Stripe didn't confirm the subscription was cancelled, so nothing was deleted. Try again, or cancel it under Billing first.",
      );
    }
  }

  await forgetSsoTenant(ctx.companyId);

  // The tenant role can't delete a company (or reach the rows of members'
  // sessions across it), so the deletion runs on the owner connection.
  await db.$transaction(async (tx) => {
    await tx.loginSession.updateMany({
      where: { companyId: ctx.companyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.company.delete({ where: { id: ctx.companyId } });
  });

  const store = deps.store === undefined ? configuredBlobStore() : deps.store;
  if (blobKeys.length > 0) {
    try {
      if (!store) throw new Error("Blob storage is not configured");
      await store.delete(blobKeys);
    } catch (error) {
      log.error("offboarding.blob_delete_failed", { companyId: ctx.companyId, blobKeys, ...errorFields(error) });
    }
  }
  log.info("company.deleted", { companyId: ctx.companyId, actorId: ctx.actorId, resumeFiles: blobKeys.length });
  return { deleted: true };
}
