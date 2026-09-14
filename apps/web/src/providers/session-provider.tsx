"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@keom/contracts";

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

/**
 * Read-only projection of the server-verified session — never independently decoded
 * or trusted client-side. Must be used within a role layout, which guarantees a
 * session exists (redirects otherwise) before rendering SessionProvider.
 */
export function useSession(): SessionUser {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return session;
}
