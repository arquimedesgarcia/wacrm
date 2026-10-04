# 02 — Automatizaciones: guía completa

> Una automatización = **un disparador + una secuencia de pasos** que se ejecutan en orden. Reactúa a eventos (mensajes, palabras clave, etiquetas, toques de botón) y puede enviar mensajes, etiquetar, asignar, crear deals, esperar y llamar webhooks.

---

## 1. El editor paso a paso

1. Ve a **Automatizations** en el menú lateral y pulsa **New automation** (o elige una de las plantillas sugeridas).
2. Escribe el **nombre** (obligatorio) en la barra superior.
3. Configura la **tarjeta azul del trigger**: elige el tipo de evento y completa su configuración.
4. Pulsa **+** entre los pasos para añadir acciones, condiciones o esperas. Cada tarjeta se expande para configurarse y puede reordenarse (flechas) o eliminarse.
5. Las **condiciones** dibujan dos columnas **Yes** (verde) / **No** (rosa): arrastra pasos a cada rama. Se pueden anidar condiciones dentro de ramas.
6. Activa el switch **Active** y pulsa **Save**. Al activar, el sistema valida que el trigger y los pasos estén bien configurados; los errores se muestran en un toast indicando el campo.
7. Puedes **pausar** el switch en cualquier momento (los cambios se guardan con rollback optimista), **duplicar**, **ver logs** o **eliminar** desde el menú de cada tarjeta en la lista.

**Buenas prácticas de diseño**

- Empieza siempre con el **borrador inactivo**, prueba (puedes disparar manualmente el endpoint `POST /api/automations/engine` si tienes rol agente+) y activa al final.
- Nombra las automatizaciones por su *intención de negocio* ("Seguimiento pedidos no confirmados") y no por su mecánica ("Auto 3").
- Usa la descripción para anotar supuestos (horario, quién responde, qué pasa si falla).

---

## 2. Catálogo de triggers (disparadores)

Solo se ejecutan las automatizaciones **activas** de la misma cuenta que el contacto.

| Trigger | Configuración | Cuándo se dispara | Proveedor |
|---|---|---|---|
| **New message received** | — | Con **cada** mensaje entrante del cliente. Ojo: silencia a la IA de auto-respuesta para ese mensaje. | Meta + Evolution |
| **First inbound message** | — | En el **primer mensaje** que escribe un contacto (incluidos contactos importados que nunca escribieron). Los Flujos con el mismo trigger siguen disparando en paralelo. | Meta + Evolution |
| **New contact created** | — | Cuando el webhook crea el contacto automáticamente al recibir su primer mensaje (no en importaciones manuales/CSV). | Meta + Evolution |
| **Keyword match** | `keywords` (lista separada por comas), `match_type`: *contains* (defecto) / *exact* / *word*; opcionalmente `case_sensitive` | Cuando el texto del mensaje coincide. `contains` = la palabra aparece en cualquier parte; `exact` = el mensaje entero es igual; `word` = palabra completa (límites Unicode). | Meta + Evolution |
| **Interactive reply** | `reply_ids` (ids en texto, uno por línea) | Cuando el cliente toca un botón o fila cuyo **reply_id** coincide exactamente. Permite encadenar menús entre automatizaciones (o arrancar Flujos si el id/título coincide con su keyword). **Solo Meta.** | Meta |
| **Tag added** | selector de etiqueta | Cuando se añade esa etiqueta al contacto: desde un paso `add_tag`, desde la ficha de contacto o desde la API pública. Es el puente principal Flujos → Automatizaciones. | Meta + Evolution |
| ~~Conversation assigned~~ | — | ⚠️ **Existe en la interfaz pero no tiene despachador implementado: nunca se dispara.** No construyas procesos sobre él. | — |
| ~~Time based~~ | `schedule` (cron o HH:mm), `timezone` | ⚠️ **Igual: seleccionable pero sin despachador. No se ejecuta por sí solo.** Para horarios usa la condición `time_of_day` dentro de otros triggers. | — |

> **Anti-bucles:** el paso *Add tag* puede redisparar otra automatización `tag_added`, y así sucesivamente, pero el sistema corta la cadena a profundidad **3** (se añade la etiqueta pero ya no se disparan más triggers).

---

## 3. Condiciones (paso `Condition`)

Cada condición evalúa **un solo test** (no hay AND/OR) y bifurca en dos ramas anidadas **Yes / No**. Al terminar una rama, la ejecución continúa con el siguiente paso del nivel padre: una condición *no corta* el flujo, funciona como un if/else que devuelve el control.

