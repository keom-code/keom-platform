import { Test } from "@nestjs/testing";
import { ContextBuilderService } from "../interpretation/context-builder.service";
import { GROUNDED_RESPONDER, GroundedResponseError } from "../llm/grounded-responder";
import { GroundedResponseService } from "./grounded-response.service";
import { KnowledgeRetrievalService } from "./knowledge-retrieval.service";
import { RetrievedChunk } from "./knowledge.types";

const CONVERSATION_ID = "conversation-1";

function built(text: string) {
  return {
    companyId: "company-1",
    customerId: "customer-1",
    conversationId: CONVERSATION_ID,
    context: { conversationId: CONVERSATION_ID, messages: [{ direction: "INBOUND" as const, text, sentAt: new Date("2026-01-01T00:00:00Z") }] },
  };
}

function chunk(chunkId: string, content: string, similarity = 0.7): RetrievedChunk {
  return { chunkId, documentId: "doc-1", title: "Laser Hair Removal FAQ", sourceName: "faq.md", chunkIndex: 0, content, similarity, metadata: {} };
}

const PRICE = chunk("chunk-price", "Laser hair removal for legs costs S/320 per session.");
const HOURS = chunk("chunk-hours", "We operate Saturdays from 9 AM to 5 PM. Appointments require confirmation.", 0.6);

describe("GroundedResponseService", () => {
  let service: GroundedResponseService;
  let contextBuilder: { build: jest.Mock };
  let retrieval: { retrieve: jest.Mock };
  let responder: { respond: jest.Mock };

  beforeEach(async () => {
    contextBuilder = { build: jest.fn().mockResolvedValue(built("¿Cuánto cuesta y atienden el sábado?")) };
    retrieval = { retrieve: jest.fn().mockResolvedValue({ query: "q", topK: 5, minSimilarity: 0.3, chunks: [PRICE, HOURS] }) };
    responder = {
      respond: jest.fn().mockResolvedValue({
        suggestedResponse: "La depilación láser de piernas cuesta S/320 por sesión y atendemos los sábados de 9 a 17.",
        usedSourceIds: ["S1", "S2"],
        insufficientKnowledge: false,
        requiresLiveVerification: false,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GroundedResponseService,
        { provide: ContextBuilderService, useValue: contextBuilder },
        { provide: KnowledgeRetrievalService, useValue: retrieval },
        { provide: GROUNDED_RESPONDER, useValue: responder },
      ],
    }).compile();
    service = moduleRef.get(GroundedResponseService);
  });

  it("retrieves with the conversation's companyId and returns a grounded suggestion with traced sources", async () => {
    const result = await service.suggest(CONVERSATION_ID, { intent: "PRICING", signals: ["PRICING_REQUESTED"] });

    expect(retrieval.retrieve).toHaveBeenCalledWith({ companyId: "company-1", query: "¿Cuánto cuesta y atienden el sábado?" });
    expect(responder.respond).toHaveBeenCalledWith({
      messages: built("").context.messages.map((m) => ({ ...m, text: "¿Cuánto cuesta y atienden el sábado?" })),
      sources: [
        { id: "S1", title: PRICE.title, content: PRICE.content },
        { id: "S2", title: HOURS.title, content: HOURS.content },
      ],
      interpretation: { intent: "PRICING", signals: ["PRICING_REQUESTED"] },
    });
    expect(result).toMatchObject({ status: "GROUNDED", grounded: true, insufficientKnowledge: false, requiresLiveVerification: false });
    expect(result.sources.map((s) => s.chunkId)).toEqual(["chunk-price", "chunk-hours"]);
    expect(result.sources[0]).toEqual({ chunkId: "chunk-price", documentId: "doc-1", title: PRICE.title, sourceName: "faq.md", chunkIndex: 0, similarity: 0.7 });
  });

  it("returns INSUFFICIENT_KNOWLEDGE without calling the LLM when nothing relevant is retrieved", async () => {
    retrieval.retrieve.mockResolvedValue({ query: "q", topK: 5, minSimilarity: 0.3, chunks: [] });
    const result = await service.suggest(CONVERSATION_ID);

    expect(responder.respond).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "INSUFFICIENT_KNOWLEDGE",
      suggestedResponse: null,
      grounded: false,
      insufficientKnowledge: true,
      requiresLiveVerification: false,
      retrievalQuery: "¿Cuánto cuesta y atienden el sábado?",
      sources: [],
    });
  });

  it("returns INSUFFICIENT_KNOWLEDGE when there is no customer message to retrieve for", async () => {
    contextBuilder.build.mockResolvedValue({ ...built(""), context: { conversationId: CONVERSATION_ID, messages: [] } });
    const result = await service.suggest(CONVERSATION_ID);
    expect(result.status).toBe("INSUFFICIENT_KNOWLEDGE");
    expect(retrieval.retrieve).not.toHaveBeenCalled();
  });

  it("passes through the model's insufficientKnowledge verdict and drops any text", async () => {
    responder.respond.mockResolvedValue({ suggestedResponse: null, usedSourceIds: [], insufficientKnowledge: true, requiresLiveVerification: false });
    const result = await service.suggest(CONVERSATION_ID);
    expect(result).toMatchObject({ status: "INSUFFICIENT_KNOWLEDGE", suggestedResponse: null, sources: [] });
  });

  it("discards a suggestion that cites no source (ungrounded text)", async () => {
    responder.respond.mockResolvedValue({ suggestedResponse: "Cuesta S/350.", usedSourceIds: [], insufficientKnowledge: false, requiresLiveVerification: false });
    const result = await service.suggest(CONVERSATION_ID);
    expect(result).toMatchObject({ status: "INSUFFICIENT_KNOWLEDGE", suggestedResponse: null });
  });

  it("discards a suggestion that cites a source that was not retrieved", async () => {
    responder.respond.mockResolvedValue({ suggestedResponse: "Cuesta S/320.", usedSourceIds: ["S1", "S9"], insufficientKnowledge: false, requiresLiveVerification: false });
    const result = await service.suggest(CONVERSATION_ID);
    expect(result).toMatchObject({ status: "INSUFFICIENT_KNOWLEDGE", suggestedResponse: null, sources: [] });
  });

  it("flags live verification from the model and deterministically from AVAILABILITY_REQUESTED", async () => {
    contextBuilder.build.mockResolvedValue(built("¿Tienen una cita libre este sábado a las 3?"));
    responder.respond.mockResolvedValue({
      suggestedResponse: "Atendemos los sábados de 9 a 17; el horario exacto debe confirmarse.",
      usedSourceIds: ["S2"],
      insufficientKnowledge: false,
      requiresLiveVerification: true,
    });
    const fromModel = await service.suggest(CONVERSATION_ID);
    expect(fromModel).toMatchObject({ status: "GROUNDED", requiresLiveVerification: true });
    expect(fromModel.sources.map((s) => s.chunkId)).toEqual(["chunk-hours"]);

    responder.respond.mockResolvedValue({ suggestedResponse: "Atendemos los sábados de 9 a 17.", usedSourceIds: ["S2"], insufficientKnowledge: false, requiresLiveVerification: false });
    const fromSignal = await service.suggest(CONVERSATION_ID, { signals: ["AVAILABILITY_REQUESTED"] });
    expect(fromSignal.requiresLiveVerification).toBe(true);
  });

  it("propagates provider failures instead of reporting insufficient knowledge", async () => {
    responder.respond.mockRejectedValue(new GroundedResponseError("PROVIDER_ERROR", "down"));
    await expect(service.suggest(CONVERSATION_ID)).rejects.toBeInstanceOf(GroundedResponseError);
  });
});
