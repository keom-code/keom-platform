import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  GatewayTimeoutException,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ZodError, ZodType } from "zod";
import { EmbeddingError } from "../llm/embedding-provider";
import { GroundedResponseError } from "../llm/grounded-responder";
import { GroundedResponseService } from "./grounded-response.service";
import { KnowledgeDocumentsService } from "./knowledge-documents.service";
import { KnowledgeRetrievalService } from "./knowledge-retrieval.service";
import {
  CompanyScopeQuerySchema,
  DocumentIdSchema,
  KnowledgeDocumentRequestSchema,
  KnowledgeSearchRequestSchema,
  SuggestResponseRequestSchema,
} from "./knowledge.schemas";
import { KnowledgeError } from "./knowledge.types";

/** The one bit of the platform (Express) response used here; avoids an @types/express dependency. */
interface StatusSettable {
  status(code: number): unknown;
}

/**
 * Dev-only endpoints for M3 Business Knowledge / RAG, same conventions as the M2A/M2B dev
 * endpoints: no auth, Zod-validated bodies, typed errors mapped to HTTP here. Every
 * operation is company-scoped; a document of another company answers 404. Nothing here
 * sends messages or touches Opportunities. See apps/api/README.md M3.
 */
@Controller("dev/knowledge")
export class KnowledgeController {
  constructor(
    private readonly documents: KnowledgeDocumentsService,
    private readonly retrieval: KnowledgeRetrievalService,
    private readonly groundedResponse: GroundedResponseService,
  ) {}

  /** 201 when indexed; 200 with the existing document for an identical retry. */
  @Post("documents")
  async create(@Body() body: unknown, @Res({ passthrough: true }) res: StatusSettable) {
    const input = parse(KnowledgeDocumentRequestSchema, body, "Invalid knowledge document");
    const result = await this.run(() => this.documents.create(input));
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Get("documents")
  async list(@Query() query: unknown) {
    const { companyId } = parse(CompanyScopeQuerySchema, query, "companyId query parameter is required");
    return { documents: await this.run(() => this.documents.list(companyId)) };
  }

  @Get("documents/:id")
  async get(@Param("id") id: string, @Query() query: unknown) {
    const documentId = parse(DocumentIdSchema, id, "Invalid document id");
    const { companyId } = parse(CompanyScopeQuerySchema, query, "companyId query parameter is required");
    return this.run(() => this.documents.get(documentId, companyId));
  }

  @Put("documents/:id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const documentId = parse(DocumentIdSchema, id, "Invalid document id");
    const input = parse(KnowledgeDocumentRequestSchema, body, "Invalid knowledge document");
    return { document: await this.run(() => this.documents.update(documentId, input)) };
  }

  @Delete("documents/:id")
  @HttpCode(204)
  async delete(@Param("id") id: string, @Query() query: unknown) {
    const documentId = parse(DocumentIdSchema, id, "Invalid document id");
    const { companyId } = parse(CompanyScopeQuerySchema, query, "companyId query parameter is required");
    await this.run(() => this.documents.delete(documentId, companyId));
  }

  @Post("search")
  @HttpCode(200)
  async search(@Body() body: unknown) {
    const input = parse(KnowledgeSearchRequestSchema, body, "Invalid knowledge search request");
    return this.run(() => this.retrieval.retrieve(input));
  }

  @Post("suggest-response")
  @HttpCode(200)
  async suggestResponse(@Body() body: unknown) {
    const input = parse(SuggestResponseRequestSchema, body, "Invalid suggest-response request");
    return this.run(() => this.groundedResponse.suggest(input.conversationId, input.interpretation));
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      throw toHttpException(err);
    }
  }
}

function parse<T>(schema: ZodType<T>, value: unknown, message: string): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(message);
    }
    throw err;
  }
}

function toHttpException(err: unknown): Error {
  if (err instanceof KnowledgeError) {
    switch (err.code) {
      case "COMPANY_NOT_FOUND":
      case "DOCUMENT_NOT_FOUND":
        return new NotFoundException(err.message);
      case "EMPTY_CONTENT":
      case "CONTENT_TOO_LARGE":
        return new UnprocessableEntityException(err.message);
      case "DUPLICATE_CONTENT":
        return new ConflictException(err.message);
      case "INVALID_CONFIG":
      case "RETRIEVAL_FAILED":
        return new ServiceUnavailableException(err.message);
      case "STORAGE_FAILED":
        return new InternalServerErrorException(err.message);
    }
  }

  if (err instanceof EmbeddingError || err instanceof GroundedResponseError) {
    switch (err.code) {
      case "MISSING_CONFIG":
      case "INVALID_CONFIG":
        return new ServiceUnavailableException(err.message);
      case "PROVIDER_TIMEOUT":
        return new GatewayTimeoutException(err.message);
      default:
        return new BadGatewayException(err.message);
    }
  }

  return err instanceof Error ? err : new Error(String(err));
}
