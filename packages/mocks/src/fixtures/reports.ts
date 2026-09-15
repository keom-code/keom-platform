import type { AdminReport, RevenuePoint } from "@keom/contracts";

/**
 * Deterministic 30-day revenue timeline ending 2026-09-14 (today, per the mock DNI
 * users' world). The reports mock service (apps/web) slices this per date-range
 * filter and derives the summary KPIs from the slice — this is the single source of
 * truth for anything date-dependent in the report.
 */
function buildRevenueTimeline(days: number): RevenuePoint[] {
  const points: RevenuePoint[] = [];
  const endDate = new Date("2026-09-14T00:00:00.000Z");
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(endDate);
    date.setUTCDate(date.getUTCDate() - i);
    const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const wave = Math.sin(i / 2.5) * 450;
    const recoveredRevenue = Math.max(300, Math.round(2200 + wave - (isWeekend ? 900 : 0)));
    const recoveredOpportunities = Math.max(1, Math.round(recoveredRevenue / 820));
    points.push({ date: date.toISOString(), recoveredRevenue, recoveredOpportunities });
  }
  return points;
}

export const mockRevenueTimeline30d: RevenuePoint[] = buildRevenueTimeline(30);

/**
 * "At risk" is a current-pipeline snapshot, not a function of the selected date
 * range — see docs/ARCHITECTURE.md-adjacent note in apps/web/src/lib/services/reports.
 */
export const mockAdminReport: AdminReport = {
  summary: {
    recoveredRevenue: mockRevenueTimeline30d.reduce((sum, p) => sum + p.recoveredRevenue, 0),
    recoveredOpportunities: mockRevenueTimeline30d.reduce(
      (sum, p) => sum + p.recoveredOpportunities,
      0,
    ),
    recoveryRate: 0.318,
    atRiskOpportunities: 17,
  },
  revenueTimeline: mockRevenueTimeline30d,
  lossReasons: [
    { reason: "Sin seguimiento", percentage: 0.38 },
    { reason: "Objeción de precio", percentage: 0.27 },
    { reason: "Respuesta lenta del vendedor", percentage: 0.18 },
    { reason: "Sin disponibilidad", percentage: 0.09 },
    { reason: "Problema de pago", percentage: 0.05 },
    { reason: "Otro", percentage: 0.03 },
  ],
  // 30-day totals, split proportionally like before — the mock reports service scales
  // these down when a shorter date range is selected.
  recoveryBySeller: [
    {
      sellerId: "user_seller_1",
      sellerName: "Carlos Ramirez",
      recoveredRevenue: 30400,
      recoveredOpportunities: 36,
    },
    {
      sellerId: "user_seller_2",
      sellerName: "Fernanda Cruz",
      recoveredRevenue: 27800,
      recoveredOpportunities: 33,
    },
  ],
  recoveryByTreatment: [
    { treatment: "Depilación láser", recoveredRevenue: 22350, recoveredOpportunities: 26 },
    { treatment: "Limpieza facial", recoveredRevenue: 15830, recoveredOpportunities: 19 },
    { treatment: "Masaje relajante", recoveredRevenue: 13035, recoveredOpportunities: 15 },
    { treatment: "Otro", recoveredRevenue: 6980, recoveredOpportunities: 8 },
  ],
};
