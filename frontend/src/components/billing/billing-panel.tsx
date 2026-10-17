"use client";

import { Check, CreditCard, Loader2, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { openBillingPortalAction, startCheckoutAction } from "@/server/actions/billing";
import type { BillingOverview, PlanOption } from "@/server/queries/billing";
import type { FeatureFlag } from "@resumerank/core/flags/registry";
import type { ActionResult } from "@resumerank/core/types/action";

const FEATURE_LABELS: Record<FeatureFlag, string> = {
  "resume-files": "PDF and Word resume uploads",
  sso: "Single sign-on (SAML / OIDC)",
  "directory-sync": "Directory sync (SCIM)",
  "audit-streaming": "Audit log streaming to your SIEM",
  "ip-allowlist": "IP allowlisting",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  TRIALING: "Trial",
  PAST_DUE: "Payment failed",
  UNPAID: "Unpaid",
  CANCELED: "Canceled",
  INCOMPLETE: "Awaiting payment",
  INCOMPLETE_EXPIRED: "Checkout expired",
  PAUSED: "Paused",
};

const LIVE_STATUSES = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

function percent(used: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
}

function useRedirectAction() {
  const [pending, setPending] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(key: string, action: () => Promise<ActionResult<{ url: string }>>) {
    setPending(key);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setPending(null);
        toast.error(result.error);
        return;
      }
      // Stripe hosts checkout and the portal; the button stays busy until the page leaves.
      window.location.assign(result.data.url);
    });
  }

  return { pending, run };
}

function ManageBillingButton({ disabled }: { disabled?: boolean }) {
  const { pending, run } = useRedirectAction();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || pending !== null}
      onClick={() => run("portal", openBillingPortalAction)}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
      Manage billing
    </Button>
  );
}

function PastDueNotice({ overview, isOwner }: { overview: BillingOverview; isOwner: boolean }) {
  if (overview.status !== "PAST_DUE") return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-verdict-partial/40 bg-verdict-partial/10 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2 text-sm text-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-verdict-partial" aria-hidden="true" />
        <span>
          A payment failed and Stripe is retrying it.
          {overview.graceEndsAt
            ? ` Update the payment method before ${formatDate(overview.graceEndsAt)} or the workspace moves to Free.`
            : null}
        </span>
      </p>
      {isOwner ? <ManageBillingButton /> : null}
    </div>
  );
}

function CurrentPlan({ overview, isOwner }: { overview: BillingOverview; isOwner: boolean }) {
  const current = overview.plans.find((option) => option.plan === overview.plan);
  const lapsed = overview.subscribedPlan !== overview.plan && !overview.comped;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {current?.label ?? overview.plan} plan
          {overview.status ? (
            <Badge variant="outline" className="font-mono">
              {STATUS_LABELS[overview.status] ?? overview.status}
            </Badge>
          ) : null}
          {overview.comped ? (
            <Badge variant="outline" className="font-mono">
              Comped
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {overview.comped
            ? "Included at no charge for workspaces that joined before billing."
            : lapsed
              ? "The subscription has lapsed, so the workspace is on Free until it's renewed."
              : current?.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {overview.currentPeriodEnd && overview.status && LIVE_STATUSES.has(overview.status) ? (
          <p className="text-sm text-muted-foreground">
            {overview.cancelAtPeriodEnd ? "Ends" : "Renews"} on{" "}
            <time dateTime={new Date(overview.currentPeriodEnd).toISOString()}>
              {formatDate(overview.currentPeriodEnd)}
            </time>
            .
          </p>
        ) : null}
        {isOwner && overview.hasCustomer ? (
          <div>
            <ManageBillingButton />
          </div>
        ) : null}
        {!isOwner ? <p className="text-sm text-muted-foreground">Only an owner can change the plan.</p> : null}
      </CardContent>
    </Card>
  );
}

function UsageMeter({ label, used, limit, detail }: { label: string; used: number; limit: number | null; detail?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {formatNumber(used)} / {limit === null ? "unlimited" : formatNumber(limit)}
        </span>
      </div>
      {limit === null ? null : (
        <Progress value={percent(used, limit)} aria-label={`${label}: ${formatNumber(used)} of ${formatNumber(limit)}`} />
      )}
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function Usage({ overview }: { overview: BillingOverview }) {
  const { seats, ai, scoringTokens } = overview;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>Seats count every member; pending invites hold one too.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <UsageMeter
          label="Seats"
          used={seats.used + seats.pendingInvites}
          limit={seats.limit}
          detail={`${formatNumber(seats.used)} member${seats.used === 1 ? "" : "s"}, ${formatNumber(seats.pendingInvites)} pending invite${seats.pendingInvites === 1 ? "" : "s"}`}
        />
        <UsageMeter
          label="AI tokens, last 30 days"
          used={ai.used}
          limit={ai.budget}
          detail={`Scoring has used ${formatNumber(scoringTokens.tokens)} tokens since ${formatDate(scoringTokens.since)}. At the limit, scoring pauses until older usage ages out.`}
        />
      </CardContent>
    </Card>
  );
}

function PlanCard({
  option,
  current,
  action,
}: {
  option: PlanOption;
  current: boolean;
  action: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border p-4",
        current ? "border-primary" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display-app text-base font-semibold text-foreground">{option.label}</span>
        {current ? (
          <Badge variant="outline" className="font-mono">
            Current
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{option.description}</p>
      <ul className="flex flex-1 flex-col gap-2 text-sm text-foreground">
        <li className="flex gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
          {option.includedSeats === null ? "Seats you choose" : `Up to ${option.includedSeats} members`}
        </li>
        <li className="flex gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
          {formatNumber(option.aiTokens)} AI tokens per 30 days
        </li>
        {option.entitlements.map((flag) => (
          <li key={flag} className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
            {FEATURE_LABELS[flag]}
          </li>
        ))}
      </ul>
      {action}
    </div>
  );
}

function Plans({ overview, isOwner }: { overview: BillingOverview; isOwner: boolean }) {
  const { pending, run } = useRedirectAction();
  const subscribed = !overview.comped && overview.status !== null && LIVE_STATUSES.has(overview.status);

  function actionFor(option: PlanOption): React.ReactNode {
    if (option.plan === overview.plan || option.plan === "FREE" || !isOwner) return null;
    if (subscribed) {
      return <p className="text-xs text-muted-foreground">Switch plans from Manage billing.</p>;
    }
    if (!option.purchasable) {
      return <p className="text-xs text-muted-foreground">Not available on this deployment yet.</p>;
    }
    const plan = option.plan;
    return (
      <Button
        type="button"
        className="rounded-full"
        disabled={pending !== null}
        onClick={() => run(plan, () => startCheckoutAction({ plan }))}
      >
        {pending === plan ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {overview.comped ? `Subscribe to ${option.label}` : `Upgrade to ${option.label}`}
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <CardDescription>
          Paid plans are billed per seat through Stripe. Seats, plan changes, invoices and cancellation are
          in Manage billing once you&apos;ve subscribed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        {overview.plans.map((option) => (
          <PlanCard
            key={option.plan}
            option={option}
            current={option.plan === overview.plan}
            action={actionFor(option)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export function BillingPanel({ overview, isOwner }: { overview: BillingOverview; isOwner: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <PastDueNotice overview={overview} isOwner={isOwner} />
      <CurrentPlan overview={overview} isOwner={isOwner} />
      <Usage overview={overview} />
      <Plans overview={overview} isOwner={isOwner} />
    </div>
  );
}
