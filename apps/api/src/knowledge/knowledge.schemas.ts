import { z } from "zod";
import { CommercialInterpretationSchema } from "../llm/commercial-interpretation.schema";
import { MAX_TOP_K } from "./knowledge.config";
import { KNOWLEDGE_SOURCE_TYPES, KnowledgeSourceType, MAX_DOCUMENT_CHARS } from "./knowledge.types";

/** Request bodies for the dev-only /dev/knowledge endpoints (M3). No auth, same as the
 * M2A/M2B dev endpoints: companyId is explicit (or, for suggest-response, derived from the
 * conversation). */

const MAX_METADATA_KEYS = 20;

/** Free-form flat labels; values are scalars so the generic `@>` filter stays simple. */
export const KnowledgeMetadataSchema = z
  .record(z.string().min(1).max(64), z.union([z.string().max(200), z.number().finite(), z.boolean()]))
  .refine((metadata) => Object.keys(metadata).length <= MAX_METADATA_KEYS, { message: `At most ${MAX_METADATA_KEYS} metadata keys` });

export const KnowledgeDocumentRequestSchema = z.object({
  companyId: z.string().uuid(),
  title: z.string().min(1).max(200),
  // Generous raw cap; the precise limit is enforced on normalized content by the service.
  content: z.string().min(1).max(MAX_DOCUMENT_CHARS * 2),
  sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES as [KnowledgeSourceType, ...KnowledgeSourceType[]]).optional(),
  sourceName: z.string().max(200).optional(),
  metadata: KnowledgeMetadataSchema.optional(),
});

export const CompanyScopeQuerySchema = z.object({
  companyId: z.string().uuid(),
});

export const DocumentIdSchema = z.string().uuid();

export const KnowledgeSearchRequestSchema = z.object({
  companyId: z.string().uuid(),
  query: z.string().min(1).max(1000),
  topK: z.number().int().min(1).max(MAX_TOP_K).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
  metadataFilter: KnowledgeMetadataSchema.optional(),
});

const interpretationShape = CommercialInterpretationSchema.shape;

export const SuggestResponseRequestSchema = z.object({
  conversationId: z.string().uuid(),
  /** Optional M2B output (e.g. the `interpretation` returned by /dev/interpretation/evaluate).
   * Context only — M3 never re-runs M2B. */
  interpretation: z
    .object({
      intent: interpretationShape.intent.optional(),
      signals: interpretationShape.signals.optional(),
      entities: z.object({ serviceName: z.string().max(200).optional(), productName: z.string().max(200).optional() }).optional(),
    })
    .optional(),
});
