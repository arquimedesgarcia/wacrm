# Informe de investigación: Evolution API y WaCRM

- **Fecha:** 2026-08-28
- **Tipo:** análisis documental
- **Resultado:** propuesta creada; implementación no iniciada

## Fuentes oficiales consultadas

### WaCRM

- `AGENTS.md`
- `package.json`
- `src/lib/whatsapp/meta-api.ts`
- `src/lib/whatsapp/send-message.ts`
- `src/lib/whatsapp/encryption.ts`
- `src/app/api/whatsapp/send/route.ts`
- `src/app/api/whatsapp/webhook/route.ts`
- `src/lib/automations/meta-send.ts`
- `src/lib/flows/meta-send.ts`
- `src/lib/ai/auto-reply.ts`
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/013_whatsapp_config_phone_number_id_unique.sql`
- `supabase/migrations/017_account_sharing.sql`
- `supabase/migrations/036_conversation_contact_dedup.sql`
- `supabase/migrations/037_webhook_broadcast_reliability.sql`
- `supabase/migrations/039_inbound_media_mirror.sql`

### Evolution API

- Repositorio oficial consultado: `https://github.com/evolution-foundation/evolution-api`
- Documentación de quickstart consultada a través de la documentación publicada.
- Releases API: `https://api.github.com/repos/evolution-foundation/evolution-api/releases/latest`
- Licencia: `https://raw.githubusercontent.com/evolution-foundation/evolution-api/main/LICENSE`

## Estado de versión verificado

La consulta al endpoint oficial de GitHub devolvió:

- tag latest estable reportado: `2.3.7`
- nombre: `v2.3.7`
- publicación: `2025-12-05`
- prerelease: `false`

La documentación y los contratos deben volver a validarse contra el tag elegido
justo antes de implementar. No se recomienda usar `latest` sin pinning.

## Capacidades observadas

La documentación consultada muestra contratos para:

- creación de instancia;
- QR con `qrcode: true`;
- consulta de estado de conexión;
- conexión manual;
- envío de texto;
- webhooks por instancia/globales;
- eventos de QR, conexión y mensajes;
- payload de mensaje con JID, indicador `fromMe`, contenido y timestamp;
- envío de media mediante rutas específicas.

Esto demuestra viabilidad técnica de un adaptador inicial, pero no demuestra que
cada capacidad sea compatible uno-a-uno con la semántica actual de WaCRM. Por eso
media, templates e interactivos quedaron como fases separadas.

## Licencia observada

El archivo oficial declara Apache License 2.0 con condiciones adicionales sobre:

- preservación de logo/copyright en componentes frontend;
- notificación clara del uso de Evolution API incluso en sistemas cerrados;
- posible necesidad de licencia comercial si las condiciones no se cumplen.

Esto debe revisarse legalmente para el caso de uso real. La propuesta incluye un
aviso administrativo y evita asumir que Apache 2.0 por sí sola agota las
obligaciones.

## Hallazgos de acoplamiento en WaCRM

1. El cliente Meta contiene transportes de verificación, registro, texto, media,
   templates e interactivos en un mismo módulo.
2. El envío compartido carga `whatsapp_config`, descifra `access_token` y llama
   helpers Meta directamente.
3. Flows y automations tienen senders propios que importan Meta.
4. El agente IA delega en `engineSendText`, que actualmente es un sender Meta.
5. El webhook Meta contiene simultáneamente verificación, resolución de cuenta,
   normalización, persistencia e invocación de automatizaciones/flows/IA.
6. La tabla `whatsapp_config` es una fila por cuenta y está protegida por RLS;
   los tokens se cifran en aplicación.
7. La persistencia ya tiene defensas útiles para reutilizar: cuenta, dedupe de
   conversación/contacto, índice de idempotencia de mensajes y escalera de
   estados.
8. No se encontró código de Evolution API en el repositorio.

## Conclusión

Agregar Evolution API es viable y no utópico, pero no debe comenzar agregando
llamadas a Evolution dentro de las rutas actuales. Primero hay que crear una
frontera pequeña, envolver Meta sin cambiarlo y después conectar un adaptador
Evolution por etapas. La mayor dificultad no es enviar texto: es preservar
idempotencia, aislamiento por cuenta, media/estados, transición de proveedor y
seguridad de la instancia.

## Confirmación de alcance

Durante esta tarea:

- no se modificó ningún archivo de código;
- no se modificó ninguna migración;
- no se cambiaron variables de Railway o Supabase;
- no se desplegó Evolution API;
- no se eliminó ni degradó Meta;
- solo se crearon documentos bajo `docs/evolution-api/`.
