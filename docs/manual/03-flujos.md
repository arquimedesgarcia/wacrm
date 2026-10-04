# 03 — Flujos: guía completa del bot conversacional

> Un Flujo es un **grafo visual de nodos** que guía al cliente de WhatsApp paso a paso. El motor "camina" al contacto por el grafo, suspendiéndose solo en los nodos que requieren su respuesta (botones, listas, captura de texto); cada respuesta lo despierta y continúa donde quedó.

---

## 1. El editor visual

- **Canvas** (vista por defecto): nodos arrastrables con pan/zoom/minimap. Conectas nodos arrastrando desde los *handles* de salida (coloreados por tipo de conexión: botones, filas de lista, ramas true/false). Clic en un nodo abre el panel lateral de configuración. `Supr`/`Delete` elimina el nodo o arista seleccionados. Los bucles de un nodo a sí mismo se rechazan.
- **Vista de lista**: alternativa lineal (persistente; en móvil es la única). Misma configuración, formato de tarjetas apiladas.
- **Barra superior**: nombre y descripción editables, chip de estado, indicador de cambios sin guardar, botones **Runs**, **Eliminar**, **Activar/Pausar** y **Guardar**. Activar guarda primero y exige validación sin errores.
- **Validación en vivo**: el panel de validación lista problemas antes de activar (nombre vacío, keywords vacías, conexiones rotas, nodos inalcanzables como aviso, límites de Meta). El servidor vuelve a validar al activar (`/api/flows/[id]/activate`) y devuelve 422 con la lista de fallos.

**Permisos:** leer requiere solo sesión; crear/editar/activar/borrar requiere rol **agente+**.

---

## 2. Triggers de entrada (cómo arranca un Flujo)

Se configuran en el panel del trigger (tipo + palabras clave) y en el selector del **nodo de entrada**.

| Trigger | Configuración | Comportamiento |
|---|---|---|
| **Keyword** | lista de palabras, `match_type`: *exact* / *contains* (defecto), `case_sensitive` (defecto: no) | Arranca cuando el texto escrito coincide. Además matchea contra el **título visible y el reply_id** de un toque en botón/lista: así un botón enviado por una automatización o broadcast puede arrancar el flujo. |
| **First inbound message** | — | Arranca en el **primer mensaje** del contacto (texto o toque). Si hay varios flujos activos con este trigger, gana el más antiguo (`created_at`). |
| **Manual** | — | ⚠️ **Nunca se auto-dispara** y no hay UI/API para lanzarlo sobre un contacto: queda reservado. No lo uses para producción. |

**Reglas de convivencia:**

- Solo **un run activo por contacto**: si un cliente ya está dentro de un flujo, un segundo trigger se ignora (hasta que el run termine, se derive, caduque o el humano lo pause).
- Si el flujo **consume** el mensaje, las automatizaciones de contenido y la IA no actúan sobre él (ver `01-conceptos-y-arquitectura.md` §2; salvo proveedor Evolution, donde no hay supresión).

---

## 3. Los 10 nodos

### Messaging

**1. Start (punto de entrada)** — Sin configuración de contenido; su salida `next_node_key` apunta al primer nodo real. El flujo tiene un `entry_node_id` elegible con un selector (si el primer nodo que creas es un Start, se auto-selecciona).

**2. Send message (enviar texto)** — `text` plano, admite interpolación `{{vars.X}}`. **Auto-avanza** al siguiente nodo: no espera respuesta. Úsalo para saludos, confirmaciones y transiciones.

**3. Send buttons (botones de respuesta rápida)** — Cuerpo `text`, opcional `header`/`footer`, y **1–3 botones**. Cada botón:
- `title`: etiqueta visible (**≤20 caracteres**).
- `reply_id`: identificador interno que Meta devuelve al tocarlo (editable en "Mostrar avanzado"; por defecto `btn_1`, `btn_2`…). Pon ids estables y significativos (`pedir`, `reservar`) si vas a encadenar automatizaciones con *Interactive reply*.
- `next_node_key`: a dónde avanza al tocar ese botón.
- **Suspende** el flujo esperando el toque.

