import type { AdminAlertDetail, AdminAlertRow, SellerAlert } from "@keom/contracts";

export interface AlertsService {
  listSellerAlerts(): Promise<SellerAlert[]>;
  acknowledgeAlert(alertId: string): Promise<void>;
  listAdminAlerts(): Promise<AdminAlertRow[]>;
  getAdminAlertDetail(alertId: string): Promise<AdminAlertDetail | null>;
}
