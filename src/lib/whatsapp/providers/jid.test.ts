import { describe, expect, it } from 'vitest'
import { parseJid, resolveInboundPhone } from './jid';

describe('parseJid', () => {
  it('parses a plain PN JID', () => {
    expect(parseJid('584263895492@s.whatsapp.net')).toEqual({
      user: '584263895492',
      device: '',
      server: 's.whatsapp.net',
    });
  });

  it('splits the multi-device suffix', () => {
    expect(parseJid('584263895492:2@s.whatsapp.net')).toEqual({
      user: '584263895492',
      device: '2',
      server: 's.whatsapp.net',
    });
  });

  it('parses LID JIDs', () => {
    expect(parseJid('1490236991@lid')).toEqual({
      user: '1490236991',
      device: '',
      server: 'lid',
    });
  });

  it('returns null for empty or malformed input', () => {
    expect(parseJid('')).toBeNull();
    expect(parseJid(undefined)).toBeNull();
    expect(parseJid('no-server')).toBeNull();
    expect(parseJid('@s.whatsapp.net')).toBeNull();
  });
});

describe('resolveInboundPhone', () => {
  it('accepts a plain PN JID', () => {
    expect(
      resolveInboundPhone({ remoteJid: '584263895492@s.whatsapp.net' })
    ).toEqual({ phone: '584263895492', via: 'pn', skipReason: null });
  });

  it('strips the multi-device suffix', () => {
    expect(
      resolveInboundPhone({ remoteJid: '584263895492:14@s.whatsapp.net' })
    ).toEqual({ phone: '584263895492', via: 'pn', skipReason: null });
  });

  it('resolves a LID remoteJid through remoteJidAlt', () => {
    expect(
      resolveInboundPhone({
        remoteJid: '1490236991@lid',
        remoteJidAlt: '584263895492@s.whatsapp.net',
      })
    ).toEqual({ phone: '584263895492', via: 'alt', skipReason: null });
  });

  it('resolves a LID participant through participantAlt', () => {
    expect(
      resolveInboundPhone({
        remoteJid: '1490236991:72@lid',
        participantAlt: '584263895492@s.whatsapp.net',
      })
    ).toEqual({ phone: '584263895492', via: 'alt', skipReason: null });
  });

  it('skips a LID that has no alternate phone mapping', () => {
    const result = resolveInboundPhone({ remoteJid: '1490236991@lid' });
    expect(result.phone).toBe('');
    expect(result.skipReason).toBe('unresolvable-lid');
  });

  it('skips group, broadcast, newsletter and status JIDs', () => {
    for (const remoteJid of [
      '120363000000000000@g.us',
      '1234567890@broadcast',
      '12345@newsletter',
      'status@broadcast',
    ]) {
      const result = resolveInboundPhone({ remoteJid });
      expect(result.phone).toBe('');
      expect(result.skipReason).toMatch(/^unsupported-jid-server:/);
    }
  });

  it('skips an invalid PN user part instead of truncating it', () => {
    // The observed corruption: a PN-shaped JID whose user part is not a
    // valid phone. Without an alt mapping the event must be dropped.
    const result = resolveInboundPhone({
      remoteJid: '5842638954921490236991@s.whatsapp.net',
    });
    expect(result.phone).toBe('');
    expect(result.skipReason).toBe('invalid-pn-user');
  });

  it('recovers an invalid PN user part through remoteJidAlt', () => {
    expect(
      resolveInboundPhone({
        remoteJid: '5842638954921490236991@s.whatsapp.net',
        remoteJidAlt: '584263895492@s.whatsapp.net',
      })
    ).toEqual({ phone: '584263895492', via: 'alt', skipReason: null });
  });

  it('skips malformed and missing JIDs', () => {
    expect(resolveInboundPhone({ remoteJid: '' }).skipReason).toBe(
      'missing-remote-jid'
    );
    expect(resolveInboundPhone({}).skipReason).toBe('missing-remote-jid');
  });

  it('treats @hosted as phone and @hosted.lid as LID', () => {
    expect(
      resolveInboundPhone({ remoteJid: '584263895492@hosted' }).phone
    ).toBe('584263895492');
    expect(
      resolveInboundPhone({ remoteJid: '1490236991@hosted.lid' }).skipReason
    ).toBe('unresolvable-lid');
  });
});