**4. Send list (lista interactiva)** — Cuerpo, `button_label` (texto del botón que despliega la lista), `header`/`footer`, y secciones con filas. Cada fila: `reply_id`, `title` (**≤24**), `description` opcional (**≤72**), destino. Límites de Meta: **máx. 10 filas en total** entre todas las secciones. **Suspende** esperando la selección. Es el nodo ideal para catálogos: secciones = categorías, filas = productos/propiedades/destinos.

**5. Send media (imagen, video o documento)** — `media_type` (image/video/document), `media_url` (se sube desde el builder al bucket *flow-media*, máx. 16 MB, con MIME permitidos: png/jpeg/webp, mp4/3gpp, Office/PDF/txt…), `caption` opcional (**≤1024**, admite `{{vars.X}}`), `filename` solo para documentos. **Auto-avanza** tras enviar.

### Logic & data

**6. Collect input (capturar respuesta de texto)** — `prompt_text` (la pregunta que se envía antes de suspenderse; admite `{{vars.X}}`), `var_key` (nombre de la variable donde se guarda la respuesta: identificador alfanumérico, debe empezar por letra o `_`), `next_node_key`. **Suspende** esperando texto.
- Captura **cualquier texto no vacío**. Los campos `validation` (email/phone/regex) están **reservados para v2: se aceptan en configuración pero el motor los ignora y no hay UI**. Valida el formato tú mismo con un nodo Condition después (regex/contains) o revisa el dato al atender al humano.
- Privacidad: el texto crudo del cliente **no se guarda en los eventos del run**, solo la clave capturada y la longitud; el valor completo sí queda en `flow_runs.vars`, visible en el visor de runs.

**7. Condition (bifurcación If/Else)** — `subject`:
- `var`: variable capturada (`subject_key` = nombre de la var),
- `tag`: etiqueta (UUID; consulta `contact_tags` en tiempo real),
- `contact_field`: `name | email | phone | company` del contacto.

  `operator`: `equals | contains | present | absent` (+ `value` para equals/contains). Dos salidas obligatorias: `true_next` / `false_next`. **Auto-avanza** sin llamar a Meta.

**8. Set tag (etiquetar contacto)** — `mode`: add/remove; `tag_id` (seleccionable desde las etiquetas de la cuenta). **Auto-avanza**. Al añadir, **dispara la automatización `tag_added`** correspondiente: es el puente hacia Automatizaciones. Un fallo al escribir la etiqueta no detiene el flujo (registra y continúa).

### Flow control

**9. Handoff (transferir a agente humano)** — `note` opcional (nota interna en el timeline del run) y `assign_to` opcional (user_id para asignar la conversación a un agente concreto). En el runtime: pone la conversación en estado `pending`, asigna si hay `assign_to`, y termina el run como `handed_off`.
- ⚠️ El formulario del builder **solo expone la nota**; `assign_to` existe en el motor pero no tiene campo de UI (se puede fijar vía `PUT /api/flows/[id]`).
- ⚠️ La nota **no interpola variables**: `{{vars.name}}` quedaría como texto literal aunque la plantilla *Lead capture* lo sugiera. Escribe notas genéricas.

**10. End (fin)** — Sin configuración. Termina el run como `completed`.

> **No existen** (reservados/mencionados pero no implementados): nodo de webhook/HTTP, nodo de espera/delay, nodo de deals/pipeline, nodo de IA. La "espera" en un flujo es simplemente que el run se queda activo hasta que el cliente responde o vence el timeout.

---

## 4. Variables: captura y reutilización

- Las respuestas de *Collect input* se guardan en `flow_runs.vars[var_key]` por run.
- Se interpolan con `{{vars.clave}}` en: texto de *Send message*, `prompt_text` de *Collect input* y `caption` de *Send media*. Variable inexistente → cadena vacía.
- También alimentan nodos *Condition* (subject `var`).
- Se ven en el visor de runs (pestaña **Runs**): estado, nodo actual, reintentos, vars capturadas y timeline de eventos (`started, node_entered, message_sent, reply_received, fallback_fired, handoff, timeout, error, completed`).

