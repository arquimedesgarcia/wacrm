# localization-audit.md

Auditoría de textos localizables del fork `custom` de wacrm.
Fecha: 2026-09-02. Estado: **borrador, pendiente de aprobación**.
No incluye cambios de código: es la especificación que precede a la fase de migración.

---

## 1. Resumen ejecutivo

El proyecto ya usa **next-intl** con tres diccionarios (`en`, `es`, `ko`) resueltos vía `src/i18n/request.ts` y `src/features/i18n/config.ts`. Sin embargo, una proporción significativa de textos de UI y mensajes de error siguen escritos directamente en código (inglés sobre todo, español en zonas históricas), por lo que la localización es parcial y desigual entre features.

Objetivo de esta migración: llevar todos los textos visibles al usuario y todos los mensajes de error mostrados al usuario a claves `next-intl`, de forma incremental, sin regresiones y con cobertura verificada por tests.

Alcance de la auditoría:

- `src/components/**` (111 archivos `.ts/.tsx`).
- `src/app/**` (rutas App Router, server actions y route handlers).
- `src/lib/**` (mensajes de error de API, helpers, integraciones).
- `src/features/**` (limitado a `i18n/config.ts` y `i18n/locale.ts`, ya revisados).
- `src/i18n/**` (config, ya revisado).
- `messages/{en,es,ko}.json` (tres archivos existentes, 78–90 KB cada uno).

Volumen estimado de candidatos a localizar:

- ~1.400+ strings de UI/mensajes de error en `src/components/`.
- ~300+ strings en `src/app/` (páginas, route handlers).
- ~500+ strings en `src/lib/` (muchos son códigos técnicos / enum, ver §3).
- Algunas claves están referenciadas como literales en componentes (`"Settings.whatsapp"`, `"Flows.builder"`, `"Inbox.composer"`, etc.) lo que sugiere namespaces o convenciones declaradas que no se han respetado en los `.json`.

---

## 2. Arquitectura i18n actual

**Stack**: `next-intl` (config vía `getRequestConfig`).

**Resolución de locale** (prioridad en `src/i18n/request.ts`):

1. Cookie `NEXT_LOCALE` (set por `LocaleSwitcher`).
2. `NEXT_PUBLIC_DEFAULT_LOCALE` (variable nueva del fork).
3. `NEXT_PUBLIC_APP_LOCALE` (legacy upstream).
4. `DEFAULT_LOCALE = 'en'`.

**Locales soportados**: `en`, `es`, `ko` (`SUPPORTED_LOCALES` en `src/features/i18n/config.ts`).

**Carga de diccionarios**: `import('../../messages/${locale}.json')` con fallback a `en.json`.

**Helpers cliente**: `getSavedLocale`, `saveLocale`, `detectBrowserLocale`, `resolveClientLocale` en `src/features/i18n/locale.ts`.

**Componente existente**: `src/components/i18n/locale-switcher.tsx` (ya integrado en el layout).

**Estilo actual de claves**: nombres con punto jerárquico (`"Inbox.composer"`, `"Settings.roles"`, `"Dashboard.activityFeed"`). Algunas claves aparecen como literales sueltos en componentes sin estar pobladas en los `.json` — esto se interpreta como **deuda técnica** que la migración debe cerrar (mapa en §6).

**API actual de traducciones**:

- Server components / RSC: `getTranslations('namespace')` o `useTranslations` si el archivo lo permite.
- Cliente: `useTranslations` desde `next-intl`.
- No se observa uso todavía de `t.raw()` ni `t.rich()` en el código actual (verificado por grep): la migración tendrá que introducirlos donde aplique (§4).

---

## 3. Inventario clasificado

Clasificación aplicada a cada coincidencia detectada. Criterio:

1. **UI** — texto visible al usuario (botones, labels, placeholders, títulos, descripciones, aria, toasts, confirmaciones, errores de UI, estados vacíos/carga, validaciones, fallbacks de API).
2. **API_ERR** — mensaje técnico devuelto por un route handler o API pública que termina mostrándose al usuario → convertir a `code` localizable.
3. **USER** — dato introducido por el usuario, no traducir.
4. **TECH** — valor técnico (URL, ID, JID, código, header, enum, MIME, código de error externo).
5. **FP** — falso positivo o comentario.

### 3.1 `src/components/` (resumen por subcarpeta)

