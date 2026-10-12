import { expect, test, type Page } from "@playwright/test";

import { signIn, waitForHydration } from "./support/auth";
import {
  addMember,
  createOtherTenant,
  deleteTenant,
  SEED_PASSWORD,
  uniqueTag,
  withDb,
  type OtherTenant,
} from "./support/db";
import { totpCode } from "./support/totp";

let tenant: OtherTenant;
let memberEmail: string;
let setupKey = "";
let recoveryCodes: string[] = [];

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

/** A password sign-in for someone with a second factor stops at the challenge. */
async function logInToChallenge(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await waitForHydration(page, 'button[type="submit"]');
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/mfa(\?|$)/);
}

async function openSecuritySettings(page: Page): Promise<void> {
  await page.goto("/settings/security");
  await waitForHydration(page, "#passkey-name");
}

/** Runs authenticator-app setup from the "Set up authenticator app" button; returns the setup key. */
async function setUpAuthenticatorApp(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const key = (await page.getByRole("button", { name: "Copy Setup key" }).locator("..").locator("code").textContent()) ?? "";
  expect(key.replace(/\s/g, "")).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel("Code from your app").fill(totpCode(key));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("Save these recovery codes now")).toBeVisible();
  return key;
}

async function readRecoveryCodes(page: Page): Promise<string[]> {
  const items = await page.getByRole("listitem").allTextContents();
  return items.map((item) => item.trim()).filter((item) => /^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/.test(item));
}

async function useRecoveryCode(page: Page, code: string): Promise<void> {
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await page.getByLabel("Recovery code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe.serial("two-factor authentication", () => {
  test("an authenticator app turns MFA on and guards the next sign-in", async ({ page }) => {
    await signIn(page, tenant.email);
    await openSecuritySettings(page);
    await expect(page.getByRole("region", { name: "Authenticator app" })).toBeVisible();

    setupKey = await setUpAuthenticatorApp(page);
    recoveryCodes = await readRecoveryCodes(page);
    expect(recoveryCodes).toHaveLength(10);
    await page.getByRole("button", { name: "I've saved them" }).click();
    await expect(page.getByText("Save these recovery codes now")).toHaveCount(0);
    await expect(page.getByText(/^Added /)).toBeVisible();

    await logInToChallenge(page, tenant.email);
    // The challenge holds the app shut until the factor is proven.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/mfa/);

    await page.getByLabel("Code from your authenticator app").fill(totpCode(setupKey, 1));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("a recovery code and a passkey also finish the sign-in", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await logInToChallenge(page, tenant.email);
    await useRecoveryCode(page, recoveryCodes[0] ?? "");
    // A spent code doesn't work twice.
    await logInToChallenge(page, tenant.email);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(recoveryCodes[0] ?? "");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("isn't valid or was already used").first()).toBeVisible();
    await page.getByLabel("Recovery code").fill(recoveryCodes[1] ?? "");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await openSecuritySettings(page);
    await page.getByLabel("Passkey name").fill("Virtual key");
    await page.getByRole("button", { name: "Add passkey" }).click();
    await expect(page.getByText("Virtual key", { exact: true })).toBeVisible();

    await logInToChallenge(page, tenant.email);
    await page.getByRole("button", { name: "Use a passkey" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("requiring MFA holds members without it at setup", async ({ page }) => {
    await logInToChallenge(page, tenant.email);
    await useRecoveryCode(page, recoveryCodes[2] ?? "");
    await openSecuritySettings(page);
    await page.getByRole("switch", { name: "Require two-factor authentication" }).click();
    await expect(page.getByText("Two-factor authentication is now required.")).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/login");
    await waitForHydration(page, 'button[type="submit"]');
    await page.getByLabel("Email", { exact: true }).fill(memberEmail);
    await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/mfa\/setup/);
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/mfa\/setup/);

    await setUpAuthenticatorApp(page);
    await page.getByRole("button", { name: "I've saved them" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