**Ejemplo:** capturar `nombre` → `Send message`: "Gracias {{vars.nombre}}, anotamos tu pedido." → `Condition` sobre `vars.zona` equals `Norte` → enviar dirección del almacén norte.

---

## 5. Fallback: respuestas inesperadas, reintentos y timeout

Cuando el cliente responde algo que el nodo actual no espera (texto libre sobre un menú de botones, un toque sobre un nodo de captura de texto, etc.), aplica la **política de fallback** del flujo:

| Parámetro | Valores (defecto) | Efecto |
|---|---|---|
| `on_unknown_reply` | `reprompt` (defecto) / `handoff` / `ignore` | `reprompt`: reenvía el mismo prompt; `handoff`: deriva a humano de inmediato; `ignore`: **no consume** el mensaje, lo deja pasar a automatizaciones/IA |
| `max_reprompts` | 2 | Cuántas veces se reenvía el prompt antes de darse por vencido |
| `on_exhaust` | `handoff` (defecto) / `end` | Qué pasa al agotar los reintentos: derivar a humano o cerrar el run |
| `on_timeout_hours` | 24 | Tiempo máximo sin avanzar; pasado ese, el cron marca el run `timed_out` y libera al contacto |

> ⚠️ **La política de fallback no tiene UI:** la interfaz siempre usa los defaults (reprompt ×2 → handoff, timeout 24 h). Para cambiarla usa `PUT /api/flows/[id]` con `fallback_policy` (requiere rol agente+). Casos donde suele interesar: `ignore` en flujos de FAQ para que la IA responda lo que el flujo no cubre; `on_exhaust: end` en flujos puramente informativos para no saturar de conversaciones `pending`.

**Timeout:** `GET /api/flows/cron` (header `x-cron-secret`) barre los runs activos cuyo `last_advanced_at` supere el timeout y los marca `timed_out`. Sin este cron, un cliente que abandona un flujo **bloquearía todos sus futuros triggers para siempre**.

---

## 6. Interacción con humanos

- **El humano manda:** cuando un agente responde desde el inbox, el run activo pasa a `paused_by_agent` (razón `agent_replied`). El flujo no retoma el control solo: el agente continúa la conversación manualmente.
- **Handoff explícito:** nodo *Handoff* (o fallback agotado) → conversación `pending`, opcionalmente asignada, con nota interna en el timeline.
- **Reapertura:** una conversación `closed` se reabre automáticamente si el cliente escribe de nuevo — considera cerrar solo cuando el proceso realmente terminó.

---

## 7. Plantillas incluidas

Desde la lista de Flujos puedes clonar 3 plantillas:

1. **Welcome menu** — trigger *First inbound message* → botones por tipo de cliente → ramas con mensajes → *Handoff* según el caso. Base típica para triaje inicial.
2. **FAQ bot** — *Keyword* → lista de preguntas frecuentes → respuestas → *Handoff* a humano. Base para autoservicio informativo.
3. **Lead capture** — *First inbound message* → captura nombre/email/empresa con interpolación → *Handoff* con nota. Base para cualificación de leads. (Recuerda la advertencia: la nota de handoff no interpola vars.)

---

## 8. Límites y advertencias (resumen)

- 10 nodos; sin espera/delay, sin webhook/HTTP, sin deals, sin nodos de IA.
- Sin validación de formato en capturas (email/teléfono/regex reservado, sin efecto ni UI).
- `assign_to` de *Handoff* y toda la `fallback_policy` sin UI (solo API).
- Trigger *Manual* sin mecanismo de lanzamiento.
- Máx. 10 filas de lista en total; 3 botones; longitudes de Meta (título botón ≤20, título fila ≤24, descripción ≤72, caption/cuerpo ≤1024).
- Un solo run activo por contacto; los ciclos se cortan a 64 iteraciones defensivas.
- Con proveedor Evolution, el flujo no suprime automatizaciones/IA (posibles respuestas duplicadas).
- Las plantillas de flujo **no pueden enviar plantillas de Meta aprobadas** (no hay nodo `send_template`): dentro de la ventana de 24 h usan mensajes de sesión; para reactivar contactos fuera de ventana usa una Automatización con `send_template`.
