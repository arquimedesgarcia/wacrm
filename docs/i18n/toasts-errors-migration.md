# Migración de toasts, confirmaciones y errores visibles — especificación

> Estado: propuesta. No aplicar hasta confirmación explícita.
> Complementa: `docs/i18n/localization-audit.md` (auditoría general) y `docs/i18n/spec-settings-whatsapp-localization.md` (grupo ya migrado).

## 1. Objetivo

Eliminar mensajes fijos en inglés en: `toast.*`, `window.confirm()`, fallbacks `data.error ?? "literal"`, errores devueltos por API routes internas y validaciones visibles. Dos tipos de solución:

- **A. Texto de interfaz** — cadenas UI propias del cliente:
  ```tsx
  toast.error(t('saveFailed'));
  ```
- **B. Errores de API** — códigos estables en el servidor, mensaje localizado en el cliente:
  ```ts
  // servidor: respond.errorCode('save_failed', 500);
  // cliente:
  toast.error(tError(code, params));
  ```

## 2. Estado actual (resumen de auditoría)

- Patrón canónico ya establecido: catálogo en `src/features/i18n/api-errors.ts` (~163 códigos), helper `useApiError()` / `tError(code, params)` con namespace raíz `Errors.apiErrors`, y `respond.errorCode(code, status, { params })` en rutas.
- Ya migrados: `api/whatsapp/config`, `api/whatsapp/evolution/config`, `api/whatsapp/evolution/import`, todo `api/v1/**`, y los paneles `whatsapp-config.tsx` / `evolution-config-panel.tsx`.
- `useApiError()` solo se usa hoy en 2 componentes — la adopción del catálogo es la excepción, no la regla.

## 3. Inventario de hallazgos

### 3.1 Archivos auditados del pedido — completamente sin migrar

| Archivo | Cadenas | Tipos |
|---|---|---|
| `src/app/join/[token]/page.tsx` | ~25 | toasts (success/error), fallbacks `payload.error \|\| 'literal'`, confirmaciones implícitas, loading (`'Verifying invitation…'`), modal de conflicto 409, UI de invitación, `FAIL_COPY`, `ROLE_LABEL` |
| `src/components/agents/ai-usage.tsx` | ~20 | toasts + fallback `json?.error ?? 'Failed to load usage'`, labels, empty state, plural inline `call/calls` |
| `src/components/agents/ai-playground.tsx` | ~14 | toasts ×3, fallback `data.error ??`, título, instrucciones, placeholder, loading (`'Thinking…'`) |
| `src/components/settings/quick-replies-manager.tsx` | ~20 | `window.confirm("Delete this quick reply?")`, validación, success ×2, fallbacks, labels, placeholders, empty state, tabs |
| `src/components/settings/whatsapp-config.tsx` | 2 restos | `AlertTitle` token corrupto (L547); placeholders de ejemplo de IDs (L710/720) |
| `src/components/settings/evolution-config-panel.tsx` | passthroughs | `data.message \|\| t(...)` ×3 (mensaje crudo del servidor cuando no hay `code`) |
| `src/components/settings/template-manager.tsx` | 4 | fallbacks HTTP: `` `Edit/Submit failed (HTTP ${status})` ``, `Sync failed`, `Delete failed`, sufijo `+N more` concatenado |

### 3.2 Archivos auditados del pedido — migración parcial

| Archivo | Restos |
|---|---|
| `src/components/flows/flow-editor-state.tsx` | `json.error ?? \`Save failed: ${status}\``, `Status update failed`, `window.confirm(\`Delete "…"?\`)`, `Delete failed` (~7 cadenas) |
| `src/components/flows/forms/node-config-form.tsx` | `label="Body text"` y `placeholder="Pick a tag…"` ×2 con claves **ya existentes** sin usar; `File is X MB — limit is 16 MB`, `File uploaded.`, `Upload failed.` |
| `src/components/contacts/import-modal.tsx` | `throw new Error('Not authenticated')` / `('Your profile is not linked to an account.')` propagados a toast vía `err.message`; `(+N more)` concatenado a mano |
| `src/app/(dashboard)/notifications/page.tsx` | toasts ×2, título, aria-labels, empty state, botones |

