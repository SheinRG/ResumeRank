"use client";

import { TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { EmptyState } from "@/components/shared/empty-state";
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

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
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
        <YAxis hide allowDecimals={false} />
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
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
