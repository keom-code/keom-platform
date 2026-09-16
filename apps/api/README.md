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

Consumes `@keom/mocks` for the WhatsApp fixture. `@keom/contracts` remains the
FE↔BE contract surface for `apps/web`-facing endpoints (not used by this webhook,
which has no frontend consumer) — see `docs/ARCHITECTURE.md` Section A for the plan
to generate types from this API's OpenAPI spec once that surface stabilizes.

See the root [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for full context on
how this app fits into the monorepo.
