# spec-settings-whatsapp-localization.md

Status: **draft, pending approval**. No code changes will be made until the user explicitly authorises them.

Scope: Settings → WhatsApp (Meta Cloud API + Evolution API) configuration UI, the settings rail/overview chrome that wraps it, the two API route handlers behind it, and the related catalogue entries.

---

## 1. Goal

Convert every user-facing string in the WhatsApp configuration flow into stable `next-intl` keys so that all three supported locales (`en`, `es`, `ko`) render the same UI and the same error messages, and so that new error responses from the server travel as **stable codes** that the client translates by catalogue instead of leaking raw English text into toasts/alerts.

Out of scope (intentionally):

- `src/components/ui/**` shadcn primitives are not translated (project convention).
- AI prompts in `src/lib/ai/**` are not translated (project convention).
- Brand names, API names, instance names, URLs, env vars, codes, secrets, technical identifiers, user-entered values.
- Translation of `messages/{en,es,ko}.json` content itself — only key additions and `en` source-of-truth values are authored here. `es` and `ko` must be produced (or pass through to a translator) to keep parity tests green.

---

## 2. Files in scope

UI components:
- `src/components/settings/whatsapp-config.tsx`
- `src/components/settings/evolution-config-panel.tsx`
- `src/components/settings/settings-overview.tsx`
- `src/components/settings/settings-rail.tsx`

Library helper:
- `src/lib/settings/whatsapp-summary.ts` (no UI strings — only column-derivation logic; explicitly confirmed, nothing to localise)

Route handlers:
- `src/app/api/whatsapp/config/route.ts` (Meta)
- `src/app/api/whatsapp/evolution/config/route.ts` (Evolution)
- `src/app/api/whatsapp/evolution/import/route.ts` (Evolution import)

Translation dictionaries:
- `messages/en.json` (source of truth; new keys land here)
- `messages/es.json`, `messages/ko.json` (must mirror every new key)

Localisation infrastructure reused as-is:
- `src/features/i18n/api-errors.ts` — catalogue of `API_ERROR_CODES`, `apiErrorKey(code)`.
- `src/features/i18n/use-api-error.ts` — client hook returning `tError(code, params?)`.
- `src/features/i18n/get-api-error.ts` — server-side equivalent for RSC/routes that need a translated string in HTML.
- `src/i18n/messages.test.ts` — parity test that will fail if `en` gains a key not present in `es`/`ko`.
- `src/i18n/icu-safety.test.ts` — ICU MessageFormat safety test.

---

## 3. Inventory of texts

### 3.1 `whatsapp-config.tsx` (Meta provider UI)

