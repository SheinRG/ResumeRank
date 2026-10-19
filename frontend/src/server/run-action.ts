import { randomUUID } from "node:crypto";

import { GateError, inSupportSession, ReauthRequiredError } from "@/lib/auth/guards";
import { DomainError } from "@resumerank/core/services/errors";
import { errorFields, log, withLogContext } from "@resumerank/core/observability/log";
import { actionError, type ActionResult } from "@resumerank/core/types/action";

const SUPPORT_SESSION_READ_ONLY =
  "You're in a read-only support session, so nothing can be changed. End the session to act as yourself.";

function isStaffConsoleAction(name: string): boolean {
  return name.startsWith("staff") || name === "endSupportSession";
}

/**
 * Wraps a server-action body so the client always receives a typed
 * ActionResult: gate and domain failures surface their message, unexpected
 * errors are logged server-side and replaced with a safe generic one that
 * carries a reference to the log line.
 *
 * Every call writes one `action` log line with its outcome and duration; the
 * guards add the user and tenant to it once they have run.
 *
 * A sign-in in a support session can run only the staff console's own
 * actions (`staff…`, and ending the session): everything else would act as
 * the member being viewed. Tenant transactions are read-only there too, so
 * this is the first of two locks, and the one with the clear message.
 */
export async function runAction<T>(
  name: string,
  body: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  return withLogContext({ action: name }, async () => {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    try {
      if (!isStaffConsoleAction(name) && (await inSupportSession())) {
        log.info("action", { outcome: "denied", reason: "support_session", durationMs: elapsed() });
        return actionError(SUPPORT_SESSION_READ_ONLY);
      }
      const result = await body();
      log.info("action", { outcome: result.ok ? "ok" : "invalid", durationMs: elapsed() });
      return result;
    } catch (error) {
      if (error instanceof ReauthRequiredError) {
        log.info("action", { outcome: "reauth_required", durationMs: elapsed() });
        return actionError(error.message, undefined, "reauth_required");
      }
      if (error instanceof GateError) {
        log.info("action", { outcome: "denied", durationMs: elapsed() });
        return actionError(error.message);
      }
      if (error instanceof DomainError) {
        log.info("action", { outcome: "rejected", reason: error.name, durationMs: elapsed() });
        return actionError(error.message, error.fieldErrors);
      }
      const digest = randomUUID().slice(0, 8);
      log.error("action", { outcome: "error", digest, durationMs: elapsed(), ...errorFields(error) });
      return actionError(`Something went wrong on our side. Try again. Reference: ${digest}.`);
    }
  });
}
