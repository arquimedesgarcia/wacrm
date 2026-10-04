# Flujo de Ventas para Restaurante de Pizzas — waCRM

> **Sin modificaciones de código.** Todo utiliza el constructor visual de Flows + Automatizaciones ya implementado en waCRM (rama `custom`).

---

## Arquitectura del sistema

```
Cliente escribe → Flow "Menú de Pizzas" (navegación guiada)
  ↓ (botón "confirmar_pedido")
Automatización "Procesar Pedido" (trigger: interactive_reply)
  ↓
  → send_webhook → Sistema de POS / Delivery
  → add_tag "Pedido recibido"
  → assign_conversation → mesero
```

**¿Por qué Flow + Automatización y no solo Flow?**
- El Flow maneja la **interacción conversacional** (menú, selección, confirmación) — es lo que el cliente vive.
- La Automatización maneja la **integración operativa** (enviar al POS, etiquetar, asignar a mesero) — es lo que el negocio necesita para cumplir.
- El Flow no tiene `send_webhook` en v1.5, pero la Automatización sí. El patrón "botón del Flow dispara Automatización via interactive_reply" es el mecanismo diseñado para esto.

---

## Flow: "Menú de Pizzas"

### Trigger
- **Tipo:** `keyword`
- **Keywords:** `"pizza"`, `"menú"`, `"pedir"`, `"pedido"`, `"hola"`
- **Match type:** `contains` (insensible a mayúsculas)

### Nodos (canvas)

```
┌───────────┐
│   Start   │
└────┬──────┘
     ↓
┌─────────────────────────────────────────────────────────────┐
│ send_message                                                  │
│ "🍕 ¡Hola! Bienvenido a *Pizzería La Vecchia*.               │
│ ¿Qué te apetece hoy?                                    │
│ (Responde con un número o toca un botón)                  │
└─────────────────────────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────────────────────────┐
│ send_buttons                                                 │
│ text: "¿Qué quieres pedir?"                                │
│ ┌────────────────┬──────────────────┬────────────────────┐ │
│ │ btn_1 Ver menú │ btn_2 Hacer pedido│ btn_3 Preguntar    │ │
│ └────────────────┴──────────────────┴────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
     ↓          ↓                    ↓
 Ver menú   Hacer pedido      Preguntar
     │        │                  │
```

### Rama 1: "Ver menú" (btn_1_ver_menu → reply_id: `menu`)

```
→ send_list "Nuestro menú de hoy:"
  button_label: "Ver opciones"
  ┌────────────────────────────────┐
  │ Sección "Pizzas clásicas"       │
  │ • row_marg → "Margarita $12"   │ → send_media (foto pizza margarita) → send_message "Verdura: mozzarella, tomate, albahaca. ¿Quieres agregar?"
  │ • row_napo → "Napolitana $15"  │ → send_media (foto) → send_message "Tomate, mozzarella, jamón, rúcula..."
  │ • row_pesc → "Pescadora $18"   │ → send_media (foto) → send_message "Salsa de ajo, queso, atún, aceitunas..."
  │ Sección "Especiales"           │
  │ • row_especial → "La Vecchia $20"│ → send_media (foto) │
  └────────────────────────────────┘
     ↓ (después de ver menú)
  send_buttons
  "¿Listo para pedir?"
  [ btn_hacer_pedido → "Sí, pedir" ]
  [ btn_volver_menu → "Volver al menú" ]
```

### Rama 2: "Hacer pedido" (btn_2_hacer_pedido → reply_id: `pedir`)

```
→ collect_input "¿Qué pizza te gustaría? Escribe el nombre o número:" (var=pizza)
→ collect_input "¿Tamaño? (Pequeña /$8, Mediana /$12, Grande /$16)" (var=tamano)
→ collect_input "¿Dirección para delivery?" (var=direccion)
→ collect_input "¿Teléfono de contacto?" (var=telefono)
→ send_buttons
  text: "Confirmas tu pedido: {{vars.pizza}} ({{vars.tamano}}) a {{vars.direccion}}?"
  [ btn_confirmar → "✅ Confirmar" ] (reply_id: `confirmar_pedido`)
  [ btn_modificar → "✏️ Modificar" ] (reply_id: `modificar_pedido`)
  [ btn_cancelar → "❌ Cancelar" ] (reply_id: `cancelar_pedido`)
```

### Rama 3: "Preguntar" (btn_3_preguntar → reply_id: `preguntar`)

```
→ send_message "Puedes preguntarme de todo: ingredientes, tiempos de preparación, opciones vegetarianas, sin gluten, etc."
→ collect_input "¿En qué te ayudo?" (var=pregunta)
→ send_message "Voy a buscar esa información... un momento."
→ handoff (nota: "Cliente {{vars.nombre}} pregunta: {{vars.pregunta}}")
```

