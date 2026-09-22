import { Module } from "@nestjs/common";
import { OpportunityEngineService } from "./opportunity-engine.service";
import { OpportunitiesService } from "./opportunities.service";
import { OpportunitiesController } from "./opportunities.controller";

@Module({
  providers: [OpportunityEngineService, OpportunitiesService],
  controllers: [OpportunitiesController],
  exports: [OpportunitiesService, OpportunityEngineService],
})
export class OpportunitiesModule {}
