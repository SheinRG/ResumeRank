"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceSwitch } from "@/lib/auth/guards";
import { switchWorkspace, type SwitchedWorkspace } from "@resumerank/core/auth/workspaces";
import { switchWorkspaceSchema } from "@resumerank/core/validators/company";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

export async function switchWorkspaceAction(
  input: unknown,
): Promise<ActionResult<SwitchedWorkspace>> {
  return runAction("switchWorkspace", async () => {
    const parsed = switchWorkspaceSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("That workspace could not be found.");
    }
    const { user, loginId } = await requireWorkspaceSwitch();
    const switched = await switchWorkspace({ userId: user.id, loginId }, parsed.data.companyId);

    // Every page under the shell renders for the open workspace.
    revalidatePath("/", "layout");

    return actionOk(switched);
  });
}