| Kind | Source location (approx.) | Current text (en) | Notes |
| --- | --- | --- | --- |
| Toast error | `fetchConfig` catch | `"Failed to load WhatsApp configuration"` | client-only |
| Toast error | `handleSave` validation | `"Phone Number ID is required"` | client-only |
| Toast error | `handleSave` validation | `"Access Token is required for initial setup"` | client-only |
| Toast error | `handleSave` guard | `"Please re-enter the Access Token to save changes"` | client-only |
| Toast error | generic | `"Failed to save configuration"` | client-only |
| Toast error | generic | `"Failed to reset configuration"` | client-only |
| Toast success | reset | `"Configuration cleared. You can now re-enter your credentials."` | client-only |
| Toast success | save | `"Credentials saved and verified. Inbound registration was skipped (no PIN) — see Registration status below."` | long, ICU-safe |
| Toast success | save (verified_name branch) | `"Live — {name} can now receive events."` | ICU `{name}` |
| Toast success | save | `"WhatsApp connected. Events will start flowing within a minute."` | |
| Toast error | save | `"Saved, but Meta couldn't register the number: {msg}"` | ICU `{msg}` |
| Toast success | test | `"Connected to {name}"` / `"API connection successful"` | ICU `{name}` |
| Toast error | test | `"API connection failed"` / `payload.message` (server text → replaced by code catalogue) | server message → code |
| Toast error | test catch | `"Connection test failed. Check network and try again."` | |
| Toast success | verify-registration | `"Number is fully wired — Meta is delivering events."` | |
| Toast error | verify-registration | `"Number is not fully registered. See the checks below for which step failed."` | |
| Toast error | verify-registration catch | `"Could not reach the verification endpoint."` | |
| Confirm dialog | `handleReset` | `"This will delete the current WhatsApp config so you can re-enter it. Continue?"` | |
| Toast success | copy webhook | `"Webhook URL copied to clipboard"` | |
| Provider card title | static JSX | `"WhatsApp Provider"` | |
| Provider card desc | static JSX | `"Choose the WhatsApp connection method for this account."` | |
| Provider button labels | static JSX | `"Meta Cloud API"`, `"Evolution API"` | brand-ish but should be localisable |
| Provider warning | static JSX | `"Evolution API uses WhatsApp Web / Baileys and is intended for testing. It does not support templates or interactive messages."` | |
| Banner title | reset banner | `"Stored token can't be decrypted"` (already `t('tokenCorrupted')`) | already keyed |
| Field labels | static JSX | placeholders `e.g. 100234567890123`, `e.g. 100234567890456` are sample IDs → not translated, but the `aria-label`/`Label` content is | |
| Mirror switch | static JSX | `aria-label={t('mirrorInbound')}` already keyed | keep |
| Steps 1–4 | already keyed (`step1`…`step4_5`, `metaDocs`) | en source kept | keep, ensure ICU-safe |

### 3.2 `evolution-config-panel.tsx` (Evolution provider UI)

Mostly hardcoded English. Needs a dedicated namespace.

Strings to localise (all client-only unless noted):

- Provider banners: `"Experimental provider"`, banner body, `"Evolution API notice"`, notice body.
- Status card title/desc: `"Connected"` / `"Not connected"` / `"Evolution instance is connected."` / `"Configure and save to connect."`.
- QR card: `"Pairing QR Code"`, QR description, `alt="Evolution pairing QR"`.
- Credentials card: `"Evolution API Credentials"`, `"Connect to a self-hosted Evolution API v2.3.7+ instance."`, labels (`Base URL`, `Instance Name`, `API Key`, `Webhook Secret`), placeholder for API key (`"Evolution API key"`), placeholder for secret (`"Secret Evolution sends in webhooks"`), helper `"Required. WaCRM will configure Evolution to send this value in the apikey header."`, checkbox label `"Create instance if it does not exist"`.
- Webhook card: title/desc + label `Webhook URL`.
- Buttons: `Saving…`, `Save Configuration`, `Testing…`, `Test Connection`, `Importing…`, `Import history`, `Resetting…`, `Reset`.
- Toasts: `Base URL and Instance Name are required`, `API Key is required for initial setup`, `Webhook Secret is required for initial setup`, `Please re-enter the API Key to save changes`, `Webhook Secret is required`, `Failed to save Evolution configuration`, `Configuration saved. Scan the QR code with WhatsApp.`, `Evolution instance connected.`, `Configuration saved, but instance is not connected yet.`, `Evolution configuration cleared.`, `Failed to reset configuration`, `Failed to start historical import`, `Historical import started in the background.`, `Historical import started in the background. Contacts and messages will appear shortly.`, `Webhook URL copied to clipboard`, `Connection test failed.`
- Inline banner `importMessage` text: same as above long-form.

### 3.3 `settings-overview.tsx`

Already localised via `Settings.overview.*` keys. Inventory confirms:
- `notSetup`, `connected`, `needsReconnecting`, `loading`, `viewTeamMembers`, `membersCount`, `pendingInvites`, `manageTemplates`, `templatesCount`, `pendingReview`, `tagsCount`, `fieldsCount`, `tagsAndFields`, `appearance`, `yourAccount`.

No new keys needed here for the WhatsApp scope. The `WhatsApp Provider` tile reuses existing `Settings.sections.whatsapp` and `Settings.overview.connected`/`needsReconnecting`/`notSetup`. **No code change** for this file unless a literal sneaks in — confirmed clean in current revision.

