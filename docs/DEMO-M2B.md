# Demo: KEOM hasta M2B en 10 minutos

Esta guía muestra que funciona todo lo construido hasta ahora: entra un mensaje de WhatsApp,
la IA lo interpreta y el motor decide qué hacer con esa oportunidad de venta.

```
Mensaje de WhatsApp  →  M1: se guarda (cliente, conversación, mensaje)
                     →  M2B: la IA (OpenAI) entiende qué quiere el cliente
                     →  M2A: el motor calcula estado, prioridad, riesgo y siguiente acción
```

Regla central: **la IA solo interpreta; las decisiones las toma un motor con reglas fijas.**

Todavía no hay pantalla (el dashboard usa datos de prueba; conectarlo es la siguiente fase),
así que la demo se hace con comandos en la terminal. Todo corre en tu máquina, con una base
de datos local.

## Qué necesitas

- Docker Desktop abierto
- Node 20 o superior y pnpm
- Una API key de OpenAI con acceso a `gpt-5.6-luna` (cada mensaje interpretado cuesta
  menos de $0.001)

## 1. Preparar (una sola vez)

Desde la raíz del repo:

```bash
pnpm install
cd apps/api
cp .env.example .env
docker compose up -d                # base de datos Postgres
pnpm prisma:migrate                 # crea las tablas
pnpm prisma:seed                    # crea el negocio de prueba "Clínica Demo"
```

Si ya tenías la base de datos de antes de M3, recréala una vez (cambió la imagen a una con
pgvector; **borra los datos locales de prueba**): `docker compose down -v` y vuelve a correr
los tres últimos comandos.

Abre `apps/api/.env` y deja estas líneas así, con tu key:

```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...tu key...
OPENAI_MODEL=gpt-5.6-luna
OPENAI_REASONING_EFFORT=none
```

`.env` está en `.gitignore`: la key nunca se sube al repo.

## 2. Levantar la API

En una terminal (déjala abierta):

```bash
cd apps/api
pnpm dev
```

Espera a que aparezca `Nest application successfully started`. La API queda en
`http://localhost:3001`.

## 3. Llega un mensaje de una clienta

En **otra** terminal, desde `apps/api`, simula que WhatsApp nos envía un mensaje de Andrea:

```bash
curl -X POST http://localhost:3001/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[{"id":"102290129340398","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"51999888777","phone_number_id":"109876543210987"},"contacts":[{"profile":{"name":"Andrea Torres"},"wa_id":"51987654321"}],"messages":[{"from":"51987654321","id":"wamid.demo-001","timestamp":"1758000000","type":"text","text":{"body":"Hola, ¿cuánto cuesta y tienen disponibilidad el sábado?"}}]},"field":"messages"}]}]}'
```

Responde `{"status":"ok"}`: el mensaje quedó guardado.

Busca el ID de esa conversación y guárdalo en una variable:

```bash
CONV=$(docker compose exec -T postgres psql -U keom -d keom_api -t -A \
  -c "select id from conversation order by updated_at desc limit 1")
echo $CONV
```

## 4. La IA interpreta y el motor decide

```bash
curl -s -X POST http://localhost:3001/dev/interpretation/evaluate \
  -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"$CONV\"}"
```

Resultado real (formateado):

```json
{
  "interpretation": {
    "intent": "PRICING",
    "interestLevel": "MEDIUM",
    "signals": ["PRICING_REQUESTED", "AVAILABILITY_REQUESTED"],
    "entities": { "requestedDate": "sábado" }
  },
  "opportunity": {
    "state": "ENGAGED",
    "priority": "MEDIUM",
    "nextBestAction": "SEND_INFORMATION",
    "score": 50,
    "reasons": { "action": "Customer asked about pricing/a quote." }
  }
}
```

Cómo leerlo:
- **`interpretation`** es lo que entendió la IA: pregunta precio y disponibilidad para el
  sábado, con interés medio.
- **`opportunity`** es lo que decidió el motor: hay una oportunidad abierta, con prioridad
  media, y lo recomendable es mandarle la información. `reasons` explica cada decisión.

## 5. La clienta quiere reservar

Llega un segundo mensaje:

```bash
curl -X POST http://localhost:3001/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[{"id":"102290129340398","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"51999888777","phone_number_id":"109876543210987"},"contacts":[{"profile":{"name":"Andrea Torres"},"wa_id":"51987654321"}],"messages":[{"from":"51987654321","id":"wamid.demo-002","timestamp":"1758000300","type":"text","text":{"body":"Perfecto, resérvame el sábado a las 10am por favor"}}]},"field":"messages"}]}]}'

curl -s -X POST http://localhost:3001/dev/interpretation/evaluate \
  -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"$CONV\"}"
```

Resultado real (resumido):

```json
{
  "interpretation": {
    "intent": "BOOKING",
    "interestLevel": "HIGH",
    "signals": ["PRICING_REQUESTED", "AVAILABILITY_REQUESTED", "BOOKING_INTENT"],
    "entities": { "requestedDate": "sábado", "requestedTime": "10am" }
  },
  "opportunity": {
    "state": "AT_RISK",
    "priority": "HIGH",
    "risk": "HIGH",
    "nextBestAction": "OFFER_APPOINTMENT",
    "score": 90,
    "reasons": { "risk": "No business response for over 4h since the last inbound message." }
  }
}
```

Es **la misma oportunidad**, ahora con prioridad alta: la clienta quiere reservar y lo
recomendable es ofrecerle la cita. Sale `AT_RISK` porque los mensajes de ejemplo tienen
fecha de 2025, así que para el sistema la clienta lleva más de 4 horas sin respuesta. Esa es
justo la alerta que KEOM debe dar para que no se pierda la venta.

Para probar tus propios mensajes, cambia el texto de `body` y usa un `id` nuevo
(`wamid.demo-003`, ...). Si repites un `id`, el mensaje se ignora para no duplicarlo.

## Ver los datos guardados

```bash
pnpm prisma:studio
```

Abre una vista web de la base: clientes, conversaciones, mensajes, oportunidades y su
historial de estados.

## Qué falta (próximas fases)

- Conectar el dashboard (`apps/web`) a esta API, para verlo en pantalla en vez de la terminal.
- Registrar negocios y números de WhatsApp reales (hoy solo "Clínica Demo" tiene un número de prueba).

Siguiente demo: [`DEMO-M3.md`](./DEMO-M3.md) — el conocimiento de cada negocio (precios,
horarios, políticas) y respuestas sugeridas basadas solo en él.

Detalles técnicos: [`docs/SYSTEM.md`](./SYSTEM.md) y [`apps/api/README.md`](../apps/api/README.md).
