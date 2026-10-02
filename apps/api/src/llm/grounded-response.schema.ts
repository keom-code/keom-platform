import { z } from "zod";

/** Runtime validation gate for raw grounded-response LLM output (M3), as M2B does with
 * CommercialInterpretationSchema. Whether cited ids actually exist is checked afterwards
 * by GroundedResponseService, which knows the retrieved sources. */
export const GroundedResponderOutputSchema = z.object({
  suggestedResponse: z.string().trim().min(1).max(2000).nullable(),
  usedSourceIds: z.array(z.string().regex(/^S\d+$/)).max(50),
  insufficientKnowledge: z.boolean(),
  requiresLiveVerification: z.boolean(),
});