### 3.4 `settings-rail.tsx`

Already localised. Uses `Settings.groups.<group>` and `Settings.sections.<s>` plus a hardcoded `aria-label="Settings sections"` on the `<nav>` element.

Action: extract the `aria-label` to `Settings.railAriaLabel` (new key) for parity.

### 3.5 Route handlers — error messages

All three handlers emit raw English strings in `error.message`. The wire protocol change is:

> From: `{ error: "Plain English string" }`
> To:   `{ error: { code: "<stable_code>", message?: "<english fallback for logs>", params?: {...} } }`

Dashboard code must NEVER render `error.message`; it must call `useApiError()` / `getApiErrorMessage()` keyed on `code`.

#### 3.5.1 `src/app/api/whatsapp/config/route.ts`

| HTTP | Current `error.message` | Proposed `code` | New / existing catalogue? |
| --- | --- | --- | --- |
| 401 | `"Unauthorized"` | `unauthorized` | existing |
| 200 (no_account) | `"Your profile is not linked to an account."` | `profile_no_account` | **new** |
| 200 (db_error) | `"Failed to fetch configuration"` | `config_load_failed` | existing |
| 200 (no_config) | `"No WhatsApp configuration saved yet. Fill in the form and click Save Configuration."` | `whatsapp_not_configured` | existing |
| 200 (token_corrupted) | long token-corruption hint | `config_encryption_corrupt` | existing |
| 200 (meta_api_error) | `"Meta API rejected the credentials: {msg}"` | `meta_api_error` (new) **or** generic `config_validate_failed` | **new code** preferred for specificity |
| 200 (unknown) | `"Internal server error"` | `internal` | existing |
| 400 (missing fields) | `"access_token and phone_number_id are required"` | `config_validate_failed` | existing |
| 400 (PIN) | `"PIN must be exactly 6 digits."` | `pin_invalid` (new) | **new** |
| 409 (phone conflict) | long string about another account | `whatsapp_phone_number_already_linked` (new) | **new** |
| 400 (save meta error) | `"Meta API error: {msg}"` | `meta_api_error` (new) | **new** (shared with GET) |
| 500 (encryption) | ENCRYPTION_KEY hint | `config_encryption_corrupt` | existing |
| 500 (insert/update) | `"Failed to save/update configuration"` | `config_save_failed` / `config_update_failed` | existing |
| 200 (saved+registered=false) | response shape `registration_error: <text>` | keep `registration_error` for logs; client renders via code `meta_registration_failed` (new) with `params: { message }` (and an `aria-live` fallback) | **new** |
| 200 (saved+registration_skipped) | informational success | keep `registration_skipped: true`; client already has its own toast text | n/a |
| 500 | `"Internal server error"` | `internal` | existing |

> `message` field on the wire is kept as an English fallback for logs and to remain compatible with anything that grep'd for it, but the client only renders the translated catalogue string for `code`. The dashboard's existing branches (`data.registered === false`, `data.registration_skipped`) become a small switch on `data.code` (when present) plus a status-message from the catalogue.

#### 3.5.2 `src/app/api/whatsapp/evolution/config/route.ts`

