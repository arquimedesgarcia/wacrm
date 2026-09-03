# Evolution WhatsApp: mensajes enviados desde el teléfono

> Especificación para Hermes. No incluye implementación ni aplicación de migraciones.

**Objetivo:** Registrar en la conversación correcta los mensajes que salen desde el teléfono conectado a WhatsApp/Evolution, incluyendo texto, imágenes y demás tipos soportados, sin duplicar mensajes enviados desde WaCRM.

**Arquitectura:** Los eventos Evolution con `key.fromMe === true` se tratarán como ecos de mensajes enviados desde WaCRM solo cuando exista una fila coincidente. Cuando no exista, se resolverá el destinatario a partir del JID, se localizará el contacto y la conversación existente, y se insertará un mensaje outbound nuevo con idempotencia. Después se actualizará el resumen de conversación y se notificará a Realtime.

**Tech Stack:** Next.js/TypeScript, Evolution API v2.3.7, Supabase Postgres/Realtime, Vitest.

---

## 1. Diagnóstico confirmado

### Flujo actual

1. `EvolutionAdapter.normalizeHistoricalMessage()` detecta `key.fromMe === true` y devuelve `isFromMe: true`.
2. `processEvolutionWebhook()` desvía esos eventos a `handleFromMeEcho()`.
3. `handleFromMeEcho()` busca únicamente una fila en `messages` por `message_id`.
4. Si el mensaje fue enviado desde el teléfono, normalmente no existe una fila previa creada por WaCRM.
5. En ese caso la función termina sin insertar nada, sin actualizar la conversación y sin disparar el flujo realtime de la bandeja.

### Causa raíz

El código interpreta todo `fromMe` como confirmación de un envío originado en WaCRM. No contempla el caso de un mensaje nuevo originado en el teléfono enlazado.

---

## 2. Alcance

### Incluye

- Mensajes de texto escritos desde el teléfono.
- Mensajes outbound cuyo evento `fromMe` llega después de un envío iniciado en WaCRM.
- Idempotencia por `(conversation_id, provider_message_id)`.
- Resolución del destinatario mediante JID, incluyendo `remoteJidAlt` cuando sea necesario.
- Actualización de `conversations.last_message_text`, `last_message_at` y `updated_at`.
- Realtime para que el mensaje aparezca en un hilo abierto y la conversación se actualice en la lista.
- Imágenes outbound desde el teléfono, coordinado con la especificación de media.

### No incluye

- Crear conversaciones para grupos, broadcasts, newsletters o JIDs no resolubles.
- Reconciliación completa de mensajes históricos antiguos sin evento nuevo.
- Cambios de infraestructura o sincronización masiva de la base Evolution.

---

## 3. Diseño propuesto

### 3.1 Separar confirmación de inserción nueva

**Archivo:** `src/app/api/whatsapp/evolution/webhook/route.ts`

Reemplazar la semántica actual de `handleFromMeEcho()` por una función con dos caminos:

#### Camino A — existe fila local

- Buscar por `message_id` y, cuando sea posible, limitar por cuenta/conversación.
- Actualizar estado sin cambiar `sender_type`, contenido ni conversación.
- No ejecutar `bump_conversation_on_inbound`.
- No disparar automatizaciones inbound, flujos o AI.
- No crear duplicado.

#### Camino B — no existe fila local

1. Resolver el teléfono destino desde `event.rawPayload.key.remoteJid` y campos alternos.
2. Ignorar grupos/broadcast/newsletter y JIDs sin teléfono válido.
3. Buscar el contacto por `(account_id, phone)`, usando `findExistingContact`.
4. Si no existe contacto, decidir explícitamente una política: recomendada, crear contacto con el nombre disponible del evento o el teléfono.
5. Buscar la conversación canónica `(account_id, contact_id)`.
6. Si no existe, crearla de forma segura; no crear otra si hay carrera.
7. Insertar:
   - `sender_type: 'agent'`;
   - `content_type` normalizado;
   - `content_text` o caption;
   - `media_url`/`media_type` si es media;
   - `message_id: providerMessageId`;
   - estado inicial `sent` o el estado de Evolution, según el contrato;
   - timestamp del evento.
8. Si la inserción ya existe por carrera/reentrega, terminar sin efectos duplicados.
9. Actualizar el resumen de la conversación con una función separada de la de mensajes entrantes; no incrementar `unread_count` como si fuera un mensaje del cliente.

### 3.2 Resolver el destinatario

**Archivos:** `src/lib/whatsapp/providers/jid.ts`, `src/lib/whatsapp/providers/evolution-adapter.ts`

- Conservar en `rawPayload` los campos necesarios para el destinatario.
- Para un `fromMe` de chat individual, `remoteJid` representa el destinatario y debe resolverse como teléfono.
- No usar el teléfono propio de la instancia como contacto.
- Rechazar JIDs de grupo, broadcast, newsletter, `lid` sin mapping y valores no E.164.
- Añadir tests para device suffix y `remoteJidAlt`.

