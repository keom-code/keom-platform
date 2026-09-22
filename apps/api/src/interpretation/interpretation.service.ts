import { Inject, Injectable, Logger } from "@nestjs/common";
import { CommercialInterpreter, CommercialInterpretation, COMMERCIAL_INTERPRETER } from "../llm/commercial-interpreter";
import { EvaluateOpportunityResult, OpportunitiesService } from "../opportunities/opportunities.service";
import { ContextBuilderService } from "./context-builder.service";
import { mapInterpretationToOpportunityInput } from "./interpretation.mapper";

export interface InterpretationOutcome {
  interpretation: CommercialInterpretation;
  result: EvaluateOpportunityResult | null;
}

/**
 * M2B orchestrator: Context Builder -> CommercialInterpreter -> (runtime-validated by
 * the interpreter itself, see llm/commercial-interpretation.schema.ts) -> mapper ->
 * existing M2A OpportunitiesService.evaluate(). Never computes score/priority/state/
 * risk/nextBestAction itself ("LLM interprets, M2A decides") and never touches
 * Opportunity state when interpretation fails — the interpreter throws before any
 * OpportunitiesService call is reached, so a failure here is inherently a no-mutation
 * failure.
 */
@Injectable()
export class InterpretationService {
  private readonly logger = new Logger(InterpretationService.name);

  constructor(
    private readonly contextBuilder: ContextBuilderService,
    @Inject(COMMERCIAL_INTERPRETER) private readonly interpreter: CommercialInterpreter,
    private readonly opportunities: OpportunitiesService,
  ) {}

  async evaluate(conversationId: string): Promise<InterpretationOutcome> {
    const built = await this.contextBuilder.build(conversationId);

    const interpretation = await this.interpreter.interpret(built.context);

    const mapped = mapInterpretationToOpportunityInput({
      companyId: built.companyId,
      customerId: built.customerId,
      conversationId: built.conversationId,
      interpretation,
      lastInboundMessageId: built.lastInboundMessageId,
      lastInboundAt: built.lastInboundAt,
      lastOutboundAt: built.lastOutboundAt,
    });

    const result = await this.opportunities.evaluate(mapped);
    if (!result) {
      this.logger.log(`No commercial evidence and no active Opportunity for conversationId=${conversationId}; no-op`);
    }

    return { interpretation, result };
  }
}
