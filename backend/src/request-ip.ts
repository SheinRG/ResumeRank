import { isIP } from "node:net";
import { env } from "./env";

interface HeaderSource {
  get(name: string): string | null;
}

export interface IpSourceOptions {
  /** A header the proxy in front of the app overwrites with the real client IP. */
  trustedHeader?: string;
  onVercel: boolean;
}

/** Shared bucket for requests whose IP can't be established (local dev, misconfigured proxy). */
export const UNKNOWN_IP = "unknown";

/**
 * The client IP, taken only from a source the client can't forge. A
 * client-sent X-Forwarded-For value would let an attacker pick a fresh IP per
 * request and dodge every per-IP limit, so:
 * - an explicitly trusted header wins;
 * - on Vercel, x-vercel-forwarded-for, which Vercel sets and no proxy
 *   in front of it can overwrite;
 * - otherwise the last X-Forwarded-For hop — the one the nearest proxy
 *   appended — never the first, which the client controls.
 */
export function resolveClientIp(headers: HeaderSource, options: IpSourceOptions): string {
  let candidate: string | undefined;
  if (options.trustedHeader) {
    candidate = headers.get(options.trustedHeader)?.split(",")[0];
  } else if (options.onVercel) {
    candidate = headers.get("x-vercel-forwarded-for")?.split(",")[0];
  } else {
    candidate = headers.get("x-forwarded-for")?.split(",").at(-1);
  }
  const ip = candidate?.trim() ?? "";
  return isIP(ip) ? ip : UNKNOWN_IP;
}

export function clientIp(headers: HeaderSource): string {
  const { TRUSTED_IP_HEADER, VERCEL } = env();
  return resolveClientIp(headers, {
    trustedHeader: TRUSTED_IP_HEADER || undefined,
    onVercel: Boolean(VERCEL),
  });
}
