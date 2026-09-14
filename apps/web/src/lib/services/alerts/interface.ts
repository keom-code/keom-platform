import type { SellerAlert } from "@keom/contracts";

export interface AlertsService {
  listSellerAlerts(): Promise<SellerAlert[]>;
  acknowledgeAlert(alertId: string): Promise<void>;
}
