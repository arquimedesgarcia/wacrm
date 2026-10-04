# Manual de Usuario: Automatizaciones y Flujos de waCRM

> **Versión del código sobre el que se basa este manual:** rama `custom`, commit `1f5f75d` (febrero 2026).  
> Las funcionalidades descritas aquí están implementadas y verificadas en el repositorio local de tu fork.

---

## 1. Introducción

waCRM ofrece **dos sistemas de automatización conversacional** que trabajan juntos pero tienen propósitos distintos:

| Característica | **Automatizaciones** | **Flujos** |
|---|---|---|
| **Interfaz** | Lista lineal de pasos (como un storyboard) | Canvas visual de nodos y flechas |
| **Modelo de ejecución** | Secuencia plana con ramas yes/no para conditions | Grafo dirigido de nodos con conexiones explícitas |
| **Soporte de triggers** | 7 tipos (ver sección 2) | 3 tipos (keyword, first_inbound, manual) |
| **Espera (`wait`)** | ✅ Pasos con cron (resumen de 24h → envío) | No aplica (los nodos suspenden esperando respuesta del cliente) |
| **Webhook saliente (`send_webhook`)** | ✅ | No disponible en v1.5 |
| **Creación de contactos/prospectos (deals)** | ✅ `create_deal` | No en v1.5 |
| **Cierre de conversación** | ✅ `close_conversation` | Implícito en `end` |
| **Plantillas de partida** | 4 plantillas (welcome, out_of_office, lead_qualifier, follow_up_reminder) | 3 plantillas (welcome_menu, faq_bot, lead_capture) |
| **Fallback políticas** | El step siguiente siempre se ejecuta (o falla) | Política configurable: reprompt / handoff / ignore / end |
| **Concurrencia** | Fire-and-forget: todas las automatizaciones que matchean el trigger se disparan | Un contacto ↔ un solo flow activo (índice parcial único) |

### Principio rector: **complementan, no compiten**

- Un **Flujo** maneja la **navegación conversacional** (qué mensajes enviar y en qué orden, según las respuestas del cliente). Es el "guion" del diálogo.
- Una **Automatización** maneja **reacciones secundarias** y **accionables transversales** (etiquetar, crear oportunidades, enviar a un webhook externo, cerrar conversaciones, hacer follow-up tras un tiempo). Es el "efecto secundario".

**Patrón recomendado:** usa un Flow para la interacción principal y Automatizaciones para la orquestación de datos y follow-up. El webhook dispara Flows primero; si el Flow consume el mensaje (lo maneja), las Automatizaciones no se disparan para ese mensaje. Si el Flow no lo consume (no hay run activo ni trigger coincide), cae a Automatizaciones.

---

## 2. Triggers disponibles

### 2.1 Automatizaciones — 7 triggers

| Trigger | Cuándo dispara | Configuración | Etiqueta en UI |
|---|---|---|---|
| `new_message_received` | Cada mensaje entrante (cualquier contacto) | Vacío `{}` | New Message |
| `first_inbound_message` | Primer mensaje de un contacto (nuevo o importado) | Vacío `{}` | First Message from Contact |
| `keyword_match` | El texto contiene/equals/palabra clave | `keywords[]`, `match_type` (exact/contains/word), `case_sensitive` | Keyword Match |
| `new_contact_created` | Se crea un nuevo registro de contacto | Vacío `{}` | New Contact |
| `conversation_assigned` | Se asigna una conversación a un agente | `agent_id` (opcional) | Conversation Assigned |
| `tag_added` | Se le agrega un tag a un contacto | `tag_id` | Tag Added |
| `time_based` | Basado en horario/cron (configurado en `trigger_config.schedule`) | `schedule` (cron o `HH:mm`), `timezone` | Time-Based |
| `interactive_reply` | El cliente toca un botón/lista cuyo `reply_id` coincide | `reply_ids[]` | Button / List Reply |

### 2.2 Flujos — 3 triggers

| Trigger | Cuándo dispara | Configuración | Match |
|---|---|---|---|
| `keyword` | Texto del mensaje contiene keyword | `keywords[]`, `match_type` (exact/contains), `case_sensitive` | **Siempre substring** (case-insensitive). No hay `word`. |
| `first_inbound_message` | Primer mensaje del contacto | Vacío | Booleano |
| `manual` | Solo por POST `/api/flows/{id}/run` o clic en UI | Vacío | Ninguno (no auto-dispara) |

