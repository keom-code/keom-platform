# KEOM — Keep Every Opportunity Moving

Monorepo for KEOM: a control/visibility layer for sellers and business owners on top of monitored WhatsApp Business conversations.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the **frontend** (`apps/web`)
architecture blueprint (decisions, folder structure, route map, phases) — it does not
cover `apps/api`. Backend architecture and milestones (M1 WhatsApp ingestion, M2A
deterministic Opportunity Engine, M2B LLM Commercial Interpretation Layer, ...) are
documented in [`apps/api/README.md`](./apps/api/README.md).

## Structure

- `apps/web` — Next.js frontend (App Router, TypeScript, Tailwind, shadcn/ui). See
  [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
- `apps/api` — NestJS backend (owned separately). See
  [`apps/api/README.md`](./apps/api/README.md) for milestones and local setup.
- `packages/ui` — shared design-system primitives.
- `packages/contracts` — shared TS types + Zod schemas for FE↔BE data shapes.
- `packages/config` — shared ESLint/TypeScript/Tailwind config.
- `packages/mocks` — canonical fixture data for mock services and E2E tests.

## Getting started

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env` in `apps/web` and adjust as needed.

## Scripts

- `pnpm dev` — run all apps in dev mode.
- `pnpm build` — build all apps/packages.
- `pnpm lint` — lint all workspaces.
- `pnpm typecheck` — typecheck all workspaces.
- `pnpm test` — run tests in all workspaces.
