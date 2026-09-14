import { MockAuthService } from "./mock";
import type { AuthService } from "./interface";

export type { AuthService } from "./interface";

// No HttpAuthService yet — see docs/ARCHITECTURE.md Section I / Phase 11. When it
// exists, select between the two here based on a server-only env var, same pattern
// as the data services in Section H.
export const authService: AuthService = new MockAuthService();