> **Nota clave:** Un Flujo también puede iniciar si el cliente toca un botón cuyo **título visible** (no el reply_id) contiene la keyword. Esto permite encadenar botones de una Automatización → detonación de un Flujo.

### 2.3 Concurrencia y orden de disparo

El webhook (`src/lib/whatsapp/webhook`) ejecuta este orden:

1. **Flows primero:** `dispatchInboundToFlows()` busca un run activo para el contacto; si lo encuentra, avanza el nodo. Si no, busca un Flujo activo cuyo trigger coincida.
2. **Automatizaciones después:** Solo si el Flow **no consumió** el mensaje (`consumed: false`). Si un Flow está activo para el contacto y recibe un mensaje que no coincide con su nodo actual, el Flow aplica su política de fallback (reprompt/handoff/ignore/end). Si la política es `ignore`, el mensaje cae a Automatizaciones.

---

## 3. Pasos / Nodos disponibles

### 3.1 Automatizaciones — 13 tipos de step

| Step | Qué hace | Configuración | Interés para casos de uso |
|---|---|---|---|
| `send_message` | Envía texto | `text` | ✅ |
| `send_buttons` | Envía botones rápidos | `InteractiveMessagePayload` | ✅ |
| `send_list` | Envía lista desplegable | `InteractiveMessagePayload` | ✅ |
| `send_template` | Usa plantilla de Meta | `template_name`, `language`, `variables{}` | ✅ (mensajes proactivos) |
| `add_tag` | Etiqueta contacto | `tag_id` | ✅ |
| `remove_tag` | Quita etiqueta | `tag_id` | ✅ |
| `assign_conversation` | Asigna a agente | `mode` (specific/round_robin), `agent_id` | ✅ |
| `update_contact_field` | Actualiza campo contacto | `field` (name/email/company/custom:UUID), `value` | ✅ |
| `create_deal` | Crea oportunidad | `pipeline_id`, `stage_id`, `title`, `value` | ✅ |
| `wait` | Pausa con cron | `amount`, `unit` (minutes/hours/days) | ✅ (follow-up) |
| `condition` | Rama condicional | `subject` (tag_presence/contact_field/message_content/time_of_day), `operand`, `value` | ✅ |
| `send_webhook` | Llama endpoint externo | `url`, `headers{}`, `body_template` | ✅ (integraciones) |
| `close_conversation` | Cierra conversación | — | ✅ |

#### Interpolación de variables

En `send_message`, `send_template_variables`, `update_contact_field.value`, `send_webhook.body_template` y `assign_conversation` (via condition):

- `{{ vars.nombre }}` — variables capturadas por CollectInput (Solo Flows)
- `{{ message.text }}` — texto del mensaje que disparó la automatización

#### Condiciones: profundidad

4 tipos de subject para `condition`:

1. **`tag_presence`** — ¿tiene el contacto un tag específico? `operand` = tag UUID. Operator: `equals` (presente) / `absent`.
2. **`contact_field`** — compara un campo del contacto. `operand` = nombre del campo (`name`, `email`, `company`, o `custom:<id>`). Operator: `equals` / `contains`.
3. **`message_content`** — ¿el texto del mensaje contiene un valor? `operand` = substring.
4. **`time_of_day`** — ¿estamos en un rango horario? `operand` = `"HH:mm-HH:mm"` (soporta overnight, ej: `"18:00-09:00"`).

Las condiciones usan ramas **yes/no** en el builder lineal. Un `condition` puede contener steps anidados en ambas ramas.

### 3.2 Flujos — 9 tipos de nodo

| Nodo | Qué hace | Configuración | Tipo de ejecución |
|---|---|---|---|
| `start` | Entrada del flujo | `next_node_key` | Auto-avanza |
| `send_message` | Texto | `text`, `next_node_key` | Auto-avanza |
| `send_buttons` | Botones | `text`, `buttons[]`, `header_text?`, `footer_text?` | **Suspende** (espera tap) |
| `send_list` | Lista | `text`, `button_label`, `sections[]` | **Suspende** (espera tap) |
| `send_media` | Imagen/video/doc | `media_type`, `media_url`, `caption?`, `filename?` | Auto-avanza |
| `collect_input` | Captura respuesta | `prompt_text`, `var_key`, `next_node_key` | **Suspende** (espera texto) |
| `condition` | Ruta por regla | `subject` (var/tag/contact_field), `subject_key`, `operator`, `value`, `true_next`, `false_next` | Auto-avanza |
| `set_tag` | Agrega/quita tag | `mode` (add/remove), `tag_id` | Auto-avanza |
| `handoff` | Entrega a agente | `assign_to?`, `note?` | Terminal |
| `end` | Cierra flujo | — | Terminal |

