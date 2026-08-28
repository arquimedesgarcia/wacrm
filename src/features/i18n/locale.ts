'use client';

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
  type SupportedLocale,
} from './config';

/**
 * Helpers de locale del lado del cliente.
 *
 * El locale real en SSR lo resuelve `src/i18n/request.ts` (con cookie,
 * env vars y fallback). Estas funciones manejan la persistencia y la
 * primera detección en el navegador.
 */

/**
 * Lee la cookie de locale.
 */
export function getSavedLocale(): SupportedLocale | null {
  if (typeof document === 'undefined') return null;

  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LOCALE_COOKIE_NAME}=`));

  if (!match) return null;

  const value = decodeURIComponent(match.slice(LOCALE_COOKIE_NAME.length + 1));
  return isSupportedLocale(value) ? value : null;
}

/**
 * Guarda el locale en una cookie con path=/ y sin expiración explícita
 * (sesión del navegador, se borra al cerrar). Usar `max-age` si se
 * prefiere persistencia.
 */
export function saveLocale(locale: SupportedLocale): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(
    locale
  )}; path=/; SameSite=Lax`;
}

/**
 * Detecta el locale preferido del navegador solo si coincide con uno
 * soportado. No fuerza un locale: el default sigue siendo `en`.
 */
export function detectBrowserLocale(): SupportedLocale | null {
  if (typeof navigator === 'undefined') return null;

  const preferred = navigator.language.split('-')[0];
  return isSupportedLocale(preferred) ? preferred : null;
}

/**
 * Resuelve el locale activo en el cliente.
 * Prioridad: cookie > detección del navegador > default.
 */
export function resolveClientLocale(): SupportedLocale {
  return getSavedLocale() ?? detectBrowserLocale() ?? DEFAULT_LOCALE;
}
