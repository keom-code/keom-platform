"use client";

import { CheckCircle2Icon } from "lucide-react";
import { Skeleton } from "@keom/ui";
import type { SellerAlert } from "@keom/contracts";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { useSellerAlerts } from "../hooks/use-seller-alerts";
import { AlertCard } from "./alert-card";

/**
 * Product decision (for now): only HIGH-priority alerts are worth interrupting the
 * seller for, and once one is acknowledged it should disappear rather than linger as
 * "Atendido" — the seller already acted on it via WhatsApp. Revisit if MEDIUM/LOW ever
 * need surfacing here too.
 */
function isVisible(alert: SellerAlert): boolean {
  return alert.priority === "HIGH" && alert.status === "PENDING";
}

function describeCount(count: number): string {
  if (count === 0) return "No hay oportunidades pendientes.";
  const noun = count === 1 ? "oportunidad" : "oportunidades";
  const verb = count === 1 ? "necesita" : "necesitan";
  return `${count} ${noun} ${verb} una acción`;
}

export function AlertList() {
  const { data, status, refetch } = useSellerAlerts();
  const visibleAlerts = status === "success" ? data.filter(isVisible) : [];

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <PageHeader
        title="Necesitan tu atención"
        description={status === "success" ? describeCount(visibleAlerts.length) : undefined}
      />

      {status === "pending" ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : status === "error" ? (
        <ErrorState onRetry={() => refetch()} />
      ) : visibleAlerts.length === 0 ? (
        <EmptyState
          icon={CheckCircle2Icon}
          title="Todo al día"
          description="No hay alertas pendientes por ahora."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {visibleAlerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
