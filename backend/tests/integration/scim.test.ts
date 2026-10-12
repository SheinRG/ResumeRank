import { randomUUID } from "node:crypto";

import type { DirectorySyncRequest } from "@boxyhq/saml-jackson";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import type { TenantContext } from "../../src/services/context";
import { createDirectory, getDirectory, removeDirectory } from "../../src/services/directory-sync";
import { ConflictError } from "../../src/services/errors";
import { closeSso } from "../../src/sso/jackson";
import { handleScimRequest } from "../../src/sso/directory";
import { resolveSsoSignIn } from "../../src/sso/login";

interface Workspace {
  companyId: string;
  owner: TenantContext;
  ownerEmail: string;
  domain: string;
  directoryId: string;
  token: string;
}

const companyIds: string[] = [];
const workspaces: Workspace[] = [];
const emails: string[] = [];

/** A company with a verified domain and a connected Okta directory. */
async function workspace(label: string): Promise<Workspace> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const domain = `${tag}.example.test`;
  const company = await db.company.create({ data: { name: `SCIM ${tag}`, slug: `scim-${tag}` } });
  companyIds.push(company.id);
  const ownerEmail = `owner@${domain}`;
  emails.push(ownerEmail);
  const owner = await db.user.create({
    data: { name: `Owner ${tag}`, email: ownerEmail, role: "OWNER", companyId: company.id },
  });
  await db.companyDomain.create({
    data: { companyId: company.id, domain, verificationToken: tag, verifiedAt: new Date(), autoJoin: true },
  });
  const ctx: TenantContext = { companyId: company.id, actorId: owner.id, role: "OWNER" };
  const created = await createDirectory(ctx, { type: "okta-scim-v2" });
  const directoryId = created.endpoint.split("/").pop() ?? "";
  const ws = { companyId: company.id, owner: ctx, ownerEmail, domain, directoryId, token: created.token };
  workspaces.push(ws);
  return ws;
}

function scim(ws: Workspace, request: Partial<DirectorySyncRequest> & Pick<DirectorySyncRequest, "method" | "resourceType">) {
  return handleScimRequest({
    directoryId: ws.directoryId,
    apiSecret: ws.token,
    body: undefined,
    resourceId: undefined,
    query: {},
    ...request,
  });
}

function scimUser(email: string, active = true, givenName = "Ada") {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: email,
    name: { givenName, familyName: "Lovelace" },
    emails: [{ primary: true, value: email, type: "work" }],
    active,
  };
}

async function createUser(ws: Workspace, email: string): Promise<string> {
  emails.push(email);
  const response = await scim(ws, { method: "POST", resourceType: "Users", body: scimUser(email) });
  expect(response.status).toBe(201);
  return (response.data as { id: string }).id;
}

function setActive(ws: Workspace, id: string, active: boolean) {
  return scim(ws, {
    method: "PATCH",
    resourceType: "Users",
    resourceId: id,
    body: {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", value: { active } }],
    },
  });
}

afterAll(async () => {
  for (const ws of workspaces) {
    await removeDirectory(ws.owner).catch(() => undefined);
  }
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await closeSso();
});

function membership(userId: string, companyId: string) {
  return db.membership.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { role: true, directoryUserId: true },
  });
}

