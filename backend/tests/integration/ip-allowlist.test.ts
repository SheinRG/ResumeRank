import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateApiKey } from "../../src/api/auth";
import { MAX_IP_RANGES } from "../../src/auth/ip-allowlist";
import { db } from "../../src/db";
import { createApiKey } from "../../src/services/api-keys";
import type { TenantContext } from "../../src/services/context";
import { ConflictError, FeatureUnavailableError, ForbiddenError } from "../../src/services/errors";
import { addIpRange, listIpRanges, removeIpRange } from "../../src/services/ip-allowlist";
import { addIpRangeSchema } from "../../src/validators/ip-allowlist";
import { createTenant, destroyTenant, type TenantFixture } from "./fixtures";

let t: TenantFixture;
let admin: TenantContext;

function input(cidr: string, label = "") {
  return addIpRangeSchema.parse({ cidr, label });
}

beforeAll(async () => {
  t = await createTenant("ip-allowlist");
  admin = { ...t.owner, role: "ADMIN" };
});

afterAll(async () => {
  if (t) await destroyTenant(t);
});

describe("IP allowlist", () => {
  it("lets an owner turn it on, and records it in the audit log", async () => {
    const range = await addIpRange(t.owner, input("203.0.113.0/24", "Office"));
    expect(range).toMatchObject({ cidr: "203.0.113.0/24", label: "Office" });
    expect((await listIpRanges(admin)).map((item) => item.cidr)).toEqual(["203.0.113.0/24"]);

    const entry = await db.activityLog.findFirstOrThrow({
      where: { companyId: t.companyId, action: "company.ip_allowlist_add" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry.summary).toBe("turned on IP allowlisting with 203.0.113.0/24");
  });

  it("refuses the same range twice, even written differently", async () => {
    await expect(addIpRange(t.owner, input(" 203.0.113.0/24 "))).rejects.toThrow(ConflictError);
  });

  it("is changed only by owners and seen only by admins", async () => {
    await expect(addIpRange(admin, input("198.51.100.0/24"))).rejects.toThrow(ForbiddenError);
    await expect(listIpRanges(t.viewer)).rejects.toThrow(ForbiddenError);
  });

  it("hands API authentication the workspace's ranges", async () => {
    const { token } = await createApiKey(t.owner, { name: "Allowlisted", scopes: ["jobs:read"], expiresInDays: null });
    const principal = await authenticateApiKey(token);
    expect(principal?.ipRanges).toEqual(["203.0.113.0/24"]);
  });

  it("caps the list", async () => {
    const existing = await db.ipAllowlistEntry.count({ where: { companyId: t.companyId } });
    await db.ipAllowlistEntry.createMany({
      data: Array.from({ length: MAX_IP_RANGES - existing }, (_, i) => ({
        companyId: t.companyId,
        cidr: `10.${i}.0.0/16`,
      })),
    });
    await expect(addIpRange(t.owner, input("192.0.2.0/24"))).rejects.toThrow(ConflictError);
    await db.ipAllowlistEntry.deleteMany({ where: { companyId: t.companyId, cidr: { startsWith: "10." } } });
  });

  it("can always be lifted, even without the entitlement", async () => {
    await db.featureFlagOverride.create({ data: { companyId: t.companyId, flag: "ip-allowlist", enabled: false } });
    try {
      await expect(addIpRange(t.owner, input("192.0.2.0/24"))).rejects.toThrow(FeatureUnavailableError);
      const [range] = await listIpRanges(t.owner);
      if (!range) throw new Error("expected a range");
      await removeIpRange(t.owner, { rangeId: range.id });
      expect(await listIpRanges(t.owner)).toEqual([]);

      const entry = await db.activityLog.findFirstOrThrow({
        where: { companyId: t.companyId, action: "company.ip_allowlist_remove" },
        orderBy: { createdAt: "desc" },
      });
      expect(entry.summary).toBe("turned off IP allowlisting (removed 203.0.113.0/24)");
    } finally {
      await db.featureFlagOverride.deleteMany({ where: { companyId: t.companyId, flag: "ip-allowlist" } });
    }
  });
});
