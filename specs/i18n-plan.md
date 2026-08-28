# Plan i18n — Soporte de español en fork custom

## 1. Estado actual del upstream (ArnasDon/wacrm)

- **Librería**: `next-intl` ya está instalada y configurada (`next.config.ts`, `src/i18n/request.ts`, `src/app/layout.tsx`).
- **Diccionarios**: `messages/en.json` (~1.742 líneas) y `messages/ko.json`. Inglés es el catálogo fuente.
- **Locale**: estático en build-time mediante `process.env.NEXT_PUBLIC_APP_LOCALE`, con fallback a `'en'` en `src/i18n/request.ts`.
- **Cobertura**: la mayoría de componentes y páginas usan `useTranslations`/`getMessages`. Excepciones identificadas:
  - `src/app/(auth)/signup/page.tsx` — strings hardcodeados en inglés.
  - `src/app/(auth)/forgot-password/page.tsx` — strings hardcodeados en inglés.
- **Tests**: `src/i18n/messages.test.ts` verifica paridad de keys entre `en.json` y cada locale traducido (`ko`). `src/i18n/icu-safety.test.ts` protege el uso de `t.raw()` / `t.rich()` para mensajes con sintaxis no-ICU.

## 2. Librería elegida y justificación

**Mantener `next-intl`.**

Razones:
1. **Ya es la dependencia del upstream**. No se añade ninguna librería nueva, por lo que no hay riesgo de conflictos de versiones ni de aumentar el bundle.
2. **Integración completa**: plugin de Next.js, SSR, proveedor de cliente, soporte ICU, plurales y etiquetas HTML (`<bold>`).
3. **Rebasable**: al no cambiar de librería, los futuros cambios del upstream en `next-intl` se aplican limpiamente con `git rebase upstream/main`.
4. **Extensible**: agregar un nuevo locale solo requiere crear `messages/es.json` y ajustar la configuración de locale.

## 3. Objetivo de esta fase

Implementar soporte inicial de **español (es)** sin romper el inglés ni el build, y dejar abierta la puerta a más locales en el futuro.

Alcance:
- Catálogo completo `messages/es.json` con paridad 1:1 de keys frente a `en.json`.
- Detección/selección de idioma en runtime (cookie + selector UI).
- Variable `NEXT_PUBLIC_DEFAULT_LOCALE` (default `en`) con retrocompatibilidad para `NEXT_PUBLIC_APP_LOCALE` del upstream.
- Build y typecheck limpios.
- No alterar esquema Supabase, auth, Dockerfile ni variables secretas.

## 4. Arquitectura propuesta

### 4.1 Capa custom (sin tocar core del upstream)

```
src/features/i18n/
  config.ts          # locales soportados, default, cookie name
  locale.ts          # helpers: detectBrowserLocale, getSavedLocale, saveLocale
src/components/i18n/
  locale-switcher.tsx   # selector UI (submenú dentro del menú de cuenta)
messages/
  en.json            # existe (upstream)
  ko.json            # existe (upstream)
  es.json            # NUEVO — catálogo completo en español
```

Regla: los componentes core del upstream **no se reescriben**. Si una pantalla del upstream no está internacionalizada (ej. signup/forgot-password), se documenta como *pendiente upstream* y se decide en FASE 2 si se envuelve con un wrapper custom o se deja en inglés hasta que el upstream la cubra.

### 4.2 Cambios mínimos en core (wrappers delimitados)

Si es estrictamente necesario tocar archivos del upstream, se hace con bloques delimitados:

```ts
// [CUSTOM:i18n start]
...código custom...
// [CUSTOM:i18n end]
```

Archivos que requirieron wrapper:

1. **`src/i18n/request.ts`**
   - Leer cookie `NEXT_LOCALE` vía `next/headers`.
   - Leer `NEXT_PUBLIC_DEFAULT_LOCALE` como fallback.
   - Fallback a `NEXT_PUBLIC_APP_LOCALE` (legacy upstream).
   - Fallback final a `'en'`.
   - Mantener import dinámico de `messages/{locale}.json` con fallback a `en.json`.
   - `src/middleware.ts` **no se tocó**: leer la cookie directamente en `request.ts` es suficiente y evita modificar core.

2. **`src/i18n/messages.test.ts`**
   - Añadir `'es'` a `TRANSLATED_LOCALES`.

### 4.3 Selector de idioma UI

