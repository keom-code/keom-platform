"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RevenuePoint } from "@keom/contracts";
import { formatCurrency } from "@/lib/utils";

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const formatted = data.map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }),
  }));

  // Evenly-spaced ticks regardless of range: showing every label on a 30-point series
  // crowds and forces recharts to drop ticks unevenly. Skipping N ticks keeps spacing
  // consistent and caps the total around 10 labels.
  const tickInterval = Math.max(0, Math.ceil(formatted.length / 10) - 1);

  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {/* "Money" green (--color-success), not the neutral primary — reinforces
                recovered revenue as a positive signal. This is the page's visual
                anchor, so the wash is stronger than the flat ~10-12% used elsewhere
                on this page — see docs/ARCHITECTURE.md Section F. */}
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid horizontal vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            interval={tickInterval}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(value: number) => `S/ ${Math.round(value)}`}
          />
          <Tooltip
            formatter={(value) => [formatCurrency(Number(value)), "Recuperado"]}
            labelFormatter={(label) => label}
            cursor={{ stroke: "var(--color-success)", strokeOpacity: 0.25 }}
            contentStyle={{
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.15)",
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="recoveredRevenue"
            stroke="var(--color-success)"
            strokeWidth={2}
            fill="url(#revenueFill)"
            activeDot={{ r: 4, fill: "var(--color-success)", stroke: "var(--color-card)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