| HTTP | Current `error.message` | Proposed `code` |
| --- | --- | --- |
| 200 (no_account) | `"Profile not linked to an account."` | `profile_no_account` (new) |
| 200 (db_error) | `"Failed to fetch configuration"` | `evolution_config_load_failed` |
| 200 (no_config) | `"No Evolution configuration saved yet."` | `evolution_not_configured` (existing) |
| 400 (missing fields) | `"base_url, api_key, instance_name and webhook_secret are required"` | `evolution_config_validate_failed` (new) |
| 400 (bad URL) | `"base_url must be a valid http(s) URL"` | `evolution_invalid_url` (existing) |
| 400 (not routable) | `"base_url must resolve to a publicly-routable address"` | `evolution_invalid_url` (existing) — reuse with params, or split to `evolution_url_unreachable` (new) |
| 400 (instance name) | `"instance_name cannot contain path separators"` | `evolution_instance_name_invalid` (new) |
| 409 (instance conflict) | long string | `evolution_instance_already_linked` (new) |
| 500 (encryption) | ENCRYPTION_KEY hint | `config_encryption_corrupt` |
| 500 (validate) | `"Failed to validate configuration"` | `config_validate_failed` |
| 400 (ProviderError) | `Evolution API error: {msg}` | `evolution_send_failed` (existing) |
| 400/409 (create_or_connect) | derived from `ProviderError` | `evolution_create_failed` (existing) |
| 500 (insert/update) | `"Failed to save/update configuration"` | `evolution_config_save_failed` (existing) |
| 500 | `"Internal server error"` | `internal` |

Success response on POST already returns `{ success, connected, qr, history_import_started, instance_name }` — no user-facing strings. The client toast text already exists in `evolution-config-panel.tsx`; we keep that path but rename its translation namespace.

#### 3.5.3 `src/app/api/whatsapp/evolution/import/route.ts`

| HTTP | Current `error.message` | Proposed `code` |
| --- | --- | --- |
| 500 (load config) | `"Failed to load Evolution configuration"` | `evolution_config_load_failed` |
| 400 (no config) | `"No Evolution configuration found for this account"` | `evolution_not_configured` |
| 400 (not connected) | `"Evolution instance is not connected"` | `instance_not_connected` (existing) |
| 500 (setup) | generic | `internal` |
| 200 | `{ success: true, started: true }` | n/a |

Background import runs in `after()` and only logs. No user-facing strings to migrate.

---

## 4. Proposed namespaces and keys

All new keys live under existing top-level namespaces where possible. New namespace only when unavoidable.

### 4.1 `Settings.whatsapp` (extend existing)

Existing keys kept as-is. Additions:

```jsonc
// Provider selector card
"providerCardTitle": "WhatsApp Provider",
"providerCardDesc": "Choose the WhatsApp connection method for this account.",
"providerMeta": "Meta Cloud API",
"providerEvolution": "Evolution API",
"providerEvolutionNotice": "Evolution API uses WhatsApp Web / Baileys and is intended for testing. It does not support templates or interactive messages.",

// Status card (existing keys kept)
"statusConnectedTitle": "Credentials valid",
"statusConnectedDesc": "Your access token authenticates with Meta. See Registration status below for whether webhooks are actually wired.",
"statusNotConnectedTitle": "Not connected",
"statusNotConnectedDesc": "Configure your Meta API credentials below to connect your WhatsApp Business account.",

// Save / load
"loadFailed": "Failed to load WhatsApp configuration",
"saveFailed": "Failed to save configuration",
"resetFailed": "Failed to reset configuration",
"resetConfirm": "This will delete the current WhatsApp config so you can re-enter it. Continue?",
"resetSuccess": "Configuration cleared. You can now re-enter your credentials.",

// Field validation
"phoneNumberIdRequired": "Phone Number ID is required",
"accessTokenRequired": "Access Token is required for initial setup",
"accessTokenReenter": "Please re-enter the Access Token to save changes",

// Save outcomes
"saveVerified": "Credentials saved and verified. Inbound registration was skipped (no PIN) — see Registration status below.",
"saveLive": "WhatsApp connected. Events will start flowing within a minute.",
"saveLiveNamed": "Live — {name} can now receive events.",
"saveRegistrationFailed": "Saved, but Meta couldn't register the number: {message}",

// Test connection
"testConnectionSuccess": "API connection successful",
"testConnectionSuccessNamed": "Connected to {name}",
"testConnectionFailedNetwork": "Connection test failed. Check network and try again.",

// Verify registration
"verifyRegistrationSuccess": "Number is fully wired — Meta is delivering events.",
"verifyRegistrationFailed": "Number is not fully registered. See the checks below for which step failed.",
"verifyRegistrationUnreachable": "Could not reach the verification endpoint.",

// Provider cards (already covered by existing keys)
```

