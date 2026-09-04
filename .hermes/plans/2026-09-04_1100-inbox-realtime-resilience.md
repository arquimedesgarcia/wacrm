# Recuperación de actualizaciones en tiempo real de la bandeja de WhatsApp (Evolution)

> **Estado:** propuesta pendiente de aprobación. Esta fase no incluye código desplegado, migraciones, limpieza de datos ni cambios en Railway/Supabase remoto.

**Objetivo:** Restaurar el comportamiento "la bandeja se actualiza sola" para cuentas que usan **Evolution API**, incluso cuando el WebSocket de Supabase Realtime se desconecta silenciosamente, se reconecta sin disparar el callback de Supabase, o el navegador mantiene la pestaña activa durante horas sin disparar `visibilitychange`.

---

## 1. Antecedentes

- El usuario reporta: la bandeja queda desactualizada con conversaciones y mensajes nuevos; en el teléfono sí se ven los mensajes entrantes.
- Proveedor: **Evolution API** (no Meta Cloud API).
- Afecta tanto a conversaciones nuevas como a mensajes en conversaciones ya existentes.
- Anteriormente funcionaba y dejó de funcionar; el corte coincide temporalmente con los commits de la rama `custom` que añadieron:
  - `6647831 fix(whatsapp): persist Evolution media + captions in webhook`
  - `b43fadd fix(whatsapp): reflect phone-sent replies in inbox (fromMe sync)`
  - `8403fae fix: reflect delivered/read status from Evolution upsert events`
  - `66ffcef fix: sync evolution outbound message statuses`
  - `8d0835c feat: play evolution audio in inbox`
  - `055a6b8 fix: render evolution customer reactions`
- Hay una especificación previa que cubre el tema de forma amplia: `.hermes/plans/2026-09-03_134502-whatsapp-inbox-recovery.md` ("Recuperación de la bandeja de entrada de WhatsApp"). Esta nueva especificación se enfoca **solo** en la pérdida silenciosa de eventos realtime en el navegador y deja intactas las demás piezas del flujo.

## 2. Hallazgos confirmados en el código

### 2.1 La UI sí está suscrita a los eventos correctos

- `src/hooks/use-realtime.ts:47-73` crea un canal `inbox-realtime` con `postgres_changes` sobre `messages` y `conversations` con `event: "*"`.
- `src/app/(dashboard)/inbox/page.tsx:382-387` consume ese hook y pasa los callbacks `handleMessageEvent` / `handleConversationEvent`.
- Las publicaciones de Supabase Realtime para `messages` y `conversations` están activas (`supabase/migrations/001_initial_schema.sql:407-422`, idempotente).
- Las políticas RLS (`017_account_sharing.sql:411-518`) permiten SELECT sobre filas de la cuenta del usuario, requisito para que Realtime entregue los eventos.

### 2.2 Bug confirmado: el flag `isConnected` queda pegado en `true` tras una desconexión silenciosa

`src/hooks/use-realtime.ts:71-73`:

```ts
.subscribe((status) => {
  setIsConnected(status === "SUBSCRIBED");
});
```

- El callback solo actualiza `isConnected` cuando llega el estado `SUBSCRIBED`.
- Los estados `CHANNEL_ERROR`, `TIMED_OUT` y `CLOSED` que entrega Supabase Realtime cuando el WS cae silenciosamente (rotación de token, cambio de red, servidor reiniciado) **no se traducen a `isConnected = false`**.
- El cleanup del `useEffect` (`src/hooks/use-realtime.ts:77-81`) sí pone `isConnected = false`, pero solo corre cuando React desmonta el componente, no cuando el canal cae.

### 2.3 Consecuencia: el resync por reconexión nunca dispara

`src/app/(dashboard)/inbox/page.tsx:399-411`:

```ts
const wasConnectedRef = useRef(false);
const initialConnectDoneRef = useRef(false);
useEffect(() => {
  if (isConnected && !wasConnectedRef.current) {
    if (initialConnectDoneRef.current) {
      setResyncToken((n) => n + 1); // ← solo dispara con false→true
    } else {
      initialConnectDoneRef.current = true;
    }
  }
  wasConnectedRef.current = isConnected;
}, [isConnected]);
```

- Esta protección depende de que `isConnected` pase por `false` antes de volver a `true`.
- Si el WS cae sin pasar por `SUBSCRIBED → otro → SUBSCRIBED` (el caso típico), `isConnected` se queda en `true` y la pestaña no se entera.
- El otro mecanismo (`visibilitychange → visible`) sí bumpea `resyncToken`, pero solo cuando el usuario cambia de pestaña o regresa; si la pestaña queda visible todo el tiempo, no hay recuperación.

