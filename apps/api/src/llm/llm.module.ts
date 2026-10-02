import { Module } from "@nestjs/common";
import { COMMERCIAL_INTERPRETER } from "./commercial-interpreter";
import { EMBEDDING_PROVIDER } from "./embedding-provider";
import { GROUNDED_RESPONDER } from "./grounded-responder";
import { JevCommercialInterpreter } from "./jev-commercial-interpreter.service";
import { OpenAiCommercialInterpreter } from "./openai-commercial-interpreter.service";
import { OpenAiEmbeddingProvider } from "./openai-embedding-provider.service";
import { OpenAiGroundedResponder } from "./openai-grounded-responder.service";
import { ProviderSelectingInterpreter } from "./provider-selecting-interpreter.service";

/**
 * Binds the CommercialInterpreter abstraction via a DI token — consumers
 * (InterpretationService) depend on COMMERCIAL_INTERPRETER / CommercialInterpreter, never
 * on a concrete provider. The token resolves to ProviderSelectingInterpreter, which picks
 * OpenAI or Jev per call from LLM_PROVIDER. Adding a provider means adding a class here
 * and a branch in the selector, not touching orchestration code.
 *
 * M3 binds EMBEDDING_PROVIDER and GROUNDED_RESPONDER the same way: src/knowledge depends on
 * the tokens, never on OpenAiEmbeddingProvider/OpenAiGroundedResponder directly.
 */
@Module({
  providers: [
    OpenAiCommercialInterpreter,
    JevCommercialInterpreter,
    ProviderSelectingInterpreter,
    { provide: COMMERCIAL_INTERPRETER, useExisting: ProviderSelectingInterpreter },
    OpenAiEmbeddingProvider,
    { provide: EMBEDDING_PROVIDER, useExisting: OpenAiEmbeddingProvider },
    OpenAiGroundedResponder,
    { provide: GROUNDED_RESPONDER, useExisting: OpenAiGroundedResponder },
  ],
  exports: [COMMERCIAL_INTERPRETER, EMBEDDING_PROVIDER, GROUNDED_RESPONDER],
})
export class LlmModule {}
