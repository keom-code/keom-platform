import "server-only";
import { mockAdminAlertRows, mockSellerAlerts } from "@keom/mocks";
import type { AdminAlertDetail, AdminAlertRow, SellerAlert } from "@keom/contracts";
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

  async listAdminAlerts(): Promise<AdminAlertRow[]> {
    await delay(300);
    return mockAdminAlertRows;
  }

  async getAdminAlertDetail(alertId: string): Promise<AdminAlertDetail | null> {
    await delay(200);
    const row = mockAdminAlertRows.find((r) => r.id === alertId);
    if (!row) return null;
    // The admin audit row and the seller-facing alert are two read models of the
    // same underlying opportunity (docs/ARCHITECTURE.md Section H) — join by id to
    // get the KEOM-generated summary, which only the seller-facing shape carries.
    const summary = mockSellerAlerts.find((a) => a.id === alertId)?.summary ?? "";
    return { ...row, summary };
  }
}