#### Variables en Flows

- `{{ vars.nombre }}` — capturadas por nodos `collect_input` anteriores.
- Las variables se almacenan en `flow_runs.vars` (JSONB) y persisten durante el run.
- El motor reinicia el contador de reprompts a 0 cuando hay un match exitoso.

#### Políticas de fallback (Flows)

Cuando un cliente responde algo que no coincide con el nodo actual:

| Política | Comportamiento | Útil para |
|---|---|---|
| `reprompt` (default) | Reenvía el prompt, hasta `max_reprompts` (default 2). Luego `on_exhaust`. | Capturar información obligatoria |
| `handoff` | Entrega inmediata al agente. | Quejas / prioridad alta |
| `ignore` | No consume el mensaje → cae a Automatizaciones. | Flujos que no deben bloquear el resto |
| `end` (on_exhaust) | Cierra el run. | Flujos de información única |
| `handoff` (on_exhaust) | Entrega tras agotar reprompts. | Requiere atención humana |
| `on_timeout_hours` (default 24) | El cron `/api/flows/cron` cierra runs inactivos. | Evitar que el run bloquee nuevos disparos |

---

## 4. Arquitectura de ejecución

### 4.1 Automatizaciones — fire-and-forget con cron para `wait`

```
Webhook inbound → runAutomationsForTrigger(accountId, triggerType, contactId, context)
  ├─ Verifica tenencia (contact pertenece al account)
  ├─ Obtiene todas las automations activas con el trigger_type
  ├─ Para cada una: triggerMatches() → executeAutomation()
  │   ├─ Crea automation_logs (status=seed 'failed')
  │   └─ executeStepsFrom() — ejecuta steps secuenciales
  │       ├─ wait → inserta automation_pending_executions.run_at = now + N
  │       │   Cron POST /api/automations/cron → resumePendingExecution()
  │       └─ condition → ejecuta recursivamente la rama yes/no
```

**Logs de ejecución:** Cada automation genera un registro en `automation_logs` con `steps_executed[]`, `status` (success/parcial/failed) y `error_message`. Se accede desde la UI vía `/automations/{id}/logs`.

### 4.2 Flujos — estado de run con concurrencia optimista

```
Webhook inbound → dispatchInboundToFlows(accountId, contactId, message, isFirstInbound)
  ├─ loadActiveRunForContact() — ¿tiene el contacto un run activo?
  │   ├─ SÍ: handleReplyForActiveRun()
  │   │   ├─ matchReplyId() / collect_input capture → advanceFromNodeKey()
  │   │   └─ Fallback policy si no match
  │   └─ NO: findEntryFlow() — busca flow activo cuyo trigger coincida
  │       └─ startNewRun() → advanceFromNodeKey() desde entry_node_id
  │           └─ Cada nodo: send_* (Meta API) → advanceCurrentNodeKey()
  │               └─ UPDATE optimista con precondition .eq('current_node_key', oldKey)
  │                   └─ Si 0 rows → race condition perdida, se ignora
```

**Concurrencia:** Índice parcial único `idx_one_active_run_per_contact` sobre `(account_id, contact_id) WHERE status='active'` impide dos runs simultáneos. Los UPDATE usan `.eq('status', 'active')` como guarda.

---

## 5. Casos de uso por sector

### 5.1 Restaurantes — Ventas por WhatsApp

**Objetivo:** Automatizar toma de pedidos, reservas y atención post-venta.

#### Patrón A: Menú interactativo + captura de pedido

**Flow: "Pedido por botones"** (trigger: `first_inbound_message`)

```
start → send_message "¡Hola! 👋 ¿Qué buscas hoy?" → send_buttons
  └─ btn_pedido → collect_input "¿Qué quieres pedir?" (var=pedido)
  └─ btn_reserva → collect_input "¿Para cuántas personas?" (var=comensales)
  └─ btn_consulta → handoff (nota: "Consulta sobre menú")
```

El nodo `collect_input` captura la respuesta del cliente. Si escribe algo inesperado, el fallback `reprompt` vuelve a preguntar. Tras 2 intentos, `handoff` entrega al mesero.

