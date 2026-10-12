import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { startLoginSession } from "../../src/auth/sessions";
import { createCompanyInvite } from "../../src/auth/tokens";
import {
  acceptInvite,
  createWorkspace,
  passwordSignInRefused,
  switchWorkspace,
} from "../../src/auth/workspaces";
import { db } from "../../src/db";
import type { Role } from "../../src/generated/prisma/enums";
import type { TenantContext } from "../../src/services/context";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "../../src/services/errors";
import { resetMemberMfa } from "../../src/services/mfa";
import { listTeam, removeMember, updateMemberRole } from "../../src/services/team";
import { tenantTransaction } from "../../src/tenant-db";

const companyIds: string[] = [];
const userIds: string[] = [];
const MINUTE = 60_000;

afterAll(async () => {
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

async function company(label: string, data: { ssoEnforced?: boolean } = {}): Promise<string> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const created = await db.company.create({ data: { name: `Members ${tag}`, slug: `members-${tag}`, ...data } });
  companyIds.push(created.id);
  return created.id;
}

/** Memberships are dated a minute apart, oldest first, so "oldest" is unambiguous. */
async function person(label: string, memberships: { companyId: string; role: Role }[]): Promise<{ id: string; email: string }> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const start = Date.now() - memberships.length * MINUTE;
  const user = await db.user.create({
    data: {
      name: `Person ${tag}`,
      email: `members-${tag}@example.test`,
      memberships: {
        create: memberships.map((membership, index) => ({ ...membership, createdAt: new Date(start + index * MINUTE) })),
      },
    },
  });
  userIds.push(user.id);
  return { id: user.id, email: user.email };
}

async function signIn(userId: string, ssoCompanyId: string | null = null): Promise<string> {
  const id = randomUUID();
  await startLoginSession({
    id,
    userId,
    method: ssoCompanyId ? "SSO" : "PASSWORD",
    userAgent: null,
    ipAddress: null,
    ssoCompanyId,
  });
  return id;
}

async function openCompany(loginId: string): Promise<string | null> {
  return (await db.loginSession.findUniqueOrThrow({ where: { id: loginId } })).companyId;
}

async function roleIn(userId: string, companyId: string): Promise<Role | null> {
  const membership = await db.membership.findUnique({ where: { userId_companyId: { userId, companyId } } });
  return membership?.role ?? null;
}

function ctx(companyId: string, actorId: string, role: Role): TenantContext {
  return { companyId, actorId, role };
}

/** An agency and a client, a consultant in both, and an owner in each. */
async function agencyAndClient(label: string) {
  const agency = await company(`${label}-agency`);
  const client = await company(`${label}-client`);
  const agencyOwner = await person(`${label}-agency-owner`, [{ companyId: agency, role: "OWNER" }]);
  const clientOwner = await person(`${label}-client-owner`, [{ companyId: client, role: "OWNER" }]);
  const consultant = await person(`${label}-consultant`, [
    { companyId: agency, role: "ADMIN" },
    { companyId: client, role: "MEMBER" },
  ]);
  return { agency, client, agencyOwner, clientOwner, consultant };
}

