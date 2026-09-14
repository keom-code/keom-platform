import type { CustomerRisk } from "@keom/contracts";

export const mockCustomerRisks: CustomerRisk[] = [
  {
    customerId: "customer_4",
    customerName: "Luis Fernández",
    treatment: "Limpieza facial",
    riskLevel: "HIGH",
    riskScore: 88,
    reason: "Sin seguimiento por 4 días",
    opportunityValue: 350,
    lastActivityAt: "2026-09-10T09:00:00.000Z",
  },
  {
    customerId: "customer_5",
    customerName: "Camila Rojas",
    treatment: "Depilación láser",
    riskLevel: "MEDIUM",
    riskScore: 55,
    reason: "Objeción de precio sin resolver",
    opportunityValue: 900,
    lastActivityAt: "2026-09-12T16:20:00.000Z",
  },
  {
    customerId: "customer_6",
    customerName: "Diego Salazar",
    treatment: "Masaje relajante",
    riskLevel: "LOW",
    riskScore: 22,
    reason: "Respuesta lenta del vendedor",
    opportunityValue: 150,
    lastActivityAt: "2026-09-13T11:10:00.000Z",
  },
];
