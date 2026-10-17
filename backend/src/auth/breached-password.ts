import { createHash } from "node:crypto";

import { errorFields, log } from "../observability/log";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
/** Setting a password waits on this, so a slow lookup gives up rather than stalling the form. */
const TIMEOUT_MS = 3_000;

/** True when the password is in a known breach, false when it isn't, null when we couldn't find out. */
export type BreachLookup = (password: string) => Promise<boolean | null>;

/**
 * Have I Been Pwned's range API, by k-anonymity: only the first five hex
 * characters of the password's SHA-1 leave the server, and the response
 * lists every breached suffix under that prefix. Padding asks the service to
 * add decoy entries (count 0) so the response size doesn't hint at the
 * answer either.
 */
export const pwnedPasswordsLookup: BreachLookup = async (password) => {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const response = await fetch(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "ResumeRank" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn("password.breach_check_unavailable", { status: response.status });
      return null;
    }
    const body = await response.text();
    return body.split("\n").some((line) => {
      const [candidate, count] = line.trim().split(":");
      return candidate === suffix && Number(count) > 0;
    });
  } catch (error) {
    log.warn("password.breach_check_unavailable", errorFields(error));
    return null;
  }
};
