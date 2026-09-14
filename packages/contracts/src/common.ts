import { z } from "zod";

/**
 * Amount in the deployment's currency (Soles for the pilot), as a plain number.
 * Flag with the backend whether this should become integer minor units (cents)
 * before real money starts flowing through reports — see docs/ARCHITECTURE.md Section H.
 */
export const MoneySchema = z.number().nonnegative();
export type Money = z.infer<typeof MoneySchema>;

/** ISO 8601 timestamp string, e.g. "2026-09-14T14:31:00.000Z". */
export const IsoDateStringSchema = z.string().datetime({ offset: true });
export type IsoDateString = z.infer<typeof IsoDateStringSchema>;
