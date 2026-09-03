# Evolution WhatsApp: visualización de imágenes en la bandeja

> Especificación para Hermes. No incluye implementación ni aplicación de migraciones.

**Objetivo:** Persistir y mostrar en WaCRM las imágenes recibidas por WhatsApp mediante Evolution API, tanto en el hilo como en la miniatura de la bandeja.

**Arquitectura:** El adaptador de Evolution normaliza el evento y extrae los metadatos de media. Un servicio específico de Evolution obtiene los bytes mediante el endpoint de media del proveedor, los copia al bucket `chat-media` con una ruta account-scoped y devuelve una URL durable. El webhook guarda esa URL en `messages.media_url`; la UI existente la consume mediante `useMediaBlobUrl`, `MediaImageBubble` y la vista previa de la lista.

**Tech Stack:** Next.js/TypeScript, Evolution API v2.3.7, Supabase Storage, Supabase Postgres, Vitest.

---

## 1. Diagnóstico confirmado

### Flujo actual

1. `src/app/api/whatsapp/evolution/webhook/route.ts` recibe `MESSAGES_UPSERT`.
2. `EvolutionAdapter.normalizeHistoricalMessage()` en `src/lib/whatsapp/providers/evolution-adapter.ts` detecta:
   - `imageMessage` / `stickerMessage` → `contentType: 'image'`;
   - `videoMessage`, `audioMessage`, `documentMessage` de forma similar.
3. Sin embargo, devuelve `mediaUrl: null` y `mediaType: null` para todos los medios.
4. El webhook inserta esos campos directamente en `messages`.
5. `MediaImageBubble` muestra `MediaUnavailable` cuando `media_url` es nulo.
6. La consulta opcional de miniaturas de la lista excluye correctamente filas sin `media_url`, por lo que tampoco puede mostrar una imagen.

### Causa raíz

Evolution entrega el mensaje y sus metadatos, pero el adaptador no descarga ni persiste el contenido multimedia. No es un problema primario de React ni de `MediaLightbox`.

---

## 2. Alcance

### Incluye

- Imágenes recibidas por Evolution.
- Stickers convertidos al tipo visual `image`, manteniendo el comportamiento existente.
- URLs durables en `chat-media` y compatibilidad con `/api/whatsapp/media/*` como fallback si la descarga falla.
- Visualización en:
  - hilo de conversación;
  - lightbox existente;
  - miniatura de la bandeja.
- Mensajes nuevos y, opcionalmente, una ruta separada para reintentar medios históricos aún disponibles.

### No incluye inicialmente

- Videos, audios o documentos, salvo que se reutilice el mismo servicio generalizado después de validar imágenes.
- Grupos, canales o JIDs no resolubles.
- Recuperación de archivos que Evolution/WhatsApp ya no pueda entregar.
- Cambios en Railway o Supabase remoto durante la implementación.

---

## 3. Diseño propuesto

### 3.1 Contrato de descarga de media de Evolution

**Archivo probable:** `src/lib/whatsapp/providers/evolution-media.ts`

Crear una función testeable que:

- reciba la configuración Evolution, el nombre de instancia y el mensaje raw (`key` + `message`);
- llame al endpoint oficial de extracción de media de Evolution v2.3.7 (`getBase64FromMediaMessage`, sujeto a confirmación contra la instancia/documentación antes de implementarlo);
- acepte las formas de respuesta documentadas/observadas: `base64`, MIME (`mimetype`/`mimeType`), nombre de archivo;
- elimine prefijos `data:*;base64,` antes de decodificar;
- valide MIME y tamaño antes de subir;
- nunca exponga API keys en logs;
- devuelva `null` en error para no convertir un fallo de media en un webhook fallido.

La llamada debe ejecutarse solo para mensajes cuyo contenido sea media y debe tener timeout y manejo explícito de respuestas no válidas.

### 3.2 Persistencia durable

Reutilizar el patrón de `src/lib/whatsapp/mirror-inbound-media.ts`, pero con un servicio para Evolution:

- bucket: `chat-media`;
- ruta: `account-<accountId>/inbound/evolution-<providerMessageId>-<filename>.<ext>`;
- `upsert: true` para reentregas idempotentes;
- MIME normalizado;
- límite de tamaño coherente con el bucket actual;
- URL pública durable devuelta por Supabase Storage.

Si la descarga o subida falla, guardar un fallback explícito solo si el proveedor puede ofrecerlo; de lo contrario `media_url` permanece nulo y el mensaje se visualiza como no disponible. El fallo se registra sin credenciales ni payload completo.

### 3.3 Integración del webhook

**Archivo:** `src/app/api/whatsapp/evolution/webhook/route.ts`

