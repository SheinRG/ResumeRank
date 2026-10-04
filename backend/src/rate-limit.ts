interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process fixed-window rate limiter. Correct per serverless instance; a
 * shared store (e.g. Upstash Redis) is the production upgrade documented in
 * docs/architecture.md. Buckets are pruned on write to bound memory.
 */
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * `cost` lets one request spend several units (a bulk scoring request costs
 * one per applicant). A request that would overshoot is refused whole and
 * spends nothing, so a too-large bulk request doesn't burn the budget.
 */
export function rateLimit(
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
  cost = 1,
): RateLimitResult {
  const now = Date.now();

  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (cost > max) return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    buckets.set(key, { count: cost, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count + cost > max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  bucket.count += cost;
  return { allowed: true, retryAfterSeconds: 0 };
}

export const AUTH_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

/**
 * Every AI call is a paid LLM request. The per-user window stops one person
 * (or a stuck script) from hammering it; the per-company window caps a whole
 * tenant's spend. Generous enough for a recruiter scoring a full pipeline.
 */
export const AI_USER_LIMIT = { max: 30, windowMs: 10 * 60 * 1000 };
export const AI_COMPANY_LIMIT = { max: 300, windowMs: 60 * 60 * 1000 };

function retryMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Returns an error message when the caller is over quota, otherwise null.
 * The user window counts requests (a bulk request is one click); the company
 * window counts the LLM calls a request will make, since that is the spend.
 */
export function checkAiQuota({
  userId,
  companyId,
  calls = 1,
}: {
  userId: string;
  companyId: string;
  calls?: number;
}): string | null {
  const user = rateLimit(`ai:user:${userId}`, AI_USER_LIMIT);
  if (!user.allowed) {
    return `You're using AI features too quickly. Try again in ${retryMessage(user.retryAfterSeconds)}.`;
  }
  const company = rateLimit(`ai:company:${companyId}`, AI_COMPANY_LIMIT, calls);
  if (!company.allowed) {
    return `Your workspace has reached its hourly AI limit. Try again in ${retryMessage(company.retryAfterSeconds)}.`;
  }
  return null;
}

export function resetRateLimits(): void {
  buckets.clear();
}
