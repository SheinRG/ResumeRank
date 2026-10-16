import type { Metadata } from "next";
import { CircleCheck, Info } from "lucide-react";

import { BillingPanel } from "@/components/billing/billing-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { canAdmin, requireMember } from "@/lib/auth/guards";
import { getBillingOverview } from "@/server/queries/billing";

export const metadata: Metadata = { title: "Billing · Settings" };

function CheckoutNotice({ outcome }: { outcome: string | undefined }) {
  if (outcome !== "success" && outcome !== "canceled") return null;
  const Icon = outcome === "success" ? CircleCheck : Info;
  return (
    <p role="status" className="flex items-start gap-2 rounded-2xl border border-border bg-card p-4 text-sm text-foreground">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      {outcome === "success"
        ? "Thanks. Stripe is confirming the subscription; the plan below updates as soon as it does, usually within a minute. Refresh to check."
        : "Checkout was canceled. Nothing was charged."}
    </p>
  );
}

export default async function SettingsBillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireMember();
  if (!canAdmin(user.role)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
          <CardDescription>Your workspace&apos;s plan and payment are managed by its owners.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [overview, params] = await Promise.all([getBillingOverview(), searchParams]);
  if (!overview.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing isn&apos;t set up here</CardTitle>
          <CardDescription>
            This deployment has no STRIPE_SECRET_KEY, so there are no plans: every feature is available to
            every workspace. Whoever runs this ResumeRank instance can set it (see .env.example) to turn
            billing on.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const outcome = typeof params.checkout === "string" ? params.checkout : undefined;
  return (
    <div className="flex flex-col gap-6">
      <CheckoutNotice outcome={outcome} />
      <BillingPanel overview={overview} isOwner={user.role === "OWNER"} />
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Card details never reach ResumeRank: Stripe collects them on its own pages.
        </CardContent>
      </Card>
    </div>
  );
}
