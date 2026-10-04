import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { forTenant, tenantDb, TenantViolationError } from "../../src/tenant-db";
import { createTenant, destroyTenant, type TenantFixture } from "./fixtures";

class Rollback extends Error {}

let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("tdb-a"), createTenant("tdb-b")]);
});

afterAll(async () => {
  await Promise.all([a, b].filter(Boolean).map(destroyTenant));
  await db.$disconnect();
});

describe("forTenant", () => {
  it("adds the tenant filter to reads that omit it", async () => {
    const scoped = forTenant(a.companyId);
    expect(await scoped.job.findUnique({ where: { id: b.jobId } })).toBeNull();
    expect((await scoped.job.findMany()).map((j) => j.id)).toEqual([a.jobId]);
    expect(await scoped.candidate.count()).toBe(1);
    expect(await scoped.application.findFirst({ where: { id: b.applicationId } })).toBeNull();
  });

  it("confines bulk writes to the tenant", async () => {
    const { count } = await forTenant(a.companyId).job.updateMany({
      where: { id: b.jobId },
      data: { title: "Overwritten" },
    });
    expect(count).toBe(0);
    await expect(
      forTenant(a.companyId).job.update({ where: { id: b.jobId }, data: { title: "Overwritten" } }),
    ).rejects.toMatchObject({ code: "P2025" });
  });

  it("stays scoped inside an interactive transaction", async () => {
    let deleted = -1;
    await expect(
      forTenant(a.companyId).$transaction(async (tx) => {
        ({ count: deleted } = await tx.candidate.deleteMany());
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);

    expect(deleted).toBe(1);
    expect(await db.candidate.count({ where: { companyId: b.companyId } })).toBe(1);
    expect(await db.candidate.count({ where: { companyId: a.companyId } })).toBe(1);
  });

  it("throws when a query names another tenant", async () => {
    const scoped = forTenant(a.companyId);
    await expect(scoped.job.findMany({ where: { companyId: b.companyId } })).rejects.toThrow(
      TenantViolationError,
    );
    await expect(
      scoped.activityLog.create({
        data: {
          companyId: b.companyId,
          actorId: a.owner.actorId,
          action: "probe",
          entityType: "job",
          entityId: b.jobId,
          summary: "cross-tenant write",
        },
      }),
    ).rejects.toThrow(TenantViolationError);
    expect(await db.activityLog.count({ where: { companyId: b.companyId, action: "probe" } })).toBe(0);
  });

  it("refuses to move a row to another tenant", async () => {
    await expect(
      forTenant(a.companyId).job.update({
        where: { id: a.jobId },
        data: { companyId: b.companyId },
      }),
    ).rejects.toThrow(TenantViolationError);
    expect((await db.job.findUniqueOrThrow({ where: { id: a.jobId } })).companyId).toBe(
      a.companyId,
    );
  });
});

describe("tenantDb", () => {
  it("reuses one scoped client per company", () => {
    expect(tenantDb(a.owner)).toBe(tenantDb(a.viewer));
    expect(tenantDb(a.owner)).not.toBe(tenantDb(b.owner));
  });
});
