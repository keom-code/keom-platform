import "server-only";
import { mockAdminReport } from "@keom/mocks";
import type { AdminReport, SellerMetric, TreatmentMetric } from "@keom/contracts";
import type { ReportFilterOptions, ReportFilters, ReportsService } from "./interface";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DAYS_BY_PRESET = { TODAY: 1, "7D": 7, "30D": 30, CUSTOM: 30 } as const;

function scaleByRatio<T extends { recoveredRevenue: number; recoveredOpportunities: number }>(
  items: T[],
  ratio: number,
): T[] {
  return items.map((item) => ({
    ...item,
    recoveredRevenue: Math.round(item.recoveredRevenue * ratio),
    recoveredOpportunities: Math.round(item.recoveredOpportunities * ratio),
  }));
}

export class MockReportsService implements ReportsService {
  async getAdminReport(filters: ReportFilters = {}): Promise<AdminReport> {
    await delay(300);

    const fullTimeline = mockAdminReport.revenueTimeline;
    const days = DAYS_BY_PRESET[filters.dateRange ?? "30D"];
    const timeline = fullTimeline.slice(-days);

    const fullRevenue = fullTimeline.reduce((sum, p) => sum + p.recoveredRevenue, 0);
    const slicedRevenue = timeline.reduce((sum, p) => sum + p.recoveredRevenue, 0);
    const ratio = fullRevenue > 0 ? slicedRevenue / fullRevenue : 0;

    const recoveredOpportunities = timeline.reduce(
      (sum, p) => sum + p.recoveredOpportunities,
      0,
    );
    // "At risk" and the recovery rate are current-pipeline snapshots, not derived from
    // the selected date range: we don't mock a "total lost" count to divide by, and
    // deriving the rate from recoveredOpportunities/atRiskOpportunities produced a
    // meaningless ~80% (atRisk is a small live snapshot, not a comparable denominator
    // for a 30-day cumulative count). Keep both fixed until real data exists.
    const atRiskOpportunities = mockAdminReport.summary.atRiskOpportunities;
    const recoveryRate = mockAdminReport.summary.recoveryRate;

    let recoveryBySeller: SellerMetric[] = scaleByRatio(mockAdminReport.recoveryBySeller, ratio);
    if (filters.sellerId) {
      recoveryBySeller = recoveryBySeller.filter((s) => s.sellerId === filters.sellerId);
    }

    let recoveryByTreatment: TreatmentMetric[] = scaleByRatio(
      mockAdminReport.recoveryByTreatment,
      ratio,
    );
    if (filters.treatment) {
      recoveryByTreatment = recoveryByTreatment.filter((t) => t.treatment === filters.treatment);
    }

    return {
      summary: {
        recoveredRevenue: slicedRevenue,
        recoveredOpportunities,
        recoveryRate,
        atRiskOpportunities,
      },
      revenueTimeline: timeline,
      lossReasons: mockAdminReport.lossReasons,
      recoveryBySeller,
      recoveryByTreatment,
    };
  }

  async listFilterOptions(): Promise<ReportFilterOptions> {
    await delay(100);
    return {
      sellers: mockAdminReport.recoveryBySeller.map((s) => ({ id: s.sellerId, name: s.sellerName })),
      treatments: mockAdminReport.recoveryByTreatment.map((t) => t.treatment),
    };
  }
}
