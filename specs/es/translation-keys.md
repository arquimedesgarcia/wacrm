# Catálogo de claves de traducción — Español (es)

## Origen y convenciones

- **Fuente de verdad**: `messages/en.json` del upstream (ArnasDon/wacrm).
- **Catálogo destino**: `messages/es.json` (a crear en FASE 2).
- **Estado de cobertura**:
  - `Cubierto por upstream`: el componente/pantalla ya usa `useTranslations` y solo necesita la traducción en `es.json`.
  - `Pendiente upstream`: el componente/pantalla tiene strings hardcodeados en inglés; requiere tocar core o esperar al upstream.
- **Convención de keys**: se mantiene la jerarquía exacta de `en.json`. Los valores en español respetan placeholders ICU (`{count}`, `{name}`, etc.) y etiquetas HTML (`<bold>`, `<phoneCode>`, etc.).

## Resumen por pantalla / namespace

| Pantalla / Módulo | Namespace raíz | Estado | Notas |
|-------------------|----------------|--------|-------|
| Login | `LoginPage` | Cubierto por upstream | Ya usa `useTranslations`. |
| Signup | `SignupPage` | **Pendiente upstream** | Strings hardcodeados en `src/app/(auth)/signup/page.tsx`. |
| Forgot password | `ForgotPasswordPage` | **Pendiente upstream** | Strings hardcodeados en `src/app/(auth)/forgot-password/page.tsx`. |
| Sidebar | `Sidebar` | Cubierto por upstream | Navegación y menú de usuario. |
| Header | `Header` | Cubierto por upstream | Título de página y menú de cuenta. |
| Theme toggle | `ModeToggle` | Cubierto por upstream | |
| Account access alert | `AccountAccess` | Cubierto por upstream | Alerta de usuario no vinculado. |
| Dashboard | `Dashboard` | Cubierto por upstream | Métricas, gráficos, feed de actividad. |
| Inbox | `Inbox` | Cubierto por upstream | Lista, hilo, composer, acciones, media, plantillas. |
| Contacts | `Contacts` | Cubierto por upstream | Listado, formulario, detalle, importación, custom fields. |
| Pipelines | `Pipelines` | Cubierto por upstream | Tablero, deals, settings, analytics. |
| Broadcasts | `Broadcasts` | Cubierto por upstream | Listado, detalle, wizard. |
| Automations | `Automations` | Cubierto por upstream | Listado, builder, logs. |
| Flows | `Flows` | Cubierto por upstream | Listado, builder, logs, validation. |
| Settings | `Settings` | Cubierto por upstream | Overview, members, invites, templates, WhatsApp, AI, etc. |

## Ejemplos de traducción por namespace

### `LoginPage`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `titleWelcome` | Welcome back | Bienvenido de nuevo |
| `titleAccept` | Sign in to accept | Inicia sesión para aceptar |
| `descWelcome` | Sign in to your account | Inicia sesión en tu cuenta |
| `emailLabel` | Email | Correo electrónico |
| `passwordLabel` | Password | Contraseña |
| `signIn` | Sign in | Iniciar sesión |
| `createAccount` | Create account | Crear cuenta |

### `Sidebar`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `dashboard` | Dashboard | Panel |
| `inbox` | Inbox | Bandeja de entrada |
| `contacts` | Contacts | Contactos |
| `pipelines` | Pipelines | Embudos |
| `broadcasts` | Broadcasts | Difusiones |
| `automations` | Automations | Automatizaciones |
| `flows` | Flows | Flujos |
| `settings` | Settings | Configuración |
| `menuSignOut` | Sign out | Cerrar sesión |
| `unreadConversations` | `{count} unread {count, plural, =1 {conversation} other {conversations}}` | `{count} conversación{count, plural, =1 {} other {es}} sin leer` |

### `Header`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `dashboard` | Dashboard | Panel |
| `inbox` | Inbox | Bandeja |
| `contacts` | Contacts | Contactos |
| `menuProfile` | Profile | Perfil |
| `menuSignOut` | Sign out | Cerrar sesión |

### `Dashboard`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `page.title` | Dashboard | Panel |
| `page.activeConversations` | Active Conversations | Conversaciones activas |
| `page.newContactsToday` | New Contacts Today | Contactos nuevos hoy |
| `quickActions.newContact` | New Contact | Nuevo contacto |
| `quickActions.newBroadcast` | New Broadcast | Nueva difusión |

### `Inbox.conversationList`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `searchPlaceholder` | Search conversations... | Buscar conversaciones... |
| `filterAll` | All | Todas |
| `filterUnread` | Unread | Sin leer |
| `filterOpen` | Open | Abiertas |
| `filterPending` | Pending | Pendientes |
| `filterClosed` | Closed | Cerradas |

### `Inbox.composer`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `typeMessagePlaceholder` | Type a message... (Shift+Enter for new line) | Escribe un mensaje... (Shift+Enter para nueva línea) |
| `send` | Send | Enviar |
| `templates` | Templates | Plantillas |
| `voiceNote` | Voice note | Nota de voz |

