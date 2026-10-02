import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("../../src/db", () => ({ db: { company: { findMany } } }));

const { withUniqueCompanySlug } = await import("../../src/company");
const { Prisma } = await import("../../src/generated/prisma/client");

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("withUniqueCompanySlug", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("creates with the base slug when it is free", async () => {
    findMany.mockResolvedValue([]);
    const create = vi.fn(async (slug: string) => slug);

    await expect(withUniqueCompanySlug("Acme", create)).resolves.toBe("acme");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("retries with a fresh slug after losing a race on the unique index", async () => {
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ slug: "acme" }]);
    const create = vi
      .fn<(slug: string) => Promise<string>>()
      .mockRejectedValueOnce(uniqueViolation())
      .mockImplementation(async (slug) => slug);

    await expect(withUniqueCompanySlug("Acme", create)).resolves.toBe("acme-2");
    expect(create.mock.calls.map(([slug]) => slug)).toEqual(["acme", "acme-2"]);
  });

  it("gives up after three conflicts", async () => {
    findMany.mockResolvedValue([]);
    const create = vi.fn(async () => {
      throw uniqueViolation();
    });

    await expect(withUniqueCompanySlug("Acme", create)).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("does not retry unrelated errors", async () => {
    findMany.mockResolvedValue([]);
    const create = vi.fn(async () => {
      throw new Error("connection lost");
    });

    await expect(withUniqueCompanySlug("Acme", create)).rejects.toThrow("connection lost");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
