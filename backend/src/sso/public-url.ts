import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** Resolves a hostname to every address it answers with; injectable for tests. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const PRIVATE_RANGES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv4");
}
// No ::ffff:0:0/96 entry: BlockList already applies the IPv4 ranges above to
// IPv4-mapped addresses, and that rule would match every IPv4 address.
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv6");
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return PRIVATE_RANGES.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function resolveAll(hostname: string): Promise<string[]> {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
}

/**
 * Whether the server may fetch this URL on a tenant admin's behalf. The SSO
 * service fetches an OIDC discovery document from it, so an internal address
 * (cloud metadata, the database, localhost) would turn the settings form into
 * a request-forgery probe. Checked at save time; DNS can still change later,
 * which is why the URL must also be https.
 */
export async function isPublicHttpsUrl(
  value: string,
  resolve: HostResolver = resolveAll,
): Promise<boolean> {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) return false;

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return !isPrivateAddress(hostname);

  try {
    const addresses = await resolve(hostname);
    return addresses.length > 0 && addresses.every((address) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}
