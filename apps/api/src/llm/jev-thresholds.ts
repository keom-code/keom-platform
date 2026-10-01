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
 *   noAt < p < yesAt     -> uncertain, resolved by `onUncertain`:
 *                           "absent" -> the signal is left out (low-stakes signals)
 *                           "fail"   -> the whole interpretation fails (UNCERTAIN_OUTPUT)
 * NO_LONGER_INTERESTED gets a stricter band and always fails when uncertain, because M2A
 * deactivates the Opportunity on it. The other signals only nudge score/priority, so an
 * uncertain one is dropped rather than failing the whole message (2026-10-01: with "fail"
 * everywhere, 26/50 eval cases failed, almost always on one gray-zone signal).
 */
export const JEV_THRESHOLDS_VERSION = "2026-10-01.provisional";

export interface JevSignalThreshold {
  yesAt: number;
  noAt: number;
  onUncertain: "absent" | "fail";
}

const DEFAULT_SIGNAL_THRESHOLD: JevSignalThreshold = { yesAt: 0.8, noAt: 0.2, onUncertain: "absent" };

export const JEV_SIGNAL_THRESHOLDS: Record<SignalType, JevSignalThreshold> = {
  PRICING_REQUESTED: DEFAULT_SIGNAL_THRESHOLD,
  AVAILABILITY_REQUESTED: DEFAULT_SIGNAL_THRESHOLD,
  BOOKING_INTENT: DEFAULT_SIGNAL_THRESHOLD,
  PURCHASE_INTENT: DEFAULT_SIGNAL_THRESHOLD,
  QUOTE_REQUESTED: DEFAULT_SIGNAL_THRESHOLD,
  PAYMENT_QUESTION: DEFAULT_SIGNAL_THRESHOLD,
  FOLLOW_UP_REQUESTED: DEFAULT_SIGNAL_THRESHOLD,
  OBJECTION: DEFAULT_SIGNAL_THRESHOLD,
  NO_LONGER_INTERESTED: { yesAt: 0.9, noAt: 0.1, onUncertain: "fail" },
};

/** Minimum Jev-reported Choice `confidence` for the intent/interestLevel answers. This is
 * Jev's own statistic of its distribution, not the selected label's probability. */
export const JEV_CHOICE_MIN_CONFIDENCE = 0.5;
