"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

/**
 * Fixed reason → chart color slot, in the order validated by the dataviz skill's
 * palette (adjacent-pairs, both light/dark modes). Keyed by label text, not array
 * position, so re-ordering the underlying data can't silently reassign colors —
 * see docs/ARCHITECTURE.md Section F and packages/ui/src/theme/globals.css.
 */
const REASON_COLOR_VAR: Record<string, string> = {
  "Sin seguimiento": "var(--color-chart-1)",
  "Objeción de precio": "var(--color-chart-2)",
  "Respuesta lenta del vendedor": "var(--color-chart-3)",
  "Sin disponibilidad": "var(--color-chart-4)",
  "Problema de pago": "var(--color-chart-5)",
  Otro: "var(--color-chart-6)",
};
const FALLBACK_COLOR_VAR = "var(--color-muted-foreground)";

export interface LossReasonDatum {
  reason: string;
  percentage: number;
}

export function LossReasonsChart({ data }: { data: LossReasonDatum[] }) {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="percentage"
              nameKey="reason"
              innerRadius="60%"
              outerRadius="95%"
              paddingAngle={2}
              stroke="var(--color-card)"
              strokeWidth={2}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.reason}
                  fill={REASON_COLOR_VAR[entry.reason] ?? FALLBACK_COLOR_VAR}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [`${Math.round(Number(value) * 100)}%`, String(name)]}
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex w-full flex-col gap-2 text-sm">
        {data.map((entry) => (
          <li key={entry.reason} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: REASON_COLOR_VAR[entry.reason] ?? FALLBACK_COLOR_VAR }}
            />
            <span className="min-w-0 flex-1 truncate text-foreground">{entry.reason}</span>
            <span className="font-medium text-muted-foreground">
              {Math.round(entry.percentage * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
