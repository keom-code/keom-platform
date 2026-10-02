/**
 * Deterministic, industry-agnostic text normalization applied to every knowledge document
 * before chunking/hashing (M3). Only whitespace/encoding cleanup — never rewrites wording,
 * so what is stored is exactly what the business supplied, minus formatting noise.
 */

// Control characters except \t (\u0009) and \n (\u000A). \r is handled before this runs.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export function normalizeText(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .split("\n")
    .map((line) => line.replace(/[\t \u00A0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
