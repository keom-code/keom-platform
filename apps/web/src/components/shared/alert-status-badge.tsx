import { CheckCircle2Icon, ClockIcon, UserCheckIcon, type LucideIcon } from "lucide-react";
import { cn } from "@keom/ui";
import type { AlertStatus } from "@keom/contracts";

const STATUS_CONFIG: Record<AlertStatus, { label: string; icon: LucideIcon; classes: string }> = {
  PENDING: {
    label: "Pendiente",
    icon: ClockIcon,
    classes: "bg-muted text-muted-foreground border-border",
  },
  ACKNOWLEDGED: {
    label: "Tomado",
    icon: UserCheckIcon,
    classes: "bg-risk-medium-bg text-risk-medium-fg border-risk-medium-border",
  },
  COMPLETED: {
    label: "Completado",
    icon: CheckCircle2Icon,
    classes: "bg-success/10 text-success border-success/30",
  },
};

/** Always label + icon + tint, never color alone — see docs/ARCHITECTURE.md Section F. */
export function AlertStatusBadge({ status, className }: { status: AlertStatus; className?: string }) {
  const { label, icon: Icon, classes } = STATUS_CONFIG[status];
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
