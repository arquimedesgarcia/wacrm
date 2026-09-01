import { describe, expect, it } from 'vitest'

import { extractInstanceName, sanitizeWebhookPayload } from './evolution-webhook-helpers'

describe('extractInstanceName', () => {
  it('reads instance from the official v2.3.7 string field', () => {
    const payload = { event: 'messages.upsert', instance: 'waCRM', data: {} }
    expect(extractInstanceName(payload)).toBe('waCRM')
  })

  it('falls back to instanceName at the root', () => {
    const payload = { event: 'messages.upsert', instanceName: 'waCRM', data: {} }
    expect(extractInstanceName(payload)).toBe('waCRM')
  })

  it('falls back to data.instanceName', () => {
    const payload = { event: 'messages.upsert', data: { instanceName: 'waCRM' } }
    expect(extractInstanceName(payload)).toBe('waCRM')
  })

  it('falls back to instance.instanceName', () => {
    const payload = { event: 'messages.upsert', instance: { instanceName: 'waCRM' } }
    expect(extractInstanceName(payload)).toBe('waCRM')
  })

  it('returns null for non-object payloads', () => {
    expect(extractInstanceName(null)).toBeNull()
    expect(extractInstanceName('string')).toBeNull()
  })

  it('returns null when no name is present', () => {
    expect(extractInstanceName({ event: 'messages.upsert', data: {} })).toBeNull()
  })
})

describe('sanitizeWebhookPayload', () => {
  it('removes apikey and server_url from the root', () => {
    const payload = {
      event: 'messages.upsert',
      instance: 'waCRM',
      apikey: 'secret-token',
      server_url: 'https://evolution.example.com',
      data: { conversation: 'Hi' },
    }
    const sanitized = sanitizeWebhookPayload(payload) as Record<string, unknown>
    expect(sanitized.apikey).toBeUndefined()
    expect(sanitized.server_url).toBeUndefined()
    expect(sanitized.instance).toBe('waCRM')
    expect((sanitized.data as Record<string, string>).conversation).toBe('Hi')
  })

  it('does not mutate the original payload', () => {
    const payload = { event: 'messages.upsert', apikey: 'secret-token' }
    sanitizeWebhookPayload(payload)
    expect(payload.apikey).toBe('secret-token')
  })

  it('returns non-object payloads unchanged', () => {
    expect(sanitizeWebhookPayload(null)).toBeNull()
    expect(sanitizeWebhookPayload('string')).toBe('string')
  })
})