### Nodo terminal

```
→ end (para todas las ramas excepto handoff)
```

---

## Automatización: "Confirmar Pedido"

### Trigger
- **Tipo:** `interactive_reply`
- **reply_ids:** `["confirmar_pedido"]`

### Pasos (lineales)

```
1. send_template (template_name: "pedido_confirmado")
   variables: { 1: "{{vars.pizza}}", 2: "{{vars.tamano}}", 3: "{{vars.direccion}}" }
   → "¡Pedido confirmado! Tu {{vars.pizza}} {{vars.tamano}} va por buen camino 🚚"

2. send_webhook
   url: "https://tu-pos.com/api/v1/orders"
   headers: { "Authorization": "Bearer <TOKEN>", "Content-Type": "application/json" }
   body_template: '{
     "pizza": "{{vars.pizza}}",
     "size": "{{vars.tamano}}",
     "address": "{{vars.direccion}}",
     "phone": "{{vars.telefono}}",
     "whatsapp_id": "{{message.text}}"
   }'

3. add_tag → "Pedido confirmado"

4. assign_conversation → mode: round_robin (reparto entre meseros)

5. close_conversation → (cierra después de 1 minuto, para mantener inbox limpio)
   → wait 1 minute → close_conversation
```

> ⚠️ **Nota sobre variables:** Las variables `{{vars.*}}` se capturan en el Flow via `collect_input` y se almacenan en `flow_runs.vars`. La Automatización `interactive_reply` **no tiene acceso directo** a esas variables porque se dispara desde el webhook, no desde el Flow runner. Para resolver esto, usa un **Flow con `send_webhook` integrado** (si está disponible en tu versión) o captura los datos también vía Automatizaciones usando `collect_input` alternativo. La solución más robusta es: usar `send_message` con los datos interpolados directamente desde el Flow antes del botón confirmar.

### Alternativa: Captura vía Automatización (sin Flow)

Si prefieres no depender de variables del Flow, puedes hacerlo **100% con Automatizaciones**:

**Automatización 1: "Iniciar pedido"** (trigger: `keyword_match` "pedir")
```
send_list "Menú de pizzas:"
  sección "Clásicas" → row_marg "Margarita $12" / row_napo "Napolitana $15" / row_pesc "Pescadora $18"
  → send_message "Escribe: pizza, tamaño, dirección"
```

**Automatización 2: "Recibir datos"** (trigger: `new_message_received`)
```
Condition: message_content "margarita" o "napolitana" o "pescadora"
  yes → add_tag "Pizza solicitada"
  → send_message "¿Tamaño? (Pequeña/Mediana/Grande)"
```

**Automatización 3: "Confirmar y enviar"** (trigger: `keyword_match` "mediana" / "pequeña" / "grande")
```
send_webhook (POS) → add_tag "En preparación" → send_template "preparando_pedido"
```

---

## Automatización: "Sin respuesta / Follow-up"

### Trigger
- **Tipo:** `time_based`
- **Schedule:** `cron 0 20 * * *` (8 PM diario)

### Pasos

```
Condition: tag_presence "Pedido confirmado" pero NO "Pedido entregado"
  yes → send_message "¿Todo bien con tu pedido? ¡Cuéntanos! 🍕"
  → wait 2 hours

Condition: tag_presence "Pedido entregado" (no)
  yes → send_template "feedback_pizza" {1: nombre}
  → add_tag "Feedback solicitado"
```

---

## Automatización: "Pedido repetido (frecuencia)"

### Trigger
- **Tipo:** `tag_added`
- **tag_id:** (el de "Pedido confirmado")

### Pasos

```
Condition: contact_field "custom:pedidos_totales" > 3 (contador de pedidos)
  yes → send_message "¡Eres un cliente frecuente! 🎉 Lleva tu tarjeta de fidelidad."
  → add_tag "Cliente premium"
  → send_template "fidelidad_bienvenida" {1: nombre}
  
no → (no hace nada, el flujo normal continúa)
```

> ⚠️ **Nota:** La automatización `tag_added` dispara cuando se añade el tag, pero el contacto debe tener el contador de pedidos como **custom field**. Esto requiere que otra Automatización incremente el contador. Ejemplo:

**Automatización: "Incrementar contador"** (trigger: `tag_added`, tag_id: "Pedido confirmado")
```
Condition: contact_field "custom:pedidos_totales" equals "" (no tiene valor)
  yes → update_contact_field "custom:pedidos_totales" = "1"
no → Condition: contact_field "custom:pedidos_totales" exists
  yes → update_contact_field "custom:pedidos_totales" = "{{vars.pedidos_totales}}" + 1
```

