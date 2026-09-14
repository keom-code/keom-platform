import { z } from "zod";
import { IsoDateStringSchema, MoneySchema } from "./common";

export const PrioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const AlertStatusSchema = z.enum(["PENDING", "ACKNOWLEDGED", "COMPLETED"]);
export type AlertStatus = z.infer<typeof AlertStatusSchema>;

export const AlertCustomerSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  avatarUrl: z.string().url().optional(),
});
export type AlertCustomer = z.infer<typeof AlertCustomerSchema>;

/**
 * Seller-facing read model: what a seller needs to act on one opportunity.
 * Deliberately does not include admin-only fields (assigned seller, ack/complete
 * timestamps) — see docs/ARCHITECTURE.md Section H for why this is split from AdminAlertRow.
 */
export const SellerAlertSchema = z.object({
  id: z.string(),
  customer: AlertCustomerSchema,
  priority: PrioritySchema,
  opportunityValue: MoneySchema.optional(),
  summary: z.string(),
  requiredAction: z.string(),
  createdAt: IsoDateStringSchema,
  status: AlertStatusSchema,
  whatsappUrl: z.string().url(),
});
export type SellerAlert = z.infer<typeof SellerAlertSchema>;

/**
 * Admin-facing read model: one row in the audit/history table.
 * Same underlying alert as SellerAlert, shaped for oversight instead of action.
 */
export const AdminAlertRowSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  sellerName: z.string(),
  reason: z.string(),
  createdAt: IsoDateStringSchema,
  acknowledgedAt: IsoDateStringSchema.optional(),
  completedAt: IsoDateStringSchema.optional(),
  status: AlertStatusSchema,
});
export type AdminAlertRow = z.infer<typeof AdminAlertRowSchema>;

export const AdminAlertDetailSchema = AdminAlertRowSchema.extend({
  summary: z.string(),
});
export type AdminAlertDetail = z.infer<typeof AdminAlertDetailSchema>;
