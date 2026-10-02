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

export interface ReevaluateOpportunityRequest {
  opportunityId: string;
  companyId: string;
  now?: Date;
}

/** Outcome of a timer-triggered re-evaluation (M4). Only CHANGED wrote anything. */
export type ReevaluationOutcome =
  /** No opportunity with this id for this company (deleted, or a tenant mismatch). */
  | { status: "NOT_FOUND" }
  /** Deactivated or superseded since the job was scheduled. */
  | { status: "INACTIVE"; opportunity: Opportunity }
  /** Never evaluated with evidence, so there is nothing to re-run M2A on. */
  | { status: "NOT_EVALUATED"; opportunity: Opportunity }
  | { status: "UNCHANGED"; opportunity: Opportunity; evaluation: EvaluationResult }
  | { status: "CHANGED"; opportunity: Opportunity; evaluation: EvaluationResult; previous: Opportunity };

@Injectable()
export class OpportunitiesService {
  private readonly logger = new Logger(OpportunitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: OpportunityEngineService,
  ) {}

  /**
   * Returns `null` (no-op, nothing read/written beyond the initial lookup) when there is
   * no active Opportunity for this conversation AND no commercial signal was supplied —
   * e.g. an M2B interpretation that found nothing commercially relevant ("hola",
   * "gracias") must not spawn an empty Opportunity. An *existing* active Opportunity is
   * still reevaluated even with zero signals (safe reevaluation, e.g. settles into
   * NEW/LOW) — only opportunity *creation* requires evidence.
   */
  async evaluate(request: EvaluateOpportunityRequest): Promise<EvaluateOpportunityResult | null> {
    const existing = await this.findActiveOpportunity(request.conversationId);

    if (!existing && request.signals.length === 0) {
      this.logger.log(
        `No active Opportunity and no commercial signals for conversationId=${request.conversationId}; skipping (no-op)`,
      );
      return null;
    }

    const opportunity = existing ?? (await this.createOpportunity(request));

    const evaluation = this.engine.evaluate({
      interestLevel: request.interestLevel,
      signals: request.signals,
      lastInboundAt: request.lastInboundAt,
      lastOutboundAt: request.lastOutboundAt,
      now: request.now,
    });

    await this.persistSignals(opportunity.id, request.signals);
    const updated = await this.persistEvaluation(opportunity, evaluation, {
      interestLevel: request.interestLevel,
      currentSignals: request.signals.map((signal) => signal.type),
      evaluatedAt: request.now ?? new Date(),
    });

    return { opportunity: updated, evaluation };
  }

  /**
   * M4 entry point: re-run the same deterministic engine on the opportunity's current
   * evidence (`currentSignals` + `interestLevel` from its latest evaluation) with FRESH
   * timestamps read from the conversation's messages now — nothing captured when the job
   * was scheduled is trusted. Writes nothing unless the result differs from what is
   * persisted, and never inserts OpportunitySignal rows (there is no new evidence). All
   * reads are scoped by companyId, so a job can never touch another tenant's data.
   */
  async reevaluate(request: ReevaluateOpportunityRequest): Promise<ReevaluationOutcome> {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: request.opportunityId, companyId: request.companyId } });
    if (!opportunity) return { status: "NOT_FOUND" };
    if (!opportunity.isActive) return { status: "INACTIVE", opportunity };
    if (!opportunity.interestLevel) return { status: "NOT_EVALUATED", opportunity };

    const [lastInbound, lastOutbound] = await Promise.all(
      (["INBOUND", "OUTBOUND"] as const).map((direction) =>
        this.prisma.message.findFirst({
          where: { conversationId: opportunity.conversationId, companyId: request.companyId, direction },
          orderBy: { sentAt: "desc" },
          select: { sentAt: true },
        }),
      ),
    );

    const evaluation = this.engine.evaluate({
      interestLevel: opportunity.interestLevel as unknown as EvaluateOpportunityInput["interestLevel"],
      signals: opportunity.currentSignals.map((type) => ({ type: type as unknown as OpportunitySignalInput["type"] })),
      lastInboundAt: lastInbound?.sentAt,
      lastOutboundAt: lastOutbound?.sentAt,
      now: request.now,
    });

    if (await this.isUnchanged(opportunity, evaluation)) {
      return { status: "UNCHANGED", opportunity, evaluation };
    }

    const updated = await this.persistEvaluation(opportunity, evaluation, {
      interestLevel: opportunity.interestLevel as unknown as EvaluateOpportunityInput["interestLevel"],
      evaluatedAt: request.now ?? new Date(),
    });
    return { status: "CHANGED", opportunity: updated, evaluation, previous: opportunity };
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
  private async findActiveOpportunity(conversationId: string): Promise<Opportunity | null> {
    return this.prisma.opportunity.findFirst({
      where: { conversationId, isActive: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  private async createOpportunity(request: EvaluateOpportunityRequest): Promise<Opportunity> {
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

  /** Shared by evaluate() and reevaluate(): state history (on change), action
   * recommendation (on change), then the opportunity row itself. */
  private async persistEvaluation(
    opportunity: Opportunity,
    evaluation: EvaluationResult,
    data: { interestLevel: EvaluateOpportunityInput["interestLevel"]; currentSignals?: OpportunitySignalInput["type"][]; evaluatedAt: Date },
  ): Promise<Opportunity> {
    await this.persistStateChangeIfAny(opportunity, evaluation);
    await this.persistActionRecommendationIfChanged(opportunity.id, evaluation);

    return this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: {
        state: evaluation.state as unknown as PrismaOpportunityState,
        priority: evaluation.priority as unknown as PrismaPriority,
        risk: evaluation.risk as unknown as PrismaRiskLevel,
        interestLevel: data.interestLevel as unknown as PrismaInterestLevel,
        score: evaluation.score,
        isActive: evaluation.deactivate ? false : opportunity.isActive,
        lastEvaluatedAt: data.evaluatedAt,
        ...(data.currentSignals && { currentSignals: data.currentSignals as unknown as PrismaSignalType[] }),
      },
    });
  }

  private async isUnchanged(opportunity: Opportunity, evaluation: EvaluationResult): Promise<boolean> {
    if (
      evaluation.deactivate ||
      opportunity.state !== (evaluation.state as unknown as PrismaOpportunityState) ||
      opportunity.priority !== (evaluation.priority as unknown as PrismaPriority) ||
      opportunity.risk !== (evaluation.risk as unknown as PrismaRiskLevel) ||
      opportunity.score !== evaluation.score
    ) {
      return false;
    }
    const latest = await this.prisma.actionRecommendation.findFirst({ where: { opportunityId: opportunity.id }, orderBy: { createdAt: "desc" } });
    return latest?.action === (evaluation.nextBestAction as unknown as PrismaNextBestAction);
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