### 2.4 El listener de `messages` no parchea conversaciones nuevas

`src/app/(dashboard)/inbox/page.tsx:280-303` (handler de INSERT de mensaje):

- Si la conversación no está en estado, llama a `hydrateConversation`.
- `hydrateConversation` hace un `.maybeSingle()` sobre `conversations` con el join completo.
- Si el INSERT del mensaje llega antes que la RPC `bump_conversation_on_inbound` actualice la fila, `last_message_at` puede estar `null` y la conversación no aparece en la consulta del listado por `.not("last_message_at", "is", null)` al refrescar manualmente. **Pero** esto no afecta el INSERT realtime en sí mismo.
- El bug real: si los realtime de `messages` y `conversations` no llegan, no hay recuperación porque el canal está "conectado" según `isConnected`.

### 2.5 Otros componentes con la misma suscripción al realtime

- `src/hooks/use-total-unread.ts:45-65` usa un canal aparte (`total-unread-realtime`) sin flag `isConnected`; depende solo de la entrega de eventos.
- `src/hooks/use-unread-notifications.ts` y la página `/notifications` usan canales separados.
- Si los contadores del sidebar sí se actualizan pero la bandeja no, el problema está en `InboxPage` o en el canal `inbox-realtime` específicamente.

## 3. Causa raíz

El canal `inbox-realtime` puede dejar de entregar eventos sin que `isConnected` lo refleje, porque el callback de Supabase Realtime no maneja los estados de error ni el cierre silencioso. En ese estado:

- Los eventos `postgres_changes` se pierden.
- El handler en `InboxPage` no se entera.
- No hay `false→true` para disparar el resync.
- No hay `visibilitychange` porque la pestaña sigue visible.
- El usuario tiene que refrescar manualmente para volver a ver actividad.

## 4. Alcance

### Incluye

- Hacer que el canal `inbox-realtime` refleje correctamente los estados `CHANNEL_ERROR`, `TIMED_OUT` y `CLOSED` como desconectado.
- Asegurar que `useRealtime` vuelve a marcar el canal como conectado cuando Supabase lo reconecta.
- Añadir un heartbeat ligero en `InboxPage` que, cuando `isConnected === false`, fuerce un resync periódico como red de seguridad.
- Cubrir el caso de doble suscripción por React strict mode sin provocar dos canales activos.
- Pruebas unitarias que cubran la transición de estados y el heartbeat.

### No incluye

- Reescribir `useRealtime` ni cambiar su API pública.
- Cambios al webhook de Evolution, ni al adaptador, ni a la base de datos.
- Cambios al esquema, RLS, políticas o publicaciones de Supabase.
- Cambios en la API pública, MCP, ni integraciones externas.
- Cambios en el resto de canales realtime (`total-unread-realtime`, `notifications-page`, etc.).
- Cambios visuales o de UX más allá de lo estrictamente necesario.

## 5. Diseño propuesto

### 5.1 Manejar todos los estados del canal en `useRealtime`

**Archivo:** `src/hooks/use-realtime.ts`

Reemplazar el callback `.subscribe((status) => setIsConnected(status === "SUBSCRIBED"))` por una función que mapee explícitamente los estados conocidos:

- `SUBSCRIBED` → `isConnected = true`.
- `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED` → `isConnected = false`.
- Estados desconocidos → `isConnected = false` (defensa; cualquier valor que no sea `SUBSCRIBED` debe verse como desconectado).

Esta es la única condición que unifica los dos comportamientos esperados: que `isConnected` refleje la realidad del canal y que la transición `false→true` del resync se dispare cuando Supabase efectivamente se reconecta.

### 5.2 Heartbeat en `InboxPage` cuando no hay conexión

**Archivo:** `src/app/(dashboard)/inbox/page.tsx`

- Cuando `isConnected === false`, programar un `setInterval` que bumpee `resyncToken` cada 30 s, para arrastrar a la UI a un estado consistente aunque el callback de Supabase nunca vuelva a entregar `SUBSCRIBED`.
- Cancelar el `setInterval` en el cleanup y al volver a estar conectado.
- No interferir con el flujo existente: solo entra en acción cuando el canal ya está caído según el flag.

### 5.3 Re-suscripción explícita al recuperar conexión

