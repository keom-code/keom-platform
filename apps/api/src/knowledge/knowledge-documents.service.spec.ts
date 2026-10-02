import { Test } from "@nestjs/testing";
import { EMBEDDING_PROVIDER, EmbeddingError } from "../llm/embedding-provider";
import { PrismaService } from "../prisma/prisma.service";
import { KnowledgeChunkRepository } from "./knowledge-chunk.repository";
import { KnowledgeDocumentsService } from "./knowledge-documents.service";
import { KnowledgeError, MAX_DOCUMENT_CHARS } from "./knowledge.types";

/**
 * Unit level: Prisma, the raw-SQL repository and the embedder are mocked. Real pgvector
 * persistence, cascade deletes and tenant isolation are covered in test/knowledge.e2e-spec.ts.
 */
const COMPANY_ID = "company-1";

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    companyId: COMPANY_ID,
    title: "FAQ",
    sourceType: "TEXT",
    sourceName: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { chunks: 1 },
    ...overrides,
  };
}

describe("KnowledgeDocumentsService", () => {
  let service: KnowledgeDocumentsService;
  let tx: { knowledgeDocument: { create: jest.Mock; update: jest.Mock }; knowledgeChunk: { deleteMany: jest.Mock } };
  let prisma: {
    $transaction: jest.Mock;
    company: { findUnique: jest.Mock };
    knowledgeDocument: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; deleteMany: jest.Mock };
  };
  let repository: { insertChunks: jest.Mock };
  let embedder: { embed: jest.Mock; embedMany: jest.Mock };

  beforeEach(async () => {
    tx = {
      knowledgeDocument: { create: jest.fn().mockResolvedValue({ id: "doc-1" }), update: jest.fn().mockResolvedValue({ id: "doc-1" }) },
      knowledgeChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
      company: { findUnique: jest.fn().mockResolvedValue({ id: COMPANY_ID }) },
      knowledgeDocument: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(summaryRow()),
        findMany: jest.fn().mockResolvedValue([summaryRow()]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    repository = { insertChunks: jest.fn().mockResolvedValue(undefined) };
    embedder = {
      embed: jest.fn(),
      embedMany: jest.fn(async (texts: string[]) => ({ model: "test-model", vectors: texts.map(() => [0.1, 0.2]) })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        KnowledgeDocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: KnowledgeChunkRepository, useValue: repository },
        { provide: EMBEDDING_PROVIDER, useValue: embedder },
      ],
    }).compile();
    service = moduleRef.get(KnowledgeDocumentsService);
  });

  it("normalizes, chunks, embeds (title + chunk) and persists document + chunks in one transaction", async () => {
    const result = await service.create({
      companyId: COMPANY_ID,
      title: "  Laser Hair Removal FAQ ",
      content: "Laser hair removal for legs costs S/320 per session.\r\n\r\n\r\nWe operate Saturdays from 9 AM to 5 PM.",
      metadata: { category: "pricing" },
    });

    expect(result.created).toBe(true);
    expect(embedder.embedMany).toHaveBeenCalledWith([
      "Laser Hair Removal FAQ\n\nLaser hair removal for legs costs S/320 per session.\n\nWe operate Saturdays from 9 AM to 5 PM.",
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.knowledgeDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: COMPANY_ID,
        title: "Laser Hair Removal FAQ",
        content: "Laser hair removal for legs costs S/320 per session.\n\nWe operate Saturdays from 9 AM to 5 PM.",
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        metadata: { category: "pricing" },
      }),
    });
    expect(repository.insertChunks).toHaveBeenCalledWith(tx, {
      companyId: COMPANY_ID,
      documentId: "doc-1",
      metadata: { category: "pricing" },
      embeddingModel: "test-model",
      chunks: [
        {
          chunkIndex: 0,
          content: "Laser hair removal for legs costs S/320 per session.\n\nWe operate Saturdays from 9 AM to 5 PM.",
          embedding: [0.1, 0.2],
        },
      ],
    });
  });

  it("rejects empty content without embedding or writing", async () => {
    await expect(service.create({ companyId: COMPANY_ID, title: "Empty", content: " \n\t " })).rejects.toMatchObject({ code: "EMPTY_CONTENT" });
    expect(embedder.embedMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects oversized content without embedding or writing", async () => {
    const content = "a ".repeat(MAX_DOCUMENT_CHARS);
    await expect(service.create({ companyId: COMPANY_ID, title: "Big", content })).rejects.toMatchObject({ code: "CONTENT_TOO_LARGE" });
    expect(embedder.embedMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown company", async () => {
    prisma.company.findUnique.mockResolvedValue(null);
    await expect(service.create({ companyId: "nope", title: "T", content: "C" })).rejects.toMatchObject({ code: "COMPANY_NOT_FOUND" });
    expect(embedder.embedMany).not.toHaveBeenCalled();
  });

  it("writes nothing when embedding fails", async () => {
    embedder.embedMany.mockRejectedValue(new EmbeddingError("PROVIDER_TIMEOUT", "timeout"));
    await expect(service.create({ companyId: COMPANY_ID, title: "T", content: "C" })).rejects.toBeInstanceOf(EmbeddingError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(repository.insertChunks).not.toHaveBeenCalled();
  });

  it("returns the existing document for an identical retry instead of re-indexing", async () => {
    prisma.knowledgeDocument.findUnique.mockResolvedValue(summaryRow({ id: "doc-existing" }));
    const result = await service.create({ companyId: COMPANY_ID, title: "T", content: "C" });
    expect(result).toEqual({ created: false, document: expect.objectContaining({ id: "doc-existing" }) });
    expect(embedder.embedMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("wraps a database failure as STORAGE_FAILED", async () => {
    repository.insertChunks.mockRejectedValue(new Error("connection lost"));
    await expect(service.create({ companyId: COMPANY_ID, title: "T", content: "C" })).rejects.toMatchObject({ code: "STORAGE_FAILED" });
  });

  it("update rebuilds chunks inside one transaction: update row, delete old chunks, insert new", async () => {
    await service.update("doc-1", { companyId: COMPANY_ID, title: "FAQ v2", content: "New content" });

    expect(prisma.knowledgeDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "doc-1", companyId: COMPANY_ID } }));
    expect(tx.knowledgeDocument.update).toHaveBeenCalled();
    expect(tx.knowledgeChunk.deleteMany).toHaveBeenCalledWith({ where: { documentId: "doc-1", companyId: COMPANY_ID } });
    expect(repository.insertChunks).toHaveBeenCalledWith(tx, expect.objectContaining({ documentId: "doc-1", companyId: COMPANY_ID }));
  });

  it("update leaves the existing version untouched when embedding fails", async () => {
    embedder.embedMany.mockRejectedValue(new EmbeddingError("PROVIDER_ERROR", "down"));
    await expect(service.update("doc-1", { companyId: COMPANY_ID, title: "T", content: "C" })).rejects.toBeInstanceOf(EmbeddingError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.knowledgeChunk.deleteMany).not.toHaveBeenCalled();
  });

  it("update/get/delete treat another company's document as not found", async () => {
    prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
    prisma.knowledgeDocument.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.update("doc-1", { companyId: "company-2", title: "T", content: "C" })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(service.get("doc-1", "company-2")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(service.delete("doc-1", "company-2")).rejects.toBeInstanceOf(KnowledgeError);
    expect(prisma.knowledgeDocument.deleteMany).toHaveBeenCalledWith({ where: { id: "doc-1", companyId: "company-2" } });
  });
});
