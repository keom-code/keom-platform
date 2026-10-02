import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { REEVALUATION_JOB_OPTIONS, redisUrl } from "./reevaluation.config";
import { REEVALUATION_QUEUE, ReevaluationJob, reevaluationJobId } from "./reevaluation.types";

/**
 * Thin producer-side wrapper around the BullMQ queue (M4) — the only scheduling code that
 * talks to Redis, and the seam tests replace with an in-memory fake.
 *
 * REDIS_URL unset: disabled, with a WARN at startup (never silent). REDIS_URL set: the
 * connection uses enableOfflineQueue=false so an add fails fast when Redis is down instead
 * of hanging the request; the caller logs and reports it. The API still boots if Redis is
 * unreachable (logged as ERROR) — M1/M2B/M3 don't depend on it.
 */
@Injectable()
export class ReevaluationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReevaluationQueue.name);
  private connection: IORedis | null = null;
  private queue: Queue | null = null;

  async onModuleInit(): Promise<void> {
    const url = redisUrl();
    if (!url) {
      this.logger.warn("M4 re-evaluation scheduling is DISABLED: REDIS_URL is not set. Opportunities will not be re-evaluated over time.");
      return;
    }
    this.connection = new IORedis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    this.connection.on("error", (err) => this.logger.error(`Redis (queue) connection error: ${err.message}`));
    this.queue = new Queue(REEVALUATION_QUEUE, { connection: this.connection, defaultJobOptions: { ...REEVALUATION_JOB_OPTIONS } });
    this.logger.log(`M4 re-evaluation scheduling enabled (queue "${REEVALUATION_QUEUE}")`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }

  isEnabled(): boolean {
    return this.queue !== null;
  }

  /** Adds a delayed job under its deterministic id; an existing id is ignored by BullMQ. */
  async add(job: ReevaluationJob, delayMs: number): Promise<string> {
    if (!this.queue) throw new Error("Re-evaluation queue is disabled (REDIS_URL not set).");
    const jobId = reevaluationJobId(job);
    await this.queue.add(job.trigger, job, { jobId, delay: Math.max(0, delayMs) });
    return jobId;
  }
}
