import { describe, expect, it } from "vitest";

import { canAdmin, canWrite, ADMIN_ROLES, WRITE_ROLES } from "../../src/auth/roles";
import { ROLES } from "../../src/validators/enums";

describe("role capabilities", () => {
  it("grants write access to OWNER, ADMIN, and MEMBER but not VIEWER", () => {
    expect(canWrite("OWNER")).toBe(true);
    expect(canWrite("ADMIN")).toBe(true);
    expect(canWrite("MEMBER")).toBe(true);
    expect(canWrite("VIEWER")).toBe(false);
  });

  it("grants admin access only to OWNER and ADMIN", () => {
    expect(canAdmin("OWNER")).toBe(true);
    expect(canAdmin("ADMIN")).toBe(true);
    expect(canAdmin("MEMBER")).toBe(false);
    expect(canAdmin("VIEWER")).toBe(false);
  });

  it("defines a capability for every role, with no undefined gaps", () => {
    for (const role of ROLES) {
      expect(typeof canWrite(role)).toBe("boolean");
      expect(typeof canAdmin(role)).toBe("boolean");
    }
  });

  it("keeps admin a strict subset of write (an admin can always write)", () => {
    for (const role of ADMIN_ROLES) {
      expect(WRITE_ROLES).toContain(role);
    }
  });
});
