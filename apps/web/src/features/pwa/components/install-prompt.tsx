"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, XIcon } from "lucide-react";
import { Button } from "@keom/ui";
import { siteConfig } from "@/config/site";

const DISMISSED_KEY = "keom:install-prompt-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Private browsing / storage blocked — the banner will just reappear next visit.
  }
}

/**
 * Phase 9 (PWA): surfaces the browser's native install prompt instead of relying on
 * users finding it in the address bar. Chrome/Edge fire `beforeinstallprompt` only when
 * the manifest + service worker install criteria are met; Safari/Firefox never fire it,
 * so this banner simply never appears there — no fallback UI needed for those.
 */
export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (wasDismissed()) return;

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setInstallEvent(null);
      markDismissed();
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  if (!installEvent) return null;

  function dismiss() {
    setInstallEvent(null);
    markDismissed();
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    if (outcome !== "accepted") markDismissed();
  }

  return (
    <div
      role="dialog"
      aria-label="Instalar aplicación"
      className="fixed inset-x-4 bottom-4 z-50 flex items-center gap-3 rounded-xl border bg-card p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:w-sm"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <DownloadIcon className="size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Instalar {siteConfig.name}</p>
        <p className="text-xs text-muted-foreground">Accede más rápido desde tu pantalla de inicio.</p>
      </div>
      <Button size="sm" onClick={install}>
        Instalar
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={dismiss} aria-label="Cerrar">
        <XIcon />
      </Button>
    </div>
  );
}
