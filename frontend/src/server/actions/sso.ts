"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import { requireAdmin, tenantContext } from "@/lib/auth/guards";
import { isSsoEnabled } from "@resumerank/core/env";
import { rateLimit, retryMessage, SSO_START_LIMIT } from "@resumerank/core/rate-limit";
import { clientIp } from "@resumerank/core/request-ip";
import {
  addDomain,
  removeDomain,
  removeSsoConnection,
  saveSsoConnection,
  setDomainAutoJoin,
  setSsoEnforced,
  verifyDomain,
  type SsoConnectionSummary,
  type SsoDomain,
} from "@resumerank/core/services/sso";
import { SSO_PRODUCT, SSO_PROVIDER_ID } from "@resumerank/core/sso/jackson";
import { findSsoTenant } from "@resumerank/core/sso/login";
import {
  addDomainSchema,
  domainIdSchema,
  saveSsoConnectionSchema,
  setDomainAutoJoinSchema,
  setSsoEnforcedSchema,
  ssoLoginSchema,
} from "@resumerank/core/validators/sso";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

const SETTINGS_PATH = "/settings/sso";

const nextPathSchema = z
  .string()
  .optional()
  .transform((next) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"));

/**
 * Starts an SSO login for whichever company has verified the email's domain.
 * Returns the URL to send the browser to rather than redirecting, so the form
 * can say "no SSO for that domain" inline; Auth.js has already set its state
 * and PKCE cookies by the time the URL comes back.
 */
export async function signInWithSsoAction(
  input: unknown,
  next?: string,
): Promise<ActionResult<{ url: string }>> {
  return runAction("signInWithSso", async () => {
    const parsed = ssoLoginSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    if (!isSsoEnabled()) return actionError("Single sign-on isn't available on this site.");

    const limited = await rateLimit(`sso-login:${clientIp(await headers())}`, SSO_START_LIMIT);
    if (!limited.allowed) {
      return actionError(`Too many attempts. Try again in ${retryMessage(limited.retryAfterSeconds)}.`);
    }

    const tenant = await findSsoTenant(parsed.data.email);
    if (!tenant) {
      const message = "Single sign-on isn't set up for that email domain.";
      return actionError(`${message} Log in with your password, or ask your admin.`, { email: [message] });
    }

    const url: unknown = await signIn(
      SSO_PROVIDER_ID,
      { redirectTo: nextPathSchema.parse(next), redirect: false },
      { tenant: tenant.companyId, product: SSO_PRODUCT },
    );
    if (typeof url !== "string") throw new Error("SSO sign-in returned no redirect URL");
    return actionOk({ url });
  });
}

export async function addSsoDomainAction(input: unknown): Promise<ActionResult<SsoDomain>> {
  return runAction("addSsoDomain", async () => {
    const parsed = addDomainSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    const domain = await addDomain(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(domain);
  });
}

export async function verifySsoDomainAction(input: unknown): Promise<ActionResult<SsoDomain>> {
  return runAction("verifySsoDomain", async () => {
    const parsed = domainIdSchema.safeParse(input);
    if (!parsed.success) return actionError("That domain could not be found.");
    const admin = await requireAdmin();
    const domain = await verifyDomain(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(domain);
  });
}

export async function setSsoDomainAutoJoinAction(input: unknown): Promise<ActionResult<SsoDomain>> {
  return runAction("setSsoDomainAutoJoin", async () => {
    const parsed = setDomainAutoJoinSchema.safeParse(input);
    if (!parsed.success) return actionError("That domain could not be found.");
    const admin = await requireAdmin();
    const domain = await setDomainAutoJoin(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(domain);
  });
}

export async function removeSsoDomainAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction("removeSsoDomain", async () => {
    const parsed = domainIdSchema.safeParse(input);
    if (!parsed.success) return actionError("That domain could not be found.");
    const admin = await requireAdmin();
    const removed = await removeDomain(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(removed);
  });
}

export async function saveSsoConnectionAction(
  input: unknown,
): Promise<ActionResult<SsoConnectionSummary>> {
  return runAction("saveSsoConnection", async () => {
    const parsed = saveSsoConnectionSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    const connection = await saveSsoConnection(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(connection);
  });
}

export async function removeSsoConnectionAction(): Promise<ActionResult<{ removed: true }>> {
  return runAction("removeSsoConnection", async () => {
    const admin = await requireAdmin();
    const removed = await removeSsoConnection(tenantContext(admin));
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(removed);
  });
}

export async function setSsoEnforcedAction(
  input: unknown,
): Promise<ActionResult<{ enforced: boolean }>> {
  return runAction("setSsoEnforced", async () => {
    const parsed = setSsoEnforcedSchema.safeParse(input);
    if (!parsed.success) return actionError("Choose whether to require SSO.");
    const admin = await requireAdmin();
    const result = await setSsoEnforced(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(result);
  });
}
