# Demo: KEOM M3 — conocimiento del negocio en 10 minutos

Esta guía muestra lo nuevo de M3: cada negocio carga su información (precios, horarios,
políticas, FAQs) y KEOM la usa para sugerir una respuesta al vendedor, **sin inventar nada**.

```
Mensaje de WhatsApp  →  M1: se guarda
                     →  M2B: la IA entiende qué quiere el cliente
                     →  M2A: el motor decide qué hacer con la oportunidad
                     →  M3: KEOM busca la información verificada de ESE negocio
                            y sugiere una respuesta basada solo en ella
```

Las tres capas responden preguntas distintas:

- **M2B:** ¿qué quiere decir el cliente?
- **M2A:** ¿qué debería pasar comercialmente?
- **M3:** ¿qué información verificada del negocio sirve para esta situación?

Reglas de M3: solo usa lo que el negocio cargó; si no lo sabe, lo dice; nunca confirma datos
en vivo (horarios libres, stock); nunca envía nada, solo sugiere. Funciona igual para
cualquier rubro: en esta demo, una clínica y una empresa de software.

Si todavía no hiciste la demo anterior, empieza por [`DEMO-M2B.md`](./DEMO-M2B.md).

## Qué necesitas

- Lo mismo que en la demo M2B: Docker Desktop, Node 20+, pnpm y una API key de OpenAI.
- Los embeddings (`text-embedding-3-small`) cuestan centavos por miles de documentos.

## 1. Preparar (una sola vez)

M3 cambió la imagen de la base de datos a una que incluye **pgvector** (la extensión de
Postgres que guarda y compara embeddings; sigue siendo la misma base, en el mismo
contenedor). Si ya tenías la base de una demo anterior, hay que recrearla una vez.
**Esto borra los datos locales de prueba:**

```bash
cd apps/api
docker compose down -v
docker compose up -d
pnpm prisma:migrate                 # crea las tablas, incluidas las de conocimiento
pnpm prisma:seed                    # crea "Clínica Demo" y "SaaS Demo"
```

En `apps/api/.env`, además de las líneas de la demo M2B, agrega:

```
EMBEDDING_PROVIDER=openai
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

## 2. Levantar la API

En una terminal (déjala abierta):

```bash
cd apps/api
pnpm dev
```

Todo lo que sigue va en **otra** terminal, desde `apps/api`, siempre la misma (los pasos
guardan valores en variables).

## 3. La clínica carga su información

```bash
CLINICA=00000000-0000-4000-8000-000000000001
SAAS=00000000-0000-4000-8000-000000000003

curl -s -X POST http://localhost:3001/dev/knowledge/documents \
  -H "Content-Type: application/json" \
  -d '{"companyId":"'$CLINICA'","title":"Depilación láser — preguntas frecuentes","metadata":{"categoria":"precios"},"content":"La depilación láser de piernas cuesta S/320 por sesión.\nAtendemos los sábados de 9 AM a 5 PM.\nLas citas requieren confirmación."}'

curl -s -X POST http://localhost:3001/dev/knowledge/documents \
  -H "Content-Type: application/json" \
  -d '{"companyId":"'$CLINICA'","title":"Política de cancelación","metadata":{"categoria":"politicas"},"content":"Puedes cancelar o reprogramar tu cita sin costo hasta 24 horas antes. Las cancelaciones con menos de 24 horas pierden el adelanto."}'
```

Cada uno responde con `"created": true` y `"chunkCount": 1`: el texto se dividió en
fragmentos, se convirtió en embeddings y quedó guardado en Postgres.

`metadata` es libre: cada negocio pone las etiquetas que quiera. KEOM no depende de ellas.

## 4. Buscar en el conocimiento de la clínica

```bash
curl -s -X POST http://localhost:3001/dev/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{"companyId":"'$CLINICA'","query":"¿Cuánto cuesta la depilación de piernas y atienden el sábado?"}'
```

Resultado real (resumido):

```json
{
  "minSimilarity": 0.35,
  "chunks": [
    { "title": "Depilación láser — preguntas frecuentes",
      "content": "La depilación láser de piernas cuesta S/320 por sesión.\nAtendemos los sábados de 9 AM a 5 PM.\n...",
      "similarity": 0.76 },
    { "title": "Política de cancelación", "similarity": 0.36 }
  ]
}
```

`similarity` mide qué tan relacionado está cada fragmento con la pregunta (1 = idéntico). Lo
que queda por debajo de `minSimilarity` se descarta.

## 5. Otro rubro, la misma estructura

Una empresa de software carga su plan, con los mismos endpoints y las mismas tablas:

```bash
curl -s -X POST http://localhost:3001/dev/knowledge/documents \
  -H "Content-Type: application/json" \
  -d '{"companyId":"'$SAAS'","title":"Plan Business","metadata":{"categoria":"planes"},"content":"El Plan Business cuesta $99 al mes.\nIncluye 20 usuarios, acceso a la API y soporte por email.\nLas suscripciones anuales tienen 15% de descuento."}'

