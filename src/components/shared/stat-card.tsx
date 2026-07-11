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
    <Card className={cn("py-5", className)}>
      <CardContent className="flex items-start justify-between gap-4 px-5">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight text-foreground">
            {value}
          </p>
          {delta ? (
            <p className={cn("text-xs font-medium", deltaToneClasses[deltaTone])}>
              {delta}
            </p>
          ) : null}
        </div>
        {Icon ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-5" aria-hidden="true" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export { StatCard };
