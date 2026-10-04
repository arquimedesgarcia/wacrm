# 05 — Casos de uso por vertical

> Cuatro escenarios completos: restaurantes/comida rápida, inmobiliario, boletos y paquetes turísticos, y seguros. Cada uno incluye el **objetivo de negocio**, la **implementación concreta** (qué construir en waCRM), el **alcance real** (qué logra y qué no) y **propuestas innovadoras** para ofrecer a tus clientes.

---

## 1. Restaurantes y comida rápida

### Objetivo de negocio
Atender pedidos por WhatsApp las 24 h, tomar el pedido sin humano, confirmar, y solo derivar a persona cuando hace falta (quejas, pedidos especiales, cierre de pago).

### Implementación

**Flujo "Pedido"** (trigger: *Keyword* `pedido`, `menu`, `hambre`; también *First inbound message* si quieres menú universal):

```
Start
 └─ Send buttons: "¡Hola! ¿Qué quieres hacer?" [Pedir ahora] [Ver menú] [Hablar con persona]
     ├─ [Pedir ahora] → Send list: sección "Combos" (fila: combo1…), sección "Para ti" (…)
     │                    → Condition (var por fila elegida — cada fila apunta a su rama)
     │                    → Collect input: "¿Alguna indicación? (sin cebolla, término…)" var=notas
     │                    → Collect input: "Dirección de entrega" var=direccion
     │                    → Send message: "Pedido recibido: {{vars.producto}}. Dirección: {{vars.direccion}}"
     │                    → Set tag "Pedido_nuevo"
     │                    → Handoff (nota: "Pedido pendiente de confirmación de cocina")
     ├─ [Ver menú] → Send media (foto del menú del día, caption con precios) → End
     └─ [Hablar con persona] → Handoff
```

**Automatización "A cocina"** (trigger: *Tag added* = `Pedido_nuevo`):

```
Send webhook → https://tu-pos.com/pedidos   (o notifica al grupo de cocina por tu integración)
Wait 20 minutes
Condition time_of_day 11:00-23:00
  ├─ Yes → Send message: "¿Todo llegó bien? Tu opinión nos ayuda 🌟" (➜ mejor sin emoji según tu marca)
  └─ No  → End
```

**Automatización "Fuera de horario"** (Patrón E del capítulo 04): si escriben de 23:00 a 11:00, avisar horario una sola vez (etiqueta antispam).

**Preparación previa:** etiquetas (`Pedido_nuevo`, `Cliente_frecuente`, `Zona_norte`…), campo personalizado `zona`, y el cron externo activo.

### Alcance real
- **Logra:** toma de pedido completa sin humano 24/7, captura estructurada (producto + notas + dirección), notificación a cocina/sistema externo, encuesta post-entrega, segmentación por zona para logística.
- **No logra (hoy):** cobro/pago integrado (no hay nodo de pasarela), validación de dirección, ni confirmación en tiempo real del estado de la cocina hacia el cliente (salvo que tu POS responda por webhook y un humano escriba). La confirmación final la da el humano en el handoff.
- **Compensación:** el handoff con nota le da al operador todo lo capturado en el timeline del run (vars visibles en **Runs**).

### Propuestas innovadoras para vender
1. **Pedido recurrente en 1 toque:** etiqueta `Cliente_frecuente` + automatización *Interactive reply* que reenvía "¿Tu pedido de siempre?" con botones [Sí] [Cambiar] — el reply_id `pedido_usual` arranca el flujo pre-cargado.
2. **Menú del día por zona:** dos flujos clonados con listas distintas según almacén; la automatización de entrada decide por etiqueta de zona.
3. **Recuperación de no-orden:** automatización *New message received* + keyword "carta/menú" + `wait` 2 h + "¿Te decidiste? Te lo envío caliente en 30 min".

---

## 2. Servicios inmobiliarios (alquiler, compra, venta)

### Objetivo de negocio
Cualificar a quien pregunta por propiedades (operación, zona, presupuesto), ofrecerle opciones relevantes y pasar al agente humano **con el lead ya perfilado y un deal creado en el pipeline**.

### Implementación

**Flujo "Cualificación"** (trigger: *First inbound message*; keywords `casa`, `depa`, `alquiler`, `comprar`):

```
Start
 └─ Send buttons: "¿Buscas comprar, alquilar o vender?" [Comprar] [Alquilar] [Vender]
     ├─ [Comprar]/[Alquilar] → Send list: "¿Zona de interés?" secciones por distrito
     │                           → Collect input: "Presupuesto aproximado (USD)" var=presupuesto
     │                           → Collect input: "¿Cuándo te gustaría concretar?" var=plazo
     │                           → Set tag "Lead_compra" o "Lead_alquiler"
     │                           → Handoff (nota: "Lead cualificado — revisar vars en Runs")
     └─ [Vender] → Collect input: "Dirección o zona de tu inmueble" var=inmueble
                   → Set tag "Propietario_vende" → Handoff (nota: "Posible captación")
```

