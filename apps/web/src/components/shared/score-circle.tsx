import { cn } from "@keom/ui";
import type { Level } from "./level-badge";

const CIRCLE_CLASSES: Record<Level, string> = {
  HIGH: "bg-risk-high-bg text-risk-high-fg ring-risk-high-border",
  MEDIUM: "bg-risk-medium-bg text-risk-medium-fg ring-risk-medium-border",
  LOW: "bg-risk-low-bg text-risk-low-fg ring-risk-low-border",
};

/**
 * A prominent 0-100 score readout, color-coded by severity (same risk tokens as
 * LevelBadge). The number itself — not just the color — carries the signal, so it
 * still reads for colorblind users; pair with a text label nearby regardless.
 */
export function ScoreCircle({
  level,
  score,
  className,
}: {
  level: Level;
  score: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div
        role="img"
        aria-label={`Puntaje de riesgo: ${score} de 100`}
        className={cn(
          "flex size-14 items-center justify-center rounded-full ring-2",
          CIRCLE_CLASSES[level],
        )}
      >
        <span className="text-xl font-bold leading-none">{score}</span>
      </div>
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Puntaje
      </span>
    </div>
  );
}
