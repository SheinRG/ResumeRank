import { clearRateLimit, peekRateLimit, rateLimit, recordUsage, type RateLimit } from "../rate-limit";

/** Attempts from one IP across any accounts: stops one host spraying passwords over many emails. */
export const LOGIN_IP_LIMIT: RateLimit = { max: 30, windowMs: 15 * 60 * 1000 };
/**
 * Failed attempts on one account from any IP: stops a distributed guess
 * against one person. Temporary by design — a permanent lock would let anyone
 * lock a victim out — and a password reset still works while it is in force.
 */
export const ACCOUNT_FAILURE_LIMIT: RateLimit = { max: 10, windowMs: 15 * 60 * 1000 };

const ipKey = (ip: string) => `login:ip:${ip}`;
const accountKey = (email: string) => `login:fail:${email}`;

export interface LoginGate {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Read-only check so the login form can explain a lockout before submitting credentials. */
export async function loginBlocked(email: string, ip: string): Promise<LoginGate> {
  const [byIp, byAccount] = await Promise.all([
    peekRateLimit(ipKey(ip), LOGIN_IP_LIMIT),
    peekRateLimit(accountKey(email), ACCOUNT_FAILURE_LIMIT),
  ]);
  return byIp.allowed ? byAccount : byIp;
}

/**
 * Runs before the password is checked, so a locked account or a throttled IP
 * learns nothing about whether the password was right. Every attempt spends
 * from the IP budget; only failures count against the account.
 */
export async function beginLoginAttempt(email: string, ip: string): Promise<LoginGate> {
  const byAccount = await peekRateLimit(accountKey(email), ACCOUNT_FAILURE_LIMIT);
  if (!byAccount.allowed) return byAccount;
  return rateLimit(ipKey(ip), LOGIN_IP_LIMIT);
}

/** Counted for unknown emails too, so lockout behaviour doesn't reveal which accounts exist. */
export async function recordFailedLogin(email: string): Promise<void> {
  await recordUsage(accountKey(email), ACCOUNT_FAILURE_LIMIT.windowMs, 1);
}

export async function clearFailedLogins(email: string): Promise<void> {
  await clearRateLimit(accountKey(email));
}
