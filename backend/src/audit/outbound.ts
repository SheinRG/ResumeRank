import { lookup, type LookupAddress, type LookupOptions } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * Posting to a customer-supplied URL from inside our network is a classic
 * SSRF: point it at 169.254.169.254 or a private address and the server
 * reads for you. These are the ranges no public endpoint lives in.
 */
const PRIVATE_RANGES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 127],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv6");
}

// BlockList checks IPv4 addresses against IPv4-mapped IPv6 rules too, so
// the mapped range can't be a rule; no public endpoint resolves to one.
const IPV4_MAPPED = /^::ffff:/i;

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6 && IPV4_MAPPED.test(address)) return false;
  return !PRIVATE_RANGES.check(address, family === 6 ? "ipv6" : "ipv4");
}

/** A delivery that didn't land: the endpoint refused it, or it never got there. */
export class OutboundError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "OutboundError";
  }
}

const MAX_URL_LENGTH = 2048;

/** Syntax only: https, no credentials, a hostname rather than a bare private address. */
export function parseOutboundUrl(raw: string): URL {
  if (raw.length > MAX_URL_LENGTH) throw new OutboundError("That URL is too long.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundError("Enter a full URL, starting with https://.");
  }
  if (url.protocol !== "https:") throw new OutboundError("The URL must start with https://.");
  if (url.username || url.password) {
    throw new OutboundError("Put credentials in the token field, not in the URL.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && !isPublicAddress(host)) {
    throw new OutboundError("The URL points at a private network address.");
  }
  return url;
}

function resolveAll(hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (error, addresses) => (error ? reject(error) : resolve(addresses)));
  });
}

/**
 * For saving a destination: the URL is well formed and its host resolves to
 * public addresses. Delivery re-checks on every connection (see
 * `publicOnlyLookup`), since DNS can change after this passes.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  const url = parseOutboundUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return url;
  let addresses: LookupAddress[];
  try {
    addresses = await resolveAll(host);
  } catch {
    throw new OutboundError(`${host} doesn't resolve. Check the address.`);
  }
  if (!addresses.some((entry) => isPublicAddress(entry.address))) {
    throw new OutboundError("The URL points at a private network address.");
  }
  return url;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * The resolver the connection itself uses, so the address checked is the
 * address dialled: a hostname that resolved publicly when it was saved
 * can't be re-pointed at an internal service afterwards (DNS rebinding).
 */
function publicOnlyLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }
    const allowed = addresses.filter((entry) => isPublicAddress(entry.address));
    const [first] = allowed;
    if (!first) {
      callback(new OutboundError("The destination resolves to a private network address."), []);
      return;
    }
    if (options.all) callback(null, allowed);
    else callback(null, first.address, first.family);
  });
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY_BYTES = 2_048;

export interface OutboundRequest {
  body: string;
  headers: Record<string, string>;
}

/** POSTs once and resolves on any 2xx; redirects are not followed. */
export function postOutbound(
  rawUrl: string,
  { body, headers }: OutboundRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const url = parseOutboundUrl(rawUrl);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        lookup: publicOnlyLookup,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          res.resume();
          res.on("end", () => resolve());
          return;
        }
        let detail = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (detail.length < MAX_ERROR_BODY_BYTES) detail += chunk;
        });
        res.on("end", () => {
          const snippet = detail.trim().slice(0, 300);
          reject(new OutboundError(`The endpoint answered ${status}${snippet ? `: ${snippet}` : "."}`, status));
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new OutboundError(`The endpoint didn't answer within ${timeoutMs / 1000} seconds.`));
    });
    req.on("error", (error) => {
      reject(error instanceof OutboundError ? error : new OutboundError(`Couldn't reach the endpoint: ${error.message}`));
    });
    req.end(body);
  });
}
