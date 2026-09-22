# apps/api

KEOM backend (NestJS + PostgreSQL + Prisma), owned by the backend developer.

## Milestone 1 — WhatsApp Ingestion Foundation

M1 scope: Meta WhatsApp webhook → validation/parsing → tenant (Company) resolution →
RawEvent persisted → payload normalized → Customer found/created → Conversation
found/created → Message persisted. Nothing past persisted `Message` (no Opportunity
engine, no queues, no LLM/RAG, no outbound messaging) — those are later milestones.

### Architecture

```
Meta WhatsApp Webhook Payload
        ↓
src/whatsapp   (Meta-specific: schema validation + normalizer, isolated here)
        ↓
NormalizedEntry / NormalizedMessage   (src/ingestion/types.ts, provider-independent)
        ↓
src/ingestion  (tenant resolution, find/create Customer+Conversation, persist Message)
```

`src/ingestion` never imports anything from `src/whatsapp` — it only accepts the
normalized shape, so a future second provider plugs in without touching this layer.

### Local setup

1. **Start PostgreSQL:**
   ```bash
   docker compose up -d
   ```
2. **Install deps** (from the repo root):
   ```bash
   pnpm install
   ```
3. **Env vars:**
   ```bash
   cp .env.example .env
   ```
4. **Run migrations:**
   ```bash
   pnpm --filter @keom/api prisma:migrate
   ```
5. **Seed demo data** (Clínica Demo company + WhatsApp Integration):
   ```bash
   pnpm --filter @keom/api prisma:seed
   ```
6. **Start the API:**
   ```bash
   pnpm --filter @keom/api dev
   ```
   Listens on `http://localhost:3001` (`PORT` in `.env`).

### Testing the webhook locally

The fixture (`@keom/mocks` → `receivedTextMessageWebhook`) uses the same
`phoneNumberId` the seed script assigns to the Clínica Demo Integration, so posting
it resolves to that company end-to-end through the real parsing/normalization/
persistence path — no separate fake ingestion system.

```bash
curl -X POST http://localhost:3001/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "102290129340398",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "51999888777", "phone_number_id": "109876543210987" },
        "contacts": [{ "profile": { "name": "Andrea Torres" }, "wa_id": "51987654321" }],
        "messages": [{
          "from": "51987654321",
          "id": "wamid.HBgLNTE5ODc2NTQzMjEVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
          "timestamp": "1758000000",
          "type": "text",
          "text": { "body": "Hola, ¿cuánto cuesta y tienen disponibilidad el sábado?" }
        }]
      },
      "field": "messages"
    }]
  }]
}
EOF
```

POSTing the same payload again returns `200` again but does **not** create a second
`Message` row (idempotent on `[companyId, externalMessageId]`).

Inspect rows via Prisma Studio:
```bash
pnpm --filter @keom/api prisma:studio
```

### Tests

```bash
pnpm --filter @keom/api test        # unit: normalizer + ingestion service
pnpm --filter @keom/api test:e2e    # e2e: real Postgres required (docker compose up -d + migrate first)
```

### Not in M1 (future milestones)

Redis/BullMQ/queues, LLM/RAG/embeddings, Opportunity entity/engine, intent/signal
detection, scoring/risk/priority, Next Best Action, outbound WhatsApp messaging,
production Meta signature verification (`X-Hub-Signature-256`) — the `GET
/webhooks/whatsapp` handshake stub exists but isn't wired to a real Meta app yet.

---

## Milestone 2A — Deterministic Opportunity Engine Foundation

M2A scope: `Opportunity` resolution → deterministic commercial signals in → deterministic
rules (score → priority → state → risk → next best action) → persisted result, with state
changes and recommendation changes tracked as history. **Fully deterministic — no LLM, no
AI SDK, no prompt engineering anywhere in this milestone.** Signals are supplied as
structured input (fixture/dev endpoint/test), not inferred from `Message.text` — that
inference step is M2B.

