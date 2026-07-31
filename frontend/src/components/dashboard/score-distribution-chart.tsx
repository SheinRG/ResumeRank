"use client";

import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { EmptyState } from "@/components/shared/empty-state";
import type { ScoreBucket } from "@/server/queries/dashboard";

type ScoreRow = ScoreBucket & { index: number };

// Buckets run 0–9 … 90–100 (index 0–9). Colour each by the score band it sits
// in — low / mid / strong — reusing the product's verdict palette so the
// histogram reads as candidate quality, not just raw counts.
function bandColor(index: number): string {
  if (index >= 7) return "var(--verdict-strong)";
  if (index >= 4) return "var(--verdict-partial)";
  return "var(--verdict-missing)";
}

function bandLabel(index: number): string {
  if (index >= 7) return "Strong";
  if (index >= 4) return "Mid";
  return "Low";
}

const LEGEND = [
  { label: "Low", hint: "0–39", color: "var(--verdict-missing)" },
  { label: "Mid", hint: "40–69", color: "var(--verdict-partial)" },
  { label: "Strong", hint: "70–100", color: "var(--verdict-strong)" },
];

function ScoreTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as ScoreRow | undefined;
  if (!point) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">Score {point.bucket}</p>
      <p className="text-muted-foreground">
        {point.count} application{point.count === 1 ? "" : "s"} · {bandLabel(point.index)}
      </p>
    </div>
  );
}

export function ScoreDistributionChart({
  data,
  averageScore,
}: {
  data: ScoreBucket[];
  averageScore: number | null;
}) {
  const rows: ScoreRow[] = data.map((bucket, index) => ({ ...bucket, index }));
  const total = rows.reduce((sum, bucket) => sum + bucket.count, 0);

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

  const strong = rows.slice(7).reduce((sum, bucket) => sum + bucket.count, 0);
  const strongPct = Math.round((strong / total) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-display-app text-3xl leading-none font-semibold tabular-nums text-foreground">
            {strongPct}%
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            scored 70+ · {strong} of {total} strong
          </p>
        </div>
        {averageScore !== null ? (
          <div className="text-right">
            <p className="font-mono text-lg leading-none font-semibold tabular-nums text-foreground">
              {averageScore}
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">avg score</p>
          </div>
        ) : null}
      </div>

      <ResponsiveContainer width="100%" height={216}>
        <BarChart
          data={rows}
          margin={{ left: -14, right: 8, top: 16, bottom: 0 }}
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
          <YAxis
            allowDecimals={false}
            width={30}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            content={ScoreTooltip}
            cursor={{ fill: "var(--accent)", fillOpacity: 0.14 }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={30}>
            {rows.map((row) => (
              <Cell key={row.bucket} fill={bandColor(row.index)} />
            ))}
            <LabelList
              dataKey="count"
              position="top"
              fontSize={10}
              fill="var(--muted-foreground)"
              formatter={(value) => (value ? value : "")}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {LEGEND.map((band) => (
          <span
            key={band.label}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: band.color }}
            />
            {band.label}
            <span className="text-muted-foreground/70">{band.hint}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
