import { describe, expect, it } from "vitest";

import { ipAllowed, networkAllows, parseIpRange } from "../../src/auth/ip-allowlist";
import { UNKNOWN_IP } from "../../src/request-ip";

describe("parseIpRange", () => {
  it("canonicalizes IPv4 and IPv6 ranges", () => {
    expect(parseIpRange(" 203.0.113.0/24 ")).toEqual({ cidr: "203.0.113.0/24" });
    expect(parseIpRange("2001:0DB8:0000::/48")).toEqual({ cidr: "2001:db8::/48" });
  });

  it("reads a single address as a one-address range", () => {
    expect(parseIpRange("198.51.100.7")).toEqual({ cidr: "198.51.100.7/32" });
    expect(parseIpRange("2001:db8::1")).toEqual({ cidr: "2001:db8::1/128" });
  });

  it("treats an IPv4-mapped IPv6 address as IPv4", () => {
    expect(parseIpRange("::ffff:198.51.100.7")).toEqual({ cidr: "198.51.100.7/32" });
  });

  it("refuses host bits and names the network that was probably meant", () => {
    expect(parseIpRange("10.1.2.3/8")).toEqual({
      error: "That isn't the start of a range. Did you mean 10.0.0.0/8?",
    });
    expect(parseIpRange("2001:db8::1/32")).toEqual({
      error: "That isn't the start of a range. Did you mean 2001:db8::/32?",
    });
  });

  it("refuses malformed input, impossible prefixes and allow-everything ranges", () => {
    for (const input of ["", "office", "300.1.1.1", "010.0.0.1", "fe80::1%eth0", "10.0.0.0/8/1", "10.0.0.0/x", "10.0.0.0/33", "::/129"]) {
      expect(parseIpRange(input)).toHaveProperty("error");
    }
    expect(parseIpRange("0.0.0.0/0")).toEqual({
      error: "That range allows every address. Remove the allowlist instead.",
    });
  });
});

describe("ipAllowed", () => {
  const ranges = ["203.0.113.0/24", "2001:db8::/48"];

  it("matches addresses inside any range", () => {
    expect(ipAllowed("203.0.113.200", ranges)).toBe(true);
    expect(ipAllowed("2001:db8:0:ffff::1", ranges)).toBe(true);
    expect(ipAllowed("::ffff:203.0.113.5", ranges)).toBe(true);
  });

  it("splits ranges inside a byte correctly", () => {
    expect(ipAllowed("10.15.255.255", ["10.0.0.0/12"])).toBe(true);
    expect(ipAllowed("10.16.0.0", ["10.0.0.0/12"])).toBe(false);
    expect(ipAllowed("2001:db8:0:3fff::1", ["2001:db8::/50"])).toBe(true);
    expect(ipAllowed("2001:db8:0:4000::1", ["2001:db8::/50"])).toBe(false);
    expect(parseIpRange("10.16.0.0/12")).toEqual({ cidr: "10.16.0.0/12" });
    expect(parseIpRange("10.17.0.0/12")).toHaveProperty("error");
  });

  it("never matches across families", () => {
    expect(ipAllowed("::1", ["0.0.0.0/1"])).toBe(false);
    expect(ipAllowed("10.0.0.1", ["::/1"])).toBe(false);
  });

  it("rejects addresses outside every range", () => {
    expect(ipAllowed("203.0.114.1", ranges)).toBe(false);
    expect(ipAllowed("2001:db9::1", ranges)).toBe(false);
  });

  it("fails closed when the client address couldn't be established", () => {
    expect(ipAllowed(UNKNOWN_IP, ranges)).toBe(false);
  });
});

describe("networkAllows", () => {
  const ipRanges = ["203.0.113.0/24"];

  it("doesn't restrict a workspace without ranges", () => {
    expect(networkAllows({ role: "MEMBER", ipRanges: [] }, UNKNOWN_IP)).toBe(true);
  });

  it("restricts everyone but owners to the ranges", () => {
    expect(networkAllows({ role: "ADMIN", ipRanges }, "198.51.100.1")).toBe(false);
    expect(networkAllows({ role: "MEMBER", ipRanges }, "203.0.113.9")).toBe(true);
    expect(networkAllows({ role: "OWNER", ipRanges }, "198.51.100.1")).toBe(true);
  });
});