describe("signing in and switching", () => {
  it("lands where the user last switched to, and each sign-in switches on its own", async () => {
    const { agency, client, consultant } = await agencyAndClient("switch");

    const laptop = await signIn(consultant.id);
    expect(await openCompany(laptop)).toBe(agency);

    expect(await switchWorkspace({ userId: consultant.id, loginId: laptop }, client)).toMatchObject({
      companyId: client,
    });
    expect(await openCompany(laptop)).toBe(client);
    expect(await db.user.findUniqueOrThrow({ where: { id: consultant.id } })).toMatchObject({
      companyId: client,
      role: "MEMBER",
    });
    expect(
      await db.activityLog.count({
        where: { companyId: client, action: "auth.workspace_switch", actorId: consultant.id },
      }),
    ).toBe(1);

    const phone = await signIn(consultant.id);
    expect(await openCompany(phone)).toBe(client);
    await switchWorkspace({ userId: consultant.id, loginId: phone }, agency);
    expect(await openCompany(phone)).toBe(agency);
    expect(await openCompany(laptop)).toBe(client);
  });

  it("records each sign-in in every workspace the user belongs to", async () => {
    const { agency, client, consultant } = await agencyAndClient("events");
    const loginId = await signIn(consultant.id);

    for (const companyId of [agency, client]) {
      const entries = await db.activityLog.findMany({
        where: { companyId, action: "auth.sign_in", actorId: consultant.id },
        select: { metadata: true },
      });
      expect(entries).toEqual([{ metadata: expect.objectContaining({ loginId }) }]);
    }
  });

  it("refuses a workspace the user doesn't belong to", async () => {
    const { consultant } = await agencyAndClient("outsider");
    const elsewhere = await company("elsewhere");
    const loginId = await signIn(consultant.id);
    await expect(switchWorkspace({ userId: consultant.id, loginId }, elsewhere)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      switchWorkspace({ userId: consultant.id, loginId: randomUUID() }, elsewhere),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("opens an SSO-only workspace only through that company's own identity provider", async () => {
    const agency = await company("sso-agency");
    const enterprise = await company("sso-enterprise", { ssoEnforced: true });
    const both = await person("sso-both", [
      { companyId: agency, role: "MEMBER" },
      { companyId: enterprise, role: "MEMBER" },
    ]);
    const enterpriseOnly = await person("sso-only", [{ companyId: enterprise, role: "MEMBER" }]);

    expect(await passwordSignInRefused(enterpriseOnly.id)).toBe(true);
    expect(await passwordSignInRefused(both.id)).toBe(false);

    const password = await signIn(both.id);
    expect(await openCompany(password)).toBe(agency);
    await expect(switchWorkspace({ userId: both.id, loginId: password }, enterprise)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const viaAgencyIdp = await signIn(both.id, agency);
    await expect(
      switchWorkspace({ userId: both.id, loginId: viaAgencyIdp }, enterprise),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const viaEnterpriseIdp = await signIn(both.id, enterprise);
    expect(await openCompany(viaEnterpriseIdp)).toBe(enterprise);
  });
});

describe("adding workspaces", () => {
  it("creates another company with the user as owner and opens it", async () => {
    const { agency, consultant } = await agencyAndClient("create");
    const loginId = await signIn(consultant.id);

    const created = await createWorkspace({ userId: consultant.id, loginId }, "Second Agency");
    companyIds.push(created.id);
    expect(await roleIn(consultant.id, created.id)).toBe("OWNER");
    expect(await roleIn(consultant.id, agency)).toBe("ADMIN");
    expect(await openCompany(loginId)).toBe(created.id);
    expect(await db.activityLog.count({ where: { companyId: created.id, action: "company.create" } })).toBe(1);
  });

  it("accepts an invite into another company with the same account", async () => {
    const { agency, client, clientOwner } = await agencyAndClient("invite");
    const freelancer = await person("invite-freelancer", [{ companyId: agency, role: "MEMBER" }]);
    const loginId = await signIn(freelancer.id);
    const { invite } = await createCompanyInvite({
      companyId: client,
      email: freelancer.email,
      role: "VIEWER",
      invitedById: clientOwner.id,
    });

    const actor = { userId: freelancer.id, loginId, email: freelancer.email, name: "Freelancer" };
    expect(await acceptInvite(actor, invite.id)).toEqual({ companyId: client, opened: true });
    expect(await roleIn(freelancer.id, client)).toBe("VIEWER");
    expect(await roleIn(freelancer.id, agency)).toBe("MEMBER");
    expect(await openCompany(loginId)).toBe(client);
    await expect(acceptInvite(actor, invite.id)).rejects.toBeInstanceOf(DomainError);

    const again = await createCompanyInvite({
      companyId: client,
      email: freelancer.email,
      role: "MEMBER",
      invitedById: clientOwner.id,
    });
    await expect(acceptInvite(actor, again.invite.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await roleIn(freelancer.id, client)).toBe("VIEWER");

    const other = await createCompanyInvite({
      companyId: agency,
      email: `someone-else-${randomUUID().slice(0, 8)}@example.test`,
      role: "MEMBER",
      invitedById: clientOwner.id,
    });
    await expect(acceptInvite(actor, other.invite.id)).rejects.toThrow("different email address");
  });
});

describe("a teammate shared with another company", () => {
  it("has a separate role in each, changed only by that workspace", async () => {
    const { agency, client, clientOwner, consultant } = await agencyAndClient("roles");

    const clientTeam = await listTeam(ctx(client, clientOwner.id, "OWNER"));
    expect(clientTeam.find((member) => member.id === consultant.id)).toMatchObject({ role: "MEMBER" });

    await updateMemberRole(ctx(client, clientOwner.id, "OWNER"), { userId: consultant.id, role: "VIEWER" });
    expect(await roleIn(consultant.id, client)).toBe("VIEWER");
    expect(await roleIn(consultant.id, agency)).toBe("ADMIN");
  });

  it("is removed from one workspace without losing the other, or its sessions there", async () => {
    const { agency, client, clientOwner, consultant } = await agencyAndClient("remove");
    const inAgency = await signIn(consultant.id);
    const inClient = await signIn(consultant.id);
    await switchWorkspace({ userId: consultant.id, loginId: inClient }, client);

    const removed = await removeMember(ctx(client, clientOwner.id, "OWNER"), { userId: consultant.id });
    expect(removed).toMatchObject({ id: consultant.id, role: "MEMBER" });
    expect(await roleIn(consultant.id, client)).toBeNull();
    expect(await roleIn(consultant.id, agency)).toBe("ADMIN");

    const sessions = await db.loginSession.findMany({
      where: { id: { in: [inAgency, inClient] } },
      select: { id: true, revokedAt: true },
    });
    expect(sessions.find((session) => session.id === inClient)?.revokedAt).not.toBeNull();
    expect(sessions.find((session) => session.id === inAgency)?.revokedAt).toBeNull();
    expect(await db.user.findUniqueOrThrow({ where: { id: consultant.id } })).toMatchObject({ companyId: agency });
  });

  it("can't have their two-factor reset by one company's admin", async () => {
    const { client, clientOwner, consultant } = await agencyAndClient("mfa");
    const solo = await person("mfa-solo", [{ companyId: client, role: "MEMBER" }]);
    await db.user.updateMany({ where: { id: { in: [consultant.id, solo.id] } }, data: { mfaEnabledAt: new Date() } });

    await expect(
      resetMemberMfa(ctx(client, clientOwner.id, "OWNER"), { userId: consultant.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.user.findUniqueOrThrow({ where: { id: consultant.id } })).mfaEnabledAt).not.toBeNull();

    expect(await resetMemberMfa(ctx(client, clientOwner.id, "OWNER"), { userId: solo.id })).toMatchObject({
      id: solo.id,
      mfaEnabledAt: null,
    });
  });

  it("is invisible to a company they don't belong to", async () => {
    const { agency, agencyOwner } = await agencyAndClient("isolation");
    const { client, consultant: stranger } = await agencyAndClient("isolation-other");
    const agencyCtx = ctx(agency, agencyOwner.id, "OWNER");

    await expect(removeMember(agencyCtx, { userId: stranger.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateMemberRole(agencyCtx, { userId: stranger.id, role: "VIEWER" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await roleIn(stranger.id, client)).toBe("MEMBER");

    const visible = await tenantTransaction(agencyCtx, (tx) =>
      tx.membership.findMany({ where: { companyId: agency }, select: { companyId: true } }),
    );
    expect(new Set(visible.map((row) => row.companyId))).toEqual(new Set([agency]));
    const unfiltered = await tenantTransaction(agencyCtx, (tx) =>
      tx.$queryRaw<{ companyId: string }[]>`SELECT "companyId" FROM "Membership"`,
    );
    expect(unfiltered.every((row) => row.companyId === agency)).toBe(true);
  });
});

describe("compatibility with code deployed before memberships", () => {
  it("turns direct writes to a user's company and role into membership changes", async () => {
    const legacy = await company("legacy");
    const tag = randomUUID().slice(0, 8);
    const user = await db.user.create({
      data: { name: "Legacy", email: `members-legacy-${tag}@example.test`, companyId: legacy, role: "ADMIN" },
    });
    userIds.push(user.id);
    expect(await roleIn(user.id, legacy)).toBe("ADMIN");

    await db.user.update({ where: { id: user.id }, data: { role: "VIEWER" } });
    expect(await roleIn(user.id, legacy)).toBe("VIEWER");

    await db.user.update({ where: { id: user.id }, data: { companyId: null, role: "MEMBER" } });
    expect(await roleIn(user.id, legacy)).toBeNull();
  });

  it("keeps the user's default workspace one they belong to", async () => {
    const first = await company("default-first");
    const second = await company("default-second");
    const user = await person("default", [
      { companyId: first, role: "OWNER" },
      { companyId: second, role: "VIEWER" },
    ]);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      companyId: first,
      role: "OWNER",
    });

    await db.membership.delete({ where: { userId_companyId: { userId: user.id, companyId: first } } });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      companyId: second,
      role: "VIEWER",
    });

    await db.company.delete({ where: { id: second } });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      companyId: null,
      role: "MEMBER",
    });
  });

  it("doesn't replay the default's role into the membership when switching", async () => {
    const { client, consultant } = await agencyAndClient("replay");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.workspace_switch', 'on', true)`;
      await tx.user.update({ where: { id: consultant.id }, data: { companyId: client, role: "OWNER" } });
    });
    expect(await roleIn(consultant.id, client)).toBe("MEMBER");
  });
});
