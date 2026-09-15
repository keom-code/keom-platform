import { z } from "zod";
import { IsoDateStringSchema, MoneySchema } from "./common";

/** The 4 headline KPI numbers on /admin/reports. */
export const ReportSummarySchema = z.object({
  recoveredRevenue: MoneySchema,
  recoveredOpportunities: z.number().int().nonnegative(),
  recoveryRate: z.number().min(0).max(1),
  atRiskOpportunities: z.number().int().nonnegative(),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const RevenuePointSchema = z.object({
  date: IsoDateStringSchema,
  recoveredRevenue: MoneySchema,
  recoveredOpportunities: z.number().int().nonnegative(),
});
export type RevenuePoint = z.infer<typeof RevenuePointSchema>;

export const LossReasonSchema = z.object({
  reason: z.string(),
  percentage: z.number().min(0).max(1),
});
export type LossReason = z.infer<typeof LossReasonSchema>;

export const SellerMetricSchema = z.object({
  sellerId: z.string(),
  sellerName: z.string(),
  recoveredRevenue: MoneySchema,
  recoveredOpportunities: z.number().int().nonnegative(),
});
export type SellerMetric = z.infer<typeof SellerMetricSchema>;

export const TreatmentMetricSchema = z.object({
  treatment: z.string(),
  recoveredRevenue: MoneySchema,
  recoveredOpportunities: z.number().int().nonnegative(),
});
export type TreatmentMetric = z.infer<typeof TreatmentMetricSchema>;

/** Date-range preset for report filters; "CUSTOM" pairs with explicit from/to params. */
export const DateRangePresetSchema = z.enum(["TODAY", "7D", "30D", "CUSTOM"]);
export type DateRangePreset = z.infer<typeof DateRangePresetSchema>;

export const AdminReportSchema = z.object({
  summary: ReportSummarySchema,
  revenueTimeline: z.array(RevenuePointSchema),
  lossReasons: z.array(LossReasonSchema),
  recoveryBySeller: z.array(SellerMetricSchema),
  recoveryByTreatment: z.array(TreatmentMetricSchema),
});
export type AdminReport = z.infer<typeof AdminReportSchema>;
