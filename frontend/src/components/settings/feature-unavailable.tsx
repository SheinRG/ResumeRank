import { Lock } from "lucide-react";

/** Shown in place of a feature's setup when the workspace isn't entitled to it. */
export function FeatureUnavailable({ feature, detail }: { feature: string; detail?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border p-4">
      <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{feature} isn&apos;t enabled for this workspace</p>
        <p className="text-sm text-muted-foreground">
          {detail ?? "Ask ResumeRank support to turn it on for your workspace."}
        </p>
      </div>
    </div>
  );
}
