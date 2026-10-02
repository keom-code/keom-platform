import { Embedding, EmbeddingBatch, EmbeddingError, EmbeddingProvider, KNOWLEDGE_EMBEDDING_DIMENSIONS } from "../src/llm/embedding-provider";

/** Very common Spanish/English words, ignored so similarity reflects content words. */
const STOPWORDS = new Set(
  "a al and are as at con cual cuales de del el en es for from how in is la las los me mi o of on or para por que qué se su sus the to tu un una we y you".split(" "),
);

export const FAKE_EMBEDDING_MODEL = "fake-bag-of-words";

/**
 * Deterministic stand-in for a real embedding model in e2e tests — no network, no API key.
 * Hashed bag of words: each content word (lowercased, accents stripped) adds 1 to one of
 * 1536 dimensions, then the vector is L2-normalized. Cosine similarity therefore tracks
 * shared vocabulary, which is enough to exercise real pgvector storage, ranking, threshold
 * and tenant isolation reproducibly. Not a semantic model: test texts share words on purpose.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  /** Set to make the next call fail, to test no-partial-state behaviour. */
  failNext: EmbeddingError | null = null;

  async embed(text: string): Promise<Embedding> {
    const { model, vectors } = await this.embedMany([text]);
    return { model, vector: vectors[0]! };
  }

  async embedMany(texts: string[]): Promise<EmbeddingBatch> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    return { model: FAKE_EMBEDDING_MODEL, vectors: texts.map(fakeVector) };
  }
}

export function fakeVector(text: string): number[] {
  const vector = new Array<number>(KNOWLEDGE_EMBEDDING_DIMENSIONS).fill(0);
  const words = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));

  for (const word of words) {
    vector[fnv1a(word) % KNOWLEDGE_EMBEDDING_DIMENSIONS]! += 1;
  }
  // pgvector cosine distance is undefined for a zero vector; give empty text a direction.
  if (words.length === 0) vector[0] = 1;

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
