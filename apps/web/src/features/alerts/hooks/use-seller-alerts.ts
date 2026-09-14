"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SellerAlert } from "@keom/contracts";
import { acknowledgeAlertAction, listSellerAlertsAction } from "../actions";

const SELLER_ALERTS_KEY = ["seller-alerts"] as const;

export function useSellerAlerts() {
  return useQuery({
    queryKey: SELLER_ALERTS_KEY,
    queryFn: () => listSellerAlertsAction(),
    refetchOnWindowFocus: true,
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (alertId: string) => acknowledgeAlertAction(alertId),
    onMutate: async (alertId: string) => {
      await queryClient.cancelQueries({ queryKey: SELLER_ALERTS_KEY });
      const previous = queryClient.getQueryData<SellerAlert[]>(SELLER_ALERTS_KEY);
      queryClient.setQueryData<SellerAlert[]>(SELLER_ALERTS_KEY, (old) =>
        old?.map((alert) =>
          alert.id === alertId ? { ...alert, status: "ACKNOWLEDGED" as const } : alert,
        ),
      );
      return { previous };
    },
    onError: (_error, _alertId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(SELLER_ALERTS_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SELLER_ALERTS_KEY });
    },
  });
}
