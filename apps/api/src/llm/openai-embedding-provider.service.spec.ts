import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import { EmbeddingError, KNOWLEDGE_EMBEDDING_DIMENSIONS } from "./embedding-provider";
import { OpenAiEmbeddingConfig } from "./embedding.config";
import { EMBEDDING_BATCH_SIZE, OpenAiEmbeddingProvider } from "./openai-embedding-provider.service";

/** No real network calls: `createClient` is stubbed via subclassing, as in the M2B specs. */
function fakeClient(create: jest.Mock): OpenAI {
  return { embeddings: { create } } as unknown as OpenAI;
}

class TestableProvider extends OpenAiEmbeddingProvider {
  constructor(private readonly client: OpenAI) {
    super();
  }
  protected override createClient(_config: OpenAiEmbeddingConfig): OpenAI {
    return this.client;
  }
}

function vector(seed: number, length = KNOWLEDGE_EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length }, (_, i) => (i === seed % length ? 1 : 0));
}

/** Mirrors the API: one item per input, `index` in input order. */
function respondWithVectors(length = KNOWLEDGE_EMBEDDING_DIMENSIONS) {
  return jest.fn(async ({ input }: { input: string[] }) => ({
    data: input.map((_, index) => ({ index, embedding: vector(index, length) })).reverse(),
  }));
}

async function expectEmbeddingError(promise: Promise<unknown>, code: EmbeddingError["code"]) {
  await expect(promise).rejects.toBeInstanceOf(EmbeddingError);
  await expect(promise).rejects.toMatchObject({ code });
}

const originalEnv = { ...process.env };

describe("OpenAiEmbeddingProvider", () => {
  beforeEach(() => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.EMBEDDING_TIMEOUT_MS;
    delete process.env.LLM_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("requests the configured model with explicit dimensions and returns vectors in input order", async () => {
    const create = respondWithVectors();
    const provider = new TestableProvider(fakeClient(create));

    const result = await provider.embedMany(["a", "b", "c"]);

    expect(create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: ["a", "b", "c"],
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    });
    expect(result.model).toBe("text-embedding-3-small");
    expect(result.vectors.map((v) => v.indexOf(1))).toEqual([0, 1, 2]);
  });

  it("batches large inputs", async () => {
    const create = respondWithVectors();
    const provider = new TestableProvider(fakeClient(create));

    const result = await provider.embedMany(Array.from({ length: EMBEDDING_BATCH_SIZE + 5 }, (_, i) => `t${i}`));

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.vectors).toHaveLength(EMBEDDING_BATCH_SIZE + 5);
  });

  it("embed() returns a single vector", async () => {
    const provider = new TestableProvider(fakeClient(respondWithVectors()));
    const result = await provider.embed("¿Cuánto cuesta?");
    expect(result.vector).toHaveLength(KNOWLEDGE_EMBEDDING_DIMENSIONS);
  });

  it("fails with MISSING_CONFIG when the API key is absent, without calling the provider", async () => {
    delete process.env.OPENAI_API_KEY;
    const create = respondWithVectors();
    await expectEmbeddingError(new TestableProvider(fakeClient(create)).embedMany(["a"]), "MISSING_CONFIG");
    expect(create).not.toHaveBeenCalled();
  });

  it("fails with MISSING_CONFIG when EMBEDDING_PROVIDER is absent", async () => {
    delete process.env.EMBEDDING_PROVIDER;
    await expectEmbeddingError(new TestableProvider(fakeClient(respondWithVectors())).embedMany(["a"]), "MISSING_CONFIG");
  });

  it("fails with INVALID_CONFIG for an unsupported provider or a bad timeout", async () => {
    process.env.EMBEDDING_PROVIDER = "cohere";
    await expectEmbeddingError(new TestableProvider(fakeClient(respondWithVectors())).embedMany(["a"]), "INVALID_CONFIG");

    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.EMBEDDING_TIMEOUT_MS = "soon";
    await expectEmbeddingError(new TestableProvider(fakeClient(respondWithVectors())).embedMany(["a"]), "INVALID_CONFIG");
  });

  it("maps a timeout to PROVIDER_TIMEOUT", async () => {
    const create = jest.fn().mockRejectedValue(new APIConnectionTimeoutError());
    await expectEmbeddingError(new TestableProvider(fakeClient(create)).embedMany(["a"]), "PROVIDER_TIMEOUT");
  });

  it("maps an API error to PROVIDER_ERROR", async () => {
    const create = jest.fn().mockRejectedValue(new APIError(500, undefined, "boom", undefined));
    await expectEmbeddingError(new TestableProvider(fakeClient(create)).embedMany(["a"]), "PROVIDER_ERROR");
  });

  it("rejects vectors with the wrong dimensions", async () => {
    const provider = new TestableProvider(fakeClient(respondWithVectors(3072)));
    await expectEmbeddingError(provider.embedMany(["a"]), "INVALID_OUTPUT");
  });

  it("rejects a response with the wrong number of embeddings", async () => {
    const create = jest.fn().mockResolvedValue({ data: [{ index: 0, embedding: vector(0) }] });
    await expectEmbeddingError(new TestableProvider(fakeClient(create)).embedMany(["a", "b"]), "INVALID_OUTPUT");
  });

  it("rejects non-finite values", async () => {
    const bad = vector(0);
    bad[5] = Number.NaN;
    const create = jest.fn().mockResolvedValue({ data: [{ index: 0, embedding: bad }] });
    await expectEmbeddingError(new TestableProvider(fakeClient(create)).embedMany(["a"]), "INVALID_OUTPUT");
  });
});