### 3.3 Realtime y conversación activa

**Archivos:** `src/hooks/use-realtime.ts`, `src/app/(dashboard)/inbox/page.tsx`

- El INSERT de `messages` debe agregar el mensaje al hilo activo cuando `conversation_id` coincide.
- Para conversaciones no activas, el INSERT debe actualizar el resumen o provocar una recarga segura.
- No incrementar unread para un mensaje `sender_type: 'agent'`.
- Evitar que el handler de `conversations` sobrescriba un resumen más nuevo con un payload atrasado.
- Mantener la consulta base de la lista independiente de la consulta opcional de media.

### 3.4 Estados y status updates

**Archivo:** `src/app/api/whatsapp/evolution/webhook/route.ts`

- Un `MESSAGES_UPDATE` posterior debe actualizar la fila creada desde el teléfono por su `message_id`.
- Debe conservarse el estado más avanzado, sin regresiones por eventos atrasados.
- Los mensajes creados desde el teléfono no deben considerarse broadcasts salvo que exista una relación explícita.

### 3.5 Imágenes enviadas desde el teléfono

Coordinar con `2026-09-03_174500-evolution-inbound-media.md`:

- `fromMe` no significa que sea inbound para el CRM: el `sender_type` será `agent`.
- El media se descarga desde Evolution, se persiste en `chat-media` y se guarda una URL durable.
- La imagen debe aparecer en el hilo y en la miniatura de la bandeja.
- El proceso debe ser idempotente respecto al provider message id.

---

## 4. Pruebas obligatorias (TDD)

### Adaptador

**Archivo:** `src/lib/whatsapp/providers/evolution-adapter.test.ts`

1. `fromMe: true` conserva `isFromMe`.
2. El evento conserva el JID destino y los campos alternos en `rawPayload`.
3. Se normaliza texto outbound.
4. Se normaliza imagen outbound con caption y metadatos.
5. Se ignoran JIDs no individuales.

### Webhook

**Archivo:** `src/app/api/whatsapp/evolution/webhook.test.ts` o el test de ruta correspondiente.

1. Un `fromMe` con fila existente solo actualiza status.
2. Un `fromMe` sin fila existente inserta una fila `sender_type: 'agent'`.
3. La fila se inserta en la conversación existente del destinatario.
4. No aumenta `unread_count`.
5. Se actualizan `last_message_text` y `last_message_at`.
6. Reentrega del mismo evento no duplica mensaje ni conversación.
7. Dos eventos concurrentes no crean filas duplicadas.
8. Un grupo o JID no resoluble se ignora sin crear contacto.
9. Una imagen `fromMe` se guarda con URL/MIME cuando el descargador funciona.
10. Un fallo de descarga no elimina el mensaje de texto/caption ni rompe el webhook.

### Realtime/UI

Verificar que:

- el mensaje aparece en el thread activo sin recargar la página;
- aparece en una conversación que estaba en la lista;
- una conversación no listada se hidrata una sola vez;
- el preview de la lista muestra el contenido más reciente;
- los mensajes del agente no generan badge de unread.

---

## 5. Criterios de aceptación

- Una respuesta escrita desde el teléfono aparece en la conversación correcta de WaCRM.
- El mensaje se identifica como outbound (`agent`), no como mensaje entrante del cliente.
- Aparece sin recarga manual en un hilo abierto cuando Realtime está disponible; el refresh recupera el mensaje cuando Realtime no lo estuvo.
- La conversación existente actualiza su último mensaje y permanece visible según los filtros de la bandeja.
- Un mensaje enviado desde WaCRM que luego genera eco no se duplica.
- Reentregas y carreras no duplican mensajes.
- No se incrementa unread por mensajes propios.
- Las imágenes outbound desde el teléfono se visualizan cuando Evolution las entrega y Storage puede persistirlas.

---

## 6. Riesgos y decisiones pendientes

- **Significado de `remoteJid` en el payload real:** debe validarse con un fixture anonimizado de la instancia del usuario antes de implementar; no usar credenciales ni payloads sensibles en documentación.
- **Nombre del contacto nuevo:** política recomendada: usar `pushName` si existe y, si no, el teléfono.
- **Estado inicial:** usar `sent` salvo que Evolution proporcione un estado compatible y validado.
- **Mensajes enviados fuera de WaCRM:** aparecerán como `agent`, pero deben distinguirse visualmente de mensajes creados por un agente dentro de WaCRM solo si el producto lo requiere; no inventar un nuevo tipo sin necesidad.
- **Automatizaciones:** no ejecutar triggers inbound para mensajes `fromMe`.
- **Orden temporal:** usar timestamp del proveedor para el mensaje, pero el resumen debe protegerse contra eventos atrasados.

---

## 7. Rollback

- Restaurar `handleFromMeEcho()` al comportamiento anterior solo si el nuevo camino falla.
- Las filas ya insertadas no deben borrarse automáticamente.
- Revertir únicamente los cambios de ingestión Evolution; no tocar el webhook Meta.
