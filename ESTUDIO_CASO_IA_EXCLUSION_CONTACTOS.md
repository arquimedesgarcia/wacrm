# Estudio de Caso: WhatsApp Personal + Ventas — Selección de Contactos para IA

## 1. Contexto del problema

El usuario comparte su número de WhatsApp entre uso personal (familia, amigos, conversaciones privadas) y uso comercial (atención a clientes). El bot de IA de waCRM, configurado con auto-reply, no distingue entre un mensaje de un cliente potencial y uno de un familiar. Esto genera riesgos:

- **Sobre-IA en conversaciones personales:** El bot responde a mensajes de familiares/amigos como si fueran clientes, lo que es invasivo e inapropiado.
- **Costos de tokens innecesarios:** Cada mensaje personal consume solicitudes al proveedor de IA (OpenAI/Anthropic/Ollama), gastando el presupuesto del usuario sin valor comercial.
- **Ruido en el inbox:** El bot genera respuestas automáticas que aparecen como mensajes en conversaciones reales, confundiendo a los contactos reales.
- **Fugas de privacidad:** El contexto de conversaciones personales podría (teóricamente) enviarse al proveedor de IA.

## 2. Arquitectura actual de waCRM — lo que existe

### 2.1 Punto de disparo de IA

El bot de auto-reply se dispara en el webhook de WhatsApp, en este orden (líneas 854-881 de `src/app/api/whatsapp/webhook/route.ts`):

```
1. dispatchInboundToFlows() — si consume el mensaje, todo termina aquí
2. runAutomationsForTrigger() — para triggers de relationship (new_contact_created, first_inbound_message)
3. runAutomationsForTrigger() — para triggers de contenido (new_message_received, keyword_match) — SOLO si Flow no consumió
4. dispatchInboundToAiReply() — SOLO si: no fue consumido por Flow, no es respuesta interactiva, y el texto no está vacío
```

### 2.2 Mecanismos de exclusión existentes

En `src/lib/ai/auto-reply.ts` (líneas 50-80), el bot ya verifica **4 condiciones** antes de dispararse, y **todas deben fallar** para que NO se envíe una respuesta:

| # | Condición | Dónde se verifica | Qué hace |
|---|---|---|---|
| 1 | `AI off / auto-reply disabled` | `ai_configs.auto_reply_enabled = false` | No dispara nunca |
| 2 | `Human agent assigned` | `conversations.assigned_agent_id IS NOT NULL` | No dispara — un humano duele el hilo |
| 3 | `Auto-reply disabled for this conversation` | `conversations.ai_autoreply_disabled = true` | "Tomar el control" pausa el bot sticky |
| 4 | `Per-conversation reply cap reached` | `ai_reply_count >= auto_reply_max_per_conversation` (default 3) | El bot se cansa de responder |
| 5 | `Active automations suppress AI` | Existe algún automation activo con trigger `new_message_received` o `keyword_match` | No hay doble respuesta (automatización + IA) |
| 6 | `Flow consumed message` | `flowResult.consumed === true` | El Flow roba el mensaje antes que la IA |

### 2.3 Control de usuario en el inbox

El componente `src/components/inbox/ai-thread-banner.tsx` muestra un banner en cada conversación con dos botones:
- **"Tomar el control" (Take over):** Pausa el bot (`ai_autoreply_disabled = true`) y asigna la conversación al agente actual (`assigned_agent_id`). **Este es el mecanismo existente para el caso de uso personal.**
- **"Reanudar IA" (Resume AI):** Reactiva el bot (`ai_autoreply_disabled = false`), reinicia `ai_reply_count = 0` y desasigna el hilo.

### 2.4 Datos de contacto disponibles

En el webhook (`src/app/api/whatsapp/webhook/route.ts`, línea 1127), el contacto se resuelve vía `findExistingContact()` que hace `SELECT * FROM contacts WHERE account_id = ? AND phone LIKE '%suffix%'`. **Devuelve todos los campos del contacto** incluyendo su relación con tags (aunque actualmente el query no incluye `contact_tags`).

