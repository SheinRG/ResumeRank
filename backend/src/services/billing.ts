import { AI_BUDGET_WINDOW_MS, getAiBudget, type AiBudget } from "../ai-budget";
import { logActivity } from "../activity";
import {
  BILLING_STATE_SELECT,
  effectivePlan,
  graceEndsAt,
  seatLimit,
} from "../billing/account";
import { stripeGateway, type BillingGateway } from "../billing/gateway";
import { PAID_PLANS, PLANS, type Plan } from "../billing/plans";
import { priceIdFor } from "../billing/prices";
import { appOrigin, isBillingEnabled } from "../env";
import type { FeatureFlag } from "../flags/registry";
import type { SubscriptionStatus } from "../generated/prisma/enums";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { CheckoutInput } from "../validators/billing";
import { assertCanAdmin, type TenantContext } from "./context";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "./errors";

export interface PlanOption {
  plan: Plan;
  label: string;
  description: string;
  includedSeats: number | null;
  aiTokens: number;
  entitlements: readonly FeatureFlag[];
  /** A paid plan whose Stripe price is configured. */
  purchasable: boolean;
}

export interface BillingOverview {
  /** False when the deployment has no STRIPE_SECRET_KEY: nothing is gated. */
  enabled: boolean;
  plan: Plan;
  /** The plan paid for or comped, which can differ from `plan` once a payment lapses. */
  subscribedPlan: Plan;
  status: SubscriptionStatus | null;
  comped: boolean;
  hasCustomer: boolean;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: Date | null;
  graceEndsAt: Date | null;
  seats: { used: number; pendingInvites: number; limit: number | null };
  ai: AiBudget;
  /** Tokens scoring used since the billing period started, or over the last 30 days. */
  scoringTokens: { since: Date; tokens: number };
  plans: PlanOption[];
}

const ACCOUNT_SELECT = {
  ...BILLING_STATE_SELECT,
  stripeCustomerId: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
} as const;

/** Statuses during which the company already has a subscription to change rather than a new one to buy. */
const SUBSCRIBED: ReadonlySet<SubscriptionStatus> = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

function assertOwner(ctx: TenantContext, message: string): void {
  assertCanAdmin(ctx);
  if (ctx.role !== "OWNER") throw new ForbiddenError(message);
}

function assertBillingEnabled(): void {
  if (!isBillingEnabled()) throw new DomainError("Billing isn't set up on this deployment.");
}

function billingUrl(outcome?: "success" | "canceled"): string {
  return `${appOrigin()}/settings/billing${outcome ? `?checkout=${outcome}` : ""}`;
}

const ALL_PLANS: readonly Plan[] = ["FREE", ...PAID_PLANS];

function planOptions(): PlanOption[] {
  return ALL_PLANS.map((plan) => {
    const paid = PAID_PLANS.find((option) => option === plan);
    return { plan, ...PLANS[plan], purchasable: paid !== undefined && priceIdFor(paid) !== null };
  });
}

export async function getBillingOverview(ctx: TenantContext, now: Date = new Date()): Promise<BillingOverview> {
  assertCanAdmin(ctx);
  const db = tenantDb(ctx);
  const account = await db.billingAccount.findUnique({ where: { companyId: ctx.companyId }, select: ACCOUNT_SELECT });
  const since = account?.currentPeriodStart ?? new Date(now.getTime() - AI_BUDGET_WINDOW_MS);

  const [used, pendingInvites, ai, scoring] = await Promise.all([
    db.membership.count({ where: { companyId: ctx.companyId } }),
    db.companyInvite.count({ where: { companyId: ctx.companyId, acceptedAt: null, expiresAt: { gt: now } } }),
    getAiBudget(ctx.companyId),
    db.scoringRun.aggregate({
      where: { companyId: ctx.companyId, status: "SUCCEEDED", finishedAt: { gte: since } },
      _sum: { promptTokens: true, completionTokens: true },
    }),
  ]);
  const enabled = isBillingEnabled();

  return {
    enabled,
    plan: enabled ? effectivePlan(account, now) : "ENTERPRISE",
    subscribedPlan: account?.plan ?? "FREE",
    status: account?.status ?? null,
    comped: account?.comped ?? false,
    hasCustomer: Boolean(account?.stripeCustomerId),
    currentPeriodEnd: account?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
    pastDueSince: account?.pastDueSince ?? null,
    graceEndsAt: account ? graceEndsAt(account) : null,
    seats: { used, pendingInvites, limit: enabled ? seatLimit(account, now) : null },
    ai,
    scoringTokens: { since, tokens: (scoring._sum.promptTokens ?? 0) + (scoring._sum.completionTokens ?? 0) },
    plans: planOptions(),
  };
}