- Componente `LocaleSwitcher` en `components/i18n/locale-switcher.tsx`.
- Ubicación: dentro del menú de cuenta del `Header` (junto a Perfil, Configuración, Cerrar sesión).
- Comportamiento:
  - Muestra `Español / English / 한국어`.
  - Al cambiar, escribe la cookie y recarga la página (`window.location.reload()`), para que `src/i18n/request.ts` resuelva el nuevo locale en el siguiente request.
  - En SSR, el locale inicial viene de la cookie o del env.

### 4.4 Detección de idioma

Orden de prioridad:

1. Cookie `NEXT_LOCALE`.
2. `process.env.NEXT_PUBLIC_DEFAULT_LOCALE` (build-time / runtime).
3. `process.env.NEXT_PUBLIC_APP_LOCALE` (legacy upstream).
4. `navigator.language` en el cliente (solo primera visita, si no hay cookie ni env).
5. Fallback a `'en'`.

### 4.5 Variables de entorno

| Variable | Origen | Uso |
|----------|--------|-----|
| `NEXT_PUBLIC_DEFAULT_LOCALE` | NUEVO custom | Locale por defecto. Valor `en` si no se define. |
| `NEXT_PUBLIC_APP_LOCALE` | upstream legacy | Se mantiene como fallback para no romper deploys existentes. |

Se actualizarán:
- `docker-compose.yml`
- `Dockerfile` (build arg)
- `.env.local.example` (si es accesible; de lo contrario se documenta)

## 5. Cómo encaja con el upstream sin romper rebase

- **No se mueve** `messages/`, `src/i18n/`, ni la API de `next-intl`.
- **No se elimina** `NEXT_PUBLIC_APP_LOCALE`; solo se añade `NEXT_PUBLIC_DEFAULT_LOCALE` con prioridad mayor.
- **No se cambian** componentes core salvo wrappers mínimos y comentados.
- Si el upstream añade nuevas keys en `en.json`, la traducción española se mantiene en `es.json`. El test de paridad fallará hasta que se traduzca la nueva key — esto es deseable para detectar regresiones.
- Si el upstream refactoriza un componente que ya habíamos envuelto, el bloque `// [CUSTOM:i18n start]` facilita resolver el conflicto manualmente.

## 6. Puntos de extensión en componentes core

Los componentes core ya están preparados para i18n mediante `useTranslations`. Solo necesitan el diccionario `es.json`. Ejemplos de namespaces por pantalla:

- `LoginPage` — login
- `Sidebar`, `Header`, `ModeToggle` — layout
- `Dashboard.*` — dashboard
- `Inbox.*` — inbox
- `Contacts.*` — contactos
- `Pipelines.*` — pipelines
- `Broadcasts.*` — broadcasts
- `Automations.*` — automations
- `Flows.*` — flows
- `Settings.*` — settings
- `AccountAccess` — alerta de cuenta no vinculada

Pantallas **no cubiertas** por el upstream y **dejadas como pending upstream** en este cambio para no tocar core:

- `src/app/(auth)/signup/page.tsx`
- `src/app/(auth)/forgot-password/page.tsx`

## 7. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Paridad de keys `es.json` vs `en.json` | Alto | Actualizar `messages.test.ts` para incluir `'es'`; el test fallará si falta una key. |
| Mensajes ICU complejos (plurales, HTML) | Medio | Validar con `npm test` (icu-safety.test.ts) y revisar visualmente. |
| Middleware con cookie afecta cache / SSG | Medio | Mantener cookie-based locale; no cambiar paths ni routing por locale. `next-intl` sin `[locale]` segment no rompe SSG. |
| Bundle con JSON completo | Medio | `next-intl` carga solo el locale activo mediante import dinámico en `request.ts`. |
| Conflictos de rebase por tocar core | Bajo | Wrappers delimitados y cambios aditivos. |

## 8. Criterios de aceptación de FASE 2

- [ ] `messages/es.json` existe y tiene las mismas keys que `en.json`.
- [ ] `npm run typecheck` pasa.
- [ ] `npm run lint` pasa.
- [ ] `npm test` pasa (incluyendo paridad de locales e ICU safety).
- [ ] `npm run build` pasa con `NEXT_PUBLIC_DEFAULT_LOCALE=es` y con `NEXT_PUBLIC_DEFAULT_LOCALE=en`.
- [ ] El selector de idioma cambia el locale y persiste tras recargar.
- [ ] No se modifican tablas de Supabase ni auth.
- [ ] Los cambios en core están delimitados con `// [CUSTOM:i18n start/end]`.
