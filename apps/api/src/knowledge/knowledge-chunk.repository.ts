import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { KnowledgeMetadata } from "./knowledge.types";

export interface NewKnowledgeChunk {
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export interface ChunkMatch {
  chunkId: string;
  documentId: string;
  title: string;
  sourceName: string | null;
  chunkIndex: number;
  content: string;
  metadata: KnowledgeMetadata;
  similarity: number;
}

export interface ChunkSearchParams {
  companyId: string;
  embedding: number[];
  embeddingModel: string;
  topK: number;
  metadataFilter?: KnowledgeMetadata;
}

/**
 * The ONLY place in KEOM that touches pgvector (M3). Prisma 6 can't read/write
 * `Unsupported("vector(...)")` columns, so inserts and similarity search are raw SQL —
 * kept here, parameterized via Prisma.sql tagged templates (never string-built), and
 * nowhere else. Plain reads/deletes of chunks still use the regular Prisma client.
 *
 * Tenant isolation: `search()` takes companyId as a required parameter and always filters
 * on it — there is no unscoped variant. Inserts take companyId from the caller, and the
 * composite FK (document_id, company_id) rejects any chunk whose companyId differs from
 * its document's.
 *
 * No ANN index on purpose (exact scan): filtered by company_id, an exact scan is correct
 * and fast at MVP scale, while HNSW applies the WHERE filter after scanning the index and
 * can return fewer than topK rows for small tenants. Upgrade path in apps/api/README.md M3.
 */
@Injectable()
export class KnowledgeChunkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertChunks(
    tx: Prisma.TransactionClient,
    params: { companyId: string; documentId: string; embeddingModel: string; metadata: KnowledgeMetadata; chunks: NewKnowledgeChunk[] },
  ): Promise<void> {
    if (params.chunks.length === 0) return;
    const metadata = JSON.stringify(params.metadata);
    const rows = params.chunks.map(
      (chunk) => Prisma.sql`(
        gen_random_uuid(), ${params.companyId}::uuid, ${params.documentId}::uuid, ${chunk.chunkIndex},
        ${chunk.content}, ${metadata}::jsonb, ${toVectorLiteral(chunk.embedding)}::vector, ${params.embeddingModel}
      )`,
    );
    await tx.$executeRaw`
      INSERT INTO knowledge_chunk (id, company_id, document_id, chunk_index, content, metadata, embedding, embedding_model)
      VALUES ${Prisma.join(rows)}
    `;
  }

  /** Nearest chunks by cosine distance, for one company and one embedding model only. */
  async search(params: ChunkSearchParams): Promise<ChunkMatch[]> {
    const vector = toVectorLiteral(params.embedding);
    const metadataFilter = params.metadataFilter
      ? Prisma.sql`AND c.metadata @> ${JSON.stringify(params.metadataFilter)}::jsonb`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<ChunkMatch[]>`
      SELECT c.id AS "chunkId", c.document_id AS "documentId", d.title, d.source_name AS "sourceName",
             c.chunk_index AS "chunkIndex", c.content, c.metadata,
             1 - (c.embedding <=> ${vector}::vector) AS similarity
      FROM knowledge_chunk c
      JOIN knowledge_document d ON d.id = c.document_id AND d.company_id = c.company_id
      WHERE c.company_id = ${params.companyId}::uuid
        AND c.embedding_model = ${params.embeddingModel}
        ${metadataFilter}
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${params.topK}
    `;
    // A zero vector has no direction: pgvector returns NaN similarity for it. Never a match.
    return rows.map((row) => ({ ...row, similarity: Number(row.similarity) })).filter((row) => Number.isFinite(row.similarity));
  }
}

/** pgvector's text input format: "[0.1,0.2,...]". Values are validated finite upstream. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
