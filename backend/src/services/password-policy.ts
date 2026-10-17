import { logActivity } from "../activity";
import { PASSWORD_POLICY_SELECT, passwordPolicyOf, type PasswordPolicy } from "../auth/password-policy";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { PasswordPolicyInput } from "../validators/password-policy";
import { assertCanAdmin, type TenantContext } from "./context";
import { ForbiddenError, NotFoundError } from "./errors";

export async function getPasswordPolicy(ctx: TenantContext): Promise<PasswordPolicy> {
  assertCanAdmin(ctx);
  const company = await tenantDb(ctx).company.findUnique({
    where: { id: ctx.companyId },
    select: PASSWORD_POLICY_SELECT,
  });
  if (!company) throw new NotFoundError("Your company no longer exists.");
  return passwordPolicyOf(company);
}

/**
 * Applies to passwords set from now on, and to existing ones at their next
 * sign-in: a password sign-in that falls short is held until it sets a new
 * one. Sessions already open aren't interrupted.
 */
export async function setPasswordPolicy(ctx: TenantContext, input: PasswordPolicyInput): Promise<PasswordPolicy> {
  assertCanAdmin(ctx);
  if (ctx.role !== "OWNER") {
    throw new ForbiddenError("Only an owner can change the password policy.");
  }

  return tenantTransaction(ctx, async (tx) => {
    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: { passwordMinLength: input.minLength, passwordBreachCheck: input.breachCheck },
      select: PASSWORD_POLICY_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "company.password_policy",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `set the password policy to at least ${input.minLength} characters${
          input.breachCheck ? ", not found in known breaches" : ""
        }`,
        metadata: { minLength: input.minLength, breachCheck: input.breachCheck },
      },
      tx,
    );
    return passwordPolicyOf(company);
  });
}