**Automatización complementaria: "Etiquetado de pedido"** (trigger: `keyword_match` "pedido")

```
Condition: tag_presence "En espera" → (yes) send_message "Tu pedido está siendo preparado. ⏰"
         → add_tag "Preparando"
         → wait 30 minutes → send_message "¡Tu pedido está listo! Puedes pasar a recogerlo."
         → remove_tag "Preparando"
         → add_tag "Listo para recoger"
```

#### Patrón B: Follow-up post-venta

**Automatización: "Satisfacción post-pedido"** (trigger: `tag_added`, `tag_id`="Pedido entregado")

```
wait 2 hours
→ send_message "¿Cómo estuvo tu pedido? Califica con 1-5 estrellas ✨"
→ wait 24 hours
→ condition: message_content "1" (cliente quejoso)
  yes → send_message "Lamentamos eso. Un mesero te contacta en 5 min." + assign_conversation (round_robin)
  no  → send_message "¡Gracias! Vuelve pronto 🙌" + add_tag "Cliente satisfecho"
```

#### Patrón C: Promociones por horario

**Automatización: "Happy Hour"** (trigger: `time_based`, schedule `"16:00-18:00"` diario, timezone America/Caracas)

```
Condition: tag_presence "Cliente habitual"
  yes → send_template "happy_hour" con variables {1: "20% OFF"}
```

**Combinado con:** Un Flujo `keyword` "promo" que muestra el menú de happy hour con botones. Los botones usan `reply_id`s que disparan otra Automatización `interactive_reply` para aplicar el descuento en el sistema POS vía `send_webhook`.

#### Patrón D: Reservas con validación

**Flow: "Reserva de mesa"** (trigger: `keyword` "reservar")

```
start → send_message "¡Claro! Necesito unos datos:"
→ collect_input "Nombre:" (var=nombre)
→ collect_input "¿Cuántas personas?" (var=comensales)
→ condition: var(comensales) > 6
  yes → send_message "Para grupos grandes, por favor llama al 0123-456-7890"
  no  → collect_input "¿Hora preferida? (ej: 19:30)" (var=hora)
  → send_webhook a sistema de reservas (POS) con {nombre, comensales, hora}
  → send_message "¡Listo {{vars.nombre}}! Tu reserva está confirmada para {{vars.hora}}."
→ set_tag "Reserva confirmada" → end
```

> ✅ La integración con el POS se hace via `send_webhook` (Automatizaciones) o directamente como nodo final del Flow (el Flow no tiene `send_webhook` en v1.5, pero puedes usar una Automatización `interactive_reply` que dispare en el `btn_confirmar` del Flow).

---

### 5.2 Inmobiliaria — Alquiler, Compra, Venta

**Objetivo:** Capturar leads, clasificar por interés, distribuir a agentes.

#### Patrón A: Clasificación de leads con scoring

**Automatización: "Scoring de lead"** (trigger: `first_inbound_message`)

```
add_tag "Nuevo lead"
→ send_message "¡Hola! Para ayudarte mejor, ¿qué buscas? Escribe: ALQUILER, COMPRA o VENTA"
→ wait 2 minutes (espera respuesta)
```

> El `wait` croniza la segunda fase. Si el cliente responde antes, el trigger `new_message_received` dispara otra Automatización que etiqueta según el keyword.

**Automatización: "Clasificación por keyword"** (trigger: `keyword_match`)

```
Condition: message_content "ALQUILER" → add_tag "Interés: Alquiler" → remove_tag "Nuevo lead" → add_tag "Prioridad media"
Condition: message_content "COMPRA" → add_tag "Interés: Compra" → add_tag "Prioridad alta"
Condition: message_content "VENTA" → add_tag "Interés: Venta" → add_tag "Prioridad alta"
```

#### Patrón B: Flow de captura de datos

**Flow: "Ficha de prospecto"** (trigger: `tag_added`, `tag_id`="Nuevo lead" — *Nota: en v1.5 Flows no soportan tag_added; usar keyword "hola"*)

