# Correcciones de estado, reacciones y audio en conversaciones

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Corregir la sincronización de estados `sent`/`delivered`/`read` para Evolution, evitar líneas vacías al recibir reacciones y dejar especificada la reproducción de audios en la bandeja.

**Architecture:** Mantener la normalización de Evolution separada del pipeline común. Los estados se resolverán desde `MESSAGES_UPDATE` y se aplicarán de forma monotónica a la fila local, sin permitir que un `MESSAGES_UPSERT` posterior degrade un estado ya avanzado. Las reacciones entrantes se representarán como datos asociados al mensaje original; si Evolution no permite localizarlo de forma confiable, se persistirá un mensaje visual con el emoji como fallback, nunca una burbuja vacía. El audio se resolverá y persistirá con la misma estrategia best-effort ya usada para imágenes/vídeos, y la UI usará un reproductor HTML5 con descarga.

**Tech Stack:** Next.js/React, TypeScript, Supabase Realtime/Postgres, Evolution API v2.3.7, Vitest.

---

## Contexto confirmado

- La rama `custom` ya contiene Spec1 y Spec2 para media de imágenes/vídeos y ecos `fromMe`.
- `src/lib/whatsapp/providers/evolution-adapter.ts` normaliza `MESSAGES_UPSERT` y `MESSAGES_UPDATE`.
- `src/app/api/whatsapp/evolution/webhook/route.ts` actualiza estados por `message_id`, pero `handleFromMeEcho` fuerza cualquier eco existente a `delivered`.
- La UI ya tiene `MediaAudioBubble`, pero la resolución de media de Evolution solo se invoca para `image` y `video`; los audios entrantes pueden quedar sin `media_url`.
- La UI de reacciones agrupa `message_reactions` por `message_id`; la línea vacía probablemente proviene de persistir una reacción entrante como mensaje sin contenido o de no resolver el mensaje objetivo.
- La migración 047 fue entregada al usuario para ejecución manual y no debe modificarse ni aplicarse desde este trabajo sin autorización adicional.

## Reglas de entrega

- Documentar y aprobar cada especificación antes de implementarla.
- Un commit y push por especificación; no mezclar estado, reacciones y audio en un mismo commit.
- No modificar Railway/Supabase ni exponer secretos.
- Cada cambio debe tener tests unitarios; la prueba real contra Evolution y navegador se hará aparte con autorización y datos reales.

---

# Spec 3 — Estados Delivered/Read de mensajes outbound

**Objetivo:** Que los mensajes enviados desde el teléfono vinculado y desde la bandeja reflejen correctamente `sent`, `delivered` y `read`.

### Investigación previa obligatoria

1. Capturar, sin registrar API keys ni cuerpos sensibles, ejemplos reales de:
   - `MESSAGES_UPSERT` para un mensaje enviado desde el teléfono.
   - `MESSAGES_UPDATE` al entregarse y leerse ese mensaje.
   - Mensaje enviado desde WaCRM y sus eventos posteriores.
2. Confirmar en esos payloads dónde aparecen el id (`key.id`, `keyId` u otra forma), el estado (`status`, `update.status`, `update.update.status`) y el timestamp.
3. Confirmar si los estados llegan como `PENDING`, `SERVER_ACK`, `DELIVERY_ACK`, `READ`, `PLAYED`, `ERROR` u otra nomenclatura de Baileys/Evolution.

### Archivos probables

- Modificar: `src/lib/whatsapp/providers/evolution-adapter.ts`
- Modificar: `src/app/api/whatsapp/evolution/webhook/route.ts`
- Modificar: `src/lib/whatsapp/providers/types.ts` solo si hace falta documentar estados recibidos
- Tests: `src/lib/whatsapp/providers/evolution-adapter.test.ts`
- Tests: `src/app/api/whatsapp/evolution/webhook/route.test.ts`
- Posible test de regresión de componente: `src/components/inbox/message-bubble.tsx`

### Implementación prevista

