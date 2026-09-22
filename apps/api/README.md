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
exists, otherwise creates a new one — **but only if the request carries at least one
commercial signal.** `OpportunitiesService.evaluate()` returns `null` (no-op, nothing
read/written beyond the initial lookup) when there is no active Opportunity for the
conversation *and* zero signals were supplied — e.g. an M2B interpretation of "hola" or
"gracias" must not spawn an empty Opportunity. An *existing* active Opportunity is still
reevaluated even with zero signals (safe reevaluation, e.g. settles into `NEW`/`LOW`) —
only *creation* requires evidence. No intent/topic matching — this is intentionally
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

If there is no active Opportunity for the conversation and `signals` is empty, the
endpoint instead returns `{ "noOp": true, "reason": "..." }` — nothing is created.

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

## Milestone 2B — LLM Commercial Interpretation Layer

M2B scope: persisted conversation messages → bounded Context Builder → LLM
(`CommercialInterpreter`) → structured commercial interpretation → runtime (Zod)
validation → mapped straight into the **unchanged** M2A input contract →
`OpportunitiesService.evaluate()` → persisted result. **Core rule: the LLM interprets,
M2A decides** — nothing in this milestone computes score/priority/state/risk/
nextBestAction; that logic lives entirely in `OpportunityEngineService` (M2A) and was not
touched. No RAG (the LLM never retrieves business knowledge — "¿cuánto cuesta?" always
maps to `PRICING_REQUESTED`, never to an actual price), no Redis/BullMQ, no outbound
WhatsApp, no frontend changes.

### Architecture

```
Conversation (persisted Messages)
        ↓
src/interpretation/context-builder.service.ts   (bounded, deterministic context)
        ↓
src/llm/  (CommercialInterpreter abstraction, provider-agnostic)
  └─ OpenAiCommercialInterpreter                (only concrete implementation)
        ↓
Zod validation (src/llm/commercial-interpretation.schema.ts) — the actual gate,
regardless of what the provider's response_format claims to guarantee
        ↓
src/interpretation/interpretation.mapper.ts     (thin: interpretation -> M2A input)
        ↓
OpportunitiesService.evaluate()                 (unchanged M2A engine + persistence)
```

`src/llm/` knows nothing about Prisma, Nest controllers, or conversations — it only
implements `CommercialInterpreter.interpret(context): Promise<CommercialInterpretation>`.
`src/interpretation/` is the only new orchestration layer; it depends on the
`COMMERCIAL_INTERPRETER` DI token (the interface), never on `OpenAiCommercialInterpreter`
directly, so a future provider (e.g. Anthropic) is a new class in `src/llm/`, not a
rewrite of the orchestration.

**M2A adjustment made alongside M2B (small, documented):** `OpportunitiesService.evaluate()`
now returns `null` (no-op — nothing read/written beyond the initial lookup) when there is
no active Opportunity for the conversation *and* zero commercial signals were supplied.
This matters specifically because of M2B: an interpretation of "hola" or "gracias" (intent
`OTHER`, no signals) must not spawn an empty Opportunity. An *existing* active Opportunity
is still safely reevaluated even with zero signals. See the M2A section above for the
updated resolution rule and `OpportunitiesController`'s `{ noOp: true }` response shape.

### LLM provider abstraction & environment

```ts
// src/llm/commercial-interpreter.ts
interface CommercialInterpreter {
  interpret(context: CommercialContext): Promise<CommercialInterpretation>;
}
```

Bound via the `COMMERCIAL_INTERPRETER` DI token in `src/llm/llm.module.ts`. Provider,
model, API key, and timeout are **entirely environment-driven** (see `.env.example`) —
never hardcoded in `InterpretationService`, the mapper, or anywhere in business logic:

```
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini      # any cheap structured-extraction model; not a reasoning model
OPENAI_API_KEY=
LLM_TIMEOUT_MS=10000
```

Config is resolved **lazily**, inside `OpenAiCommercialInterpreter.interpret()` (via
`src/llm/llm.config.ts`), not at app bootstrap — the API still starts and M1/M2A still
work with zero LLM env vars set; only an actual interpretation call fails, safely, if
config is missing or invalid. No secret is ever committed — `.env` is git-ignored,
`.env.example` carries placeholders only (confirmed: `git check-ignore -v apps/api/.env`
resolves via the root `.gitignore`).

### Structured output & validation

```ts
{
  intent: "BOOKING" | "PRICING" | "INFORMATION" | "PURCHASE" | "OTHER",
  interestLevel: "LOW" | "MEDIUM" | "HIGH",     // reused from opportunities.types.ts
  signals: SignalType[],                         // reused, no competing enum
  entities: { requestedDate?, requestedTime?, serviceName?, productName? },
  confidence: number,                            // 0-1, one overall value per call
}
```

Validated by `CommercialInterpretationSchema` (Zod) immediately after the provider
responds — malformed JSON, an unsupported/invented signal value, or a missing field never
reaches the mapper or `OpportunitiesService`. **`intent` and `entities` are not
persisted** (no Prisma columns added) — they're returned in the dev endpoint response and
logged for observability only. Product can justify persisting selected entities later;
M2B deliberately doesn't build that now. `confidence` is applied uniformly to every
`OpportunitySignal` row created from a given interpretation call (no per-signal
confidence yet). `sourceMessageId` on those rows is the conversation's latest inbound
message — the LLM doesn't attribute individual signals to individual messages.

