# Demo KEOM — todo lo construido hasta ahora

**Estado:** M1 + M2A + M2B + M3 · **Última actualización:** 2026-10-01 (cierre de M3)

Una sola historia, de punta a punta, para el equipo técnico: llega un mensaje de WhatsApp,
la IA lo interpreta, el motor decide qué hacer con la oportunidad y KEOM sugiere qué responder
usando solo la información que cargó el negocio. Cada paso se explica en dos niveles:
**Negocio** (qué significa) y **Técnico** (qué pasó por dentro).

> **Mantener esta demo:** al cerrar cada milestone, actualizar esta guía y
> `apps/api/scripts/demo.ts` juntos (nuevo paso + salida real + "Hallazgos conocidos").

## Qué hace cada capa

```
Mensaje de WhatsApp
   │
   ├─ M1   Ingesta        guarda cliente, conversación y mensaje            src/whatsapp, src/ingestion
   ├─ M2B  Interpretación la IA entiende qué quiere el cliente (señales)    src/llm, src/interpretation
   ├─ M2A  Motor          decide estado, prioridad, riesgo, siguiente acción src/opportunities
   └─ M3   Conocimiento   busca info verificada del negocio y sugiere        src/knowledge
                          una respuesta basada solo en ella (no la envía)
```

| Capa | Pregunta que responde | Usa IA | Decide |
|---|---|---|---|
| M2B | ¿Qué quiere decir el cliente? | Sí (OpenAI) | No, solo interpreta |
| M2A | ¿Qué debería pasar comercialmente? | No (reglas fijas) | Sí |
| M3 | ¿Qué información verificada del negocio sirve aquí? | Sí (embeddings + OpenAI) | No, solo sugiere |

## 1. Preparar (una sola vez)

Necesitas Docker Desktop, Node 20+, pnpm y una API key de OpenAI. Desde la raíz del repo:

```bash
pnpm install
cd apps/api
cp .env.example .env
docker compose up -d        # Postgres 16 + pgvector (un solo contenedor)
pnpm prisma:migrate         # crea las tablas
pnpm prisma:seed            # crea "Clínica Demo" (con WhatsApp de prueba) y "SaaS Demo"
```

En `apps/api/.env`:

```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...tu key...
OPENAI_MODEL=gpt-5.6-luna
OPENAI_REASONING_EFFORT=none
EMBEDDING_PROVIDER=openai
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

`.env` está en `.gitignore`. Una corrida completa cuesta menos de un centavo de dólar.

**Si tu base es de antes de M3** (imagen `postgres:16-alpine`): recréala una vez con
`docker compose down -v` y repite `up -d`, `prisma:migrate` y `prisma:seed`. Borra los datos
locales de prueba.

## 2. Correr la demo

Terminal 1 (déjala abierta):

```bash
cd apps/api
pnpm dev
```

Terminal 2:

```bash
cd apps/api
pnpm demo
```

Se puede correr las veces que quieras sin reiniciar la base: cada corrida usa una clienta
con un número nuevo (conversación y oportunidad nuevas) y recarga el conocimiento de los dos
negocios de prueba.

## 3. Qué vas a ver (salida real, resumida)

### Paso 1 — La clínica carga su información

**Negocio:** la clínica carga su FAQ (precio, horario) y su política de cancelación. KEOM solo
usará esto para sugerir respuestas.

**Técnico:** `POST /dev/knowledge/documents` → texto normalizado → fragmentos (chunks) →
embeddings de 1536 dimensiones → tabla `knowledge_chunk` en pgvector, siempre con su
`companyId`.

### Paso 2 — Andrea pregunta precio y horario

```
Andrea: "Hola, ¿cuánto cuesta la depilación de piernas y atienden el sábado?"
M2B interpretación: intent PRICING · interés MEDIUM · signals PRICING_REQUESTED, AVAILABILITY_REQUESTED
M2A decisión:       ENGAGED · prioridad MEDIUM · score 50 · siguiente acción SEND_INFORMATION
Sugerencia:         "Hola, la depilación láser de piernas cuesta S/320 por sesión. Atendemos los
                    sábados de 9 a. m. a 5 p. m.; la cita requiere confirmación."