Sample placeholders (`e.g. 100234567890123`, `https://evolution.example.com`, `e.g. wacrm-account-1`) are kept as **technical examples** and are not translated. `••••••••••••••••` is a mask constant, never translated.

### 4.2 `Settings.evolution` (new namespace)

```jsonc
"experimentalTitle": "Experimental provider",
"experimentalDesc": "Evolution API with Baileys / WhatsApp Web is intended for development and testing. It is not equivalent to the official WhatsApp Cloud API and may be subject to disconnections or restrictions.",
"noticeTitle": "Evolution API notice",
"noticeDesc": "Evolution API is licensed under Apache 2.0 with additional brand and attribution conditions. A visible notice of use is required. For commercial redistribution, review the Evolution API license and consider a commercial license if the notice conditions cannot be met.",

"statusConnected": "Connected",
"statusNotConnected": "Not connected",
"statusConnectedDesc": "Evolution instance is connected.",
"statusNotConnectedDesc": "Configure and save to connect.",
"statusNotConnectedFallback": "Instance not connected.",

"qrTitle": "Pairing QR Code",
"qrDesc": "Open WhatsApp on your phone, go to Linked Devices, and scan this code.",
"qrAlt": "Evolution pairing QR",

"credentialsTitle": "Evolution API Credentials",
"credentialsDesc": "Connect to a self-hosted Evolution API v2.3.7+ instance.",
"labelBaseUrl": "Base URL",
"labelInstanceName": "Instance Name",
"labelApiKey": "API Key",
"labelWebhookSecret": "Webhook Secret",
"placeholderBaseUrl": "https://evolution.example.com",
"placeholderInstanceName": "e.g. wacrm-account-1",
"placeholderApiKeyNew": "Evolution API key",
"placeholderWebhookSecretNew": "Secret Evolution sends in webhooks",
"webhookSecretHint": "Required. wacrm will configure Evolution to send this value in the {code}apikey{code} header.",
"createInstanceLabel": "Create instance if it does not exist",

"webhookTitle": "Webhook URL",
"webhookDesc": "wacrm will register this URL on your Evolution instance automatically.",
"webhookUrlLabel": "Webhook URL",

"saving": "Saving…",
"saveConfig": "Save Configuration",
"testing": "Testing…",
"testConnection": "Test Connection",
"importing": "Importing…",
"importHistory": "Import history",
"resetting": "Resetting…",
"resetConfig": "Reset",

"validationBaseUrlRequired": "Base URL and Instance Name are required",
"validationApiKeyRequired": "API Key is required for initial setup",
"validationWebhookSecretRequired": "Webhook Secret is required for initial setup",
"validationApiKeyReenter": "Please re-enter the API Key to save changes",
"validationWebhookSecretRequiredShort": "Webhook Secret is required",

"saveSuccessWithQr": "Configuration saved. Scan the QR code with WhatsApp.",
"saveSuccessConnected": "Evolution instance connected.",
"saveSuccessNotConnected": "Configuration saved, but instance is not connected yet.",
"resetSuccess": "Evolution configuration cleared.",
"copyWebhookSuccess": "Webhook URL copied to clipboard",

"importStartedInline": "Historical import started in the background. Contacts and messages will appear shortly.",
"importStartedToast": "Historical import started in the background.",
"importStartFailed": "Failed to start historical import",
"saveFailed": "Failed to save Evolution configuration",
"resetFailed": "Failed to reset configuration",
"testFailed": "Connection test failed.",
"resetConfirm": "This will delete the Evolution configuration. Continue?",
```

> `webhookSecretHint` uses the `{code}` token pattern already established elsewhere in the project (see existing `Settings.apiKeys` for `apiCode`/`headerCode` pattern). The component renders the value through `t.rich(...)` so translators can rewrap it in `<code>` tags without escaping work.

### 4.3 `Settings` (extend)

```jsonc
"railAriaLabel": "Settings sections",
```

