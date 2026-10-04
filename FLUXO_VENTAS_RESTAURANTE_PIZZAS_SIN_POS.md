# Flujo de Ventas para Restaurante de Pizzas (Sin POS Externo)

> **Sin modificaciones de código ni integraciones externas.** Todo con Flows y Automatizaciones ya implementados en waCRM. El flujo termina cuando el cliente confirma pago y envía comprobante.

---

## Arquitectura del sistema

```
Cliente escribe → Flow "Pedidos de Pizzas" (navegación + captura)
  ↓ (botón "Confirmar pedido")
Automatización "Confirmar Pedido" (trigger: interactive_reply)
  → Envía template de confirmación
  → Etiqueta: "Pedido confirmado"
  → Pregunta: "¿Ya pagaste? Envía el comprobante de pago."
  ↓
Cliente envía foto del comprobante
  ↓
Automatización "Ver comprobante" (trigger: new_message_received)
  → Si el contacto tiene tag "Pedido confirmado"
  → Etiqueta: "Pago recibido"
  → Asigna a mesero
  → Mensaje al mesero: "Nuevo pedido de {{contact.name}} — {{contact.phone}}"
```

---

## Flow: "Pedidos de Pizzas"

### Trigger
- **Tipo:** `keyword`
- **Keywords:** `"pizza"`, `"menú"`, `"pedir"`, `"pedido"`, `"hola"`, `"buenas"`, `"orden"`
- **Match type:** `contains` (insensible a mayúsculas)

### Canvas completo

```
┌───────────┐
│   Start   │
└────┬──────┘
     ↓
┌─────────────────────────────────────────────────────┐
│ send_message                                         │
│ "🍕 ¡Hola! Bienvenido a *Pizzería La Vecchia*.       │
│ Hacemos delivery y recogida. ¿Qué te apetece hoy?"   │
└─────────────────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────────────────┐
│ send_buttons                                         │
│ text: "¿Qué quieres hacer?"                          │
│ ┌────────────────┬──────────────────┬─────────────┐ │
│ │ btn_menu       │ btn_pedir          │ btn_preg    │ │
│ │ Ver menú       │ Hacer pedido       │ Preguntar   │ │
│ └────────────────┴──────────────────┴─────────────┘ │
└─────────────────────────────────────────────────────┘
     ↓          ↓                    ↓
 Ver menú   Hacer pedido      Preguntar
```

### Ruta 1: Ver menú (reply_id: `btn_menu`)

```
→ send_list
  text: "Nuestro menú:"
  button_label: "Seleccionar"
  ┌──────────────────────────────────────────┐
  │ Sección "Clásicas"                       │
  │ • row_marg  → "Margarita $12"            │
  │ • row_napo  → "Napolitana $15"           │
  │ • row_pesc  → "Pescadora $18"           │
  │ Sección "Especiales"                     │
  │ • row_espec → "La Vecchia $20"           │
  │ • row_vege  → "Vegetariana $14"          │
  │ Sección "Otra opción"                    │
  │ • row_pedir → "Hacer pedido"             │ (reply_id: same as main button)
  └──────────────────────────────────────────┘
     ↓ (para cada pizza seleccionada)
  [send_list] "Selecciona el tamaño:"
  • row_peque → "Pequeña (+$0)"
  • row_medi  → "Mediana (+$3)"
  • row_grand → "Grande (+$5)"
  → (después de tamaño) send_message "¿Ver más pizzas?" + buttons "Sí" / "Hacer pedido"
```

> **Simplificación:** Para no saturar el Flow con fotos de cada pizza, el `send_list` muestra los nombres y precios. Si el cliente quiere ver fotos, puede usar `send_media` en nodos intermedios, pero para un MVP funcional basta con el listado.

### Ruta 2: Hacer pedido (reply_id: `btn_pedir`)

```
collect_input "¿Qué pizza quieres?" (var=pizza)
→ ej: "Margarita" o "Napolitana"

collect_input "¿Tamaño? (Pequeña, Mediana o Grande)" (var=tamano)
→ ej: "Mediana"

collect_input "¿Para delivery o recogida?" (var=servicio)
→ ej: "Delivery" o "Recoger"

Condition: var(servicio) == "Delivery"
  yes → collect_input "¿Cuál es tu dirección?" (var=direccion)
  no  → (salta la dirección)

collect_input "¿Tu número de contacto?" (var=telefono)
→ Opcional: el bot ya tiene el WhatsApp

send_buttons
  text: "📋 Confirma tu pedido:\n🍕 {{vars.pizza}} {{vars.tamano}}\n{{vars.servicio}}: {{vars.direccion}}\n📞 {{vars.telefono}}\n¿Todo correcto?"
  btn_confirmar → "✅ Sí, confirmar" (reply_id: `confirmar_pedido`)
  btn_modificar → "✏️ Modificar" (reply_id: `modificar_pedido`)
  btn_cancelar  → "❌ Cancelar" (reply_id: `cancelar_pedido`)
```

