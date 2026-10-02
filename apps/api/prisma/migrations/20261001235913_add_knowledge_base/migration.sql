-- M3: pgvector lives inside this same PostgreSQL database (no separate vector store).
-- Added by hand: Prisma 6 only emits CREATE EXTENSION behind the postgresqlExtensions
-- preview flag, which KEOM deliberately does not enable. Requires the pgvector-enabled
-- image (see docker-compose.yml).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "knowledge_source_type" AS ENUM ('TEXT', 'MARKDOWN');

-- CreateTable
CREATE TABLE "knowledge_document" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source_type" "knowledge_source_type" NOT NULL DEFAULT 'TEXT',
    "source_name" TEXT,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunk" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536) NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_document_company_id_idx" ON "knowledge_document"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_id_company_id_key" ON "knowledge_document"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_company_id_content_hash_key" ON "knowledge_document"("company_id", "content_hash");

-- CreateIndex
CREATE INDEX "knowledge_chunk_company_id_idx" ON "knowledge_chunk"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunk_document_id_chunk_index_key" ON "knowledge_chunk"("document_id", "chunk_index");

-- AddForeignKey
ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_document_id_company_id_fkey" FOREIGN KEY ("document_id", "company_id") REFERENCES "knowledge_document"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