```
start → send_message "¡Perfecto! Permíteme recopilar tus datos:"
→ collect_input "Nombre completo:" (var=nombre)
→ collect_input "Email:" (var=email)
→ collect_input "Teléfono de contacto:" (var=telefono)
→ collect_input "Presupuesto mensual (alquiler) o máximo (compra):" (var=presupuesto)
→ collect_input "Tipo de inmueble (1-2-3 habitaciones, departamento/casa):" (var=tipo)
→ send_message "¡Gracias {{vars.nombre}}! Un asesor inmobiliario te contacta en breve."
→ create_deal (pipeline="Inmobiliaria", stage="Lead nuevo", title="Prospecto {{vars.nombre}}")
→ set_tag "Datos capturados" → handoff (asigna a round_robin)
```

#### Patrón C: Envío de propiedades disponibles

**Automatización: "Catálogo automático"** (trigger: `keyword_match` "propiedades")

```
send_list "Propiedades disponibles esta semana:"
  section "Alquileres" → row_1 "Depto $800 - Chacao" → next: send_media (foto)
  section "Alquileres" → row_2 "Casa $1200 - CCSS" → next: send_media (foto)
  section "Ventas" → row_3 "Depto $180k - Lomas" → next: send_media (foto)
  section "Otros" → row_4 "Hablar con asesor" → next: handoff
```

> El `send_media` envía una foto del inmueble. El `send_list` permite hasta 10 filas.

#### Patrón D: Follow-up de leads fríos

**Automatización: "Reactivación"** (trigger: `time_based`, schedule `"cron 0 9 * * MON-FRI"`)

```
Condition: tag_presence "Nuevo lead" (lead sin respuesta en 48h)
  yes → send_template "followup_lead" con variables {1: nombre, 2: "+58 0123..."}
  → add_tag "Contactado"
Condition: tag_presence "Contactado" (lead sin respuesta en 7 días)
  yes → send_message "Último intento. Si sigue sin interés, te quitamos de la lista."
  → wait 3 days → condition: no reply → remove_tag "Nuevo lead" + close_conversation
```

---

### 5.3 Turismo — Boletos y paquetes

**Objetivo:** Vender boletos, paquetes, manejar disponibilidad, confirmar reservas.

#### Patrón A: Asistente de destinos

**Flow: "Explorador de destinos"** (trigger: `keyword` "viaje")

```
start → send_message "¡Hola! ¿A dónde te gustaría viajar? 🇻🇪✈️"
→ send_buttons
  btn_nacional → send_message "Tenemos paquetes a: Caracas, Maracaibo, Valencia"
  btn_internacional → send_message "Destinos: Miami, Madrid, Panamá"
  btn_urgente → collect_input "¿Cuándo viajas?" (var=fecha) → send_message "Reservando..."
```

#### Patrón B: Venta de boletos con validación de disponibilidad

**Automatización: "Venta de boletos"** (trigger: `keyword_match` "boleto")

```
send_message "¿A dónde vuelas?"
→ wait 5 minutes
```

**Flow complementario disparado por botón:**

```
start → collect_input "Origen:" (var=origen)
→ collect_input "Destino:" (var=destino)
→ collect_input "Fecha:" (var=fecha)
→ collect_input "Pasajeros:" (var=pasajeros)
→ send_webhook a API de aerolínea → recibe disponibilidad
→ send_list "Vuelos disponibles:" con tarifas
  → row_seleccionar → send_message "Confirmando tu reserva..."
  → collect_input "Datos de contacto:" (var=contacto)
  → send_template "confirmacion_boleto" con {1: origen, 2: destino, 3: fecha}
  → set_tag "Boleto confirmado"
→ end
```

#### Patrón C: Paquetes turísticos con upsell

**Flow: "Paquetes all-inclusive"** (trigger: `keyword` "paquete")

```
start → send_message "¿Para cuántas personas?"
→ collect_input (var=comensales)
→ send_list "Destinos disponibles:"
  → row_cancun → send_message "¡Excelente! Incluye: vuelo, hotel 5★, traslados. Precio: $899"
  → send_buttons
    btn_reservar → collect_input "Nombre completo:" (var=nombre) → collect_input "Email:" (var=email)
    → send_webhook a sistema de reservas → recibe confirmación con código
    → send_message "¡Listo {{vars.nombre}}! Tu código de reserva es {{vars.codigo}}"
    → add_tag "Paquete reservado"
    → end
    btn_mas_info → send_message "Incluye:..." → send_buttons btn_reservar / btn_preguntar
```

#### Patrón D: Recordatorios de viaje

**Automatización: "Check-in automático"** (trigger: `tag_added`, `tag_id`="Viaje confirmado")

