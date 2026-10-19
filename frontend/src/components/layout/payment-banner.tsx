import { TriangleAlert } from "lucide-react";
import { DateText } from "@/components/format/format-provider";
import Link from "next/link";

import { getPaymentAlert } from "@/server/queries/billing";

/** Admins only: a failed payment is theirs to fix before the grace period ends. */
export async function PaymentBanner() {
  const alert = await getPaymentAlert();
  if (!alert) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border-b border-verdict-partial/40 bg-verdict-partial/10 px-4 py-2.5 text-sm text-foreground sm:px-6"
    >
      <TriangleAlert className="size-4 shrink-0 text-verdict-partial" aria-hidden="true" />
      <p className="flex-1">
        A payment failed.
        {alert.graceEndsAt ? (
          <>
            {" "}
            Update the payment method before <DateText value={alert.graceEndsAt} /> to keep your plan.
          </>
        ) : null}
      </p>
      <Link href="/settings/billing" className="font-medium underline underline-offset-4">
        Billing
      </Link>
    </div>
  );
}
