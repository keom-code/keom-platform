import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Provider } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { EMBEDDING_PROVIDER, EmbeddingError } from "../src/llm/embedding-provider";
import { GROUNDED_RESPONDER, GroundedResponderOutput, GroundedResponseRequest } from "../src/llm/grounded-responder";
import { PrismaService } from "../src/prisma/prisma.service";
import { FAKE_EMBEDDING_MODEL, FakeEmbeddingProvider } from "./fake-embedding-provider";

/**
 * M3 e2e against real PostgreSQL + pgvector (docker compose up -d + migrate first). No real
 * AI provider: EMBEDDING_PROVIDER is a deterministic FakeEmbeddingProvider and
 * GROUNDED_RESPONDER a jest mock. Three tenants from three different industries share the
 * exact same schema and code path.
 */
const CLINIC = "00000000-0000-4000-8000-0000000000c1";
const SAAS = "00000000-0000-4000-8000-0000000000c2";
const REAL_ESTATE = "00000000-0000-4000-8000-0000000000c3";
const COMPANY_IDS = [CLINIC, SAAS, REAL_ESTATE];

const CLINIC_CUSTOMER = "00000000-0000-4000-8000-0000000000d1";
const CLINIC_CONVERSATION = "00000000-0000-4000-8000-0000000000d2";
const REAL_ESTATE_CUSTOMER = "00000000-0000-4000-8000-0000000000d3";
const REAL_ESTATE_CONVERSATION = "00000000-0000-4000-8000-0000000000d4";

const CLINIC_FAQ = {
  title: "Depilación láser FAQ",
  content:
    "La depilación láser de piernas cuesta S/320 por sesión.\n\nAtendemos los sábados de 9 AM a 5 PM.\n\nLas citas requieren confirmación previa.",
  metadata: { category: "pricing", language: "es" },
};
const CLINIC_CANCELLATION = {
  title: "Política de cancelación",
  content: "Política de cancelación: puedes cancelar o reprogramar tu cita sin costo hasta 24 horas antes.",
  metadata: { category: "policy" },
};
const SAAS_PLAN = {
  title: "Business Plan",
  content: "El Business Plan cuesta $99 al mes. Incluye 20 usuarios, acceso API y soporte por email. Las suscripciones anuales tienen 15% de descuento.",
  metadata: { category: "plans", tier: "business" },
};
const REAL_ESTATE_FINANCING = {
  title: "Financiamiento hipotecario",
  sourceType: "MARKDOWN",
  content: "# Financiamiento\nEl crédito hipotecario requiere una inicial del 10% del valor del departamento.\n\n# Comisión\nLa comisión de corretaje es 3% más IGV.",
  metadata: { region: "lima", product: "departamentos" },
};

const embedder = new FakeEmbeddingProvider();
const responder = { respond: jest.fn<Promise<GroundedResponderOutput>, [GroundedResponseRequest]>() };

