import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { tenantTransaction } from "../../src/tenant-db";
import { createTenant, destroyTenant, type TenantFixture } from "./fixtures";

type IdRow = { id: string };

let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("rls-a"), createTenant("rls-b")]);
});

afterAll(async () => {
  await Promise.all([a, b].filter(Boolean).map(destroyTenant));
  await db.$disconnect();
});

const ids = (rows: IdRow[]) => rows.map((row) => row.id).sort();

// Raw SQL is used throughout on purpose: it bypasses the Prisma extension,
// so whatever these probes can't see is being hidden by Postgres itself.
describe("row-level security in tenant transactions", () => {
  it("runs as the tenant role", async () => {
    const [row] = await tenantTransaction(a, (tx) =>
      tx.$queryRaw<Array<{ role: string }>>`SELECT current_user AS "role"`,
    );
    expect(row?.role).toBe("resumerank_tenant");
  });

  it("shows raw SQL only the tenant's rows, child tables included", async () => {
    const visible = await tenantTransaction(a, async (tx) => ({
      companies: await tx.$queryRaw<IdRow[]>`SELECT "id" FROM "Company"`,
      jobs: await tx.$queryRaw<IdRow[]>`SELECT "id" FROM "Job"`,
      candidates: await tx.$queryRaw<IdRow[]>`SELECT "id" FROM "Candidate"`,
      applications: await tx.$queryRaw<IdRow[]>`SELECT "id" FROM "Application"`,
      runs: await tx.$queryRaw<IdRow[]>`SELECT "id" FROM "ScoringRun"`,
      invites: await tx.$queryRaw<IdRow[]>`SELECT "id" FROM "CompanyInvite"`,
      activityTenants: await tx.$queryRaw<IdRow[]>`SELECT DISTINCT "companyId" AS "id" FROM "ActivityLog"`,
      requirementJobs: await tx.$queryRaw<IdRow[]>`SELECT DISTINCT "jobId" AS "id" FROM "JobRequirement"`,
      scorecardApplications: await tx.$queryRaw<IdRow[]>`SELECT DISTINCT "applicationId" AS "id" FROM "Scorecard"`,
      evaluationRuns: await tx.$queryRaw<IdRow[]>`SELECT DISTINCT "scoringRunId" AS "id" FROM "Evaluation"`,
    }));

    expect(ids(visible.companies)).toEqual([a.companyId]);
    expect(ids(visible.jobs)).toEqual([a.jobId]);
    expect(ids(visible.candidates)).toEqual([a.candidateId]);
    expect(ids(visible.applications)).toEqual([a.applicationId]);
    expect(ids(visible.runs)).toEqual([a.scoringRunId]);
    expect(ids(visible.invites)).toEqual([a.inviteId]);
    expect(ids(visible.activityTenants)).toEqual([a.companyId]);
    expect(ids(visible.requirementJobs)).toEqual([a.jobId]);
    expect(ids(visible.scorecardApplications)).toEqual([a.applicationId]);
    expect(ids(visible.evaluationRuns)).toEqual([a.scoringRunId]);
  });

  it("confines raw writes to the tenant", async () => {
    const [updated, deleted] = await tenantTransaction(a, async (tx) => [
      await tx.$executeRaw`UPDATE "Job" SET "title" = 'Overwritten' WHERE "id" = ${b.jobId}`,
      await tx.$executeRaw`DELETE FROM "Candidate" WHERE "id" = ${b.candidateId}`,
    ]);

    expect([updated, deleted]).toEqual([0, 0]);
    expect((await db.job.findUniqueOrThrow({ where: { id: b.jobId } })).title).not.toBe("Overwritten");
    expect(await db.candidate.count({ where: { id: b.candidateId } })).toBe(1);
  });

  it("rejects nested writes that point at another tenant's rows", async () => {
    await expect(
      tenantTransaction(a, (tx) =>
        tx.candidate.update({
          where: { id: a.candidateId },
          data: {
            applications: {
              create: { jobId: b.jobId, companyId: a.companyId, createdById: a.owner.actorId },
            },
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);

    await expect(
      tenantTransaction(a, (tx) =>
        tx.$executeRaw`
          INSERT INTO "JobRequirement" ("id", "jobId", "label")
          VALUES ('rls-probe', ${b.jobId}, 'Injected')
        `,
      ),
    ).rejects.toThrow(/row-level security/);

    expect(await db.application.count({ where: { jobId: b.jobId } })).toBe(1);
    expect(await db.jobRequirement.count({ where: { id: "rls-probe" } })).toBe(0);
  });

  it("keeps the audit trail and scoring evidence append-only", async () => {
    await expect(
      tenantTransaction(a, (tx) => tx.$executeRaw`DELETE FROM "ActivityLog" WHERE "companyId" = ${a.companyId}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      tenantTransaction(a, (tx) => tx.$executeRaw`UPDATE "Evaluation" SET "note" = 'Rewritten'`),
    ).rejects.toThrow(/permission denied/);
  });

  it("covers every table that carries a companyId", async () => {
    const unprotected = await db.$queryRaw<Array<{ table: string }>>`
      SELECT c."relname" AS "table"
      FROM pg_class c
      JOIN pg_namespace n ON n."oid" = c."relnamespace"
      WHERE n."nspname" = current_schema()
        AND c."relkind" = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col."table_schema" = n."nspname"
            AND col."table_name" = c."relname"
            AND col."column_name" = 'companyId'
        )
        AND NOT (
          c."relrowsecurity"
          AND EXISTS (
            SELECT 1 FROM pg_policies p
            WHERE p."schemaname" = n."nspname" AND p."tablename" = c."relname"
          )
        )
    `;
    // Users are identities, not tenant data: removing a member nulls their
    // companyId, and invites look people up across workspaces by email.
    expect(unprotected.map((row) => row.table)).toEqual(["User"]);
  });
});
