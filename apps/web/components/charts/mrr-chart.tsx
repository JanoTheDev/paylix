"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { chartCardClass, chartTheme, chartTitleClass } from "./theme";

interface MrrChartProps {
  /** `value` is integer cents — formatted only at the render edge. */
  data: Array<{ date: string; value: number }>;
}

export function MrrChart({ data }: MrrChartProps) {
  return (
    <div className={chartCardClass}>
      <h3 className={chartTitleClass}>MRR</h3>
      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-foreground-muted">
          No recurring revenue yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridStroke} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) =>
                new Date(d + "T00:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }
              tick={chartTheme.tick}
              axisLine={chartTheme.axisLine}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v) => `$${(Number(v) / 100).toFixed(0)}`}
              tick={chartTheme.tick}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              contentStyle={chartTheme.tooltipContent}
              labelStyle={chartTheme.tooltipLabel}
              formatter={(value) => [
                `$${(Number(value) / 100).toFixed(2)}`,
                "MRR",
              ]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={chartTheme.series.primary}
              fill={chartTheme.series.primary}
              fillOpacity={0.15}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
