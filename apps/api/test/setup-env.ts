/**
 * e2e suites boot the full AppModule. Keep M4 off (no real Redis queue or worker) even if
 * REDIS_URL is set in apps/api/.env: an existing env var wins over .env in ConfigModule.
 * test/reevaluation.e2e-spec.ts replaces the queue with an in-memory fake instead.
 */
process.env.REDIS_URL = "";
