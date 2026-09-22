import { Module } from "@nestjs/common";
import { COMMERCIAL_INTERPRETER } from "./commercial-interpreter";
import { OpenAiCommercialInterpreter } from "./openai-commercial-interpreter.service";

/**
 * Binds the CommercialInterpreter abstraction to its one concrete implementation via a
 * DI token — consumers (InterpretationService) depend on COMMERCIAL_INTERPRETER /
 * CommercialInterpreter, never on OpenAiCommercialInterpreter directly. Swapping to
 * another provider (e.g. Anthropic) later means adding a new class here, not touching
 * orchestration code.
 */
@Module({
  providers: [OpenAiCommercialInterpreter, { provide: COMMERCIAL_INTERPRETER, useClass: OpenAiCommercialInterpreter }],
  exports: [COMMERCIAL_INTERPRETER],
})
export class LlmModule {}
