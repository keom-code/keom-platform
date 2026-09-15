import type { DateRangePreset } from "@keom/contracts";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { reportsService } from "@/lib/services/reports";
import { formatCurrency } from "@/lib/utils";
import { KpiCard, buildKpiTrend } from "@/features/reports/components/kpi-card";
import { RevenueChart } from "@/features/reports/components/revenue-chart";
import { LossReasonsChart } from "@/features/reports/components/loss-reasons-chart";
import { RankedBarChart } from "@/features/reports/components/ranked-bar-chart";
import { ReportFilterBar } from "@/features/reports/components/report-filter-bar";
import { AlertTriangleIcon, BarChart3Icon, CoinsIcon, UsersIcon } from "lucide-react";

const VALID_RANGES: DateRangePreset[] = ["TODAY", "7D", "30D", "CUSTOM"];

function parseRange(value: string | undefined): DateRangePreset | undefined {
  return VALID_RANGES.includes(value as DateRangePreset) ? (value as DateRangePreset) : undefined;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const RANGE_LABEL: Record<DateRangePreset, string> = {
  TODAY: "Hoy",
  "7D": "Últimos 7 días",
  "30D": "Últimos 30 días",
  CUSTOM: "Rango personalizado",
};

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

  const { summary } = report;
  const revenuePctDelta =
    summary.previousRecoveredRevenue > 0
      ? Math.round(
          ((summary.recoveredRevenue - summary.previousRecoveredRevenue) /
            summary.previousRecoveredRevenue) *
            100,
        )
      : 0;
  const opportunitiesDelta = summary.recoveredOpportunities - summary.previousRecoveredOpportunities;
  const ratePointsDelta = Math.round((summary.recoveryRate - summary.previousRecoveryRate) * 100);
  const atRiskDelta = summary.atRiskOpportunities - summary.previousAtRiskOpportunities;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <PageHeader title="Reportes" description="¿KEOM está recuperando dinero?" />

      <ReportFilterBar treatments={filterOptions.treatments} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Ingresos recuperados"
          value={formatCurrency(summary.recoveredRevenue)}
          valueClassName="text-success"
          icon={CoinsIcon}
          iconClassName="bg-success/15 text-success"
          highlight
          trend={buildKpiTrend(revenuePctDelta, (abs) => `${abs}% vs período anterior`)}
        />
        <KpiCard
          label="Oportunidades recuperadas"
          value={String(summary.recoveredOpportunities)}
          icon={UsersIcon}
          trend={buildKpiTrend(
            opportunitiesDelta,
            (abs) => `${abs} oportunidad${abs === 1 ? "" : "es"} vs período anterior`,
          )}
        />
        <KpiCard
          label="Tasa de recuperación"
          value={formatPercent(summary.recoveryRate)}
          icon={BarChart3Icon}
          trend={buildKpiTrend(ratePointsDelta, (abs) => `${abs} pts vs período anterior`)}
        />
        <KpiCard
          label="En riesgo"
          value={String(summary.atRiskOpportunities)}
          icon={AlertTriangleIcon}
          iconClassName="bg-destructive/10 text-destructive"
          trend={buildKpiTrend(atRiskDelta, (abs) => `${abs} hoy vs ayer`, { invert: true })}
        />
      </div>

      {/* The page's visual anchor — bigger, warmer fill, stronger heading than the
          breakdown charts below. See docs/ARCHITECTURE.md Section F. */}
      <div className="rounded-xl border border-success/20 bg-gradient-to-br from-success/[0.06] via-card to-card p-4 shadow-lg shadow-success/10">
        <h2 className="text-base font-semibold text-foreground">Ingresos recuperados en el tiempo</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {RANGE_LABEL[filters.dateRange ?? "30D"]}
        </p>
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