curl -s -X POST http://localhost:3001/dev/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{"companyId":"'$SAAS'","query":"¿Cuánto cuesta el plan y cuántos usuarios incluye?"}'
```

Devuelve el "Plan Business" con `similarity` 0.64.

Ahora la misma pregunta, pero **a la clínica**:

```bash
curl -s -X POST http://localhost:3001/dev/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{"companyId":"'$CLINICA'","query":"¿Cuánto cuesta el plan y cuántos usuarios incluye?"}'
```

Resultado real: `"chunks": []`. Cada negocio solo ve su propia información; la de otro
nunca aparece.

## 6. Del mensaje a la respuesta sugerida

Llega un mensaje de Andrea a la clínica:

```bash
curl -X POST http://localhost:3001/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[{"id":"102290129340398","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"51999888777","phone_number_id":"109876543210987"},"contacts":[{"profile":{"name":"Andrea Torres"},"wa_id":"51987654321"}],"messages":[{"from":"51987654321","id":"wamid.m3-001","timestamp":"1758000000","type":"text","text":{"body":"Hola, ¿cuánto cuesta la depilación de piernas y atienden el sábado?"}}]},"field":"messages"}]}]}'

CONV=$(docker compose exec -T postgres psql -U keom -d keom_api -t -A \
  -c "select id from conversation order by updated_at desc limit 1")
```

La IA interpreta y el motor decide (igual que en la demo M2B):

```bash
curl -s -X POST http://localhost:3001/dev/interpretation/evaluate \
  -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"$CONV\"}"
```

Resultado real (resumido): `signals: ["PRICING_REQUESTED", "AVAILABILITY_REQUESTED"]`,
`nextBestAction: "SEND_INFORMATION"`. El motor dice *qué* hacer: mandarle información.

M3 sugiere *qué* decirle. Le pasamos lo que entendió la IA como contexto:

```bash
curl -s -X POST http://localhost:3001/dev/knowledge/suggest-response \
  -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"$CONV\",\"interpretation\":{\"intent\":\"PRICING\",\"signals\":[\"PRICING_REQUESTED\",\"AVAILABILITY_REQUESTED\"]}}"
```

Resultado real (formateado):

```json
{
  "status": "GROUNDED",
  "suggestedResponse": "Hola, la depilación láser de piernas cuesta S/320 por sesión. Sí, atendemos los sábados de 9:00 a. m. a 5:00 p. m. Las citas requieren confirmación; escríbenos para verificar disponibilidad y reservar.",
  "requiresLiveVerification": true,
  "sources": [
    { "title": "Depilación láser — preguntas frecuentes", "chunkIndex": 0, "similarity": 0.76 }
  ]
}
```

Cómo leerlo:
- **`GROUNDED`**: la respuesta se basa en información cargada por la clínica.
- **`sources`**: de dónde sale cada dato. Si la IA no puede citar una fuente, la sugerencia
  se descarta.
- **`requiresLiveVerification`**: la clienta preguntó por disponibilidad, algo que solo un
  calendario real puede confirmar. Por eso la sugerencia da el horario general y pide confirmar.
- Nada se envía: es una sugerencia para el vendedor.

## 7. La clienta pide un horario concreto

```bash
curl -X POST http://localhost:3001/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[{"id":"102290129340398","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"51999888777","phone_number_id":"109876543210987"},"contacts":[{"profile":{"name":"Andrea Torres"},"wa_id":"51987654321"}],"messages":[{"from":"51987654321","id":"wamid.m3-002","timestamp":"1758000300","type":"text","text":{"body":"Perfecto. ¿Me confirmas una cita libre este sábado a las 3 pm?"}}]},"field":"messages"}]}]}'

curl -s -X POST http://localhost:3001/dev/knowledge/suggest-response \
  -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"$CONV\"}"
```

Resultado real:

> "La depilación láser de piernas cuesta S/320 por sesión y atendemos los sábados de 9:00 a. m.
> a 5:00 p. m. La disponibilidad de este sábado a las 3:00 p. m. debe confirmarse; por favor,
> indícanos tu nombre para revisar la cita."

KEOM sabe que los sábados se atiende (información fija), pero **no** confirma que haya un
horario libre a las 3 pm: eso es un dato en vivo que vendrá de una integración con el
calendario, no de este conocimiento.

## 8. Sin información, no inventa

La clínica borra su FAQ:

```bash
FAQ=$(docker compose exec -T postgres psql -U keom -d keom_api -t -A \
  -c "select id from knowledge_document where title like 'Depilación%'")

curl -s -X DELETE "http://localhost:3001/dev/knowledge/documents/$FAQ?companyId=$CLINICA"

curl -s -X POST http://localhost:3001/dev/knowledge/suggest-response \
  -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"$CONV\"}"
```

Resultado real:

```json
{ "status": "INSUFFICIENT_KNOWLEDGE", "suggestedResponse": null, "sources": [] }
```

Sin precios ni horarios cargados, KEOM no sugiere nada antes que inventar un dato.

## Importante: escribe el conocimiento en el idioma de tus clientes

Si la información está en inglés y los clientes escriben en español, la búsqueda las
relaciona peor y puede descartarla (y entonces responde `INSUFFICIENT_KNOWLEDGE`). Carga la
información en el idioma en que te escriben.

## Ver los datos guardados

```bash
pnpm prisma:studio
```

Las tablas nuevas son `KnowledgeDocument` (cada documento) y `KnowledgeChunk` (sus
fragmentos con su embedding).

## Qué falta (próximas fases)

- Cargar conocimiento desde la pantalla (hoy es por API) y desde archivos como PDF.
- Recordatorios y reevaluación automática de oportunidades (M4).
- Notificaciones y aprobación del vendedor antes de responder (M5).
- Enviar la respuesta por WhatsApp (M6).
- Datos en vivo (calendario, stock, pedidos) mediante integraciones.

Detalles técnicos: [`apps/api/README.md`](../apps/api/README.md) (sección Milestone 3) y
[`docs/SYSTEM.md`](./SYSTEM.md).
