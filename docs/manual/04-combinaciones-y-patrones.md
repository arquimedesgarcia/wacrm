# 04 — Combinaciones y patrones: Flujos + Automatizaciones + IA + humanos

> Este capítulo es el corazón práctico del manual: cómo encadenar las piezas de waCRM para construir procesos completos de atención y venta por WhatsApp, y qué objetivos de negocio puedes lograr con cada combinación.

---

## 1. El "pegamento" entre módulos

Tres mecanismos conectan Flujos, Automatizaciones, IA y humanos:

1. **Consumo de mensajes:** si un Flujo consume el mensaje, las automatizaciones de contenido y la IA se callan. Si el flujo usa fallback `ignore`, el mensaje queda libre.
2. **Etiquetas:** el nodo *Set tag* de un Flujo (y el paso *Add tag* de una Automatización) dispara automatizaciones con trigger *Tag added*. Es el puente principal **Flujo → Automatización**.
3. **reply_ids:** los botones/listas enviados por una Automatización devuelven un `reply_id` al ser tocados; el trigger *Interactive reply* lo captura para encadenar otra automatización, y un Flujo con keyword puede arrancar si el id/título coincide.

---

## 2. Patrones documentados

### Patrón A — Menú en Flujo + seguimiento por etiqueta (el patrón base)

**Objetivo:** atender el primer contacto con un menú guiado y luego ejecutar seguimientos automáticos según lo que eligió el cliente.

```
Flujo "Menú principal" (trigger: First inbound message)
  Send buttons: "¿Qué necesitas?" [Pedir] [Reservar] [Info]
    ├─ Pedir   → Send list (catálogo) → Collect input (dirección, var=direccion)
    │            → Set tag "Pedido_en_curso" → End
    ├─ Reservar → Collect input (fecha/hora, var=fecha) → Handoff (nota: "Reserva solicitada")
    └─ Info    → Send message + Set tag "Interesado_info" → End

Automatización "Seguimiento de pedidos" (trigger: Tag added = Pedido_en_curso)
  Wait 30 minutes
  Send message: "¿Confirmamos tu pedido? Responde aquí mismo."
  (opcional) Condition time_of_day → si fuera de horario, Close conversation

Automatización "Nutrición de interesados" (trigger: Tag added = Interesado_info)
  Wait 1 day
  Send buttons: [Quiero una demo] [Solo información]
```

**Alcance:** captura de demanda 24/7, segmentación automática por intención, seguimiento sin trabajo humano. La venta en sí la cierra el humano (handoff) o una segunda interacción.
**Trampas:** recuerda que el `wait` necesita cron; la cadena de etiquetas se corta a 3 niveles (no encadenes tag→auto→tag→auto→tag→auto en el mismo contacto).

---

### Patrón B — Flujo como cualificador, IA como conversador libre

**Objetivo:** que la IA responda de forma natural todo lo que el bot no cubre, sin duplicar respuestas.

```
Flujo "Triaje" (trigger: Keyword "hola", "menu", "info")
  Send buttons: "¿Prefieres hablar con una persona o con nuestro asistente?"
    ├─ [Asistente] → End  (y fallback_policy del flujo: on_unknown_reply = IGNORE)
    └─ [Persona]  → Handoff

Automatización de contenido: NINGUNA con new_message_received / keyword_match amplio
IA auto-reply: activada, con knowledge base de tu catálogo
```

Con fallback `ignore`, todo mensaje que el flujo no consuma pasa a la IA. Clave: **no uses** automatizaciones de contenido amplias (responden antes que la IA y la silencian).

**Alcance:** experiencia híbrida "bot estructurado + IA libre", escalable a miles de conversaciones con knowledge base.
**Requisito:** `fallback_policy` solo vía API (`PUT /api/flows/[id]`).

---

### Patrón C — Botones de automatización que arrancan Flujos

**Objetivo:** reactivar contactos fuera de la ventana de 24 h con una plantilla aprobada y, al responder, meterlos en un flujo.

