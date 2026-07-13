import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string | number;
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
  icon?: LucideIcon;
  className?: string;
};

const deltaToneClasses: Record<
  NonNullable<StatCardProps["deltaTone"]>,
  string
> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-rose-600 dark:text-rose-400",
  neutral: "text-muted-foreground",
};

function StatCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  icon: Icon,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("gap-1.5 rounded-2xl py-6", className)}>
      <CardContent className="flex items-start justify-between gap-4 px-6">
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">
            {label}
          </p>
          <p className="font-display-app text-[34px] leading-none font-semibold tabular-nums text-foreground">
            {value}
          </p>
          {delta ? (
            <p className={cn("text-xs font-medium", deltaToneClasses[deltaTone])}>
              {delta}
            </p>
          ) : null}
        </div>
        {Icon ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export { StatCard };