| Sujeto | Operand | Value | Qué evalúa |
|---|---|---|---|
| **Tag presence** | etiqueta (selector) | — | ¿El contacto tiene esa etiqueta? |
| **Contact field** | columna del contacto (`name`, `email`, `phone`, `company` o un campo personalizado) | texto | Igualdad exacta de texto (`String === String`), sensible al formato. "Ciudad" ≠ "ciudad". |
| **Message content** | — | subcadena | ¿El texto del mensaje entrante contiene…? (siempre *contains*, en minúsculas) |
| **Time of day** | ventana `"HH:mm-HH:mm"` | — | ¿La hora actual está dentro de la ventana? Soporta rangos que cruzan medianoche (`18:00-09:00` = fuera de horario laboral). |

**Ejemplos:**

- *Fuera de horario*: `time_of_day` = `09:00-18:00` → rama **No**: enviar mensaje "Ahora estamos cerrados, te atendemos a las 9:00".
- *Solo leads nuevos*: `tag_presence` = "Cliente" → rama **No**: aplicar secuencia de bienvenida.
- *Zona de reparto*: `contact_field` = `custom:zona` value `Norte` → rama Yes: enviar catálogo del almacén norte.

---

## 4. Catálogo de acciones (13 pasos)

### Mensajería

| Acción | Parámetros | Notas y límites de Meta |
|---|---|---|
| **Send message** | `text` | Texto plano con interpolación. Falla si queda vacío tras interpolar. |
| **Send buttons** | `body` (≤1024), `header`/`footer` (≤60), 1–3 botones con `id` + `title` (≤20) | Botones de respuesta rápida. El `id` es el **reply_id**: úsalo para encadenar con el trigger *Interactive reply*. |
| **Send list** | `body`, `header`, `footer`, `button_label` (≤20), secciones con filas (`id`, `title` ≤24, `description` ≤72) | Máx. **10 filas en total** entre todas las secciones, ids únicos. Ideal para catálogos y menús. |
| **Send template** | `template_name`, `language`, `variables` (opcional) | Plantilla **APROVED** de Meta; el editor solo lista las aprobadas. Sirve para escribir fuera de la ventana de 24 h. Las variables son posicionales `{{1}}, {{2}}`… ⚠️ El editor no expone el campo *variables* (se puede usar vía API); si la plantilla tiene variables, verifica el envío antes de producción. |

### Datos del contacto

| Acción | Parámetros | Notas |
|---|---|---|
| **Add tag** | etiqueta | La añade si no estaba y **dispara automatizaciones `tag_added`** (con límite de cadena ×3). |
| **Remove tag** | etiqueta | La quita del contacto. |
| **Update contact field** | `field` (`name`, `email`, `company` o `custom:<id>`), `value` | Escribe el campo del contacto (upsert en campos personalizados). El valor admite interpolación. Útil para guardar lo que el cliente dijo. |

### Equipo y pipeline

| Acción | Parámetros | Notas |
|---|---|---|
| **Assign conversation** | `mode`: *specific* (eliges agente) / *round_robin* | Asigna la conversación del contacto a un agente. ⚠️ *round_robin* **no reparte hoy**: asigna siempre al primer miembro que devuelva la consulta. Si necesitas reparto real, asíigna por pasos separados o manualmente. |
| **Create deal** | `pipeline`, `stage`, `title` (interpolable), `value` (opcional) | Crea un trato abierto en el pipeline/etapa elegidos, con la moneda por defecto de la cuenta. **Solo crea**; no mueve deals existentes. |
| **Close conversation** | — | Marca la/s conversación/es del contacto como `closed`. Un mensaje nuevo del cliente la reabre automáticamente. |

### Tiempo y sistema

| Acción | Parámetros | Notas |
|---|---|---|
| **Wait** | `amount` (≥1), `unit`: minutes / hours / days | **Suspende la ejecución** hasta dentro de `amount` y reanuda el siguiente paso. Requiere el cron externo (`/api/automations/cron` + `AUTOMATION_CRON_SECRET`); sin cron, la espera nunca termina. El cron drena hasta 50 esperas por llamada — programa el ping con la frecuencia adecuada a tu volumen. Mínimo efectivo ~1 segundo. |
| **Send webhook** | `url`, `headers` (opcional), `body_template` (opcional) | POST JSON a una URL pública. Si no defines `body_template`, envía el contexto del evento. Guard anti-SSRF (rechaza IPs privadas), sin redirects, timeout 10 s, debe responder 2xx o el paso falla. |
| **Condition** | (ver sección 3) | Bifurcación Yes/No. |

