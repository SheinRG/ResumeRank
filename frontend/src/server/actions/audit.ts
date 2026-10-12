"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, tenantContext } from "@/lib/auth/guards";
import {
  removeAuditStream,
  saveAuditStream,
  setAuditRetention,
  setAuditStreamEnabled,
  testAuditStream,
  verifyAuditLog,
  type AuditChainReport,
  type AuditStreamSummary,
  type SavedAuditStream,
} from "@resumerank/core/services/audit";
import type { AuditStreamKind } from "@resumerank/core/generated/prisma/enums";
import {
  auditRetentionSchema,
  auditStreamEnabledSchema,
  auditStreamSchema,
} from "@resumerank/core/validators/audit";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

const SETTINGS_PATH = "/settings/audit";

export async function setAuditRetentionAction(
  input: unknown,
): Promise<ActionResult<{ retentionDays: number | null }>> {
  return runAction("setAuditRetention", async () => {
    const parsed = auditRetentionSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    const result = await setAuditRetention(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(result);
  });
}

export async function saveAuditStreamAction(input: unknown): Promise<ActionResult<SavedAuditStream>> {
  return runAction("saveAuditStream", async () => {
    const parsed = auditStreamSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    const saved = await saveAuditStream(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(saved);
  });
}

export async function setAuditStreamEnabledAction(input: unknown): Promise<ActionResult<AuditStreamSummary>> {
  return runAction("setAuditStreamEnabled", async () => {
    const parsed = auditStreamEnabledSchema.safeParse(input);
    if (!parsed.success) return actionError("Choose whether to pause or resume streaming.");
    const admin = await requireAdmin();
    const stream = await setAuditStreamEnabled(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(stream);
  });
}

export async function removeAuditStreamAction(): Promise<ActionResult<{ kind: AuditStreamKind }>> {
  return runAction("removeAuditStream", async () => {
    const admin = await requireAdmin();
    const removed = await removeAuditStream(tenantContext(admin));
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(removed);
  });
}

export async function testAuditStreamAction(): Promise<ActionResult<{ sentAt: Date }>> {
  return runAction("testAuditStream", async () => {
    const admin = await requireAdmin();
    return actionOk(await testAuditStream(tenantContext(admin)));
  });
}

export async function verifyAuditLogAction(): Promise<ActionResult<AuditChainReport>> {
  return runAction("verifyAuditLog", async () => {
    const admin = await requireAdmin();
    return actionOk(await verifyAuditLog(tenantContext(admin)));
  });
}