### Ruta 3: Preguntar (reply_id: `btn_preg`)

```
send_message "Puedes preguntarme sobre ingredientes, horarios, envíos, etc."
collect_input "¿Qué te gustaría saber?" (var=pregunta)
send_message "Un momento, busco esa información... 🤔"
→ handoff (nota: "Cliente pregunta: {{vars.pregunta}}")
→ end
```

### Nodos terminales

```
btn_confirmar → Automatización (interactive_reply confirmar_pedido) → end
btn_modificar → vuelve a collect_input para pizza
btn_cancelar → send_message "Pedido cancelado. ¡Vuelve cuando quieras! 😊" → end
handoff → end (el agente toma el hilo)
```

---

## Automatización 1: "Confirmar Pedido"

### Trigger
- **Tipo:** `interactive_reply`
- **reply_ids:** `["confirmar_pedido"]`

### Pasos

```
1. send_template
   template_name: "pedido_recibido"
   variables: { 1: "{{vars.pizza}}", 2: "{{vars.tamano}}" }
   → Texto del template: "¡Pedido recibido! 🍕 Tu {{1}} {{2}} está en proceso. 
     En breve un mesero se contactará para confirmar delivery o recogida."

2. add_tag → "Pedido confirmado"

3. send_message
   → "Perfecto, {{vars.pizza}} {{vars.tamano}} confirmado. 🎯
     Por favor, envíanos el comprobante de pago cuando hayas pagado. 
     ¡Gracias! 🙌"

4. remove_tag → "Nuevo lead" (si lo tiene)
```

> ✅ El cliente recibe: (1) un template bonito de confirmación, (2) un mensaje pidiendo el comprobante.

---

## Automatización 2: "Procesar Pago Recibido"

### Trigger
- **Tipo:** `new_message_received`
- **Condición:** El contacto debe tener el tag "Pedido confirmado"

### Configuración de trigger

```json
{
  "trigger_type": "new_message_received",
  "trigger_config": {}
}
```

### Pasos con ramas (condition)

```
1. Condition: tag_presence "Pedido confirmado"
   ┌───── yes ─────→ Continúa
   └───── no ─────→ (termina, no hace nada)

2. Condition: contact_field "custom:pago_recibido" absent
   ┌───── yes (no tiene el tag, continuar) ─────→ Sigue
   └───── no (ya pagó) ─────→ send_message "Ya recibimos tu pago anterior. ¡Gracias!" → end

3. send_message "✅ ¡Gracias por tu pago! Un momento mientras validamos el comprobante."

4. add_tag → "Pago recibido"
   (esto dispara la Automatización 3)

5. wait 1 minute → (para dar tiempo de revisión)
```

---

## Automatización 3: "Entregar Pedido al Mesero"

### Trigger
- **Tipo:** `tag_added`
- **tag_id:** → "Pago recibido"

### Pasos

```
1. assign_conversation
   mode: round_robin
   → Asigna a cualquier mesero disponible en la cuenta

2. send_message (internal note vía webhook interno — pero como no usamos webhooks, usamos:)
   → El mesero verá en el inbox:
      - El tag "Pago recibido" en la conversación
      - La conversación asignada a él
      - El historial completo del pedido en el thread

3. Condition: tag_presence "Cliente premium" (frecuente)
   yes → send_message "¡Este es un cliente frecuente! 🎉 Prioridad alta."
   no  → (nada)
```

---

## Automatización 4: "Follow-up post-pedido"

### Trigger
- **Tipo:** `time_based`
- **Schedule:** `cron 0 21 * * *` (9 PM, después del cierre)

### Condición inicial

```
Condition: tag_presence "Pedido confirmado" AND tag_presence "Pago recibido"
  yes → Continúa
  no  → (termina)
```

### Pasos

```
1. send_message
   → "¡Hola de nuevo! ¿Cómo estuvo tu pizza de hoy? 🍕 
     Cuéntanos para mejorar. Si tienes algún comentario, un mesero te responde."

2. add_tag → "Feedback solicitado"

3. wait 3 days

4. Condition: tag_presence "Feedback recibido" (no)
   yes → send_message "¿Te animas a dejarnos un mensaje? Nos encantaría saber tu opinión. 😊"
```

---

## Flujo completo de interacción (cronología)

