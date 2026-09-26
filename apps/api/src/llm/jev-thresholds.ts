import { SignalType } from "../opportunities/opportunities.types";

/**
 * Decision thresholds for mapping Jev's raw answers onto CommercialInterpretation.
 * PROVISIONAL: chosen before any live evaluation and not claimed to be calibrated — tune
 * them against the human-labeled set in apps/api/evals and bump the version when they
 * change, so every evaluation report can say which thresholds produced it.
 *
 * A Noul probability p (probability of "yes") maps to:
 *   p >= yesAt           -> signal present
 *   p <= noAt            -> signal confidently absent
 *   noAt < p < yesAt     -> uncertain -> the whole interpretation fails (UNCERTAIN_OUTPUT)
 * NO_LONGER_INTERESTED gets a stricter band because M2A deactivates the Opportunity on it.
 */
export const JEV_THRESHOLDS_VERSION = "2026-09-26.provisional";

export interface JevSignalThreshold {
  yesAt: number;
  noAt: number;
}

const DEFAULT_SIGNAL_THRESHOLD: JevSignalThreshold = { yesAt: 0.8, noAt: 0.2 };

export const JEV_SIGNAL_THRESHOLDS: Record<SignalType, JevSignalThreshold> = {
  PRICING_REQUESTED: DEFAULT_SIGNAL_THRESHOLD,
  AVAILABILITY_REQUESTED: DEFAULT_SIGNAL_THRESHOLD,
  BOOKING_INTENT: DEFAULT_SIGNAL_THRESHOLD,
  PURCHASE_INTENT: DEFAULT_SIGNAL_THRESHOLD,
  QUOTE_REQUESTED: DEFAULT_SIGNAL_THRESHOLD,
  PAYMENT_QUESTION: DEFAULT_SIGNAL_THRESHOLD,
  FOLLOW_UP_REQUESTED: DEFAULT_SIGNAL_THRESHOLD,
  OBJECTION: DEFAULT_SIGNAL_THRESHOLD,
  NO_LONGER_INTERESTED: { yesAt: 0.9, noAt: 0.1 },
};

/** Minimum Jev-reported Choice `confidence` for the intent/interestLevel answers. This is
 * Jev's own statistic of its distribution, not the selected label's probability. */
export const JEV_CHOICE_MIN_CONFIDENCE = 0.5;
