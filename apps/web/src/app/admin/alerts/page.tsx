import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { alertsService } from "@/lib/services/alerts";
import { AlertsTable } from "@/features/admin-alerts/components/alerts-table";
import { ListChecksIcon } from "lucide-react";

export default async function AdminAlertsPage() {
  const alerts = await alertsService.listAdminAlerts();

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <PageHeader title="Alertas" description="Historial y auditoría de intervenciones." />

      {alerts.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title="Sin alertas"
          description="Todavía no hay alertas registradas."
        />
      ) : (
        <div className="rounded-xl border">
          {/* Table already wraps itself in an overflow-x-auto container. */}
          <AlertsTable alerts={alerts} />
        </div>
      )}
    </div>
  );
}
