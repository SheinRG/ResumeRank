"use server";

import { revalidatePath } from "next/cache";
import type { Candidate } from "@resumerank/core/generated/prisma/client";
import { requireWriter, tenantContext } from "@/lib/auth/guards";
import {
  candidateCreateSchema,
  candidateUpdateSchema,
  resumeTextSchema,
} from "@resumerank/core/validators/candidate";
import {
  createCandidate,
  deleteCandidate,
  extractProfile,
  updateCandidate,
} from "@resumerank/core/services/candidates";
import type { CandidateProfile } from "@resumerank/core/extraction/engine";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

export async function createCandidateAction(
  input: unknown,
): Promise<ActionResult<Candidate>> {
  return runAction("createCandidate", async () => {
    const parsed = candidateCreateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const candidate = await createCandidate(tenantContext(user), parsed.data);

    revalidatePath("/candidates");
    expireTenantReads(user.companyId);

    return actionOk(candidate);
  });
}

export async function updateCandidateAction(
  input: unknown,
): Promise<ActionResult<Candidate>> {
  return runAction("updateCandidate", async () => {
    const parsed = candidateUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const candidate = await updateCandidate(tenantContext(user), parsed.data);

    revalidatePath("/candidates");
    revalidatePath(`/candidates/${candidate.id}`);
    expireTenantReads(user.companyId);

    return actionOk(candidate);
  });
}

export async function deleteCandidateAction(
  id: string,
): Promise<ActionResult<Candidate>> {
  return runAction("deleteCandidate", async () => {
    const user = await requireWriter();
    const candidate = await deleteCandidate(tenantContext(user), id);

    revalidatePath("/candidates");
    expireTenantReads(user.companyId);

    return actionOk(candidate);
  });
}

export async function extractCandidateProfileAction(
  resumeText: unknown,
): Promise<ActionResult<CandidateProfile>> {
  return runAction("extractCandidateProfile", async () => {
    const user = await requireWriter();

    const parsed = resumeTextSchema.safeParse(resumeText);
    if (!parsed.success) {
      return actionError(
        parsed.error.issues[0]?.message ?? "Check the resume text and try again.",
      );
    }

    const profile = await extractProfile(tenantContext(user), parsed.data);
    return actionOk(profile);
  });
}
