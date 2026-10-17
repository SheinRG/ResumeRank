import type { FeatureFlag } from "../flags/registry";
import type { Plan } from "../generated/prisma/enums";

export type { Plan } from "../generated/prisma/enums";

export interface PlanDefinition {
  label: string;
  description: string;
  /** Members a workspace may have; null means the subscription's paid seats decide. */
  includedSeats: number | null;
  /** AI tokens per rolling 30 days; scoring stops there rather than billing overage. */
  aiTokens: number;
  entitlements: readonly FeatureFlag[];
}

/** Prices live in Stripe (STRIPE_PRICE_*); what each plan unlocks lives here. */
export const PLANS: Record<Plan, PlanDefinition> = {
  FREE: {
    label: "Free",
    description: "For trying ResumeRank with a small team.",
    includedSeats: 3,
    aiTokens: 250_000,
    entitlements: ["resume-files"],
  },
  TEAM: {
    label: "Team",
    description: "Per-seat pricing for a hiring team, with a larger AI budget.",
    includedSeats: null,
    aiTokens: 5_000_000,
    entitlements: ["resume-files"],
  },
  ENTERPRISE: {
    label: "Enterprise",
    description: "Single sign-on, directory sync, audit log streaming and IP allowlisting, with the largest AI budget.",
    includedSeats: null,
    aiTokens: 25_000_000,
    entitlements: ["resume-files", "sso", "directory-sync", "audit-streaming", "ip-allowlist"],
  },
};

export const PAID_PLANS = ["TEAM", "ENTERPRISE"] as const satisfies readonly Plan[];
export type PaidPlan = (typeof PAID_PLANS)[number];

/** Whether a plan grants an entitlement; release flags aren't decided by plans. */
export function planGrants(plan: Plan, flag: FeatureFlag): boolean {
  return PLANS[plan].entitlements.includes(flag);
}
