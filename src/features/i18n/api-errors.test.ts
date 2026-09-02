import { describe, expect, it } from 'vitest';

import {
  apiErrorKey,
  API_ERROR_CODES,
  isKnownApiErrorCode,
} from './api-errors';

describe('api-errors catalogue', () => {
  it('contains no duplicate codes', () => {
    const set = new Set(API_ERROR_CODES);
    expect(set.size).toBe(API_ERROR_CODES.length);
  });

  it('uses snake_case codes', () => {
    const bad = API_ERROR_CODES.filter((c) => !/^[a-z][a-z0-9_]*$/.test(c));
    expect(bad, `non-snake_case codes: ${bad.join(', ')}`).toEqual([]);
  });

  it('maps known codes to Errors.apiErrors.<code>', () => {
    expect(apiErrorKey('not_found')).toBe('Errors.apiErrors.not_found');
    expect(apiErrorKey('whatsapp_not_configured')).toBe(
      'Errors.apiErrors.whatsapp_not_configured'
    );
  });

  it('exposes the WhatsApp-localization codes', () => {
    const required = [
      'evolution_config_validate_failed',
      'evolution_instance_already_linked',
      'evolution_instance_name_invalid',
      'evolution_url_unreachable',
      'meta_api_error',
      'meta_registration_failed',
      'pin_invalid',
      'profile_no_account',
      'whatsapp_phone_number_already_linked',
    ];
    for (const code of required) {
      expect(API_ERROR_CODES, `missing code: ${code}`).toContain(code);
      expect(apiErrorKey(code)).toBe(`Errors.apiErrors.${code}`);
    }
  });

  it('falls back to Common.unknownError for unknown codes', () => {
    expect(apiErrorKey('not_in_catalogue')).toBe('Common.unknownError');
    expect(apiErrorKey('')).toBe('Common.unknownError');
  });

  it('isKnownApiErrorCode narrows correctly', () => {
    const code: string = API_ERROR_CODES[0];
    if (isKnownApiErrorCode(code)) {
      // Compile-time check: code is KnownApiErrorCode here.
      const narrowed: (typeof API_ERROR_CODES)[number] = code;
      expect(narrowed).toBe(code);
    } else {
      throw new Error('expected first code to be known');
    }
    expect(isKnownApiErrorCode('definitely_not_a_code')).toBe(false);
  });
});