```
wait 24 hours
→ send_template "checkin_recordatorio" con {1: nombre, 2: fecha}
→ add_tag "Check-in enviado"
→ wait 2 hours
→ send_message "¿Necesitas ayuda con el equipaje o asientos especiales?"
```

---

### 5.4 Seguros — Ventas y siniestros

**Objetivo:** Cotizar, vender pólizas, gestionar siniestros, follow-up.

#### Patrón A: Asistente de cotización

**Flow: "Cotizador de seguros"** (trigger: `keyword` "seguro")

```
start → send_message "¿Qué tipo de seguro necesitas?"
→ send_list "Opciones:"
  → row_auto → collect_input "Marca y modelo del auto:" (var=auto)
  → collect_input "Año:" (var=año)
  → collect_input "Tu edad:" (var=edad)
  → send_webhook a motor de cotización → recibe prima
  → send_message "Tu cotización: ${{vars.prima}} mensuales. ¿La aceptas?"
  → send_buttons "Sí" (aceptar) / "No" (hablar con agente)
  → btn_aceptar → collect_input "Datos de facturación:" (var=datos)
  → send_webhook a sistema de pólizas → genera póliza
  → send_template "confirmacion_seguro" con {1: numero_poliza}
  → set_tag "Cotizado" → end
  → btn_agente → handoff (nota: "Lead de seguro sin aceptar cotización")
```

#### Patrón B: Captura de leads calificados

**Automatización: "Lead calificado"** (trigger: `tag_added`, `tag_id`="Cotizado")

```
Condition: tag_presence "Cotizado"
  yes → send_message "¿Qué tal {{vars.nombre || 'tu cotización'}}? Tienes 24h para aceptar antes de que expire."
  → wait 23 hours
  → condition: tag_presence "Venta cerrada" (no)
    yes → send_message "Tu oferta sigue disponible. Aprovecha antes de que cierre."
    no  → send_message "Veo que no aceptaste. ¿Te envío otra cotización? Responde SÍ."
    → add_tag "Reingeniería"
```

#### Patrón C: Siniestro con flujo estructurado

**Flow: "Gestión de siniestro"** (trigger: `keyword` "siniestro")

```
start → send_message "Lamento tu siniestro. Necesito algunos datos:"
→ collect_input "Número de póliza:" (var=poliza)
→ send_buttons "Siniestro de auto" / "Siniestro de vida" / "Otro"
  → btn_auto → collect_input "Placa del vehículo:" (var=placa)
  → collect_input "Descripción del incidente:" (var=descripcion)
  → collect_input "Coordenadas o dirección:" (var=ubicacion)
  → send_message "Tu caso está registrado. Un agente te contacta en 15 minutos."
  → create_deal (pipeline="Siniestros", stage="En trámite", title="Siniestro {{vars.poliza}}")
  → assign_conversation (specific agent "Equipo de siniestros")
  → add_tag "Siniestro registrado"
  → end
```

#### Patrón D: Follow-up de clientes

**Automatización: "Retención post-vencimiento"** (trigger: `time_based`, schedule `"cron 0 10 1 * *"` — primer día de cada mes)

```
Condition: tag_presence "Póliza próxima a vencer" (etiquetado por sistema)
  yes → send_template "renovacion_seguro" con {1: nombre, 2: fecha_vencimiento}
  → add_tag "Recordatorio enviado"
  → wait 7 days
  → condition: tag_presence "Renovado" (no)
    yes → nothing (ya renovó)
    no  → send_message "¿Tienes dudas sobre tu renovación? Un agente te asiste." + handoff
```

---

## 6. Combinaciones avanzadas (patrones reutilizables)

### 6.1 "Botón → Flow → tag_added → Automatización"

```
[Flow send_buttons] btn_cotizar → reply_id="cotizar"
  → [Flow] collect_input (nombre, email, interés)
  → [Flow] send_message "Enviando a un agente..."
  → [Flow] end (handoff)
  → [Flow set_tag] "Lead con datos"  ← esta etiqueta dispara:
  → [Automatización trigger=tag_added] send_webhook al CRM externo con {nombre, email, interés}
  → [Automatización] add_tag "En seguimiento"
  → [Automatización] wait 2h → send_message "¿Te contactamos?"
```

### 6.2 "Keyword → Flow → botón → Automatización interactiva"

