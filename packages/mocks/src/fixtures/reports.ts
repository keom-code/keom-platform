import type { AdminReport } from "@keom/contracts";

export const mockAdminReport: AdminReport = {
  summary: {
    recoveredRevenue: 18750,
    recoveredOpportunities: 23,
    recoveryRate: 0.318,
    atRiskOpportunities: 17,
  },
  revenueTimeline: [
    { date: "2026-09-08T00:00:00.000Z", recoveredRevenue: 2100 },
    { date: "2026-09-09T00:00:00.000Z", recoveredRevenue: 2600 },
    { date: "2026-09-10T00:00:00.000Z", recoveredRevenue: 1800 },
    { date: "2026-09-11T00:00:00.000Z", recoveredRevenue: 3200 },
    { date: "2026-09-12T00:00:00.000Z", recoveredRevenue: 2950 },
    { date: "2026-09-13T00:00:00.000Z", recoveredRevenue: 3100 },
    { date: "2026-09-14T00:00:00.000Z", recoveredRevenue: 3000 },
  ],
  lossReasons: [
    { reason: "Sin seguimiento", percentage: 0.38 },
    { reason: "Objeción de precio", percentage: 0.27 },
    { reason: "Respuesta lenta del vendedor", percentage: 0.18 },
    { reason: "Sin disponibilidad", percentage: 0.09 },
    { reason: "Problema de pago", percentage: 0.05 },
    { reason: "Otro", percentage: 0.03 },
  ],
  recoveryBySeller: [
    { sellerId: "user_seller_1", sellerName: "Carlos Ramirez", recoveredRevenue: 9800, recoveredOpportunities: 12 },
    { sellerId: "user_seller_2", sellerName: "Fernanda Cruz", recoveredRevenue: 8950, recoveredOpportunities: 11 },
  ],
  recoveryByTreatment: [
    { treatment: "Depilación láser", recoveredRevenue: 7200, recoveredOpportunities: 8 },
    { treatment: "Limpieza facial", recoveredRevenue: 5100, recoveredOpportunities: 7 },
    { treatment: "Masaje relajante", recoveredRevenue: 4200, recoveredOpportunities: 5 },
    { treatment: "Otro", recoveredRevenue: 2250, recoveredOpportunities: 3 },
  ],
};