| Subcarpeta | UI | API_ERR | USER | TECH | FP | Notas |
|---|---|---|---|---|---|---|
| `inbox/` | ~70 | ~10 | ~5 | ~15 | — | mensajes `"Failed to fetch ..."`, `"Failed to send ..."`, toasts, placeholders. |
| `settings/` | ~90 | ~25 | ~3 | ~30 | — | mayor densidad: roles, members, api-keys, ai-config, evolution, templates. |
| `dashboard/` | ~25 | ~5 | — | ~5 | — | `metric-card`, `empty-state`, charts. |
| `automations/` | ~30 | ~8 | ~2 | ~10 | — | builder, validación, descripciones de nodos. |
| `flows/` | ~60 | ~20 | ~2 | ~15 | — | editor visual + formularios + validación + descripciones de nodos. |
| `contacts/` | ~25 | ~6 | ~5 | ~8 | — | import, custom fields, form, detail view. |
| `pipelines/` | ~25 | ~5 | — | ~6 | — | board, card, form, analytics, settings. |
| `broadcasts/` | ~30 | ~5 | — | ~10 | — | wizard 1–4. |
| `layout/`, `presence/`, `interactive/`, `agents/`, `auth/` | ~30 | ~6 | — | ~10 | — | header, sidebar, toaster, role guards. |
| `ui/` (shadcn primitives) | — | — | — | ~5 | — | Mayoritariamente `TECH` (iconos, ARIA de componentes). No traducir strings internos. |
| `tremor/` | — | — | — | — | — | Wrapper, sin strings de UI. |
| `i18n/` | — | — | — | — | — | Ya revisado, sin cambios. |

### 3.2 `src/app/` (resumen por área)

| Área | UI | API_ERR | USER | TECH | FP | Notas |
|---|---|---|---|---|---|---|
| `(auth)/login`, `signup`, `forgot-password` | ~12 | — | — | — | — | Strings de marketing + form. |
| `(dashboard)/**` (pages) | ~80 | ~5 | — | — | — | `inbox`, `contacts`, `pipelines`, `flows`, `broadcasts`, `automations`, `agents`, `dashboard`, `settings`, `notifications`. |
| `api/**/route.ts` | — | ~150 | — | ~80 | — | **Densidad alta de API_ERR y TECH**. |
| `api/v1/**` (API pública) | — | ~40 | — | ~40 | — | Mensajes en envelope `error.code` / `error.message`. |
| `api/whatsapp/**` (Meta + Evolution) | — | ~50 | — | ~40 | — | Mensajes específicos: `"WhatsApp not configured"`, `"Instance not connected."`, etc. |
| `api/automations/**`, `api/flows/**` | — | ~15 | — | ~10 | — | Errores de validación y CRON. |
| `api/ai/**` | — | ~15 | — | ~10 | — | `"No agent configured yet. Add your provider key in Setup."` |
| `join/[token]/**` | ~6 | ~6 | — | — | — | Página + redeem API. |
| `layout.tsx`, `page.tsx` | ~5 | — | — | — | — | Título marketing y redirect. |

### 3.3 `src/lib/` (resumen por subcarpeta)

| Subcarpeta | UI | API_ERR | USER | TECH | FP | Notas |
|---|---|---|---|---|---|---|
| `whatsapp/` | ~5 | ~60 | — | ~120 | — | Errores hacia Meta/Evolution, validadores de template, JID, encryption. |
| `api/v1/` | — | ~30 | — | ~20 | — | `respond.ts`, `pagination.ts`, validadores. |
| `webhooks/` | — | ~5 | — | ~15 | — | `events.ts`, `deliver.ts`, `ssrf.ts`, `sign.ts`. |
| `ai/` | ~10 | ~25 | — | ~30 | — | Prompts del sistema, errores de provider, embeddings. |
| `flows/`, `automations/` | ~10 | ~30 | — | ~30 | — | Validación y descripciones de nodos. |
| `contacts/`, `conversations/`, `inbox/`, `dashboard/` | ~5 | ~25 | — | ~20 | — | Mensajes para UI de inbox/contacts. |
| `media/`, `storage/`, `webhooks/`, `auth/`, `settings/` | — | ~15 | — | ~25 | — | Errores de subida y storage. |
| `ai/providers/{openai,anthropic,shared}.ts` | — | ~15 | — | ~10 | — | Mapeos a códigos de error. |
| `whatsapp/providers/{meta-adapter,evolution-adapter,errors,types,normalize,resolver,jid}.ts` | — | ~25 | — | ~60 | — | JID/E.164, headers, error codes. |

**Observación crítica**: el sistema de IA ya trabaja con un **catálogo de errores** propio (`AiError`, `ProviderError`, `TimeoutError`, `ApiError`, `CapabilityNotSupportedError`, `BroadcastError`, `ContactError`, `ContactTagWriteError`, `MediaResponseError`, `SendMessageError`, `UnauthorizedError`, `ForbiddenError`). Esto confirma el patrón **código → mensaje localizable** descrito en §7.

### 3.4 Hallazgos transversales relevantes