> ⚠️ **Limitación:** La interpolación `{{vars.*}}` en Automatizaciones solo funciona con variables del `context` (capturadas en el Flow), no con valores existentes de custom fields. Para incrementar un contador, necesitarías una migración SQL con una función o usar `send_webhook` a un endpoint que haga el incremento.

---

## Configuración previa necesaria

### 1. Tags a crear
- "Nuevo lead"
- "Pedido confirmado"
- "Pedido en preparación"
- "Pedido entregado"
- "Cliente premium"
- "Personal" (para excluír de IA si aplicable — ver estudio anterior)

### 2. Fields personalizados
- `pedidos_totales` (número) — contador de pedidos
- `ultima_pedido` (fecha) — fecha del último pedido
- `preferencias` (texto) — notas sobre preferencias (sin gluten, sin queso, etc.)

### 3. Templates de Meta (deben estar aprobadas)
- `pedido_confirmado` — "¡Pedido confirmado! Tu {{1}} {{2}} va por buen camino 🚚"
- `preparando_pedido` — "Estamos preparando tu {{1}} {{2}}. ¡Listo en 15-20 minutos! ⏰"
- `feedback_pizza` — "¿Cómo estuvo tu {{1}}? ¡Califica con 1-5 estrellas! ✨"
- `fidelidad_bienvenida` — "¡Gracias por tu preferencia! Lleva tu tarjeta de fidelidad: {{1}} puntos acumulados."
- `reactivacion` — "¡Tanto tiempo! Ven a try nuestra nueva pizza de la semana. Te esperamos 🙌"

### 4. Configurar webhook del POS
- URL del endpoint: `https://tu-pos.com/api/v1/orders`
- Método: POST
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
- El POS debe responder `200 OK` con `{ "order_id": "12345" }` para que el paso `send_webhook` no falle.

### 5. Configurar cron (si usas `wait`)
- **Automatizaciones con `wait`:** Configura un ping externo a `/api/automations/cron` cada 5-15 minutos.
- **Flujos con timeout:** Configura un ping a `/api/flows/cron` cada hora.

---

## Cronología de una orden completa

```
00:00  Cliente escribe "hola"
00:01  → Flow "Menú de Pizzas" dispara (keyword match)
00:02  → Bot envía menú interactivo
00:15  → Cliente toca "Hacer pedido"
00:16  → Bot pide: pizza, tamaño, dirección, teléfono
00:30  → Cliente confirma con botón "Confirmar pedido"
00:31  → Automatización "Confirmar Pedido" dispara (interactive_reply)
       → send_template pedido_confirmado
       → send_webhook → POS crea orden #12345
       → add_tag "Pedido confirmado"
       → assign_conversation → mesero Juan
00:32  → POS envía notificación al cocinero
00:45  → Pizza lista → mesero envía "Pedidos entregados" desde inbox
       → add_tag "Pedido entregado"
00:46  → Automatización "Sin respuesta" check en 8 PM (no aplica hoy)
05:00  → Automatización "Sin respuesta" revisa → tag "Pedido entregado" existe → nada
```

---

## Dashboard de monitoreo

### Desde el inbox
- Los tags aparecen como badges en cada conversación: "Pedido confirmado", "Pedido en preparación", "Pedido entregado", "Cliente premium".
- El banner de IA muestra "AI is replying automatically" solo si el contacto **no** tiene tag "Personal".

### Desde Automatizaciones → Logs
- Cada disparo deja un registro en `automation_logs` con `steps_executed`, `status` (success/partial/failed), y timestamps.
- Puedes ver cuántas veces se disparó cada automatización y si hubo errores.

### Métricas disponibles
- **Pedidos confirmados hoy:** contacts con tag "Pedido confirmado" creados hoy.
- **Tasa de conversión:** contacts que llegaron a "confirmar_pedido" / contacts que escribieron "hola".
- **Clientes premium:** contacts con tag "Cliente premium".
- **Tiempo promedio pedido→entrega:** medida entre los logs de tag_added "Pedido confirmado" → "Pedido entregado".

---

## Próximos pasos después del MVP

Una vez que el flujo básico funcione (menú → captura → confirmación → POS), puedes añadir:

1. **Integración de pagos:** Botón "Pagar con MP" que abre un link de pago (usando `send_buttons` con URL button type).
2. **Seguimiento en tiempo real:** POS envía webhook a waCRM cuando el pedido está en camino → Automatización `send_webhook` inverso actualiza el tag a "En camino".
3. **Catálogo dinámico:** En lugar de menú estático, el Flow llama a un webhook que devuelve las pizzas del día.
4. **Programación de pedidos:** Flow con `collect_input` para fecha/hora de recogida, y `schedule` en la automatización para recordar.
