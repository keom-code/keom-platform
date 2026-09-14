"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Scoped to the Alerts feature (mounted in SellerLayout, not the root) — see
// docs/ARCHITECTURE.md Section G: it's the one screen that needs client-side
// polling/optimistic updates, not a default for every data fetch.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
