export { cn } from "@keom/ui";

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    maximumFractionDigits: 0,
  }).format(amount);
}

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export function formatRelativeTime(isoDate: string): string {
  const diffMs = new Date(isoDate).getTime() - Date.now();

  const diffMinutes = Math.round(diffMs / 60_000);
  if (Math.abs(diffMinutes) < 60) return RELATIVE_TIME_FORMATTER.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMs / 3_600_000);
  if (Math.abs(diffHours) < 24) return RELATIVE_TIME_FORMATTER.format(diffHours, "hour");

  const diffDays = Math.round(diffMs / 86_400_000);
  return RELATIVE_TIME_FORMATTER.format(diffDays, "day");
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
