import type { Role } from "@keom/contracts";

/**
 * Mock DNI → user lookup table for MVP auth. NOT a production authentication
 * mechanism — see docs/ARCHITECTURE.md Section I.
 */
export interface MockUserRecord {
  dni: string;
  id: string;
  name: string;
  role: Role;
}

export const mockUsers: MockUserRecord[] = [
  { dni: "12345678", id: "user_seller_1", name: "Carlos Ramirez", role: "SELLER" },
  { dni: "87654321", id: "user_admin_1", name: "Andrea Torres", role: "ADMIN" },
];