- **Literales sueltos no presentes en los `.json`**: `"Settings.whatsapp"`, `"Settings.sections"`, `"Settings.roles"`, `"Settings.profile"`, `"Settings.security"`, `"Settings.appearance"`, `"Settings.members"`, `"Settings.tagsAndFields"`, `"Settings.deals"`, `"Settings.overview"`, `"Settings.templates"`, `"Settings.invite"`, `"Settings.aiConfig"`, `"Settings.aiKnowledge"`, `"Settings.apiKeys"`, `"Settings.roles"`, `"Inbox.composer"`, `"Inbox.bubble"`, `"Inbox.conversationList"`, `"Inbox.messageThread"`, `"Inbox.sidebar"`, `"Inbox.aiBanner"`, `"Inbox.actions"`, `"Inbox.mediaViewer"`, `"Inbox.replyQuote"`, `"Inbox.sessionTimer"`, `"Inbox.templatePicker"`, `"Dashboard.emptyState"`, `"Dashboard.activityFeed"`, `"Dashboard.quickActions"`, `"Dashboard.responseTimeChart"`, `"Dashboard.conversationsChart"`, `"Dashboard.pipelineDonut"`, `"Flows.builder"`, `"Flows.builder.form"`, `"Flows.validation"`, `"Flows.editorState"`, `"Pipelines.board"`, `"Pipelines.card"`, `"Pipelines.form"`, `"Pipelines.settings"`, `"Pipelines.analytics"`, `"Automations.builder"`, `"Contacts.detailView"`, `"Contacts.form"`, `"Contacts.importModal"`, `"LoginPage"`, `"Broadcasts.page"`, `"Broadcasts.new"`, `"Broadcasts.detail"`, `"Broadcasts.status"`, `"Inbox.page"`, `"Dashboard.page"`, `"Pipelines.page"`, `"Automations.list"`, `"Automations.edit"`, `"Automations.logs"`, `"Flows.list"`, `"Flows.edit"`, `"Flows.logs"`, `"Contacts.page"`, `"AccountAccess"`. Aparecen como literales en componentes y páginas sin estar poblados en los `.json` actuales. **Acción**: durante la migración se debe decidir si se introducen como claves reales en los `.json` o si se eliminan (mapa de decisiones en §6).
- **Inconsistencias detectadas**:
  - `"Dashboard.activityFeed"` (componente) vs `"Dashboard.activityFeed"` (JSON, ¿poblada?).
  - Algunos `page.tsx` usan `getTranslations('namespace')` con namespaces tipo `"Broadcasts.detail"`.
- **Mensajes duplicados**: varios `"Unknown error"`, `"Failed to ..."` repetidos en varios componentes y route handlers.
- **Datos del usuario tratados como UI**: nombres como `"John Doe"`, `"Acme"`, `"Acme Corp"`, `"A123"`, `"B456"`, `"ORD-42"` en código son **placeholders/datos de demo** → categoría `USER`/`FP` (no traducir, pero deben ser revisados para que no aparezcan accidentalmente en producción como literales de UI).
- **Strings de error de Meta/Evolution/AI** que llegan al cliente en `error.message` se usan como fallback visible. Estos son `API_ERR` puros.

### 3.5 Inventario completo por archivo (muestra representativa)

> El inventario línea por línea de los 600+ archivos vive en la herramienta de auditoría interna (no se incluye en este doc para mantenerlo navegable). Cada migración por grupo (§8) se apoya en un `.audit.json` hermano con la lista exacta.

Ejemplos representativos por categoría:

- **UI**:
  - `src/components/inbox/message-composer.tsx`: placeholders del input, ARIA de botones, toasts de envío.
  - `src/components/settings/members-tab.tsx`: `"Invite member"`, `"Pending invitations"`, `"Failed to load invitations"`, `"Failed to revoke invitation"`, `"Failed to update role"`, `"Failed to remove member"`.
  - `src/app/(auth)/signup/page.tsx`: `"Create account"`, `"Creating account..."`, `"At least 6 characters"`, `"Passwords do not match"`, `"Sign up to join Acme"`.
  - `src/app/(dashboard)/inbox/page.tsx`: namespace `"Inbox.page"`.
- **API_ERR**:
  - `src/lib/api/v1/respond.ts` y route handlers: `"Invalid request body"`, `"Invalid JSON body."`, `"Forbidden"`, `"Unauthorized"`, `"Not found"`, `"Internal server error"`, `"Rate limit exceeded"`.
  - `src/lib/whatsapp/encryption.ts`: `"Failed to encrypt credentials. Check ENCRYPTION_KEY."`, `"Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables."`.
  - `src/app/api/whatsapp/*/route.ts`: `"WhatsApp not configured."`, `"Evolution instance is not connected"`, `"Instance not connected."`, `"Meta rate limit hit (100 template creates per hour). Try again later."`.
  - `src/app/api/ai/*/route.ts`: `"No agent configured yet. Add your provider key in Setup."`, `"The AI provider took too long to respond."`.
- **USER**:
  - Nombres de demo (`"John Doe"`, `"Acme"`, `"July promo"`), placeholders de campo (`"Option 1"`, `"Row 1"`, `"Choose me"`).
  - Mensajes simulados en tests (`"Hello there"`, `"Your order A123 ships on Friday"`).
