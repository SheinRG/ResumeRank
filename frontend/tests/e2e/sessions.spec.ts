import { expect, test, type Browser, type Page } from "@playwright/test";

import { signIn, waitForHydration } from "./support/auth";
import { addMember, createOtherTenant, deleteTenant, uniqueTag, withDb, type OtherTenant } from "./support/db";

const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0";

let tenant: OtherTenant;
let memberEmail: string;

test.beforeAll(async () => {
  await withDb(async (db) => {
    const tag = uniqueTag();
    tenant = await createOtherTenant(db, tag);
    memberEmail = await addMember(db, tenant.companyId, tag);
  });
});

test.afterAll(async () => {
  if (tenant) await withDb((db) => deleteTenant(db, tenant.companyId));
});

/** A second device: its own cookie jar and a user agent the sessions list can tell apart. */
async function signInOnSecondDevice(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ userAgent: FIREFOX_LINUX });
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

async function expectSignedOut(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?error=SessionExpired/);
}

test.describe.serial("session management", () => {
  test("revoking a session from the list signs that device out", async ({ page, browser }) => {
    const other = await signInOnSecondDevice(browser, memberEmail);
    await signIn(page, memberEmail);

    await page.goto("/settings/security");
    await waitForHydration(page, 'button[aria-label="Sign out of Firefox on Linux"]');
    const sessions = page.getByRole("list").filter({ hasText: "This device" });
    await expect(sessions.getByRole("listitem")).toHaveCount(2);
    await expect(sessions.getByText("Firefox on Linux")).toBeVisible();

    await page.getByRole("button", { name: "Sign out of Firefox on Linux" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("Signed out of Firefox on Linux.")).toBeVisible();
    await expect(sessions.getByRole("listitem")).toHaveCount(1);

    await expectSignedOut(other);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await other.context().close();
  });

  test("an admin can sign a teammate out everywhere", async ({ page, browser }) => {
    const member = await signInOnSecondDevice(browser, memberEmail);
    await signIn(page, tenant.email);

    await page.goto("/settings/team");
    await waitForHydration(page, 'button[aria-label^="Sign Member"]');
    await page.getByRole("button", { name: /^Sign Member .* out everywhere$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText(/^Signed Member .* out of every session\.$/)).toBeVisible();

    await expectSignedOut(member);
    await member.context().close();
  });
});
