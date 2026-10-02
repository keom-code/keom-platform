import { PrismaService } from "../prisma/prisma.service";
import { ReevaluationQueue } from "./reevaluation.queue";
import { ReevaluationScheduler, ReevaluationSchedulingError } from "./reevaluation-scheduler.service";
import { ReevaluationJob, reevaluationJobId } from "./reevaluation.types";

/**
 * Scheduler with Prisma mocked and an in-memory queue that mimics BullMQ's id semantics
 * (an add whose id already exists is ignored). No Redis.
 */
class FakeQueue {
  enabled = true;
  failNext: Error | null = null;
  readonly jobs = new Map<string, { job: ReevaluationJob; delayMs: number }>();
  readonly addCalls: string[] = [];

  isEnabled() {
    return this.enabled;
  }

  async add(job: ReevaluationJob, delayMs: number): Promise<string> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    const jobId = reevaluationJobId(job);
    this.addCalls.push(jobId);
    if (!this.jobs.has(jobId)) this.jobs.set(jobId, { job, delayMs });
    return jobId;
  }
}

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const OPPORTUNITY = {
  id: "00000000-0000-4000-8000-00000000000a",
  companyId: COMPANY_ID,
  conversationId: "00000000-0000-4000-8000-00000000000b",
  isActive: true,
};
const NOW = new Date("2026-01-01T10:00:00Z");
const minutes = (n: number) => n * 60_000;
const originalEnv = { ...process.env };

