import type { Metadata } from "next";
import { WifiOffIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { RetryButton } from "@/features/pwa/components/retry-button";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: `Sin conexión — ${siteConfig.name}`,
};

/**
 * Phase 9 (PWA) app-shell fallback: the service worker's `navigateFallback` serves this
 * precached page when a navigation fails offline, instead of the browser's own offline
 * error page. Must stay static and auth-free — it's served on every failed navigation,
 * including ones a session cookie can't be verified for. See src/app/sw.ts.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <EmptyState
          icon={WifiOffIcon}
          title="Sin conexión"
          description={`No pudimos cargar esta página de ${siteConfig.name}. Revisa tu conexión e inténtalo de nuevo.`}
        />
        <RetryButton />
      </div>
    </div>
  );
}
