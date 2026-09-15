import "server-only";
import type { PushSubscriptionPayload } from "@keom/contracts";
import type { NotificationsService } from "./interface";

// In-memory mutable copy for the MVP demo — resets on server restart. Real persistence
// (and actually sending a push via VAPID + web-web) arrives with apps/api in Phase 11
// (docs/ARCHITECTURE.md Section H).
const subscriptions = new Map<string, PushSubscriptionPayload>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockNotificationsService implements NotificationsService {
  async subscribe(payload: PushSubscriptionPayload): Promise<void> {
    await delay(300);
    subscriptions.set(payload.userId, payload);
  }

  async unsubscribe(userId: string): Promise<void> {
    await delay(300);
    subscriptions.delete(userId);
  }
}
