import { expect, type Page } from "@playwright/test";

import { SEED_PASSWORD } from "./db";

export async function signIn(page: Page, email: string, password = SEED_PASSWORD): Promise<void> {
  await page.goto("/login");
  // exact: true so "Password" doesn't also match the "Show password" toggle.
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
