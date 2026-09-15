import type { PushSubscriptionPayload } from "@keom/contracts";

export interface NotificationsService {
  subscribe(payload: PushSubscriptionPayload): Promise<void>;
  unsubscribe(userId: string): Promise<void>;
}
