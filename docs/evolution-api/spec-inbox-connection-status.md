# Especificación: corrección del banner "WhatsApp no conectado" en Inbox

- **Estado:** especificación para implementación
- **Fecha:** 2026-09-02
- **Rama:** `custom`
- **Issue:** el banner "WhatsApp® no está conectado" aparece en la Bandeja aunque existan mensajes y la cuenta use Evolution API conectada.

## 1. Resumen ejecutivo

La Bandeja decide si muestra el aviso de WhatsApp desconectado leyendo únicamente la columna `whatsapp_config.status` desde el cliente de Supabase. Para Meta ese campo refleja razonablemente el estado de suscripción/registro. Para Evolution, el estado real lo posee el servidor Evolution (Baileys) y se comunica mediante eventos `CONNECTION_UPDATE`; actualmente esos eventos no actualizan `whatsapp_config.status`, por lo que el banner puede quedar pegado en `disconnected` aunque la instancia ya esté `open` y recibiendo mensajes.

## 2. Causa comprobada

1. **`src/app/(dashboard)/inbox/page.tsx:203-209`** consulta `whatsapp_config.status` directamente al montar la página y setea `whatsappConnected = data?.status === "connected"`.
2. **El webhook de Evolution (`src/app/api/whatsapp/evolution/webhook/route.ts`)** normaliza `CONNECTION_UPDATE` como un mensaje de texto del sistema, pero **no escribe** el nuevo estado en `whatsapp_config.status` ni en `connected_at`.
3. Si la configuración se guardó mientras el QR aún no estaba escaneado, o si la instancia se desconectó y reconectó, `whatsapp_config.status` queda/desactualizado en `disconnected` mientras el servidor Evolution ya está `open`.
4. El banner no se refresca después del montaje: no hay suscripción realtime ni re-consulta periódica del estado.

Las políticas RLS (`is_account_member(account_id)` para SELECT) permiten leer la fila, por lo que el problema no es de permisos.

## 3. Archivos afectados

- `src/app/(dashboard)/inbox/page.tsx` — decisión del banner.
- `src/app/api/whatsapp/evolution/webhook/route.ts` — procesamiento de `CONNECTION_UPDATE`.
- `src/lib/whatsapp/providers/evolution-adapter.ts` — ya expone `getConnectionStatus`; opcionalmente se puede reutilizar.
- `src/app/api/whatsapp/evolution/config/route.ts` — ya actualiza `status` en POST/GET; no requiere cambios.
- `src/lib/whatsapp/providers/types.ts` — no requiere cambios.

## 4. Flujo actual

```text
Inbox mount
  └─> Supabase SELECT whatsapp_config.status
        └─> setWhatsappConnected(status === 'connected')

Evolution CONNECTION_UPDATE (open/close/connecting)
  └─> Webhook normaliza como mensaje de sistema
        └─> NO actualiza whatsapp_config.status
```

## 5. Comportamiento esperado

- El banner debe desaparecer cuando la instancia Evolution esté realmente conectada (`connectionState === 'open'`).
- El banner debe aparecer cuando la instancia esté desconectada (`connectionState !== 'open'`).
- El estado debe reflejarse sin necesidad de recargar la página.
- El comportamiento para cuentas Meta debe permanecer igual.

## 6. Estrategia de corrección

### Opción A (recomendada): actualizar `whatsapp_config.status` desde el webhook de conexión

Cuando el webhook de Evolution reciba `CONNECTION_UPDATE` con estado `open`, actualizar `whatsapp_config.status = 'connected'` y `connected_at = now()`. Cuando el estado sea `close`/`connecting`/`unknown`, actualizar `status = 'disconnected'`.

Ventajas:
- Una sola fuente de verdad (`whatsapp_config.status`).
- El banner del inbox se resuelve con la consulta existente.
- Funciona para todos los usuarios de la cuenta sin cambios en el cliente.

Desventajas:
- Requiere que Evolution envíe `CONNECTION_UPDATE` y que el webhook esté configurado (ya lo está).
- Hay un pequeño retardo hasta que llegue el primer evento de conexión.

