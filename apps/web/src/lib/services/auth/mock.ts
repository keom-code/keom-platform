import "server-only";
import type { SessionUser } from "@keom/contracts";
import { mockUsers } from "@keom/mocks";
import type { AuthService } from "./interface";

/**
 * DNI-only lookup against a static table — explicitly NOT production authentication.
 * See docs/ARCHITECTURE.md Section I.
 */
export class MockAuthService implements AuthService {
  async login(dni: string): Promise<SessionUser | null> {
    const record = mockUsers.find((u) => u.dni === dni);
    if (!record) return null;
    return { id: record.id, name: record.name, role: record.role };
  }
}
