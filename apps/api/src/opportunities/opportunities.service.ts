import { Injectable, Logger } from "@nestjs/common";
import {
  InterestLevel as PrismaInterestLevel,
  NextBestAction as PrismaNextBestAction,
  Opportunity,
  OpportunityState as PrismaOpportunityState,
  Priority as PrismaPriority,
  RiskLevel as PrismaRiskLevel,
  SignalType as PrismaSignalType,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OpportunityEngineService } from "./opportunity-engine.service";
import { EvaluateOpportunityInput, EvaluationResult, OpportunitySignalInput } from "./opportunities.types";

export interface EvaluateOpportunityRequest extends EvaluateOpportunityInput {
  companyId: string;
  customerId: string;
  conversationId: string;
}

export interface EvaluateOpportunityResult {
  opportunity: Opportunity;
  evaluation: EvaluationResult;
}

@Injectable()
export class OpportunitiesService {
  private readonly logger = new Logger(OpportunitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: OpportunityEngineService,
  ) {}

  async evaluate(request: EvaluateOpportunityRequest): Promise<EvaluateOpportunityResult> {
    const opportunity = await this.resolveOrCreateActiveOpportunity(request);

    const evaluation = this.engine.evaluate({
      interestLevel: request.interestLevel,
      signals: request.signals,
      lastInboundAt: request.lastInboundAt,
      lastOutboundAt: request.lastOutboundAt,
      now: request.now,
    });

    await this.persistSignals(opportunity.id, request.signals);
    await this.persistStateChangeIfAny(opportunity, evaluation);
    await this.persistActionRecommendationIfChanged(opportunity.id, evaluation);

    const updated = await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: {
        state: evaluation.state as unknown as PrismaOpportunityState,
        priority: evaluation.priority as unknown as PrismaPriority,
        risk: evaluation.risk as unknown as PrismaRiskLevel,
        interestLevel: request.interestLevel as unknown as PrismaInterestLevel,
        score: evaluation.score,
        isActive: evaluation.deactivate ? false : opportunity.isActive,
        lastEvaluatedAt: request.now ?? new Date(),
      },
    });

    return { opportunity: updated, evaluation };
  }

  /**
   * MVP opportunity resolution (M2A scope, see apps/api/README.md): "relevant" means
   * "the most recently updated active Opportunity on this conversation" — no
   * intent/topic matching. A conversation may accumulate multiple Opportunities over
   * time (e.g. a NO_LONGER_INTERESTED evaluation deactivates one, and a later
   * re-engagement creates a new one); at most one is ever treated as "active" at a
   * time in M2A. There is deliberately no DB-level uniqueness constraint enforcing
   * this — multiple concurrent opportunities per conversation are a valid future
   * evolution this design leaves room for.
   */
  private async resolveOrCreateActiveOpportunity(request: EvaluateOpportunityRequest): Promise<Opportunity> {
    const existing = await this.prisma.opportunity.findFirst({
      where: { conversationId: request.conversationId, isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) {
      return existing;
    }

    this.logger.log(`No active Opportunity for conversationId=${request.conversationId}; creating one`);
    return this.prisma.opportunity.create({
      data: {
        companyId: request.companyId,
        customerId: request.customerId,
        conversationId: request.conversationId,
      },
    });
  }

  private async persistSignals(opportunityId: string, signals: OpportunitySignalInput[]): Promise<void> {
    if (signals.length === 0) return;
    await this.prisma.opportunitySignal.createMany({
      data: signals.map((signal) => ({
        opportunityId,
        type: signal.type as unknown as PrismaSignalType,
        confidence: signal.confidence,
        sourceMessageId: signal.sourceMessageId,
      })),
    });
  }

  /** Only inserts a history row when the state actually changes — reevaluating to the
   * same state must not produce duplicate history entries. */
  private async persistStateChangeIfAny(opportunity: Opportunity, evaluation: EvaluationResult): Promise<void> {
    if (opportunity.state === (evaluation.state as unknown as PrismaOpportunityState)) return;

    await this.prisma.opportunityStateHistory.create({
      data: {
        opportunityId: opportunity.id,
        previousState: opportunity.state,
        newState: evaluation.state as unknown as PrismaOpportunityState,
        reason: evaluation.stateReason,
      },
    });
  }

  /** Only inserts a new recommendation when the recommended action changes from the
   * latest one — reevaluating to the same action must not produce duplicate rows. */
  private async persistActionRecommendationIfChanged(opportunityId: string, evaluation: EvaluationResult): Promise<void> {
    const latest = await this.prisma.actionRecommendation.findFirst({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
    });

    if (latest?.action === (evaluation.nextBestAction as unknown as PrismaNextBestAction)) return;

    await this.prisma.actionRecommendation.create({
      data: {
        opportunityId,
        action: evaluation.nextBestAction as unknown as PrismaNextBestAction,
        reason: evaluation.actionReason,
        priority: evaluation.priority as unknown as PrismaPriority,
      },
    });
  }
}