**Automatización "A pipeline"** (trigger: *Tag added* = `Lead_compra` — clonar para `Lead_alquiler` y `Propietario_vende`):

```
Create deal: pipeline "Ventas", etapa "Nuevo", title "Lead WhatsApp - <zona>"
Assign conversation: specific → agente de esa zona
Send message: "Te contacta {{...}} " → mejor: mensaje fijo de bienvenida al agente asignado (los placeholders de contacto no existen)
```

> Nota: como no hay `{{contact.name}}`, el agente verá el nombre y teléfono del contacto en la ficha; el deal se crea con título interpolable solo con datos del mensaje (`{{ message.text }}`) — usa un título estándar y deja el detalle en las vars del run.

**IA como segunda línea** (Ajustes → IA): auto-reply activado con **knowledge base = fichas de propiedades** (PDFs/descripciones). Si el flujo no arrancó (p. ej. el cliente pregunta algo muy concreto: "¿hay algo en Miraflores con 3 dormitorios?"), la IA responde con las fichas y emite `[[HANDOFF]]` cuando el cliente pide visita o negociar.

### Alcance real
- **Logra:** cualificación 24/7 con estructura consistente (operación/zona/presupuesto/plazo), deals automáticos en el Kanban, asignación por zona, respuestas inteligentes a preguntas sueltas con la IA + fichas, y handoff con contexto.
- **No logra (hoy):** enviar fotos de las propiedades que cumplen el filtro de forma dinámica (los nodos de media son estáticos; la IA sí puede describirlas con knowledge base), ni validar que el presupuesto sea un número (la captura acepta cualquier texto; valida con un nodo Condition o revisa en humano), ni mover el deal por etapas (solo se crea).
- **Compensación:** para mostrar opciones concretas, combina: el flujo captura zona → automatización `tag_added` notifica al agente, que envía las 2-3 fichas a mano o la IA las resume con la knowledge base.

### Propuestas innovadoras para vender
1. **Alerta de propiedades nuevas por segmento:** al publicar una propiedad, importa el contacto/etiqueta vía API pública (`contacts` + tag por zona) y dispara automatización `send_template` a esa etiqueta: "Llegó algo en tu zona".
2. **Tasación express para captación:** flujo para `Propietario_vende` que captura datos del inmueble y agenda visita del tasador (handoff al agente de captación). Convierte consultas en *inventario* para la inmobiliaria.
3. **Scoring por plazo:** condición sobre `vars.plazo` ("este mes" vs "solo mirando") → tag distinto → la automatización de seguimiento espera 1 día al caliente y 7 al frío.

---

## 3. Venta de boletos y paquetes turísticos

### Objetivo de negocio
Que el cliente elija destino/fecha desde un menú, reciba opciones, y pase a un asesor para cerrar la reserva; recuperar quienes abandonan sin comprar.

### Implementación

**Flujo "Explorar destinos"** (trigger: *Keyword* `viaje`, `paquete`, `boleto`, `promo`):

```
Start
 └─ Send list: "¿A dónde quieres ir?" (secciones: Playa / Montaña / Ciudad; filas: destinos, description: precio desde)
     → (cada fila apunta a su rama)
     ├─ Rama destino → Send media (foto del paquete, caption con itinerario)
     │                  → Send buttons: [Quiero cotizar] [Ver otro destino] [Hablar con asesor]
     │                       ├─ [Quiero cotizar] → Collect input: "¿Fechas y cuántos viajan?" var=fechas
     │                       │                     → Set tag "Cotizacion_pendiente" → Handoff
     │                       ├─ [Ver otro destino] → (vuelve a la lista)
     │                       └─ [Hablar con asesor] → Handoff
```

**Automatización "Recuperar abandonos"** (trigger: *New message received* + keyword `paquete|promo|viaje` — solo dispara si el flujo no consumió el mensaje):

```
Condition time_of_day 08:00-20:00
  ├─ Yes → Wait 4 hours → Send message: "¿Te gustó algún destino? Quedan pocas plazas para {{ mes }}"
  └─ No  → End
```

**Automatización "Cotización a sistema"** (trigger: *Tag added* = `Cotizacion_pendiente`): `send_webhook` a tu motor de reservas/ERP con el contexto del evento; luego `assign_conversation` al asesor de turno.

### Alcance real
- **Logra:** exhibición de catálogo navegable con fotos, captura de intención de fechas, recuperación de abandonos, integración con el motor de reservas.
- **No logra (hoy):** disponibilidad/cupo en tiempo real (el flujo no consulta APIs intermedias; el webhook es de salida y no devuelve datos al flujo), ni precio dinámico por fecha. El asesor confirma disponibilidad.
- **Compensación:** envía el webhook a un sistema que responda por WhatsApp vía **API pública** (`messages:send`) — tu ERP puede contestar la disponibilidad directamente en el hilo.

