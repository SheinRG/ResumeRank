"use client";

import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { EmptyState } from "@/components/shared/empty-state";
import type { ScoreBucket } from "@/server/queries/dashboard";

function ScoreTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as ScoreBucket | undefined;
  if (!point) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">Score {point.bucket}</p>
      <p className="text-muted-foreground">
        {point.count} application{point.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

export function ScoreDistributionChart({ data }: { data: ScoreBucket[] }) {
  const total = data.reduce((sum, bucket) => sum + bucket.count, 0);

  if (total === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No scores yet"
        description="Score an application with AI to see the distribution."
        className="h-64 border-none py-0"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={data}
        margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
        barCategoryGap={6}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          interval={1}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <YAxis hide allowDecimals={false} />
        <Tooltip content={ScoreTooltip} cursor={{ fill: "var(--accent)" }} />
        <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
