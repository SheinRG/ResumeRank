import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import type { TenantContext } from "../../src/services/context";
import { ConflictError, DomainError, ForbiddenError } from "../../src/services/errors";
import {
  addDomain,
  getSsoSettings,
  removeDomain,
  removeSsoConnection,
  saveSsoConnection,
  setDomainAutoJoin,
  setSsoEnforced,
  verifyDomain,
} from "../../src/services/sso";
import { verificationRecordName } from "../../src/sso/domains";
import {
  closeSso,
  SSO_PRODUCT,
  serviceProviderDetails,
  ssoCallbackUrl,
  ssoClientSecret,
  ssoControllers,
} from "../../src/sso/jackson";
import { findSsoTenant, resolveSsoSignIn } from "../../src/sso/login";
import { ssoStore } from "../../src/sso/store";
import { createFakeIdp, type FakeIdp } from "./saml-idp";

interface Workspace {
  companyId: string;
  owner: TenantContext;
  admin: TenantContext;
  domain: string;
  userIds: string[];
}

async function createWorkspace(tag: string): Promise<Workspace> {
  const company = await db.company.create({ data: { name: `SSO ${tag}`, slug: `sso-${tag}` } });
  const [owner, admin] = await Promise.all(
    (["OWNER", "ADMIN"] as const).map((role) =>
      db.user.create({
        data: {
          name: `${role} ${tag}`,
          email: `${role.toLowerCase()}-${tag}@example.test`,
          role,
          companyId: company.id,
        },
      }),
    ),
  );
  return {
    companyId: company.id,
    owner: { companyId: company.id, actorId: owner.id, role: "OWNER" },
    admin: { companyId: company.id, actorId: admin.id, role: "ADMIN" },
    domain: `${tag}.example.test`,
    userIds: [owner.id, admin.id],
  };
}

/** A resolver that publishes whatever TXT record the domain row asks for. */
async function publishedRecord(domainId: string) {
  const row = await db.companyDomain.findUniqueOrThrow({ where: { id: domainId } });
  return async (hostname: string) =>
    hostname === verificationRecordName(row.domain)
      ? [["resumerank-domain-", `verification=${row.verificationToken}`]]
      : [];
}

async function verifiedDomain(workspace: Workspace, autoJoin: boolean): Promise<string> {
  const added = await addDomain(workspace.owner, { domain: workspace.domain });
  await verifyDomain(workspace.owner, { domainId: added.id }, await publishedRecord(added.id));
  if (autoJoin) await setDomainAutoJoin(workspace.owner, { domainId: added.id, autoJoin: true });
  return added.id;
}

