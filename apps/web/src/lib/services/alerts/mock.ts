import "server-only";
import { mockSellerAlerts } from "@keom/mocks";
import type { SellerAlert } from "@keom/contracts";
import type { AlertsService } from "./interface";

// In-memory mutable copy for the MVP demo — resets on server restart. Real persistence
// arrives with apps/api in Phase 11 (docs/ARCHITECTURE.md Section H).
let alerts: SellerAlert[] = [...mockSellerAlerts];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockAlertsService implements AlertsService {
  async listSellerAlerts(): Promise<SellerAlert[]> {
    await delay(300);
    return alerts;
  }

  async acknowledgeAlert(alertId: string): Promise<void> {
    await delay(300);
    alerts = alerts.map((alert) =>
      alert.id === alertId ? { ...alert, status: "ACKNOWLEDGED" } : alert,
    );
  }
}
