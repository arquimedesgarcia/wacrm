# Especificación: correcciones y mejoras pendientes de Evolution API

- **Estado:** especificación para implementación
- **Fecha:** 2026-09-02
- **Rama de referencia:** `custom`
- **Dependencias:** migración 040, adaptador Evolution v2.3.7

## 1. Objetivo

Cerrar los tres puntos pendientes reportados sobre la integración Evolution API:

1. El panel de WhatsApp consulta siempre el endpoint de Meta para el health check, incluso cuando el proveedor activo es Evolution.
2. La integración no importa contactos ni historial de mensajes previos de Evolution; solo procesa eventos nuevos entrantes por webhook.
3. Verificar que el webhook registrado en Evolution use una URL plana, sin prefijos tipo `@url:` ni backticks.

Esta especificación no modifica código; define el diseño para que la implementación sea directa y revisable.

## 2. Problema 1: health check condicional por proveedor

### 2.1 Diagnóstico

En `src/components/settings/whatsapp-config.tsx`, `fetchConfig()` siempre ejecuta:

```ts
const res = await fetch('/api/whatsapp/config', { method: 'GET' });
```

`GET /api/whatsapp/config` está pensado para Meta: descifra `access_token`, llama a `verifyPhoneNumber` y devuelve el estado de la conexión con Meta. Cuando `provider === 'evolution'`, la fila no tiene `access_token` Meta válido, por lo que el health check falla y el panel muestra estado desconectado aunque Evolution esté operativo.

El panel de Evolution (`EvolutionConfigPanel`) sí tiene su propio `handleTestConnection` que llama a `/api/whatsapp/evolution/config`, pero el estado inicial del contenedor `WhatsAppConfig` se decide antes de renderizar el panel específico, usando la respuesta incorrecta de Meta.

### 2.2 Comportamiento esperado

- Si la fila guardada tiene `provider === 'evolution'`, `fetchConfig()` debe consultar `/api/whatsapp/evolution/config`.
- Si la fila guardada tiene `provider === 'meta'` o no tiene proveedor (filas legacy), debe consultar `/api/whatsapp/config`.
- El botón "Test Connection" en el panel de Meta debe seguir llamando a `/api/whatsapp/config`.
- El botón "Test Connection" en el panel de Evolution debe seguir llamando a `/api/whatsapp/evolution/config`.

### 2.3 Cambios propuestos

**Archivo:** `src/components/settings/whatsapp-config.tsx`

- En `fetchConfig()`, después de cargar la fila de `whatsapp_config`, leer `data.provider`.
- Si `provider === 'evolution'` y existe config:
  - Llamar `fetch('/api/whatsapp/evolution/config', { method: 'GET' })`.
  - Mapear la respuesta a `connectionStatus`/`statusMessage`:
    - `connected === true` → `connectionStatus = 'connected'`.
    - `connected === false` → `connectionStatus = 'disconnected'` y `statusMessage = payload.message || ''`.
- Si `provider !== 'evolution'` o no hay config:
  - Mantener el flujo actual con `/api/whatsapp/config`.
- `handleTestConnection()` debe quedar limitado al panel de Meta (se puede mover o dejar como está, ya que el panel Evolution tiene el suyo propio).
- El selector de proveedor ya setea `provider` en estado local, pero el health check debe usar el proveedor persistido en DB, no el local, para evitar llamadas incorrectas durante el primer render o si el usuario cambia de pestaña sin guardar.

### 2.4 Contrato API a usar

`GET /api/whatsapp/evolution/config` ya existe y devuelve:

```json
{
  "connected": true | false,
  "reason": "disconnected" | "no_config" | "no_account" | "db_error" | undefined,
  "message": string,
  "instance_name": string,
  "base_url": string
}
```

No requiere cambios de backend.

### 2.5 Criterio de aceptación

- Al abrir Settings → WhatsApp con una config Evolution guardada y conectada, el panel muestra "Connected" sin necesidad de pulsar "Test Connection".
- Al abrir Settings → WhatsApp con una config Meta guardada y conectada, el comportamiento es el actual.
- Al cambiar de proveedor en el selector sin guardar, no se dispara ningún health check.
- `npm run typecheck` y `npm test` pasan.

---

