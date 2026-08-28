# Decisiones cerradas: Evolution API en WaCRM

- **Estado:** cerradas para la primera implementación
- **Fecha:** 2026-08-28
- **Decisor:** owner del fork `arquimedesgarcia/wacrm`

## D1. Versión/tag de Evolution API

**Decisión:** fijar la versión **2.3.7** como referencia inicial.

- Es el último release estable reportado por la API de GitHub al momento de la investigación.
- La implementación debe usar contratos verificados contra esa versión.
- Actualizaciones futuras requieren tarea explícita de compatibilidad.

## D2. Método de conexión

**Decisión:** la primera implementación usará **Evolution API + Baileys / WhatsApp Web**.

- Meta Cloud API sigue siendo el proveedor oficial y recomendado para producción.
- Evolution Baileys se usa para desarrollo, pruebas y validación de la abstracción.
- Evolution Cloud API queda fuera del alcance inicial porque WaCRM ya soporta Meta Cloud API directamente.

## D3. Hosting de Evolution API

**Decisión:** fuera de alcance de esta implementación.

- WaCRM solo consume una URL base de Evolution configurable.
- El despliegue de Evolution API corre por cuenta del operador en un servicio separado.
- Se recomienda Railway separado, VPS o Docker con volumen persistente para sesiones.

## D4. Modelo de configuración

**Decisión:** extender la tabla `whatsapp_config` con columnas explícitas.

- Una única fila por `account_id`.
- Columna `provider` enum `'meta' | 'evolution'` con default `'meta'`.
- Columnas nuevas para Evolution: `evolution_base_url`, `evolution_api_key` (cifrado), `evolution_instance_name`, `evolution_instance_id`, `evolution_webhook_secret` (cifrado).
- Los campos Meta existentes se mantienen; son `NULL` o ignorados cuando `provider = 'evolution'`.
- Se añade restricción/check para que solo haya un proveedor activo por cuenta.

## D5. Semántica de instancia y conversación

**Decisión:** añadir `provider` a la configuración, no a cada mensaje en la primera fase.

- La deduplicación de mensajes entrantes usa `conversation_id + message_id` + resolución de cuenta por instancia configurada.
- Para evitar colisiones entre proveedores, el webhook Evolution rechaza instancias que no estén registradas como activas.
- En una fase posterior se puede evaluar agregar `provider`/`provider_instance_id` a `messages` para auditoría multi-proveedor.

## D6. Alcance de media, templates e interactivos

**Decisión:** texto y estado primero.

- Fase 1: envío y recepción de texto, QR, estado de conexión, webhook seguro.
- Fase 2: media entrante/saliente si la traducción es directa.
- Templates e interactivos: solo si Evolution los soporta con equivalencia verificable; de lo contrario devolver error tipado de capacidad no soportada.

## D7. Riesgo operativo de WhatsApp Web/Baileys

**Decisión:** aceptado para pruebas, con avisos explícitos.

- La UI mostrará una advertencia de que Baileys no es la API oficial de WhatsApp.
- Se documentará que puede haber desconexiones, bloqueos o pérdida de sesión.
- No se usará Baileys como número principal de producción sin evaluación previa.

## D8. Licencia y notificación

**Decisión:** incluir aviso administrativo y documentación.

- Se mostrará en Settings → WhatsApp un aviso de que Evolution API está en uso.
- Se conservarán los avisos de licencia requeridos.
- Se recomienda revisión legal antes de distribución comercial.

## D9. Idempotencia

**Decisión:** reutilizar la idempotencia existente de `messages` (`conversation_id + message_id`) combinada con resolución de cuenta por instancia configurada.

- El webhook Evolution nunca procesa eventos de una instancia que no esté activa para esa cuenta.
- Reintentos del mismo `providerMessageId` se descartan antes de cualquier efecto secundario.

## D10. Cambio de proveedor

**Decisión:** operación manual desde Settings por admin.

- No se permite tener ambos activos simultáneamente.
- Cambiar de proveedor invalida la configuración anterior (se mantiene el registro histórico pero no se usa).
- No se migran conversaciones automáticamente.