/** Drives Jackson exactly as the /api/oauth routes and Auth.js would. */
async function signInThroughJackson(
  workspace: Workspace,
  idp: FakeIdp,
  email: string,
  tamper?: (xml: string) => string,
) {
  const { oauthController } = await ssoControllers();
  const verifier = randomBytes(32).toString("base64url");
  const state = randomUUID();

  const authorized = await oauthController.authorize({
    client_id: "dummy",
    tenant: workspace.companyId,
    product: SSO_PRODUCT,
    redirect_uri: ssoCallbackUrl(),
    response_type: "code",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  expect(authorized.error).toBeUndefined();
  const idpUrl = new URL(authorized.redirect_url ?? "");
  const samlRequest = idpUrl.searchParams.get("SAMLRequest") ?? "";
  const relayState = idpUrl.searchParams.get("RelayState") ?? "";

  let samlResponse = await idp.respond({
    samlRequest,
    email,
    audience: serviceProviderDetails().entityId,
  });
  if (tamper) {
    samlResponse = Buffer.from(tamper(Buffer.from(samlResponse, "base64").toString("utf8"))).toString("base64");
  }

  const posted = await oauthController.samlResponse({ SAMLResponse: samlResponse, RelayState: relayState });
  if (posted.error || !posted.redirect_url) return { ok: false as const, error: posted.error ?? "" };

  const callback = new URL(posted.redirect_url);
  expect(callback.searchParams.get("state")).toBe(state);
  // Auth.js sends the PKCE verifier in the body and its client credentials as HTTP Basic.
  const token = await oauthController.token(
    {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") ?? "",
      redirect_uri: ssoCallbackUrl(),
      code_verifier: verifier,
    },
    `Basic ${Buffer.from(`dummy:${ssoClientSecret()}`).toString("base64")}`,
  );
  const profile = await oauthController.userInfo(token.access_token);
  return { ok: true as const, profile };
}

const workspaces: Workspace[] = [];
const extraUserEmails: string[] = [];

async function workspace(label: string): Promise<Workspace> {
  const created = await createWorkspace(`${label}-${randomUUID().slice(0, 8)}`);
  workspaces.push(created);
  return created;
}

beforeAll(async () => {
  await ssoControllers();
});

afterAll(async () => {
  for (const ws of workspaces) {
    const { connectionAPIController } = await ssoControllers();
    await connectionAPIController.deleteConnections({ tenant: ws.companyId, product: SSO_PRODUCT });
    await db.company.deleteMany({ where: { id: ws.companyId } });
    await db.user.deleteMany({ where: { id: { in: ws.userIds } } });
  }
  await db.user.deleteMany({ where: { email: { in: extraUserEmails } } });
  await closeSso();
});

describe("SAML sign-in through the embedded service", () => {
  it("accepts a signed assertion and reports the tenant it was started for", async () => {
    const ws = await workspace("flow");
    const idp = createFakeIdp(ws.domain);
    await verifiedDomain(ws, true);
    await saveSsoConnection(ws.owner, { type: "saml", metadataXml: idp.metadataXml });

    const email = `ada@${ws.domain}`;
    extraUserEmails.push(email);
    const result = await signInThroughJackson(ws, idp, email);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.email).toBe(email);
    expect(result.profile.requested.tenant).toBe(ws.companyId);
    expect(await findSsoTenant(email)).toEqual({ companyId: ws.companyId });
  });

  it("rejects an assertion edited after the IdP signed it", async () => {
    const ws = await workspace("tamper");
    const idp = createFakeIdp(ws.domain);
    await verifiedDomain(ws, false);
    await saveSsoConnection(ws.owner, { type: "saml", metadataXml: idp.metadataXml });

    const result = await signInThroughJackson(ws, idp, `ada@${ws.domain}`, (xml) =>
      xml.replaceAll(`ada@${ws.domain}`, `owner@${ws.domain}`),
    );
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/signature/i) });
  });

  it("rejects an assertion signed by a different identity provider", async () => {
    const ws = await workspace("forged");
    await verifiedDomain(ws, false);
    await saveSsoConnection(ws.owner, { type: "saml", metadataXml: createFakeIdp(ws.domain).metadataXml });

    const impostor = createFakeIdp(ws.domain);
    const result = await signInThroughJackson(ws, impostor, `ada@${ws.domain}`);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/signature|certificate/i) });
  });

  it("refuses metadata that isn't SAML", async () => {
    const ws = await workspace("badmeta");
    await expect(
      saveSsoConnection(ws.owner, { type: "saml", metadataXml: "<not-metadata/>" }),
    ).rejects.toThrow(DomainError);
  });

  it("refuses an OIDC discovery URL on a private network", async () => {
    const ws = await workspace("ssrf");
    await expect(
      saveSsoConnection(
        ws.owner,
        {
          type: "oidc",
          discoveryUrl: "https://idp.internal.test/.well-known/openid-configuration",
          clientId: "client",
          clientSecret: "secret",
        },
        async () => ["169.254.169.254"],
      ),
    ).rejects.toThrow(DomainError);
  });
});

describe("who an assertion may sign in", () => {
  it("auto-joins a new person on an auto-join domain", async () => {
    const ws = await workspace("join");
    await verifiedDomain(ws, true);
    const email = `newcomer@${ws.domain}`;
    extraUserEmails.push(email);

    const result = await resolveSsoSignIn({ tenant: ws.companyId, email, name: "New Comer", linkedUserId: null });

    expect(result).toEqual({ ok: true, joinedCompanyId: ws.companyId });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ companyId: ws.companyId, role: "MEMBER" });
    expect(user.emailVerified).not.toBeNull();
    expect(
      await db.activityLog.count({ where: { companyId: ws.companyId, action: "user.join", actorId: user.id } }),
    ).toBe(1);
  });

  it("creates the account without a company when auto-join is off", async () => {
    const ws = await workspace("nojoin");
    await verifiedDomain(ws, false);
    const email = `pending@${ws.domain}`;
    extraUserEmails.push(email);

    const result = await resolveSsoSignIn({ tenant: ws.companyId, email, name: "Pending", linkedUserId: null });

    expect(result).toEqual({ ok: true, joinedCompanyId: null });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ companyId: null });
  });

  it("lets an IdP vouch only for its company's verified domains", async () => {
    const attacker = await workspace("attacker");
    const victim = await workspace("victim");
    await verifiedDomain(attacker, true);
    await addDomain(victim.owner, { domain: victim.domain });

    const victimOwner = await db.user.findUniqueOrThrow({ where: { id: victim.owner.actorId } });
    expect(
      await resolveSsoSignIn({ tenant: attacker.companyId, email: victimOwner.email, name: "x", linkedUserId: null }),
    ).toEqual({ ok: false, reason: "SsoDomainNotVerified" });

    // Unverified on the victim's side too: claiming a domain proves nothing.
    expect(
      await resolveSsoSignIn({
        tenant: victim.companyId,
        email: `someone@${victim.domain}`,
        name: "x",
        linkedUserId: null,
      }),
    ).toEqual({ ok: false, reason: "SsoDomainNotVerified" });
  });

  it("refuses someone who already belongs to another workspace", async () => {
    const ws = await workspace("wrong");
    const other = await workspace("other");
    await verifiedDomain(ws, true);
    const email = `moved@${ws.domain}`;
    await db.user.create({ data: { name: "Moved", email, companyId: other.companyId } });
    extraUserEmails.push(email);

    expect(
      await resolveSsoSignIn({ tenant: ws.companyId, email, name: "Moved", linkedUserId: null }),
    ).toEqual({ ok: false, reason: "SsoWrongWorkspace" });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ companyId: other.companyId });
  });

  it("refuses a linked account whose user doesn't own the asserted email", async () => {
    const ws = await workspace("mismatch");
    await verifiedDomain(ws, true);

    expect(
      await resolveSsoSignIn({
        tenant: ws.companyId,
        email: `someone@${ws.domain}`,
        name: "x",
        linkedUserId: ws.admin.actorId,
      }),
    ).toEqual({ ok: false, reason: "SsoAccountMismatch" });
  });
});

