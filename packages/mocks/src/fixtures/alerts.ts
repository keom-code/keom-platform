import type { AdminAlertRow, SellerAlert } from "@keom/contracts";

export const mockSellerAlerts: SellerAlert[] = [
  {
    id: "alert_1",
    customer: {
      id: "customer_1",
      firstName: "Juan",
      lastName: "Pérez",
      phone: "+51999111222",
    },
    priority: "HIGH",
    opportunityValue: 1200,
    summary:
      "Juan preguntó por depilación láser. KEOM recuperó la conversación explicando opciones de pago. Juan ahora quiere reservar para mañana.",
    requiredAction: "Confirmar horario disponible.",
    createdAt: "2026-09-14T14:31:00.000Z",
    status: "PENDING",
    whatsappUrl: "https://wa.me/51999111222",
  },
  {
    id: "alert_2",
    customer: {
      id: "customer_2",
      firstName: "María",
      lastName: "Díaz",
      phone: "+51999333444",
    },
    priority: "MEDIUM",
    opportunityValue: 480,
    summary: "María confirmó interés pero necesita ayuda para elegir un horario de reserva.",
    requiredAction: "Ayudar a agendar una cita.",
    createdAt: "2026-09-14T14:17:00.000Z",
    status: "PENDING",
    whatsappUrl: "https://wa.me/51999333444",
  },
  {
    id: "alert_3",
    customer: {
      id: "customer_3",
      firstName: "Ana",
      lastName: "Torres",
      phone: "+51999555666",
    },
    priority: "LOW",
    opportunityValue: 250,
    summary: "Ana pidió hablar directamente con un asesor humano.",
    requiredAction: "Responder la solicitud de contacto humano.",
    createdAt: "2026-09-14T13:44:00.000Z",
    status: "PENDING",
    whatsappUrl: "https://wa.me/51999555666",
  },
];

export const mockAdminAlertRows: AdminAlertRow[] = [
  {
    id: "alert_1",
    customerName: "Juan Pérez",
    sellerName: "Carlos Ramirez",
    reason: "Listo para cerrar",
    createdAt: "2026-09-14T14:31:00.000Z",
    status: "ACKNOWLEDGED",
    acknowledgedAt: "2026-09-14T14:33:00.000Z",
  },
  {
    id: "alert_2",
    customerName: "María Díaz",
    sellerName: "Fernanda Cruz",
    reason: "Necesita agendar",
    createdAt: "2026-09-14T14:17:00.000Z",
    status: "PENDING",
  },
  {
    id: "alert_3",
    customerName: "Ana Torres",
    sellerName: "Carlos Ramirez",
    reason: "Solicitó humano",
    createdAt: "2026-09-14T13:44:00.000Z",
    status: "COMPLETED",
    acknowledgedAt: "2026-09-14T13:46:00.000Z",
    completedAt: "2026-09-14T13:52:00.000Z",
  },
];
