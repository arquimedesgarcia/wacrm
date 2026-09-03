# Recuperación de la bandeja de entrada de WhatsApp — Especificación

> **Estado:** propuesta pendiente de aprobación. Esta fase no incluye código, migraciones, limpieza de datos ni despliegues.

## Objetivo

La bandeja debe mostrar únicamente conversaciones con mensajes, actualizarse en vivo y conservar correctamente la separación entre conversaciones directas y conversaciones grupales. Debe mostrar mensajes entrantes y salientes, tanto de Meta como de Evolution API.

## Hallazgos confirmados en el código

1. `src/components/inbox/conversation-list.tsx` consulta todas las filas de `conversations` y no exige que exista al menos un mensaje.
2. `src/lib/whatsapp/evolution-import.ts` crea contacto y conversación **antes** de consultar/importar mensajes. Por eso el botón **Import history** puede dejar conversaciones vacías que luego aparecen en Inbox.
3. El importador descarta explícitamente grupos y listas de difusión (`@(g.us|broadcast|newsletter)`), por lo que no puede reconstruir conversaciones grupales.
4. `src/app/api/whatsapp/evolution/webhook/route.ts` resuelve cada mensaje por `event.senderPhone` y crea una conversación por contacto. Para mensajes de grupo debe usar el JID remoto del chat como clave de conversación y el participante como autor del mensaje.
5. `src/lib/whatsapp/providers/jid.ts` clasifica `g.us` como servidor no compatible; esto es correcto para una conversación directa, pero no para el nuevo flujo de grupos.
6. Los mensajes salientes se insertan en `src/lib/whatsapp/send-message.ts`; el eco `fromMe` de Evolution solamente actualiza un mensaje existente. Esto debe probarse para evitar duplicados y confirmar que siempre aparece en el hilo.
7. `src/hooks/use-realtime.ts` escucha `messages` y `conversations`, pero no restringe explícitamente el canal a la cuenta. Debe verificarse el alcance por RLS/cuenta y garantizar que un INSERT/UPDATE mueve la conversación al orden correcto.

## Definiciones funcionales

- **Conversación activa:** conversación `open` o `pending` que tiene uno o más mensajes. La vista predeterminada no debe mostrar `closed`; los cerrados podrán consultarse mediante el filtro existente.
- **Conversación directa:** un chat 1:1 identificado por el teléfono/JID remoto del contacto.
- **Conversación grupal:** un chat identificado por el `remoteJid` del grupo (`*@g.us`). Todos sus mensajes pertenecen a una sola conversación; cada mensaje conserva el participante que lo originó.
- **Entrante:** mensaje recibido de un cliente o participante, `sender_type=customer`.
- **Saliente:** mensaje enviado por un agente, bot, automatización o la cuenta conectada, `sender_type=agent|bot`.

## Alcance técnico propuesto

### 1. Corregir la fuente de la lista

Modificar la consulta y la normalización de Inbox para que:

- La consulta base solo devuelva conversaciones con al menos un mensaje.
- La vista inicial filtre `status IN ('open', 'pending')`.
- Los filtros de cerrado y todos sigan disponibles explícitamente.
- Una conversación sin mensajes nunca aparezca, aunque haya sido creada por un contacto importado.
- La consulta ordene por el último mensaje real, no solo por `updated_at`.
- Se cubran conversaciones existentes vacías sin depender de una limpieza manual de Supabase.

Preferencia de implementación: resolverlo en la consulta con `EXISTS`/relación de mensajes o una vista/función account-scoped; no cargar todos los contactos para filtrarlos en el navegador.

### 2. Hacer el import histórico seguro

Modificar `src/lib/whatsapp/evolution-import.ts` y su endpoint para que:

- Consulte y filtre mensajes antes de crear una conversación nueva.
- No cree conversaciones para contactos sin mensajes importables dentro de la ventana configurada.
- Mantenga la idempotencia por identificador del proveedor.
- Al finalizar la importación, actualice `last_message_text`, `last_message_at` y `unread_count` de forma coherente.
- No convierta mensajes históricos salientes en entrantes.
- Informe por logs contadores separados para directos, grupos, entrantes, salientes, omitidos y errores; sin exponer secretos.
- Mantenga la importación en segundo plano, pero deje una forma verificable de detectar finalización y errores en una futura mejora de UI.

### 3. Modelo y agrupación de grupos

Agregar soporte persistente para identificar el chat y el participante sin romper conversaciones actuales. La implementación debe incluir, como mínimo:

- En `conversations`: una clave de chat remota estable (`remote_jid`), tipo (`direct`/`group`) y nombre/asunto del grupo cuando esté disponible.
- Restricción o índice único por cuenta + proveedor + clave remota, con una estrategia de backfill para conversaciones directas existentes.
- En `messages`: identificador/JID del participante remoto y nombre recibido cuando el mensaje pertenezca a un grupo.
- `contact_id` debe seguir siendo válido para directos; para grupos se debe definir explícitamente si será nullable o si se utilizará una entidad de grupo separada. No se debe crear un contacto individual por cada participante como sustituto del grupo.
- La UI debe mostrar el nombre del grupo, su avatar/iniciales y, en cada mensaje grupal, el nombre del participante.
- Los grupos deben aparecer una sola vez en la lista, aunque tengan muchos participantes.

Archivos principales previstos:

- `supabase/migrations/<nueva-migracion>-whatsapp-group-conversations.sql`
- `src/types/index.ts`
- `src/lib/inbox/conversations.ts`
- `src/components/inbox/conversation-list.tsx`
- `src/components/inbox/message-thread.tsx`
- `src/components/inbox/message-bubble.tsx`
- `src/app/api/whatsapp/evolution/webhook/route.ts`
- `src/lib/whatsapp/evolution-import.ts`
- `src/lib/whatsapp/providers/evolution-adapter.ts`
- `src/lib/whatsapp/providers/jid.ts`

