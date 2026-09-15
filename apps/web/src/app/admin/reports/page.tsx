import type { DateRangePreset } from "@keom/contracts";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { reportsService } from "@/lib/services/reports";
import { formatCurrency } from "@/lib/utils";
import { KpiCard } from "@/features/reports/components/kpi-card";
import { RevenueChart } from "@/features/reports/components/revenue-chart";
import { LossReasonsChart } from "@/features/reports/components/loss-reasons-chart";
import { RankedBarChart } from "@/features/reports/components/ranked-bar-chart";
import { ReportFilterBar } from "@/features/reports/components/report-filter-bar";
import { BarChart3Icon } from "lucide-react";

const VALID_RANGES: DateRangePreset[] = ["TODAY", "7D", "30D", "CUSTOM"];

function parseRange(value: string | undefined): DateRangePreset | undefined {
  return VALID_RANGES.includes(value as DateRangePreset) ? (value as DateRangePreset) : undefined;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; treatment?: string }>;
}) {
  const params = await searchParams;
  const filters = {
    dateRange: parseRange(params.range),
    treatment: params.treatment,
  };

  const [report, filterOptions] = await Promise.all([
    reportsService.getAdminReport(filters),
    reportsService.listFilterOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <PageHeader title="Reportes" description="¿KEOM está recuperando dinero?" />

      <ReportFilterBar treatments={filterOptions.treatments} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Ingresos recuperados"
          value={formatCurrency(report.summary.recoveredRevenue)}
          valueClassName="text-success"
        />
        <KpiCard
          label="Oportunidades recuperadas"
          value={String(report.summary.recoveredOpportunities)}
        />
        <KpiCard label="Tasa de recuperación" value={formatPercent(report.summary.recoveryRate)} />
        <KpiCard label="En riesgo" value={String(report.summary.atRiskOpportunities)} />
      </div>

      {/* The page's visual anchor — bigger, warmer fill, stronger heading than the
          breakdown charts below. See docs/ARCHITECTURE.md Section F. */}
      <div className="rounded-xl border bg-gradient-to-br from-card to-muted/40 p-4">
        <h2 className="mb-3 text-base font-semibold text-foreground">
          Ingresos recuperados en el tiempo
        </h2>
        {report.revenueTimeline.length === 0 ? (
          <EmptyState icon={BarChart3Icon} title="Sin datos" description="No hay datos para este rango." />
        ) : (
          <RevenueChart data={report.revenueTimeline} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Por qué se pierden oportunidades
          </h2>
          <LossReasonsChart
            data={report.lossReasons.map((r) => ({ reason: r.reason, percentage: r.percentage }))}
          />
        </div>

        <div className="rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recuperación por servicio</h2>
          {report.recoveryByTreatment.length === 0 ? (
            <EmptyState icon={BarChart3Icon} title="Sin resultados" description="No hay datos para este filtro." />
          ) : (
            <RankedBarChart
              data={report.recoveryByTreatment.map((t) => ({ label: t.treatment, value: t.recoveredRevenue }))}
              format="currency"
            />
          )}
        </div>
      </div>
    </div>
  );
}