```
[Automatización trigger=keyword_match "menu"]
  → send_buttons "Opciones:" btn_pedir / btn_preguntar / btn_hablar
  → (NO wait — termina aquí)

[Flow trigger=interactive_reply reply_ids=["pedir"]]
  → collect_input "¿Qué deseas?" (var=producto)
  → send_message confirmando → end

[Automatización trigger=keyword_match "hablar"]
  → handoff + assign_conversation round_robin
```

### 6.3 "Webhook externo → tag_added → Automatización → send_template"

```
[send_webhook en Flow] → sistema externo actualiza CRM → webhook a waCRM
  → actualiza contact_field "ultima_compra" = fecha
  → add_tag "Comprador frecuente"
  → [Automatización trigger=tag_added tag_id="Comprador frecuente"]
  → send_template "fidelidad" con variables personalizadas
  → condition: contact_field "ultima_compra" > 30 días
    yes → send_message "Hace tiempo que no compras. ¿Necesitas ayuda?"
```

### 6.4 "Time-based trigger → condition → send_template → wait → follow-up"

```
[Automatización trigger=time_based schedule="cron 0 9 * * *"]
  → condition: tag_presence "Lead frío"
    yes → send_template "reactivacion" {1: nombre}
    → add_tag "Reactivado"
    → wait 3 days
    → condition: tag_presence "Respondido" (no)
      yes → close_conversation (no interesado)
      no  → send_message "¿Ves? Tenemos ofertas esta semana." + send_media (flyer)
```

---

## 7. Buenas prácticas y limitaciones

### 7.1 Límites de WhatsApp (Meta)

| Elemento | Límite | Aplicable en |
|---|---|---|
| Botones quick-reply | **3** por mensaje | `send_buttons` (Flow y Automatización) |
| Filas de lista | **10** por mensaje | `send_list` (Flow y Automatización) |
| Secciones de lista | **10** por mensaje | `send_list` |
| Texto body | 1024 chars | `send_message` |
| Caption media | 1024 chars | `send_media`, `send_template` |
| Template body | 1024 chars | `send_template` |

### 7.2 Límites de waCRM

- Un contacto **solo puede tener un Flow activo** a la vez. Si un Flow está suspendido esperando respuesta, no se iniciará otro hasta que termine.
- Las **Automatizaciones no tienen límite** — si múltiples matchean el mismo trigger, todas se disparan.
- **`wait` en Automatizaciones** usa cron. Requiere que alguien haga ping a `/api/automations/cron` (puedes usar el cron de Railway, GitHub Actions, o un pinger externo). El secreto es `AUTOMATION_CRON_SECRET`.
- **`send_webhook`** tiene SSRF protection: no puede apuntar a direcciones privadas (10.x, 192.168.x, localhost, etc.) ni seguir redirects.
- **Plantillas de Meta** requieren aprobación. `send_template` fallará si la plantilla está en estado `PENDING` o `REJECTED`. La UI filtra solo `APPROVED`.

### 7.3 Recomendaciones de implementación por etapas

#### Etapa 1 (MVP — semana 1)
- **Automatización:** Welcome message (template) + etiqueta "Nuevo contacto".
- **Flow:** Menú principal con 3 botones (Pedir / Consultar / Hablar con agente).
- Objetivo: cubrir 80% de interacciones con respuestas automáticas.

#### Etapa 2 (Captura de leads — semana 2)
- **Flow:** Collect input chain (nombre, email, interés) → termina en handoff.
- **Automatización:** Keyword match → envía datos a webhook externo (CRM).
- Objetivo: capturar datos de contacto calificados.

#### Etapa 3 (Follow-up y scoring — semana 3)
- **Automatización:** Time-based → reactivar leads fríos con template.
- **Automatización:** Tag_added → pipeline de nurtura por interés.
- **Flow:** Condición que ramifica por presupuesto o tipo de servicio.
- Objetivo: automatizar el nurturing post-captura.

#### Etapa 4 (Integración avanzada — semana 4+)
- **Flow + send_webhook:** Integración directa con POS/sistema externo para disponibilidad en tiempo real.
- **Automatización:** Condiciones complejas, creación de deals, cierre automático.
- Objetivo: venta completamente automatizada con back-office sincronizado.

### 7.4 Qué NO hacer

