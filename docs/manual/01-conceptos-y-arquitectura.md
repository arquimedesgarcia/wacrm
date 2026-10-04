# 01 — Conceptos y arquitectura: Automatizaciones y Flujos

> Manual de usuario de waCRM — módulos de **Automatizaciones** y **Flujos**, y su integración con la IA y el trabajo humano.

---

## 1. Qué son y para qué sirven

waCRM ofrece dos herramientas de automatización que se complementan:

| | **Automatizaciones** | **Flujos** |
|---|---|---|
| **Qué es** | Una regla reactiva: *cuando pase X → haz Y, Z, W…* | Un bot conversacional visual: guía al cliente paso a paso por un menú de WhatsApp |
| **Estructura** | 1 disparador (trigger) + una lista ordenada de pasos (acciones, condiciones if/else, esperas) | Un grafo visual de nodos conectados (mensajes, botones, listas, capturas de datos, condiciones, handoff) |
| **Interacción con el cliente** | Reacciona a lo que el cliente hace; puede enviar mensajes, botones o listas, pero no "sostiene" una conversación guiada | Mantiene una conversación guiada: pregunta, espera la respuesta, bifurca según la respuesta, captura datos |
| **Esperas / tiempo** | Sí: paso `wait` (minutos/horas/días) que suspende y reanuda más tarde | No hay nodo de espera; el flujo se mantiene activo hasta que el cliente responde o vence el timeout (24 h por defecto) |
| **Uso típico** | Bienvenidas, respuestas por palabra clave, fuera de horario, seguimientos programados, etiquetado, asignación, creación de deals, webhooks | Menús de atención ( pedidos, catálogos, triaje de servicios), captura de leads cualificados, FAQ interactivo, derivación a humano |
| **Persistencia del estado** | Cada ejecución es una "corrida" independiente con log; las esperas quedan en una cola | Cada contacto tiene un "run" activo que recuerda en qué nodo está y las variables ya capturadas |

**Regla práctica:** usa **Automatizaciones** para reaccionar a eventos y para tareas de "back-office" (etiquetar, asignar, crear deals, esperar y reintentar). Usa **Flujos** cuando el cliente necesita *navegar opciones* o *dar datos paso a paso*.

Los dos se combinan: un Flujo cualifica al cliente y lo etiqueta; una Automatización escucha esa etiqueta y ejecuta el seguimiento (ver `04-combinaciones-y-patrones.md`).

---

## 2. Cómo se procesa un mensaje entrante (orden de prioridad)

Cuando llega un mensaje de un cliente, waCRM lo procesa en este orden. Entenderlo es la clave para no obtener respuestas duplicadas o bloqueos:

```
1. ¿El contacto tiene un Flujo activo (un "run" en curso)?
   └── SÍ → el Flujo consume el mensaje y decide:
        · respuesta esperada (botón/lista/texto de captura) → avanza el flujo
        · respuesta inesperada → política de fallback (reintentar / derivar a humano / ignorar)
        · si IGNORA → el mensaje queda libre y sigue al paso 2
   └── NO → ¿algún Flujo activo tiene un trigger de entrada que coincida
        (palabra clave o primer mensaje)? → arranca un nuevo run y CONSUME el mensaje

2. (Solo si el mensaje NO fue consumido por un Flujo)
   Automatizaciones con trigger de contenido:
   · new_message_received  → corre con CADA mensaje
   · keyword_match         → corre si el texto coincide
   · interactive_reply     → corre si tocó un botón con ese reply_id
   Importante: si alguna de estas corre, la IA de auto-respuesta NO actúa
   (para evitar doble respuesta al cliente).

3. (Solo si nadie consumió el mensaje y ninguna automatización de contenido corrió)
   Auto-respuesta IA: responde el asistente de IA si la cuenta lo tiene activado,
   la conversación no tiene agente asignado y no superó el tope de respuestas IA.

4. Derivación a humano (handoff), por cualquiera de estas vías:
   · nodo handoff de un Flujo
   · sentinel [[HANDOFF]] emitido por la IA cuando no puede ayudar
   · fallback de un Flujo agotado (reintentos) → handoff por defecto
   El handoff pone la conversación en estado "pending" (esperando humano),
   opcionalmente la asigna a un agente y deja nota interna.
```

### Consecuencias prácticas

- **Un Flujo con trigger `first_inbound_message` o `keyword` gana siempre** frente a automatizaciones de contenido y frente a la IA para ese mensaje.
- **Una automatización `new_message_received` o `keyword_match` que coincida silencia a la IA** para ese mensaje. Si quieres que la IA responda libremente, no uses esos triggers de forma amplia.
- Los triggers de relación (`new_contact_created`, `first_inbound_message`) **sí corren aunque un Flujo consuma el mensaje** — sirven para tareas paralelas de registro.
- **El humano manda:** cuando un agente responde desde el inbox, cualquier Flujo activo de ese contacto se pausa (`paused_by_agent`) y la auto-respuesta IA se desactiva para esa conversación.

