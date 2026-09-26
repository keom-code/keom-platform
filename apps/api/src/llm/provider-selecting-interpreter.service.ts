import { Injectable } from "@nestjs/common";
import { CommercialContext, CommercialInterpretation, CommercialInterpreter } from "./commercial-interpreter";
import { JevCommercialInterpreter } from "./jev-commercial-interpreter.service";
import { resolveLlmProvider } from "./llm.config";
import { OpenAiCommercialInterpreter } from "./openai-commercial-interpreter.service";

/**
 * What COMMERCIAL_INTERPRETER is bound to: reads LLM_PROVIDER on every call and delegates
 * to that provider's interpreter. Selection happens per call (not in a boot-time factory)
 * so config stays lazy — a missing/unknown LLM_PROVIDER fails only interpretation calls,
 * never API startup. No fallback between providers: the selected one's result or error is
 * returned as-is.
 */
@Injectable()
export class ProviderSelectingInterpreter implements CommercialInterpreter {
  constructor(
    private readonly openai: OpenAiCommercialInterpreter,
    private readonly jev: JevCommercialInterpreter,
  ) {}

  async interpret(context: CommercialContext): Promise<CommercialInterpretation> {
    const provider = resolveLlmProvider();
    return provider === "jev" ? this.jev.interpret(context) : this.openai.interpret(context);
  }
}
