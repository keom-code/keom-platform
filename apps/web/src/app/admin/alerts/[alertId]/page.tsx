import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Card, CardContent } from "@keom/ui";
import { alertsService } from "@/lib/services/alerts";
import { AlertStatusBadge } from "@/components/shared/alert-status-badge";
import { formatRelativeTime } from "@/lib/utils";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export default async function AdminAlertDetailPage({
  params,
}: {
  params: Promise<{ alertId: string }>;
}) {
  const { alertId } = await params;
  const alert = await alertsService.getAdminAlertDetail(alertId);

  if (!alert) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <Link
        href="/admin/alerts"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Volver a alertas
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{alert.customerName}</h1>
        <AlertStatusBadge status={alert.status} className="w-fit" />
      </div>

      <Card>
        <CardContent className="divide-y">
          <DetailRow label="Motivo de la alerta" value={alert.reason} />
          <DetailRow label="Resumen de KEOM" value={alert.summary} />
          <DetailRow label="Vendedor asignado" value={alert.sellerName} />
          <DetailRow label="Generada" value={formatRelativeTime(alert.createdAt)} />
          {alert.acknowledgedAt ? (
            <DetailRow label="Tomada" value={formatRelativeTime(alert.acknowledgedAt)} />
          ) : null}
          {alert.completedAt ? (
            <DetailRow label="Completada" value={formatRelativeTime(alert.completedAt)} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