```
Automatización "Reactivación" (trigger: Tag added = Campana_mayo, o vía API externa)
  Send template: "Hola {{1}}, tenemos novedades. ¿Quieres verlas?"  (plantilla aprobada con botón)
  Send buttons: [Ver novedades] [No gracias]     ← dentro de la ventana tras su respuesta
    reply_ids: ver_novedades / no_gracias

Flujo "Novedades" (trigger: Keyword "ver_novedades" — coincide con el reply_id/título del botón)
  Send list (novedades por categoría) → …
```

También funciona con *Interactive reply*: una segunda automatización con trigger `reply_ids: ver_novedades`. Usa el Flujo cuando el camino sea largo (varias preguntas), la automatización cuando sea un solo envío.

**Alcance:** campañas de reactivación con recorrido guiado posterior. Sin límite de filas de lista en el mensaje inicial… pero sí 10 filas por nodo de lista del flujo.

---

### Patrón D — Seguimiento programado tras abandono

**Objetivo:** recuperar clientes que se quedaron a mitad de camino.

```
Flujo "Cotización" → cliente deja de responder en el nodo de captura de presupuesto
  (run sigue activo hasta el timeout de 24 h)

Automatización "Recuperación" (trigger: New message received)
  Condition: message_content contains "precio" o "cotizar"   ← solo se dispara si el flujo NO consumió
  Wait 1 day
  Send message: "¿Seguimos con tu cotización? Te ayudo en lo que falte."

Flujo cron (timeout 24 h): cierra el run abandonado y libera al contacto
```

**Alcance:** recuperación de carritos/procesos abandonados. Ojo al doble disparo: mientras el run esté activo, el flujo consume y la automatización no corre; cuando el timeout cierre el run, los siguientes mensajes quedan libres.

---

### Patrón E — Horarios de atención (restaurantes, oficinas)

**Objetivo:** atender de forma automática fuera de horario y derivar en horario.

```
Automatización "Fuera de horario" (trigger: New message received)
  Condition time_of_day: 09:00-22:00
    ├─ Yes → (nada: deja que la IA o el equipo respondan)
    └─ No  → Condition tag_presence = "Avisado_fuera_horario"
                 ├─ No → Add tag "Avisado_fuera_horario" + Send message horario
                 └─ Yes → (silencio: ya avisamos; evita spam nocturno)
```

Ojo: esta automatización silencia a la IA de noche siempre que coincida (bloquea auto-reply). Si quieres que la IA sí responda de noche, invertir la lógica: deja la IA como primera línea y usa un Flujo con fallback `ignore` para los horarios, o acepta que de noche solo suena el mensaje programado.

---

### Patrón F — Webhooks hacia sistemas externos

**Objetivo:** conectar waCRM con tu POS, CRM inmobiliario, ERP de boletos o aseguradora.

```
Flujo "Pedido" → Collect input dirección → Set tag "Pedido_listo"
Automatización (trigger: Tag added = Pedido_listo)
  Send webhook → https://api.tu-pos.com/orders
    body: { cliente: …, direccion: … }   ← o body vacío: waCRM envía el contexto del evento
```

Límites: URL pública (anti-SSRF), timeout 10 s, sin redirects, debe devolver 2xx o el paso falla y **detiene la automatización** (sin reintentos). Si tu sistema externo es lento o inestable, encola en tu lado y responde 2xx rápido.

Además, los **webhooks salientes de cuenta** (`message.received`, `message.status_updated`, `conversation.created`) notifican a endpoints suscritos de forma firmada (HMAC), con auto-desactivación tras 15 fallos.

---

### Patrón G — Handoff en cadena: IA → humano → post-venta

**Objetivo:** la IA atiende hasta que detecta intención de compra o frustración; el humano cierra; la automatización hace el post-venta.

