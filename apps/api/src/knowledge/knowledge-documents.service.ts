import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EMBEDDING_PROVIDER, EmbeddingProvider } from "../llm/embedding-provider";
import { chunkText } from "./chunker";
import { KnowledgeChunkRepository } from "./knowledge-chunk.repository";
import {
  IngestionResult,
  KnowledgeDocumentDetail,
  KnowledgeDocumentInput,
  KnowledgeDocumentSummary,
  KnowledgeError,
  KnowledgeMetadata,
  KnowledgeSourceType,
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_DOCUMENT_CHARS,
} from "./knowledge.types";
import { normalizeText } from "./text-normalizer";

interface PreparedDocument {
  title: string;
  content: string;
  contentHash: string;
  sourceType: KnowledgeSourceType;
  sourceName: string | null;
  metadata: KnowledgeMetadata;
  chunks: string[];
}

const SUMMARY_SELECT = {
  id: true,
  companyId: true,
  title: true,
  sourceType: true,
  sourceName: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { chunks: true } },
} satisfies Prisma.KnowledgeDocumentSelect;

type SummaryRow = Prisma.KnowledgeDocumentGetPayload<{ select: typeof SUMMARY_SELECT }>;

/**
 * M3 ingestion: input -> normalize -> chunk -> embed -> persist, plus update/delete/read.
 * Every operation is scoped by companyId; a document id belonging to another company is
 * indistinguishable from a missing one (DOCUMENT_NOT_FOUND).
 *
 * Failure safety: every chunk is embedded BEFORE anything is written. The document row and
 * its chunks are then written in one transaction (update = update row + delete old chunks +
 * insert new chunks). So an embedding/provider failure writes nothing, a DB failure rolls
 * back, and an update failure leaves the previous version fully searchable. No queue, no
 * PENDING/FAILED status — synchronous by design for M3.
 */
@Injectable()
export class KnowledgeDocumentsService {
  private readonly logger = new Logger(KnowledgeDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunks: KnowledgeChunkRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
  ) {}

  async create(input: KnowledgeDocumentInput): Promise<IngestionResult> {
    await this.assertCompanyExists(input.companyId);
    const prepared = this.prepare(input);

    const existing = await this.findByHash(input.companyId, prepared.contentHash);
    if (existing) return { document: existing, created: false };

    const embedded = await this.embed(prepared);

    try {
      const documentId = await this.prisma.$transaction(async (tx) => {
        const document = await tx.knowledgeDocument.create({
          data: {
            companyId: input.companyId,
            title: prepared.title,
            sourceType: prepared.sourceType,
            sourceName: prepared.sourceName,
            content: prepared.content,
            contentHash: prepared.contentHash,
            metadata: prepared.metadata,
          },
        });
        await this.chunks.insertChunks(tx, { companyId: input.companyId, documentId: document.id, metadata: prepared.metadata, ...embedded });
        return document.id;
      });
      this.logger.log(`Indexed knowledge document ${documentId} (${prepared.chunks.length} chunks) for company ${input.companyId}`);
      return { document: await this.requireSummary(documentId, input.companyId), created: true };
    } catch (err) {
      // Lost a race with an identical concurrent POST: return the winner, as for a retry.
      if (isUniqueViolation(err)) {
        const winner = await this.findByHash(input.companyId, prepared.contentHash);
        if (winner) return { document: winner, created: false };
      }
      throw new KnowledgeError("STORAGE_FAILED", "Failed to store knowledge document.", err);
    }
  }