Uses OpenAI's `response_format: { type: "json_object" }` (JSON mode), not strict
provider-side `json_schema` mode — this avoids an extra schema-conversion dependency for
M2B. The Zod schema above is the real validation boundary regardless of what the
provider's own mode claims to guarantee, and the design stays provider-agnostic (nothing
about `json_object` mode is OpenAI-specific in the orchestration layer).

### Context Builder strategy

Given a `conversationId`: fetch the last **10** messages (oldest-first for the prompt),
each capped at 1000 chars. No prior signals, no current Opportunity state, no full
history is sent — bounded, deterministic for a given DB snapshot, and cheap. The same
message set is reused (not re-queried) to derive `lastInboundAt`/`lastOutboundAt`/
`lastInboundMessageId` for the M2A call.

### Prompt

System prompt (fixed, not env-driven): instructs the model to extract only observable
commercial meaning, never answer the customer, never invent business facts, never compute
priority/risk/state/action, use only the 9 supported signal values, omit a signal rather
than guess when uncertain, and return only the JSON schema — no chain-of-thought. See
`src/llm/prompt.ts` for the exact text. User content is the rendered
`[CUSTOMER] .../[BUSINESS] ...` transcript.

### Mapping to M2A

`mapInterpretationToOpportunityInput()` (`src/interpretation/interpretation.mapper.ts`) is
intentionally thin: `interestLevel` and `signals` pass straight through
(`NO_LONGER_INTERESTED`/`OBJECTION` reach M2A's existing override/rules untouched), each
signal gets the call's one `confidence` value and the latest inbound message's id, and
`lastInboundAt`/`lastOutboundAt` come from the Context Builder. No business logic lives
in the mapper.

### Failure handling

`InterpretationError` (with a `code`) covers: `MISSING_CONFIG`/`INVALID_CONFIG` (bad/absent
env), `PROVIDER_TIMEOUT`, `PROVIDER_ERROR` (any other SDK/API error), `EMPTY_RESPONSE`,
`INVALID_OUTPUT` (non-JSON or schema-invalid). It's always thrown **before**
`OpportunitiesService.evaluate()` is reached, so any interpretation failure is inherently
a no-mutation failure — nothing is read/written to `Opportunity`/`OpportunitySignal`/etc.
`InterpretationController` maps these to `503`/`504`/`502` respectively; a
nonexistent `conversationId` surfaces as `404` from the Context Builder.

### Testing this milestone locally

```bash
pnpm --filter @keom/api test                                   # unit: llm + interpretation + existing M1/M2A suites
pnpm --filter @keom/api test:e2e                                # e2e: needs Postgres; CommercialInterpreter is DI-overridden with a mock — no real LLM calls
```

### Manual/demo testing with a real LLM (optional)

Automated tests never call a real provider. To try it against the real OpenAI API:

```bash
export LLM_PROVIDER=openai
export LLM_MODEL=gpt-4o-mini
export OPENAI_API_KEY=<your local key, never commit this>
```
(or set them in `apps/api/.env`, which is git-ignored)

Then, with a real ingested conversation (see the M1 section above for how to get a real
`conversationId` via the fixture webhook):

```bash
curl -X POST http://localhost:3001/dev/interpretation/evaluate \
  -H "Content-Type: application/json" \
  -d '{ "conversationId": "<conversation-id>" }'
```

Expected response shape:

```json
{
  "interpretation": {
    "intent": "BOOKING",
    "interestLevel": "HIGH",
    "signals": ["BOOKING_INTENT", "AVAILABILITY_REQUESTED"],
    "entities": { "requestedDate": "sábado" },
    "confidence": 0.87
  },
  "opportunity": {
    "opportunityId": "...",
    "state": "HIGH_INTENT",
    "priority": "HIGH",
    "risk": "LOW",
    "nextBestAction": "OFFER_APPOINTMENT",
    "score": 90,
    "scoreBreakdown": ["..."],
    "reasons": { "state": "...", "risk": "...", "action": "..." },
    "isActive": true
  }
}
```

If there's no active Opportunity and the interpretation finds no signals, `opportunity`
is instead `{ "noOp": true, "reason": "..." }`.

### Not in M2B (future milestones)

**M3:** business knowledge, documents, chunks, embeddings, pgvector, retrieval, RAG.
**Later:** Redis/BullMQ, scheduled/periodic reevaluation, notifications, human approval,
outbound WhatsApp, recovered opportunities/revenue.

---

Consumes `@keom/mocks` for the WhatsApp fixture. `@keom/contracts` remains the
FE↔BE contract surface for `apps/web`-facing endpoints (not used by this webhook,
which has no frontend consumer) — see `docs/ARCHITECTURE.md` Section A for the plan
to generate types from this API's OpenAPI spec once that surface stabilizes.

See the root [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for full context on
how this app fits into the monorepo.
