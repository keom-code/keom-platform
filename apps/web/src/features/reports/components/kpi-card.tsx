import { Card, CardContent, CardHeader } from "@keom/ui";
import { cn } from "@keom/ui";

export function KpiCard({
  label,
  value,
  className,
  valueClassName,
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <Card className={cn("gap-1 bg-gradient-to-br from-card to-muted/40", className)}>
      <CardHeader>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardHeader>
      <CardContent>
        <p className={cn("text-2xl font-semibold", valueClassName)}>{value}</p>
      </CardContent>
    </Card>
  );
}
