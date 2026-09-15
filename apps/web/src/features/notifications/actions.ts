"use server";

import type { PushSubscriptionPayload } from "@keom/contracts";
import { getSession } from "@/lib/auth/session";
import { notificationsService } from "@/lib/services/notifications";

async function requireSeller() {
  const session = await getSession();
  if (!session || session.role !== "SELLER") {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function subscribeToPushAction(payload: PushSubscriptionPayload): Promise<void> {
  const session = await requireSeller();
  if (payload.userId !== session.id) {
    throw new Error("Unauthorized");
  }
  await notificationsService.subscribe(payload);
}
