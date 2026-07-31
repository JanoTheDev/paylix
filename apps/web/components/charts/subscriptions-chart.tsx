"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { chartCardClass, chartTheme, chartTitleClass } from "./theme";

interface SubscriptionsChartProps {
  data: Array<{ date: string; cumulative: number }>;
}

export function SubscriptionsChart({ data }: SubscriptionsChartProps) {
  return (
    <div className={chartCardClass}>
      <h3 className={chartTitleClass}>Subscriptions (30 days)</h3>
      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-foreground-muted">
          No subscriptions in the last 30 days.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data}>
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
              tick={chartTheme.tick}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={40}
            />
            <Tooltip
              contentStyle={chartTheme.tooltipContent}
              labelStyle={chartTheme.tooltipLabel}
              labelFormatter={(d) =>
                new Date(d + "T00:00:00").toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              }
            />
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke={chartTheme.series.primary}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