En `handleInboundMessage()`:

1. Resolver contacto y conversación como hoy.
2. Insertar la fila de mensaje con idempotencia.
3. Para media, obtener la URL durable antes de insertar o actualizar la fila después de la descarga.
4. Guardar:
   - `content_type: 'image'` para imágenes/stickers;
   - `media_url` durable;
   - `media_type` MIME real;
   - `content_text` como caption cuando exista;
   - `message_id` del proveedor.
5. Mantener el bump de conversación después de una inserción nueva.
6. Evitar cualquier segundo insert en reentregas del mismo provider message id.

El método de normalización debe conservar suficiente `rawPayload` para descargar media, sin persistir ni loggear secretos.

### 3.4 Integración de la bandeja

La UI ya contiene:

- `MediaImageBubble`;
- `MediaLightbox`;
- `useMediaBlobUrl`;
- consulta opcional de mensajes media en `conversation-list.tsx`.

La implementación solo debe verificar y ajustar:

- que el query de miniaturas no bloquee la lista si falla;
- que la fila devuelta incluya `conversation_id`;
- que las miniaturas se actualicen después de un mensaje realtime o de un refresh;
- que una URL durable y una URL proxy funcionen en el hook actual.

No se debe volver a incluir `messages` dentro del `select` principal de `conversations`, porque ese cambio ya provocó que toda la bandeja desapareciera.

---

## 4. Pruebas obligatorias (TDD)

### Adaptador/servicio

**Archivo:** `src/lib/whatsapp/providers/evolution-media.test.ts` (nuevo)

Casos:

1. Extrae base64 y MIME de la respuesta normal.
2. Acepta respuesta con prefijo Data URI.
3. Rechaza base64 corrupto o ausente.
4. Rechaza media que supera el límite.
5. Normaliza MIME con parámetros.
6. No incluye credenciales en errores/logs.
7. Reintento del mismo provider message id usa la misma ruta.

### Normalización

**Archivo:** `src/lib/whatsapp/providers/evolution-adapter.test.ts`

Agregar casos para:

1. `imageMessage` → `contentType: 'image'` y metadatos raw disponibles.
2. caption de imagen.
3. sticker tratado como imagen.
4. inbound text no cambia.
5. `fromMe` no cambia la detección de tipo.

### Webhook

**Archivo:** `src/app/api/whatsapp/evolution/webhook.test.ts` o el archivo de pruebas existente que cubra la ruta.

Verificar que una imagen:

- crea una fila con `sender_type: 'customer'`;
- guarda `content_type: 'image'`;
- guarda `media_url` y `media_type`;
- actualiza `last_message_text` con caption o marcador `[image]`;
- no duplica la fila en una reentrega.

### UI

Extender tests del componente/helper para verificar:

- no falla la lista si el query opcional de media devuelve error;
- muestra thumbnail cuando existe `media_url`;
- no muestra thumbnail si está ausente;
- el thread continúa mostrando `MediaImageBubble` y lightbox.

---

## 5. Criterios de aceptación

- Una imagen nueva recibida mediante Evolution aparece en el hilo sin mostrar `Photo unavailable` cuando Evolution y Storage están disponibles.
- La misma imagen aparece como miniatura en la bandeja tras el refresh o evento realtime.
- Se soportan imágenes entrantes y stickers tratados como imagen.
- Si falla la descarga, la conversación y el mensaje siguen guardándose; solo el media queda no disponible.
- Las reentregas no crean duplicados.
- No se muestran secretos en logs ni respuestas HTTP.
- La consulta base de conversaciones sigue siendo independiente de la consulta opcional de media.

---

## 6. Riesgos y decisiones pendientes

- **Endpoint exacto:** confirmar con la versión Evolution del usuario el path y body de `getBase64FromMediaMessage` antes de codificar; no asumir que otra versión tiene el mismo contrato.
- **Límite de Storage:** imágenes grandes pueden exceder el límite actual; deben quedar como no disponibles o requerir una migración separada aprobada.
- **URLs públicas:** confirmar que `chat-media` sigue siendo público y que las políticas account-scoped no se debilitan.
- **Histórico:** las filas ya guardadas con `media_url = null` no se pueden reparar si Evolution ya no entrega los bytes. Se puede añadir un reintento administrativo posterior, separado de este cambio.
- **Proveedor Meta:** no alterar el flujo Meta ya funcional; compartir utilidades solo después de tests específicos por proveedor.

---

## 7. Rollback

- Revertir el servicio de descarga y la llamada del webhook.
- Mantener las filas existentes intactas.
- No requiere eliminar datos de Storage.
- Si se agrega una migración futura de índices/columnas, debe tener script reversible y aprobación explícita.
