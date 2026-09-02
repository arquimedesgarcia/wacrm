// ============================================================
// JID identity resolution for Evolution / Baileys inbound events.
//
// WhatsApp identifies a user in two ways (see baileys.wiki/concepts/jids):
//
//   - PN JID  (phone number):  "584263895492@s.whatsapp.net"
//   - LID JID (linked id):     "1490236991@lid"  — opaque, NOT a phone
//
// Since the LID rollout, Baileys 7.x / Evolution v2.3.7 can deliver
// `key.remoteJid` as a LID with the real phone only present in
// `key.remoteJidAlt` / `key.participantAlt`. Multi-device JIDs also carry
// a device suffix ("584263895492:2@s.whatsapp.net") that must be removed.
//
// Storing any of those raw shapes as a contact phone corrupts the CRM
// (observed: "5842638954921490236991" — digits of a JID user part whose
// separator was stripped). This module classifies a JID by server domain
// and resolves the E.164 phone, or reports that the event must be
// SKIPPED (never truncate, never invent a phone from a LID).
// ============================================================

import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils';

/** Server domains whose user part IS a phone number. */
const PHONE_SERVERS = new Set(['s.whatsapp.net', 'hosted']);

/** Server domains that identify a user but NEVER expose a phone. */
const LID_SERVERS = new Set(['lid', 'hosted.lid']);

/** Server domains that are not a single user at all (chats, channels). */
const SKIP_SERVERS = new Set([
  'g.us',
  'broadcast',
  'newsletter',
  'bot',
  'c.us',
]);

export interface ParsedJid {
  /** User part before any ":device" suffix. */
  user: string;
  /** Device suffix after ":" ("" when absent). */
  device: string;
  /** Server domain, lowercased (e.g. "s.whatsapp.net", "lid"). */
  server: string;
}

/**
 * Split a JID into its parts. Returns null for empty/malformed input.
 * Uses lastIndexOf('@') so exotic user parts cannot break the split.
 */
export function parseJid(jid: string | null | undefined): ParsedJid | null {
  const trimmed = jid?.trim();
  if (!trimmed) return null;
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return null;
  const userPart = trimmed.slice(0, at);
  const server = trimmed.slice(at + 1).toLowerCase();
  if (!server) return null;
  const colon = userPart.indexOf(':');
  const user = colon === -1 ? userPart : userPart.slice(0, colon);
  const device = colon === -1 ? '' : userPart.slice(colon + 1);
  if (!user) return null;
  return { user, device, server };
}

/** Minimal shape of a Baileys/Evolution message key. */
export interface EvolutionMessageKeyLike {
  remoteJid?: unknown;
  remoteJidAlt?: unknown;
  participant?: unknown;
  participantAlt?: unknown;
}

export interface InboundPhoneResolution {
  /** E.164 digits, or '' when the event must be skipped. */
  phone: string;
  /** Which field supplied the phone ('pn' | 'alt'), null when skipped. */
  via: 'pn' | 'alt' | null;
  /** Human-readable skip reason when phone === ''. */
  skipReason: string | null;
}

/**
 * Extract the E.164 phone from a PN-shaped JID field. Returns '' when the
 * JID is not a phone-server JID or its user part is not E.164-valid.
 */
function phoneFromPnJid(jid: unknown): string {
  if (typeof jid !== 'string') return '';
  const parsed = parseJid(jid);
  if (!parsed || !PHONE_SERVERS.has(parsed.server)) return '';
  const digits = normalizePhone(parsed.user);
  return isValidE164(digits) ? digits : '';
}

/**
 * Resolve the sender/recipient phone for an inbound event.
 *
 * Decision tree (per docs/evolution-api/spec-contact-phone-normalization.md):
 *   1. Classify key.remoteJid by server domain.
 *   2. Group/broadcast/newsletter/bot/legacy JIDs → skip (not a user chat).
 *   3. PN JID → user part minus ":device" suffix, validated as E.164.
 *      When the user part is not a valid phone (e.g. concatenated
 *      identifiers emitted by Evolution), fall back to remoteJidAlt.
 *   4. LID (or any other non-phone identity) → resolve via
 *      remoteJidAlt / participantAlt when present; otherwise skip.
 *
 * A LID is never converted into a phone: without the alt mapping the
 * correct action is to drop the event, not to store an internal id.
 */
export function resolveInboundPhone(
  key: EvolutionMessageKeyLike
): InboundPhoneResolution {
  const skipped = (skipReason: string): InboundPhoneResolution => ({
    phone: '',
    via: null,
    skipReason,
  });

  const primary = parseJid(
    typeof key.remoteJid === 'string' ? key.remoteJid : ''
  );
  if (!primary) return skipped('missing-remote-jid');

  if (SKIP_SERVERS.has(primary.server)) {
    return skipped(`unsupported-jid-server:${primary.server}`);
  }

  if (PHONE_SERVERS.has(primary.server)) {
    const digits = normalizePhone(primary.user);
    if (isValidE164(digits)) {
      return { phone: digits, via: 'pn', skipReason: null };
    }
    // PN-shaped JID whose user part is not a plausible phone (observed:
    // "5842638954921490236991"). Try the alternate identity fields
    // before giving up — never truncate the value to force validity.
    const alt =
      phoneFromPnJid(key.remoteJidAlt) || phoneFromPnJid(key.participantAlt);
    if (alt) return { phone: alt, via: 'alt', skipReason: null };
    return skipped('invalid-pn-user');
  }

  // LID and any other non-phone identity.
  const alt =
    phoneFromPnJid(key.remoteJidAlt) || phoneFromPnJid(key.participantAlt);
  if (alt) return { phone: alt, via: 'alt', skipReason: null };
  return skipped(
    LID_SERVERS.has(primary.server) ? 'unresolvable-lid' : 'unresolvable-jid'
  );
}
