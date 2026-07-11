import { GateError } from "@/lib/auth/guards";
import { actionError, type ActionResult } from "@/types/action";

/**
 * Wraps a server-action body so the client always receives a typed
 * ActionResult: gate failures surface their message, unexpected errors are
 * logged server-side and replaced with a safe generic one.
 */
export async function runAction<T>(
  body: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof GateError) {
      return actionError(error.message);
    }
    console.error("[action]", error);
    return actionError("Something went wrong on our side. Try again.");
  }
}