```
00:00  Cliente: "hola"
00:01  → Flow dispara (keyword "hola")
00:02  → Bot: "¿Qué quieres hacer?" [Ver menú] [Hacer pedido] [Preguntar]

00:05  Cliente: toca "Hacer pedido"
00:06  → Bot: "¿Qué pizza quieres?"
00:10  Cliente: "Napolitana"
00:11  → Bot: "¿Tamaño?"
00:12  Cliente: "Grande"
00:13  → Bot: "¿Delivery o recogida?"
00:14  Cliente: "Delivery"
00:15  → Bot: "¿Dirección?"
00:16  Cliente: "Av. 10, Casa 123"
00:17  → Bot: "¿Teléfono?"
00:18  Cliente: "0412-123-4567"
00:19  → Bot: "Confirma tu pedido: Napolitana Grande, Delivery: Av. 10... [Sí] [Modificar] [Cancelar]"

00:25  Cliente: toca "✅ Sí, confirmar"
00:26  → Automatización "Confirmar Pedido" dispara
       → Template: "¡Pedido recibido! 🍕"
       → Mensaje: "Por favor envía el comprobante de pago"
       → Tag: "Pedido confirmado"

00:45  Cliente: envía foto del comprobante de pago
00:46  → Automatización "Procesar Pago Recibido" dispara
       → Tag "Pago recibido" se añade

00:47  → Automatización "Entregar Pedido al Mesero" dispara
       → Conversación assignada al mesero Juan
       → Mesero ve todo el historial en el inbox

00:50  Mesero: responde "¡Gracias! Pizza lista en 20 min para Av. 10"

21:00  → Automatización "Follow-up" dispara
       → Bot: "¿Cómo estuó tu pizza?"

??:??  Cliente: "¡Deliciosa!"
       → (opcional: add_tag "Feedback recibido")
```

---

## Tags necesarios

| Tag | Momento de creación | ¿Para qué sirve? |
|---|---|---|
| **Nuevo lead** | Automáticamente (trigger: first_inbound_message) | Identificar contactos nuevos |
| **Pedido confirmado** | Automatización "Confirmar Pedido" | El cliente confirmó su orden |
| **Pago recibido** | Automatización "Procesar Pago" | El cliente envió comprobante |
| **Feedback solicitado** | Automatización "Follow-up" | Se pidió review post-pedido |
| **Feedback recibido** | Manual (mesero) | Cliente dejó feedback |
| **Cliente premium** | Automático (custom field pedidos_totales > 3) | Prioridad en atención |
| **Personal** | Manual (owner) | Excluir de IA — ver estudio anterior |

---

## Templates de WhatsApp (para crear en Meta Business Suite)

> Todas deben estar en **APPROVED** para usar `send_template`.

| Nombre | Categoría | Texto | Variables |
|---|---|---|---|
| `pedido_recibido` | UTILITY | "¡Pedido recibido! 🍕 Tu {{1}} {{2}} está en proceso. En breve un mesero se contactará. ¡Gracias! 🙌" | 1=pizza, 2=tamaño |
| `pago_confirmado` | UTILITY | "✅ ¡Gracias por tu pago! Tu pedido está siendo preparado. Pedido #{{1}}." | 1=numero_pedido (opcional) |
| `pedido_en_camino` | UTILITY | "🚚 ¡Tu pizza {{1}} está en camino! Llega en ~20 min. ¡Gracias por tu paciencia! 🍕" | 1=pizza |
| `feedback_peticion` | MARKETING | "¿Cómo estuvo tu pizza de hoy? 🍕 Cuéntanos para mejorar. ¡Gracias!" | — |
| `cliente_frecuente` | MARKETING | "¡Eres un cliente frecuente! 🎉 Lleva tu código: FIDELIDAD{{1}} para 10% off." | 1=numero |

---

## Custom Fields necesarios

| Nombre del field | Tipo | ¿Para qué? |
|---|---|---|
| `pedidos_totales` | número | Contador de pedidos (para cliente premium) |
| `ultima_pedido` | fecha | Última fecha de pedido |
| `preferencias` | texto | Notas: "sin queso", "extra orégano", etc. |
| `pago_recibido` | texto | "sí" / "no" — para condition checks |

---

## Configuración de cron

| Endpoint | Frecuencia | Para qué |
|---|---|---|
| `/api/flows/cron` | Cada 1 hora | Timeout de flows inactivos |
| `/api/automations/cron` | Cada 5-15 min | Resumen de `wait` steps en automatizaciones |

> Si no configuras el cron, los `wait` steps (follow-up de 3 días) no se dispararán automáticamente.

---

## Mejoras post-MVP (iteraciones futuras)

1. **Counter de pedidos (cliente premium):** Automatización que incremente `pedidos_totales` en cada tag "Pago recibido" usando `update_contact_field`. (Limitación actual: no hay incremento numérico directo — workaround: usar `send_webhook` a un endpoint interno que haga el math, o registrar el count en `automation_logs` y leerlo después.)

2. **Menú fijo en el Flow:** En lugar de un `send_list` estático, usar `send_media` con una imagen del menú completo como primer nodo. Más visual, menos pasos.

3. **Botón de pago rápido:** Un botón "Pagar $15" que abre un link de Stripe (requiere integración externa, pero se puede usar `send_buttons` con `url_button` type en el payload interactive).

4. **Recogida vs Delivery geolocalizada:** Usar `condition` con `contact_field` "direccion" para validar que la dirección esté dentro del delivery zone, y si no, sugerir recogida.
