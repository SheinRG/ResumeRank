"use server";

import { revalidatePath } from "next/cache";
import type { Scorecard } from "@resumerank/core/generated/prisma/client";
import { requireWriter, tenantContext } from "@/lib/auth/guards";
import { scorecardSchema } from "@resumerank/core/validators/application";
import { upsertScorecard } from "@resumerank/core/services/scorecards";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

export async function upsertScorecardAction(
  input: unknown,
): Promise<ActionResult<Scorecard>> {
  return runAction("upsertScorecard", async () => {
    const parsed = scorecardSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const scorecard = await upsertScorecard(tenantContext(user), parsed.data);

    revalidatePath(`/applications/${scorecard.applicationId}`);

    return actionOk(scorecard);
  });
}