describe("SCIM provisioning", () => {
  it("adds a person the directory creates, and only with the directory's token", async () => {
    const ws = await workspace("create");
    const denied = await handleScimRequest({
      method: "POST",
      resourceType: "Users",
      resourceId: undefined,
      directoryId: ws.directoryId,
      apiSecret: "wrong-token",
      body: scimUser(`intruder@${ws.domain}`),
      query: {},
    });
    expect(denied.status).toBe(401);

    const id = await createUser(ws, `ada@${ws.domain}`);
    const user = await db.user.findUniqueOrThrow({ where: { email: `ada@${ws.domain}` } });
    expect(user).toMatchObject({ name: "Ada Lovelace" });
    expect(user.emailVerified).not.toBeNull();
    expect(await membership(user.id, ws.companyId)).toMatchObject({ role: "MEMBER", directoryUserId: id });
    expect(
      await db.activityLog.count({ where: { companyId: ws.companyId, action: "user.provision", entityId: user.id } }),
    ).toBe(1);
    expect((await getDirectory(ws.owner))?.managedMembers).toBe(1);
  });

  it("skips addresses outside the company's verified domains", async () => {
    const ws = await workspace("foreign");
    const email = `someone@not-${ws.domain}`;
    await createUser(ws, email);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it("adds someone who belongs to another workspace, keeping that one", async () => {
    const ws = await workspace("taken");
    const other = await workspace("other");
    const email = `shared@${ws.domain}`;
    emails.push(email);
    const shared = await db.user.create({
      data: { name: "Shared", email, memberships: { create: { companyId: other.companyId, role: "ADMIN" } } },
    });

    const id = await createUser(ws, email);
    expect(await membership(shared.id, ws.companyId)).toMatchObject({ role: "MEMBER", directoryUserId: id });
    expect(await membership(shared.id, other.companyId)).toMatchObject({ role: "ADMIN", directoryUserId: null });

    await setActive(ws, id, false);
    expect(await membership(shared.id, ws.companyId)).toBeNull();
    expect(await membership(shared.id, other.companyId)).toMatchObject({ role: "ADMIN" });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ companyId: other.companyId });
  });

  it("removes a deactivated person, ends their sessions, and re-admits them on reactivation", async () => {
    const ws = await workspace("deactivate");
    const email = `leaver@${ws.domain}`;
    const id = await createUser(ws, email);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const loginId = randomUUID();
    await db.loginSession.create({
      data: { id: loginId, userId: user.id, method: "SSO", companyId: ws.companyId, ssoCompanyId: ws.companyId },
    });

    expect((await setActive(ws, id, false)).status).toBe(200);
    expect(await membership(user.id, ws.companyId)).toBeNull();
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ companyId: null });
    expect((await db.loginSession.findUniqueOrThrow({ where: { id: loginId } })).revokedAt).not.toBeNull();
    expect(
      await db.activityLog.count({ where: { companyId: ws.companyId, action: "user.deprovision", entityId: user.id } }),
    ).toBe(1);

    expect((await setActive(ws, id, true)).status).toBe(200);
    expect(await membership(user.id, ws.companyId)).toMatchObject({ role: "MEMBER", directoryUserId: id });
  });

  it("removes a deleted person", async () => {
    const ws = await workspace("delete");
    const email = `gone@${ws.domain}`;
    const id = await createUser(ws, email);
    expect((await scim(ws, { method: "DELETE", resourceType: "Users", resourceId: id })).status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await membership(user.id, ws.companyId)).toBeNull();
  });

  it("follows an email change to the same person", async () => {
    const ws = await workspace("rename");
    const id = await createUser(ws, `old@${ws.domain}`);
    const original = await db.user.findUniqueOrThrow({ where: { email: `old@${ws.domain}` } });
    emails.push(`new@${ws.domain}`);

    const response = await scim(ws, {
      method: "PUT",
      resourceType: "Users",
      resourceId: id,
      body: scimUser(`new@${ws.domain}`, true, "Grace"),
    });
    expect(response.status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
      email: `new@${ws.domain}`,
      name: "Grace Lovelace",
      companyId: ws.companyId,
    });
  });

  it("never removes an owner", async () => {
    const ws = await workspace("owner");
    const id = await createUser(ws, ws.ownerEmail);
    const owner = await db.user.findUniqueOrThrow({ where: { email: ws.ownerEmail } });
    expect(await membership(owner.id, ws.companyId)).toMatchObject({ role: "OWNER", directoryUserId: id });

    await setActive(ws, id, false);
    expect(await membership(owner.id, ws.companyId)).toMatchObject({ role: "OWNER" });
  });

  it("keeps each company's events on its own tenant when requests overlap", async () => {
    const [a, b] = await Promise.all([workspace("overlap-a"), workspace("overlap-b")]);
    const people = Array.from({ length: 4 }, (_, i) => [
      { ws: a, email: `a${i}@${a.domain}` },
      { ws: b, email: `b${i}@${b.domain}` },
    ]).flat();
    emails.push(...people.map((p) => p.email));

    const responses = await Promise.all(
      people.map((p) => scim(p.ws, { method: "POST", resourceType: "Users", body: scimUser(p.email) })),
    );
    expect(responses.every((r) => r.status === 201)).toBe(true);
    for (const p of people) {
      expect(await db.user.findUniqueOrThrow({ where: { email: p.email } })).toMatchObject({ companyId: p.ws.companyId });
    }
    // The directory service's own records must also stay with their tenant,
    // or the IdP's next sync would see the wrong people.
    for (const ws of [a, b]) {
      const listed = await scim(ws, { method: "GET", resourceType: "Users", query: { count: 50, startIndex: 1 } });
      const resources = (listed.data as { Resources: Array<{ userName: string }> }).Resources;
      expect(resources.map((r) => r.userName).sort()).toEqual(
        people.filter((p) => p.ws === ws).map((p) => p.email).sort(),
      );
    }
  });
});

describe("directory and SSO together", () => {
  it("turns off SSO auto-join while a directory manages membership", async () => {
    const ws = await workspace("autojoin");
    const email = `walk-in@${ws.domain}`;
    emails.push(email);
    expect(await resolveSsoSignIn({ tenant: ws.companyId, email, name: "Walk In", linkedUserId: null })).toEqual({
      ok: true,
      joinedCompanyId: null,
    });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ companyId: null });
  });

  it("allows one directory per company, and keeps members when it's removed", async () => {
    const ws = await workspace("remove");
    await expect(createDirectory(ws.owner, { type: "azure-scim-v2" })).rejects.toThrow(ConflictError);

    await createUser(ws, `stays@${ws.domain}`);
    await removeDirectory(ws.owner);
    expect(await getDirectory(ws.owner)).toBeNull();
    expect(await db.user.findUniqueOrThrow({ where: { email: `stays@${ws.domain}` } })).toMatchObject({
      companyId: ws.companyId,
      directoryUserId: null,
    });
  });

  it("needs a verified domain first", async () => {
    const company = await db.company.create({ data: { name: "No domain", slug: `scim-nodomain-${randomUUID().slice(0, 8)}` } });
    companyIds.push(company.id);
    const ctx: TenantContext = { companyId: company.id, actorId: "nobody", role: "OWNER" };
    await expect(createDirectory(ctx, { type: "okta-scim-v2" })).rejects.toThrow(ConflictError);
  });
});