- **TECH**:
  - Headers HTTP: `"Content-Type"`, `"Cache-Control"`, `"X-Wacrm-Signature"`, `"X-Wacrm-Webhook-Id"`, `"X-Wacrm-Event"`, `"Retry-After"`, `"Authorization"`, `"Bearer ..."`.
  - Códigos de estado de Meta/Evolution: `"APPROVED"`, `"PAUSED"`, `"PENDING"`, `"REJECTED"`, `"DRAFT"`, `"DELIVERED"`, `"READ"`, `"PENDING_DELETION"`, `"IN_APPEAL"`, `"DISABLED"`, `"PHONE_NUMBER"`, `"COPY_CODE"`, `"QUICK_REPLY"`, `"PERSONAL_CODE"`, `"YES_INTERESTED"`, `"STATIC"`, `"UTILITY"`, `"MARKETING"`, `"CONNECTION_UPDATE"`, `"QRCODE_UPDATED"`, `"MESSAGES_UPSERT"`, `"MESSAGES_UPDATE"`, `"SOMETHING_NEW"`.
  - MIME y constantes: `"IMAGE/JPEG"`, `"Bearer tok"`, `"META_APP_ID"`, `"WABA_1"`, `"PNID-1"`, `"PNID_123"`, `"TMPL_42"`, `"MSG-1"`, `"ORD-42"`, `"DEV-1"`, `"HIST-1"`, `"HANDLE123"`, `"HANDLE123"`.
  - Códigos de error: `"PGRST200"`, `"ECONNREFUSED"`, `"BAD-1"`, `"OWN-1"`, `"LID-1"`, `"APP1"`, `"NOT IN ALLOWED LIST"`, `"Two-factor authentication is not on..."`.
  - Tipos y nombres de archivo: `"README"`, `"RATE_LIMITS presets"`, `"SCOPE_DESCRIPTIONS"`, `"MESSAGES_UPDATE"`, `"MESSAGES_UPSERT"`, `"WHATSAPP-BAILEYS"`, `"MEDIA_MAX_BYTES_BY_KIND"`.
- **FP**:
  - Comentarios: bloques `//`, JSDoc, `// [CUSTOM:i18n start]` en `src/i18n/request.ts`.
  - `// Description` en `src/components/automations/automation-builder.tsx` y similares.
  - `src/lib/contacts/tag-events.ts` y otros: descripciones técnicas en `//` y nombres de keys como `"tag.added"`, `"tag.removed"`.
  - Strings en `*.test.ts(x)` (se asume i18n-tested aparte).
  - Prompts del sistema IA (`src/lib/ai/`) — no son UI, son instrucciones al modelo; categoría `TECH`.

---

## 4. Necesidades de formato

### 4.1 Interpolación ICU

Necesaria en mensajes que hoy son plantillas con `${value}`:

- Conteos: `"1 contact selected"`, `"3 conversations"`, `"X runs since activation"`.
- Tiempos: `"Updated 2 minutes ago"`, `"Active for HH:mm-HH:mm"`.
- Fechas: `"MMM d"`, `"MMM d, yyyy HH:mm"`, `"MMMM d, yyyy"`, `"HH:mm"`, `"HH:mm:ss"`, `"Apr 17"`.
- Errores con valores: `"Media download failed: 404"`, `"PNID-1"`, `"WABA_1"`, `"CAPABILITY_NOT_SUPPORTED"`.
- Sustituciones de nombre: `"Sign up to join Acme"`, `"Sign up to join {accountName}"`.
- PIDs/IDs: cualquier mensaje que incorpore un id externo.
- Mensajes de validación con campo: `"Button reply: every button needs a label."`.

### 4.2 Pluralización

Necesaria en cualquier string con sustantivo contable:

- Contactos / conversaciones / mensajes: `0`, `1`, `>1`.
- Miembros del equipo, invitaciones, API keys, webhooks.
- Respuestas, intentos, reintentos, ejecuciones de flow.
- Patrón recomendado: claves con sufijo `_one` / `_other` (next-intl lo soporta nativamente con ICU).

### 4.3 `t.raw()` y `t.rich()`

- **`t.raw()`** se necesita donde el valor traducido se pasa a un componente que no es texto plano: p. ej. dangerouslySetInnerHTML, inyección en un `<svg>`, o cadenas que son nombres de íconos.
- **`t.rich()`** se necesita donde la traducción incluye markup: enlaces internos, `**bold**`, `<Link>`, `<code>`, etiquetas, badges. Ejemplos detectados:
  - `"Privacy"` / `"Terms"` envueltos con `<Link>`.
  - Toasts que muestran un enlace al inbox/contacto.
  - Mensajes de error con un enlace a Settings: `"WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings."` → `t.rich('errors.whatsapp.wabaIdMissing', { link: (chunks) => <Link href="/settings">…</Link> })`.
  - Mensajes de validación que embeben un nombre de nodo: `"Collect-input must point to a next node."`.