---

## 5. Variables de interpolación

Dentro de textos y valores se pueden insertar placeholders `{{ … }}`:

| Placeholder | Disponibilidad |
|---|---|
| `{{ message.text }}` | Texto completo del mensaje que disparó la automatización. Usable en *Send message* y *Update contact field*. |
| `{{ vars.<nombre> }}` | Variables de contexto. **Solo se rellenan si disparas la automatización vía `POST /api/automations/engine`** pasando `context.vars` (integraciones externas). No hay UI para definirlas. Existe además la interna `{{ vars._tag_chain_depth }}`. |

> ⚠️ **No existen** placeholders de contacto como `{{ contact.name }}`, `{{ contact.phone }}` o `{{ contact.company }}`. Cualquier clave desconocida se reemplaza por cadena vacía. Si necesitas personalizar con nombre, captura el dato previamente con un Flujo y guárdalo en un campo personalizado, o pásalo por API.

---

## 6. Comportamiento en runtime

- **Ejecución secuencial:** los pasos corren en orden de posición; al llegar a una condición se recursa en la rama elegida y luego se continúa con el siguiente paso del nivel padre.
- **Fallo de un paso:** el paso se marca `failed`, el log pasa a `failed` y **la ejecución se detiene**. No hay reintentos ni "continuar con error": diseña pasos robustos (p. ej. no depender de webhooks lentos en pasos críticos).
- **Estados del log:** `success` (todo OK), `partial` (terminó en una espera `wait`; quedan pasos pendientes), `failed`.
- **Envío real:** los mensajes salen con la identidad WhatsApp de la cuenta, se guardan en el inbox como `sender_type='bot'` y actualizan la conversación. Para enviar hace falta una conversación existente del contacto: una automatización `tag_added` sobre un contacto sin conversación **no puede enviar mensajes**.
- **Idempotencia:** los mensajes entrantes se deduplican por `message_id`; los reintentos de Meta no ejecutan la regla dos veces.
- **Trazabilidad:** la pestaña **Logs** muestra las últimas 100 ejecuciones, con estado, contacto, evento y el detalle paso a paso (✓/✗). Revisa los logs después de activar una automatización nueva.

---

## 7. Plantillas incluidas

Al crear una automatización puedes partir de 4 plantillas:

1. **Welcome Message** — trigger *First inbound message*: envía saludo y añade una etiqueta (elígela tú). Punto de entrada típico.
2. **Out of Office** — trigger *New message received* + condición `time_of_day 18:00-09:00` → mensaje de fuera de horario. ⚠️ Responde **a cada mensaje** recibido de noche; valora combinarla con una etiqueta "fuera_de_horario_atendido" para no repetir el aviso.
3. **Lead Qualifier** — *Keyword match* (pricing, quote, buy) → pregunta de cualificación → *wait* 10 min → asignación a agente.
4. **Follow-up Reminder** — *New message received* → *wait* 1 día → mensaje de seguimiento. ⚠️ Dispara aunque el cliente haya vuelto a escribir entre medias (no hay condición de "sin respuesta"). Para seguimiento fino, dispara por etiqueta o desde un Flujo.

---

## 8. Límites y advertencias (resumen)

- Sin bucles/iteraciones, sin condiciones AND/OR, sin "esperar hasta que responda" (el `wait` es de tiempo fijo).
- Cadena de etiquetas limitada a profundidad 3 (anti-bucles).
- Cron: 50 esperas por llamada; requiere `AUTOMATION_CRON_SECRET` y un programador externo.
- Webhooks de pasos: timeout 10 s, solo destinos públicos, sin redirects, debe devolver 2xx, sin reintentos.
- Interactivos: límites estrictos de Meta (3 botones, 10 filas de lista, longitudes de texto indicadas en la tabla de acciones).
- `round_robin` no reparte: asigna siempre al mismo miembro.
- `send_template`: sin edición de variables desde la UI.
- Los triggers *Conversation assigned* y *Time based* **no funcionan** (sin despachador).
- Interpolación limitada a `{{ message.text }}` y `{{ vars.* }}` (vía API).
- Logs visibles: 100 más recientes.
- Proveedor Evolution: el envío y los triggers básicos funcionan, pero *Interactive reply* no se dispara vía Evolution (solo Meta).
