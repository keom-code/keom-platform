import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Provider } from "@prisma/client";
import request from "supertest";
import { z } from "zod";
import {
  AdminAlertDetailSchema,
  AdminAlertRowSchema,
  CustomerRiskSchema,
  LoginResponseSchema,
  SellerAlertSchema,
  SessionUserSchema,
} from "@keom/contracts";
import { AppModule } from "../src/app.module";
import { hashPassword } from "../src/auth/password";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * Phase 11 /v1 API against real PostgreSQL. Every response the web app will consume is
 * parsed with the frontend's own @keom/contracts Zod schema, so the API can't drift from
 * what apps/web expects. Opportunities are created through the real M2A dev endpoint.
 */
const COMPANY_A = "00000000-0000-4000-8000-0000000001a1";
const COMPANY_B = "00000000-0000-4000-8000-0000000001a2";
const PHONE_NUMBER_ID_A = "e2e-dashboard-phone-a";
const PASSWORD = "e2e-password-123";
const SECRET = "e2e-test-secret-at-least-32-characters-long";
const MINUTE = 60_000;

const USERS = {
  sellerA: { id: "00000000-0000-4000-8000-0000000001a3", dni: "e2e-seller-a", name: "Vendedora A", role: "SELLER" as const, companyId: COMPANY_A },
  adminA: { id: "00000000-0000-4000-8000-0000000001a4", dni: "e2e-admin-a", name: "Admin A", role: "ADMIN" as const, companyId: COMPANY_A },
  sellerB: { id: "00000000-0000-4000-8000-0000000001a5", dni: "e2e-seller-b", name: "Vendedor B", role: "SELLER" as const, companyId: COMPANY_B },
};

