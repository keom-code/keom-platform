"use client";

import { useEffect, useState } from "react";
import { BellRingIcon } from "lucide-react";
import { Button } from "@keom/ui";
import type { NotificationPayload, SellerAlert } from "@keom/contracts";
import { useSession } from "@/providers/session-provider";
import { subscribeToPushAction } from "../actions";

type PermissionState = NotificationPermission | "unsupported";

/**
 * Phase 10 demo: lets a seller opt in to notifications and fire a real OS-level one to
 * validate the full click → /seller/alerts?alertId= → highlight path end-to-end,
 * without a real push server (apps/api's job in Phase 11 — see docs/ARCHITECTURE.md
 * Section J). Only usable against `pnpm build && pnpm start`: Phase 9 disables the
 * service worker under `pnpm dev` (Turbopack), so `simulateAlert` has nothing to call.
 */
export function NotificationDemoPanel({ alerts }: { alerts: SellerAlert[] }) {
  const session = useSession();
  const [permission, setPermission] = useState<PermissionState>("default");
  const [swReady, setSwReady] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Avoid a hydration mismatch: Notification.permission is only known on the client.
  useEffect(() => {
    // Intentional: reading a client-only browser API at mount, not state we're syncing
    // from an external system (see theme-switcher.tsx for the same pattern).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then(() => setSwReady(true)).catch(() => {});
  }, []);

  async function requestPermission() {
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") return;

    // Stub payload — a real Web Push subscription needs a VAPID applicationServerKey
    // and a server able to deliver to it. This only exercises the contract → action →
    // service round-trip end-to-end, not real push delivery.
    await subscribeToPushAction({
      userId: session.id,
      endpoint: `https://mock-push.local/${session.id}`,
      keys: { p256dh: "mock-p256dh", auth: "mock-auth" },
    });
  }

  async function simulateAlert() {
    const alert = alerts[0];
    if (!alert) return;

    const payload: NotificationPayload = {
      title: "KEOM — Nueva alerta",
      body: alert.summary,
      url: `/seller/alerts?alertId=${alert.id}`,
    };

    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
      icon: "/icons/icon-192.png",
    });
    setStatus("Notificación enviada — revisa el centro de notificaciones de tu sistema.");
  }

  if (permission === "unsupported") return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BellRingIcon className="size-4 text-muted-foreground" />
        Notificaciones push (demo)
      </div>

      {permission === "default" && (
        <>
          <p className="text-sm text-muted-foreground">
            Actívalas para recibir un aviso cuando llegue una alerta nueva.
          </p>
          <Button size="sm" className="w-fit" onClick={requestPermission}>
            Activar notificaciones
          </Button>
        </>
      )}

      {permission === "denied" && (
        <p className="text-sm text-muted-foreground">
          Bloqueaste las notificaciones para este sitio. Actívalas desde la configuración del
          navegador para probar esta demo.
        </p>
      )}

      {permission === "granted" && (
        <>
          <p className="text-sm text-muted-foreground">
            {swReady
              ? "Simula una alerta para ver cómo se ve una notificación real."
              : "Las notificaciones push requieren el build de producción (pnpm build && pnpm start) — el service worker no corre en modo desarrollo."}
          </p>
          <Button
            size="sm"
            className="w-fit"
            onClick={simulateAlert}
            disabled={!swReady || alerts.length === 0}
          >
            Simular alerta
          </Button>
          {status && <p className="text-xs text-success">{status}</p>}
        </>
      )}
    </div>
  );
}