describe("ReevaluationScheduler", () => {
  let queue: FakeQueue;
  let prisma: { message: { findFirst: jest.Mock }; opportunity: { findFirst: jest.Mock } };
  let scheduler: ReevaluationScheduler;

  function messages(lastInboundAt?: Date, lastOutboundAt?: Date) {
    prisma.message.findFirst.mockImplementation(({ where }: { where: { direction: string } }) => {
      const at = where.direction === "INBOUND" ? lastInboundAt : lastOutboundAt;
      return Promise.resolve(at ? { sentAt: at } : null);
    });
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPPORTUNITY_STALL_MEDIUM_MINUTES;
    delete process.env.OPPORTUNITY_STALL_HIGH_MINUTES;
    process.env.REEVALUATION_GRACE_SECONDS = "30";
    process.env.REEVALUATION_ACTIVE_AFTER_HOURS = "0";
    queue = new FakeQueue();
    prisma = { message: { findFirst: jest.fn() }, opportunity: { findFirst: jest.fn().mockResolvedValue({ id: OPPORTUNITY.id, companyId: COMPANY_ID }) } };
    scheduler = new ReevaluationScheduler(prisma as unknown as PrismaService, queue as unknown as ReevaluationQueue);
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  it("schedules NO_BUSINESS_REPLY just after each M2A stall checkpoint, with minimal tenant-safe payloads", async () => {
    messages(NOW);
    const schedule = await scheduler.scheduleAfterEvaluation(OPPORTUNITY, NOW);

    expect(schedule.status).toBe("SCHEDULED");
    expect(schedule.jobs.map((j) => j.scheduledFor)).toEqual(["2026-01-01T11:00:30.000Z", "2026-01-01T14:00:30.000Z"]);
    const [first] = [...queue.jobs.values()];
    expect(first!.job).toEqual({
      v: 1,
      companyId: COMPANY_ID,
      opportunityId: OPPORTUNITY.id,
      trigger: "NO_BUSINESS_REPLY",
      anchorAt: NOW.toISOString(),
      scheduledFor: "2026-01-01T11:00:30.000Z",
    });
    expect(first!.delayMs).toBe(minutes(60) + 30_000);
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: OPPORTUNITY.conversationId, companyId: COMPANY_ID, direction: "INBOUND" } }),
    );
  });

  it("follows the configured M2A thresholds instead of its own constants", async () => {
    process.env.OPPORTUNITY_STALL_MEDIUM_MINUTES = "1";
    process.env.OPPORTUNITY_STALL_HIGH_MINUTES = "2";
    process.env.REEVALUATION_GRACE_SECONDS = "5";
    messages(NOW);
    const schedule = await scheduler.scheduleAfterEvaluation(OPPORTUNITY, NOW);
    expect(schedule.jobs.map((j) => j.scheduledFor)).toEqual(["2026-01-01T10:01:05.000Z", "2026-01-01T10:02:05.000Z"]);
  });

  it("skips checkpoints already in the past", async () => {
    messages(new Date(NOW.getTime() - minutes(90)));
    const schedule = await scheduler.scheduleAfterEvaluation(OPPORTUNITY, NOW);
    expect(schedule.jobs).toHaveLength(1);
    expect(schedule.jobs[0]!.scheduledFor).toBe("2026-01-01T12:30:30.000Z");
  });

  it("schedules no stall check when the business already replied", async () => {
    messages(new Date(NOW.getTime() - minutes(10)), new Date(NOW.getTime() - minutes(5)));
    expect(await scheduler.scheduleAfterEvaluation(OPPORTUNITY, NOW)).toEqual({ status: "NOTHING_TO_SCHEDULE", jobs: [] });
  });

  it("adds the GENERAL_REEVALUATION safety net rounded to the hour", async () => {
    process.env.REEVALUATION_ACTIVE_AFTER_HOURS = "24";
    messages(new Date(NOW.getTime() - minutes(10)), new Date(NOW.getTime() - minutes(5)));
    const schedule = await scheduler.scheduleAfterEvaluation(OPPORTUNITY, new Date("2026-01-01T10:20:00Z"));
    expect(schedule.jobs).toEqual([expect.objectContaining({ trigger: "GENERAL_REEVALUATION", scheduledFor: "2026-01-02T11:00:00.000Z" })]);
  });

  it("is idempotent: the same evaluation scheduled twice maps to the same job ids", async () => {
    messages(NOW);
    const first = await scheduler.scheduleAfterEvaluation(OPPORTUNITY, NOW);
    const second = await scheduler.scheduleAfterEvaluation(OPPORTUNITY, new Date(NOW.getTime() + 1000));

    expect(second.jobs.map((j) => j.jobId)).toEqual(first.jobs.map((j) => j.jobId));
    expect(queue.addCalls).toHaveLength(4);
    expect(queue.jobs.size).toBe(2);
    expect(first.jobs[0]!.jobId).not.toContain(":");
  });

  it("does nothing for an inactive opportunity or when M4 is disabled", async () => {
    messages(NOW);
    expect(await scheduler.scheduleAfterEvaluation({ ...OPPORTUNITY, isActive: false }, NOW)).toEqual({ status: "NOTHING_TO_SCHEDULE", jobs: [] });
    queue.enabled = false;
    expect(await scheduler.scheduleAfterEvaluation(OPPORTUNITY, NOW)).toEqual({ status: "DISABLED", jobs: [] });
    expect(queue.addCalls).toHaveLength(0);
  });

  it("reports (never throws) a Redis or config failure", async () => {
    messages(NOW);
    queue.failNext = new Error("Stream isn't writeable");
    expect(await scheduler.scheduleAfterEvaluation(OPPORTUNITY, NOW)).toEqual({ status: "FAILED", jobs: [], error: "Stream isn't writeable" });

    process.env.REEVALUATION_GRACE_SECONDS = "-1";
    expect((await scheduler.scheduleAfterEvaluation(OPPORTUNITY, NOW)).status).toBe("FAILED");
  });

  describe("scheduleFollowUp", () => {
    it("schedules FOLLOW_UP_DUE for an active opportunity of that company", async () => {
      const at = new Date(NOW.getTime() + minutes(30));
      const job = await scheduler.scheduleFollowUp({ opportunityId: OPPORTUNITY.id, companyId: COMPANY_ID, at }, NOW);
      expect(job).toMatchObject({ trigger: "FOLLOW_UP_DUE", scheduledFor: at.toISOString() });
      expect(prisma.opportunity.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OPPORTUNITY.id, companyId: COMPANY_ID, isActive: true } }),
      );
    });

    it("rejects another company's opportunity, past times, and a disabled queue", async () => {
      const at = new Date(NOW.getTime() + minutes(30));
      prisma.opportunity.findFirst.mockResolvedValueOnce(null);
      await expect(scheduler.scheduleFollowUp({ opportunityId: OPPORTUNITY.id, companyId: "other", at }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(scheduler.scheduleFollowUp({ opportunityId: OPPORTUNITY.id, companyId: COMPANY_ID, at: NOW }, NOW)).rejects.toMatchObject({
        code: "INVALID_TIME",
      });
      queue.enabled = false;
      await expect(scheduler.scheduleFollowUp({ opportunityId: OPPORTUNITY.id, companyId: COMPANY_ID, at }, NOW)).rejects.toBeInstanceOf(
        ReevaluationSchedulingError,
      );
      expect(queue.addCalls).toHaveLength(0);
    });
  });
});
