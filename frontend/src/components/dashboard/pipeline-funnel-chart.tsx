"use client";

import { Workflow } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
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
  NEW: "var(--stage-new)",
  SCREENING: "var(--stage-screening)",
  SHORTLISTED: "var(--stage-shortlisted)",
  INTERVIEW: "var(--stage-interview)",
  OFFER: "var(--stage-offer)",
  HIRED: "var(--stage-hired)",
  REJECTED: "var(--stage-rejected)",
};

function makeTooltip(total: number) {
  return function FunnelTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload as FunnelStagePoint | undefined;
    if (!point) return null;
    const share = total > 0 ? Math.round((point.count / total) * 100) : 0;
    return (
      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
        <p className="font-medium">{STAGE_LABELS[point.stage]}</p>
        <p className="text-muted-foreground">
          {point.count} application{point.count === 1 ? "" : "s"} · {share}%
        </p>
      </div>
    );
  };
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

  const hired = data.find((point) => point.stage === "HIRED")?.count ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-display-app text-3xl leading-none font-semibold tabular-nums text-foreground">
            {total}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            total applications tracked
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg leading-none font-semibold tabular-nums text-foreground">
            {hired}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">hired</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={228}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 8, right: 28, top: 4, bottom: 4 }}
          barCategoryGap={9}
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
          <Tooltip
            content={makeTooltip(total)}
            cursor={{ fill: "var(--accent)", fillOpacity: 0.14 }}
          />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            background={{ fill: "var(--muted)", radius: 4 }}
          >
            {data.map((point) => (
              <Cell key={point.stage} fill={STAGE_FILLS[point.stage]} />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              fontSize={11}
              className="fill-foreground font-medium tabular-nums"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
