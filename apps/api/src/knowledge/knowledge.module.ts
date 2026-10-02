import { Module } from "@nestjs/common";
import { InterpretationModule } from "../interpretation/interpretation.module";
import { LlmModule } from "../llm/llm.module";
import { GroundedResponseService } from "./grounded-response.service";
import { KnowledgeChunkRepository } from "./knowledge-chunk.repository";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeDocumentsService } from "./knowledge-documents.service";
import { KnowledgeRetrievalService } from "./knowledge-retrieval.service";

/**
 * M3 Business Knowledge / RAG. Depends on LlmModule for the EMBEDDING_PROVIDER and
 * GROUNDED_RESPONDER abstractions and on InterpretationModule only for ContextBuilderService
 * (bounded conversation context). It never imports OpportunitiesModule: M3 supplies
 * knowledge, M2A alone decides.
 */
@Module({
  imports: [LlmModule, InterpretationModule],
  providers: [KnowledgeChunkRepository, KnowledgeDocumentsService, KnowledgeRetrievalService, GroundedResponseService],
  controllers: [KnowledgeController],
  exports: [KnowledgeRetrievalService, GroundedResponseService],
})
export class KnowledgeModule {}
