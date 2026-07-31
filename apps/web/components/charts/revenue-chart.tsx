"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { chartCardClass, chartTheme, chartTitleClass } from "./theme";

interface RevenueChartProps {
  data: Array<{ date: string; total: number }>;
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <div className={chartCardClass}>
      <h3 className={chartTitleClass}>Revenue (30 days)</h3>
      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-foreground-muted">
          No revenue in the last 30 days.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data}>
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
              tickFormatter={(v) => `$${v}`}
              tick={chartTheme.tick}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <Tooltip
              contentStyle={chartTheme.tooltipContent}
              labelStyle={chartTheme.tooltipLabel}
              formatter={(value) => [`$${Number(value).toFixed(2)}`, "Revenue"]}
              labelFormatter={(d) =>
                new Date(d + "T00:00:00").toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              }
            />
            <Bar
              dataKey="total"
              fill={chartTheme.series.primary}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