describe("Phase 11 dashboard API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<keyof typeof USERS, string> = { sellerA: "", adminA: "", sellerB: "" };
  const ids = { atRisk: "", answered: "", waiting: "", otherCompany: "", atRiskPhone: "" };

  const server = () => app.getHttpServer();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  function login(dni: string, password = PASSWORD) {
    return request(server()).post("/v1/auth/login").send({ dni, password });
  }

  /** Customer + conversation + inbound message, then a real M2A evaluation. */
  async function opportunity(companyId: string, opts: { name: string; minutesAgo: number; interestLevel: string; signals: string[]; reply?: boolean }) {
    const phone = `519${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const customer = await prisma.customer.create({ data: { companyId, externalId: phone, phone, name: opts.name } });
    const conversation = await prisma.conversation.create({ data: { companyId, customerId: customer.id, channel: Provider.WHATSAPP } });
    const inboundAt = new Date(Date.now() - opts.minutesAgo * MINUTE);
    await prisma.message.create({
      data: { companyId, conversationId: conversation.id, externalMessageId: `wamid.dash-${randomUUID()}`, direction: "INBOUND", type: "TEXT", text: "x", sentAt: inboundAt },
    });
    if (opts.reply) {
      await prisma.message.create({
        data: { companyId, conversationId: conversation.id, externalMessageId: `wamid.dash-${randomUUID()}`, direction: "OUTBOUND", type: "TEXT", sentAt: new Date(inboundAt.getTime() + MINUTE) },
      });
    }
    const response = await request(server())
      .post("/dev/opportunities/evaluate")
      .send({
        companyId,
        customerId: customer.id,
        conversationId: conversation.id,
        interestLevel: opts.interestLevel,
        signals: opts.signals.map((type) => ({ type })),
        lastInboundAt: inboundAt.toISOString(),
        ...(opts.reply && { lastOutboundAt: new Date(inboundAt.getTime() + MINUTE).toISOString() }),
      })
      .expect(201);
    return { opportunityId: response.body.opportunityId as string, customer, conversation, phone };
  }

  async function cleanup() {
    const companies = { in: [COMPANY_A, COMPANY_B] };
    await prisma.actionRecommendation.deleteMany({ where: { opportunity: { companyId: companies } } });
    await prisma.opportunityStateHistory.deleteMany({ where: { opportunity: { companyId: companies } } });
    await prisma.opportunitySignal.deleteMany({ where: { opportunity: { companyId: companies } } });
    await prisma.opportunity.deleteMany({ where: { companyId: companies } });
    await prisma.message.deleteMany({ where: { companyId: companies } });
    await prisma.conversation.deleteMany({ where: { companyId: companies } });
    await prisma.customer.deleteMany({ where: { companyId: companies } });
    await prisma.rawEvent.deleteMany({ where: { companyId: companies } });
    await prisma.integration.deleteMany({ where: { companyId: companies } });
    await prisma.user.deleteMany({ where: { companyId: companies } });
    await prisma.company.deleteMany({ where: { id: companies } });
  }

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    await cleanup();
    await prisma.company.createMany({ data: [{ id: COMPANY_A, name: "Clínica A (dashboard e2e)" }, { id: COMPANY_B, name: "Empresa B (dashboard e2e)" }] });
    await prisma.integration.create({ data: { companyId: COMPANY_A, provider: Provider.WHATSAPP, phoneNumberId: PHONE_NUMBER_ID_A } });
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.user.createMany({ data: Object.values(USERS).map((user) => ({ ...user, passwordHash })) });

    for (const key of Object.keys(USERS) as (keyof typeof USERS)[]) {
      tokens[key] = (await login(USERS[key].dni).expect(200)).body.token;
    }

    // 5h without a reply: M2A says AT_RISK / OFFER_APPOINTMENT.
    const atRisk = await opportunity(COMPANY_A, { name: "María José Díaz", minutesAgo: 300, interestLevel: "HIGH", signals: ["BOOKING_INTENT", "AVAILABILITY_REQUESTED"] });
    ids.atRisk = atRisk.opportunityId;
    ids.atRiskPhone = atRisk.phone;
    // Answered pricing question: ENGAGED / SEND_INFORMATION.
    ids.answered = (await opportunity(COMPANY_A, { name: "Juan Pérez", minutesAgo: 10, interestLevel: "MEDIUM", signals: ["PRICING_REQUESTED"], reply: true })).opportunityId;
    // Re-evaluated with no evidence: NEW / WAIT, so not an alert.
    const waiting = await opportunity(COMPANY_A, { name: "Ana Ruiz", minutesAgo: 10, interestLevel: "LOW", signals: ["PRICING_REQUESTED"] });
    await request(server())
      .post("/dev/opportunities/evaluate")
      .send({ companyId: COMPANY_A, customerId: waiting.customer.id, conversationId: waiting.conversation.id, interestLevel: "LOW", signals: [] })
      .expect(201);
    ids.waiting = waiting.opportunityId;
    ids.otherCompany = (await opportunity(COMPANY_B, { name: "Cliente B", minutesAgo: 300, interestLevel: "HIGH", signals: ["BOOKING_INTENT", "AVAILABILITY_REQUESTED"] })).opportunityId;
  });

  afterAll(async () => {
    await cleanup();
    delete process.env.AUTH_JWT_SECRET;
    await app.close();
  });

  describe("auth", () => {
    it("logs in with DNI + password and returns a contract-shaped session user", async () => {
      const response = await login(USERS.sellerA.dni).expect(200);
      expect(LoginResponseSchema.parse(response.body).user).toEqual({ id: USERS.sellerA.id, name: "Vendedora A", role: "SELLER" });
      expect(response.body.token).toEqual(expect.any(String));
      expect(Date.parse(response.body.expiresAt)).toBeGreaterThan(Date.now());
      expect(JSON.stringify(response.body)).not.toContain(USERS.sellerA.dni);

      const me = await request(server()).get("/v1/auth/me").set(as(response.body.token)).expect(200);
      expect(SessionUserSchema.parse(me.body)).toEqual({ id: USERS.sellerA.id, name: "Vendedora A", role: "SELLER" });
    });

    it("gives the same answer for a wrong password and an unknown DNI", async () => {
      const wrong = await login(USERS.adminA.dni, "wrong-password").expect(401);
      const unknown = await login("e2e-nobody").expect(401);
      expect(wrong.body.message).toBe(unknown.body.message);
      await request(server()).post("/v1/auth/login").send({ dni: USERS.adminA.dni }).expect(400);
    });

    it("throttles repeated login attempts for the same DNI", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await login("e2e-throttled", "x")).status);
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses[5]).toBe(429);
    });

    it("rejects missing, invalid, tampered and orphaned tokens", async () => {
      await request(server()).get("/v1/seller/alerts").expect(401);
      await request(server()).get("/v1/seller/alerts").set(as("not-a-jwt")).expect(401);
      const [header, payload, signature] = tokens.sellerA.split(".");
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), companyId: COMPANY_B })).toString("base64url");
      await request(server()).get("/v1/seller/alerts").set(as(`${header}.${forged}.${signature}`)).expect(401);

      const temp = await prisma.user.create({
        data: { companyId: COMPANY_A, name: "Temporal", role: "SELLER", dni: "e2e-temp", passwordHash: await hashPassword(PASSWORD) },
      });
      const token = (await login("e2e-temp").expect(200)).body.token;
      await prisma.user.delete({ where: { id: temp.id } });
      await request(server()).get("/v1/seller/alerts").set(as(token)).expect(401);
    });

    it("enforces roles", async () => {
      await request(server()).get("/v1/admin/alerts").set(as(tokens.sellerA)).expect(403);
      await request(server()).get("/v1/seller/alerts").set(as(tokens.adminA)).expect(403);
    });

    it("answers 503 when auth is not configured, without breaking the rest of the API", async () => {
      delete process.env.AUTH_JWT_SECRET;
      try {
        await login(USERS.sellerA.dni).expect(503);
        await request(server()).get("/v1/seller/alerts").set(as(tokens.sellerA)).expect(503);
      } finally {
        process.env.AUTH_JWT_SECRET = SECRET;
      }
    });
  });

  describe("seller", () => {
    it("lists only the company's open alerts as SellerAlert[], most urgent first", async () => {
      const response = await request(server()).get("/v1/seller/alerts").set(as(tokens.sellerA)).expect(200);
      const alerts = z.array(SellerAlertSchema).parse(response.body);

      expect(alerts.map((a) => a.id)).toEqual([ids.atRisk, ids.answered]);
      const [atRisk] = alerts;
      expect(atRisk).toMatchObject({
        priority: "HIGH",
        status: "PENDING",
        requiredAction: "Ofrecer un horario disponible.",
        customer: { firstName: "María", lastName: "José Díaz", phone: `+${ids.atRiskPhone}` },
        whatsappUrl: `https://wa.me/${ids.atRiskPhone}`,
      });
      expect(atRisk!.summary).toBe(
        "María quiere reservar y consultó disponibilidad. Sin respuesta del negocio desde hace 5 h. La oportunidad está en riesgo.",
      );
      expect(alerts[1]!.summary).toContain("Esperando respuesta del cliente");
      expect(atRisk).not.toHaveProperty("opportunityValue");
    });

    it("acknowledges an alert idempotently and only within the caller's company", async () => {
      await request(server()).post(`/v1/seller/alerts/${ids.atRisk}/acknowledge`).set(as(tokens.sellerA)).expect(204);
      await request(server()).post(`/v1/seller/alerts/${ids.atRisk}/acknowledge`).set(as(tokens.sellerA)).expect(204);
      await request(server()).post(`/v1/seller/alerts/${ids.otherCompany}/acknowledge`).set(as(tokens.sellerA)).expect(404);
      await request(server()).post("/v1/seller/alerts/not-a-uuid/acknowledge").set(as(tokens.sellerA)).expect(400);

      const alerts = (await request(server()).get("/v1/seller/alerts").set(as(tokens.sellerA)).expect(200)).body;
      expect(alerts.find((a: { id: string }) => a.id === ids.atRisk).status).toBe("ACKNOWLEDGED");
      const other = await prisma.opportunity.findUniqueOrThrow({ where: { id: ids.otherCompany } });
      expect(other.alertStatus).toBe("PENDING");
    });

    it("lists customer risks as CustomerRisk[] with level and accent-insensitive search", async () => {
      const all = z.array(CustomerRiskSchema).parse((await request(server()).get("/v1/seller/risks").set(as(tokens.sellerA)).expect(200)).body);
      expect(all.map((r) => r.customerName)).toEqual(["María José Díaz", "Juan Pérez", "Ana Ruiz"]);
      expect(all[0]).toMatchObject({ riskLevel: "HIGH", reason: "Sin respuesta del negocio desde hace 5 h" });

      const high = (await request(server()).get("/v1/seller/risks").query({ level: "HIGH" }).set(as(tokens.sellerA)).expect(200)).body;
      expect(high.map((r: { customerName: string }) => r.customerName)).toEqual(["María José Díaz"]);
      const search = (await request(server()).get("/v1/seller/risks").query({ search: "maria diaz" }).set(as(tokens.sellerA)).expect(200)).body;
      expect(search).toEqual([]);
      const searchOne = (await request(server()).get("/v1/seller/risks").query({ search: "díaz" }).set(as(tokens.sellerA)).expect(200)).body;
      expect(searchOne.map((r: { customerName: string }) => r.customerName)).toEqual(["María José Díaz"]);
      await request(server()).get("/v1/seller/risks").query({ level: "EXTREME" }).set(as(tokens.sellerA)).expect(400);
    });

    it("never shows another company's data", async () => {
      const b = z.array(SellerAlertSchema).parse((await request(server()).get("/v1/seller/alerts").set(as(tokens.sellerB)).expect(200)).body);
      expect(b.map((a) => a.id)).toEqual([ids.otherCompany]);
    });
  });

  describe("admin", () => {
    it("lists AdminAlertRow[] with acknowledgement timestamps and returns AdminAlertDetail", async () => {
      const rows = z.array(AdminAlertRowSchema).parse((await request(server()).get("/v1/admin/alerts").set(as(tokens.adminA)).expect(200)).body);
      expect(rows.map((r) => r.id).sort()).toEqual([ids.atRisk, ids.answered].sort());
      const atRisk = rows.find((r) => r.id === ids.atRisk)!;
      expect(atRisk).toMatchObject({ customerName: "María José Díaz", sellerName: "Sin asignar", reason: "En riesgo: sin respuesta del negocio", status: "ACKNOWLEDGED" });
      expect(atRisk.acknowledgedAt).toEqual(expect.any(String));

      const detail = AdminAlertDetailSchema.parse((await request(server()).get(`/v1/admin/alerts/${ids.atRisk}`).set(as(tokens.adminA)).expect(200)).body);
      expect(detail.summary).toContain("María quiere reservar");
      await request(server()).get(`/v1/admin/alerts/${ids.otherCompany}`).set(as(tokens.adminA)).expect(404);
      await request(server()).get(`/v1/admin/alerts/${ids.waiting}`).set(as(tokens.adminA)).expect(404);
    });
  });

  describe("seller replies captured from WhatsApp coexistence echoes", () => {
    it("stores the business reply as OUTBOUND and the dashboard stops reporting it as unanswered", async () => {
      await request(server())
        .post("/webhooks/whatsapp")
        .send({
          object: "whatsapp_business_account",
          entry: [
            {
              id: "e2e-waba",
              changes: [
                {
                  field: "smb_message_echoes",
                  value: {
                    messaging_product: "whatsapp",
                    metadata: { display_phone_number: "51999888777", phone_number_id: PHONE_NUMBER_ID_A },
                    message_echoes: [
                      { from: "51999888777", to: ids.atRiskPhone, id: `wamid.echo-${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "¡Hola María! Te reservo el sábado." } },
                    ],
                  },
                },
              ],
            },
          ],
        })
        .expect(200);

      const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: ids.atRisk } });
      expect(await prisma.message.count({ where: { conversationId: opportunity.conversationId, direction: "OUTBOUND" } })).toBe(1);
      const rawEvent = await prisma.rawEvent.findFirstOrThrow({ where: { companyId: COMPANY_A }, orderBy: { receivedAt: "desc" } });
      expect(rawEvent.eventType).toBe("smb_message_echoes");

      const risks = (await request(server()).get("/v1/seller/risks").query({ search: "díaz" }).set(as(tokens.sellerA)).expect(200)).body;
      expect(risks[0].reason).toBe("Esperando respuesta del cliente");
    });
  });
});
