import { cn } from "@keom/ui";
import type { Level } from "./level-badge";

const CIRCLE_CLASSES: Record<Level, string> = {
  HIGH: "bg-risk-high-bg text-risk-high-fg ring-risk-high-border shadow-[0_0_0_1px_var(--risk-high-border),0_0_20px_-4px_var(--risk-high-border)]",
  MEDIUM:
    "bg-risk-medium-bg text-risk-medium-fg ring-risk-medium-border shadow-[0_0_0_1px_var(--risk-medium-border),0_0_20px_-4px_var(--risk-medium-border)]",
  LOW: "bg-risk-low-bg text-risk-low-fg ring-risk-low-border shadow-[0_0_0_1px_var(--risk-low-border),0_0_20px_-4px_var(--risk-low-border)]",
};

/**
 * A prominent 0-100 score readout, color-coded by severity (same risk tokens as
 * LevelBadge). The number itself — not just the color — carries the signal, so it
 * still reads for colorblind users; pair with a text label nearby regardless.
 */
export function ScoreCircle({
  level,
  score,
  orientation = "column",
  className,
}: {
  level: Level;
  score: number;
  orientation?: "column" | "row";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        orientation === "column" ? "flex-col" : "flex-row",
        className,
      )}
    >
      <div
        role="img"
        aria-label={`Puntaje de riesgo: ${score} de 100`}
        className={cn(
          "flex size-14 shrink-0 items-center justify-center rounded-full ring-2",
          CIRCLE_CLASSES[level],
        )}
      >
        <span className="text-xl font-bold leading-none">{score}</span>
      </div>
      <span
        className={cn(
          "font-medium text-muted-foreground",
          orientation === "column" ? "text-[10px] tracking-wide uppercase" : "text-sm",
        )}
      >
        Puntaje
      </span>
    </div>
  );
}
