import { UserRole } from "@prisma/client";

/** The caller of a /v1 request, resolved by AuthGuard from the token + a fresh DB read.
 * companyId here is the ONLY tenant scope /v1 handlers may use. */
export interface AuthenticatedUser {
  id: string;
  companyId: string;
  name: string;
  role: UserRole;
}

export interface TokenClaims {
  sub: string;
  companyId: string;
  role: UserRole;
}

/** Minimal request shape the auth code relies on (avoids an @types/express dependency). */
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: { dni?: unknown };
  ip?: string;
  user?: AuthenticatedUser;
}
