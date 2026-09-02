'use client';

import { useTranslations } from 'next-intl';

import { apiErrorKey, type ApiErrorCode } from './api-errors';

/**
 * Client-side translator for API errors. Returns a function that
 * takes the wire `code` (and optional ICU params) and yields the
 * localized message. Falls back to `Common.unknownError` for codes
 * that are not in the catalogue, which makes the helper safe to
 * call on any response without a defensive check.
 *
 * Usage:
 *   const tError = useApiError();
 *   toast.error(tError(error.code));
 *   toast.error(tError('rate_limited', { seconds: 30 }));
 */
export function useApiError() {
  const t = useTranslations();
  return (code: ApiErrorCode, params?: Record<string, string | number>) => {
    const key = apiErrorKey(code);
    try {
      return t(key, params);
    } catch {
      return t('Common.unknownError');
    }
  };
}
