import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { z, ZodError } from "zod";
import { ReevaluationScheduler, ReevaluationSchedulingError } from "../reevaluation/reevaluation-scheduler.service";
import { OpportunitiesService } from "./opportunities.service";
import { EvaluateOpportunityRequestSchema } from "./evaluate-opportunity.schema";

const ScheduleFollowUpRequestSchema = z.object({
  companyId: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
});

/**
 * Dev-only diagnostic endpoint for M2A: exercises the deterministic Opportunity Engine
 * end-to-end without needing a real WhatsApp webhook delivery or a UI. Not a production
 * ingestion path, no auth — mirrors the manual curl flow documented for the M1 webhook
 * in apps/api/README.md. Signals are supplied by the caller (fixture/test/manual curl);
 * inferring them from Message text is M2B, not M2A.
 */
@Controller("dev/opportunities")
export class OpportunitiesController {
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly reevaluation: ReevaluationScheduler,
  ) {}

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
    // M4: schedule the next time-based check. Never fails the request (see ReevaluationScheduler).
    const reevaluation = await this.reevaluation.scheduleAfterEvaluation(opportunity);

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
      reevaluation,
    };
  }

  /**
   * Dev-only (M4): schedule an explicit FOLLOW_UP_DUE re-evaluation at `at`. When it fires,
   * M2A re-evaluates the opportunity on fresh data; M4 decides nothing itself.
   */
  @Post(":id/reevaluations")
  async scheduleFollowUp(@Param("id") id: string, @Body() body: unknown) {
    let payload;
    try {
      payload = ScheduleFollowUpRequestSchema.parse(body);
      z.string().uuid().parse(id);
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException("Invalid re-evaluation request");
      throw err;
    }

    try {
      return await this.reevaluation.scheduleFollowUp({ opportunityId: id, companyId: payload.companyId, at: new Date(payload.at) });
    } catch (err) {
      if (!(err instanceof ReevaluationSchedulingError)) throw err;
      switch (err.code) {
        case "NOT_FOUND":
          throw new NotFoundException(err.message);
        case "INVALID_TIME":
          throw new UnprocessableEntityException(err.message);
        default:
          throw new ServiceUnavailableException(err.message);
      }
    }
  }
}
