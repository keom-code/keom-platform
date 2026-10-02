import { Module } from "@nestjs/common";
import { ReevaluationQueue } from "./reevaluation.queue";
import { ReevaluationScheduler } from "./reevaluation-scheduler.service";

/**
 * M4 producer side. Deliberately does NOT import OpportunitiesModule, so the modules that
 * evaluate opportunities (OpportunitiesModule, InterpretationModule) can import this one to
 * schedule follow-up checks without a circular dependency. The worker side lives in
 * ReevaluationWorkerModule.
 */
@Module({
  providers: [ReevaluationQueue, ReevaluationScheduler],
  exports: [ReevaluationScheduler, ReevaluationQueue],
})
export class ReevaluationSchedulerModule {}