Los contactos tienen:
- `custom_fields` (tabla `custom_fields` → `contact_custom_values`) — campos definibles por el usuario
- `tags` (tabla `contact_tags` → `tags`) — etiquetas de segmentación
- Campos built-in: `name`, `email`, `phone`, `company`

## 3. Análisis de alternativas

### Alternativa A: Lista de exclusión de contactos/Tags (recomendada)

**Mecanismo:** Agregar un check en `dispatchInboundToAiReply()` que consulte si el contacto tiene un tag o custom field que indique "uso personal".

#### Implementación técnica

**Modificación mínima en `auto-reply.ts`:**

```typescript
// Después de la línea 76 (if conv.assigned_agent_id return)
// Antes de la línea 78 (cap check)

// Check excluciones de contacto
const { data: excluded } = await db
  .from('contact_tags')
  .select('tag_id')
  .eq('contact_id', contactId)
  .in('tag_id', EXCLUSION_TAG_IDS)  // Configurable por account
  .limit(1)
if (excluded && excluded.length > 0) return
```

#### Ventajas

- ✅ **Automático:** Una vez configurado el tag, funciona sin intervención manual.
- ✅ **Granular:** Puedes tener múltiples tags: "personal", "familiar", "amigo", "no-automatizar".
- ✅ **Visual:** Los tags aparecen en el inbox, el agente ve inmediatamente el estado.
- ✅ **Combínalo con Flows:** Un Flow con trigger `new_contact_created` puede etiquetar automáticamente contactos nuevos como "nuevo lead" (incluidos en IA) mientras los contactos existentes sin tag quedan excluidos.
- ✅ **Sin costo de latencia:** La consulta a `contact_tags` es un index lookup.
- ✅ **Persistente:** No depende de la sesión del agente.

#### Desventajas

- ❌ **Setup manual requerido:** El usuario debe crear los tags y asignarlos.
- ❌ **No escala para contactos nuevos:** Un contacto nuevo que es amigo necesita ser tagueado manualmente antes de que el bot actúe.
- ❌ **No aprovecha datos contextuales:** No distingue si es un mensaje personal vs. comercial del mismo contacto.

### Alternativa B: Pregunta de consentimiento interactivo (alternativa viable)

**Mecanismo:** El primer mensaje de un contacto desconocido (sin tags) recibe una respuesta del bot con botones: "¿Eres cliente?" → Sí / No. Si dice No, se etiqueta como "personal" y se excluye de la IA.

#### Implementación técnica

Usando **Flow + Automatización en combinación:**

**Step 1 — Automatización (trigger: `first_inbound_message`):**
```
send_buttons "¡Hola! Para atenderte mejor, ¿eres cliente de [Nombre del negocio]?"
  btn_cliente → reply_id="soy_cliente" → termina aquí
  btn_no_cliente → reply_id="no_cliente" → termina aquí
```

**Step 2 — Automatización (trigger: `interactive_reply`, reply_ids: ["no_cliente"]):**
```
add_tag "Personal / No cliente"
→ send_message "Entendido. Un humano te contactará si es necesario."
→ close_conversation (opcional)
```

**Step 3 — Configuración de exclusión (igual que Alternativa A):**
```
El tag "Personal / No cliente" está en la lista de exclusión de IA.
```

#### Ventajas

- ✅ **Autodiscover:** No necesitas predecir quién es personal. El contacto lo declara.
- ✅ **Consentimiento explícito:** El contacto elige explícitamente. Cumple con privacidad.
- ✅ **Combina Flow + Automatización:** El pattern "Flow pregunta → botón dispara Automatización de tag" es el patrón recomendado por el código.
- ✅ **No molesta a clientes reales:** Solo interrumpe a contactos completamente nuevos, que es el momento óptimo para identificar.

#### Desventajas

- ❌ **Añade fricción:** Un cliente real también debe pasar por el "¿eres cliente?" al primer mensaje. Esto puede generar fricción inicial.
- ❌ **No funciona para contactos preexistentes:** Si ya tienes el número de un familiar guardado como contacto, nunca verá la pregunta.
- ❌ **Más complejo de configurar:** Requiere 2 automatizaciones, tags, y configuración de exclusión.
- ❌ **Puede no funcionar con respuestas libres:** Si el contacto responde "no soy cliente" en texto libre (no toca el botón), no se dispara el trigger `interactive_reply`. Necesitarías también un `keyword_match` "no soy cliente".