### 4.4 `Errors.apiErrors` (extend catalogue + dictionary)

New codes appended to `API_ERROR_CODES` in `src/features/i18n/api-errors.ts`:

```ts
// appended in alphabetical order
'evolution_config_validate_failed',
'evolution_instance_already_linked',
'evolution_instance_name_invalid',
'evolution_url_unreachable',
'meta_api_error',
'meta_registration_failed',
'phone_number_already_linked',
'pin_invalid',
'profile_no_account',
'whatsapp_phone_number_already_linked',
```

New entries in `messages/{en,es,ko}.json` under `Errors.apiErrors`:

```jsonc
"evolution_config_validate_failed": "Could not validate the Evolution configuration. Check the values and try again.",
"evolution_instance_already_linked": "This Evolution instance name is already linked to another account on this instance.",
"evolution_instance_name_invalid": "Instance name cannot contain path separators.",
"evolution_url_unreachable": "The provided URL could not be reached. Make sure it is publicly routable and try again.",
"meta_api_error": "Meta rejected the request: {message}",
"meta_registration_failed": "Meta accepted the credentials but could not register the number for inbound webhooks: {message}",
"phone_number_already_linked": "This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm account.",
"pin_invalid": "The two-step verification PIN must be exactly 6 digits.",
"profile_no_account": "Your profile is not linked to an account.",
"whatsapp_phone_number_already_linked": "This WhatsApp phone number is already linked to another account. Each phone number can only be connected to one wacrm account."
```

> `es` and `ko` translations must be authored by a translator before the merge is unblocked. This spec marks the source-of-truth values; the parity test (`src/i18n/messages.test.ts`) is the gate.

### 4.5 `Common` (extend, if needed)

The existing `Common.unknownError` fallback covers any code outside the catalogue. No new key required there.

---

## 5. Treatment of Meta vs Evolution

- Two parallel namespaces: `Settings.whatsapp` (Meta) and `Settings.evolution` (Evolution). The shared strings (`Save Configuration`, `Saving…`, `Reset Configuration`, `Resetting…`, status `Connected`/`Not connected`) live in each namespace independently because their ICU formatters and surrounding copy differ. We do **not** alias across namespaces.
- Provider names are localisable: `Meta Cloud API`, `Evolution API`, `Baileys`, `WhatsApp Web` keep their current English casing in `en`; translators can adapt for `es`/`ko` while keeping recognisability.
- Brand/legal notice on Evolution (`Experimental provider`, `Evolution API notice`, Apache 2.0 clause) **must remain in the user's locale** so the attribution requirement is satisfied for non-English speakers.
- The "Meta Cloud API" / "Evolution API" toggle buttons are kept literal but are translated.

## 6. Treatment of API messages

- All dashboard clients translate by `error.code` via `useApiError()` / `getApiErrorMessage()`. The English `error.message` from the server is treated as a **log-only** fallback.
- Route handlers rewrite their `NextResponse.json` payloads to the envelope:

  ```ts
  // before
  return NextResponse.json({ error: 'PIN must be exactly 6 digits.' }, { status: 400 })
  // after
  return errorCode('pin_invalid', 400) // from src/lib/api/v1/respond.ts
  ```

  Where extra context is useful (e.g. `meta_api_error` carries the upstream message), `errorCode(code, status, { message, params })` is used so the client can interpolate `{message}` into the catalogue template.
- Server logs continue to print the raw English message via `console.error(..., message)`. Server logs never go through the catalogue.
- Existing public `/api/v1` envelope in `respond.ts` is unchanged. This spec is strictly about the dashboard's `/api/whatsapp/**` family.

## 7. Translation helpers — `t()` / `t.raw()` / `t.rich()`

