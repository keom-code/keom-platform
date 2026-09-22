import { z } from "zod";

/** Request body for the dev-only POST /dev/interpretation/evaluate endpoint. No signals,
 * no interestLevel — those come from the LLM, not the caller (contrast with M2A's
 * dev endpoint, which still accepts structured signals directly for M2A-only testing). */
export const EvaluateInterpretationRequestSchema = z.object({
  conversationId: z.string().uuid(),
});

export type EvaluateInterpretationRequestBody = z.infer<typeof EvaluateInterpretationRequestSchema>;
