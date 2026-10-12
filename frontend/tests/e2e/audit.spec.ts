import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { signIn, waitForHydration } from "./support/auth";
import { addMember, createOtherTenant, deleteTenant, uniqueTag, withDb, type OtherTenant } from "./support/db";

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

test.describe.serial("audit log", () => {
  test("an owner sees sign-ins, verifies the chain and downloads an export", async ({ page }) => {
    await signIn(page, tenant.email);

    await page.goto("/activity");
    await expect(page.getByText(/signed in with a password/).first()).toBeVisible();

    await page.goto("/settings/audit");
    await waitForHydration(page, "#audit-retention");
    await page.getByRole("button", { name: "Verify integrity" }).click();
    await expect(page.getByText(/check out\./)).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download export" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile(await file.path(), "utf8");
    expect(csv.split("\n")[0]).toBe(
      "seq,timestamp,action,entity_type,entity_id,actor_id,actor_name,actor_email,summary,metadata,prev_hash,hash",
    );
    expect(csv).toContain("auth.sign_in");

    await page.goto("/activity?entity=company");
    await expect(page.getByText(/exported \d+ audit entr/)).toBeVisible();
  });

  test("shortening retention is confirmed before it can delete anything", async ({ page }) => {
    await signIn(page, tenant.email);
    await page.goto("/settings/audit");
    await waitForHydration(page, "#audit-retention");

    await page.locator("#audit-retention").click();
    await page.getByRole("option", { name: "1 year" }).click();
    await page.getByRole("button", { name: "Save retention" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Delete entries older than 1 year?");
    await dialog.getByRole("button", { name: "Delete older entries" }).click();
    await expect(page.getByText("Audit entries older than 1 year will be deleted.")).toBeVisible();

    await page.reload();
    await expect(page.locator("#audit-retention")).toHaveText("1 year");
  });

  test("a member sees neither sign-ins nor the audit controls", async ({ page }) => {
    await signIn(page, memberEmail);

    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByText(/signed in with/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Export & retention" })).toHaveCount(0);

    await page.goto("/settings/audit");
    await expect(page.getByText("Exports, retention and streaming are managed by your workspace admins.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify integrity" })).toHaveCount(0);
  });
});
