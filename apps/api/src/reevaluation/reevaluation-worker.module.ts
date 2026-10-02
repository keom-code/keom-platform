import { Module } from "@nestjs/common";
import { OpportunitiesModule } from "../opportunities/opportunities.module";
import { ReevaluationProcessor } from "./reevaluation.processor";

/** M4 worker side: consumes re-evaluation jobs and hands them to M2A. */
@Module({
  imports: [OpportunitiesModule],
  providers: [ReevaluationProcessor],
})
export class ReevaluationWorkerModule {}
