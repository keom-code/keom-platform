import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { RoleSchema, type SessionUser } from "@keom/contracts";
import { env } from "@/config/env";

/**
 * Edge-safe (no next/headers) session token sign/verify. Used by both middleware.ts
 * (Edge runtime) and lib/auth/session.ts (Node runtime, via next/headers cookies()).
 *
 * This is the mock-auth session boundary — not real authorization. See
 * docs/ARCHITECTURE.md Section I: once a real backend exists, every apps/api call must
 * independently re-check role; this only gates which UI shell the browser renders.
 */
export const SESSION_COOKIE_NAME = "keom_session";
const SESSION_DURATION = "12h";

function getSecretKey() {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function signSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const role = RoleSchema.safeParse(payload.role);
    if (typeof payload.sub !== "string" || typeof payload.name !== "string" || !role.success) {
      return null;
    }
    return { id: payload.sub, name: payload.name, role: role.data };
  } catch {
    // Invalid signature, expired token, or malformed payload — all treated as "no session".
    return null;
  }
}
