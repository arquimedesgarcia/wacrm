# i18n — Checklist de tareas

## Leyenda

- `pending`: aún no iniciado
- `in-progress`: en curso
- `done`: completado y verificado
- `blocked`: bloqueado por dependencia externa o decisión del owner
- `upstream`: depende del upstream oficial; no se hackea en este fork

---

## FASE 1 — ESPECIFICACIONES (completada)

| # | Tarea | Estado | Notas |
|---|-------|--------|-------|
| 1.1 | Inspeccionar estado actual de i18n (`next-intl`, `messages/`, `src/i18n/request.ts`, tests) | done | Ver `specs/i18n-plan.md` §1 |
| 1.2 | Definir arquitectura i18n y justificar librería | done | `next-intl` ya en uso |
| 1.3 | Identificar pantallas cubiertas y no cubiertas por upstream | done | signup/forgot-password no usan `useTranslations` |
| 1.4 | Documentar plan, tareas y catálogo de claves en `/specs` | done | Este archivo + `i18n-plan.md` + `es/translation-keys.md` |
| 1.5 | Presentar resumen al owner y detenerse a esperar aprobación | done | Owner aprobó FASE 2 el 2026-08-28 |

---

## FASE 2 — IMPLEMENTACIÓN (sólo tras aprobación del owner)

### A. Infraestructura y configuración

| # | Tarea | Estado | Estimación | Riesgo |
|---|-------|--------|------------|--------|
| 2.1 | Crear `src/features/i18n/config.ts` (locales soportados, cookie name, defaults) | done | 15 min | Bajo |
| 2.2 | Crear `src/features/i18n/locale.ts` (detect, getSaved, save, validate) | done | 30 min | Bajo |
| 2.3 | Actualizar `src/i18n/request.ts` para leer `NEXT_PUBLIC_DEFAULT_LOCALE` con fallback legacy | done | 20 min | Medio — toca core, wrapper CUSTOM |
| 2.4 | Actualizar `src/middleware.ts` para leer/escribir cookie de locale | **skipped** | — | No fue necesario: `request.ts` lee `NEXT_LOCALE` directamente con `next/headers` |
| 2.5 | Actualizar `docker-compose.yml`, `Dockerfile` y `.env.local.example` con `NEXT_PUBLIC_DEFAULT_LOCALE` | done | 20 min | Bajo — `.env.local.example` bloqueado por política de archivos sensibles; se documenta |

### B. Selector UI

| # | Tarea | Estado | Estimación | Riesgo |
|---|-------|--------|------------|--------|
| 2.6 | Crear `src/components/i18n/locale-switcher.tsx` | done | 45 min | Bajo |
| 2.7 | Montar selector en menú de cuenta del `Header` (wrapper CUSTOM) | done | 20 min | Medio — toca core |
| 2.8 | Verificar accesibilidad (aria-label, keyboard) | done | 15 min | Bajo — usa DropdownMenuSub de Base UI |

### C. Catálogo español

| # | Tarea | Estado | Estimación | Riesgo |
|---|-------|--------|------------|--------|
| 2.9 | Crear `messages/es.json` con paridad 1:1 de keys vs `en.json` | done | 4–6 h | Alto — 1.468 keys |
| 2.10 | Revisar plurales, géneros y placeholders (`{count}`, `{name}`, HTML) | done | 1 h | Medio |
| 2.11 | Actualizar `src/i18n/messages.test.ts` para incluir `'es'` | done | 5 min | Bajo |

### D. Pantallas no cubiertas por upstream

| # | Tarea | Estado | Estimación | Riesgo |
|---|-------|--------|------------|--------|
| 2.12 | Añadir keys `SignupPage` a `en.json` y `es.json` | **upstream** | — | Decisión owner: no tocar core |
| 2.13 | Refactor `src/app/(auth)/signup/page.tsx` a `useTranslations` | **upstream** | — | Decisión owner: no tocar core |
| 2.14 | Añadir keys `ForgotPasswordPage` a `en.json` y `es.json` | **upstream** | — | Decisión owner: no tocar core |
| 2.15 | Refactor `src/app/(auth)/forgot-password/page.tsx` a `useTranslations` | **upstream** | — | Decisión owner: no tocar core |
| 2.16 | Dejar signup/forgot-password en inglés y documentar como *pending upstream* | done | 0 min | Bajo — decisión del owner aplicada |

### E. Verificación

| # | Tarea | Estado | Estimación | Riesgo |
|---|-------|--------|------------|--------|
| 2.17 | `npm run typecheck` limpio | done | 5 min | Bajo |
| 2.18 | `npm run lint` limpio (sin errores; warnings preexistentes) | done | 5 min | Bajo |
| 2.19 | `npm test` — tests i18n limpios; 5 fallos preexistentes de locale/timezone | done | 5 min | Medio |
| 2.20 | `npm run build` con `NEXT_PUBLIC_DEFAULT_LOCALE=es` y `=en` | done | 5–10 min | Medio — requiere vars dummy de Supabase |
| 2.21 | Prueba manual del selector de idioma | pending | 15 min | Bajo — requiere levantar dev server |

### F. Documentación y commit

| # | Tarea | Estado | Estimación | Riesgo |
|---|-------|--------|------------|--------|
| 2.22 | Actualizar `specs/i18n-tasks.md` con estado final | done | 10 min | Bajo |
| 2.23 | Actualizar `AGENTS.md` si cambian convenciones o env vars | done | 10 min | Bajo — `NEXT_PUBLIC_DEFAULT_LOCALE` añadida |
| 2.24 | Commitear en rama `custom` con mensaje `feat(i18n): ...` | in-progress | 5 min | Bajo |
| 2.25 | **NO hacer push** sin autorización del owner | pending | — | — |

---

## Decisiones del owner (aplicadas)

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿Traducir signup y forgot-password? | **No.** Se dejan en inglés como *pending upstream* para no tocar core. |
| 2 | ¿Ubicación del selector de idioma? | **Menú de cuenta** (dentro del dropdown del header). |
| 3 | ¿Nombre de la cookie? | **`NEXT_LOCALE`** (convención estándar next-intl). |
| 4 | ¿Escenario completo o mínimo? | **Mínimo.** Sin refactor de auth. |

---

## Estimación total FASE 2 (escenario mínimo)

~6–7 h.

---

## Archivos del upstream que se tocarán (lista para rebase)

Con las decisiones aplicadas, los cambios en archivos del upstream son mínimos y aditivos, delimitados con `// [CUSTOM:i18n start/end]` cuando aplique:

1. `src/i18n/request.ts` — leer `NEXT_PUBLIC_DEFAULT_LOCALE` + fallback legacy.
2. `src/middleware.ts` — leer cookie `NEXT_LOCALE` y exponer locale al request.
3. `src/i18n/messages.test.ts` — añadir `'es'` a `TRANSLATED_LOCALES`.
4. `src/components/layout/header.tsx` — montar `LocaleSwitcher` dentro del menú de cuenta (wrapper mínimo).
5. `docker-compose.yml` / `Dockerfile` / `.env.local.example` — variable `NEXT_PUBLIC_DEFAULT_LOCALE`.

Archivos **nuevos** (no afectan rebase):

- `messages/es.json`
- `features/i18n/config.ts`
- `features/i18n/locale.ts`
- `components/i18n/locale-switcher.tsx`
- `specs/*`
