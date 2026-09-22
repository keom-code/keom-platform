import { Injectable } from "@nestjs/common";
import {
  EvaluateOpportunityInput,
  EvaluationResult,
  InterestLevel,
  NextBestAction,
  OpportunityState,
  Priority,
  RiskLevel,
  ScoreBreakdownEntry,
  SignalType,
} from "./opportunities.types";

/** Signal -> score weight. Not exhaustive by design: OBJECTION/NO_LONGER_INTERESTED are
 * commercially negative, so they subtract instead of adding — without this, "signals are
 * inputs, rules make decisions" would treat a negative signal as commercially neutral. */
const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  PRICING_REQUESTED: 15,
  AVAILABILITY_REQUESTED: 25,
  BOOKING_INTENT: 30,
  PURCHASE_INTENT: 30,
  QUOTE_REQUESTED: 20,
  PAYMENT_QUESTION: 20,
  FOLLOW_UP_REQUESTED: 10,
  OBJECTION: -15,
  NO_LONGER_INTERESTED: -30,
};

const INTEREST_LEVEL_WEIGHTS: Record<InterestLevel, number> = {
  LOW: 0,
  MEDIUM: 10,
  HIGH: 20,
};

const PRIORITY_THRESHOLDS: { min: number; priority: Priority }[] = [
  { min: 70, priority: "HIGH" },
  { min: 40, priority: "MEDIUM" },
  { min: 0, priority: "LOW" },
];

/** No scheduler in M2A: risk is evaluated synchronously from timestamps already on the
 * request, using these fixed thresholds. Automatic/periodic reevaluation is a later
 * milestone (see apps/api/README.md). */
const STALL_HIGH_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const STALL_MEDIUM_THRESHOLD_MS = 60 * 60 * 1000;

@Injectable()
export class OpportunityEngineService {
  evaluate(input: EvaluateOpportunityInput): EvaluationResult {
    const signalTypes = input.signals.map((signal) => signal.type);
    const has = (type: SignalType) => signalTypes.includes(type);

    const { score, scoreBreakdown } = this.computeScore(input.interestLevel, signalTypes);
    const priority = this.computePriority(score);
    const { risk, riskReason } = this.computeRisk(input, priority);
    const { state, stateReason } = this.computeState(signalTypes, priority, risk);
    const { nextBestAction, actionReason } = this.computeNextBestAction(has, priority, risk);

    const result: EvaluationResult = {
      score,
      scoreBreakdown,
      priority,
      state,
      stateReason,
      risk,
      riskReason,
      nextBestAction,
      actionReason,
      deactivate: false,
    };

    return has("NO_LONGER_INTERESTED") ? this.applyNoLongerInterestedOverride(result) : result;
  }

  private computeScore(
    interestLevel: InterestLevel,
    signalTypes: SignalType[],
  ): { score: number; scoreBreakdown: ScoreBreakdownEntry[] } {
    const breakdown: ScoreBreakdownEntry[] = signalTypes.map((type) => ({
      signal: type,
      points: SIGNAL_WEIGHTS[type],
    }));
    breakdown.push({ signal: "INTEREST_LEVEL", points: INTEREST_LEVEL_WEIGHTS[interestLevel] });

    const raw = breakdown.reduce((sum, entry) => sum + entry.points, 0);
    const score = Math.max(0, Math.min(100, raw));

    return { score, scoreBreakdown: breakdown };
  }

  private computePriority(score: number): Priority {
    return PRIORITY_THRESHOLDS.find((threshold) => score >= threshold.min)!.priority;
  }

  /**
   * MVP state model (see apps/api/README.md): NEW/ENGAGED/HIGH_INTENT/AT_RISK only, no
   * terminal states. AT_RISK takes precedence over ENGAGED/HIGH_INTENT once risk is
   * known to be HIGH — "stalled" is a more urgent classification than "engaged".
   */
  private computeState(
    signalTypes: SignalType[],
    priority: Priority,
    risk: RiskLevel,
  ): { state: OpportunityState; stateReason: string } {
    const hasStrongCommercialSignal = signalTypes.includes("BOOKING_INTENT") || signalTypes.includes("PURCHASE_INTENT");

    if (signalTypes.length === 0) {
      return { state: "NEW", stateReason: "No commercial signals detected yet." };
    }

    if (risk === "HIGH") {
      return { state: "AT_RISK", stateReason: "Commercially relevant but stalled — takes precedence over ENGAGED/HIGH_INTENT." };
    }

    if (hasStrongCommercialSignal && priority === "HIGH") {
      return {
        state: "HIGH_INTENT",
        stateReason: "Strong booking/purchase signal(s) combined with HIGH priority.",
      };
    }

    return { state: "ENGAGED", stateReason: "Commercial signal(s) detected, not yet strong enough for HIGH_INTENT." };
  }

