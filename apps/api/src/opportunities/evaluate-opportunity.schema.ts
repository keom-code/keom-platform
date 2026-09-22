import { z } from "zod";

/** Request body for the dev-only POST /dev/opportunities/evaluate endpoint. */
export const SignalTypeSchema = z.enum([
  "PRICING_REQUESTED",
  "AVAILABILITY_REQUESTED",
  "BOOKING_INTENT",
  "PURCHASE_INTENT",
  "QUOTE_REQUESTED",
  "PAYMENT_QUESTION",
  "FOLLOW_UP_REQUESTED",
  "OBJECTION",
  "NO_LONGER_INTERESTED",
]);

export const InterestLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const EvaluateOpportunityRequestSchema = z.object({
  companyId: z.string().uuid(),
  customerId: z.string().uuid(),
  conversationId: z.string().uuid(),
  interestLevel: InterestLevelSchema,
  signals: z.array(
    z.object({
      type: SignalTypeSchema,
      confidence: z.number().min(0).max(1).optional(),
      sourceMessageId: z.string().uuid().optional(),
    }),
  ),
  lastInboundAt: z.string().datetime({ offset: true }).optional(),
  lastOutboundAt: z.string().datetime({ offset: true }).optional(),
});

export type EvaluateOpportunityRequestBody = z.infer<typeof EvaluateOpportunityRequestSchema>;
