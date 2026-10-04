import { describe, expect, it, vi } from "vitest";

import { scopeTenantArgs, TenantViolationError } from "../../src/tenant-db";

// The rewrite rules are pure; stub the client so importing the module never
// opens a database connection.
vi.mock("../../src/db", () => ({ db: {} }));

const TENANT = "company-a";
const OTHER = "company-b";

describe("scopeTenantArgs", () => {
  it("leaves models without a companyId untouched", () => {
    const args = { where: { id: "u1" } };
    expect(scopeTenantArgs("User", "findUnique", args, TENANT)).toBe(args);
    expect(scopeTenantArgs("JobRequirement", "deleteMany", args, TENANT)).toBe(args);
  });

  it("adds the tenant filter to reads, including calls with no args", () => {
    expect(scopeTenantArgs("Job", "findMany", undefined, TENANT)).toEqual({
      where: { companyId: TENANT },
    });
    expect(
      scopeTenantArgs("Candidate", "findUnique", { where: { id: "c1" }, select: { id: true } }, TENANT),
    ).toEqual({ where: { id: "c1", companyId: TENANT }, select: { id: true } });
  });

  it("scopes counts, aggregates and bulk writes", () => {
    for (const operation of ["count", "aggregate", "groupBy", "updateMany", "deleteMany"]) {
      expect(scopeTenantArgs("Application", operation, { where: { stage: "NEW" } }, TENANT)).toEqual(
        { where: { stage: "NEW", companyId: TENANT } },
      );
    }
  });

  it("accepts a filter that already names the same tenant", () => {
    expect(scopeTenantArgs("Job", "findFirst", { where: { companyId: TENANT } }, TENANT)).toEqual({
      where: { companyId: TENANT },
    });
  });

  it("throws when a filter names another tenant", () => {
    expect(() =>
      scopeTenantArgs("ActivityLog", "findMany", { where: { companyId: OTHER } }, TENANT),
    ).toThrow(TenantViolationError);
  });

  it("sets companyId on every created row", () => {
    expect(scopeTenantArgs("Job", "create", { data: { title: "x" } }, TENANT)).toEqual({
      data: { title: "x", companyId: TENANT },
    });
    expect(
      scopeTenantArgs("ActivityLog", "createMany", { data: [{ action: "a" }, { action: "b" }] }, TENANT),
    ).toEqual({
      data: [
        { action: "a", companyId: TENANT },
        { action: "b", companyId: TENANT },
      ],
    });
  });

  it("rejects creates aimed at another tenant or through the company relation", () => {
    expect(() =>
      scopeTenantArgs("Candidate", "create", { data: { companyId: OTHER } }, TENANT),
    ).toThrow(TenantViolationError);
    expect(() =>
      scopeTenantArgs("Candidate", "createMany", { data: [{ companyId: OTHER }] }, TENANT),
    ).toThrow(TenantViolationError);
    expect(() =>
      scopeTenantArgs("Job", "create", { data: { company: { connect: { id: TENANT } } } }, TENANT),
    ).toThrow(TenantViolationError);
  });

  it("refuses updates that would move a row to another tenant", () => {
    expect(() =>
      scopeTenantArgs("Job", "update", { where: { id: "j1" }, data: { companyId: OTHER } }, TENANT),
    ).toThrow(TenantViolationError);
    expect(() =>
      scopeTenantArgs(
        "Job",
        "updateMany",
        { where: {}, data: { company: { connect: { id: OTHER } } } },
        TENANT,
      ),
    ).toThrow(TenantViolationError);
  });

  it("scopes all three parts of an upsert", () => {
    expect(
      scopeTenantArgs(
        "Application",
        "upsert",
        { where: { id: "a1" }, create: { stage: "NEW" }, update: { stage: "SCREENING" } },
        TENANT,
      ),
    ).toEqual({
      where: { id: "a1", companyId: TENANT },
      create: { stage: "NEW", companyId: TENANT },
      update: { stage: "SCREENING" },
    });
    expect(() =>
      scopeTenantArgs(
        "Application",
        "upsert",
        { where: { id: "a1" }, create: {}, update: { companyId: OTHER } },
        TENANT,
      ),
    ).toThrow(TenantViolationError);
  });

  it("does not mutate the caller's args", () => {
    const args = { where: { id: "j1" } };
    scopeTenantArgs("Job", "findUnique", args, TENANT);
    expect(args).toEqual({ where: { id: "j1" } });
  });
});