### 3.3 Hallazgos fuera de la lista del pedido (mismo patrón, misma causa)

- `src/components/inbox/message-thread.tsx` — `` `Failed to send: ${reason}` `` ×6, template ×2, `"Wait for the message to finish sending"`, `Reaction failed: ${reason}`, `Failed to update assignment`.
- `src/components/inbox/message-composer.tsx` — toasts AI ×3 + fallback; voz: `"Recording is too long…"`, `"Voice recording isn't supported…"`, `"Microphone access denied…"`.
- `src/components/settings/members-tab.tsx` — `'Could not reach the server'` ×4; `invite-member-dialog.tsx` ×1.
- `src/app/(dashboard)/flows/page.tsx` — `Clone failed: ${status}`.
- `src/hooks/use-broadcast-sending.ts` — `throw new Error(...)` EN ×12 (varios se **persisten en DB** y se releen en toasts/CSV en otras sesiones).
- `src/lib/whatsapp/template-validators.ts` — ×15 errores de validación EN que se muestran en template-manager.
- `src/lib/contacts/tag-api.ts` — `throw new Error(body.error ?? 'Failed to update contact tag')`.

### 3.4 API routes internas devolviendo `{ error: "inglés" }` sin código

Sin migrar (~90 mensajes en ~30 archivos). Las rutas AI (`ai/usage`, `ai/playground`, `ai/test`, `ai/draft`, `ai/config`, `ai/knowledge/*`, `ai/autoreply/*`) alimentan componentes ya listados arriba. Resto: `account/*` (route, members, invitations, api-keys, transfer-ownership), `automations/*`, `flows/*`, `quick-replies/*`, `invitations/[token]/redeem`, `contacts/[id]/tags`, `whatsapp/send|react|templates/*|media/*|broadcast*`.

Patrones repetidos: `'Unauthorized'` ×~20, `'Not found'` ×~10, `'Invalid JSON'` ×~8, `'Your profile is not linked to an account.'` ×~6, `'* is required'` ×~15. Varios códigos ya existen en el catálogo sin usarse (`usage_load_failed`, `ai_config_*_failed`, `role_update_failed`, `member_remove_failed`…).

Excluidas: webhooks Meta/Evolution (consumo técnico, no UI).

## 4. Decisiones de diseño

### 4.1 Regla de clasificación

1. **A** — mensajes que el cliente genera por sí mismo (estados de carga, éxito, validación de formulario, `window.confirm`, fallbacks sin servidor) → `t('<Ns>.<clave>')`.
2. **B** — mensajes originados en el servidor → la ruta emite `respond.errorCode(code, status, { params? })` y el cliente hace `toast.error(tError(code, params))`.
3. Passthroughs `data.message ?? t('fallback')` → **eliminar el passthrough**: cuando la API emita códigos, el fallback localizado siempre gana; el `message` crudo solo se conserva en consola/diagnóstico.
4. Texto de contenido enviado por WhatsApp (defaults del bot: `"Yes"`, `"Option 1"`, `"View options"`) → **fuera de alcance**; se persiste y se envía al cliente final. Decisión de producto aparte.

### 4.2 Códigos nuevos requeridos (catálogo `Errors.apiErrors`)

`unauthorized`, `not_found`, `invalid_json`, `invalid_request_body`, `account_not_linked`, `account_name_empty`, `account_name_too_long`, `conversation_not_found`, `contact_not_found`, `quick_reply_save_failed`, `quick_reply_delete_failed`, `notification_read_failed`, `notification_read_all_failed`, `invitation_redeem_failed`, `invitation_conflict`, `member_load_failed`, `invitation_load_failed`, `invitation_create_failed`, `api_key_load_failed`, `api_key_create_failed`, `api_key_revoke_failed`, `usage_load_failed`, `template_*_failed`, `media_fetch_failed`, `send_failed`, `react_failed`, `ai_draft_failed`, `knowledge_*_failed`, `automation_*_failed`, `flow_*_failed` (solo los que no existan ya; reutilizar los ~163 existentes primero).

### 4.3 Namespaces de diccionario nuevos/a ampliar

