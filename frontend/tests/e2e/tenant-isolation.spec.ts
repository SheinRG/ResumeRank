import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import {
  createOtherTenant,
  deleteTenant,
  demoCompanyId,
  uniqueTag,
  withDb,
  type OtherTenant,
} from "./support/db";

let other: OtherTenant;
let demoJobId: string;
let demoJobTitle: string;
let demoCandidateId: string;
let demoCandidateEmail: string;

test.beforeAll(async () => {
  await withDb(async (db) => {
    other = await createOtherTenant(db, uniqueTag());
    const companyId = await demoCompanyId(db);
    const job = await db.query<{ id: string; title: string }>(
      `SELECT id, title FROM "Job" WHERE "companyId" = $1 LIMIT 1`,
      [companyId],
    );
    const candidate = await db.query<{ id: string; email: string }>(
      `SELECT id, email FROM "Candidate" WHERE "companyId" = $1 LIMIT 1`,
      [companyId],
    );
    demoJobId = job.rows[0]?.id ?? "";
    demoJobTitle = job.rows[0]?.title ?? "";
    demoCandidateId = candidate.rows[0]?.id ?? "";
    demoCandidateEmail = candidate.rows[0]?.email ?? "";
  });
});

test.afterAll(async () => {
  if (other) await withDb((db) => deleteTenant(db, other.companyId));
});

/**
 * Another workspace's ids must behave as if they don't exist: the pages show
 * the not-found screen instead of the record, and the lists and APIs never
 * include the other tenant's rows. (Page status codes are not asserted: the
 * prerendered shell has already been sent with 200 by the time the guarded
 * content resolves to not-found.)
 */
test("another tenant's records are invisible", async ({ page }) => {
  expect(demoJobId).not.toBe("");
  await signIn(page, other.email);

  await page.goto("/jobs");
  await expect(page.getByText(/no jobs yet/i)).toBeVisible();
  await page.goto("/candidates");
  await expect(page.getByText(/no candidates yet/i)).toBeVisible();

  const probes = [
    { path: `/jobs/${demoJobId}`, secret: demoJobTitle },
    { path: `/candidates/${demoCandidateId}`, secret: demoCandidateEmail },
  ];
  for (const { path, secret } of probes) {
    await page.goto(path);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(page.getByText(secret)).toHaveCount(0);
  }

  const options = await page.request.get(`/api/jobs/${demoJobId}/candidate-options`);
  expect(await options.json()).toEqual([]);
  const progress = await page.request.get(`/api/jobs/${demoJobId}/scoring`);
  expect(progress.status()).toBe(404);
});
