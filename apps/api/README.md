# apps/api

Placeholder for the KEOM backend (NestJS + PostgreSQL + Redis/BullMQ), owned by the backend developer.

This app is intentionally empty beyond this placeholder. When scaffolding the real NestJS project here:

- Use `nest new .` (or equivalent) inside this directory, keeping the existing `package.json` `name` (`@keom/api`) or updating it consistently across the workspace.
- Add real `dev`/`build`/`lint`/`typecheck`/`test` scripts so Turborepo's pipelines (`turbo.json` at the repo root) pick them up — the current scripts are no-op placeholders.
- Consume `@keom/contracts` (in `packages/contracts`) as the reference for response shapes the frontend expects. NestJS DTOs (class-validator) should be hand-aligned to those TypeScript interfaces/Zod schemas for now; see `docs/ARCHITECTURE.md` Section A for the plan to generate types from this API's OpenAPI spec once the surface stabilizes.
- Frontend calls this API directly from Server Components/Actions (no BFF/proxy layer) once `DATA_SOURCE=http` is set in `apps/web` — see `docs/ARCHITECTURE.md` Section H.

See the root [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for full context on how this app fits into the monorepo.
