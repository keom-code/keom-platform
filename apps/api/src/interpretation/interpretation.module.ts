import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { OpportunitiesModule } from "../opportunities/opportunities.module";
import { ReevaluationSchedulerModule } from "../reevaluation/reevaluation-scheduler.module";
import { ContextBuilderService } from "./context-builder.service";
import { InterpretationService } from "./interpretation.service";
import { InterpretationController } from "./interpretation.controller";

@Module({
  imports: [LlmModule, OpportunitiesModule, ReevaluationSchedulerModule],
  providers: [ContextBuilderService, InterpretationService],
  controllers: [InterpretationController],
  // ContextBuilderService is also used by M3 (KnowledgeModule) for grounded suggestions.
  exports: [InterpretationService, ContextBuilderService],
})
export class InterpretationModule {}