### Propuestas innovadoras para vender
1. **Lista de espera de cupos:** cuando el asesor marca "agotado", añade tag `Espera_<destino>`; al reabrir cupos, automatización con `send_template` avisa a la lista.
2. **Paquete sorpresa:** botón [Sorpréndeme] → condition aleatoria no existe, pero sí: 3 ramas fijas elegidas por el cliente de forma indirecta (pregunta presupuesto → rama = destino acorde).
3. **Post-viaje = reseñas y recompra:** etiqueta `Viajo` puesta por el asesor al emitir → automatización `wait` 3 días tras el regreso → mensaje de agradecimiento + oferta de siguiente destino.

---

## 4. Venta de seguros (médicos, de viajes, inmobiliaria)

### Objetivo de negocio
Triar el tipo de seguro que busca el cliente, capturar sus datos básicos, precualificar y derivar al asesor para el cierre — con post-venta automática.

### Implementación

**Flujo "Triaje de seguros"** (trigger: *First inbound message*; keywords `seguro`, `póliza`, `cobertura`):

```
Start
 └─ Send buttons: "¿Qué seguro buscas?" [Médico] [Viajes] [Inmobiliario] [Otro]
     ├─ [Médico] → Collect input: "Edad del titular" var=edad
     │               → Collect input: "¿Para ti o familia?" var=cobertura
     │               → Set tag "Seguro_medico" → Handoff
     ├─ [Viajes] → Collect input: "Destino y fechas del viaje" var=viaje
     │             → Set tag "Seguro_viaje" → Handoff
     ├─ [Inmobiliario] → Collect input: "¿Casa, departamento o local?" var=inmueble
     │                   → Set tag "Seguro_inmueble" → Handoff
     └─ [Otro] → Handoff (nota: "Consulta general de seguros")
```

**Automatización por línea** (una por tag; ejemplo `Seguro_viaje`):

```
Create deal: pipeline "Seguros", etapa "Nuevo", title "Seguro viaje - WhatsApp"
Assign conversation: specific → asesor de la línea
Send template (si ya pasó la ventana de 24 h cuando el asesor retoma): "Tu cotización de seguro está en camino"
```

**Automatización "Post-venta"** (trigger: *Tag added* = `Poliza_emitida` — la pone el asesor al cerrar):

```
Wait 1 day → Send message: "Tu póliza ya está activa. Guarda este chat para cualquier gestión."
Wait 30 days → Condition time_of_day … → Send message: "Recordatorio: revisa tu cobertura / ¿necesitas renovar?"
```

### Alcance real
- **Logra:** triaje consistente por línea de negocio (mismo número atendiendo 3 verticales), datos mínimos capturados antes de que el asesor pierda tiempo, deals por línea en pipelines distintos, post-venta y renovación sin esfuerzo.
- **No logra (hoy):** cotización calculada al vuelo (no hay evaluación de reglas ni consulta a tarifarios; el asesor cotiza), ni validación de edad como número (captura libre).
- **Compensación:** el webhook por tag puede llamar a tu cotizador; la respuesta llega al hilo vía API pública o la escribe el asesor.

### Propuestas innovadoras para vender
1. **Renovaciones automáticas:** al emitir, el asesor etiqueta `Renueva_<mes>`; una automatización por mes con `wait` largo (días) + `send_template` de renovación convierte la cartera existente en ingreso recurrente.
2. **Cross-sell por línea:** tag `Seguro_viaje` + automatización `wait` 7 días → mensaje "¿Sabías que tu tarjeta no cubre X? Conoce el seguro médico anual".
3. **Campana de siniestros:** keyword `siniestro`/`accidente` → automatización con prioridad: asigna inmediatamente al liquidador (sin wait), crea deal en pipeline "Siniestros" y envía las instrucciones documentadas.

---

## 5. Cómo desplegarlo por etapas (recomendación)

No implementes todo a la vez. Secuencia sugerida por vertical:

1. **Semana 1 — Base:** etiquetas, campos personalizados, pipelines/etapas, roles del equipo. Cron externo + `AUTOMATION_CRON_SECRET`.
2. **Semana 2 — Primer flujo:** el de cualificación/triaje principal (un solo vertical), con Handoff a humano. Prueba con números internos.
3. **Semana 3 — Automatizaciones de soporte:** tag_added → create deal + assign; fuera de horario; bienvenida.
4. **Semana 4 — IA:** knowledge base con tu catálogo/fichas, auto-reply con tope por conversación y `handoff_agent_id`; verifica que no haya doble respuesta con el flujo (fallback `ignore` si aplica).
5. **Semana 5+ — Crecimiento:** reactivación con plantillas, recuperación de abandonos (wait), webhooks a sistemas externos, post-venta y renovaciones.

**Métricas a vigilar:** ejecuciones y logs de automatización (fallos), runs por estado en Flujos (`handed_off` vs `completed` vs `timed_out`), tiempo de primera respuesta, y conversaciones pendientes sin atender.