---

## 5. Reglas para distinguir UI de datos

Criterio operativo que se aplicará durante la migración (y que debe validarse en PR review):

1. **Es UI** si el texto:
   - Aparece como literal dentro de JSX (`>`, `>{"…"}`).
   - Está en un prop visible: `placeholder`, `aria-label`, `aria-describedby`, `title`, `alt`, `label`, `description`, `toast`, `confirm`, `alertTitle`, `alertDescription`, `emptyState`.
   - Es la rama de un `error.message` que se muestra en un `<Alert>` o toast.
   - Es un fallback de un `catch (err)` que se renderiza.
2. **Es API_ERR** si:
   - Vive en un `route.ts`, `route.tsx`, `route.test.ts`, helper de respuesta, throw con `.message`, o en un `try { ... } catch (e) { return respond.error(..., e.message) }`.
   - Se transmite al cliente a través de `error.message` en el envelope estándar.
   - Acción: convertir a `code` + lookup en `messages/<locale>.json` en el cliente.
3. **Es USER** si:
   - Proviene de una prop cuyo valor llega del usuario (defaultValue, placeholder editable, contenido de textarea controlado).
   - Es un nombre, email, número de teléfono, texto de mensaje, valor de campo personalizado.
   - Aparece como string en `*.test.ts` con propósito de seed.
4. **Es TECH** si:
   - Es código HTTP, header, MIME, enum de estado, código de error externo, ID, JID, E.164, URL fija, slug de scope (`"messages:send"`), nombre de API (`"Content-Type"`, `"Authorization"`), nombre de archivo, regex, plantilla de path.
5. **Es FP** si:
   - Está en un comentario (`//` o `/* */`).
   - Está en `*.test.ts(x)` con fines de seed.
   - Es un nombre de variable / clave de objeto en `src/lib/` que coincide accidentalmente con la regex.
   - Es un prompt del sistema IA en `src/lib/ai/`.

Reglas de borde:

- `placeholder` y `aria-label` en componentes shadcn (`src/components/ui/**`) se conservan como están si son etiquetas de control estándar (cerrar, menú, etc.) y no se traducen salvo cambio explícito. **Decisión**: por defecto **no traducir** para mantener paridad con shadcn; documentar excepciones.
- Mensajes de error que contienen IDs (`"WABA_1"`, `"PNID-1"`) son **API_ERR con interpolación**; no mover el ID a la traducción.
- Strings que aparecen como literales sueltos sin estar pobladas en `.json` (ver §3.4) son **deuda técnica**: deben mapearse o eliminarse. Decisión por grupo en §6.

---

## 6. Namespaces propuestos

Alineados con la estructura de carpetas y las claves literales sueltas detectadas. **Objetivo**: un namespace por feature/componente principal, con sub-namespaces cuando el componente lo justifique.

| Namespace | Cubre |
|---|---|
| `Common` | cadenas reutilizables: `Cancel`, `Save`, `Delete`, `Loading...`, `Retry`, `Search...`, `Unknown error`, `Required`, `Optional`, etc. |
| `Auth.*` | login, signup, forgot password, layout de auth. |
| `Inbox.*` | composer, bubble, conversationList, messageThread, sidebar, aiBanner, actions, mediaViewer, replyQuote, sessionTimer, templatePicker, page. |
| `Contacts.*` | page, form, detailView, importModal, customFields. |
| `Pipelines.*` | page, board, card, form, analytics, settings. |
| `Broadcasts.*` | page, new, detail, status, wizard steps. |
| `Automations.*` | list, edit, logs, builder, descriptions de nodos. |
| `Flows.*` | list, edit, logs, builder, builder.form, validation, editorState, shared, descriptions de nodos. |
| `Dashboard.*` | page, activityFeed, conversationsChart, emptyState, pipelineDonut, quickActions, responseTimeChart, metricCard. |
| `Settings.*` | appearance, deals, members, profile, roles, security, sections, tagsAndFields, templates, whatsapp, evolution, aiConfig, aiKnowledge, apiKeys, sessions, invite, overview, quickReplies, customFields. |
| `Agents.*` | page, aiPlayground, aiUsage. |
| `Notifications.*` | page, toasts. |
| `Layout.*` | sidebar, header, accountAccessAlert, modeToggle. |
| `Errors.*` | códigos de error localizables (capa cliente, ver §7). |
| `ApiErrors.*` | mensajes derivados de `error.code` que viven en route handlers y se proyectan en UI. |
| `Validation.*` | validaciones de formulario y de nodes de flow/automation. |
| `Ai.*` | prompts y errores de IA que se muestran al usuario (no los prompts del sistema). |
| `Whatsapp.*` | estados de plantilla, modos de envío, mensajes de configuración. |
| `I18n.*` | selector de idioma, etiquetas de locale. |

