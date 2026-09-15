import { MockReportsService } from "./mock";
import type { ReportsService } from "./interface";

export type { ReportFilterOptions, ReportFilters, ReportsService } from "./interface";

// No HttpReportsService yet — see docs/ARCHITECTURE.md Section H / Phase 11.
export const reportsService: ReportsService = new MockReportsService();