- Static text → `t('key')` (already standard).
- ICU with single token → `t('saveLiveNamed', { name })` (already standard).
- Inline HTML (e.g. `<strong class="text-foreground">`) → keep `dangerouslySetInnerHTML={{ __html: t('key') }}` for plain tags, **or** migrate to `t.rich('key', { tag: (chunks) => <strong>{chunks}</strong> })` if the translators want ICU plural/gender-safe markup.
- For the new `webhookSecretHint` we use `t.rich` so translators can reorder the sentence around the `<code>` element. Example shape:

  ```tsx
  t.rich('webhookSecretHint', {
    code: (chunks) => <code className="text-foreground">{chunks}</code>,
  })
  ```

- The existing `step3_2`/`step3_3`/`step4_3`/`step4_4`/`step4_4` style HTML translations stay as-is (raw `t.raw()` + `dangerouslySetInnerHTML`). ICU safety is already enforced by `src/i18n/icu-safety.test.ts`.

## 8. Parity testing strategy

- Existing `src/i18n/messages.test.ts` enforces `en ⊇ es` and `en ⊇ ko` on key sets. Adding any key in `en` without the matching key in `es`/`ko` fails CI — so the migration must ship all three locales for every new key.
- Existing `src/i18n/icu-safety.test.ts` will reject malformed ICU. Any new `t(key, { … })` call that references an undeclared placeholder must use a real token name.
- Add a focused unit test in `src/features/i18n/api-errors.test.ts` (the file already exists) to assert the new codes are present in `API_ERROR_CODES` and that `apiErrorKey(code)` resolves each one to a `Errors.apiErrors.<code>` path (i.e. keys exist in `en.json`).
- Add a component test for `evolution-config-panel.tsx` and `whatsapp-config.tsx` that asserts:
  - Every previously-hardcoded string listed in §3.1 and §3.2 is rendered through `useTranslations(...)` (sanity check via snapshot, not exhaustive).
  - On a `fetch` rejection with `{ error: { code: 'meta_api_error', params: { message: 'bad token' } } }`, the toast reads the catalogue value, not `'bad token'`.
  - On a `fetch` rejection with `{ error: { code: 'unknown_code' } }`, the toast falls back to `Common.unknownError`.

## 9. Acceptance criteria

1. `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
2. `src/i18n/messages.test.ts` reports no missing or orphaned keys for `es.json` / `ko.json`.
3. `src/i18n/icu-safety.test.ts` is green.
4. Grepping for the literals listed in §3.1 and §3.2 in `whatsapp-config.tsx` / `evolution-config-panel.tsx` returns zero matches in non-comment code (the mask constants `••••••••••••••••` and sample IDs `e.g. 100…` are exempt).
5. Grepping the three route handlers for `NextResponse.json({ error: '...'` returns zero matches with hardcoded English — every error goes through `errorCode(...)` or `fail(code, ...)` from `src/lib/api/v1/respond.ts`.
6. The settings rail's `<nav aria-label>` reads from `Settings.railAriaLabel`.
7. No `console.error` is removed or relocated; English logs stay English.
8. The two provider switch buttons still display the provider name in the active locale.
9. Every code listed in §3.5 maps to a key in `Errors.apiErrors` for `en`/`es`/`ko`.
10. Existing behaviour preserved: `data.registered === false`, `data.registration_error`, `data.registration_skipped`, `data.qr.dataUrl`, `data.history_import_started`, and `data.phone_info.verified_name` continue to work — only the **presentation** of the surrounding copy changes.

## 10. Risks and follow-ups

- **Translator turnaround**: `es`/`ko` for ~10 new keys are needed before merge. The spec lists English copy only; translators produce the rest.
- **Public API surface**: the `/api/whatsapp/*` route handlers are internal to the dashboard, so changing the `error.message` shape is safe. If any third-party consumer has wired to these endpoints (unlikely, but possible), they may break — call this out in the PR description.
- **Translator hints**: the `pinHint` key uses long product context; ES/KO translators may need a glossary. Provide `docs/i18n/glossary.md` as a follow-up if not already done.
- **AGENTS.md** does not need changes (no new commands, env vars, or security rules).
- **No SQL changes**: nothing in `supabase/migrations/**` is touched.

---

End of specification. Awaiting explicit approval before any code is modified.