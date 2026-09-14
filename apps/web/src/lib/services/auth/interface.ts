import type { SessionUser } from "@keom/contracts";

/**
 * Auth abstraction boundary — see docs/ARCHITECTURE.md Section I. MockAuthService is
 * the only implementation for the pilot; a real HttpAuthService (calling apps/api) can
 * replace it later without touching session/middleware code.
 */
export interface AuthService {
  login(dni: string): Promise<SessionUser | null>;
}
