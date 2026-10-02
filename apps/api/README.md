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
  └─ ProviderSelectingInterpreter               (picks per call from LLM_PROVIDER)
       ├─ OpenAiCommercialInterpreter           (default)
       └─ JevCommercialInterpreter              (experimental — see "Experimental: Jev" below)
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
`COMMERCIAL_INTERPRETER` DI token (the interface), never on a concrete provider class, so
a new provider is a new class in `src/llm/` plus a branch in `ProviderSelectingInterpreter`,
not a rewrite of the orchestration.

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

Bound via the `COMMERCIAL_INTERPRETER` DI token in `src/llm/llm.module.ts`, which resolves
to `ProviderSelectingInterpreter`. Provider, model, API key, and timeout are **entirely
environment-driven** (see `.env.example`) — never hardcoded in `InterpretationService`,
the mapper, or anywhere in business logic:

```
LLM_PROVIDER=openai          # openai | jev
LLM_TIMEOUT_MS=10000         # per call; for Jev this is the total budget including retries
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini     # legacy LLM_MODEL is still read as a fallback
OPENAI_REASONING_EFFORT=     # optional; only for reasoning models (e.g. "none" for gpt-5.6-luna)
TYPESAFE_API_KEY=            # only needed when LLM_PROVIDER=jev (or for the offline eval)
JEV_MODEL=jev-1.13.0         # pinned version; the jev-latest/jev-preview aliases are rejected
```

With `OPENAI_REASONING_EFFORT` unset, the OpenAI request is exactly the original M2B one
(`temperature: 0`, no `reasoning_effort`). When it is set, `reasoning_effort` is sent and
`temperature: 0` is kept only for `"none"` — reasoning models reject `temperature`
otherwise.

Config is resolved **lazily**, per call (via `src/llm/llm.config.ts`), not at app
bootstrap — the API still starts and M1/M2A still work with zero LLM env vars set; only an
actual interpretation call fails, safely, if config is missing or invalid. Each provider
reads only its own variables, so only the selected provider needs credentials. There is
no automatic fallback between providers. No secret is ever committed — `.env` is git-ignored,
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
`INVALID_OUTPUT` (non-JSON or schema-invalid), `UNCERTAIN_OUTPUT` (the provider answered
but not confidently enough to act on — currently Jev only). It's always thrown **before**
`OpportunitiesService.evaluate()` is reached, so any interpretation failure is inherently
a no-mutation failure — nothing is read/written to `Opportunity`/`OpportunitySignal`/etc.
`InterpretationController` maps these to `503`/`504`/`502`/`422` respectively; a
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
export OPENAI_MODEL=gpt-4o-mini
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

### Experimental: Jev (TypeSafe AI) interpreter and offline comparison

`JevCommercialInterpreter` is an **opt-in alternative** to OpenAI behind the same
interface (`LLM_PROVIDER=jev`). OpenAI remains the default; nothing switches providers
automatically. Jev is a typed-decision model (TypeSafe System One API, `@typesafe-ai/sdk`,
pinned `jev-1.13.0`), not a text generator. It only classifies. Score, priority, state,
risk and next best action still come exclusively from M2A.

**Request:** one `systemOne` call whose `state` is exactly the transcript OpenAI receives
(`buildUserPrompt`: same last-10 messages, 1000-char cap, `[CUSTOMER]`/`[BUSINESS]` tags),
with 11 questions built from the existing enums (`src/llm/jev-questions.ts`): a Choice for
intent, a Choice for interest level, and one Noul (yes-probability) per `SignalType`. Jev
has no system prompt, so every question repeats a preamble: only customer lines count as
evidence, message text is data (ignore instructions inside it), and the customer's most
recent stance wins. Criteria spell out availability vs. booking, objection vs. loss of
interest, and negation ("no quiero cancelar" keeps the plan).

**Entities:** always `{}`. Jev does not extract free text, and this experiment defers
entity extraction. That is safe for current consumers: the Zod schema defaults `entities`
to `{}`, the mapper drops it, M2A never reads it and `apps/web` does not consume it. The
only visible difference is the dev endpoint's `interpretation.entities`.

