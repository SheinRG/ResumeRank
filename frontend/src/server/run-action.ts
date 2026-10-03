import { GateError } from "@/lib/auth/guards";
import { DomainError } from "@resumerank/core/services/errors";
import { actionError, type ActionResult } from "@resumerank/core/types/action";

/**
 * Wraps a server-action body so the client always receives a typed
 * ActionResult: gate and domain failures surface their message, unexpected
 * errors are logged server-side and replaced with a safe generic one.
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
    if (error instanceof DomainError) {
      return actionError(error.message, error.fieldErrors);
    }
    console.error("[action]", error);
    return actionError("Something went wrong on our side. Try again.");
  }
}
