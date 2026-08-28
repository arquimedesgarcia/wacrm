import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
} from '@/features/i18n/config';

export default getRequestConfig(async () => {
  // [CUSTOM:i18n start]
  // Resolve locale with the following priority:
  // 1. Cookie set by the locale switcher (runtime user choice).
  // 2. NEXT_PUBLIC_DEFAULT_LOCALE (new custom variable).
  // 3. NEXT_PUBLIC_APP_LOCALE (upstream legacy variable).
  // 4. DEFAULT_LOCALE constant ('en').
  let cookieLocale: string | undefined;
  try {
    const cookieStore = await cookies();
    cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  } catch {
    // cookies() is only available during a request. Static generation
    // falls through to env vars / default below.
  }

  const locale =
    (cookieLocale && isSupportedLocale(cookieLocale)
      ? cookieLocale
      : undefined) ??
    process.env.NEXT_PUBLIC_DEFAULT_LOCALE ??
    process.env.NEXT_PUBLIC_APP_LOCALE ??
    DEFAULT_LOCALE;
  // [CUSTOM:i18n end]

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
