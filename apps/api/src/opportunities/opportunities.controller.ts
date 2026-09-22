import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { ZodError } from "zod";
import { OpportunitiesService } from "./opportunities.service";
import { EvaluateOpportunityRequestSchema } from "./evaluate-opportunity.schema";

/**
 * Dev-only diagnostic endpoint for M2A: exercises the deterministic Opportunity Engine
 * end-to-end without needing a real WhatsApp webhook delivery or a UI. Not a production
 * ingestion path, no auth — mirrors the manual curl flow documented for the M1 webhook
 * in apps/api/README.md. Signals are supplied by the caller (fixture/test/manual curl);
 * inferring them from Message text is M2B, not M2A.
 */
@Controller("dev/opportunities")
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Post("evaluate")
  async evaluate(@Body() body: unknown) {
    let payload;
    try {
      payload = EvaluateOpportunityRequestSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException("Invalid opportunity evaluation request");
      }
      throw err;
    }

    const result = await this.opportunities.evaluate({
      companyId: payload.companyId,
      customerId: payload.customerId,
      conversationId: payload.conversationId,
      interestLevel: payload.interestLevel,
      signals: payload.signals,
      lastInboundAt: payload.lastInboundAt ? new Date(payload.lastInboundAt) : undefined,
      lastOutboundAt: payload.lastOutboundAt ? new Date(payload.lastOutboundAt) : undefined,
    });

    if (!result) {
      return { noOp: true, reason: "No active Opportunity and no commercial signal supplied; nothing created." };
    }

    const { opportunity, evaluation } = result;

    return {
      opportunityId: opportunity.id,
      state: evaluation.state,
      priority: evaluation.priority,
      risk: evaluation.risk,
      nextBestAction: evaluation.nextBestAction,
      score: evaluation.score,
      scoreBreakdown: evaluation.scoreBreakdown,
      reasons: {
        state: evaluation.stateReason,
        risk: evaluation.riskReason,
        action: evaluation.actionReason,
      },
      isActive: opportunity.isActive,
    };
  }
}
