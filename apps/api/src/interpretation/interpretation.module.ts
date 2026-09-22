import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { OpportunitiesModule } from "../opportunities/opportunities.module";
import { ContextBuilderService } from "./context-builder.service";
import { InterpretationService } from "./interpretation.service";
import { InterpretationController } from "./interpretation.controller";

@Module({
  imports: [LlmModule, OpportunitiesModule],
  providers: [ContextBuilderService, InterpretationService],
  controllers: [InterpretationController],
  exports: [InterpretationService],
})
export class InterpretationModule {}