- No se fuerza una nueva suscripción desde el consumidor: `useRealtime` ya desreferencia `channelRef` cuando recibe un estado distinto de `SUBSCRIBED`, de modo que Supabase queda libre de re-handshakear el canal y la próxima transición `SUBSCRIBED` se refleja como un `false→true` correcto.
- Se mantiene el guard de `initialConnectDoneRef` para no disparar el resync en el primer connect ni en el doble mount de strict mode.
- Si tras varios minutos el canal sigue caído y el callback de Supabase nunca vuelve a entregar `SUBSCRIBED`, el heartbeat de §5.2 cubre la recuperación.

### 5.4 Garantizar una sola subscripción activa

- Confirmar que el cleanup de `useRealtime` realmente llama a `removeChannel` antes de crear otro canal en el mismo `channelName`. Hoy lo hace (`use-realtime.ts:77-81`), pero hay que añadir un test que simule el doble mount y verifique que termina con un solo canal registrado.

## 6. Cambios previstos en archivos

- `src/hooks/use-realtime.ts` — mapear todos los estados de `subscribe()` a `isConnected` y documentar el comportamiento.
- `src/app/(dashboard)/inbox/page.tsx` — añadir heartbeat y re-suscripción explícita al recuperar la conexión.
- `src/hooks/use-realtime.test.ts` (nuevo, si no existe) — cubrir los estados de Supabase, el doble mount y el cleanup.
- `src/app/(dashboard)/inbox/page.test.tsx` (nuevo, si la infraestructura lo permite) o un test de integración — cubrir que el heartbeat se activa cuando `isConnected === false`.

## 7. Pruebas obligatorias

### Unitarias

- `useRealtime`:
  - `SUBSCRIBED` → `isConnected = true`.
  - `CHANNEL_ERROR` → `isConnected = false`.
  - `TIMED_OUT` → `isConnected = false`.
  - `CLOSED` → `isConnected = false`.
  - Doble mount (estilo React strict mode) deja exactamente un canal activo.
  - Cleanup llama a `removeChannel`.
- `InboxPage`:
  - El heartbeat solo se activa cuando `isConnected === false`.
  - El heartbeat se cancela al volver a estar conectado.
  - El primer connect no dispara resync.

### Manuales

1. Mantener la pestaña `/inbox` abierta sin cambiar de pestaña durante varios minutos.
2. Desde el teléfono, enviar un mensaje a un número conectado a Evolution.
3. Verificar que aparece en la bandeja **sin** refrescar y **sin** cambiar de pestaña.
4. Provocar una desconexión de red del cliente (modo avión del navegador o DevTools → Network → Offline) durante 30 s, volver a conectar y verificar que la bandeja se recupera sin refrescar.
5. Forzar la pérdida de la sesión de Supabase (cerrar la sesión en otra pestaña) y verificar que al volver la bandeja se reconecta sola.

## 8. Criterios de aceptación

- La bandeja muestra conversaciones nuevas y mensajes en conversaciones existentes en tiempo real, sin necesidad de refrescar manualmente ni cambiar de pestaña.
- Cuando el canal realtime se desconecta, la UI lo refleja mediante un re-fetch y vuelve a sincronizarse sin acción del usuario.
- Las métricas existentes (sidebar green-dot, notificaciones) siguen funcionando exactamente como antes.
- `npm run typecheck`, `npm run lint` y `npm test` pasan; los warnings existentes se reportan por separado.
- No se requieren migraciones ni cambios en el esquema de Supabase.

## 9. Riesgos y decisiones pendientes

- **Heartbeat de 30 s vs. 60 s**: 30 s da una ventana razonable para una bandeja sin perder fluidez; 60 s es menos agresivo con la base. Decisión propuesta: 30 s, ajustable por constante.
- **Re-suscripción explícita al reconectar**: añade un ciclo de unmount/mount en el canal. Supabase lo tolera pero conviene medir latencia. Si genera doble entrega de eventos, añadir dedupe por `payload.eventType + payload.new.id` en el handler.
- **Compatibilidad con React strict mode**: los efectos se ejecutan dos veces en dev. La lógica propuesta ya lo cubre (`initialConnectDoneRef`, doble mount de `useRealtime` con cleanup), pero los tests deben demostrarlo explícitamente.

## 10. Orden de implementación posterior a la aprobación

1. Añadir tests rojos en `use-realtime` para los estados de Supabase.
2. Modificar `useRealtime` para mapear todos los estados y añadir el guard de doble mount.
3. Añadir tests para el heartbeat en `InboxPage`.
4. Implementar el heartbeat y la re-suscripción explícita.
5. Ejecutar suite completa, typecheck y lint.
6. Validación manual con la instancia Evolution del usuario.
7. Commit único, push separado de cualquier otro cambio pendiente.