## 3. Problema 2: importación de contactos e historial

### 3.1 Diagnóstico

El webhook de Evolution (`src/app/api/whatsapp/evolution/webhook/route.ts`) procesa correctamente `MESSAGES_UPSERT` para mensajes nuevos, pero no existe mecanismo para traer contactos ni conversaciones previas que ya existan en el teléfono/WhatsApp Web conectado a Evolution.

### 3.2 Endpoints de Evolution a usar

Basado en la documentación de Evolution API v2.3.7:

- **Contactos:** `POST /chat/findContacts/{instanceName}`
  - Body: `{ "limit": number, "offset": number, "sort": { "field": "pushName", "order": "asc" } }`
  - Respuesta esperada: `{ "contacts": [ { "id", "remoteJid", "pushName", "owner", "profilePictureUrl", "createdAt", "updatedAt" } ], "total": number }`
  - Fuente: [Contacts - Evolution API](https://evolutionapi-evolution-api-90.mintlify.app/api/contacts/list)

- **Mensajes por chat:** `POST /chat/findMessages/{instanceName}`
  - Body: `{ "where": { "key": { "remoteJid": "..." } }, "limit": number, "offset": number }`
  - Respuesta esperada: lista de mensajes con `key`, `message`, `messageTimestamp`, `pushName`, etc.
  - Nota: el filtro `where.key.remoteJid` tiene reportes de inconsistencias en versiones anteriores. Debe validarse contra la instancia real antes de considerar la importación masiva terminada.

### 3.3 Alcance de la primera implementación

**Incluido:**

- Importar contactos de Evolution a la tabla `contacts` de WaCRM.
- Importar historial de mensajes de texto de cada contacto a la tabla `messages`.
- Crear la conversación por contacto si no existe.
- Usar idempotencia por `(conversation_id, message_id)` para evitar duplicados en reintentos.
- Marcar mensajes propios (`fromMe === true`) como `sender_type = 'agent'` con `status = 'sent'`.
- Marcar mensajes del cliente (`fromMe === false`) como `sender_type = 'customer'` con `status = 'delivered'`.
- Limitar mensajes a los últimos 30 días desde `messageTimestamp`.

**Fuera de alcance inicial:**

- Media histórico (imágenes, audio, documentos). Se importan como texto/caption si existe; el adjunto se deja como `media_url = null`.
- Mensajes de grupo.
- Reacciones, respuestas interactivas, ubicaciones.
- Sincronización continua: la importación es puntual (al conectar o bajo demanda), no un daemon.

### 3.4 Modelo de datos

**Contacto:**

- `account_id`: cuenta actual.
- `user_id`: owner de la config de WhatsApp (`config.user_id`), igual que el webhook.
- `phone`: `remoteJid` normalizado con `normalizeInboundPhone`.
- `name`: `pushName` si existe y no está vacío; si no, el teléfono normalizado.

**Conversación:**

- Reutilizar la función `findOrCreateConversation` del webhook Evolution para mantener la misma semántica.

**Mensaje:**

- `conversation_id`: conversación del contacto.
- `sender_type`: `'customer'` o `'agent'` según `fromMe`.
- `content_type`: `'text'` para la fase inicial.
- `content_text`: texto del mensaje (`message.conversation.text` o similar).
- `message_id`: `key.id` del mensaje Evolution.
- `status`: `'delivered'` para inbound, `'sent'` para outbound.
- `created_at`: `messageTimestamp` convertido a ISO 8601 (`normalizeTimestamp`).
- Se descartan mensajes cuyo timestamp sea anterior a `now - 30 días`.

### 3.5 Arquitectura propuesta

```text
Disparador (conexión exitosa o botón manual)
        |
        v
POST /api/whatsapp/evolution/import
        |
        v
EvolutionAdapter.findContacts(config)
        |
        v
Por cada contacto:
  - findOrCreateContact
  - findOrCreateConversation
  - EvolutionAdapter.findMessages(config, remoteJid, limit, offset)
        |
        v
  - Normalizar mensajes al mismo shape que MESSAGES_UPSERT
  - insertInboundMessage / insertOutboundEcho con idempotencia
```

### 3.6 Cambios de código propuestos

**Nuevos métodos en `src/lib/whatsapp/providers/evolution-adapter.ts`:**

- `findContacts(config, options): Promise<EvolutionContact[]>`
- `findMessages(config, remoteJid, options): Promise<EvolutionMessage[]>`
- (Opcional) `normalizeHistoricalMessage(msg): NormalizedInboundEvent` para reutilizar la lógica existente.

**Nuevo helper:** `src/lib/whatsapp/evolution-import.ts`

- `importEvolutionHistory(config, accountId, ownerUserId, options): Promise<ImportResult>`
- Orquesta paginación de contactos y mensajes.
- Logging de progreso y errores por contacto (no fallar toda la importación por un contacto).

**Nuevo endpoint:** `src/app/api/whatsapp/evolution/import/route.ts`

- `POST`: requiere rol admin, resuelve cuenta, carga config Evolution, llama al helper.
- Respuesta: `{ success: true, importedContacts: number, importedMessages: number, errors?: string[] }`.
- Debe correr de forma asíncrona (usar `after()`) si la importación puede ser larga, y devolver inmediatamente un job id o un estado parcial.

**Cambios en `src/app/api/whatsapp/evolution/config/route.ts`:**

- Tras guardar/actualizar la config y detectar que la instancia pasó a `connected` **y no se había importado previamente**, disparar la importación histórica automáticamente.
- El flag de control será una columna nueva `evolution_history_imported_at` (nullable timestamp) en `whatsapp_config`. Si es `NULL` y la instancia está `connected`, se lanza la importación. El botón manual la resetea a `NULL` o ignora el timestamp.
- La respuesta del POST incluirá `history_import_started: true` cuando se dispare.

**Cambios en UI:** `src/components/settings/evolution-config-panel.tsx`

- Añadir botón "Import history" visible solo cuando la instancia esté conectada.
- Mostrar notificación inmediata "Importación iniciada" al disparar.
- Al finalizar (feedback best-effort vía toast), mostrar resumen: contactos importados, mensajes importados, errores si los hubo.

### 3.7 Decisiones del owner (cerradas)

1. **Automática + manual:** se importa automáticamente al conectar la instancia por primera vez, y también se ofrece un botón "Import history" para re-importar bajo demanda.
2. **Ventana temporal:** últimos **30 días** contados desde el momento de la importación.
3. **Mensajes propios (`fromMe = true`):** **sí se importan**. Son los mensajes que el negocio envió desde WhatsApp Web/móvil antes de conectar WaCRM. Se muestran en el thread como `sender_type = 'agent'` con `status = 'sent'` para dar contexto completo de la conversación. Se excluyen estados de entrega/lectura porque no se pueden verificar retroactivamente.
4. **Chats de grupo:** no, fuera de alcance.
5. **Media:** no, solo texto/caption. `media_url` queda en `null`.
6. **Modo de ejecución:** **asíncrona**. Al dispararse (manual o automática), el backend lanza la importación en segundo plano mediante `after()` y responde inmediatamente al cliente con `{ success: true, started: true }`. La UI muestra una notificación de "Importación iniciada" y, al finalizar, un toast con el resumen (contactos/mensajes importados, errores). Esto evita timeouts del navegador si hay muchos mensajes.

### 3.8 Criterio de aceptación

- Tras conectar/importar, los contactos de Evolution aparecen en la lista de contactos de WaCRM.
- Los mensajes históricos aparecen en el thread de cada conversación en orden cronológico.
- Reintentar la importación no duplica contactos ni mensajes.
- Mensajes importados respetan `sender_type` y timestamp.
- `npm run typecheck`, `npm run lint` y `npm test` pasan.

---

## 4. Problema 3: URL plana del webhook

### 4.1 Diagnóstico

El usuario reporta que el webhook configurado en Evolution debe ser exactamente:

```
https://wacrm-production-ece3.up.railway.app/api/whatsapp/evolution/webhook
```

sin prefijos como `@url:` ni backticks.

En `src/app/api/whatsapp/evolution/config/route.ts`, el POST construye la URL con:

```ts
const webhookUrl = new URL(
  '/api/whatsapp/evolution/webhook',
  new URL(request.url).origin,
).toString()
```

Esto genera una URL plana y válida. No debería producir `@url:` ni backticks por sí solo.

### 4.2 Posibles causas a descartar

- Un proxy/CDN/edge que reescribe `request.url` con caracteres extraños.
- Una variable de entorno o configuración externa que inyecta la URL con template syntax.
- Un log o dashboard que muestra la URL con backticks por formato de salida.
- El header `x-forwarded-host` o similar que altera el `origin` percibido.

### 4.3 Acciones propuestas

1. **Validación antes de configurar:**
   - En `EvolutionAdapter.configureWebhook`, validar que `webhookUrl` sea un `https?` URL válico con `new URL()`.
   - Si no lo es, rechazar con `ProviderError` antes de llamar a Evolution.

2. **Logging de auditoría:**
   - Loggear (sin secretos) la URL que se envía a Evolution: `console.log('[evolution] configuring webhook:', webhookUrl)`.
   - Esto permite confirmar en los logs de Railway que la URL es plana.

3. **Endpoint de verificación:**
   - Añadir `GET /api/whatsapp/evolution/config` con el campo `webhook_url` en la respuesta para que el administrador vea qué URL está registrada localmente.
   - Nota: esto no lee la URL de Evolution, solo muestra la URL que WaCRM intentó configurar.

4. **Verificación manual:**
   - Si el código es correcto, el problema está en la configuración del servidor Evolution o en el proxy. Se recomienda verificar en el manager de Evolution la URL realmente guardada.

### 4.4 Cambios de código propuestos

- `src/lib/whatsapp/providers/evolution-adapter.ts`: validación de `webhookUrl` en `configureWebhook` + log.
- `src/app/api/whatsapp/evolution/config/route.ts` (GET): incluir `webhook_url` en la respuesta.
- Revisar si `request.url` puede contener backticks en algún entorno; de ser así, sanitizar el origin.

### 4.5 Criterio de aceptación

- Los logs de WaCRM muestran la URL plana que se envía a Evolution.
- `GET /api/whatsapp/evolution/config` devuelve `webhook_url`.
- Si `request.url` es inválido, el guardado falla con un mensaje claro en lugar de registrar una URL malformada en Evolution.

---

## 5. Orden de implementación recomendado

1. **Problema 1** (health check condicional): cambio pequeño, impacto inmediato en UX.
2. **Problema 3** (URL plana): cambio pequeño, solo validación y log; descarta causas externas.
3. **Problema 2** (importación histórica): cambio más grande; depende de las respuestas a las preguntas de la sección 3.7.

---

## 6. Tests a añadir/actualizar

- `src/components/settings/whatsapp-config.tsx`: test de que `fetchConfig` llama al endpoint correcto según `provider`.
- `src/lib/whatsapp/providers/evolution-adapter.test.ts`: mocks de `findContacts` y `findMessages`.
- `src/app/api/whatsapp/evolution/import/route.test.ts`: test del endpoint de importación con mocks de Supabase y fetch.
- `src/lib/whatsapp/evolution-import.test.ts`: test de idempotencia y manejo de errores parciales.

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `findMessages` no filtra correctamente por `remoteJid` en la versión instalada | Validar contra la instancia real; si falla, paginar sin filtro y descartar mensajes de otros JIDs en memoria |
| Importación masiva de muchos contactos/mensajes timeout | Ejecutar en `after()` o como job; paginar agresivamente |
| Duplicados por message_id compartidos entre providers/instances | Mantener idempotencia por `(conversation_id, message_id)`; los message_id de Evolution incluyen el JID, son estables por instancia |
| Media histórico genera mucho tráfico/storage | Dejar fuera del alcance inicial |
| Cambio de `fetchConfig` rompe el panel de Meta | Probar con provider `meta` y legacy (`undefined`) |

---

## 8. Decisiones requeridas del owner

Las decisiones principales de la sección **3.7** están cerradas. Quedan dos puntos opcionales:

- ¿Se prioriza primero el problema 1 y 3, y se deja el 2 para una segunda entrega? **Recomendación:** implementar 1 y 3 primero (rápidos) y luego el 2.
- ¿La URL del webhook debe permitir override manual en UI/variable de entorno, o siempre derivarse de `request.url`? **Recomendación:** mantener derivación automática de `request.url` y usar logs/auditoría para detectar problemas de proxy; agregar override solo si aparece un caso real.