  /** Full replacement: title/content/source/metadata are rewritten and chunks rebuilt. */
  async update(id: string, input: KnowledgeDocumentInput): Promise<KnowledgeDocumentSummary> {
    const current = await this.prisma.knowledgeDocument.findFirst({ where: { id, companyId: input.companyId }, select: { id: true } });
    if (!current) throw notFound(id);

    const prepared = this.prepare(input);
    const embedded = await this.embed(prepared);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.knowledgeDocument.update({
          where: { id },
          data: {
            title: prepared.title,
            sourceType: prepared.sourceType,
            sourceName: prepared.sourceName,
            content: prepared.content,
            contentHash: prepared.contentHash,
            metadata: prepared.metadata,
          },
        });
        await tx.knowledgeChunk.deleteMany({ where: { documentId: id, companyId: input.companyId } });
        await this.chunks.insertChunks(tx, { companyId: input.companyId, documentId: id, metadata: prepared.metadata, ...embedded });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new KnowledgeError("DUPLICATE_CONTENT", "Another knowledge document of this company already has this title and content.", err);
      }
      throw new KnowledgeError("STORAGE_FAILED", "Failed to update knowledge document.", err);
    }

    this.logger.log(`Re-indexed knowledge document ${id} (${prepared.chunks.length} chunks) for company ${input.companyId}`);
    return this.requireSummary(id, input.companyId);
  }

  /** Chunks go with the document via the ON DELETE CASCADE foreign key. */
  async delete(id: string, companyId: string): Promise<void> {
    const { count } = await this.prisma.knowledgeDocument.deleteMany({ where: { id, companyId } });
    if (count === 0) throw notFound(id);
  }

  async list(companyId: string): Promise<KnowledgeDocumentSummary[]> {
    const rows = await this.prisma.knowledgeDocument.findMany({ where: { companyId }, select: SUMMARY_SELECT, orderBy: { createdAt: "desc" } });
    return rows.map(toSummary);
  }

  async get(id: string, companyId: string): Promise<KnowledgeDocumentDetail> {
    const row = await this.prisma.knowledgeDocument.findFirst({ where: { id, companyId }, select: { ...SUMMARY_SELECT, content: true } });
    if (!row) throw notFound(id);
    return { ...toSummary(row), content: row.content };
  }

  private prepare(input: KnowledgeDocumentInput): PreparedDocument {
    const title = normalizeText(input.title).replace(/\n+/g, " ");
    const content = normalizeText(input.content);
    if (!title || !content) {
      throw new KnowledgeError("EMPTY_CONTENT", "Knowledge document title and content must contain text.");
    }
    if (content.length > MAX_DOCUMENT_CHARS) {
      throw new KnowledgeError("CONTENT_TOO_LARGE", `Knowledge document content exceeds ${MAX_DOCUMENT_CHARS} characters.`);
    }

    const chunks = chunkText(content);
    if (chunks.length === 0) {
      throw new KnowledgeError("EMPTY_CONTENT", "Knowledge document produced no chunks.");
    }
    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
      throw new KnowledgeError("CONTENT_TOO_LARGE", `Knowledge document produced ${chunks.length} chunks (max ${MAX_CHUNKS_PER_DOCUMENT}).`);
    }

    return {
      title,
      content,
      contentHash: createHash("sha256").update(`${title}\n\n${content}`).digest("hex"),
      sourceType: input.sourceType ?? "TEXT",
      sourceName: input.sourceName?.trim() || null,
      metadata: input.metadata ?? {},
      chunks,
    };
  }

  /** The title is embedded with each chunk for topical context; only the chunk is stored. */
  private async embed(prepared: PreparedDocument) {
    const { model, vectors } = await this.embedder.embedMany(prepared.chunks.map((chunk) => `${prepared.title}\n\n${chunk}`));
    return {
      embeddingModel: model,
      chunks: prepared.chunks.map((content, chunkIndex) => ({ chunkIndex, content, embedding: vectors[chunkIndex]! })),
    };
  }

  private async assertCompanyExists(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new KnowledgeError("COMPANY_NOT_FOUND", `Company ${companyId} not found.`);
  }

  private async findByHash(companyId: string, contentHash: string): Promise<KnowledgeDocumentSummary | null> {
    const row = await this.prisma.knowledgeDocument.findUnique({
      where: { companyId_contentHash: { companyId, contentHash } },
      select: SUMMARY_SELECT,
    });
    return row ? toSummary(row) : null;
  }

  private async requireSummary(id: string, companyId: string): Promise<KnowledgeDocumentSummary> {
    const row = await this.prisma.knowledgeDocument.findFirst({ where: { id, companyId }, select: SUMMARY_SELECT });
    if (!row) throw notFound(id);
    return toSummary(row);
  }
}

function toSummary(row: SummaryRow): KnowledgeDocumentSummary {
  const { _count, metadata, ...rest } = row;
  return { ...rest, metadata: metadata as KnowledgeMetadata, chunkCount: _count.chunks };
}

function notFound(id: string): KnowledgeError {
  return new KnowledgeError("DOCUMENT_NOT_FOUND", `Knowledge document ${id} not found.`);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
