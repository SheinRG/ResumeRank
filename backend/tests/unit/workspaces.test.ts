import { describe, expect, it } from "vitest";

import { landingWorkspace, resolveWorkspace, signInMayOpen, type WorkspaceAccess } from "../../src/auth/workspace-policy";

const agency: WorkspaceAccess = { companyId: "agency", role: "OWNER", ssoEnforced: false };
const client: WorkspaceAccess = { companyId: "client", role: "MEMBER", ssoEnforced: false };
const enterprise: WorkspaceAccess = { companyId: "enterprise", role: "MEMBER", ssoEnforced: true };

describe("signInMayOpen", () => {
  it("lets any sign-in open a workspace without SSO enforcement", () => {
    expect(signInMayOpen(client, null)).toBe(true);
    expect(signInMayOpen(client, "enterprise")).toBe(true);
  });

  it("requires the company's own identity provider where SSO is enforced", () => {
    expect(signInMayOpen(enterprise, null)).toBe(false);
    expect(signInMayOpen(enterprise, "agency")).toBe(false);
    expect(signInMayOpen(enterprise, "enterprise")).toBe(true);
  });

  it("exempts owners, who keep their password as the way back in", () => {
    expect(signInMayOpen({ ...enterprise, role: "OWNER" }, null)).toBe(true);
  });
});

describe("landingWorkspace", () => {
  it("lands an SSO sign-in in its identity provider's company", () => {
    expect(landingWorkspace([agency, enterprise], { preferred: "agency", ssoCompanyId: "enterprise" })).toBe(
      enterprise,
    );
  });

  it("prefers the workspace last switched to, then the oldest", () => {
    expect(landingWorkspace([agency, client], { preferred: "client", ssoCompanyId: null })).toBe(client);
    expect(landingWorkspace([agency, client], { preferred: null, ssoCompanyId: null })).toBe(agency);
    expect(landingWorkspace([agency, client], { preferred: "gone", ssoCompanyId: null })).toBe(agency);
  });

  it("skips workspaces the sign-in may not open", () => {
    expect(landingWorkspace([enterprise, client], { preferred: "enterprise", ssoCompanyId: null })).toBe(client);
    expect(landingWorkspace([enterprise], { preferred: null, ssoCompanyId: null })).toBeNull();
    expect(landingWorkspace([], { preferred: null, ssoCompanyId: null })).toBeNull();
  });
});

describe("resolveWorkspace", () => {
  it("keeps the workspace the sign-in has open while the user belongs to it", () => {
    expect(resolveWorkspace([agency, client], { opened: "client", preferred: "agency", ssoCompanyId: null })).toBe(
      client,
    );
  });

  it("keeps it even once it requires SSO, so the guards can end the session", () => {
    expect(resolveWorkspace([agency, enterprise], { opened: "enterprise", preferred: null, ssoCompanyId: null })).toBe(
      enterprise,
    );
  });

  it("falls back to where a new sign-in would land after the user leaves it", () => {
    expect(resolveWorkspace([agency, client], { opened: "left", preferred: "client", ssoCompanyId: null })).toBe(
      client,
    );
    expect(resolveWorkspace([], { opened: "left", preferred: null, ssoCompanyId: null })).toBeNull();
  });
});
