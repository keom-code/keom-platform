import { MockAlertsService } from "./mock";
import type { AlertsService } from "./interface";

export type { AlertsService } from "./interface";

// No HttpAlertsService yet — see docs/ARCHITECTURE.md Section H / Phase 11.
export const alertsService: AlertsService = new MockAlertsService();