> ⚠️ **Proveedor Evolution API (divergencia):** en la ruta de Meta (Cloud API) la supresión funciona como se describe arriba. En el webhook de Evolution, automatizaciones, flujos e IA se evalúan sin suprimirse entre sí, por lo que pueden solaparse (p. ej. respuesta del flujo + respuesta de la IA). Tenlo en cuenta si tu instalación usa Evolution.

---

## 3. Requisitos previos

Para que Automatizaciones y Flujos funcionen en producción necesitas:

1. **Cuenta de WhatsApp conectada** (Meta Cloud API o Evolution API) con número verificado. Los mensajes salen con esa identidad.
2. **Ventana de mensajería de 24 h:** los mensajes de sesión (texto, botones, listas, media) solo se entregan dentro de las 24 h desde el último mensaje del cliente. Fuera de esa ventana necesitas **plantillas aprobadas por Meta** (paso `send_template` de Automatizaciones).
3. **Cron externo configurado** (necesario para):
   - Reanudar las **esperas (`wait`)** de Automatizaciones: `GET /api/automations/cron`
   - Cerrar los **Flujos abandonados** (timeout): `GET /api/flows/cron`
   - Ambos exigen el header `x-cron-secret` con el valor de la variable de entorno `AUTOMATION_CRON_SECRET`. Si no está configurada, devuelven 503 y **las esperas nunca reanudan ni los flujos caducan**. Puedes programarlo con Vercel Cron, un pinger externo (UptimeRobot, cron-job.org) o el programador de tu servidor.
4. **Rol de usuario:** crear/editar/activar automatizaciones y flujos requiere rol **agente o superior** (viewer solo lee).
5. **Recursos creados de antemano** (según lo que uses): etiquetas, campos personalizados de contacto, pipelines y etapas, miembros del equipo, plantillas de WhatsApp aprobadas.

---

## 4. Conceptos clave

- **Trigger / disparador:** el evento que pone en marcha una Automatización o un Flujo.
- **Paso / nodo:** cada unidad de trabajo. En Automatizaciones hay 13 tipos de paso; en Flujos, 10 tipos de nodo.
- **Condición (if/else):** bifurca la ejecución en dos ramas (yes/no en Automatizaciones; true/false en Flujos). No hay operadores AND/OR: una condición = un solo test.
- **Espera (`wait`):** solo existe en Automatizaciones. Suspende la ejecución y la reanuda el cron en el momento indicado.
- **Etiqueta (tag):** marca a un contacto. Es el principal "pegamento" entre Flujos y Automatizaciones: añadir una etiqueta puede disparar una Automatización (`tag_added`).
- **Variables e interpolación:** en Flujos, `{{vars.nombre}}` inserta datos capturados del cliente; en Automatizaciones, `{{ message.text }}` inserta el texto del mensaje que disparó la regla.
- **Handoff:** derivación de la conversación a un humano (estado `pending`, posible asignación y nota interna).
- **Run / ejecución:** una corrida concreta del proceso sobre un contacto, con estado y trazabilidad (runs en Flujos, logs en Automatizaciones).

---

## 5. Glosario rápido

| Término | Significado |
|---|---|
| `reply_id` | Identificador interno de un botón o fila de lista; es lo que WhatsApp devuelve al tocarlo y lo que permite encadenar acciones |
| `vars` | Variables capturadas en un Flujo (nodo *Capturar respuesta*) reutilizables con `{{vars.clave}}` |
| `pending` | Estado de conversación "esperando atención humana" (derivada por handoff o fallback) |
| `closed` | Conversación cerrada; si el cliente vuelve a escribir, se reabre automáticamente |
| `paused_by_agent` | Flujo pausado porque un agente humano respondió (el humano retoma el control) |
| Auto-reply IA | Modo en que la IA responde sola mensajes entrantes (configurable en Ajustes → IA) |
| Knowledge base | Documentos propios que la IA consulta para responder con información de tu negocio |
| `[[HANDOFF]]` | Marca que la IA emite cuando no puede ayudar; activa la derivación a humano |

---

## 6. Mapa del manual

- **02 — Automatizaciones:** catálogo completo de triggers, condiciones y acciones, con guía del editor.
- **03 — Flujos:** los 10 nodos, triggers, variables, fallback, handoff y editor visual.
- **04 — Combinaciones y patrones:** cómo encadenar Flujos + Automatizaciones + IA + humanos sin pisarse.
- **05 — Casos de uso por vertical:** restaurantes, inmobiliario, turismo/boletos y seguros, con objetivos y alcance real.
- **06 — Referencia rápida:** tablas, límites de Meta, checklist y resolución de problemas.
