# Demo KEOM — todo lo construido hasta ahora

**Estado:** M1 + M2A + M2B + M3 + M4 · **Última actualización:** 2026-10-02 (cierre de M4)

Una sola historia, de punta a punta, para el equipo técnico: llega un mensaje de WhatsApp,
la IA lo interpreta, el motor decide qué hacer con la oportunidad y KEOM sugiere qué responder
usando solo la información que cargó el negocio; y si nadie responde, KEOM vuelve a mirar la
oportunidad más tarde y detecta que se está enfriando. Cada paso se explica en dos niveles:
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
   ├─ M3   Conocimiento   busca info verificada del negocio y sugiere        src/knowledge
   │                      una respuesta basada solo en ella (no la envía)
   └─ M4   Tiempo         decide CUÁNDO volver a mirar la oportunidad y      src/reevaluation
                          le pide a M2A que la reevalúe con datos frescos
```

| Capa | Pregunta que responde | Usa IA | Decide |
|---|---|---|---|
| M2B | ¿Qué quiere decir el cliente? | Sí (OpenAI) | No, solo interpreta |
| M2A | ¿Qué debería pasar comercialmente? | No (reglas fijas) | Sí |
| M3 | ¿Qué información verificada del negocio sirve aquí? | Sí (embeddings + OpenAI) | No, solo sugiere |
| M4 | ¿Cuándo hay que volver a mirar esta oportunidad? | No (temporizadores en Redis) | No, le pide a M2A que reevalúe |

## 1. Preparar (una sola vez)

Necesitas Docker Desktop, Node 20+, pnpm y una API key de OpenAI. Desde la raíz del repo:

```bash
pnpm install
cd apps/api
cp .env.example .env
docker compose up -d        # Postgres 16 + pgvector, y Redis (M4)
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
REDIS_URL=redis://localhost:6380
```

Para la demo (paso 7), que KEOM considere "sin respuesta" en minutos y no en horas. Agrega
esto solo en tu `.env` local, nunca en producción:

```
OPPORTUNITY_STALL_MEDIUM_MINUTES=1
OPPORTUNITY_STALL_HIGH_MINUTES=2
REEVALUATION_GRACE_SECONDS=5
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

Se puede correr las veces que quieras sin reiniciar la base: cada corrida usa clientes con
números nuevos (conversaciones y oportunidades nuevas) y recarga el conocimiento de los dos
negocios de prueba. Tarda unos 3 minutos: el paso 7 espera a que corran los chequeos de M4.

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

### Paso 7 — El tiempo pasa: ¿alguien respondió?

```
Lucía: "Sí, quiero reservar para el sábado"
M2B/M2A:          BOOKING_INTENT · interés HIGH · ENGAGED · riesgo LOW · score 50
M4 reevaluación:  programada: NO_BUSINESS_REPLY a las 6:18:03 PM; NO_BUSINESS_REPLY a las 6:19:03 PM
Mateo: "Sí, quiero reservar para el sábado"   (lo mismo, con sus propios chequeos)
Negocio a Mateo:  "¡Hola Mateo! Te reservo el sábado."   (registrado; no se envía nada)
Esperando 127s a que corran los chequeos .............
M4 → M2A Lucía (sin respuesta):       ENGAGED/riesgo LOW → AT_RISK/riesgo HIGH
M4 → M2A Mateo (le respondieron):     ENGAGED/riesgo LOW → ENGAGED/riesgo LOW (sin cambios: no se escribió nada)
```

**Negocio:** dos clientas piden reservar. A Mateo el negocio le responde; a Lucía, nadie.
Pasado el tiempo, KEOM detecta que la oportunidad de Lucía se está enfriando (`AT_RISK`) y la
de Mateo no. Es la alerta de "venta que se puede perder" que el vendedor verá cuando existan
notificaciones (M5).

**Técnico:** cada evaluación programa chequeos en Redis (BullMQ) justo después de los umbrales
de M2A (aquí 1 y 2 minutos; en producción 1h y 4h). Cuando un chequeo corre, M4 no decide
nada: recarga la oportunidad y los mensajes frescos desde Postgres y llama a
`OpportunitiesService.reevaluate()`, que usa el mismo motor determinístico de M2A. Para Mateo,
M2A ve la respuesta del negocio y devuelve el mismo resultado, así que no se escribe nada. Los
chequeos de Andrea (pasos 2-5) también corren en segundo plano.

Si la API corre sin `REDIS_URL`, este paso lo explica y se salta; con los umbrales por defecto
(1h/4h) muestra a qué hora correrán los chequeos en vez de esperar.

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
| M4 | KEOM no ve las respuestas reales del vendedor (solo el endpoint de desarrollo las registra) | En uso real, toda oportunidad con interés alto terminaría `AT_RISK` | Capturar respuestas del negocio (statuses/echoes de Meta) antes de usar M4 con clientes |
| M4 | No existe `NO_CUSTOMER_REPLY` (el cliente dejó de responder después del negocio) | Ese caso no se detecta | Primero una regla en M2A, luego el disparador en M4 |
| M2A | "Sí, quiero reservar" sola da score 50 → `ENGAGED`, no `HIGH_INTENT` | Una reserva clara no se ve como alta intención hasta que pregunte disponibilidad | Revisar pesos de M2A si negocio lo considera necesario |
| M4 | Si Redis pierde sus datos, los chequeos programados se pierden | Oportunidades que no se reevalúan | Persistencia AOF ya activa; un "barrido" de recuperación queda pendiente |
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
| M4 | `POST /dev/opportunities/:id/reevaluations` | Programar un chequeo a una hora concreta (`FOLLOW_UP_DUE`) |
| M4 | `POST /dev/conversations/:id/business-replies` | Registrar que el negocio respondió (no envía nada) |

Ejemplo, buscar en la clínica:

```bash
curl -s -X POST http://localhost:3001/dev/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{"companyId":"00000000-0000-4000-8000-000000000001","query":"¿cuánto cuesta?"}'
```

Ver los chequeos programados en Redis:

```bash
docker compose exec redis redis-cli ZRANGE bull:opportunity-reevaluation:delayed 0 -1
```

Ver los datos guardados (clientes, conversaciones, mensajes, oportunidades con su historial de
estados, documentos y fragmentos):

```bash
pnpm prisma:studio
```

## 6. Qué falta (próximas fases)

- **Fase 11:** conectar el dashboard (`apps/web`) a esta API, para ver esto en pantalla.
- **Respuestas reales del vendedor:** hoy KEOM no ve cuándo el negocio responde por WhatsApp
  (por eso existe el endpoint de desarrollo). Hasta capturarlas, M4 marcaría todo como "sin
  respuesta".
- **Flujo automático:** llega el mensaje → se interpreta, decide y sugiere solo (hoy son
  llamadas manuales a `/dev/...`).
- **M5:** notificaciones, aprobación del vendedor, escalamiento.
- **M6:** enviar la respuesta por WhatsApp.
- **Integraciones:** calendario, stock, pedidos y pagos para datos en vivo.
- Registrar negocios y números de WhatsApp reales; cargar conocimiento desde pantalla o PDF.

Detalles técnicos: [`docs/SYSTEM.md`](./SYSTEM.md) y [`apps/api/README.md`](../apps/api/README.md).
