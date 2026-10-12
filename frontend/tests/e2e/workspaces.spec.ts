import { expect, test, type Page } from "@playwright/test";

import { signIn, waitForHydration } from "./support/auth";
import {
  createOtherTenant,
  deleteTenant,
  joinCompany,
  uniqueTag,
  userIdByEmail,
  withDb,
  type OtherTenant,
} from "./support/db";

let agency: OtherTenant;
let client: OtherTenant;
let agencyName: string;
let clientName: string;
const createdName = `Side Project ${uniqueTag()}`;

test.beforeAll(async () => {
  await withDb(async (db) => {
    const [agencyTag, clientTag] = [uniqueTag(), uniqueTag()];
    agency = await createOtherTenant(db, agencyTag);
    client = await createOtherTenant(db, clientTag);
    agencyName = `Other Co ${agencyTag}`;
    clientName = `Other Co ${clientTag}`;
    await joinCompany(db, await userIdByEmail(db, agency.email), client.companyId, "VIEWER");
  });
});

test.afterAll(async () => {
  await withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM "Company" WHERE name = $1`, [createdName]);
    for (const { id } of rows) await db.query(`DELETE FROM "Company" WHERE id = $1`, [id]);
    if (client) await deleteTenant(db, client.companyId);
    if (agency) await deleteTenant(db, agency.companyId);
  });
});

function switcher(page: Page) {
  return page.getByRole("button", { name: /Switch workspace/ });
}

test.describe.serial("workspaces", () => {
  test("one account switches between its companies, with a role in each", async ({ page }) => {
    await signIn(page, agency.email);
    await expect(switcher(page)).toHaveAccessibleName(`Workspace: ${agencyName}. Switch workspace`);

    await waitForHydration(page, '[aria-label^="Workspace:"]');
    await switcher(page).click();
    await page.getByRole("menuitem", { name: new RegExp(clientName) }).click();
    await expect(page.getByText(`Switched to ${clientName}`)).toBeVisible();
    await expect(switcher(page)).toHaveAccessibleName(`Workspace: ${clientName}. Switch workspace`);

    // A viewer here, though an owner in the agency.
    await page.goto("/settings/company");
    await expect(page.getByText("Your company's profile. Contact an admin to make changes.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

    await page.reload();
    await expect(switcher(page)).toHaveAccessibleName(`Workspace: ${clientName}. Switch workspace`);
  });

  test("adds a new company alongside the ones the account already has", async ({ page }) => {
    await signIn(page, agency.email);
    await waitForHydration(page, '[aria-label^="Workspace:"]');
    await switcher(page).click();
    await page.getByRole("menuitem", { name: "Add a workspace" }).click();

    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByText(/Your current workspaces stay as they are/)).toBeVisible();
    await waitForHydration(page, "#onboarding-company-name");
    await page.getByLabel("Company name").fill(createdName);
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(switcher(page)).toHaveAccessibleName(`Workspace: ${createdName}. Switch workspace`);

    await switcher(page).click();
    for (const name of [agencyName, clientName, createdName]) {
      await expect(page.getByRole("menuitem", { name: new RegExp(name) })).toBeVisible();
    }
  });
});
