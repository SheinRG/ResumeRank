import { describe, expect, it } from "vitest";

import { accessScope, ADMIN_ROLES, can, canAdmin, PERMISSIONS } from "../../src/auth/roles";
import { ROLES } from "../../src/validators/enums";

describe("role capabilities", () => {
  it("grants admin access only to OWNER and ADMIN", () => {
    expect(canAdmin("OWNER")).toBe(true);
    expect(canAdmin("ADMIN")).toBe(true);
    for (const role of ["MEMBER", "HIRING_MANAGER", "INTERVIEWER", "VIEWER"] as const) {
      expect(canAdmin(role)).toBe(false);
    }
  });

  it("gives admins every permission", () => {
    for (const role of ADMIN_ROLES) {
      for (const permission of PERMISSIONS) {
        expect(can(role, permission)).toBe(true);
      }
    }
  });

  it("lets recruiters do everything but manage departments", () => {
    for (const permission of PERMISSIONS) {
      expect(can("MEMBER", permission)).toBe(permission !== "department.manage");
    }
  });

  it("keeps viewers read-only", () => {
    const writes = PERMISSIONS.filter((p) => !["scoring.view", "scorecard.viewAll", "activity.view"].includes(p));
    for (const permission of writes) {
      expect(can("VIEWER", permission)).toBe(false);
    }
  });

  it("lets hiring managers run their jobs but not create, staff or delete", () => {
    for (const permission of ["job.edit", "application.stage", "scoring.request", "scoring.view", "scorecard.submit", "scorecard.viewAll"] as const) {
      expect(can("HIRING_MANAGER", permission)).toBe(true);
    }
    for (const permission of ["job.manage", "job.staff", "candidate.manage", "candidate.export", "application.manage", "activity.view", "department.manage"] as const) {
      expect(can("HIRING_MANAGER", permission)).toBe(false);
    }
  });

  it("lets interviewers only submit their own scorecard, blind to scores and other ratings", () => {
    for (const permission of PERMISSIONS) {
      expect(can("INTERVIEWER", permission)).toBe(permission === "scorecard.submit");
    }
  });

  it("scopes only hiring managers and interviewers to their assigned jobs", () => {
    for (const role of ROLES) {
      const assigned = role === "HIRING_MANAGER" || role === "INTERVIEWER";
      expect(accessScope(role)).toBe(assigned ? "assigned" : "company");
    }
  });
});