describe("domain ownership", () => {
  it("verifies only once the TXT record is published", async () => {
    const ws = await workspace("verify");
    const added = await addDomain(ws.admin, { domain: ws.domain });

    await expect(verifyDomain(ws.admin, { domainId: added.id }, async () => [])).rejects.toThrow(DomainError);
    const verified = await verifyDomain(ws.admin, { domainId: added.id }, await publishedRecord(added.id));
    expect(verified.verifiedAt).toBeInstanceOf(Date);
  });

  it("lets only one workspace verify a domain", async () => {
    const first = await workspace("first");
    const second = await workspace("second");
    const shared = `shared-${randomUUID().slice(0, 8)}.example.test`;

    const mine = await addDomain(first.owner, { domain: shared });
    const theirs = await addDomain(second.owner, { domain: shared });
    await verifyDomain(first.owner, { domainId: mine.id }, await publishedRecord(mine.id));

    await expect(
      verifyDomain(second.owner, { domainId: theirs.id }, await publishedRecord(theirs.id)),
    ).rejects.toThrow(ConflictError);
    await expect(addDomain(second.owner, { domain: shared })).rejects.toThrow(ConflictError);
  });

  it("won't auto-join through a domain nobody has verified", async () => {
    const ws = await workspace("autojoin");
    const added = await addDomain(ws.owner, { domain: ws.domain });
    await expect(setDomainAutoJoin(ws.owner, { domainId: added.id, autoJoin: true })).rejects.toThrow(
      ConflictError,
    );
  });
});

describe("requiring SSO", () => {
  it("needs an owner, a connection and a verified domain", async () => {
    const ws = await workspace("enforce");
    await expect(setSsoEnforced(ws.admin, { enforced: true })).rejects.toThrow(ForbiddenError);
    await expect(setSsoEnforced(ws.owner, { enforced: true })).rejects.toThrow(ConflictError);

    const domainId = await verifiedDomain(ws, false);
    await saveSsoConnection(ws.owner, { type: "saml", metadataXml: createFakeIdp(ws.domain).metadataXml });
    expect(await setSsoEnforced(ws.owner, { enforced: true })).toEqual({ enforced: true });

    await expect(removeDomain(ws.owner, { domainId })).rejects.toThrow(ConflictError);
    await expect(removeSsoConnection(ws.owner)).rejects.toThrow(ConflictError);

    const settings = await getSsoSettings(ws.admin);
    expect(settings).toMatchObject({ enforced: true, connection: { type: "saml" } });
    expect(settings.domains).toHaveLength(1);
  });

  it("replaces the previous connection when a new one is saved", async () => {
    const ws = await workspace("replace");
    await saveSsoConnection(ws.owner, { type: "saml", metadataXml: createFakeIdp(`${ws.domain}-1`).metadataXml });
    const second = createFakeIdp(`${ws.domain}-2`);
    await saveSsoConnection(ws.owner, { type: "saml", metadataXml: second.metadataXml });

    const { connectionAPIController } = await ssoControllers();
    const connections = await connectionAPIController.getConnections({ tenant: ws.companyId, product: SSO_PRODUCT });
    expect(connections).toHaveLength(1);
    expect((await getSsoSettings(ws.owner)).connection?.identifier).toBe(second.entityId);
  });
});

describe("the SSO record store", () => {
  it("stops returning a record once it expires", async () => {
    const key = randomUUID();
    await ssoStore.put("test:expiry", key, { value: "v" }, 60, { name: "group", value: "g" });
    expect(await ssoStore.get("test:expiry", key)).toEqual({ value: "v", iv: undefined, tag: undefined });
    expect(await ssoStore.getCount?.("test:expiry", { name: "group", value: "g" })).toBe(1);

    await db.ssoRecord.update({ where: { key: `test:expiry:${key}` }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await ssoStore.get("test:expiry", key)).toBeNull();
    expect((await ssoStore.getByIndex("test:expiry", { name: "group", value: "g" })).data).toEqual([]);

    await ssoStore.delete("test:expiry", key);
    expect(await db.ssoRecordIndex.count({ where: { recordKey: `test:expiry:${key}` } })).toBe(0);
  });
});