/**
 * Starts a Stripe Checkout for a paid plan, with a seat for everyone already
 * in the workspace. The plan changes only when Stripe's webhook confirms the
 * payment, never here.
 */
export async function startCheckout(
  ctx: TenantContext,
  input: CheckoutInput,
  gateway: BillingGateway = stripeGateway(),
): Promise<{ url: string }> {
  assertOwner(ctx, "Only an owner can change the plan.");
  assertBillingEnabled();
  const priceId = priceIdFor(input.plan);
  if (!priceId) throw new DomainError(`The ${PLANS[input.plan].label} plan can't be bought on this deployment yet.`);

  const db = tenantDb(ctx);
  const [account, company, owner, members] = await Promise.all([
    db.billingAccount.findUnique({ where: { companyId: ctx.companyId }, select: ACCOUNT_SELECT }),
    db.company.findUnique({ where: { id: ctx.companyId }, select: { name: true } }),
    db.user.findUnique({ where: { id: ctx.actorId }, select: { email: true } }),
    db.membership.count({ where: { companyId: ctx.companyId } }),
  ]);
  if (!company || !owner) throw new NotFoundError("Your company no longer exists.");
  if (account && !account.comped && account.status && SUBSCRIBED.has(account.status)) {
    throw new ConflictError("This workspace already has a subscription. Change its plan or seats from Manage billing.");
  }

  const customerId =
    account?.stripeCustomerId ??
    (await gateway.createCustomer({ companyId: ctx.companyId, name: company.name, email: owner.email }));

  await tenantTransaction(ctx, async (tx) => {
    if (!account?.stripeCustomerId) {
      await tx.billingAccount.upsert({
        where: { companyId: ctx.companyId },
        create: { companyId: ctx.companyId, stripeCustomerId: customerId },
        update: { stripeCustomerId: customerId },
        select: { id: true },
      });
    }
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "billing.checkout",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `started checkout for the ${PLANS[input.plan].label} plan`,
        metadata: { plan: input.plan, seats: members },
      },
      tx,
    );
  });

  const url = await gateway.createCheckoutSession({
    customerId,
    companyId: ctx.companyId,
    priceId,
    quantity: Math.max(1, members),
    successUrl: billingUrl("success"),
    cancelUrl: billingUrl("canceled"),
  });
  return { url };
}

/** Stripe's customer portal: plan and seat changes, payment methods, invoices, cancellation. */
export async function openBillingPortal(
  ctx: TenantContext,
  gateway: BillingGateway = stripeGateway(),
): Promise<{ url: string }> {
  assertOwner(ctx, "Only an owner can manage billing.");
  assertBillingEnabled();
  const account = await tenantDb(ctx).billingAccount.findUnique({
    where: { companyId: ctx.companyId },
    select: { stripeCustomerId: true },
  });
  if (!account?.stripeCustomerId) throw new NotFoundError("This workspace has no billing account yet. Choose a plan first.");
  return { url: await gateway.createPortalSession({ customerId: account.stripeCustomerId, returnUrl: billingUrl() }) };
}

export interface PaymentAlert {
  /** When the workspace drops to Free unless a payment goes through. */
  graceEndsAt: Date | null;
}

/** For the app shell: a payment has failed and the grace period is running. */
export async function getPaymentAlert(ctx: TenantContext): Promise<PaymentAlert | null> {
  assertCanAdmin(ctx);
  if (!isBillingEnabled()) return null;
  const account = await tenantDb(ctx).billingAccount.findUnique({
    where: { companyId: ctx.companyId },
    select: { status: true, pastDueSince: true },
  });
  if (account?.status !== "PAST_DUE") return null;
  return { graceEndsAt: graceEndsAt(account) };
}
