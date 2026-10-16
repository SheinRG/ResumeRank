import { isResumeUploadEnabled } from "@resumerank/core/env";
import { hasFeature } from "@resumerank/core/services/features";
import * as resumeFiles from "@resumerank/core/services/resume-files";
import { can, requireMember, tenantContext } from "@/lib/auth/guards";

export type { ResumeFileItem } from "@resumerank/core/services/resume-files";

export interface ResumeFilesPanel {
  files: resumeFiles.ResumeFileItem[];
  /** Whether this person may upload here: their role, the workspace's plan, and the server's storage. */
  canUpload: boolean;
}

export async function getResumeFilesPanel(candidateId: string): Promise<ResumeFilesPanel> {
  const user = await requireMember();
  const ctx = tenantContext(user);
  const [files, entitled] = await Promise.all([
    resumeFiles.listResumeFiles(ctx, candidateId),
    hasFeature(ctx, "resume-files"),
  ]);
  return {
    files,
    canUpload: entitled && isResumeUploadEnabled() && can(user.role, "candidate.manage"),
  };
}

export async function listResumeFiles(candidateId: string): Promise<resumeFiles.ResumeFileItem[]> {
  const user = await requireMember();
  return resumeFiles.listResumeFiles(tenantContext(user), candidateId);
}

export async function getResumeFileDownload(id: string): Promise<resumeFiles.ResumeFileDownload> {
  const user = await requireMember();
  return resumeFiles.getResumeFileDownload(tenantContext(user), id);
}