### Alternativa C: Filtrado por horario (time_based)

**Mecanismo:** La IA solo responde durante horas comerciales (ej: 9am-6pm). Fuera de ese horario, se supone que el dueño está en uso personal.

#### Implementación

- **Automatización (trigger: `time_based`, schedule `"cron 0 9-18 * * 1-5"`):** `send_message` con mensaje de "fuera de oficina" que NO use IA.
- **Configuración de IA:** `auto_reply_enabled = true`, pero el `system_prompt` puede incluir: "Si el mensaje llega fuera de horas comerciales, haz un handoff inmediato."

#### Ventajas

- ✅ **Simple de entender.**
- ✅ **Reduce costos de noche.**

#### Desventajas

- ❌ **No es preciso:** Los dueños pueden trabajar fines de semana, o tener uso personal durante horas comerciales.
- ❌ **No resuelve el problema central:** Durante horas comerciales, un mensaje de familia aún dispara la IA.
- ❌ **No es lo suficientemente granular.**

### Alternativa D: Filtrado por longitud/complejidad del mensaje

**Mecanismo:** La IA no responde a mensajes muy cortos ("hola", "ok", "gracias") que típicamente son de uso personal.

#### Implementación

Modificar `dispatchInboundToAiReply()` para exigir un mínimo de caracteres o palabras antes de disparar.

#### Ventajas

- ✅ **Casi cero setup.**
- ✅ **Filtra el 30% de los mensajes triviales.**

#### Desventajas

- ❌ **No resuelve el problema:** Un mensaje personal como "¿Vienes a cenar?" es corto pero no es trivial.
- ❌ **Genera falsos negativos:** Mensajes personalizados cortos de clientes reales también se filtran.
- ❌ **Inadecuado arquitectónicamente:** La IA debe poder responder mensajes breves.

---

## 4. Recomendación: Combinación A + B (defensiva en capas)

### Solución óptima: **Tag de exclusión + consantemiento para contactos nuevos**

#### Capa 1: Lista de exclusión por tag (Alternativa A)

**Configuración inicial:**

1. **Crear un tag** en waCRM: "Personal" (color rojo, para visibilidad).
2. **Asignar manualmente** este tag a todos tus contactos personales (familiares, amigos, proveedores no clientes).
3. **Configurar la exclusión:** Esta parte requiere una modificación de código mínima en `auto-reply.ts`.

**Modificación técnica requerida (1 archivo, ~10 líneas):**

En `src/lib/ai/auto-reply.ts`, agregar después de la verificación de `assigned_agent_id` (línea 77):

```typescript
// Exclusión por tag de contacto
const EXCLUSION_TAGS_KEY = 'ai_exclusion_tags'
const { data: exclusionTags } = await db
  .from('accounts')
  .select('ai_exclusion_tags')
  .eq('id', accountId)
  .maybeSingle()
// o usar una tabla de config: settings_ai_exclusion_tags

const { data: contactTags } = await db
  .from('contact_tags')
  .select('tag_id')
  .eq('contact_id', contactId)
  .limit(1)
if (contactTags?.length && exclusionTags?.ai_exclusion_tags?.length) {
  const isExcluded = contactTags.some(ct =>
    exclusionTags.ai_exclusion_tags.includes(ct.tag_id)
  )
  if (isExcluded) return  // Silencioso, como el resto de gateos
}
```

> **Nota de implementación:** La tabla `accounts` no tiene una columna de tags de exclusión. La solución más limpia es agregarla como JSONB: `ALTER TABLE accounts ADD COLUMN ai_exclusion_tag_ids uuid[] DEFAULT '{}'`. Esto permite configurar qué tags excluyen de la IA a nivel de cuenta, editable desde Settings → AI.

#### Capa 2: Consantemiento para contactos nuevos (Alternativa B)

Para contactos que **no tienen tags** (es decir, son nuevos y aún no has clasificado), usar un Flow + Automatización:

