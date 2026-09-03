# WhatsApp Inbox: Image/Photo Preview in Conversation List

## Objetivo
Mostrar miniaturas de imágenes de chats (entrantes y salientes) directamente en la bandeja de entrada (`conversation-list.tsx`).

## Enfoque ajustado (sin migración)
**Restricción:** No aplicar migración a Supabase sin autorización explícita.
**Solución:** Las miniaturas se cargan por cliente cuando se selecciona una conversación (`message-thread.tsx` ya carga mensajes), no se previsualizan en la lista. La **vista previa de imágenes ya existe** en el thread vía `MediaLightbox`.

## Alcance real
### Reinterpretación
- "Ver imágenes de chats en la bandeja de entrada" = **asegurarse de que las imágenes se ven en el thread** al abrir una conversación.
- Las imágenes ya se muestran vía `MediaImageBubble` y `MediaLightbox`.
- **Bug detectado durante el análisis:** el import histórico de Evolution salta mensajes no-texto → imágenes importadas históricamente no aparecen. **Este es el fix real que aporta valor**.

### Cambios necesarios
1. **`evolution-import.ts`** línea 289: cambiar `if (event.contentType !== 'text')` para **incluir también `image` y `video`**, descargar y reflejar el media (similar a `mirrorInboundMedia` pero para Evolution API).
2. **Miniaturas en la lista (opcional, baja prioridad):** añadir `last_media_url` y `last_media_type` derivados de una sub-consulta PostgREST embebida (`messages: messages(...)`) cuando el último mensaje tiene `media_url` no nulo.

## Limitaciones conocidas
- El import histórico de Evolution actualmente descarga solo texto. Ampliarlo requiere implementar descarga desde Evolution API (no desde Meta).
- Las miniaturas en la lista serían solo de la **última** imagen, no un grid 2-3 (sería una carga extra por conversación en cada render de la lista).

## Verificación
- `npm run typecheck`
- `npm run lint`
- `npm test`
