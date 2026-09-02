import { getTranslations } from 'next-intl/server';

import { apiErrorKey, type ApiErrorCode } from './api-errors';

/**
 * Server-side translator for API errors. Mirror of `useApiError`
 * for server components, server actions, and RSC routes that need
 * to render a localized error string (e.g. status banners).
 */
export async function getApiErrorMessage(
  code: ApiErrorCode,
  params?: Record<string, string | number>
): Promise<string> {
  const t = await getTranslations();
  const key = apiErrorKey(code);
  try {
    return t(key, params);
  } catch {
    return t('Common.unknownError');
  }
}