**Automatización 1 (trigger: `first_inbound_message`):**
```
send_buttons
  text: "¡Hola! 👋 Para atenderte mejor, ¿eres cliente de [Nombre del negocio]?"
  btn: "Sí, soy cliente" (reply_id: "soy_cliente")
  btn: "Aún no" (reply_id: "no_cliente")
```

**Automatización 2 (trigger: `interactive_reply`, reply_ids: ["no_cliente"]):**
```
add_tag "Personal"
send_message "Gracias por tu honestidad. Un humano te contactará si es necesario."
```

**Automatización 3 (trigger: `interactive_reply`, reply_ids: ["soy_cliente"]):**
```
add_tag "Cliente"
send_message "¡Perfecto! Un asesor te atenderá en cuanto. Mientras tanto, escribe *menu* para ver nuestro catálogo."
```

Con este setup:
- Contactos nuevos → pasan por el funnel de clasificación → se etiquetan → la IA solo responde a "Cliente".
- Contactos existentes con tag "Personal" → la IA nunca dispara.
- Contactos existentes sin tag → puedes decidir: ¿la IA responde a todos? O agregas un Flow de clasificación que también dispare para `new_message_received`.

### Flujo completo de interacción

```
[Nuevo contacto escribe →]
  → Automatización first_inbound_message dispara
  → Bot envía: "¿Eres cliente?" [Sí] / [No]
    → Si dice "No" → Automatización interactive_reply → add_tag "Personal" → IA EXCLUIDA
    → Si dice "Sí" → Automatización interactive_reply → add_tag "Cliente" → IA INCLUIDA

[Contacto existente con tag "Personal"]
  → Message inbound → Flow no consume → Automatizaciones check → IA checks tag → EXCLUIDA (early return)

[Contacto existente con tag "Cliente"]
  → Message inbound → Flow no consume → Automatizaciones → IA → responde normal
```

### 4.1 Alternativa simplificada (solo Alternativa A)

Si no quieres el fricción del "¿eres cliente?", la **Alternativa A sola** es suficiente si:

- Tienes pocos contactos personales (puedes etiquetarlos manualmente en 5 minutos).
- No importa que contactos desconocidos reciban respuesta de IA hasta que los clasifiques.

**Proceso:**
1. Crea el tag "Personal".
2. Ve a Contactos → filtra por nombre/teléfono → asigna el tag a quienes sean personales.
3. (Implementación de código) Activa la exclusión por tag en la configuración de IA.

---

## 5. Comparativa de alternativas

| Criterio | A. Tag exclusión | B. Consentimiento interactivo | C. Horario | D. Mensaje corto |
|---|---|---|---|---|
| **Setup requerido** | Manual (etiquetas) + Código (1 función) | Manual (2 automatizaciones + tags) + Código (1 función) | Config (1 automation) | Código (1 función) |
| **Funciona para nuevos contactos** | Solo si se etiqueta | ✅ Automáticamente | ✅ (limitado) | ✅ (limitado) |
| **Funciona para contactos existentes** | ✅ Si están etiquetados | ❌ No pregunta de nuevo | ✅ | ✅ (limitado) |
| **Fricción para clientes reales** | Ninguna | Media (1 mensaje extra) | Ninguna | Ninguna |
| **Precisión** | Alta (tú decides) | Alta (consentimiento explícito) | Baja | Muy baja |
| **Costo de implementación** | Bajo (1 función + 1 columna) | Medio (2 automatizaciones + 1 función) | Muy bajo | Bajo |
| **Privacidad** | ✅ No envía conversaciones personales | ✅ Consentimiento explícito | ✅ Reduce exposición | ✅ Reduce exposición |
| **Mantenimiento** | Bajo (etiquetar nuevos contactos) | Ninguno | Ninguno | Ninguno |

---

## 6. Recomendación final

**Solución recomendada: Alternativa A (Tag de exclusión) como base + Alternativa B (consentimiento) como refuerzo opcional para contactos nuevos.**

### Por qué A es la mejor opción principal:

