import type { Role } from "../validators/enums";

/**
 * IP allowlist rules, shared by the guards, API authentication and the
 * settings form. No Node modules: the validator and the form run in the
 * browser too.
 */

/** Enough for offices, VPN egress and a CI runner pool; a longer list is usually a mistake. */
export const MAX_IP_RANGES = 50;

export type IpFamily = "ipv4" | "ipv6";

const BITS: Record<IpFamily, number> = { ipv4: 32, ipv6: 128 };
const IPV4 = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/;
const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export type ParsedIpRange = { cidr: string } | { error: string };

/** An IPv4 address that reached us wrapped as IPv6 is the IPv4 address it carries. */
export function unwrapMappedIpv4(address: string): string {
  return MAPPED_V4.exec(address)?.[1] ?? address;
}

/** The URL parser validates and canonicalizes IPv6, in Node and the browser alike. */
function canonicalIpv6(address: string): string | null {
  if (!address.includes(":") || /[[\]%/]/.test(address)) return null;
  try {
    return new URL(`http://[${address}]`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

/** The address's family, or null when it isn't an IP address. Octets with leading zeros are refused as ambiguous. */
export function ipFamily(address: string): IpFamily | null {
  if (IPV4.test(address)) return address.split(".").every((octet) => Number(octet) <= 255) ? "ipv4" : null;
  return canonicalIpv6(address) === null ? null : "ipv6";
}

/** The address as bytes: 4 for IPv4, 16 for IPv6. */
function toBytes(address: string, family: IpFamily): number[] {
  if (family === "ipv4") return address.split(".").map(Number);
  const groups = (canonicalIpv6(address) ?? "").split(":");
  const gap = groups.indexOf("");
  const present = groups.filter(Boolean);
  const expanded =
    gap === -1
      ? groups
      : [
          ...groups.slice(0, gap).filter(Boolean),
          ...Array<string>(8 - present.length).fill("0"),
          ...groups.slice(gap).filter(Boolean),
        ];
  return expanded.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function fromBytes(bytes: readonly number[], family: IpFamily): string {
  if (family === "ipv4") return bytes.join(".");
  const groups = Array.from({ length: 8 }, (_, i) => ((bytes[2 * i] ?? 0) * 256 + (bytes[2 * i + 1] ?? 0)).toString(16));
  return canonicalIpv6(groups.join(":")) ?? groups.join(":");
}

/** The first `prefix` bits of the address, the rest zeroed. */
function network(bytes: readonly number[], prefix: number): number[] {
  return bytes.map((byte, i) => {
    const kept = Math.min(8, Math.max(0, prefix - i * 8));
    return byte & ((0xff << (8 - kept)) & 0xff);
  });
}

function sameBytes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * Reads "203.0.113.0/24", "2001:db8::/48" or a single address into its
 * canonical CIDR. A range with host bits set is refused with the network it
 * probably meant, since silently widening or narrowing it would change who
 * gets in.
 */
export function parseIpRange(raw: string): ParsedIpRange {
  const [rawAddress = "", rawPrefix, ...rest] = raw.trim().split("/");
  const address = unwrapMappedIpv4(rawAddress);
  const family = ipFamily(address);
  if (!family || rest.length > 0) return { error: "Enter an IP address or a range like 203.0.113.0/24." };

  const bits = BITS[family];
  let prefix = bits;
  if (rawPrefix !== undefined) {
    if (!/^\d{1,3}$/.test(rawPrefix)) return { error: "The part after / must be a number." };
    prefix = Number(rawPrefix);
    if (prefix > bits) return { error: `An ${family === "ipv4" ? "IPv4" : "IPv6"} range ends at /${bits}.` };
  }
  if (prefix === 0) return { error: "That range allows every address. Remove the allowlist instead." };

  const bytes = toBytes(address, family);
  const start = network(bytes, prefix);
  if (!sameBytes(start, bytes)) {
    return { error: `That isn't the start of a range. Did you mean ${fromBytes(start, family)}/${prefix}?` };
  }
  return { cidr: `${fromBytes(start, family)}/${prefix}` };
}

function inRange(address: string, family: IpFamily, cidr: string): boolean {
  const [start = "", rawPrefix = ""] = cidr.split("/");
  if (ipFamily(start) !== family) return false;
  const prefix = Number(rawPrefix);
  return sameBytes(network(toBytes(address, family), prefix), network(toBytes(start, family), prefix));
}

/** Whether the client address falls in any of the ranges. An address we couldn't establish matches none. */
export function ipAllowed(ip: string, cidrs: readonly string[]): boolean {
  const address = unwrapMappedIpv4(ip);
  const family = ipFamily(address);
  return family !== null && cidrs.some((cidr) => inRange(address, family, cidr));
}

/**
 * Whether this member may use the workspace from this address. No ranges
 * means no restriction. Owners are exempt, as they are from SSO enforcement,
 * so a mistyped range or a changed office IP can't lock a company out of
 * the setting that fixes it.
 */
export function networkAllows(workspace: { role: Role; ipRanges: readonly string[] }, ip: string): boolean {
  return workspace.role === "OWNER" || workspace.ipRanges.length === 0 || ipAllowed(ip, workspace.ipRanges);
}