### Architecture

```
Structured input: { interestLevel, signals[] }
        ↓
src/opportunities/opportunities.controller.ts   (dev-only POST /dev/opportunities/evaluate)
        ↓
OpportunitiesService                            (resolve/create Opportunity, persist)
        ↓
OpportunityEngineService                        (pure, deterministic: score → priority →
                                                  state → risk → next best action)
        ↓
Opportunity / OpportunitySignal / OpportunityStateHistory / ActionRecommendation
```

`OpportunityEngineService` has no Prisma/Nest dependency beyond `@Injectable()` — it's a
pure function of its input, unit-tested standalone. `OpportunitiesService` is the only
layer that talks to Postgres, mirroring the `whatsapp` (parsing) vs. `ingestion`
(persistence) split from M1. Nothing in `src/ingestion` or `src/whatsapp` was changed —
M2A does not currently wire ingested messages into the engine.

### Domain model (Prisma)

- **`Opportunity`** — `state` (`NEW | ENGAGED | HIGH_INTENT | AT_RISK`), `priority`,
  `risk`, `interestLevel` (`LOW | MEDIUM | HIGH` each), `score` (0–100), `isActive`,
  `lastEvaluatedAt`.
- **`OpportunitySignal`** — one row per signal supplied on an evaluation call (`type`,
  optional `confidence`, optional `sourceMessageId`).
- **`OpportunityStateHistory`** — one row **only when the state actually changes**;
  reevaluating to the same state does not insert a row.
- **`ActionRecommendation`** — one row **only when the recommended action changes**
  from the latest one for that Opportunity.

**Opportunity resolution (MVP simplification, documented deliberately):** there is no
DB-level "one Opportunity per Conversation" constraint. `OpportunitiesService` reuses the
most recently updated `isActive: true` Opportunity for the given `conversationId` if one
exists, otherwise creates a new one. No intent/topic matching — this is intentionally
simple for M2A and leaves room for multiple (sequential or, later, concurrent)
opportunities per conversation. E.g.: a `NO_LONGER_INTERESTED` evaluation deactivates the
current Opportunity; a later re-engagement on the same conversation creates a fresh one
rather than reopening the old one.

**`NO_LONGER_INTERESTED` is an explicit override, not just a scoring weight:** it
contributes a negative score entry (-30, for explainability in the breakdown) *and*
unconditionally forces `priority: LOW`, `risk: LOW`, `nextBestAction: WAIT`, and
deactivates the Opportunity (`isActive: false`). M2A's state model has no terminal
lifecycle state (`WON`/`LOST`/`RECOVERED`) — deactivation is the MVP substitute. A later
milestone should introduce a real terminal state once outcomes are tracked.

### Deterministic rules

- **Signals** (`SignalType`): `PRICING_REQUESTED` (+15), `AVAILABILITY_REQUESTED` (+25),
  `BOOKING_INTENT` (+30), `PURCHASE_INTENT` (+30), `QUOTE_REQUESTED` (+20),
  `PAYMENT_QUESTION` (+20), `FOLLOW_UP_REQUESTED` (+10), `OBJECTION` (-15),
  `NO_LONGER_INTERESTED` (-30 + hard override, see above).
- **Score**: sum of signal weights + `interestLevel` contribution (`LOW +0 / MEDIUM +10 /
  HIGH +20`), clamped to `[0, 100]`.
- **Priority**: `0–39 LOW`, `40–69 MEDIUM`, `70–100 HIGH`.
- **State**: `NEW` (no signals) → `ENGAGED` (any commercial signal) → `HIGH_INTENT`
  (`BOOKING_INTENT`/`PURCHASE_INTENT` + `HIGH` priority). `AT_RISK` takes precedence over
  `ENGAGED`/`HIGH_INTENT` whenever risk resolves to `HIGH`.