**Reglas**:

- `Common.*` se reutiliza siempre que sea posible.
- Sub-namespace solo si el componente tiene ≥ 5–10 claves; en caso contrario vive en el namespace del feature.
- Los nombres literales sueltos del §3.4 que **no se correspondan con un namespace real** (p. ej. `"Broadcasts.wizard"`, `"Contacts.customFields"`, `"Settings.invite"`) deben o bien poblarse en `.json` o eliminarse.

**Decisión pendiente** (a confirmar antes de la fase 1): para los literales sueltos sin población, ¿se introducen como claves reales (`"namespace.thing": "..."` en los 3 `.json`) o se asume que son placeholders olvidados y se eliminan en el mismo PR que cierra la migración de cada componente? Recomendación: **introducir como claves reales con texto en inglés**, dejar que `es` y `ko` se traduzcan en otra pasada, para no perderlas.

---

## 7. Estrategia para errores de API

**Patrón actual**: route handlers devuelven un envelope `{ data }` / `{ error: { code, message } }` (visto en `src/lib/api/v1/respond.ts`). El `message` está hoy **en inglés en duro** y se renderiza tal cual en cliente.

**Patrón objetivo**:

1. **Servidor** devuelve `error.code` (string estable, p. ej. `"whatsapp_not_configured"`, `"instance_not_connected"`, `"meta_rate_limit"`, `"ai_provider_timeout"`, `"evolution_send_failed"`).
2. **Servidor** puede seguir adjuntando `error.message` con fines de debug/log, pero **no se debe renderizar directamente** en UI.
3. **Cliente** mantiene un mapa de códigos en un helper (`src/features/i18n/api-errors.ts` o similar):

   ```ts
   const messages = {
     whatsapp_not_configured: 'Errors.apiErrors.whatsappNotConfigured',
     instance_not_connected: 'Errors.apiErrors.instanceNotConnected',
     // ...
   };
   ```

4. Cada componente que reciba un error de API:
   - Lee `error.code`.
   - Si hay traducción en el mapa → `t(messages[code])`.
   - Si no → fallback a `t('Common.unknownError')` y log del code en consola (server-side) o telemetría.
5. Para mensajes que **necesariamente** contienen datos del usuario (IDs, nombres), el `code` admite `params` (array) o se complementa con `error.params` que el cliente interpola con `t(key, params)`.

**Catálogo inicial de codes** (extraído del inventario de §3):

- `whatsapp_not_configured`, `whatsapp_not_connected`, `instance_not_connected`, `meta_rate_limit`, `meta_phone_number_missing`, `waba_id_missing`, `waba_no_subscribed_apps`.
- `evolution_not_configured`, `evolution_send_failed`, `evolution_qr_unavailable`, `evolution_create_failed`, `evolution_invalid_url`.
- `ai_not_configured`, `ai_provider_timeout`, `ai_provider_error`, `ai_empty_response`.
- `template_invalid`, `template_not_found`, `template_submit_failed`, `template_meta_modified`.
- `automation_invalid`, `flow_invalid`, `flow_not_found`.
- `invite_not_found`, `invite_expired`, `invite_already_used`.
- `api_key_not_found`, `webhook_not_found`, `broadcast_not_found`, `contact_not_found`, `conversation_not_found`, `message_not_found`.
- `unauthorized`, `forbidden`, `not_found`, `internal_server_error`, `invalid_request_body`, `invalid_json`, `rate_limit_exceeded`.
- `encryption_failed`, `signature_invalid`, `token_mismatch`.
- `permission_denied` (RBAC, role), `insufficient_role`.

**Migración**: introducir el helper + catálogo en `src/features/i18n/api-errors.ts`; poblar `Errors.apiErrors.*` en los tres `.json`; reemplazar progresivamente los `error.message` server-side por `error.code`.

---

## 8. Estrategia de migración por grupos

Orden recomendado. Cada grupo es un PR con:

- Cambios solo en sus archivos.
- Tests nuevos si la lógica cambia.
- Validación: `npm run typecheck && npm run lint && npm test`.
- Criterio de aceptación del grupo (§11) firmado en la descripción.

**Grupo 0 — Cimientos** (1 PR, sin tocar features):

- Crear `src/features/i18n/api-errors.ts` con el catálogo inicial de `code → key`.
- Definir helper `useApiErrorMessage()` y `translateApiError(code, params)`.
- Definir `src/lib/api/v1/respond.ts` variante `respond.errorCode(code, status, params?)` que **no adjunte** `message` salvo en dev.
- Documentar en `AGENTS.md` la regla "no se renderiza `error.message` directo en UI".
- Añadir tests: `api-errors.test.ts` (snapshot de codes, fallback).
- **Aceptación**: helper listo, ningún cambio visible todavía.

