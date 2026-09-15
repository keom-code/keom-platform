/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Phase 9 scope is precache-only (no runtimeCaching) — see docs/ARCHITECTURE.md Phase
// 9. `navigateFallback` is what actually satisfies the acceptance bar: reloading a
// previously visited route while offline serves the precached /offline app shell
// instead of the browser's own offline error page. /offline itself is injected into
// the precache manifest in next.config.ts (it isn't a public/ file the default scan
// would pick up).
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  precacheOptions: {
    navigateFallback: "/offline",
  },
});

serwist.addEventListeners();

// Phase 10 (Notifications): routes a notification click to the URL it carries — e.g.
// /seller/alerts?alertId={id} — focusing an existing tab if one is open, or opening a
// new one otherwise. See docs/ARCHITECTURE.md Section J.
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data?.url as string | undefined) ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find(
        (client): client is WindowClient =>
          client.type === "window" && new URL(client.url).origin === self.location.origin,
      );
      if (existing) return existing.navigate(url).then((c) => c?.focus());
      return self.clients.openWindow(url);
    }),
  );
});
