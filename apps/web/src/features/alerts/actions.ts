"use server";

import type { SellerAlert } from "@keom/contracts";
import { getSession } from "@/lib/auth/session";
import { alertsService } from "@/lib/services/alerts";

async function requireSeller() {
  const session = await getSession();
  if (!session || session.role !== "SELLER") {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function listSellerAlertsAction(): Promise<SellerAlert[]> {
  await requireSeller();
  return alertsService.listSellerAlerts();
}

export async function acknowledgeAlertAction(alertId: string): Promise<void> {
  await requireSeller();
  await alertsService.acknowledgeAlert(alertId);
}