| ❌ Antipatrón | ✅ Solución |
|---|---|
| Un Flow de 15+ nodos con muchos collect_input | Divide en múltiples Flows temáticos + Automatizaciones para follow-up |
| Usar `send_webhook` como única vía de captura (sin confirmación visual) | Siempre confirma al cliente con `send_message` después del webhook |
| Condition anidada 3+ niveles | Usa tags intermedios: add_tag → Automatización separada con tag_added trigger |
| `wait` de más de 24h en Automatizaciones | Usa `time_based` trigger + cron en su lugar (más fiable) |
| Flow con `send_buttons` de 4+ botones | WhatsApp límite es 3. Usa `send_list` para más opciones |
| Capturar datos sensibles (PAN, passwords) en collect_input | El motor no persiste el texto capturado en logs, pero el mensaje llega a Meta. Usa `send_webhook` directo para datos sensibles |

---

## 8. Guía rápida de inicio (cheat sheet)

### Crear una Automatización básica de bienvenida

1. Navega a **Automatizaciones** → **Crear nueva**
2. Trigger: `First Message from Contact`
3. Step 1: `send_message` → "¡Hola! 👋 Bienvenido/a. ¿En qué podemos ayudarte?"
4. Step 2: `add_tag` → selecciona "Nuevo lead"
5. Step 3: `wait` → 1 hora
6. Step 4: `condition` → `contact_field` = `ultima_respuesta`, operator `absent`
   - yes: `send_message` → "¿Aún necesitas ayuda? Escribe *menu* para ver nuestras opciones."
   - no: (nada)
7. Activa y lista.

### Crear un Flow interactivo

1. Navega a **Flujos** → **Crear nuevo**
2. Trigger: `Keyword` → escribe "hola", "menu", "ayuda"
3. En el canvas:
   - Arrastra `Start` → conecta a `send_buttons`
   - Configura 3 botones: "Ver menú" (reply_id: `ver_menu`), "Hablar con un agente" (reply_id: `agente`), "FAQ" (reply_id: `faq`)
   - Desde `ver_menu` → `send_list` con productos
   - Desde `faq` → `send_message` con respuestas + `end`
   - Desde `agente` → `handoff`
4. Activa → lista. El cron de flows se encarga de timeout.

### Combinar Flow + Automatización

1. El Flow envía `send_buttons` con un botón "Confirmar pedido" (reply_id: `confirmar`)
2. Crea una **Automatización** con trigger `interactive_reply`, reply_ids: `["confirmar"]`
3. La Automatización hace: `send_webhook` (registrar pedido en POS) → `add_tag` "Pedido confirmado" → `wait 30 min` → `send_message` "Tu pedido está en camino" → `close_conversation`

---

## 9. Referencias técnicas (para desarrolladores)

- **Motor de Automatizaciones:** `src/lib/automations/engine.ts` — 845 líneas. Entry point: `runAutomationsForTrigger()`.
- **Motor de Flujos:** `src/lib/flows/engine.ts` — 1155 líneas. Entry point: `dispatchInboundToFlows()`.
- **Cron Automatizaciones:** `src/app/api/automations/cron/route.ts` — procesa `automation_pending_executions`.
- **Cron Flujos:** `src/app/api/flows/cron/route.ts` — cierra runs activos con timeout.
- **Templates:** `src/lib/automations/templates.ts` (4 templates) y `src/lib/flows/templates.ts` (3 templates).
- **Validación de Automatizaciones:** `src/lib/automations/validate.ts`.
- **Validación de Flujos:** `src/lib/flows/validate.ts`.
- **Edge derivation:** `src/lib/flows/edges.ts` (canvas ↔ config).
- **Triggers metadata:** `src/lib/automations/trigger-meta.ts`.
- **API Automatizaciones:** `src/app/api/automations/` (CRUD + cron + engine POST).
- **API Flujos:** `src/app/api/flows/` (CRUD + cron + templates + manual run).

---

**Conclusión:** waCRM brinda una potencia combinada extraordinaria. Los **Flujos** son ideales para diálogos guiados (menús, captura de datos, asistentes conversacionales), mientras que las **Automatizaciones** son el motor de orquestación transversal (etiquetado, follow-up, integración con sistemas externos, creación de oportunidades). Para restaurantes, inmobiliaria, turismo y seguros, la combinación Flow + Automatización conectar con un CRM externo vía `send_webhook` permite construir experiencias de venta 100% automatizadas por WhatsApp. La implementación por etapas (MVP → captura → nurturing → integración avanzada) es viable y cada fase añade valor medible.
