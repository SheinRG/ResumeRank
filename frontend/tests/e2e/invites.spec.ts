import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import {
  createDemoInvite,
  DEMO_ADMIN,
  deleteUsersByEmail,
  uniqueTag,
  withDb,
} from "./support/db";

const tag = uniqueTag();
const revokedEmail = `revoke-${tag}@e2e.test`;
const joinerEmail = `joiner-${tag}@e2e.test`;

test.afterAll(async () => {
  await withDb((db) => deleteUsersByEmail(db, [revokedEmail, joinerEmail]));
});

test("an admin invites a teammate and can revoke the invite", async ({ page }) => {
  await signIn(page, DEMO_ADMIN);
  await page.goto("/settings/team");

  await page.getByLabel("Invite teammate").fill(revokedEmail);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invite sent to ${revokedEmail}.`)).toBeVisible();

  const invite = page.getByText(revokedEmail, { exact: true });
  await expect(invite).toBeVisible();
  // The pending row is the email's nearest ancestor that also holds a Revoke button.
  await page
    .locator("div")
    .filter({ has: invite })
    .filter({ has: page.getByRole("button", { name: "Revoke" }) })
    .last()
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.getByText("Invite revoked.")).toBeVisible();
  await expect(page.getByText(revokedEmail, { exact: true })).toHaveCount(0);
});

test("an invitee accepts the emailed link and joins with the invited role", async ({ page }) => {
  // A retry must not trip over the account an earlier attempt created.
  const token = await withDb(async (db) => {
    await deleteUsersByEmail(db, [joinerEmail]);
    return createDemoInvite(db, joinerEmail, "VIEWER");
  });

  await page.goto(`/invite?token=${encodeURIComponent(token)}`);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(joinerEmail);
  await page.getByLabel("Name", { exact: true }).fill(`Joiner ${tag}`);
  await page.getByLabel("Password", { exact: true }).fill("joiner-password-123");
  await page.getByRole("button", { name: "Create account & join" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  // Invited as a viewer, so the writer-only affordances stay hidden.
  await page.goto("/jobs");
  await expect(page.getByRole("link", { name: "New job" })).toHaveCount(0);

  // The link is single-use.
  await page.context().clearCookies();
  await page.goto(`/invite?token=${encodeURIComponent(token)}`);
  await expect(page.getByText(/invalid|expired|no longer/i).first()).toBeVisible();
});
