# Phase 11 — Backend API for the web app

**Status (2026-10-02):** backend side done. The UI switch (`DATA_SOURCE=http`) is pending and
owned by the frontend engineer. This document is the contract between the two.

Phase 11 in [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) says: implement `http.ts` per service,
flip `DATA_SOURCE` per domain, replace `MockAuthService` with real backend sessions. Everything
the backend needs for that is in place for **auth, alerts and risk**. **Reports and
notifications stay on mock** (see [What stays on mock](#what-stays-on-mock)).

---

## 1. Run the backend locally

```bash
pnpm install
cd apps/api
cp .env.example .env            # then set AUTH_JWT_SECRET (any random string, 32+ chars)
docker compose up -d            # Postgres (+ pgvector) and Redis
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev                        # http://localhost:3001
```

Seeded users (company "Clínica Demo"), same DNIs and names as `packages/mocks` `mockUsers`:

| DNI | Password | Name | Role |
|---|---|---|---|
| `12345678` | `keom-demo-2026` | Carlos Ramirez | SELLER |
| `87654321` | `keom-demo-2026` | Andrea Torres | ADMIN |

The password is a **local demo value** (override with `SEED_USER_PASSWORD` before seeding).
Never use the seed script for real environments.

To have alerts to look at, run the end-to-end demo once (`pnpm demo`, see
[`docs/DEMO.md`](./DEMO.md)): it creates conversations and opportunities for Clínica Demo.

## 2. How the web app talks to the API

```
Browser ──(cookie)──► Next.js server (Server Components / Server Actions)
                              │  Authorization: Bearer <token>
                              ▼
                         apps/api  /v1/*
```

- **Server-to-server only.** Services run on the Next.js server (as ARCHITECTURE.md Section H
  already requires). The browser never calls `apps/api` and never sees the API token, so the
  API has no CORS configuration on purpose.
- **Base URL:** a server-only env var, e.g. `API_BASE_URL=http://localhost:3001` (never
  `NEXT_PUBLIC_*`).
- **Auth flow:**
  1. `loginAction` calls `POST /v1/auth/login { dni, password }`.
  2. The response has `token`, `expiresAt` and `user` (`SessionUser`).
  3. Put `token` **inside the existing signed httpOnly session cookie** alongside
     `{ id, role }`, and set the cookie expiry to `expiresAt` (12h by default).
  4. Every `http.ts` service reads the token from the session on the server and sends
     `Authorization: Bearer <token>`.
  5. On `401` from any `/v1` call: clear the session and redirect to `/login`.
- **The API is the real authorization.** It verifies the token on every call, re-reads the
  user from the database (a deleted user or changed role takes effect immediately), checks the
  role, and scopes every query to the user's company. The web app's proxy/layout checks stay as
  the UX gate described in ARCHITECTURE.md Section I.

## 3. Changes the UI needs

| Change | Why |
|---|---|
| `packages/contracts` `LoginRequestSchema`: add `password: z.string().min(1)` | The real API needs a password; DNI alone would let anyone who knows a DNI in. |
| Login form: add a password field | Same. |
| `AuthService.login(dni)` → `login(dni, password)`; add `HttpAuthService` | Calls `POST /v1/auth/login`; keep `MockAuthService` for `DATA_SOURCE=mock` (it can ignore the password). |
| Session cookie also stores the API `token` | Needed for `Authorization: Bearer` (see §2). |
| `HttpAlertsService`, `HttpRiskService` | Endpoints below; the existing interfaces are unchanged — no `sellerId` parameter is needed because the API takes identity from the token. |
| Map HTTP errors to `ServiceError` codes | `401` → `UNAUTHORIZED`, `403` → `UNAUTHORIZED` (role), `404` → `NOT_FOUND`, `400`/`5xx`/network → `UPSTREAM_ERROR`. |

`LoginResponseSchema` and `SessionUserSchema` don't change: the API's `user` matches
`SessionUser` exactly (`token`/`expiresAt` are extra fields, which Zod object parsing allows).

## 4. Endpoint reference

All responses are JSON. Errors use Nest's default body: `{ "statusCode": 404, "message": "...", "error": "Not Found" }`.

### Auth

| Method | Path | Auth | Body / query | Response |
|---|---|---|---|---|
| POST | `/v1/auth/login` | — | `{ dni, password }` | `200 { token, expiresAt, user: SessionUser }` |
| GET | `/v1/auth/me` | Bearer | — | `200 SessionUser` |

Login errors: `400` missing fields · `401 "Invalid credentials"` (same message for unknown
DNI and wrong password) · `429` more than 5 attempts for the same DNI in a minute ·
`503` auth not configured on the server (`AUTH_JWT_SECRET` missing).

### Seller (`role: SELLER`)

| Method | Path | Response | Maps to |
|---|---|---|---|
| GET | `/v1/seller/alerts` | `200 SellerAlert[]` | `AlertsService.listSellerAlerts()` |
| POST | `/v1/seller/alerts/:alertId/acknowledge` | `204` | `AlertsService.acknowledgeAlert(alertId)` |
| GET | `/v1/seller/risks?search=&level=HIGH\|MEDIUM\|LOW` | `200 CustomerRisk[]` | `RiskService.listCustomerRisks(filters)` |

### Admin (`role: ADMIN`)

| Method | Path | Response | Maps to |
|---|---|---|---|
| GET | `/v1/admin/alerts` | `200 AdminAlertRow[]` | `AlertsService.listAdminAlerts()` |
| GET | `/v1/admin/alerts/:alertId` | `200 AdminAlertDetail`, `404` if not found | `AlertsService.getAdminAlertDetail(alertId)` (return `null` on 404) |

Common errors on every `/v1` data endpoint: `401` missing/invalid/expired token · `403` wrong
role · `400` malformed id or filter · `503` auth not configured.

Every response is validated in the backend's e2e tests with the **same `@keom/contracts` Zod
schemas** the web app's `http-client` will use (`apps/api/test/dashboard.e2e-spec.ts`).

### Example

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"dni":"12345678","password":"keom-demo-2026"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s http://localhost:3001/v1/seller/alerts -H "Authorization: Bearer $TOKEN"
```

```json
[
  {
    "id": "ca5617f6-edf0-4697-ab5c-da7eb184e993",
    "customer": { "id": "1eff37cb-…", "firstName": "Andrea", "lastName": "", "phone": "+51954854083" },
    "priority": "HIGH",
    "summary": "Andrea preguntó precios, consultó disponibilidad, quiere reservar y preguntó por formas de pago. Sin respuesta del negocio desde hace 57 min. La oportunidad está en riesgo.",
    "requiredAction": "Ofrecer un horario disponible.",
    "createdAt": "2026-10-02T23:16:44.831Z",
    "status": "PENDING",
    "whatsappUrl": "https://wa.me/51954854083"
  }
]
```

## 5. Where each field comes from

An **alert** is an active opportunity whose latest recommended action (M2A) is not `WAIT`.
`alertId` is the opportunity id. All text is Spanish, generated deterministically from M2A's
results and message timestamps (`apps/api/src/dashboard/presentation.ts`) — no LLM.

| Contract field | Source |
|---|---|
| `SellerAlert.priority`, `CustomerRisk.riskLevel` | M2A priority / risk |
| `SellerAlert.summary` | Customer's signals ("preguntó precios", "quiere reservar"…) + who owes a reply + "en riesgo" when state is `AT_RISK` |
| `SellerAlert.requiredAction`, `CustomerRisk.nextBestAction` | M2A next best action, as Spanish text (`OFFER_APPOINTMENT` → "Ofrecer un horario disponible.") |
| `SellerAlert.status`, `AdminAlertRow.acknowledgedAt` | New alert status on the opportunity (`PENDING` → `ACKNOWLEDGED`) |
| `customer.firstName` / `lastName`, `customerName` | WhatsApp profile name, split at the first space (`lastName` can be `""`) |
| `customer.phone`, `whatsappUrl` | The customer's WhatsApp number (`+51…`, `https://wa.me/51…`) |
| `AdminAlertRow.reason` | M2A state: "En riesgo: sin respuesta del negocio", "Alta intención de compra", "Interés comercial", "Nueva oportunidad" |
| `CustomerRisk.riskScore` | M2A's 0–100 **commercial score** (urgency/value of the opportunity). The contract calls it "risk score"; treat it as "importance", not probability of loss. |
| `CustomerRisk.reason` | "Sin respuesta del negocio desde hace 2 h", "Esperando respuesta del cliente" or "Sin actividad reciente" |
| `CustomerRisk.lastActivityAt` | Latest message in the conversation, either direction |

Ordering: seller alerts by priority, then risk, then newest; admin alerts newest first; risks
by risk level, then score. Seller alerts exclude `COMPLETED`; admin alerts include every status.

## 6. What stays on mock

| Domain | Why | When |
|---|---|---|
| **reports** (`ReportsService`) | Needs outcomes (won/lost/recovered) and revenue, which KEOM doesn't track yet | After outcomes are modeled |
| **notifications** (`NotificationsService`, push subscription) | Push notifications are M5 | M5 |

Keep `DATA_SOURCE=mock` for those two; switch **auth**, **alerts** and **risk** to `http`.

## 7. Known limitations (backend)

- **No seller assignment yet:** every seller of a company sees all its alerts; admin rows show
  `sellerName: "Sin asignar"`.
- **Fields not populated:** `opportunityValue`, `treatment`, `avatarUrl` (optional in the
  contracts; KEOM has no data for them).
- **Alert status is forward-only** (`PENDING` → `ACKNOWLEDGED`). There is no "complete" endpoint
  yet; completing alerts and reopening rules are M5.
- **Lists are capped** at the 500 most recently updated opportunities per company (no pagination).
- **Spanish only.**
- **Seller replies** are captured from WhatsApp coexistence echoes (business number used in both
  the WhatsApp Business app and the Cloud API). Without coexistence, KEOM can't see replies and
  alerts will say "Sin respuesta del negocio" even when the seller answered.
- Opportunities last evaluated before M4 have no stored signals, so their summary reads "inició
  una conversación" until their next evaluation. Only affects old local data.
- `/dev/*` endpoints are unauthenticated and are **not** for the web app; they will be disabled
  in production hardening (Phase 12).

## 8. Backend configuration

```
AUTH_JWT_SECRET=                     # required for /v1; random, 32+ characters, never committed
AUTH_TOKEN_TTL_MINUTES=720           # optional, default 12h
AUTH_LOGIN_MAX_ATTEMPTS_PER_MINUTE=5 # optional, per DNI
```

Implementation: `apps/api/src/auth` (login, token, guard), `apps/api/src/dashboard` (read
models, Spanish presentation, acknowledge), `apps/api/prisma/schema.prisma` (`User`,
`Opportunity.alertStatus`). Details: [`apps/api/README.md`](../apps/api/README.md), Phase 11
section.
