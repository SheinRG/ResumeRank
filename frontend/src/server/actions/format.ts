"use server";

import { revalidatePath } from "next/cache";

import { db } from "@resumerank/core/db";
import { updateWorkspaceFormat, type WorkspaceFormat } from "@resumerank/core/services/company";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import { personalFormatSchema, workspaceFormatSchema } from "@resumerank/core/validators/locale";
import { requireAdmin, requireUser, tenantContext } from "@/lib/auth/guards";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";

/** A personal preference, not a workspace change, so it isn't in the audit log. */
export async function updatePersonalFormatAction(
  input: unknown,
): Promise<ActionResult<{ locale: string | null; timeZone: string | null }>> {
  return runAction("updatePersonalFormat", async () => {
    const parsed = personalFormatSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireUser();
    const saved = await db.user.update({
      where: { id: user.id },
      data: parsed.data,
      select: { locale: true, timeZone: true },
    });
    // Every page formats dates with it.
    revalidatePath("/", "layout");
    return actionOk(saved);
  });
}

export async function updateWorkspaceFormatAction(input: unknown): Promise<ActionResult<WorkspaceFormat>> {
  return runAction("updateWorkspaceFormat", async () => {
    const parsed = workspaceFormatSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    const format = await updateWorkspaceFormat(tenantContext(admin), parsed.data);
    revalidatePath("/", "layout");
    expireTenantReads(admin.companyId);
    return actionOk(format);
  });
}
