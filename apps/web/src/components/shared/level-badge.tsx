import { AlertCircleIcon, AlertTriangleIcon, InfoIcon, type LucideIcon } from "lucide-react";
import { cn } from "@keom/ui";

export type Level = "HIGH" | "MEDIUM" | "LOW";

const LEVEL_CONFIG: Record<Level, { label: string; icon: LucideIcon; classes: string }> = {
  HIGH: {
    label: "Alto",
    icon: AlertTriangleIcon,
    classes: "bg-risk-high-bg text-risk-high-fg border-risk-high-border",
  },
  MEDIUM: {
    label: "Medio",
    icon: AlertCircleIcon,
    classes: "bg-risk-medium-bg text-risk-medium-fg border-risk-medium-border",
  },
  LOW: {
    label: "Bajo",
    icon: InfoIcon,
    classes: "bg-risk-low-bg text-risk-low-fg border-risk-low-border",
  },
};

/**
 * Shared HIGH/MEDIUM/LOW visual language for both alert priority and customer risk —
 * always label + icon + tint, never color alone. See docs/ARCHITECTURE.md Section F.
 */
export function LevelBadge({ level, className }: { level: Level; className?: string }) {
  const { label, icon: Icon, classes } = LEVEL_CONFIG[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
        classes,
        className,
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}
