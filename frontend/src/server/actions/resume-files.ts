"use server";

import { revalidatePath } from "next/cache";

import { uploadResumeFile } from "@resumerank/core/services/resume-files";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import { resumeFileUploadSchema } from "@resumerank/core/validators/resume-file";
import { requireCan, tenantContext } from "@/lib/auth/guards";
import { expireTenantReads } from "@/server/cache-tags";
import { scheduleResumeDrain } from "@/server/resume-drain";
import { runAction } from "@/server/run-action";

export async function uploadResumeFileAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction("uploadResumeFile", async () => {
    const parsed = resumeFileUploadSchema.safeParse({
      candidateId: formData.get("candidateId"),
      file: formData.get("file"),
    });
    if (!parsed.success) {
      return actionError(parsed.error.issues[0]?.message ?? "Choose a PDF or Word (.docx) file.");
    }
    const user = await requireCan("candidate.manage");
    const { candidateId, file } = parsed.data;
    const uploaded = await uploadResumeFile(tenantContext(user), {
      candidateId,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    scheduleResumeDrain();

    revalidatePath(`/candidates/${candidateId}`);
    expireTenantReads(user.companyId);

    return actionOk({ id: uploaded.id });
  });
}