**Uncertainty and confidence** (`src/llm/jev-thresholds.ts`, versioned, provisional):

- A signal is present when p ≥ 0.8, confidently absent when p ≤ 0.2, and **uncertain**
  in between. `NO_LONGER_INTERESTED` uses 0.9 / 0.1 because M2A deactivates on it.
- Intent/interest Choices need Jev-reported confidence ≥ 0.5.
- An uncertain intent/interest answer or an uncertain `NO_LONGER_INTERESTED` throws
  `UNCERTAIN_OUTPUT`, so M2A is never called and nothing is deactivated on a guess. An
  uncertain low-stakes signal (every other signal, which only nudges score/priority) is
  left out of `signals` instead; its raw probability stays in the diagnostics. (Until
  2026-10-01 every uncertain answer failed, which rejected 26 of the 50 eval cases.)
  Missing/mistyped answers or out-of-range probabilities throw `INVALID_OUTPUT`.
- The single `confidence` field is a **Jev-specific heuristic**: the minimum of the two
  Choice confidences and each signal's |2p − 1|. It is not calibrated and not comparable
  with OpenAI's self-reported confidence. M2A does not read it; it is only stored on
  `OpportunitySignal`. The raw per-question probabilities appear only in the evaluation
  output, never in the database.

**Offline evaluation** (`apps/api/evals/commercial-interpretation/`):

