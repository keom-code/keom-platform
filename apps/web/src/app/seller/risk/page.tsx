import { SearchIcon } from "lucide-react";
import type { RiskLevel } from "@keom/contracts";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { riskService } from "@/lib/services/risk";
import { RiskFilterBar } from "@/features/risk/components/risk-filter-bar";
import { RiskCard } from "@/features/risk/components/risk-card";

const VALID_LEVELS: RiskLevel[] = ["HIGH", "MEDIUM", "LOW"];

function parseLevel(value: string | undefined): RiskLevel | undefined {
  return VALID_LEVELS.includes(value as RiskLevel) ? (value as RiskLevel) : undefined;
}

export default async function SellerRiskPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; level?: string }>;
}) {
  const params = await searchParams;
  const risks = await riskService.listCustomerRisks({
    search: params.search,
    level: parseLevel(params.level),
  });

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <PageHeader title="Clientes en riesgo" />
      <RiskFilterBar />

      {risks.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="Sin resultados"
          description="No hay clientes que coincidan con el filtro."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {risks.map((risk) => (
            <RiskCard key={risk.customerId} risk={risk} />
          ))}
        </div>
      )}
    </div>
  );
}
