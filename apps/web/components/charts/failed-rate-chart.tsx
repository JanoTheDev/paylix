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

interface FailedRateChartProps {
  data: Array<{
    date: string;
    value: { rate: number; failed: number; attempted: number };
  }>;
}

export function FailedRateChart({ data }: FailedRateChartProps) {
  const flat = data.map((d) => ({
    date: d.date,
    rate: Math.round(d.value.rate * 1000) / 10,
    failed: d.value.failed,
    attempted: d.value.attempted,
  }));
  return (
    <div className={chartCardClass}>
      <h3 className={chartTitleClass}>Failed charge rate</h3>
      {flat.length === 0 ? (
        <p className="py-16 text-center text-sm text-foreground-muted">
          No charges attempted in this window.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={flat}>
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
              tickFormatter={(v) => `${v}%`}
              tick={chartTheme.tick}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={chartTheme.tooltipContent}
              labelStyle={chartTheme.tooltipLabel}
              formatter={(value, _name, payload) => {
                const row = payload.payload as {
                  failed: number;
                  attempted: number;
                };
                return [
                  `${Number(value).toFixed(1)}% (${row.failed}/${row.attempted})`,
                  "Failed rate",
                ];
              }}
            />
            <Line
              type="monotone"
              dataKey="rate"
              stroke={chartTheme.series.destructive}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
