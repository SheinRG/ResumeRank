import { env } from "../env";
import { PAID_PLANS, type PaidPlan } from "./plans";

export function priceIdFor(plan: PaidPlan): string | null {
  const { STRIPE_PRICE_TEAM, STRIPE_PRICE_ENTERPRISE } = env();
  return (plan === "TEAM" ? STRIPE_PRICE_TEAM : STRIPE_PRICE_ENTERPRISE) ?? null;
}

/** Null for a price no plan uses, e.g. one retired from the env without migrating its subscribers. */
export function planForPrice(priceId: string | null): PaidPlan | null {
  if (!priceId) return null;
  return PAID_PLANS.find((plan) => priceIdFor(plan) === priceId) ?? null;
}
