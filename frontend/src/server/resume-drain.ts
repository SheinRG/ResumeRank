import { after } from "next/server";

import { drainResumeQueue } from "@resumerank/core/ingestion/queue";
import { errorFields, log } from "@resumerank/core/observability/log";

/**
 * Reads queued resume files after the response is sent, inside the same
 * invocation: called after an upload and from status polls, with the cron
 * as the backstop for retries. Overlapping drains are safe; claims are atomic.
 */
export function scheduleResumeDrain(): void {
  after(async () => {
    try {
      await drainResumeQueue();
    } catch (error) {
      log.error("resume_file.drain_failed", errorFields(error));
    }
  });
}
