"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "@/lib/utils";

export interface RankedBarDatum {
  label: string;
  value: number;
}

export type RankedBarFormat = "currency" | "percent" | "number";

// A format key, not a function prop: RankedBarChart is a Client Component rendered
// from Server Component pages, and function references aren't serializable across
// that boundary — see docs/ARCHITECTURE.md's note on nav.ts for the same pattern.
const FORMATTERS: Record<RankedBarFormat, (value: number) => string> = {
  currency: formatCurrency,
  percent: (value) => `${Math.round(value * 100)}%`,
  number: (value) => String(value),
};

export function RankedBarChart({
  data,
  format = "number",
  height = 220,
}: {
  data: RankedBarDatum[];
  format?: RankedBarFormat;
  height?: number;
}) {
  const valueFormatter = FORMATTERS[format];

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--color-border)" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={150}
            tick={{ fontSize: 12, fill: "var(--color-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => [valueFormatter(Number(value)), ""]}
            labelFormatter={() => ""}
            contentStyle={{
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="var(--color-primary)" barSize={18}>
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value) => valueFormatter(Number(value))}
              style={{ fontSize: 12, fill: "var(--color-foreground)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