1. Extender `#normalizeMessagesUpdate` para aceptar todas las formas reales del payload y mapear explícitamente cada estado de Evolution a la escala local.
2. Rechazar actualizaciones sin id o con estado desconocido de manera observable y segura, sin modificar la fila.
3. Aplicar una transición monotónica en el webhook: `sending → sent → delivered → read`; `failed` solo cuando el proveedor lo indique. Un evento atrasado no debe degradar `read` a `delivered`.
4. Cambiar `handleFromMeEcho` para que un `MESSAGES_UPSERT` existente no fuerce siempre `delivered`; debe conservar el estado actual y solo completar un estado inicial cuando corresponda.
5. Actualizar el mensaje optimista de la bandeja con el id/status devuelto por `/api/whatsapp/send` o garantizar que el INSERT realtime lo reemplace por la fila real; no declarar `delivered` localmente antes de recibir confirmación del proveedor.
6. Mantener la actualización de `broadcast_recipients` y webhooks públicos coherente con el estado final.

### Tests y aceptación

- Test de normalización para cada forma real de `MESSAGES_UPDATE`.
- Test de mapeo `sent`, `delivered`, `read`, `failed` y estados Baileys equivalentes.
- Test de no degradación: `read` no vuelve a `delivered`; `delivered` no vuelve a `sent`.
- Test de eco `fromMe` existente que conserva `read`/`delivered`.
- Test de mensaje `fromMe` nuevo que conserva `sent` hasta recibir el evento de estado.
- Ejecutar tests específicos, typecheck y lint; después suite completa.
- Verificación manual posterior: enviar desde teléfono y bandeja, observar checks en navegador y comparar con estados recibidos, sin mostrar secretos.

**Commit esperado:** `fix: sync evolution outbound message statuses`

---

# Spec 4 — Reacciones entrantes sin líneas vacías

**Objetivo:** Mostrar las reacciones recibidas sin crear una burbuja vacía; preferentemente junto al mensaje original y, si no es posible, como mensaje nuevo visible con el emoji.

### Investigación previa obligatoria

1. Capturar ejemplos reales del evento de reacción de Evolution v2.3.7 y confirmar si llega como `MESSAGES_UPSERT`, `MESSAGES_UPDATE` u otro evento.
2. Identificar el id del mensaje reaccionado (`key.id`, `reactionMessage.key.id`, `messageContextInfo`, `stanzaId` u otra forma), emoji, actor/JID y timestamp.
3. Verificar si el id corresponde a `messages.message_id` local y si las reacciones del cliente pueden usar la tabla `message_reactions` existente.

### Archivos probables

- Modificar: `src/lib/whatsapp/providers/types.ts` para agregar un evento normalizado de reacción, si conviene separarlo de mensajes.
- Modificar: `src/lib/whatsapp/providers/evolution-adapter.ts`
- Modificar: `src/app/api/whatsapp/evolution/webhook/route.ts`
- Modificar: `src/components/inbox/message-thread.tsx` y/o `src/components/inbox/message-bubble.tsx` para fallback visual
- Modificar: `src/components/inbox/message-reactions.tsx` solo si necesita distinguir reacción entrante/no interactiva
- Tests: `src/lib/whatsapp/providers/evolution-adapter.test.ts`
- Tests: `src/app/api/whatsapp/evolution/webhook/route.test.ts`
- Tests: componente o helper nuevo para renderizado de fallback

### Implementación prevista

1. Normalizar una reacción como evento explícito con `targetProviderMessageId`, `emoji`, actor y timestamp; no convertirla en mensaje de texto vacío.
2. Si el mensaje objetivo existe localmente, hacer upsert idempotente en `message_reactions` con `actor_type='customer'`, usando una restricción/clave compatible con el modelo existente. No crear mensaje adicional.
3. Si el objetivo no existe o el proveedor no entrega un id resoluble, crear un mensaje fallback con `content_type='text'`, `content_text` igual al emoji y una marca interna/metadata que permita mostrarlo como reacción; nunca insertar `content_text` nulo o vacío para que no aparezca una línea vacía.
4. Hacer que la agrupación/realtime de reacciones refresque el mensaje original sin duplicados.
5. Preservar idempotencia ante reintentos del webhook y no disparar automatizaciones de mensaje entrante por una reacción.
6. Si la tabla necesita una clave única nueva, documentar una migración separada y no aplicarla automáticamente.

