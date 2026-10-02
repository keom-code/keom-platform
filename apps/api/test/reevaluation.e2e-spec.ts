import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Provider } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { ReevaluationProcessor } from "../src/reevaluation/reevaluation.processor";
import { ReevaluationQueue } from "../src/reevaluation/reevaluation.queue";
import { ReevaluationJob, reevaluationJobId } from "../src/reevaluation/reevaluation.types";

/**
 * M4 e2e against real PostgreSQL, the real M2A engine and the real HTTP endpoints. Only the
 * BullMQ queue is replaced (in-memory, same "existing id is ignored" rule); jobs are "fired"
 * by calling the processor with an injected execution time, so hours pass instantly.
 */
class InMemoryQueue {
  readonly jobs = new Map<string, ReevaluationJob>();
  isEnabled() {
    return true;
  }
  async add(job: ReevaluationJob): Promise<string> {
    const jobId = reevaluationJobId(job);
    if (!this.jobs.has(jobId)) this.jobs.set(jobId, job);
    return jobId;
  }
  forOpportunity(opportunityId: string) {
    return [...this.jobs.entries()].filter(([, job]) => job.opportunityId === opportunityId);
  }
}

const COMPANY_A = "00000000-0000-4000-8000-0000000000b1";
const COMPANY_B = "00000000-0000-4000-8000-0000000000b2";
const MINUTE = 60_000;

