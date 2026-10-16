import { Lock } from "lucide-react";
import Link from "next/link";

/**
 * Shown in place of a feature's setup when the workspace isn't entitled to
 * it. With billing on, the way to get it is a plan; without, it's staff.
 */
export function FeatureUnavailable({
  feature,
  upgradable,
  consequence,
}: {
  feature: string;
  upgradable: boolean;
  /** What still works meanwhile, for a feature that's already set up. */
  consequence?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border p-4">
      <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          {upgradable
            ? `${feature} isn't included in this workspace's plan`
            : `${feature} isn't enabled for this workspace`}
        </p>
        <p className="text-sm text-muted-foreground">
          {consequence ? `${consequence} ` : null}
          {upgradable ? (
            <>
              It comes with Enterprise.{" "}
              <Link href="/settings/billing" className="font-medium text-foreground underline underline-offset-4">
                See plans
              </Link>
            </>
          ) : (
            "Ask ResumeRank support to turn it on for your workspace."
          )}
        </p>
      </div>
    </div>
  );
}