### 4. Entrantes, salientes y tiempo real

Verificar y corregir el flujo completo para ambos proveedores:

- Meta webhook: persistencia del mensaje entrante, actualización de conversación y publicación realtime.
- Evolution webhook: mensajes entrantes directos, mensajes entrantes grupales y eventos `fromMe`.
- Composer/API de envío: persistencia del mensaje saliente después de un envío exitoso, incluyendo texto, media, template e interactivos soportados.
- Eco posterior de Evolution: actualizar estado sin insertar un duplicado.
- Realtime: INSERT de mensaje entrante o saliente debe actualizar el hilo activo y el preview de la lista; UPDATE debe actualizar estado; eventos fuera de la cuenta no deben filtrarse al cliente.
- Al abrir una conversación se deben cargar mensajes en orden ascendente y no perderlos por carreras entre hydrate, realtime y deep-link.

## Pruebas requeridas antes de implementar/publicar

### Unitarias

- `src/lib/inbox/conversations.test.ts`
  - excluye conversaciones sin mensajes;
  - incluye `open`/`pending` por defecto;
  - deja `closed` solo cuando se solicita;
  - agrupa por clave remota de grupo;
  - no agrupa dos chats directos de teléfonos distintos.
- `src/lib/whatsapp/evolution-import.test.ts`
  - un contacto sin mensajes no crea conversación;
  - mensajes históricos entrantes y salientes conservan `sender_type`;
  - el import es idempotente;
  - grupos se importan en una sola conversación;
  - los participantes se conservan por mensaje.
- `src/lib/whatsapp/providers/jid.test.ts` y/o pruebas del adaptador
  - identifica `g.us` como grupo;
  - no transforma un JID grupal en teléfono;
  - resuelve correctamente PN/LID y participante alternativo.

### Integración/API

- `src/app/api/whatsapp/evolution/webhook/route.test.ts`
  - mensaje directo entrante;
  - mensaje grupal de dos participantes que termina en una conversación;
  - mensaje `fromMe`/eco sin duplicar;
  - actualización de estado del mensaje.
- `src/app/api/whatsapp/webhook/route.test.ts`
  - Meta entrante mantiene persistencia, unread y preview.
- `src/app/api/whatsapp/send/route.test.ts`
  - envío saliente queda visible en `messages` y `conversations`.

### Validación manual reproducible

Con una cuenta de prueba autorizada y sin mostrar secretos:

1. Enviar un mensaje desde un número directo hacia WhatsApp y confirmar que aparece como entrante sin recargar.
2. Responder desde Inbox y confirmar que aparece como saliente, con estado inicial y actualización posterior.
3. Recibir dos mensajes de dos participantes del mismo grupo y confirmar una sola fila de conversación y autores correctos.
4. Ejecutar **Import history** y confirmar que los contactos sin mensajes recientes no aparecen en Inbox.
5. Confirmar que un mensaje entrante mientras se visualiza otro hilo no altera el hilo activo y sí actualiza el preview de la lista.
6. Repetir eventos/webhook y confirmar que no hay mensajes ni conversaciones duplicadas.

## Criterios de aceptación

- La bandeja predeterminada muestra solo conversaciones activas con al menos un mensaje.
- Hacer clic en **Import history** no produce conversaciones vacías visibles.
- Los grupos se muestran agrupados por chat, no por participante.
- Se conserva el nombre del participante en cada mensaje grupal.
- Mensajes entrantes y salientes aparecen en tiempo real en el hilo y en el preview de la lista.
- Meta y Evolution pasan los mismos invariantes de persistencia, idempotencia y ordenamiento.
- No se requieren cambios en Railway ni Supabase remoto durante esta fase; cualquier migración se entregará para aprobación y ejecución posterior.
- `npm run typecheck`, `npm run lint` y `npm test` pasan; los warnings existentes se reportan por separado.

## Riesgos y decisiones pendientes

1. **Migración de esquema:** hacer `contact_id` nullable para grupos es el cambio más pequeño, pero puede afectar componentes que asumen un contacto. Una entidad `conversation_groups` es más limpia, pero tiene mayor alcance.
2. **Historial ya importado:** ocultar conversaciones vacías corrige la UI sin borrar datos. La eliminación/compactación de filas huérfanas debe ser una operación separada y aprobada.
3. **Meta:** los webhooks de Meta no entregan grupos de la misma forma que Evolution; el adaptador debe mantener capacidades explícitas por proveedor.
4. **Mensajes salientes históricos:** Evolution puede devolver mensajes `fromMe` sin un contacto equivalente; deben vincularse por el chat remoto, no por un participante inventado.
5. **RLS/realtime:** antes de elegir filtros del canal se debe verificar la política efectiva y no confiar únicamente en el cliente.

## Orden de implementación posterior a la aprobación

1. Añadir pruebas rojas para el filtro de conversaciones vacías/activas.
2. Corregir la consulta de Inbox y validar que no cambie el hilo existente.
3. Añadir pruebas y corrección del importador para no crear conversaciones vacías.
4. Añadir modelo/migración de grupos y backfill seguro.
5. Corregir webhook Evolution, importación grupal y renderizado de participantes.
6. Verificar mensajes salientes, ecos `fromMe` y realtime para ambos proveedores.
7. Ejecutar validación completa, revisar diff, solicitar aprobación de la migración y solo después preparar commit/push.