### Tests y aceptación

- Payload real normalizado como reacción con emoji y mensaje objetivo.
- Reacción aplicada al mensaje original, visible junto a él.
- Reacción sin objetivo resoluble produce un fallback visible con el emoji, nunca una burbuja vacía.
- Reintento del mismo evento no duplica reacción ni mensaje fallback.
- La retirada de una reacción (`emoji=''` o equivalente del proveedor) elimina/actualiza la reacción correctamente cuando el proveedor lo soporte.
- Suite específica, typecheck, lint y suite completa.
- Verificación manual con una reacción enviada desde WhatsApp y revisión de la bandeja.

**Commit esperado:** `fix: render evolution customer reactions`

---

## Spec 3 — reproducción de audios en la bandeja

**Objetivo:** Que los audios y mensajes de voz recibidos desde Evolution se resuelvan como `audio`/`ptt`, persistan con `media_url`/`media_type` con el MIME real, y reproduzcan con `<audio controls>` + descarga manual.

### Hechos confirmados

- `src/lib/whatsapp/providers/evolution-media.ts` YA extrae `audioMessage` (mimetype/caption/filename) en `extractEvolutionMediaMeta`, YA incluye `audioMessage` en `extractInlineBase64`, y `fetchEvolutionMediaBase64` es genérico por contenido.
- El webhook (`route.ts`) solo llama a `resolveEvolutionMessageMedia` para `image`/`video`. El mismo `if` aparece en ambos caminos: `handleInboundMessage` y `handleFromMeEcho`. Es el único hueco.
- El adaptador (`evolution-adapter.ts`) normaliza `audioMessage` → contentType `audio` en `normalizeHistoricalMessage`.
- `src/components/inbox/message-bubble.tsx` ya renderiza `audio` con `MediaAudioBubble` (`<audio controls>` + descarga) o `MediaUnavailable`.
- `src/lib/media/gallery.ts` YA excluye audio del lightbox (solo `image`/`video`), verificado por `gallery.test.ts`.
- `src/lib/media/filename.ts` ya mapea `audio/ogg`, `audio/mpeg`, `audio/opus`, `audio/mp4` (m4a), `audio/aac`, `audio/amr`.

### Hipótesis sin payload real

- El `mimetype` de Evolution para mensajes de voz suele ser `audio/ogg; codecs=opus` (Baileys) o `audio/mp4`. `extractEvolutionMediaMeta` ya conserva el valor tal cual llega.
- `getBase64FromMediaMessage` acepta el mismo `message.key.id` para audio. No se valida sin payload real, pero el endpoint no discrimina por tipo.

### Implementación

- Extender la condición de resolución de media en `route.ts` para incluir `audio` en `handleInboundMessage` y `handleFromMeEcho`.
- Nada más en la UI: `<audio controls>` y descarga ya existen; no autoplay.
- No se agrega migración. No se cambia el contrato de tipos.

### Tests

- Audio válido persistido con `media_url`/`media_type` (MIME preservado) en inbound y fromMe.
- Falla de resolución persiste el mensaje con `media_url=null`, sin ocultar la conversación.
- `extractEvolutionMediaMeta` preserva `audio/ogg`, `audio/mpeg`, `audio/mp4`.
- `collectMediaGallery` excluye audio.

**Commit esperado:** `feat: play evolution audio in inbox`

**Objetivo:** Persistir el audio recibido desde Evolution y permitir reproducirlo directamente en la bandeja, con descarga y estado de error claro.

### Archivos probables

- Modificar: `src/lib/whatsapp/providers/evolution-media.ts`
- Modificar: `src/lib/whatsapp/providers/evolution-adapter.ts` si el MIME/tipo de audio no se normaliza correctamente
- Modificar: `src/app/api/whatsapp/evolution/webhook/route.ts`
- Modificar: `src/components/inbox/message-media.tsx` y posiblemente `src/components/inbox/message-bubble.tsx`
- Modificar: `src/lib/media/gallery.ts` solo si el audio debe excluirse explícitamente de galerías visuales
- Tests: `src/lib/whatsapp/providers/evolution-media.test.ts`
- Tests: `src/app/api/whatsapp/evolution/webhook/route.test.ts`
- Tests: `src/components/inbox/message-media.test.tsx` si existe infraestructura adecuada