describe("Knowledge / RAG (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const docs: Record<string, string> = {};

  async function cleanup() {
    await prisma.knowledgeDocument.deleteMany({ where: { companyId: { in: COMPANY_IDS } } });
    await prisma.message.deleteMany({ where: { companyId: { in: COMPANY_IDS } } });
    await prisma.conversation.deleteMany({ where: { companyId: { in: COMPANY_IDS } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: COMPANY_IDS } } });
    await prisma.company.deleteMany({ where: { id: { in: COMPANY_IDS } } });
  }

  async function seedConversation(companyId: string, customerId: string, conversationId: string, text: string) {
    await prisma.customer.create({ data: { id: customerId, companyId, externalId: `ext-${customerId}` } });
    await prisma.conversation.create({ data: { id: conversationId, companyId, customerId, channel: Provider.WHATSAPP } });
    await prisma.message.create({
      data: { companyId, conversationId, externalMessageId: `wamid.${conversationId}`, direction: "INBOUND", type: "TEXT", text, sentAt: new Date() },
    });
  }

  function ingest(companyId: string, doc: object) {
    return request(app.getHttpServer())
      .post("/dev/knowledge/documents")
      .send({ companyId, ...doc });
  }

  function search(companyId: string, query: string, extra: object = {}) {
    return request(app.getHttpServer())
      .post("/dev/knowledge/search")
      .send({ companyId, query, ...extra })
      .expect(200);
  }

  function chunksOf(documentId: string) {
    return prisma.knowledgeChunk.findMany({ where: { documentId }, orderBy: { chunkIndex: "asc" } });
  }

  beforeAll(async () => {
    process.env.KNOWLEDGE_MIN_SIMILARITY = "0.2";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(embedder)
      .overrideProvider(GROUNDED_RESPONDER)
      .useValue(responder)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    await cleanup();
    await prisma.company.createMany({
      data: [
        { id: CLINIC, name: "Clínica (knowledge e2e)" },
        { id: SAAS, name: "SaaS (knowledge e2e)" },
        { id: REAL_ESTATE, name: "Inmobiliaria (knowledge e2e)" },
      ],
    });
    await seedConversation(CLINIC, CLINIC_CUSTOMER, CLINIC_CONVERSATION, "Hola, ¿cuánto cuesta la depilación láser de piernas y atienden el sábado?");
    await seedConversation(REAL_ESTATE, REAL_ESTATE_CUSTOMER, REAL_ESTATE_CONVERSATION, "¿Cuánto cuesta la depilación láser?");
  });

  beforeEach(() => {
    responder.respond.mockReset();
    embedder.failNext = null;
  });

  afterAll(async () => {
    await cleanup();
    delete process.env.KNOWLEDGE_MIN_SIMILARITY;
    await app.close();
  });

  it("ingests documents from three industries through the same generic schema", async () => {
    for (const [key, companyId, doc] of [
      ["clinicFaq", CLINIC, CLINIC_FAQ],
      ["clinicCancellation", CLINIC, CLINIC_CANCELLATION],
      ["saasPlan", SAAS, SAAS_PLAN],
      ["realEstate", REAL_ESTATE, REAL_ESTATE_FINANCING],
    ] as const) {
      const response = await ingest(companyId, doc).expect(201);
      expect(response.body.created).toBe(true);
      expect(response.body.document).toMatchObject({ companyId, title: doc.title, metadata: doc.metadata, chunkCount: 1 });
      docs[key] = response.body.document.id;
    }

    const chunks = await chunksOf(docs.clinicFaq!);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ companyId: CLINIC, chunkIndex: 0, embeddingModel: FAKE_EMBEDDING_MODEL, metadata: CLINIC_FAQ.metadata });
    expect(chunks[0]!.content).toBe(CLINIC_FAQ.content);

    const rows = await prisma.$queryRaw<{ dims: number }[]>`SELECT vector_dims(embedding) AS dims FROM knowledge_chunk WHERE document_id = ${docs.clinicFaq}::uuid`;
    expect(rows).toEqual([{ dims: 1536 }]);
  });

  it("returns the existing document for an identical retry without duplicating chunks", async () => {
    const response = await ingest(CLINIC, CLINIC_FAQ).expect(200);
    expect(response.body).toMatchObject({ created: false, document: { id: docs.clinicFaq } });
    expect(await prisma.knowledgeDocument.count({ where: { companyId: CLINIC } })).toBe(2);
    expect(await chunksOf(docs.clinicFaq!)).toHaveLength(1);
  });

  it("rejects empty content safely", async () => {
    await ingest(CLINIC, { title: "Vacío", content: " \n\t " }).expect(422);
    await ingest("00000000-0000-4000-8000-0000000000ff", CLINIC_FAQ).expect(404);
    await ingest(CLINIC, { title: "Sin companyId válido", content: "x", companyId: "nope" }).expect(400);
    expect(await prisma.knowledgeDocument.count({ where: { companyId: CLINIC } })).toBe(2);
  });

  it("writes nothing when embedding fails during create", async () => {
    embedder.failNext = new EmbeddingError("PROVIDER_TIMEOUT", "simulated timeout");
    await ingest(CLINIC, { title: "Promociones", content: "20% de descuento en marzo." }).expect(504);
    expect(await prisma.knowledgeDocument.count({ where: { companyId: CLINIC } })).toBe(2);
  });

  it("retrieves the most relevant chunks first, with source traceability", async () => {
    const response = await search(CLINIC, "¿Cuál es la política de cancelación de citas?", { minSimilarity: 0 });
    const [top] = response.body.chunks;
    expect(top).toMatchObject({ documentId: docs.clinicCancellation, title: CLINIC_CANCELLATION.title, chunkIndex: 0, metadata: CLINIC_CANCELLATION.metadata });
    expect(top.similarity).toBeGreaterThan(response.body.chunks[1].similarity);

    const pricing = await search(CLINIC, "¿Cuánto cuesta la depilación láser y atienden el sábado?");
    expect(pricing.body.chunks[0].documentId).toBe(docs.clinicFaq);
    expect(pricing.body.chunks[0].content).toContain("S/320");
  });

  it("works for SaaS and real-estate content with no schema change", async () => {
    const saas = await search(SAAS, "¿Cuánto cuesta el Business Plan y cuántos usuarios incluye?");
    expect(saas.body.chunks.map((c: { documentId: string }) => c.documentId)).toEqual([docs.saasPlan]);
    expect(saas.body.chunks[0].content).toContain("20 usuarios");

    const realEstate = await search(REAL_ESTATE, "¿Qué inicial requiere el crédito hipotecario?");
    expect(realEstate.body.chunks[0].documentId).toBe(docs.realEstate);
    expect(realEstate.body.chunks[0].content).toContain("10%");
  });

  it("never returns another company's knowledge, even for that company's exact text", async () => {
    const leaked = await search(CLINIC, SAAS_PLAN.content, { minSimilarity: 0, topK: 20 });
    const ids = leaked.body.chunks.map((c: { documentId: string }) => c.documentId);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id: string) => id === docs.clinicFaq || id === docs.clinicCancellation)).toBe(true);

    const saasOnly = await search(SAAS, CLINIC_FAQ.content, { minSimilarity: 0, topK: 20 });
    expect(saasOnly.body.chunks.map((c: { documentId: string }) => c.documentId)).toEqual([docs.saasPlan]);
  });

  it("never reads, updates or deletes another company's document by id", async () => {
    const server = app.getHttpServer();
    await request(server).get(`/dev/knowledge/documents/${docs.saasPlan}`).query({ companyId: CLINIC }).expect(404);
    await request(server)
      .put(`/dev/knowledge/documents/${docs.saasPlan}`)
      .send({ companyId: CLINIC, title: "hijack", content: "hijack" })
      .expect(404);
    await request(server).delete(`/dev/knowledge/documents/${docs.saasPlan}`).query({ companyId: CLINIC }).expect(404);

    const list = await request(server).get("/dev/knowledge/documents").query({ companyId: CLINIC }).expect(200);
    expect(list.body.documents.map((d: { id: string }) => d.id).sort()).toEqual([docs.clinicFaq, docs.clinicCancellation].sort());
    expect((await chunksOf(docs.saasPlan!))[0]!.content).toBe(SAAS_PLAN.content);
  });

  it("rejects at the database level a chunk whose company differs from its document's", async () => {
    const vector = `[${new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    await expect(
      prisma.$executeRaw`
        INSERT INTO knowledge_chunk (id, company_id, document_id, chunk_index, content, embedding, embedding_model)
        VALUES (gen_random_uuid(), ${CLINIC}::uuid, ${docs.saasPlan}::uuid, 99, 'cross-tenant', ${vector}::vector, 'x')`,
    ).rejects.toThrow(/knowledge_chunk_document_id_company_id_fkey/);
  });

  it("filters weak matches with the similarity threshold and returns empty when nothing is relevant", async () => {
    const weak = await search(CLINIC, "garantía de devolución de zapatos");
    expect(weak.body.chunks).toEqual([]);

    const unfiltered = await search(CLINIC, "garantía de devolución de zapatos", { minSimilarity: 0 });
    expect(unfiltered.body.chunks.length).toBeGreaterThan(0);
  });

  it("supports an optional generic metadata filter", async () => {
    const response = await search(CLINIC, "cita", { minSimilarity: 0, metadataFilter: { category: "policy" } });
    expect(response.body.chunks.map((c: { documentId: string }) => c.documentId)).toEqual([docs.clinicCancellation]);
  });

  it("update replaces chunks and leaves no stale vectors", async () => {
    const response = await request(app.getHttpServer())
      .put(`/dev/knowledge/documents/${docs.clinicCancellation}`)
      .send({ companyId: CLINIC, title: CLINIC_CANCELLATION.title, content: "Reembolsos: las sesiones pagadas no son reembolsables.", metadata: { category: "policy", version: 2 } })
      .expect(200);
    expect(response.body.document).toMatchObject({ id: docs.clinicCancellation, chunkCount: 1, metadata: { category: "policy", version: 2 } });

    const chunks = await chunksOf(docs.clinicCancellation!);
    expect(chunks.map((c) => c.content)).toEqual(["Reembolsos: las sesiones pagadas no son reembolsables."]);
    expect(chunks[0]!.metadata).toEqual({ category: "policy", version: 2 });

    const stale = await search(CLINIC, "puedes cancelar o reprogramar sin costo hasta 24 horas antes");
    expect(stale.body.chunks.map((c: { content: string }) => c.content).join()).not.toContain("24 horas");
  });

  it("keeps the previous version searchable when embedding fails during update", async () => {
    embedder.failNext = new EmbeddingError("PROVIDER_ERROR", "simulated outage");
    await request(app.getHttpServer())
      .put(`/dev/knowledge/documents/${docs.clinicCancellation}`)
      .send({ companyId: CLINIC, title: "Nueva", content: "Contenido nuevo" })
      .expect(502);

    const chunks = await chunksOf(docs.clinicCancellation!);
    expect(chunks.map((c) => c.content)).toEqual(["Reembolsos: las sesiones pagadas no son reembolsables."]);
  });

  it("suggest-response grounds on the conversation company's knowledge only", async () => {
    responder.respond.mockResolvedValue({
      suggestedResponse: "La depilación láser de piernas cuesta S/320 por sesión y atendemos los sábados de 9 AM a 5 PM. Las citas requieren confirmación.",
      usedSourceIds: ["S1"],
      insufficientKnowledge: false,
      requiresLiveVerification: false,
    });

    const response = await request(app.getHttpServer())
      .post("/dev/knowledge/suggest-response")
      .send({ conversationId: CLINIC_CONVERSATION, interpretation: { intent: "PRICING", signals: ["PRICING_REQUESTED", "AVAILABILITY_REQUESTED"] } })
      .expect(200);

    expect(response.body).toMatchObject({ status: "GROUNDED", grounded: true, insufficientKnowledge: false, requiresLiveVerification: true });
    expect(response.body.sources).toEqual([expect.objectContaining({ documentId: docs.clinicFaq, title: CLINIC_FAQ.title, chunkIndex: 0 })]);

    const sentSources = responder.respond.mock.calls[0]![0].sources.map((s) => s.content).join("\n");
    expect(sentSources).toContain("S/320");
    expect(sentSources).not.toContain("$99");
    expect(sentSources).not.toContain("hipotecario");
  });

  it("suggest-response returns INSUFFICIENT_KNOWLEDGE without calling the LLM when the company has no relevant knowledge", async () => {
    const response = await request(app.getHttpServer()).post("/dev/knowledge/suggest-response").send({ conversationId: REAL_ESTATE_CONVERSATION }).expect(200);

    expect(response.body).toEqual({
      status: "INSUFFICIENT_KNOWLEDGE",
      suggestedResponse: null,
      grounded: false,
      insufficientKnowledge: true,
      requiresLiveVerification: false,
      retrievalQuery: "¿Cuánto cuesta la depilación láser?",
      sources: [],
    });
    expect(responder.respond).not.toHaveBeenCalled();
  });

  it("suggest-response returns 404 for an unknown conversation", async () => {
    await request(app.getHttpServer()).post("/dev/knowledge/suggest-response").send({ conversationId: "00000000-0000-4000-8000-0000000000ee" }).expect(404);
  });

  it("delete removes the document and all its chunks", async () => {
    await request(app.getHttpServer()).delete(`/dev/knowledge/documents/${docs.clinicFaq}`).query({ companyId: CLINIC }).expect(204);
    expect(await prisma.knowledgeDocument.findUnique({ where: { id: docs.clinicFaq } })).toBeNull();
    expect(await chunksOf(docs.clinicFaq!)).toHaveLength(0);
    await request(app.getHttpServer()).get(`/dev/knowledge/documents/${docs.clinicFaq}`).query({ companyId: CLINIC }).expect(404);
  });
});
