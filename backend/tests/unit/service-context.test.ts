import { describe, expect, it } from "vitest";

import { assertCan, assertCanAdmin, type TenantContext } from "../../src/services/context";
import { DomainError, ForbiddenError, NotFoundError } from "../../src/services/errors";
import { ScoringError } from "../../src/scoring/parse";
import { ExtractionError } from "../../src/extraction/parse";
import type { Role } from "../../src/validators/enums";

function ctx(role: Role): TenantContext {
  return { companyId: "company-a", actorId: "user-1", role };
}

describe("service context assertions", () => {
  it("checks the role's permission", () => {
    expect(() => assertCan(ctx("MEMBER"), "candidate.manage")).not.toThrow();
    expect(() => assertCan(ctx("HIRING_MANAGER"), "application.stage")).not.toThrow();
    expect(() => assertCan(ctx("HIRING_MANAGER"), "candidate.manage")).toThrow(ForbiddenError);
    expect(() => assertCan(ctx("INTERVIEWER"), "scoring.view")).toThrow(ForbiddenError);
    expect(() => assertCan(ctx("VIEWER"), "scorecard.submit")).toThrow(ForbiddenError);
  });

  it("restricts admin operations to OWNER and ADMIN", () => {
    expect(() => assertCanAdmin(ctx("OWNER"))).not.toThrow();
    expect(() => assertCanAdmin(ctx("ADMIN"))).not.toThrow();
    expect(() => assertCanAdmin(ctx("MEMBER"))).toThrow(ForbiddenError);
    expect(() => assertCanAdmin(ctx("VIEWER"))).toThrow(ForbiddenError);
  });
});

describe("domain errors", () => {
  it("carry field errors for form adapters", () => {
    const error = new NotFoundError("Check the highlighted fields.", { jobId: ["Gone"] });
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe("NotFoundError");
    expect(error.fieldErrors).toEqual({ jobId: ["Gone"] });
  });

  it("treat AI engine failures as user-safe domain errors", () => {
    expect(new ScoringError("x")).toBeInstanceOf(DomainError);
    expect(new ExtractionError("x")).toBeInstanceOf(DomainError);
  });
});