```
IA auto-reply (Ajustes → IA): activada, handoff_agent_id = tu vendedor estrella
  · Cliente muestra intención de compra / frustración → IA emite [[HANDOFF]]
    → conversación pending + asignada + nota interna ai_handoff_summary
    → auto-reply desactivado (sticky) hasta que el humano lo reactive

Humano cierra la venta → añade etiqueta "Cliente" desde la ficha de contacto

Automatización "Bienvenida cliente" (trigger: Tag added = Cliente)
  Wait 1 hour
  Send message de agradecimiento / Send template si ya pasó la ventana de 24 h
```

**Alcance:** el humano solo toca las conversaciones con valor real; el 80% inicial lo cubre la IA con knowledge base. El banner de IA en el inbox permite "Take over from AI" / "Let AI reply again".

---

### Patrón H — Crear el deal en el pipeline (ventas)

```
Flujo "Cualificación inmobiliaria" → captura zona/presupuesto (vars)
  → Set tag "Lead_calificado"

Automatización (trigger: Tag added = Lead_calificado)
  Condition tag_presence = Lead_calificado
    ├─ Yes → Create deal (pipeline Ventas, etapa Nuevo) + Assign conversation (specific: agente)
    └─ No  → (imposible aquí; ilustra que la condición no corta el flujo)
```

Luego el agente humano mueve el deal por el Kanban manualmente (las automatizaciones solo **crean** deals, no los mueven).

---

## 3. Anti-patrones y trampas frecuentes

| Trampa | Por qué pasa | Solución |
|---|---|---|
| Doble respuesta (flujo + IA) | El flujo consumió pero Evolution no suprime; o hay automatización `new_message_received` + IA activada | Con Meta no debería pasar; con Evolution, desactiva IA en esas conversaciones o evita automatizaciones amplias |
| El cliente "atascado" en un flujo | Run activo que nunca termina (timeout sin cron) | Configura `/api/flows/cron`; revisa Runs regularmente |
| Las esperas nunca reanudan | Sin `AUTOMATION_CRON_SECRET` o sin pinger | Configura el cron + secret; verifica logs `partial` |
| Spam de "fuera de horario" | `new_message_received` + out-of-office responde a cada mensaje | Añade etiqueta de "ya avisado" como en el Patrón E |
| Cadena de etiquetas cortada | Límite de profundidad 3 | Diseña máximo: flujo → tag → auto → tag → auto |
| `round_robin` siempre asigna al mismo | No reparte hoy | Asigna por pasos *specific* a agentes distintos o manualmente |
| Personalización rota | No existen `{{contact.name}}`; vars desconocidas → vacío | Captura datos con Flujo → `update_contact_field`; usa `{{ message.text }}` y `{{vars.*}}` |
| Plantilla con variables no envía bien | UI no edita `variables` de `send_template` | Prueba el envío; si necesitas variables, envía vía API pública o ajusta la plantilla en Meta |
| Trigger que "nunca funciona" | *Time based* y *Conversation assigned* no tienen despachador | Usa `time_of_day` dentro de otras automatizaciones; la asignación hazla con el paso *Assign conversation* |
| Conversación cerrada que "resucita" | Un mensaje nuevo del cliente reabre `closed` | Cierra solo procesos terminados; no uses `close_conversation` como pausa |

---

## 4. Matriz rápida: qué combinación usar según el objetivo

| Objetivo de negocio | Combinación recomendada |
|---|---|
| Responder el primer contacto con menú y segmentar | Flujo (first_inbound) + Set tag + Automatización tag_added |
| Catálogo navegable con elección de producto | Flujo Send list + Condition + Collect input |
| Reactivar contactos dormidos | Automatización send_template + botones + Flujo por keyword/reply_id |
| Seguimiento de cotizaciones abandonadas | Automatización keyword + Wait + mensaje |
| Atención libre con conocimiento del negocio | IA auto-reply + knowledge base + flujo con fallback `ignore` |
| Cierre de venta con humano | Handoff (nodo flujo / [[HANDOFF]] IA) + Assign + Create deal + post-venta tag_added |
| Integración con sistemas externos | Send webhook por tag + webhooks salientes de cuenta |
| Fuera de horario | Automatización new_message + Condition time_of_day + etiqueta antispam |