### Opción B: consultar el estado real desde el inbox

Hacer que `inbox/page.tsx` llame a `/api/whatsapp/evolution/config` cuando `provider === 'evolution'` para obtener el estado real en lugar de leer `status` de Supabase.

Ventajas:
- Refleja el estado actual sin depender de eventos de webhook.

Desventajas:
- Añade una llamada API extra en cada carga de la Bandeja.
- No resuelve el desfase entre `whatsapp_config.status` y la realidad para otros consumidores.

### Propuesta combinada

Implementar **Opción A** como corrección principal. Además, añadir en `inbox/page.tsx` una re-consulta del estado cuando:
- la pestaña vuelve a primer plano (`visibilitychange`);
- el canal realtime de `whatsapp_config` reciba un UPDATE (suscribirse a cambios de la fila).

Esto mantiene la fuente única de verdad y mejora la reactividad.

### Detalle de cambios propuestos

1. **`src/app/api/whatsapp/evolution/webhook/route.ts`**
   - En `processEvolutionWebhook`, detectar eventos `connection.update`/`CONNECTION_UPDATE` antes de la normalización.
   - Extraer el estado (`open`, `close`, `connecting`, etc.) del payload.
   - Llamar a `updateWhatsappConfigStatus(accountId, isOpen)` que haga:
     - `status = isOpen ? 'connected' : 'disconnected'`
     - `connected_at = isOpen ? now() : null` (o conservar el último `connected_at` para auditoría; se recomienda conservarlo).
   - Continuar con el flujo normal (opcionalmente omitir la inserción del mensaje de sistema para `CONNECTION_UPDATE`, o mantenerlo para log).

2. **`src/app/(dashboard)/inbox/page.tsx`**
   - Mantener la consulta inicial a `whatsapp_config`.
   - Suscribirse a realtime en `whatsapp_config` para la fila de la cuenta (`account_id`), y refrescar `whatsappConnected` cuando cambie.
   - Al recibir `visibilitychange → visible`, re-ejecutar `checkConnection()`.

3. **(Opcional) Endpoint de salud unificado**
   - No es necesario para esta corrección, pero se puede evaluar en el futuro si otros lugares necesitan el estado en tiempo real.

## 7. Pruebas necesarias

- Test unitario del webhook de Evolution:
  - `CONNECTION_UPDATE` con `state: 'open'` actualiza `whatsapp_config.status` a `'connected'`.
  - `CONNECTION_UPDATE` con `state: 'close'` actualiza `status` a `'disconnected'`.
  - `CONNECTION_UPDATE` con `state: 'connecting'` deja/desactualiza `status` a `'disconnected'`.
- Test del inbox (opcional, más de integración):
  - Dada una fila Evolution con `status='disconnected'`, si llega un realtime UPDATE a `status='connected'`, el banner desaparece.

## 8. Criterios de aceptación

- Tras conectar una instancia Evolution y escanear el QR, el banner de "WhatsApp no conectado" desaparece de la Bandeja sin recargar la página.
- Si la instancia Evolution se desconecta, el banner vuelve a aparecer.
- Las cuentas Meta siguen mostrando el banner según `whatsapp_config.status` como antes.
- No se introducen regresiones en los tests existentes.

## 9. Riesgos y casos Meta/Evolution

| Riesgo | Mitigación |
|---|---|
| Meta se ve afectado porque ambos providers comparten `status` | El cambio solo toca el webhook de Evolution; Meta usa su propio webhook y su propia lógica de `status` |
| Evento `CONNECTION_UPDATE` no llega o llega antes de guardar la config | La config route ya escribe `status` en POST; el webhook lo refina cuando llegue |
| Estado intermitente `connecting` oscila el banner | Considerar `connecting` como `disconnected` hasta recibir `open`; no actualizar `connected_at` |
| Reintentos de webhook duplican UPDATE | El UPDATE es idempotente; no hay efectos secundarios más allá de escribir el mismo estado |
| Cliente no recibe el cambio sin recargar | Se añade suscripción realtime + re-check en visibilitychange |