**Grupo 1 — `Common` + `Layout` + `I18n`**:

- Cargar `Common.*` (botones, acciones, loading, errores genéricos).
- Cargar `Layout.*` (sidebar, header, accountAccessAlert, modeToggle).
- Cargar `I18n.*` (locale switcher).
- **Aceptación**: 100% de strings de layout y common son traducibles; ya no hay hardcoded en esos archivos.

**Grupo 2 — `Auth.*`**:

- Login, signup, forgot-password, layout `(auth)`.
- Errores de auth en route handlers → codes.
- **Aceptación**: flujos de auth funcionan en `en`/`es`/`ko` con la misma UX.

**Grupo 3 — `Dashboard.*`**:

- Métricas, charts, empty state, activity feed, quick actions.
- **Aceptación**: dashboard navegable 100% traducido.

**Grupo 4 — `Inbox.*`**:

- Composer, message thread, conversation list, bubble, media viewer, reply quote, AI banner, template picker, session timer, sidebar.
- Errores de `inbox/*` API → codes.
- **Aceptación**: enviar y recibir mensajes, abrir hilos, toasts y empty states totalmente localizados.

**Grupo 5 — `Contacts.*`**:

- Page, form, detail view, import modal, custom fields.
- Errores de `contacts/*` API → codes.
- **Aceptación**: crear, importar, editar contacto localizado.

**Grupo 6 — `Pipelines.*`**:

- Page, board, card, form, analytics, settings.
- **Aceptación**: drag-and-drop, creación de deal, mover entre etapas, todo localizado.

**Grupo 7 — `Broadcasts.*`**:

- Page, new (wizard 1–4), detail, status.
- Errores de broadcast + meta rate limit → codes.
- **Aceptación**: lanzar un broadcast de prueba, leer estados, toasts localizados.

**Grupo 8 — `Automations.*`**:

- List, edit, logs, builder, descripciones de nodos.
- Errores de `automations/*` API → codes.
- Validaciones de `automations/validate.ts` → `Validation.*`.
- **Aceptación**: crear y activar una automation localizada.

**Grupo 9 — `Flows.*`**:

- List, edit, logs, builder, header, validation panel, forms.
- Errores y validaciones → codes + `Validation.*`.
- Descripciones de cada tipo de nodo.
- **Aceptación**: editor de flows + ejecución localizados.

**Grupo 10 — `Agents.*` + `Notifications.*` + `Ai.*`**:

- AI playground, usage, página de agents, notifications.
- Toasts del sistema de IA.
- **Aceptación**: probar IA (si hay provider configurado) y leer toasts localizados.

**Grupo 11 — `Settings.*`** (el más grande, dividir en 2–3 sub-PRs):

- 11a: `appearance`, `profile`, `security`, `sessions`.
- 11b: `members`, `invite`, `roles`.
- 11c: `tagsAndFields`, `customFields`, `templates`, `whatsapp`, `evolution`, `aiConfig`, `aiKnowledge`, `apiKeys`, `deals`, `quickReplies`, `overview`, `sections`, `settings-rail`, `password-form`.
- **Aceptación**: todas las pantallas de settings navegables en 3 idiomas.

**Grupo 12 — Limpieza y endurecimiento**:

- Eliminar literales sueltos del §3.4 que no se hayan poblado.
- Consolidar duplicados (`"Unknown error"`, `"Failed to ..."`).
- Revisar `shadcn/ui` para excepciones documentadas.
- Lint rule o script que detecte strings JSX en `src/components` y `src/app` fuera de un whitelist (no obligatorio en esta fase, propuesto para v2).
- **Aceptación**: grep de patrones de UI no encuentra literales nuevos.

**Reglas para los PRs**:

- Sin PR mezcla grupos. Excepción: el Grupo 0 puede ser PR aparte.
- Cada PR añade un changeset con un resumen del grupo.
- No se modifica la API pública de wacrm en esta fase.

---

## 9. Estrategia de pruebas

**Tests existentes**: Vitest 4.x, entorno Node. ~79 archivos `*.test.ts(x)`.

**Por añadir / adaptar**:

- **`api-errors.test.ts`** (Grupo 0): verifica el mapeo `code → key`, fallback a `Common.unknownError`, soporte de `params`.
- **Snapshot por locale**: para `Common`, `Layout`, `I18n`, y cada namespace de feature, un test que renderice los componentes principales con `NextIntlClientProvider` y `locale="es"` y `locale="ko"`, y compare con snapshot. Ubicación sugerida: `src/components/<feature>/__i18n__/*.test.tsx`.
- **Cobertura de interpolación**: tests con `params` para casos con IDs, conteos, fechas.
- **Cobertura de pluralización**: tests con `count={0}`, `count={1}`, `count={5}`.
- **Cobertura de `t.rich()`**: tests que verifiquen que el markup se preserva (link, code, bold).
- **Reglas de regresión**:
  - `src/i18n/icu-safety.test.ts` ya existe → extender.
  - `src/i18n/messages.test.ts` ya existe → extender con aserciones de simetría entre los 3 `.json` (mismas claves en los tres).
