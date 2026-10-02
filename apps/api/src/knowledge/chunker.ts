/**
 * Deterministic, character-based chunking for knowledge documents (M3). No tokenizer
 * dependency and no semantic chunking — the same normalized input always yields the same
 * chunks, which is what makes ingestion testable and re-indexing reproducible.
 *
 * Defaults (see apps/api/README.md M3 "Chunking"):
 * - maxChars 1200 (~300 tokens): FAQ/policy/pricing paragraphs are short, so a chunk holds
 *   one or two facts and retrieval stays precise.
 * - overlapChars 150: each chunk after the first starts with the tail of the previous one,
 *   so a fact straddling a boundary is still retrievable from either side.
 *
 * These are parameters with exported defaults, deliberately not env vars: changing them
 * silently would make existing documents' chunks inconsistent with new ones.
 *
 * Algorithm: split into blocks (blank lines; a Markdown heading also starts a block), split
 * any block longer than the body budget at sentence boundaries (then at a word boundary as
 * a last resort), greedily pack blocks into bodies, then prefix each body after the first
 * with the previous body's tail. Every chunk is <= maxChars, overlap included.
 */

export interface ChunkingOptions {
  maxChars: number;
  overlapChars: number;
}

export const DEFAULT_CHUNKING: ChunkingOptions = { maxChars: 1200, overlapChars: 150 };

const MIN_MAX_CHARS = 100;
const BLOCK_SEPARATOR = "\n\n";
const OVERLAP_SEPARATOR = "\n";
const HEADING = /^#{1,6}\s/;

export function chunkText(text: string, options: ChunkingOptions = DEFAULT_CHUNKING): string[] {
  const { maxChars, overlapChars } = options;
  if (!Number.isInteger(maxChars) || maxChars < MIN_MAX_CHARS) {
    throw new RangeError(`maxChars must be an integer >= ${MIN_MAX_CHARS}, got ${maxChars}`);
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars * 2 > maxChars) {
    throw new RangeError(`overlapChars must be an integer between 0 and maxChars / 2, got ${overlapChars}`);
  }

  const bodyBudget = overlapChars > 0 ? maxChars - overlapChars - OVERLAP_SEPARATOR.length : maxChars;
  const pieces = splitBlocks(text).flatMap((block) => splitToFit(block, bodyBudget));
  const bodies = pack(pieces, bodyBudget, BLOCK_SEPARATOR);

  return bodies.map((body, index) => {
    if (index === 0 || overlapChars === 0) return body;
    const overlap = tail(bodies[index - 1]!, overlapChars);
    return overlap ? `${overlap}${OVERLAP_SEPARATOR}${body}` : body;
  });
}

/** Paragraphs separated by blank lines; a Markdown heading line also starts a new block. */
function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flush();
    } else {
      if (HEADING.test(line)) flush();
      current.push(line);
    }
  }
  flush();
  return blocks;
}

/** Returns pieces each <= budget: the block itself, or its sentences/lines, or hard splits. */
function splitToFit(block: string, budget: number): string[] {
  if (block.length <= budget) return [block];

  const sentences = block.split(/(?<=[.!?…])\s+|\n/).filter((sentence) => sentence.trim() !== "");
  const fitted = sentences.flatMap((sentence) => (sentence.length <= budget ? [sentence] : hardSplit(sentence, budget)));
  return pack(fitted, budget, " ");
}

/** Last-resort split at the last whitespace before the budget, or exactly at it. */
function hardSplit(text: string, budget: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > budget) {
    const window = rest.slice(0, budget + 1);
    const cut = window.lastIndexOf(" ");
    const at = cut > 0 ? cut : budget;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Greedily joins consecutive pieces while the result stays <= budget. */
function pack(pieces: string[], budget: number, separator: string): string[] {
  const packed: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) {
      current = piece;
    } else if (current.length + separator.length + piece.length <= budget) {
      current = `${current}${separator}${piece}`;
    } else {
      packed.push(current);
      current = piece;
    }
  }
  if (current) packed.push(current);
  return packed;
}

/** Last <= n chars of text, snapped forward to a word boundary so no word is cut. */
function tail(text: string, n: number): string {
  if (text.length <= n) return text;
  const slice = text.slice(-n);
  const boundary = slice.search(/\s/);
  return (boundary >= 0 ? slice.slice(boundary) : slice).trim();
}
