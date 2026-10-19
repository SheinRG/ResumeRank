import { expect, test, type Browser, type Page } from "@playwright/test";

import { signIn, waitForHydration } from "./support/auth";
import {
  addMember,
  createOtherTenant,
  DEMO_ADMIN,
  deleteTenant,
  uniqueTag,
  userIdByEmail,
  withDb,
  type OtherTenant,
} from "./support/db";
import { totpCode } from "./support/totp";

let customer: OtherTenant;
let staffHome: OtherTenant;
let memberEmail: string;
let staff: Page;
const REASON = "Ticket 1042: the candidate list looks empty to them";

test.beforeAll(async () => {
  await withDb(async (db) => {
    const tag = uniqueTag();
    customer = await createOtherTenant(db, tag);
    memberEmail = await addMember(db, customer.companyId, tag);
    staffHome = await createOtherTenant(db, `staff-${tag}`);
    await db.query(`INSERT INTO "StaffMember" ("userId", role) VALUES ($1, 'ADMIN')`, [
      await userIdByEmail(db, staffHome.email),
    ]);
  });
});

test.afterAll(async () => {
  await staff?.context().close();
  await withDb(async (db) => {
    if (customer) await deleteTenant(db, customer.companyId);
    if (staffHome) await deleteTenant(db, staffHome.companyId);
  });
});

/** Staff keep one browser across the tests, as a person would: one sign-in, one second factor. */
async function staffPage(browser: Browser): Promise<Page> {
  staff ??= await (await browser.newContext()).newPage();
  return staff;
}

async function asOwner(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, customer.email);
  return page;
}

async function openCustomer(page: Page): Promise<void> {
  await page.goto(`/staff/companies/${customer.companyId}`);
  await waitForHydration(page, "table button");
}

test.describe.serial("staff console", () => {
  test("is a missing page for anyone who isn't staff", async ({ page }) => {
    await signIn(page, DEMO_ADMIN);
    // The staff check streams inside a boundary, so the not-found page
    // arrives after the status line, as for any missing record in the app.
    await page.goto("/staff");
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Workspaces" })).toHaveCount(0);
  });

  test("needs staff's own second factor, then finds a workspace by a member's email", async ({ browser }) => {
    const page = await staffPage(browser);
    await signIn(page, staffHome.email);
    await page.goto("/staff");
    await expect(page.getByText("Your own second factor first")).toBeVisible();

    await page.goto("/settings/security");
    await waitForHydration(page, "#passkey-name");
    await page.getByRole("button", { name: "Set up authenticator app" }).click();
    const key = (await page.getByRole("button", { name: "Copy Setup key" }).locator("..").locator("code").textContent()) ?? "";
    await page.getByLabel("Code from your app").fill(totpCode(key));
    await page.getByRole("button", { name: "Turn on" }).click();
    await page.getByRole("button", { name: "I've saved them" }).click();

    await page.goto(`/staff?q=${encodeURIComponent(memberEmail)}`);
    await page.getByRole("link", { name: /^Other Co / }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/companies/${customer.companyId}`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Other Co /);
    await expect(page.getByText(memberEmail, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "View as" }).first()).toBeDisabled();
  });

  test("views a workspace as a member, read-only, once its owner grants support access", async ({ browser }) => {
    const owner = await asOwner(browser);
    await owner.goto("/settings/security");
    await waitForHydration(owner, "#support-access-days");
    await owner.getByRole("button", { name: "Grant access" }).click();
    await expect(owner.getByText("Support access granted.")).toBeVisible();

    const page = await staffPage(browser);
    await openCustomer(page);
    const row = page.getByRole("row").filter({ hasText: memberEmail });
    await row.getByRole("button", { name: "View as" }).click();
    await page.getByLabel("Reason").fill(REASON);
    await page.getByRole("button", { name: "Start support session" }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Support session, read-only.")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Support session" })).toContainText("Member ");

    await page.goto("/settings/account");
    await expect(page.getByText("aren't shown in a support session")).toBeVisible();

    await page.goto("/settings");
    await waitForHydration(page, 'button[type="submit"]');
    await page.getByLabel("Name").fill("Renamed by support");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("You're in a read-only support session")).toBeVisible();
    const name = await withDb(async (db) => {
      const { rows } = await db.query<{ name: string }>(`SELECT name FROM "User" WHERE email = $1`, [memberEmail]);
      return rows[0]?.name;
    });
    expect(name).not.toBe("Renamed by support");

    await page.getByRole("button", { name: "End session" }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/companies/${customer.companyId}`));
    await expect(page.getByRole("cell", { name: REASON }).first()).toBeVisible();

    await owner.reload();
    await expect(owner.getByRole("cell", { name: REASON })).toBeVisible();
    await owner.context().close();
  });

  test("a suspended workspace can't be opened until the suspension is lifted", async ({ browser }) => {
    const page = await staffPage(browser);
    await openCustomer(page);
    await page.getByRole("button", { name: "Suspend workspace" }).click();
    await page.getByLabel("Reason").fill(REASON);
    await page.getByRole("button", { name: "Suspend", exact: true }).click();
    await expect(page.getByText(/is suspended\./)).toBeVisible();

    const owner = await (await browser.newContext()).newPage();
    await owner.goto("/login");
    await owner.getByLabel("Email", { exact: true }).fill(customer.email);
    await owner.getByLabel("Password", { exact: true }).fill("demo1234");
    await owner.getByRole("button", { name: "Log in" }).click();
    await expect(owner).toHaveURL(/\/workspace-suspended/);

    await page.getByRole("button", { name: "Lift suspension" }).click();
    await page.getByLabel("Reason").fill(REASON);
    await page.getByRole("button", { name: "Lift suspension" }).last().click();
    await expect(page.getByText(/is active again\./)).toBeVisible();

    await owner.goto("/dashboard");
    await expect(owner).toHaveURL(/\/dashboard/);
    await owner.context().close();
  });
});
