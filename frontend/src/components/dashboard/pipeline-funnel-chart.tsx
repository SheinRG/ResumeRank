"use client";

import { Workflow } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { EmptyState } from "@/components/shared/empty-state";
import { STAGE_LABELS } from "@/components/shared/status-badges";
import type { Stage } from "@resumerank/core/validators/enums";
import type { FunnelStagePoint } from "@/server/queries/dashboard";

const STAGE_FILLS: Record<Stage, string> = {
  NEW: "#71717a",
  SCREENING: "#0ea5e9",
  SHORTLISTED: "#6366f1",
  INTERVIEW: "#8b5cf6",
  OFFER: "#f59e0b",
  HIRED: "#10b981",
  REJECTED: "#f43f5e",
};

function FunnelTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as FunnelStagePoint | undefined;
  if (!point) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{STAGE_LABELS[point.stage]}</p>
      <p className="text-muted-foreground">
        {point.count} application{point.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

export function PipelineFunnelChart({ data }: { data: FunnelStagePoint[] }) {
  const total = data.reduce((sum, point) => sum + point.count, 0);

  if (total === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title="No data yet"
        description="Applications will appear here once candidates enter the pipeline."
        className="h-64 border-none py-0"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
        barCategoryGap={10}
      >
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="stage"
          tickFormatter={(value: string) => STAGE_LABELS[value as Stage]}
          width={92}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
        />
        <Tooltip content={FunnelTooltip} cursor={{ fill: "var(--accent)" }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((point) => (
            <Cell key={point.stage} fill={STAGE_FILLS[point.stage]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
