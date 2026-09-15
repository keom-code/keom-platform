import { Card, CardContent } from "@keom/ui";
import { cn } from "@keom/ui";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon, type LucideIcon } from "lucide-react";

export type KpiTrendSentiment = "positive" | "negative" | "neutral";

export interface KpiTrend {
  text: string;
  direction: "up" | "down" | "flat";
  sentiment: KpiTrendSentiment;
}

/**
 * Builds a trend from a raw delta. `invert` is for KPIs where going up is bad news
 * (e.g. "En riesgo") — the arrow still reflects the delta's real sign, only the color
 * flips.
 */
export function buildKpiTrend(
  delta: number,
  formatAbs: (abs: number) => string,
  options?: { invert?: boolean },
): KpiTrend {
  const direction: KpiTrend["direction"] = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const isIncrease = delta > 0;
  const isGoodNews = options?.invert ? !isIncrease : isIncrease;
  const sentiment: KpiTrendSentiment = delta === 0 ? "neutral" : isGoodNews ? "positive" : "negative";
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  return { direction, sentiment, text: `${sign}${formatAbs(Math.abs(delta))}` };
}

const TREND_ICON: Record<KpiTrend["direction"], LucideIcon> = {
  up: ArrowUpRightIcon,
  down: ArrowDownRightIcon,
  flat: MinusIcon,
};

const TREND_COLOR: Record<KpiTrendSentiment, string> = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
};

export function KpiCard({
  label,
  value,
  icon: Icon,
  iconClassName,
  trend,
  highlight,
  className,
  valueClassName,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  iconClassName?: string;
  trend?: KpiTrend;
  highlight?: boolean;
  className?: string;
  valueClassName?: string;
}) {
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;

  return (
    <Card
      className={cn(
        "bg-gradient-to-br from-card to-muted/40",
        highlight &&
          "border border-success/50 bg-gradient-to-br from-success/25 via-success/5 to-card shadow-[0_0_28px_6px_rgba(2,131,1,0.22)] ring-success/15",
        className,
      )}
    >
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
              iconClassName,
            )}
          >
            <Icon className="size-4.5" />
          </div>
          <p className="min-w-0 truncate text-sm text-muted-foreground">{label}</p>
        </div>
        <p className={cn("truncate text-2xl font-semibold", valueClassName)}>{value}</p>
        {trend && (
          <p className={cn("flex items-center gap-1 text-xs font-medium", TREND_COLOR[trend.sentiment])}>
            {TrendIcon && <TrendIcon className="size-3.5 shrink-0" />}
            <span className="truncate">{trend.text}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
