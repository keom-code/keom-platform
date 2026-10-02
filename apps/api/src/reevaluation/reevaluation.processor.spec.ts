import { UnrecoverableError } from "bullmq";
import { OpportunitiesService } from "../opportunities/opportunities.service";
import { ReevaluationProcessor } from "./reevaluation.processor";

/** Processor handler with M2A mocked: it must only validate, delegate and classify. */
const JOB = {
  v: 1,
  companyId: "00000000-0000-4000-8000-000000000001",
  opportunityId: "00000000-0000-4000-8000-00000000000a",
  trigger: "NO_BUSINESS_REPLY",
  anchorAt: "2026-01-01T10:00:00.000Z",
  scheduledFor: "2026-01-01T11:00:30.000Z",
};
const NOW = new Date("2026-01-01T11:00:31Z");
const context = { jobId: "reeval-x", attempt: 1, now: NOW };

describe("ReevaluationProcessor.handle", () => {
  let opportunities: { reevaluate: jest.Mock };
  let processor: ReevaluationProcessor;

  beforeEach(() => {
    opportunities = { reevaluate: jest.fn() };
    processor = new ReevaluationProcessor(opportunities as unknown as OpportunitiesService);
  });

  it("delegates to M2A with the job's tenant and the execution time", async () => {
    opportunities.reevaluate.mockResolvedValue({
      status: "CHANGED",
      previous: { state: "HIGH_INTENT", risk: "LOW", priority: "HIGH" },
      opportunity: { state: "AT_RISK", risk: "HIGH", priority: "HIGH" },
      evaluation: { nextBestAction: "OFFER_APPOINTMENT" },
    });
    await expect(processor.handle(JOB, context)).resolves.toBe("CHANGED");
    expect(opportunities.reevaluate).toHaveBeenCalledWith({ opportunityId: JOB.opportunityId, companyId: JOB.companyId, now: NOW });
  });

  it.each(["NOT_FOUND", "INACTIVE", "NOT_EVALUATED"])("completes as a no-op for %s (obsolete or foreign job)", async (status) => {
    opportunities.reevaluate.mockResolvedValue({ status, opportunity: {} });
    await expect(processor.handle(JOB, context)).resolves.toBe(status);
  });

  it("completes as a no-op when M2A's result is unchanged", async () => {
    opportunities.reevaluate.mockResolvedValue({ status: "UNCHANGED", evaluation: { state: "HIGH_INTENT", risk: "LOW", nextBestAction: "OFFER_APPOINTMENT" } });
    await expect(processor.handle(JOB, context)).resolves.toBe("UNCHANGED");
  });

  it("rejects an invalid payload as unrecoverable (never retried) without touching M2A", async () => {
    await expect(processor.handle({ ...JOB, companyId: "not-a-uuid" }, context)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processor.handle({ ...JOB, trigger: "SEND_WHATSAPP" }, context)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(opportunities.reevaluate).not.toHaveBeenCalled();
  });

  it("re-throws transient M2A/DB failures so BullMQ retries them", async () => {
    opportunities.reevaluate.mockRejectedValue(new Error("connection terminated"));
    const failure = processor.handle(JOB, context);
    await expect(failure).rejects.toThrow("connection terminated");
    await expect(failure).rejects.not.toBeInstanceOf(UnrecoverableError);
  });
});
