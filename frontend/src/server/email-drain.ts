import { after } from "next/server";

import { drainEmailOutbox } from "@resumerank/core/email/outbox";
import { errorFields, log } from "@resumerank/core/observability/log";

/**
 * Sends queued email after the response is sent, inside the same function
 * invocation, so the person waiting on a link gets it within seconds and the
 * request never waits on the provider. The cron route picks up retries.
 */
export function scheduleEmailDrain(): void {
  after(async () => {
    try {
      await drainEmailOutbox();
    } catch (error) {
      log.error("email.drain_failed", errorFields(error));
    }
  });
}