### Implementación prevista

1. Extender `resolveEvolutionMessageMedia` para `audioMessage`, incluyendo mensajes de voz (`ptt`), preservando MIME (`audio/ogg`, `audio/mpeg`, etc.) y resolviendo bytes mediante la API existente de Evolution.
2. Invocar la resolución para `audio` en ambos caminos: inbound y `fromMe`, con la misma política best-effort: si falla, persistir el mensaje y mostrar `MediaUnavailable`.
3. Mantener el audio fuera de la galería de imágenes/vídeos.
4. Confirmar que el bucket/proxy entrega un MIME reproducible por navegador y que `MediaAudioBubble` maneja carga/error sin romper el hilo.
5. Añadir controles accesibles, descarga y texto alternativo/localizado; no descargar automáticamente ni reproducir sin interacción del usuario.
6. Evaluar límites de tamaño y formatos no reproducibles: mostrar fallback y conservar descarga cuando el navegador no soporte el códec.

### Tests y aceptación

- Resolución de audio/voz con respuesta válida de Evolution y MIME correcto.
- Falla de resolución no impide guardar caption/texto ni oculta la conversación.
- Audio persistido con `media_url` y `media_type` y renderizado con `<audio controls>`.
- No inclusión de audios en la galería visual.
- Ejecutar suite específica, typecheck, lint y suite completa.
- Verificación manual: recibir un audio real, reproducirlo desde la bandeja, pausar, reanudar y descargarlo.

**Commit esperado:** `feat: play evolution audio in inbox`

---

## Orden de ejecución y dependencias

1. Especificación 3: capturar y fijar primero el contrato real de estados.
2. Especificación 4: capturar el contrato real de reacciones y decidir asociación vs fallback.
3. Especificación 5: reutilizar el patrón de media ya verificado y añadir audio.
4. Tras cada especificación: tests → typecheck → lint → revisión → commit/push separado.
5. Solo después de los tres cambios y con autorización: prueba de runtime contra Evolution y navegador.

## Spec 2 — contrato concreto fijado antes de implementar (2026-09-03)

### Hechos confirmados

- El adaptador solo acepta `messages.upsert`/`messages_upsert`; eventos desconocidos se ignoran.
- La migración `009_message_actions.sql` ya tiene `message_reactions`, con `actor_type` `customer|agent`, `emoji NOT NULL` y unicidad lógica `(message_id, actor_type, actor_id)`. No se crea ni aplica migración.
- La UI ya suscribe INSERT/UPDATE/DELETE de `message_reactions` por `conversation_id` y agrupa por el UUID local del mensaje; una reacción no necesita una fila en `messages` cuando el objetivo se resuelve.
- Baileys, que usa Evolution, representa el envío como `message.reactionMessage` con `reactionMessage.text` (emoji, vacío para retirar) y `reactionMessage.key` apuntando al mensaje objetivo. El actor se obtiene de la clave exterior (`key.remoteJid`/`key.participant`); el objetivo usa `reactionMessage.key.id` y su JID.
- La documentación pública de Evolution v2 enumera `MESSAGES_UPSERT` como evento de recepción y no documenta un evento separado de reacciones. La forma exacta de un webhook de v2.3.7 debe considerarse confirmada por código/Baileys, pero no por un payload real de esta instancia.

### Decisiones de implementación

