/**
 * Configuración centralizada de i18n para el fork custom.
 *
 * Se mantiene en `features/i18n/` para no esparcir lógica de locale
 * por componentes core del upstream. Todos los valores son aditivos
 * y no modifican la API de `next-intl`.
 */

export const SUPPORTED_LOCALES = ['en', 'es', 'ko'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  ko: '한국어',
};

/**
 * Valida que un string sea un locale soportado.
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}