1. **waCRM ya tiene todos los componentes:**
   - `contact_tags` para la relación contacto-tag
   - `conversations.ai_autoreply_disabled` para pausar por conversación
   - El inbox ya muestra tags en cada contacto
   - El banner de IA ya permite "tomar el control" manualmente

2. **El patrón ya existe parcialmente:** La función `dispatchInboundToAiReply()` ya verifica `assigned_agent_id` como gate de exclusión. Agregar un check de tags es el **mismo patrón extendido**.

3. **Combina con Flows/Automatizaciones:** Puedes usar un Flow con trigger `first_inbound_message` para etiquetar automáticamente a los nuevos contactos como "Lead" o "Cliente prospecto", y luego un humano (o un sistema) mueve el tag a "Personal" si descubre que es un familiar.

### Qué se necesita implementar (esfuerzo: bajo, ~1 día de desarrollo):

1. **Migración SQL:** Agregar `ai_exclusion_tag_ids uuid[]` a la tabla `accounts` (o `ai_configs`).
2. **Modificación en `auto-reply.ts`:** Agregar el check de tags después de la verificación de `assigned_agent_id`.
3. **UI en Settings → AI:** Un selector de tags para configurar la lista de exclusión.

### Qué se necesita hacer (esfuerzo: 5 minutos):

1. Crear un tag llamado "Personal" o "No automatizar" en waCRM.
2. Asignarlo a tus contactos personales.
3. Configurar el tag en Settings → AI → "Exclude these tags from AI replies".

---

## 7. Escenarios edge cases y cómo manejarlos

| Escenario | Solución |
|---|---|
| **Un contacto etiquetado "Personal" que ahora es cliente real** | El agente puede usar "Tomar el control" (banner de IA) para pausar el bot, o remover el tag. |
| **Un contacto nuevo que es amigo, no cliente** | Si se usa el consentimiento interactivo, dirá "No" y se le etiqueta "Personal". |
| **Mensajes que llegan antes de poder etiquetar** | Durante las primeras 24h, el bot puede responder. Usa el "Tomar el control" manualmente o configura `auto_reply_max_per_conversation = 1` para minimizar. |
| **El bot de IA responde algo inapropiado en una conversación personal** | El agente puede borrar el mensaje (si Meta lo permite) o enviar una disculpa. El sistema ya graba `ai_generated = true` en cada mensaje del bot para auditoría. |
| **El contacto personal escribe "compra" / "precio" / keywords de negocio** | La exclusión por tag prevalece sobre todo. Si el tag es "Personal", ni siquiera entra a la lógica de keyword_match de IA. (Nota: las Automatizaciones con trigger `keyword_match` aún dispararían — esto es una limitación conocida. Ver sección 8.) |

---

## 8. Limitación conocida: Automatizaciones vs. IA

Las **Automatizaciones** con trigger `new_message_received` o `keyword_match` **no respetan** el tag de exclusión de IA. Funcionan de forma independiente. Esto significa:

- Si tienes una Automatización que responde a "hola" → también disparará para un mensaje personal que diga "hola".
- Si tienes una Automatización de `first_inbound_message` → también disparará para contactos personales nuevos.

**Mitigación:** Usa triggers más específicos. En lugar de `new_message_received`, usa:
- `first_inbound_message` (solo el primer contacto) + tag de clasificación
- `keyword_match` con palabras específicas de negocio (no palabras genéricas como "hola")

---

## 9. Checklist de implementación

- [ ] Crear tag "Personal" en waCRM
- [ ] Asignar tag a contactos personales existentes
- [ ] Implementar exclusión por tag en `dispatchInboundToAiReply()` (modo código)
- [ ] Agregar UI en Settings → AI para seleccionar tags de exclusión
- [ ] (Opcional) Crear Flow de clasificación para contactos nuevos
- [ ] (Opcional) Configurar `auto_reply_max_per_conversation = 2` como límite de seguridad
- [ ] Probar: enviar mensaje de contacto con tag "Personal" → verificar que el bot NO responde
- [ ] Probar: enviar mensaje de contacto sin tag "Personal" → verificar que el bot SÍ responde
- [ ] Probar: enviar mensaje de contacto nuevo con Flow de clasificación → verificar el funnel de consentimiento
