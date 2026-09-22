import { BadGatewayException, BadRequestException, Body, Controller, GatewayTimeoutException, Post, ServiceUnavailableException } from "@nestjs/common";
import { ZodError } from "zod";
import { InterpretationError } from "../llm/commercial-interpreter";
import { EvaluateInterpretationRequestSchema } from "./evaluate-interpretation.schema";
import { InterpretationService } from "./interpretation.service";

/**
 * Dev-only diagnostic endpoint for M2B: given a conversationId, builds bounded context
 * from already-persisted messages, calls the configured LLM, and — on a valid,
 * runtime-validated interpretation — feeds it straight into the existing M2A engine.
 * Doubles as the manual real-LLM test path (see apps/api/README.md M2B section): with
 * real LLM_PROVIDER/LLM_MODEL/OPENAI_API_KEY set, this endpoint makes a real provider
 * call; in automated tests, CommercialInterpreter is DI-overridden with a mock.
 */
@Controller("dev/interpretation")
export class InterpretationController {
  constructor(private readonly interpretation: InterpretationService) {}

  @Post("evaluate")
  async evaluate(@Body() body: unknown) {
    let payload;
    try {
      payload = EvaluateInterpretationRequestSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException("Invalid interpretation evaluation request");
      }
      throw err;
    }

    try {
      const { interpretation, result } = await this.interpretation.evaluate(payload.conversationId);

      return {
        interpretation,
        opportunity: result
          ? {
              opportunityId: result.opportunity.id,
              state: result.evaluation.state,
              priority: result.evaluation.priority,
              risk: result.evaluation.risk,
              nextBestAction: result.evaluation.nextBestAction,
              score: result.evaluation.score,
              scoreBreakdown: result.evaluation.scoreBreakdown,
              reasons: {
                state: result.evaluation.stateReason,
                risk: result.evaluation.riskReason,
                action: result.evaluation.actionReason,
              },
              isActive: result.opportunity.isActive,
            }
          : { noOp: true, reason: "No active Opportunity and no commercial signal detected; nothing created." },
      };
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private toHttpException(err: unknown): Error {
    if (!(err instanceof InterpretationError)) {
      return err instanceof Error ? err : new Error(String(err));
    }

    switch (err.code) {
      case "MISSING_CONFIG":
      case "INVALID_CONFIG":
        return new ServiceUnavailableException(err.message);
      case "PROVIDER_TIMEOUT":
        return new GatewayTimeoutException(err.message);
      case "PROVIDER_ERROR":
      case "EMPTY_RESPONSE":
      case "INVALID_OUTPUT":
        return new BadGatewayException(err.message);
      default:
        return err;
    }
  }
}