M3 fuentes:         Depilación láser — preguntas frecuentes (similitud 0.76) · GROUNDED
```

**Negocio:** el motor dice *qué hacer* (mandarle información) y KEOM sugiere *qué decirle*,
con datos de la clínica. El vendedor la revisa; nada se envía solo.

**Técnico:** webhook real de Meta (M1) → `POST /dev/interpretation/evaluate` (M2B + M2A) →
`POST /dev/knowledge/suggest-response` con la interpretación de M2B como contexto. La búsqueda
usa el último mensaje del cliente; `sources` dice de qué fragmento sale cada dato.

### Paso 3 — Andrea quiere reservar un horario concreto

```
Andrea: "Perfecto, resérvame este sábado a las 3 pm por favor"
M2B interpretación: intent BOOKING · interés HIGH · + BOOKING_INTENT
M2A decisión:       HIGH_INTENT · prioridad HIGH · score 90 · siguiente acción OFFER_APPOINTMENT
Sugerencia:         "¡Claro! Atendemos los sábados de 9:00 a. m. a 5:00 p. m. Las citas requieren
                    confirmación; verificaremos si hay disponibilidad este sábado a las 3:00 p. m.
                    y te confirmaremos. ..."
M3 resultado:       GROUNDED · requiresLiveVerification: true
```

**Negocio:** la oportunidad sube a alta prioridad. KEOM sabe el horario general, pero **no
confirma** que las 3 pm estén libres: eso es un dato en vivo que vendrá de una integración con
el calendario.

**Técnico:** `requiresLiveVerification` lo marca el modelo y, de forma determinística, la
señal `AVAILABILITY_REQUESTED` de M2B. El mensaje es corto, así que la búsqueda le agrega la
entidad `serviceName` de M2B ("depilación de piernas") para encontrar el documento correcto.

### Paso 4 — Andrea pregunta por cancelaciones

```
Andrea: "¿Y si al final no puedo ir, puedo cancelar sin costo?"
M2B interpretación: + OBJECTION
M2A decisión:       HIGH_INTENT · score 75 · siguiente acción ESCALATE_TO_HUMAN
Sugerencia:         "Sí, puedes cancelar o reprogramar sin costo hasta 24 horas antes. Si cancelas
                    con menos de 24 horas, se pierde el adelanto."
