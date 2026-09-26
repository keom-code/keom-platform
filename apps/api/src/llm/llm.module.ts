import { Module } from "@nestjs/common";
import { COMMERCIAL_INTERPRETER } from "./commercial-interpreter";
import { JevCommercialInterpreter } from "./jev-commercial-interpreter.service";
import { OpenAiCommercialInterpreter } from "./openai-commercial-interpreter.service";
import { ProviderSelectingInterpreter } from "./provider-selecting-interpreter.service";

/**
 * Binds the CommercialInterpreter abstraction via a DI token — consumers
 * (InterpretationService) depend on COMMERCIAL_INTERPRETER / CommercialInterpreter, never
 * on a concrete provider. The token resolves to ProviderSelectingInterpreter, which picks
 * OpenAI or Jev per call from LLM_PROVIDER. Adding a provider means adding a class here
 * and a branch in the selector, not touching orchestration code.
 */
@Module({
  providers: [
    OpenAiCommercialInterpreter,
    JevCommercialInterpreter,
    ProviderSelectingInterpreter,
    { provide: COMMERCIAL_INTERPRETER, useExisting: ProviderSelectingInterpreter },
  ],
  exports: [COMMERCIAL_INTERPRETER],
})
export class LlmModule {}
