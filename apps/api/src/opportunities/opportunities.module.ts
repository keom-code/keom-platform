import { Module } from "@nestjs/common";
import { ReevaluationSchedulerModule } from "../reevaluation/reevaluation-scheduler.module";
import { OpportunityEngineService } from "./opportunity-engine.service";
import { OpportunitiesService } from "./opportunities.service";
import { OpportunitiesController } from "./opportunities.controller";

@Module({
  imports: [ReevaluationSchedulerModule],
  providers: [OpportunityEngineService, OpportunitiesService],
  controllers: [OpportunitiesController],
  exports: [OpportunitiesService, OpportunityEngineService],
})
export class OpportunitiesModule {}
