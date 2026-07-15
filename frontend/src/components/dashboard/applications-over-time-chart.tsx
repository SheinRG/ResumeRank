"use client";

import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import type { WeekPoint } from "@/server/queries/dashboard";

const tickFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function TimeTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as WeekPoint | undefined;
  if (!point) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">
        Week of {tickFormatter.format(new Date(point.weekStart))}
      </p>
      <p className="text-muted-foreground">
        {point.count} application{point.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

export function ApplicationsOverTimeChart({ data }: { data: WeekPoint[] }) {
  const total = data.reduce((sum, point) => sum + point.count, 0);

  if (total === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No applications yet"
        description="Volume over the last 8 weeks will show up here."
        className="h-64 border-none py-0"
      />
    );
  }

  const average = total / data.length;
  const last = data.at(-1)?.count ?? 0;
  const prev = data.at(-2)?.count ?? 0;
  const diff = last - prev;
  const TrendIcon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-display-app text-3xl leading-none font-semibold tabular-nums text-foreground">
            {total}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            applications · last 8 weeks
          </p>
        </div>
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums",
            diff > 0 && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            diff < 0 && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
            diff === 0 && "bg-muted text-muted-foreground",
          )}
        >
          <TrendIcon className="size-3.5" aria-hidden />
          {diff > 0 ? `+${diff}` : diff}
          <span className="font-normal opacity-70">vs prior week</span>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="applicationsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="weekStart"
            tickFormatter={(value: Date) => tickFormatter.format(new Date(value))}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            allowDecimals={false}
            width={30}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <ReferenceLine
            y={average}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
          <Tooltip
            content={TimeTooltip}
            cursor={{ stroke: "var(--primary)", strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#applicationsFill)"
            dot={{ r: 2.5, fill: "var(--primary)", strokeWidth: 0 }}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