- **Risk** — evaluated synchronously from `lastInboundAt`/`lastOutboundAt` on the request,
  **no scheduler/background worker in M2A**: `HIGH` only if interest/priority is `HIGH`,
  there's an inbound message with no later outbound reply, and the elapsed time exceeds a
  fixed threshold (4h `HIGH`, 1h `MEDIUM`). A future milestone can call
  `OpportunitiesService.evaluate`/`OpportunityEngineService.evaluate` periodically (e.g.
  from a BullMQ worker) — that scheduling is explicitly out of scope here.
- **Next Best Action** — first-match ordered rules: `OBJECTION` → `ESCALATE_TO_HUMAN`;
  `BOOKING_INTENT` + `AVAILABILITY_REQUESTED` → `OFFER_APPOINTMENT`; `HIGH` priority +
  `HIGH` risk → `FOLLOW_UP`; `PRICING_REQUESTED`/`QUOTE_REQUESTED` → `SEND_INFORMATION`;
  `PAYMENT_QUESTION` → `ASK_QUESTION`; `FOLLOW_UP_REQUESTED` → `FOLLOW_UP`; low
  priority/risk with no signals → `WAIT`; otherwise → `RESPOND`.

Every output includes a human-readable reason (`stateReason`, `riskReason`,
`actionReason`) and the score carries a full per-signal breakdown — this is what
"signals are inputs, rules make decisions" means in practice: nothing here is a black box.

### Testing this milestone locally

```bash
pnpm --filter @keom/api test                                   # unit: engine + service
pnpm --filter @keom/api test:e2e                                # e2e: needs Postgres (see M1 setup)
```

### Manual/demo testing (no LLM, no queue, no worker)

1. Follow the M1 local setup above (Postgres up, migrations run, seed run).
2. Post the M1 fixture webhook (see the M1 section) to get a real `companyId`/
   `customerId`/`conversationId` from actual ingestion, or read them via
   `pnpm --filter @keom/api prisma:studio`.
3. Call the dev-only evaluation endpoint (not a production ingestion path, no auth):

```bash
curl -X POST http://localhost:3001/dev/opportunities/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "<company-id>",
    "customerId": "<customer-id>",
    "conversationId": "<conversation-id>",
    "interestLevel": "HIGH",
    "signals": [
      { "type": "PRICING_REQUESTED" },
      { "type": "AVAILABILITY_REQUESTED" },
      { "type": "BOOKING_INTENT" }
    ]
  }'
```

Expected response shape:

```json
{
  "opportunityId": "...",
  "state": "HIGH_INTENT",
  "priority": "HIGH",
  "risk": "LOW",
  "nextBestAction": "OFFER_APPOINTMENT",
  "score": 90,
  "scoreBreakdown": [{ "signal": "PRICING_REQUESTED", "points": 15 }, "..."],
  "reasons": { "state": "...", "risk": "...", "action": "..." },
  "isActive": true
}
```

Posting the same `conversationId` again reuses the same active Opportunity (no duplicate
row) unless the previous evaluation deactivated it (`NO_LONGER_INTERESTED`), in which case
a new Opportunity is created for that conversation.

### Not in M2A (future milestones)

**M2B:** inferring `interestLevel`/`signals` from `Message.text` via an LLM, instead of
supplying them as structured input.
**M3:** business knowledge, embeddings, pgvector, RAG.
**Later:** Redis/BullMQ/Kafka, scheduled/periodic risk reevaluation, notifications,
outbound WhatsApp messaging, seller approval / human escalation workflows, recovered
revenue, payment/calendar/CRM integrations, analytics dashboards.

---

Consumes `@keom/mocks` for the WhatsApp fixture. `@keom/contracts` remains the
FE↔BE contract surface for `apps/web`-facing endpoints (not used by this webhook,
which has no frontend consumer) — see `docs/ARCHITECTURE.md` Section A for the plan
to generate types from this API's OpenAPI spec once that surface stabilizes.

See the root [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for full context on
how this app fits into the monorepo.