- **Lint / script de auditoría**:
  - `scripts/i18n-audit.mjs` (nuevo, opcional, recomendado): escanea `src/components` y `src/app` y reporta strings candidatos no migrados; CI falla si sube el contador. Se activa opcionalmente en `.github/workflows/ci.yml`.

**Comando de verificación local**:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- (cuando se introduzca) `npm run i18n:audit` o `node scripts/i18n-audit.mjs`.

---

## 10. Riesgos

1. **Regresiones visuales y de UX**: cambiar literales puede afectar layouts si las traducciones son más largas que el original. **Mitigación**: pruebas snapshot + revisión manual de `es` y `ko` en flujos críticos en cada PR.
2. **Prompts del sistema IA** (`src/lib/ai/`): si se traducen, el modelo puede comportarse de forma distinta. **Decisión**: no traducir prompts; siguen en inglés por diseño. Documentar.
3. **Errores de Meta/Evolution/Supabase** que llegan en `error.message` ya traducidos al español por el proveedor: si el cliente los usa como fallback directo, el usuario verá español cuando el resto esté en inglés. **Mitigación**: el helper de §7 siempre traduce por code; `error.message` no se renderiza.
4. **Cambio de API interna de route handlers** (Grupo 0): si se introduce `respond.errorCode(...)` sin mantener compatibilidad, los consumidores existentes rompen. **Mitigación**: introducir `errorCode` como método nuevo, mantener `error` con deprecation warning, migrar consumidores en los grupos 1–12.
5. **Cobertura de claves asimétrica entre `en`/`es`/`ko`**: la app ya soporta 3 locales; si un grupo añade claves a `en` y olvida `es` o `ko`, el fallback a `en` enmascara la regresión. **Mitigación**: test de simetría + CI.
6. **Componentes shadcn**: traducirlos rompe la paridad con el upstream y dificulta merges futuros. **Mitigación**: política de no traducir `src/components/ui/**` salvo que exista justificación explícita.
7. **Densidad de literales sueltos** en componentes (ver §3.4): si no se cierran, queda un híbrido. **Mitigación**: incluirlos en el Grupo 1 (decisión de poblar o eliminar).
8. **Componentes con `'use client'` vs. server components**: API de `next-intl` cambia (`getTranslations` server vs. `useTranslations` cliente). **Mitigación**: helper único que detecte el entorno; en cada PR verificar que el árbol de traducciones se importa correctamente.
9. **Tamaño de los `.json`**: ya están en 78–90 KB. Añadir 600+ claves más los llevará a 150–200 KB. **Mitigación**: namespaces modulares + lazy load por namespace (next-intl lo soporta).
10. **Tests existentes** que asumen mensajes en inglés literal. **Mitigación**: identificarlos y migrarlos junto con el grupo.

---

## 11. Criterios de aceptación

**Globales** (al cerrar el plan):

- Cero literales de UI (`>`, `placeholder`, `aria-label`, `title`, `alt`, `label`, `description`, `toast`, `confirm`, mensajes de error mostrados al usuario) en `src/components/**` y `src/app/**`, salvo:
  - `src/components/ui/**` (shadcn).
  - `src/components/i18n/**` (intencional, sin cambios).
  - Comentarios y strings `TECH`/`USER`/`FP` clasificados en §3.
- Cero `error.message` renderizado directamente al usuario en `src/components/**` y `src/app/**`; todos pasan por el helper de §7.
- Los tres `messages/{en,es,ko}.json` contienen las mismas claves (validado por test de simetría).
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` pasan.
- Auditoría (§3) revisada y firmada.

**Por grupo**: ver bloque "Aceptación" en §8.

**No-objetivos explícitos**:

- Traducir prompts del sistema IA.
- Traducir `src/components/ui/**` (shadcn) salvo justificación.
- Traducir comentarios, nombres de variables, identificadores técnicos.
- Reescribir la API pública (`/api/v1`) en este ciclo (solo `error.code` y eliminación de `error.message` en UI cliente).
- Cambiar la base de datos ni las migraciones.

---

## 12. Anexo — artefactos a crear

- `docs/i18n/localization-audit.md` (este archivo).
- `docs/i18n/api-error-codes.md` (catálogo de codes; tras el Grupo 0).
- `docs/i18n/namespaces.md` (mapa namespace → archivos; tras el Grupo 1).
- `scripts/i18n-audit.mjs` (opcional, tras el Grupo 12).
- Por grupo: `src/<feature>/__i18n__/*.test.tsx` (snapshots de i18n).

---

**Pendiente de aprobación explícita del usuario antes de iniciar la fase de implementación.**
