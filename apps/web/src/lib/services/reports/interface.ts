import type { AdminReport, DateRangePreset } from "@keom/contracts";

export interface ReportFilters {
  dateRange?: DateRangePreset;
  sellerId?: string;
  treatment?: string;
}

export interface ReportFilterOptions {
  sellers: { id: string; name: string }[];
  treatments: string[];
}

export interface ReportsService {
  getAdminReport(filters?: ReportFilters): Promise<AdminReport>;
  listFilterOptions(): Promise<ReportFilterOptions>;
}
