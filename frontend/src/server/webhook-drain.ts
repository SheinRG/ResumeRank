import { after } from "next/server";

import { errorFields, log } from "@resumerank/core/observability/log";
import { drainWebhooks } from "@resumerank/core/webhooks/delivery";

/**
 * Sends queued webhook deliveries after the response, inside the same
 * function invocation, so receivers hear about a change within seconds.
 * The cron route picks up retries and anything a crash left behind.
 */
export function scheduleWebhookDrain(): void {
  after(async () => {
    try {
      await drainWebhooks();
    } catch (error) {
      log.error("webhook.drain_failed", errorFields(error));
    }
  });
}
