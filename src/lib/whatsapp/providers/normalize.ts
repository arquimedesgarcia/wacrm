import {
  normalizePhone,
  sanitizePhoneForMeta,
  isValidE164,
} from '@/lib/whatsapp/phone-utils'
import type { NormalizedContentType } from './types'

/**
 * Common phone normalizer for inbound events.
 *
 * Providers deliver phone numbers in different shapes:
 *   - Meta Cloud API: E.164 without leading + (e.g. "37063949836")
 *   - Evolution / Baileys: WhatsApp JID with suffix (e.g. "37063949836@s.whatsapp.net")
 *
 * The pipeline stores and matches contacts using the digit-only form,
 * so this helper strips everything except digits.
 */
export function normalizeInboundPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const local = phone.split('@')[0]
  return normalizePhone(local)
}

/**
 * Sanitize a recipient phone for outbound API calls.
 *
 * Meta requires digits only. Evolution accepts the same shape for
 * text sends via Baileys. The helper is a thin wrapper over
 * `sanitizePhoneForMeta` so the provider layer owns the outbound
 * normalization decision.
 */
export function normalizeOutboundPhone(
  phone: string | null | undefined,
): string {
  if (!phone) return ''
  return sanitizePhoneForMeta(phone.split('@')[0])
}

/**
 * Validate that a phone number is E.164-like before it is handed to a
 * provider for sending. Returns null when valid, otherwise a human-
 * readable error.
 */
export function validateOutboundPhone(phone: string): string | null {
  const normalized = normalizeOutboundPhone(phone)
  if (!normalized) return 'Phone number is required.'
  if (!isValidE164(normalized))
    return 'Phone number is not in a valid E.164 format.'
  return null
}

/**
 * Map arbitrary provider types into the normalized content-type set.
 *
 * Stickers are treated as images to match the current pipeline
 * (migration 010 CHECK constraint + existing webhook behavior).
 */
export function normalizeContentType(
  type: string | undefined,
): NormalizedContentType {
  switch (type) {
    case 'text':
    case 'chat':
      return 'text'
    case 'image':
    case 'sticker':
      return 'image'
    case 'document':
      return 'document'
    case 'audio':
    case 'voice':
      return 'audio'
    case 'video':
      return 'video'
    case 'location':
      return 'location'
    case 'template':
      return 'template'
    case 'interactive':
    case 'button':
      return 'interactive'
    default:
      return 'text'
  }
}

/**
 * Convert provider timestamps to ISO 8601 UTC.
 *
 * Meta sends Unix seconds as a string. Evolution sends Unix
 * milliseconds or an ISO string depending on the event type.
 */
export function normalizeTimestamp(
  ts: string | number | undefined,
): string {
  if (ts === undefined || ts === null) return new Date().toISOString()
  if (typeof ts === 'number') {
    return new Date(ts < 1e12 ? ts * 1000 : ts).toISOString()
  }
  const parsed = Number(ts)
  if (!Number.isNaN(parsed)) {
    return new Date(parsed < 1e12 ? parsed * 1000 : parsed).toISOString()
  }
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

/**
 * Normalize a display name by trimming and defaulting to undefined
 * when empty. Prevents blank names from being persisted over existing
 * contact names.
 */
export function normalizeDisplayName(
  name: string | null | undefined,
): string | undefined {
  const trimmed = name?.trim()
  return trimmed || undefined
}
