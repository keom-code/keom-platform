import { z } from "zod";

/**
 * Stored so apps/api can later target a specific browser/device with Web Push.
 * Shape matches the browser PushSubscription object (endpoint + encryption keys).
 */
export const PushSubscriptionPayloadSchema = z.object({
  userId: z.string(),
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});
export type PushSubscriptionPayload = z.infer<typeof PushSubscriptionPayloadSchema>;

/**
 * Payload delivered to the service worker for a push notification (real or mocked).
 * `url` drives notificationclick routing — see docs/ARCHITECTURE.md Section J.
 */
export const NotificationPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  url: z.string(),
});
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;
