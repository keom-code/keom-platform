import { z } from "zod";
import { INTEREST_LEVELS, InterestLevel, SIGNAL_TYPES, SignalType } from "../opportunities/opportunities.types";

/**
 * Runtime validation gate for raw LLM output (M2B). No raw provider output reaches
 * InterpretationService/OpportunitiesService without passing this — see
 * apps/api/README.md M2B "Runtime validation". Reuses M2A's SignalType/InterestLevel
 * values (SIGNAL_TYPES/INTEREST_LEVELS) rather than redeclaring them.
 */
export const CommercialInterpretationSchema = z.object({
  intent: z.enum(["BOOKING", "PRICING", "INFORMATION", "PURCHASE", "OTHER"]),
  interestLevel: z.enum(INTEREST_LEVELS as [InterestLevel, ...InterestLevel[]]),
  signals: z.array(z.enum(SIGNAL_TYPES as [SignalType, ...SignalType[]])).max(SIGNAL_TYPES.length),
  entities: z
    .object({
      requestedDate: z.string().optional(),
      requestedTime: z.string().optional(),
      serviceName: z.string().optional(),
      productName: z.string().optional(),
    })
    .default({}),
  confidence: z.number().min(0).max(1),
});

export type ValidatedCommercialInterpretation = z.infer<typeof CommercialInterpretationSchema>;
