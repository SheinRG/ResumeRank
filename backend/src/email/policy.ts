export const MAX_EMAIL_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
/** Far longer than one provider call; a SENDING row older than this lost its worker. */
export const STALE_SEND_MS = 2 * 60_000;
/** Terminal rows are kept this long for support questions ("did my invite go out?"), then pruned. */
export const EMAIL_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** Exponential with ±20% jitter so a provider outage doesn't end in a synchronized retry burst. */
export function emailRetryDelayMs(attempt: number, random = Math.random): number {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  return Math.round(exponential * (0.8 + random() * 0.4));
}

export type RetryDecision =
  | { retry: true; nextAttemptAt: Date }
  | { retry: false; reason: "attempts" | "expiry" | "permanent" };

/**
 * A retry is only worth scheduling while attempts remain and the link inside
 * will still work when it lands.
 */
export function decideRetry(input: {
  retryable: boolean;
  attempts: number;
  expiresAt: Date;
  now: Date;
  random?: () => number;
}): RetryDecision {
  if (!input.retryable) return { retry: false, reason: "permanent" };
  if (input.attempts >= MAX_EMAIL_ATTEMPTS) return { retry: false, reason: "attempts" };
  const nextAttemptAt = new Date(input.now.getTime() + emailRetryDelayMs(input.attempts, input.random));
  if (nextAttemptAt >= input.expiresAt) return { retry: false, reason: "expiry" };
  return { retry: true, nextAttemptAt };
}