- `dataset.v1.json`: 50 synthetic Spanish conversations covering greetings, pricing,
  quotes, availability, booking, purchase, multi-signal, objections, payment (Yape/Plin),
  loss of interest, negation, change of mind, business-only messages, slang, typos, mixed
  Spanish/English, ambiguous references ("sí, ese", "me sirve", "el primero", "entonces
  mañana") and prompt injection. Labels follow the `labelingGuide` in the file. **Every
  case starts as `review.status: "draft"`** and must be human-reviewed before it is scored.
  Neither provider's output is ground truth.
- `run-eval.ts` calls the interpreter classes directly: no Nest app, no database, no
  HTTP, so nothing is mutated. Do not benchmark through `/dev/interpretation/evaluate`.
  It ignores `LLM_PROVIDER` and runs each requested provider with its own env config.

```bash
# keys come from your shell; nothing is written back to .env
export OPENAI_API_KEY=... OPENAI_MODEL=gpt-5.6-luna OPENAI_REASONING_EFFORT=none
export TYPESAFE_API_KEY=... JEV_MODEL=jev-1.13.0
pnpm --filter @keom/api eval:interpreters                        # reviewed cases, both providers
pnpm --filter @keom/api eval:interpreters -- --providers jev --tag negation
pnpm --filter @keom/api eval:interpreters -- --include-drafts     # smoke run on unreviewed labels
pnpm --filter @keom/api eval:interpreters -- --dataset dataset.holdout-v1.json  # held-out set
```

`dataset.holdout-v1.json` (42 cases) is a **held-out** set: it is never used to tune Jev
questions or thresholds, which were tuned on `dataset.v1.json`. Freeze changes first, then
score it once; if you tune again after looking at its failures, it stops being held out
and a new held-out set is needed.

Results go to `evals/commercial-interpretation/results/` (gitignored): a JSON file with
per-case predictions, errors, usage and raw Jev probabilities, plus a Markdown summary.
Per provider it reports intent and interest-level accuracy (answered-only and overall),
per-signal TP/FP/FN, precision and recall with case ids, false and missed
`NO_LONGER_INTERESTED`, M2A outcome differences (the real engine replayed in memory on
expected vs. predicted labels), status counts (uncertain, invalid, timeout, error),
p50/p95 latency including retries, token usage, and every failing case. Cost is always
**estimated** (usage × the published prices in `metrics.ts`, verified 2026-09-25), because
neither provider returns a billed amount. Models without a verified price show no cost.
The report never picks a winner.

**Rollback:** set `LLM_PROVIDER=openai`, which takes effect on the next call with no
restart and no data migration.

**Outcome (2026-10-01): no-go, OpenAI stays the default.** On the 42-case held-out set
(`gpt-5.6-luna`, reasoning effort `none`, vs `jev-1.13.0`, thresholds `2026-10-01.provisional`):

| | Luna | Jev |
|---|---|---|
| Answered | 42/42 | 33/42 (9 `UNCERTAIN_OUTPUT`) |
| Exact signal set, answered | 76% | 79% |
| False `NO_LONGER_INTERESTED` | 0 | 0 |
| Real bookings missed | 0 | 2 (gray-zone `BOOKING_INTENT` dropped) |
| p95 latency | 1.6 s | 0.56 s |
| Estimated cost / call | ~$0.0001 | ~$0.00013 (≈10× the input tokens: 11 questions) |

Jev was accurate when it answered and never deactivated on a guess, but it declined about
1 in 5 messages and was not cheaper; its only clear gain, latency, does not matter for
background interpretation. A Jev-first/OpenAI-fallback hybrid would cost more than OpenAI
alone. The Jev code stays as an opt-in for a later re-check (e.g. if latency or volume
starts to matter, or a newer Jev handles Spanish better). Before any real customer data
goes to Jev, TypeSafe's data-handling terms still need review.

The evaluation also exposed OpenAI prompt gaps (overrated interest, `PRICING_REQUESTED`
from business-quoted prices, money hesitation read as purchase/cancellation). Adding
signal and interest definitions to `SYSTEM_PROMPT` raised Luna to 100% interest-level
accuracy and 92% / 90% exact signal sets on v1 / held-out, with 0 false deactivations, at
~$0.00018 per call (longer prompt). The held-out set has now informed that prompt change,
so a new held-out set is needed before the next round of prompt tuning.

### Not in M2B (future milestones)

**M3:** business knowledge, documents, chunks, embeddings, pgvector, retrieval, RAG.
**Later:** Redis/BullMQ, scheduled/periodic reevaluation, notifications, human approval,
outbound WhatsApp, recovered opportunities/revenue.

---

## Milestone 3 — Business Knowledge / RAG

M3 scope: company knowledge input → normalization → chunking → embeddings → PostgreSQL +
pgvector → company-scoped retrieval → (optional) grounded suggested response. The three
layers answer different questions and none replaces another:

- **M2B:** "What does the customer mean?" (signals, intent)
- **M2A:** "What should happen commercially?" (score, priority, state, risk, next best action)
- **M3:** "What verified business information is relevant to this situation?"

M3 never computes score/priority/state/risk/next best action, never interprets commercial
meaning, never calls M2A, never sends anything. No Redis/BullMQ/queues, no outbound
WhatsApp, no frontend changes, no integrations.

### Architecture

```
src/llm/        provider SDK code only
  EmbeddingProvider  (DI token EMBEDDING_PROVIDER)  -> OpenAiEmbeddingProvider
  GroundedResponder  (DI token GROUNDED_RESPONDER)  -> OpenAiGroundedResponder
src/knowledge/  M3 domain, no SDK imports
  text-normalizer.ts, chunker.ts      pure, deterministic
  KnowledgeChunkRepository            the ONLY raw SQL / pgvector code
  KnowledgeDocumentsService           create/update/delete/list/get: normalize -> chunk -> embed -> persist
  KnowledgeRetrievalService           companyId + query -> embed -> scoped search -> threshold
  retrieval-query.ts                  pure: conversation -> bounded retrieval query
  GroundedResponseService             conversation -> retrieval -> responder -> grounding checks
  KnowledgeController                 /dev/knowledge/*
```

`KnowledgeModule` imports `LlmModule` (the two DI tokens) and `InterpretationModule` (only
for `ContextBuilderService`). It does not import `OpportunitiesModule`.

### pgvector setup

pgvector is a PostgreSQL extension, not a separate service: the same single Postgres
container now runs the official `pgvector/pgvector:0.8.7-pg16` image (PostgreSQL 16 with
the extension preinstalled) instead of `postgres:16-alpine`. The migration runs
`CREATE EXTENSION IF NOT EXISTS vector` (added by hand: Prisma 6 only emits it behind the
`postgresqlExtensions` preview flag, which we don't enable).

**Upgrading an existing local volume:** the old image was Alpine (musl), the new one is
Debian (glibc); same Postgres major version, but text collations differ. Local data is
reproducible, so recreate it:

```bash
cd apps/api
docker compose down -v && docker compose up -d
pnpm --filter @keom/api prisma:migrate
pnpm --filter @keom/api prisma:seed     # now also seeds "SaaS Demo" (00000000-0000-4000-8000-000000000003)
```

### Domain model (Prisma)

Industry-agnostic on purpose: **no domain columns** (no price, schedule, product, property
fields). Anything business-specific goes in free-form `metadata`.

- **`KnowledgeDocument`** — `companyId`, `title`, `sourceType` (`TEXT | MARKDOWN`),
  `sourceName?`, `content` (normalized text, the source of truth for re-chunking),
  `contentHash` (sha256 of title + normalized content), `metadata` (JSON).
  `@@unique([companyId, contentHash])` makes an accidental duplicate POST return the
  existing document (`200`, `created: false`) instead of re-indexing it.
- **`KnowledgeChunk`** — `companyId`, `documentId`, `chunkIndex`, `content`, `metadata`
  (copy of the document's), `embedding vector(1536)`, `embeddingModel`.
  - Composite FK `(document_id, company_id) → knowledge_document(id, company_id)`: a chunk
    whose company differs from its document's is rejected **by the database**.
  - `ON DELETE CASCADE`: deleting a document deletes its vectors; nothing stale remains.
  - `embeddingModel`: retrieval only compares vectors from the current model.

**No processing status (`PENDING/READY/FAILED`).** Ingestion embeds every chunk before
writing anything, then writes the document and its chunks in one transaction, so a
partially indexed document cannot exist. A status column belongs with async ingestion (M4).

**Generic metadata.** Flat object of string/number/boolean values, ≤ 20 keys, e.g.
`{ "category": "pricing", "language": "es", "region": "lima" }`. Core retrieval never reads
specific keys; the only use is an optional `metadataFilter` on search, applied as a JSONB
containment (`metadata @> filter`).

### Embeddings

`text-embedding-3-small`, **1536 dimensions** (its native size, verified against OpenAI's
docs; it accepts a `dimensions` parameter, and 1536 is sent explicitly). Cheapest current
OpenAI embedding model, and under pgvector's 2000-dimension HNSW limit should an index be
needed later. `KNOWLEDGE_EMBEDDING_DIMENSIONS` (code constant) must match the
`vector(1536)` column; every returned vector is length- and finiteness-checked.

**Changing model or dimension** means a migration altering the column type **and**
re-embedding every document (possible because normalized `content` is stored) — e.g. a
`PUT` per document. The `embeddingModel` filter keeps old and new vectors from being mixed
in the meantime.

### Chunking

Pure and deterministic (`src/knowledge/chunker.ts`), character-based (no tokenizer
dependency):

- **maxChars 1200** (~300 tokens): FAQ/policy/pricing paragraphs are short; a chunk holds one
  or two facts so retrieval stays precise.
- **overlapChars 150**: each chunk after the first starts with the tail of the previous one,
  so a fact straddling a boundary survives.
- Blocks split on blank lines (a Markdown heading also starts a block), oversized blocks
  split at sentence boundaries, then at a word boundary as a last resort; blocks are packed
  greedily. Every chunk is ≤ maxChars, overlap included.
- Limits: 100k normalized characters and 200 chunks per document (`422` beyond).
- The embedded text is `"{title}\n\n{chunk}"` (topical context); the stored text is the chunk.

These are function parameters with exported defaults, deliberately **not** env vars:
changing them silently would make existing documents' chunks inconsistent with new ones.

### Retrieval

```sql
SELECT ..., 1 - (c.embedding <=> $query::vector) AS similarity
FROM knowledge_chunk c JOIN knowledge_document d ON d.id = c.document_id AND d.company_id = c.company_id
WHERE c.company_id = $companyId AND c.embedding_model = $model [AND c.metadata @> $filter]
ORDER BY c.embedding <=> $query::vector LIMIT $topK
```

- `companyId` is a required parameter of the repository's only search method; there is no
  unscoped variant.
- Results below `minSimilarity` are dropped. **Empty result = "no relevant knowledge"**;
  failures throw (`503`/`504`/`502`) — the two are never confused.
- **No ANN index (exact scan), on purpose.** Filtered by `company_id`, an exact scan is
  correct and fast at MVP scale (thousands of chunks per company). HNSW applies the `WHERE`
  filter *after* the index scan and can return fewer than K rows for small tenants. When
  needed: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` plus
  `SET hnsw.iterative_scan = relaxed_order`.

**Threshold calibration** (`text-embedding-3-small`, Spanish customer queries, manual demo
on 2026-10-01):

| Query → document | Relevant? | Similarity |
|---|---|---|
| "¿Cuál es su política de cancelación?" → cancellation policy | yes | 0.611 |
| "¿Cuánto cuesta el plan y cuántos usuarios incluye?" → Business Plan | yes | 0.520 |
| "¿Cuánto cuesta la depilación de piernas?" → laser FAQ | yes | 0.503 |
| "Hola, ¿cuánto cuesta y tienen disponibilidad el sábado?" → laser FAQ (Spanish) | yes | 0.451 |
| "¿Cuánto cuesta y atienden el sábado?" → laser FAQ (**English** content) | yes | 0.355 |
| "Hola, ¿cuánto cuesta y tienen disponibilidad el sábado?" → laser FAQ (**English**) | yes | 0.322 |
| "¿Tienen garantía de devolución para zapatos?" → cancellation policy | no | 0.315 |
| SaaS plan question → clinic documents | no | 0.258 |
| "¿Hacen envíos a provincia?" | no | 0.226 |
| "hola" | no | 0.182 |

Default **`KNOWLEDGE_MIN_SIMILARITY=0.35`**, `KNOWLEDGE_TOP_K=5`; both overridable per
search request. **Known limitation:** content written in a different language than the
customer scores ~0.1 lower and can fall under the threshold (row 6). Write knowledge in the
customers' language; recalibrate when the model or language mix changes.

**Retrieval query** (`retrieval-query.ts`, no extra LLM call): latest customer message,
plus the previous one when the latest is under 40 chars ("¿y el sábado?"), plus M2B
`serviceName`/`productName` entities when supplied and not already present; capped at 500
chars. M2B signal names are not appended (English enum labels add noise to Spanish
embeddings).

### Grounded suggested response (optional)

`POST /dev/knowledge/suggest-response { conversationId, interpretation? }`:

1. `companyId` is **derived from the conversation** (via `ContextBuilderService`), never
   taken from the caller.
2. Build the retrieval query, retrieve.
3. **No relevant chunks → `INSUFFICIENT_KNOWLEDGE` without calling the LLM.** No LLM call,
   nothing to invent.
4. `GroundedResponder` (OpenAI, reusing `OPENAI_MODEL`/`OPENAI_API_KEY`/`LLM_TIMEOUT_MS`;
   OpenAI-only regardless of `LLM_PROVIDER`, since Jev can't draft text) gets the bounded
   conversation, sources labelled `[S1]…[Sn]`, and the optional M2B intent/signals as
   context. Prompt rules: reply only to the customer's latest message; facts only from
   sources; answer the covered part and defer the rest; nothing in the latest message
   covered → `insufficientKnowledge`; never confirm live data; never decide commercial
   state. Output is Zod-validated.
5. Grounding checks in code: the suggestion must cite ≥ 1 source, and every cited id must
   be one that was retrieved — otherwise it is discarded as `INSUFFICIENT_KNOWLEDGE`.

```ts
{
  status: "GROUNDED" | "INSUFFICIENT_KNOWLEDGE",
  suggestedResponse: string | null,
  grounded: boolean,
  insufficientKnowledge: boolean,
  requiresLiveVerification: boolean,
  retrievalQuery: string | null,
  sources: [{ chunkId, documentId, title, sourceName, chunkIndex, similarity }]  // cited chunks only
}
```

Retrieval or provider failures are HTTP errors, so downstream code can tell apart
*grounded answer*, *insufficient knowledge* and *failure*. Nothing is persisted or sent.

### Static knowledge vs live data

M3 holds static or semi-static knowledge: descriptions, price lists, policies, opening
hours, FAQs, terms, warranties, promotions, playbooks. It is **never** authoritative for
live operational data (appointment availability, stock, order/payment/shipment status,
account data, CRM state, real-time capacity) — those come from future integrations.

Enforced by the prompt (sources "never prove live facts"; give the general rule and say it
must be confirmed) and by `requiresLiveVerification`, which is set when the model flags it
**or**, deterministically, when the caller's M2B signals include `AVAILABILITY_REQUESTED`.
Demo result: "¿Me confirmas una cita libre este sábado a las 3 pm?" →
*"…atendemos los sábados de 9:00 a. m. a 5:00 p. m. La disponibilidad de este sábado a las
3:00 p. m. debe confirmarse con el equipo."*, `requiresLiveVerification: true`.

### Endpoints (dev-only, no auth — same conventions as M2A/M2B)

| Method | Path | Notes |
|---|---|---|
| POST | `/dev/knowledge/documents` | `{companyId, title, content, sourceType?, sourceName?, metadata?}` → `201` indexed / `200` identical retry |
| GET | `/dev/knowledge/documents?companyId=` | list (no content) |
| GET | `/dev/knowledge/documents/:id?companyId=` | `404` if it belongs to another company |
| PUT | `/dev/knowledge/documents/:id` | full replacement `{companyId, title, content, ...}`; chunks rebuilt |
| DELETE | `/dev/knowledge/documents/:id?companyId=` | `204`; chunks cascade |
| POST | `/dev/knowledge/search` | `{companyId, query, topK?, minSimilarity?, metadataFilter?}` |
| POST | `/dev/knowledge/suggest-response` | `{conversationId, interpretation?}` |

### Environment

```
EMBEDDING_PROVIDER=openai
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=               # shared with M2B
EMBEDDING_TIMEOUT_MS=         # optional, falls back to LLM_TIMEOUT_MS
KNOWLEDGE_TOP_K=5             # optional
KNOWLEDGE_MIN_SIMILARITY=0.35 # optional
```

Resolved lazily per call, like M2B: the API boots and M1/M2A/M2B work with none of these
set; only `/dev/knowledge/*` calls fail, with `503`.

### Failure handling

| Failure | Result |
|---|---|
| Missing/invalid embedding or LLM config | `503`, nothing written |
| Provider timeout | `504`, nothing written |
| Provider error, wrong dimensions, bad output | `502`, nothing written |
| Empty content / no chunks / too large | `422`, nothing embedded or written |
| Unknown company, or document of another company | `404` |
| `PUT` making a document identical to another | `409` |
| DB write failure | `500`, transaction rolled back |
| Vector search failure | `503` |
| No relevant matches | `200` with empty `chunks` / `INSUFFICIENT_KNOWLEDGE` |

An update whose embedding fails leaves the previous version fully searchable (embedding
happens before the transaction that swaps chunks).

### Tests

```bash
pnpm --filter @keom/api test       # unit: chunker, normalizer, retrieval query, providers, services
pnpm --filter @keom/api test:e2e   # e2e: real Postgres + pgvector; embedder and responder mocked
```

No automated test calls a real provider. The e2e suite DI-overrides `EMBEDDING_PROVIDER`
with `test/fake-embedding-provider.ts` (deterministic hashed bag of words, L2-normalized) and
`GROUNDED_RESPONDER` with a jest mock. It ingests clinic, SaaS and real-estate documents
through the same schema and covers: 1536-dim vectors stored, idempotent retry, empty
content, embedding failure on create/update (no partial state), ranking + traceability,
company isolation (search, get, update, delete, and the DB-level composite FK), threshold,
metadata filter, update without stale chunks, delete cascade, grounded suggestion sourced
only from the conversation's company, and `INSUFFICIENT_KNOWLEDGE` without an LLM call.

### Manual demo with real providers

With `EMBEDDING_PROVIDER`, `OPENAI_EMBEDDING_MODEL` and `OPENAI_API_KEY` set (see M1 setup
for Postgres/migrate/seed):

```bash
CLINIC=00000000-0000-4000-8000-000000000001   # Clínica Demo (seeded)
SAAS=00000000-0000-4000-8000-000000000003     # SaaS Demo (seeded)
B=http://localhost:3001/dev/knowledge

# A — clinic
curl -s -X POST $B/documents -H 'Content-Type: application/json' -d '{
  "companyId": "'$CLINIC'", "title": "Depilación láser — preguntas frecuentes",
  "metadata": { "category": "pricing", "language": "es" },
  "content": "La depilación láser de piernas cuesta S/320 por sesión.\nAtendemos los sábados de 9 AM a 5 PM.\nLas citas requieren confirmación."
}'
curl -s -X POST $B/search -H 'Content-Type: application/json' \
  -d '{"companyId": "'$CLINIC'", "query": "¿Cuánto cuesta y atienden el sábado?"}'

# B — SaaS (same endpoints, same schema)
curl -s -X POST $B/documents -H 'Content-Type: application/json' -d '{
  "companyId": "'$SAAS'", "title": "Business Plan", "metadata": { "category": "plans" },
  "content": "The Business Plan costs $99/month.\nIt includes 20 users, API access, and email support.\nAnnual subscriptions receive a 15% discount."
}'
curl -s -X POST $B/search -H 'Content-Type: application/json' \
  -d '{"companyId": "'$SAAS'", "query": "¿Cuánto cuesta el plan y cuántos usuarios incluye?"}'

# Isolation: the SaaS question against the clinic returns only clinic chunks (or none)
curl -s -X POST $B/search -H 'Content-Type: application/json' \
  -d '{"companyId": "'$CLINIC'", "query": "¿Cuánto cuesta el plan y cuántos usuarios incluye?"}'
```

**End-to-end demo of all milestones:** `pnpm --filter @keom/api demo` (with the API running)
runs the whole story — webhook → M2B → M2A → M3 — and explains each step; see
[`docs/DEMO.md`](../../docs/DEMO.md). Keep `scripts/demo.ts` and that guide updated at the
end of every milestone.

Full chain by hand: post the M1 fixture webhook, run `POST /dev/interpretation/evaluate`
(M2B → M2A), then pass its `interpretation` to `suggest-response`:

```bash
curl -s -X POST $B/suggest-response -H 'Content-Type: application/json' \
  -d '{"conversationId": "<conversation-id>", "interpretation": <interpretation from M2B>}'
```

Observed (2026-10-01, `gpt-5.6-luna`, reasoning effort `none`): for *"Hola, ¿cuánto cuesta y
tienen disponibilidad el sábado?"* → `GROUNDED`, *"Hola, la depilación láser de piernas cuesta
S/320 por sesión. Atendemos los sábados de 9:00 a. m. a 5:00 p. m., pero la disponibilidad de
un horario específico debe confirmarse. ¿Qué horario te interesa?"*, citing only the FAQ
chunk, `requiresLiveVerification: true`. After deleting the FAQ → `INSUFFICIENT_KNOWLEDGE`.

### Not in M3 (future milestones)

**M4:** Redis/BullMQ, async ingestion (and a document status column), delayed
reevaluation, timers, stale-opportunity detection. **M5:** notifications, seller approval
workflow, escalation. **M6:** outbound WhatsApp. **Later:** calendar/inventory/CRM/payment/
order integrations for live data, PDF/file parsing, OCR, semantic chunking, query rewriting,
ANN index, citation UI, recovered revenue.

---

Consumes `@keom/mocks` for the WhatsApp fixture. `@keom/contracts` remains the
FE↔BE contract surface for `apps/web`-facing endpoints (not used by this webhook,
which has no frontend consumer) — see `docs/ARCHITECTURE.md` Section A for the plan
to generate types from this API's OpenAPI spec once that surface stabilizes.

See the root [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for full context on
how this app fits into the monorepo.