- Normalizar `reactionMessage` dentro de `MESSAGES_UPSERT` como evento explícito `NormalizedReactionEvent`, sin convertirlo en `NormalizedInboundEvent`.
- Extraer `targetProviderMessageId`, `emoji`, `actorJid`, `remoteJid`, `timestamp` y `providerMessageId` de la reacción. Se omite si faltan id, JID o emoji válido.
- En el webhook: localizar el mensaje objetivo por `messages.message_id` y el JID/conversación del actor; resolver el contacto para usar su UUID como `actor_id`; upsert/delete en `message_reactions` con `actor_type='customer'`. Nunca se ejecutan automations, flows, AI, unread ni `messages.insert` para una reacción resuelta.
- Para objetivo no resoluble se crea, como máximo, un fallback `messages` idempotente con `content_type='text'` y `content_text` igual al emoji; no se inserta texto nulo/vacío. Si no hay JID o emoji no se crea fallback.
- La retirada (`text=''`) elimina la reacción del objetivo cuando este existe; cambios de emoji hacen upsert del mismo actor. La idempotencia se garantiza buscando la fila existente por objetivo/conversación/actor y usando el id de reacción para el fallback.

### Hipótesis y límites

- Hipótesis: en un chat directo, la clave exterior identifica al actor y `reactionMessage.key.remoteJid` identifica el chat; en grupos puede ser necesario `participant`/`participantAlt`, no soportado como conversación individual por el modelo actual.
- Solo un payload real de Evolution v2.3.7 puede confirmar si esta instalación conserva `participant`, `remoteJidAlt` o una envoltura adicional, y si las reacciones llegan también por `MESSAGES_UPDATE`. No se simula esa evidencia.

### Aceptación adicional

- Tests de normalización para reacción directa, cambio/retirada y payload sin objetivo.
- Tests del flujo de persistencia garantizan upsert idempotente, fallback no vacío y cero fan-out de mensaje entrante.

---

## Spec 3 — reproducción de audios en la bandeja

**Objetivo:** Que los audios y mensajes de voz recibidos desde Evolution se resuelvan como `audio`, persistan con `media_url`/`media_type` con el MIME real, y reproduzcan con `<audio controls>` + descarga manual.

### Hechos confirmados

- `src/lib/whatsapp/providers/evolution-media.ts` YA extrae `audioMessage` (mimetype) en `extractEvolutionMediaMeta`, YA incluye `audioMessage` en `extractInlineBase64`, y `fetchEvolutionMediaBase64` es genérico (funciona por `message.key.id`).
- El webhook (`route.ts`) solo llama a `resolveEvolutionMedia` para `image`/`video` en `handleInboundMessage` y `handleFromMeEcho`. Ese `if` es el único hueco.
- El adaptador normaliza `audioMessage` → contentType `audio` en `normalizeHistoricalMessage`.
- `message-bubble.tsx` ya renderiza `audio` con `MediaAudioBubble` (`<audio controls>` + descarga) o `MediaUnavailable`.
- `gallery.ts` YA excluye audio del lightbox (solo `image`/`video`).

### Implementación

- Ampliar la condición `media` en `route.ts` a `['image','video','audio']` en ambos caminos.
- Nada más en UI: `<audio controls>` + descarga ya existen; no autoplay.
- No migración, no cambio de tipos.

### Tests

- Audio válido resuelto y persistido con MIME (`audio/ogg; codecs=opus`) en inbound y fromMe.
- Fallo de resolución persiste el mensaje con `media_url=null`, sin ocultar conversación.
- `extractEvolutionMediaMeta` preserva `audio/ogg`, `audio/mpeg`, `audio/mp4`.
- `collectMediaGallery` excluye audio.

**Commit esperado:** `feat: play evolution audio in inbox`

---

## Riesgos y límites

- El `mimetype` exacto de Evolution para ptt suele ser `audio/ogg; codecs=opus` (Baileys), no se valida sin payload real.
- `getBase64FromMediaMessage` no discrimina por tipo; se confía en el mismo contrato que image/video.

---

## Orden de ejecución y dependencias

- Evolution/Baileys puede emitir estados numéricos o nombres distintos según el endpoint; no se debe fijar el mapeo final sin payload real.
- Una reacción puede referenciar un mensaje que aún no llegó a la base local; se necesita una estrategia de reintento o fallback determinista.
- Los audios de WhatsApp suelen ser OGG/Opus; algunos navegadores pueden variar en soporte, por lo que debe conservarse descarga y mensaje de error.
- La prueba en vivo requiere que el usuario envíe mensajes/reacciones/audios desde su teléfono; no debe simularse como evidencia de runtime.
