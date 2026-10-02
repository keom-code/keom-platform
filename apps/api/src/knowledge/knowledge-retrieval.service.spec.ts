import { Test } from "@nestjs/testing";
import { EMBEDDING_PROVIDER, EmbeddingError } from "../llm/embedding-provider";
import { ChunkMatch, KnowledgeChunkRepository } from "./knowledge-chunk.repository";
import { KnowledgeRetrievalService } from "./knowledge-retrieval.service";

function match(chunkId: string, similarity: number): ChunkMatch {
  return { chunkId, documentId: "doc-1", title: "FAQ", sourceName: null, chunkIndex: 0, content: chunkId, metadata: {}, similarity };
}

const originalEnv = { ...process.env };

describe("KnowledgeRetrievalService", () => {
  let service: KnowledgeRetrievalService;
  let repository: { search: jest.Mock };
  let embedder: { embed: jest.Mock; embedMany: jest.Mock };

  beforeEach(async () => {
    delete process.env.KNOWLEDGE_TOP_K;
    delete process.env.KNOWLEDGE_MIN_SIMILARITY;
    repository = { search: jest.fn().mockResolvedValue([match("strong", 0.82), match("medium", 0.41), match("weak", 0.12)]) };
    embedder = { embed: jest.fn().mockResolvedValue({ model: "test-model", vector: [1, 0] }), embedMany: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        KnowledgeRetrievalService,
        { provide: KnowledgeChunkRepository, useValue: repository },
        { provide: EMBEDDING_PROVIDER, useValue: embedder },
      ],
    }).compile();
    service = moduleRef.get(KnowledgeRetrievalService);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("searches only the given company with the query's embedding model and default topK", async () => {
    await service.retrieve({ companyId: "company-1", query: "  ¿Cuánto cuesta?  " });
    expect(embedder.embed).toHaveBeenCalledWith("¿Cuánto cuesta?");
    expect(repository.search).toHaveBeenCalledWith({
      companyId: "company-1",
      embedding: [1, 0],
      embeddingModel: "test-model",
      topK: 5,
      metadataFilter: undefined,
    });
  });

  it("filters weak matches below the default threshold", async () => {
    const result = await service.retrieve({ companyId: "company-1", query: "precio" });
    expect(result.chunks.map((c) => c.chunkId)).toEqual(["strong", "medium"]);
    expect(result.minSimilarity).toBe(0.35);
  });

  it("honours request overrides and env defaults", async () => {
    const strict = await service.retrieve({ companyId: "company-1", query: "precio", minSimilarity: 0.5, topK: 2 });
    expect(strict.chunks.map((c) => c.chunkId)).toEqual(["strong"]);
    expect(repository.search).toHaveBeenLastCalledWith(expect.objectContaining({ topK: 2 }));

    process.env.KNOWLEDGE_TOP_K = "3";
    process.env.KNOWLEDGE_MIN_SIMILARITY = "0.1";
    const loose = await service.retrieve({ companyId: "company-1", query: "precio" });
    expect(loose.chunks).toHaveLength(3);
    expect(repository.search).toHaveBeenLastCalledWith(expect.objectContaining({ topK: 3 }));
  });

  it("returns an empty result, not an error, when nothing is relevant", async () => {
    repository.search.mockResolvedValue([match("weak", 0.05)]);
    const result = await service.retrieve({ companyId: "company-1", query: "precio" });
    expect(result.chunks).toEqual([]);
  });

  it("returns an empty result for an empty query without calling the provider", async () => {
    const result = await service.retrieve({ companyId: "company-1", query: " \n " });
    expect(result.chunks).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("propagates embedding failures and wraps search failures", async () => {
    embedder.embed.mockRejectedValueOnce(new EmbeddingError("MISSING_CONFIG", "no key"));
    await expect(service.retrieve({ companyId: "company-1", query: "precio" })).rejects.toBeInstanceOf(EmbeddingError);

    repository.search.mockRejectedValueOnce(new Error("relation does not exist"));
    await expect(service.retrieve({ companyId: "company-1", query: "precio" })).rejects.toMatchObject({ code: "RETRIEVAL_FAILED" });
  });

  it("rejects invalid env config", async () => {
    process.env.KNOWLEDGE_MIN_SIMILARITY = "2";
    await expect(service.retrieve({ companyId: "company-1", query: "precio" })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });
});
