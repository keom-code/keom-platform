import { z } from "zod";
import { IsoDateStringSchema, MoneySchema } from "./common";

export const RiskLevelSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const CustomerRiskSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
  avatarUrl: z.string().url().optional(),
  treatment: z.string().optional(),
  riskLevel: RiskLevelSchema,
  riskScore: z.number().min(0).max(100),
  reason: z.string(),
  opportunityValue: MoneySchema.optional(),
  lastActivityAt: IsoDateStringSchema,
});
export type CustomerRisk = z.infer<typeof CustomerRiskSchema>;
