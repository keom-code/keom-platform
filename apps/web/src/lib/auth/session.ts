import "server-only";
import { cookies } from "next/headers";
import type { SessionUser } from "@keom/contracts";
import { SESSION_COOKIE_NAME, signSessionToken, verifySessionToken } from "./jwt";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12h — see jwt.ts SESSION_DURATION

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await signSessionToken(user);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