M3 fuentes:         Política de cancelación (similitud 0.57) · GROUNDED
```

**Negocio:** KEOM responde con otro documento de la clínica y solo a lo que se preguntó.

**Técnico:** ver "Hallazgos conocidos": M2B lee esta pregunta como objeción y M2A escala a un
humano.

### Paso 5 — Andrea pregunta algo que la clínica no cargó

```
Andrea: "Otra consulta: ¿hacen envíos de productos a provincia?"
Sugerencia:         (ninguna — no hay información suficiente)
M3 resultado:       INSUFFICIENT_KNOWLEDGE
```

**Negocio:** si la información no existe, KEOM no inventa: no sugiere nada y responde el
vendedor.

**Técnico:** la búsqueda trae la FAQ (por la entidad agregada), pero el modelo debe responder
solo al último mensaje y las fuentes no hablan de envíos → `insufficientKnowledge`. Si la
búsqueda no trae nada sobre el umbral, ni siquiera se llama al modelo. Fallas del proveedor
son errores HTTP (5xx), nunca se confunden con "no hay información".

### Paso 6 — Otro rubro, la misma estructura, información aislada

```
Pregunta:                       "¿Cuánto cuesta el plan y cuántos usuarios incluye?"
Búsqueda en SaaS Demo:          Plan Business (similitud 0.64)
Misma búsqueda en Clínica Demo: sin resultados (aislada)
```

**Negocio:** una empresa de software usa exactamente el mismo sistema, sin cambios. Cada
negocio solo ve su propia información.

**Técnico:** el esquema no tiene campos por rubro (lo específico va en `metadata` libre). Toda
búsqueda filtra por `companyId`, y la base rechaza un fragmento cuyo `companyId` no coincida
con el de su documento (FK compuesta).

## 4. Hallazgos conocidos

Lo que la demo muestra hoy y todavía no está bien. Actualizar esta lista en cada corrida
relevante.

| Capa | Hallazgo | Impacto | Dónde se arregla |
|---|---|---|---|
| M2B | "¿puedo cancelar sin costo?" se interpreta como `OBJECTION` | M2A recomienda `ESCALATE_TO_HUMAN` en vez de responder | Prompt M2B + re-evaluación (`pnpm eval:interpreters`, set held-out nuevo) |
| M2B | "¿hacen envíos?" agrega `PAYMENT_QUESTION` | El score sube a 100 sin motivo | Igual que arriba |
| M2B → M3 | Las señales y entidades de M2B son de toda la conversación, no del último mensaje | `requiresLiveVerification` queda en `true` en pasos que ya no preguntan disponibilidad | Revisar cuando se automatice el flujo (M4) |
| M3 | Contenido en otro idioma que el cliente puntúa ~0.1 más bajo | Puede quedar bajo el umbral 0.35 y responder `INSUFFICIENT_KNOWLEDGE` | Cargar el conocimiento en el idioma de los clientes |
| M3 | Las sugerencias a veces repiten datos ya dados (paso 3) | Respuestas algo largas | Ajuste de prompt si molesta en uso real |
| Todas | Las salidas del LLM varían un poco entre corridas | Los textos no son idénticos a esta guía | Esperado; la estructura y los estados sí deben coincidir |

## 5. Probar a mano

Todos los endpoints son de desarrollo (`/dev/...`, sin autenticación). Detalle completo en
[`apps/api/README.md`](../apps/api/README.md).

| Capa | Endpoint | Para qué |
|---|---|---|
| M1 | `POST /webhooks/whatsapp` | Simular un mensaje entrante de Meta |
| M2A | `POST /dev/opportunities/evaluate` | Probar el motor con señales a mano, sin IA |
| M2B + M2A | `POST /dev/interpretation/evaluate` | Interpretar una conversación y decidir |
| M3 | `POST/GET/PUT/DELETE /dev/knowledge/documents` | Cargar, ver, reemplazar y borrar conocimiento |
| M3 | `POST /dev/knowledge/search` | Buscar en el conocimiento de un negocio |
| M3 | `POST /dev/knowledge/suggest-response` | Respuesta sugerida para una conversación |

Ejemplo, buscar en la clínica:

```bash
curl -s -X POST http://localhost:3001/dev/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{"companyId":"00000000-0000-4000-8000-000000000001","query":"¿cuánto cuesta?"}'
```

Ver los datos guardados (clientes, conversaciones, mensajes, oportunidades, documentos y
fragmentos):

```bash
pnpm prisma:studio
```

## 6. Qué falta (próximas fases)

- **Fase 11:** conectar el dashboard (`apps/web`) a esta API, para ver esto en pantalla.
- **M4:** flujo automático (llega el mensaje → se interpreta y sugiere solo), colas,
  reevaluación por tiempo, oportunidades estancadas.
- **M5:** notificaciones, aprobación del vendedor, escalamiento.
- **M6:** enviar la respuesta por WhatsApp.
- **Integraciones:** calendario, stock, pedidos y pagos para datos en vivo.
- Registrar negocios y números de WhatsApp reales; cargar conocimiento desde pantalla o PDF.

Detalles técnicos: [`docs/SYSTEM.md`](./SYSTEM.md) y [`apps/api/README.md`](../apps/api/README.md).