- `Join.*` (página join completa: estados de fallo, invitación, conflicto 409, toasts)
- `Agents.usage`, `Agents.playground`
- `Settings.quickReplies` (de string suelto a namespace de objeto)
- `Settings.notifications` o `Notifications.*` (página notifications)
- Ampliar: `Flows.editorState`, `Flows.builder.form`, `Inbox.composer`, `Inbox.messageThread`, `Contacts.importModal`, `Settings.members`, `Settings.invite`, `Settings.templates`
- Errores de lib compartidos → códigos del catálogo (`Errors.apiErrors`), no namespaces de UI.

### 4.4 Formato

- Interpolación ICU: todas las cadenas con variables (`{name}`, `{count}`, `{status}`), incl. confirmaciones con nombre de entidad.
- Pluralización ICU nativa: `call/calls` (ai-usage), `+N more` (reemplazar concatenación manual), `runs`/`step` pendientes de grupos anteriores.
- `t.rich()`: solo donde ya se usa (hints con HTML en settings); ningún caso nuevo requerido.

## 5. Estrategia de migración por grupos (orden propuesto)

- **Grupo 1 — API AI + componentes de agents**: rutas `ai/*` a `errorCode()` + `ai-usage`/`ai-playground` a `useTranslations`/`useApiError`. Desbloquea los dos componentes y cierra el área AI.
- **Grupo 2 — Quick replies + join + notifications**: cliente completo de los 3 archivos sin migrar + rutas `quick-replies/*`, `invitations/[token]/redeem`.
- **Grupo 3 — Residuos de flows/contacts**: `flow-editor-state`, `node-config-form` (activar claves existentes), `import-modal` (errores → códigos), `notifications` incluido aquí si no va en G2.
- **Grupo 4 — Inbox (message-thread, message-composer) + settings (members-tab, invite-member-dialog, template-manager, whatsapp-config restos)**.
- **Grupo 5 — API restantes (account/*, automations/*, flows/*, whatsapp send/react/templates/media/broadcast)**: rutas con mayor repetición de `'Unauthorized'`/`'Not found'`; migración mecánica reutilizando códigos.
- **Grupo 6 — lib**: `template-validators`, `use-broadcast-sending` (persistir **código estable** en `broadcast_recipients.error_message`, no texto; traducir en render), `tag-api`, `upload-media`.

## 6. Estrategia de pruebas

- `src/features/i18n/api-errors.test.ts`: añadir aserciones de los códigos nuevos (en/es/ko).
- `src/i18n/messages.test.ts`: paridad de claves — ya cubre los namespaces nuevos automáticamente.
- Tests unitarios de validación de templates: actualizar expectativas de `template-validators` a códigos.
- Verificación manual por grupo: cambiar idioma en UI y recorrer flujos con toasts forzados (éxito, error, confirm, red caída).
- `npm run typecheck`, `npm run lint`, `npm test` por grupo.

## 7. Riesgos

- **Persistencia de errores en DB** (`use-broadcast-sending`): cambiar a códigos requiere backfill o lectura tolerante de mensajes legacy. Mitigación: lookup por código con fallback al crudo.
- **Passthroughs eliminados**: si alguna ruta queda sin migrar dentro del alcance, el usuario perderá el mensaje detallado. Mitigación: orden API-antes-que-cliente dentro de cada grupo.
- **Duplicación de claves**: los fallbacks HTTP `(HTTP ${status})` de varios componentes colapsan en un solo código con `{status}` — revisar que no choquen con claves existentes.
- **Tests de terceros**: los 5 fallos preexistentes en `currency.test.ts`/`date-utils.test.ts` son ajenos; no deben mezclarse con este trabajo.

## 8. Criterios de aceptación

1. Cero `toast.*("literal en inglés")` y cero `window.confirm("literal")` en los archivos del §3.1–3.3 (salvo comentarios y valores técnicos).
2. Cero rutas API internas (§3.4) devolviendo `{ error: string }` sin `code` (webhooks Meta/Evolution excluidos).
3. Cero passthroughs `data.message ?? t(...)` en componentes migrados.
4. Paridad en/es/ko verde; tests del catálogo verdes; typecheck/lint verdes.
5. Errores persistidos en DB almacenan código estable, no texto localizado.
