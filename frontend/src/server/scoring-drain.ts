import { after } from "next/server";

import { errorFields, log } from "@resumerank/core/observability/log";
import { drainScoringQueue } from "@resumerank/core/scoring/queue";

/**
 * Works the scoring queue after the response is sent, inside the same
 * function invocation. Called wherever new or due work may exist — an
 * enqueue, a status poll — so the queue keeps moving without a dedicated
 * worker process; overlapping drains are safe because claiming is atomic.
 */
export function scheduleScoringDrain(): void {
  after(async () => {
    try {
      await drainScoringQueue();
    } catch (error) {
      log.error("scoring.drain_failed", errorFields(error));
    }
  });
}