### `Contacts.page`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `title` | Contacts | Contactos |
| `subtitle` | Manage your contact list. {count} total contacts. | Administra tu lista de contactos. {count} contactos en total. |
| `addContactBtn` | Add Contact | Agregar contacto |
| `searchPlaceholder` | Search by name, phone, or email... | Buscar por nombre, teléfono o correo... |
| `deleteContactTitle` | Delete Contact | Eliminar contacto |
| `deleteContactDesc` | Are you sure you want to delete {name}? This action cannot be undone. | ¿Seguro que quieres eliminar a {name}? Esta acción no se puede deshacer. |

### `Pipelines.page`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `selectPipeline` | Select Pipeline | Seleccionar embudo |
| `addPipeline` | Add Pipeline | Agregar embudo |
| `addDeal` | Add Deal | Agregar negocio |
| `toastPipelineCreated` | Pipeline created | Embudo creado |

### `Broadcasts.page`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `title` | Broadcasts | Difusiones |
| `subtitle` | Send bulk messages to your contacts using approved templates. | Envía mensajes masivos a tus contactos usando plantillas aprobadas. |
| `newBroadcast` | New Broadcast | Nueva difusión |

### `Automations.list`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `title` | Automations | Automatizaciones |
| `create` | Create Automation | Crear automatización |
| `activate` | Activate | Activar |
| `deactivate` | Deactivate | Desactivar |

### `Flows.list`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `title` | Flows | Flujos |
| `newFlow` | New flow | Nuevo flujo |
| `statusActive` | Active | Activo |
| `statusDraft` | Draft | Borrador |

### `Settings.sections`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `overview` | Overview | Resumen |
| `profile` | Your profile | Tu perfil |
| `security` | Login & security | Seguridad |
| `appearance` | Appearance | Apariencia |
| `whatsapp` | WhatsApp | WhatsApp |
| `templates` | Templates | Plantillas |
| `members` | Team members | Miembros del equipo |
| `api` | API keys | Claves API |

### `Settings.profile`

| Key | Original (en) | Traducción (es) |
|-----|---------------|-----------------|
| `title` | Your profile | Tu perfil |
| `displayName` | Display name | Nombre visible |
| `saveChanges` | Save changes | Guardar cambios |
| `passwordTitle` | Password | Contraseña |
| `updatePassword` | Update password | Actualizar contraseña |

## Pantallas no cubiertas por el upstream

Las siguientes pantallas tienen textos en inglés hardcodeados. En FASE 2 se decide si:

- **(A)** Se traducen extendiendo `en.json` / `es.json` con nuevos namespaces y refactorizando las páginas (toca core).
- **(B)** Se dejan en inglés y se documentan como *pending upstream*.

### `src/app/(auth)/signup/page.tsx`

Strings identificados (no en `en.json`):

- `"Create account & join"`
- `"Create account"`
- `"Verify your email, then accept the invitation to join your team."`
- `"Get started with CRM Template for WhatsApp"`
- `"Check your email"`
- `"We've sent a confirmation link to {email}. Please check your inbox and click the link to verify your account."`
- `"Back to sign in"`
- `"Full name"`
- `"John Doe"`
- `"Passwords do not match"`
- `"Password must be at least 6 characters"`
- `"At least 6 characters"`
- `"Confirm password"`
- `"Repeat your password"`
- `"Creating account..."`
- `"Already have an account?"`
- `"Sign in"`

Propuesta de namespace: `SignupPage`.

### `src/app/(auth)/forgot-password/page.tsx`

Strings identificados (no en `en.json`):

- `"Reset password"`
- `"Enter your email and we'll send you a reset link"`
- `"Check your email"`
- `"We've sent a password reset link to {email}. Please check your inbox."`
- `"Back to sign in"`
- `"Send reset link"`
- `"Sending..."`

Propuesta de namespace: `ForgotPasswordPage`.

## Notas de traducción al español

1. **Plurales**: español usa las formas `=1` / `other` de ICU. Ejemplo: `{count} contacto{count, plural, =1 {} other {s}}`.
2. **Género**: cuando el upstream usa `other` para género neutral, español puede usar formas inclusivas o masculino genérico según preferencia del fork. Se propone lenguaje neutro cuando sea natural (ej. "Bienvenido/a de nuevo").
3. **Placeholders**: nunca se traducen los nombres de variables (`{count}`, `{name}`, `{email}`).
4. **HTML**: los mensajes con etiquetas (`<bold>`, `<code>`, `<phoneCode>`) se traducen conservando las etiquetas para que `t.rich()` las renderice.
5. **Términos propios**: se mantienen sin traducir aquellos que son nombres de marca o conceptos técnicos cuando la UX mejora: `WhatsApp`, `Meta`, `wacrm`.

## Proceso de generación del catálogo completo

En FASE 2 se ejecutará:

1. Copiar `messages/en.json` a `messages/es.json`.
2. Traducir cada valor respetando la estructura jerárquica.
3. Ejecutar `npm test` para verificar:
   - Paridad de keys (`messages.test.ts`).
   - No uso de `t()` plano sobre mensajes ICU-hostiles (`icu-safety.test.ts`).
4. Revisar manualmente pantallas críticas (login, inbox, settings).

## Estado del catálogo

- **FASE 1**: documentado, no generado.
- **FASE 2**: se generará `messages/es.json` completo con paridad 1:1 frente a `en.json`.