  /**
   * Risk answers "is this stalling?", not "how important is it?" (Priority). Evaluated
   * synchronously from `lastInboundAt`/`lastOutboundAt` already on the request — no
   * background timer/scheduler in M2A.
   */
  private computeRisk(input: EvaluateOpportunityInput, priority: Priority): { risk: RiskLevel; riskReason: string } {
    const eligible = input.interestLevel === "HIGH" || priority === "HIGH";
    if (!eligible) {
      return { risk: "LOW", riskReason: "Interest/priority too low to evaluate stall risk." };
    }

    if (!input.lastInboundAt) {
      return { risk: "LOW", riskReason: "No inbound message timestamp available to evaluate stall risk." };
    }

    const respondedAfterInbound = !!input.lastOutboundAt && input.lastOutboundAt >= input.lastInboundAt;
    if (respondedAfterInbound) {
      return { risk: "LOW", riskReason: "Business already responded after the last inbound message." };
    }

    const now = input.now ?? new Date();
    const elapsedMs = now.getTime() - input.lastInboundAt.getTime();

    if (elapsedMs > STALL_HIGH_THRESHOLD_MS) {
      return {
        risk: "HIGH",
        riskReason: `No business response for over ${STALL_HIGH_THRESHOLD_MS / 3_600_000}h since the last inbound message.`,
      };
    }
    if (elapsedMs > STALL_MEDIUM_THRESHOLD_MS) {
      return {
        risk: "MEDIUM",
        riskReason: `No business response for over ${STALL_MEDIUM_THRESHOLD_MS / 3_600_000}h since the last inbound message.`,
      };
    }
    return { risk: "LOW", riskReason: "Still within the normal reply window." };
  }

  /** First matching rule wins — kept as an explicit ordered list, not a scoring system,
   * so the recommendation stays as explainable as the priority score. */
  private computeNextBestAction(
    has: (type: SignalType) => boolean,
    priority: Priority,
    risk: RiskLevel,
  ): { nextBestAction: NextBestAction; actionReason: string } {
    if (has("OBJECTION")) {
      return { nextBestAction: "ESCALATE_TO_HUMAN", actionReason: "Customer raised an objection." };
    }
    if (has("BOOKING_INTENT") && has("AVAILABILITY_REQUESTED")) {
      return {
        nextBestAction: "OFFER_APPOINTMENT",
        actionReason: "Customer expressed booking intent and asked about availability.",
      };
    }
    if (priority === "HIGH" && risk === "HIGH") {
      return { nextBestAction: "FOLLOW_UP", actionReason: "HIGH priority opportunity is stalling." };
    }
    if (has("PRICING_REQUESTED") || has("QUOTE_REQUESTED")) {
      return { nextBestAction: "SEND_INFORMATION", actionReason: "Customer asked about pricing/a quote." };
    }
    if (has("PAYMENT_QUESTION")) {
      return { nextBestAction: "ASK_QUESTION", actionReason: "Customer asked a payment-related question." };
    }
    if (has("FOLLOW_UP_REQUESTED")) {
      return { nextBestAction: "FOLLOW_UP", actionReason: "Customer explicitly asked for a follow-up." };
    }
    if (risk === "LOW" && priority === "LOW") {
      return { nextBestAction: "WAIT", actionReason: "No urgent commercial signal yet." };
    }
    return { nextBestAction: "RESPOND", actionReason: "Default: respond to keep the conversation moving." };
  }

  /**
   * NO_LONGER_INTERESTED is not just a negative score weight (per M2A scope): it's an
   * explicit business-rule override. M2A has no terminal lifecycle state, so instead of
   * a LOST state this forces a deterministic low-priority/inactive outcome and signals
   * the caller (OpportunitiesService) to deactivate the Opportunity. A later milestone
   * should introduce a real terminal state (e.g. LOST) once outcomes are tracked.
   */
  private applyNoLongerInterestedOverride(result: EvaluationResult): EvaluationResult {
    return {
      ...result,
      priority: "LOW",
      risk: "LOW",
      riskReason: "Customer indicated no longer interested; not evaluated as stalling.",
      nextBestAction: "WAIT",
      actionReason: "Customer indicated no longer interested; deprioritized pending future re-engagement.",
      deactivate: true,
    };
  }
}
