import { MockNotificationsService } from "./mock";
import type { NotificationsService } from "./interface";

export type { NotificationsService } from "./interface";

// No HttpNotificationsService yet — see docs/ARCHITECTURE.md Section H / Phase 11.
export const notificationsService: NotificationsService = new MockNotificationsService();
