import { Injectable } from "@nestjs/common";
import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import { Embedding, EmbeddingBatch, EmbeddingError, EmbeddingProvider, KNOWLEDGE_EMBEDDING_DIMENSIONS } from "./embedding-provider";
import { loadOpenAiEmbeddingConfig, OpenAiEmbeddingConfig, resolveEmbeddingProvider } from "./embedding.config";

/** Inputs per embeddings request — well under the API's per-request input limit. */
export const EMBEDDING_BATCH_SIZE = 100;

/**
 * OpenAI EmbeddingProvider (M3), bound to EMBEDDING_PROVIDER in llm.module.ts. It is the
 * only provider today, so it validates EMBEDDING_PROVIDER itself; a second provider would
 * add a selector like ProviderSelectingInterpreter. `dimensions` is always sent and every
 * returned vector is checked against KNOWLEDGE_EMBEDDING_DIMENSIONS, so a misconfigured
 * model can never write vectors that don't fit the pgvector column.
 */
@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<Embedding> {
    const { model, vectors } = await this.embedMany([text]);
    return { model, vector: vectors[0]! };
  }

  async embedMany(texts: string[]): Promise<EmbeddingBatch> {
    resolveEmbeddingProvider();
    const config = loadOpenAiEmbeddingConfig();
    if (texts.length === 0) return { model: config.model, vectors: [] };

    const client = this.createClient(config);
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
      vectors.push(...(await this.request(client, config, batch)));
    }
    return { model: config.model, vectors };
  }

  /** Extracted so tests can override this one seam (subclass + stub), as in M2B. */
  protected createClient(config: OpenAiEmbeddingConfig): OpenAI {
    return new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs });
  }

  private async request(client: OpenAI, config: OpenAiEmbeddingConfig, input: string[]): Promise<number[][]> {
    let response: OpenAI.Embeddings.CreateEmbeddingResponse;
    try {
      response = await client.embeddings.create({
        model: config.model,
        input,
        dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
        encoding_format: "float",
      });
    } catch (err) {
      if (err instanceof APIConnectionTimeoutError) {
        throw new EmbeddingError("PROVIDER_TIMEOUT", "Embedding provider request timed out.", err);
      }
      if (err instanceof APIError) {
        throw new EmbeddingError("PROVIDER_ERROR", `Embedding provider request failed: ${err.message}`, err);
      }
      throw new EmbeddingError("PROVIDER_ERROR", "Embedding provider request failed.", err);
    }

    const data = [...(response.data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== input.length) {
      throw new EmbeddingError("INVALID_OUTPUT", `Expected ${input.length} embeddings, got ${data.length}.`);
    }
    return data.map(({ embedding }) => {
      if (embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
        throw new EmbeddingError("INVALID_OUTPUT", `Expected ${KNOWLEDGE_EMBEDDING_DIMENSIONS} dimensions, got ${embedding.length}.`);
      }
      if (!embedding.every(Number.isFinite)) {
        throw new EmbeddingError("INVALID_OUTPUT", "Embedding contains non-finite values.");
      }
      return embedding;
    });
  }
}