describe("Temporal re-evaluation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: ReevaluationProcessor;
  const queue = new InMemoryQueue();

  /** A conversation whose customer wrote at `inboundAt`, evaluated by M2A as HIGH_INTENT. */
  async function highIntentOpportunity(inboundAt: Date) {
    const customer = await prisma.customer.create({ data: { companyId: COMPANY_A, externalId: `519${Date.now()}${Math.random()}` } });
    const conversation = await prisma.conversation.create({ data: { companyId: COMPANY_A, customerId: customer.id, channel: Provider.WHATSAPP } });
    await inbound(conversation.id, inboundAt);

    const response = await request(app.getHttpServer())
      .post("/dev/opportunities/evaluate")
      .send({
        companyId: COMPANY_A,
        customerId: customer.id,
        conversationId: conversation.id,
        interestLevel: "HIGH",
        signals: [{ type: "BOOKING_INTENT" }, { type: "AVAILABILITY_REQUESTED" }],
        lastInboundAt: inboundAt.toISOString(),
      })
      .expect(201);
    expect(response.body).toMatchObject({ state: "HIGH_INTENT", risk: "LOW" });
    return { opportunityId: response.body.opportunityId as string, conversationId: conversation.id, response: response.body };
  }

  function inbound(conversationId: string, sentAt: Date) {
    return prisma.message.create({
      data: { companyId: COMPANY_A, conversationId, externalMessageId: `wamid.reeval-${randomUUID()}`, direction: "INBOUND", type: "TEXT", text: "x", sentAt },
    });
  }

  /** The NO_BUSINESS_REPLY job scheduled for the 4h checkpoint. */
  function stallJob(opportunityId: string) {
    const jobs = queue.forOpportunity(opportunityId).filter(([, job]) => job.trigger === "NO_BUSINESS_REPLY");
    return jobs.sort(([, a], [, b]) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor))[0]!;
  }

  /** Fire a job as the worker would, at its scheduled time. */
  function fire([jobId, job]: [string, ReevaluationJob], overrides: Partial<ReevaluationJob> = {}) {
    const data = { ...job, ...overrides };
    return processor.handle(data, { jobId, attempt: 1, now: new Date(Date.parse(data.scheduledFor)) });
  }

  async function snapshot(opportunityId: string) {
    const [opportunity, history, signals, actions] = await Promise.all([
      prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } }),
      prisma.opportunityStateHistory.count({ where: { opportunityId } }),
      prisma.opportunitySignal.count({ where: { opportunityId } }),
      prisma.actionRecommendation.count({ where: { opportunityId } }),
    ]);
    return { opportunity, history, signals, actions };
  }

  async function cleanup() {
    const where = { opportunity: { companyId: { in: [COMPANY_A, COMPANY_B] } } };
    await prisma.actionRecommendation.deleteMany({ where });
    await prisma.opportunityStateHistory.deleteMany({ where });
    await prisma.opportunitySignal.deleteMany({ where });
    await prisma.opportunity.deleteMany({ where: { companyId: { in: [COMPANY_A, COMPANY_B] } } });
    await prisma.message.deleteMany({ where: { companyId: { in: [COMPANY_A, COMPANY_B] } } });
    await prisma.conversation.deleteMany({ where: { companyId: { in: [COMPANY_A, COMPANY_B] } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: [COMPANY_A, COMPANY_B] } } });
    await prisma.company.deleteMany({ where: { id: { in: [COMPANY_A, COMPANY_B] } } });
  }

  beforeAll(async () => {
    delete process.env.OPPORTUNITY_STALL_MEDIUM_MINUTES;
    delete process.env.OPPORTUNITY_STALL_HIGH_MINUTES;
    process.env.REEVALUATION_GRACE_SECONDS = "30";
    process.env.REEVALUATION_ACTIVE_AFTER_HOURS = "0";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ReevaluationQueue).useValue(queue).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    processor = app.get(ReevaluationProcessor);

    await cleanup();
    await prisma.company.createMany({
      data: [
        { id: COMPANY_A, name: "Clínica (reevaluation e2e)" },
        { id: COMPANY_B, name: "Otra empresa (reevaluation e2e)" },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    delete process.env.REEVALUATION_GRACE_SECONDS;
    delete process.env.REEVALUATION_ACTIVE_AFTER_HOURS;
    await app.close();
  });

  it("schedules a check after each M2A stall checkpoint and persists the evidence M2A will re-run on", async () => {
    const inboundAt = new Date(Date.now() - MINUTE);
    const { opportunityId, response } = await highIntentOpportunity(inboundAt);

    expect(response.reevaluation.status).toBe("SCHEDULED");
    expect(response.reevaluation.jobs.map((j: { scheduledFor: string }) => Date.parse(j.scheduledFor))).toEqual([
      inboundAt.getTime() + 60 * MINUTE + 30_000,
      inboundAt.getTime() + 240 * MINUTE + 30_000,
    ]);
    const { opportunity } = await snapshot(opportunityId);
    expect(opportunity.currentSignals).toEqual(["BOOKING_INTENT", "AVAILABILITY_REQUESTED"]);
  });

  it("Scenario A: no business reply -> the job fires and M2A marks the opportunity AT_RISK", async () => {
    const { opportunityId } = await highIntentOpportunity(new Date(Date.now() - MINUTE));
    const before = await snapshot(opportunityId);

    await expect(fire(stallJob(opportunityId))).resolves.toBe("CHANGED");

    const after = await snapshot(opportunityId);
    expect(after.opportunity).toMatchObject({ state: "AT_RISK", risk: "HIGH", priority: "HIGH", isActive: true });
    expect(after.history).toBe(before.history + 1);
    expect(after.signals).toBe(before.signals);
    expect(after.opportunity.currentSignals).toEqual(before.opportunity.currentSignals);
  });

  it("Scenario B: the business replied before the job fires -> fresh state, no false escalation, no writes", async () => {
    const { opportunityId, conversationId } = await highIntentOpportunity(new Date(Date.now() - MINUTE));
    await request(app.getHttpServer())
      .post(`/dev/conversations/${conversationId}/business-replies`)
      .send({ companyId: COMPANY_A, text: "¡Hola! Te reservo el sábado a las 10." })
      .expect(201);
    const before = await snapshot(opportunityId);

    await expect(fire(stallJob(opportunityId))).resolves.toBe("UNCHANGED");

    const after = await snapshot(opportunityId);
    expect(after.opportunity).toMatchObject({ state: "HIGH_INTENT", risk: "LOW" });
    expect(after.opportunity.updatedAt).toEqual(before.opportunity.updatedAt);
    expect(after.history).toBe(before.history);
    expect(after.actions).toBe(before.actions);
  });

  it("uses the customer's latest message at execution time, not the one the job was scheduled for", async () => {
    const firstAt = new Date(Date.now() - MINUTE);
    const { opportunityId, conversationId } = await highIntentOpportunity(firstAt);
    await inbound(conversationId, new Date(firstAt.getTime() + 180 * MINUTE));

    await fire(stallJob(opportunityId));

    // At 4h30s after the first message, the latest one is only ~1h old: MEDIUM, not AT_RISK.
    const { opportunity } = await snapshot(opportunityId);
    expect(opportunity).toMatchObject({ state: "HIGH_INTENT", risk: "MEDIUM" });
  });

  it("is idempotent: duplicate scheduling maps to the same jobs and a re-fired job changes nothing", async () => {
    const inboundAt = new Date(Date.now() - MINUTE);
    const { opportunityId, conversationId, response } = await highIntentOpportunity(inboundAt);
    const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });

    const again = await request(app.getHttpServer())
      .post("/dev/opportunities/evaluate")
      .send({
        companyId: COMPANY_A,
        customerId: opportunity.customerId,
        conversationId,
        interestLevel: "HIGH",
        signals: [{ type: "BOOKING_INTENT" }, { type: "AVAILABILITY_REQUESTED" }],
        lastInboundAt: inboundAt.toISOString(),
      })
      .expect(201);
    expect(again.body.reevaluation.jobs.map((j: { jobId: string }) => j.jobId)).toEqual(response.reevaluation.jobs.map((j: { jobId: string }) => j.jobId));
    expect(queue.forOpportunity(opportunityId).filter(([, job]) => job.trigger === "NO_BUSINESS_REPLY")).toHaveLength(2);

    await fire(stallJob(opportunityId));
    const once = await snapshot(opportunityId);
    await expect(fire(stallJob(opportunityId))).resolves.toBe("UNCHANGED");
    expect(await snapshot(opportunityId)).toEqual(once);
  });

  it("no-ops for an inactive opportunity", async () => {
    const { opportunityId } = await highIntentOpportunity(new Date(Date.now() - MINUTE));
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { isActive: false } });
    const before = await snapshot(opportunityId);

    await expect(fire(stallJob(opportunityId))).resolves.toBe("INACTIVE");
    expect(await snapshot(opportunityId)).toEqual(before);
  });

  it("never re-evaluates across tenants: a job naming another company is a no-op", async () => {
    const { opportunityId } = await highIntentOpportunity(new Date(Date.now() - MINUTE));
    const before = await snapshot(opportunityId);

    await expect(fire(stallJob(opportunityId), { companyId: COMPANY_B })).resolves.toBe("NOT_FOUND");
    expect(await snapshot(opportunityId)).toEqual(before);
  });

  it("schedules an explicit FOLLOW_UP_DUE check, tenant-scoped and only in the future", async () => {
    const { opportunityId } = await highIntentOpportunity(new Date(Date.now() - MINUTE));
    const at = new Date(Date.now() + 30 * MINUTE).toISOString();
    const server = app.getHttpServer();

    const scheduled = await request(server).post(`/dev/opportunities/${opportunityId}/reevaluations`).send({ companyId: COMPANY_A, at }).expect(201);
    expect(scheduled.body).toMatchObject({ trigger: "FOLLOW_UP_DUE", scheduledFor: at });
    expect(queue.jobs.get(scheduled.body.jobId)).toMatchObject({ companyId: COMPANY_A, opportunityId, trigger: "FOLLOW_UP_DUE" });

    await request(server).post(`/dev/opportunities/${opportunityId}/reevaluations`).send({ companyId: COMPANY_B, at }).expect(404);
    await request(server)
      .post(`/dev/opportunities/${opportunityId}/reevaluations`)
      .send({ companyId: COMPANY_A, at: new Date(Date.now() - MINUTE).toISOString() })
      .expect(422);
  });

  it("records a business reply only for the conversation's own company", async () => {
    const { conversationId } = await highIntentOpportunity(new Date(Date.now() - MINUTE));
    await request(app.getHttpServer()).post(`/dev/conversations/${conversationId}/business-replies`).send({ companyId: COMPANY_B }).expect(404);
    expect(await prisma.message.count({ where: { conversationId, direction: "OUTBOUND" } })).toBe(0);
  });
});
