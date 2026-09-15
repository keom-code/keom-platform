import "server-only";
import { mockAdminReport, mockRevenueTimeline60d } from "@keom/mocks";
import type { AdminReport, RevenuePoint, SellerMetric, TreatmentMetric } from "@keom/contracts";
import type { ReportFilterOptions, ReportFilters, ReportsService } from "./interface";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DAYS_BY_PRESET = { TODAY: 1, "7D": 7, "30D": 30, CUSTOM: 30 } as const;

function sumRevenue(points: RevenuePoint[]) {
  return {
    recoveredRevenue: points.reduce((sum, p) => sum + p.recoveredRevenue, 0),
    recoveredOpportunities: points.reduce((sum, p) => sum + p.recoveredOpportunities, 0),
  };
}

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

    const days = DAYS_BY_PRESET[filters.dateRange ?? "30D"];
    // The trailing 30 days back recoveryBySeller/recoveryByTreatment's ratio scaling
    // (unchanged from before); the 30 days before that back the "vs período anterior"
    // trend, so both fit inside the 60-day mock timeline.
    const currentBaseline = mockRevenueTimeline60d.slice(-30);
    const timeline = mockRevenueTimeline60d.slice(-days);
    const previousTimeline = mockRevenueTimeline60d.slice(-days * 2, -days);

    const current = sumRevenue(timeline);
    const previous = sumRevenue(previousTimeline);

    const fullRevenue = currentBaseline.reduce((sum, p) => sum + p.recoveredRevenue, 0);
    const ratio = fullRevenue > 0 ? current.recoveredRevenue / fullRevenue : 0;

    // "At risk" and the recovery rate are current-pipeline snapshots, not derived from
    // the selected date range: we don't mock a "total lost" count to divide by, and
    // deriving the rate from recoveredOpportunities/atRiskOpportunities produced a
    // meaningless ~80% (atRisk is a small live snapshot, not a comparable denominator
    // for a 30-day cumulative count). Keep both fixed until real data exists.
    const atRiskOpportunities = mockAdminReport.summary.atRiskOpportunities;
    const recoveryRate = mockAdminReport.summary.recoveryRate;
    const previousAtRiskOpportunities = mockAdminReport.summary.previousAtRiskOpportunities;
    const previousRecoveryRate = mockAdminReport.summary.previousRecoveryRate;

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
        recoveredRevenue: current.recoveredRevenue,
        recoveredOpportunities: current.recoveredOpportunities,
        recoveryRate,
        atRiskOpportunities,
        previousRecoveredRevenue: previous.recoveredRevenue,
        previousRecoveredOpportunities: previous.recoveredOpportunities,
        previousRecoveryRate,
        previousAtRiskOpportunities,
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
