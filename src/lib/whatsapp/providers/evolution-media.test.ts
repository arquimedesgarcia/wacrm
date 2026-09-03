import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Buffer } from 'node:buffer';

import {
  fetchEvolutionMediaBase64,
  resolveEvolutionMessageMedia,
} from './evolution-media';
import { mirrorInboundMedia } from '../mirror-inbound-media';
import type { MirrorStorage } from '../mirror-inbound-media';
import { encrypt } from '@/lib/whatsapp/encryption';

const ACCOUNT = 'acc-1';

function makeStorage(): MirrorStorage {
  return {
    from: () => ({
      upload: vi.fn(async () => ({ error: null })),
      getPublicUrl: () => ({
        data: { publicUrl: `https://cdn.test/chat-media/${ACCOUNT}/inbound/file.jpg` },
      }),
    }),
  };
}

function makeConfig(): Record<string, unknown> {
  return {
    evolution_base_url: 'https://evolution.example.com',
    evolution_instance_name: 'waCRM',
    evolution_api_key: encrypt('evolution-api-key'),
  };
}

const RAW_IMAGE = {
  key: { id: 'MSG-IMG-1', remoteJid: '15551234567@s.whatsapp.net', fromMe: false },
  message: {
    imageMessage: { mimetype: 'image/jpeg', caption: 'hi', url: undefined },
  },
  messageTimestamp: 1700000000,
};

describe('fetchEvolutionMediaBase64', () => {
  it('posts the message key and returns base64 + mime', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            base64: 'aGVsbG8=', // "hello"
            mimetype: 'image/jpeg',
            fileName: 'pic.jpg',
            size: { fileLength: '1048576' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const res = await fetchEvolutionMediaBase64({
      baseUrl: 'https://evolution.example.com',
      apiKey: 'k',
      instanceName: 'waCRM',
      messageKeyId: 'MSG-IMG-1',
      request: fetchMock as unknown as typeof fetch,
    });

    expect(res).not.toBeNull();
    expect(res?.mimeType).toBe('image/jpeg');
    expect(res?.fileName).toBe('pic.jpg');
    expect(res?.fileSize).toBe(1048576);
    expect(res?.base64).toBe('aGVsbG8=');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://evolution.example.com/chat/getBase64FromMediaMessage/waCRM');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.message.key.id).toBe('MSG-IMG-1');
  });

  it('returns null on a non-200 response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    const res = await fetchEvolutionMediaBase64({
      baseUrl: 'https://evolution.example.com',
      apiKey: 'k',
      instanceName: 'waCRM',
      messageKeyId: 'X',
      request: fetchMock as unknown as typeof fetch,
    });
    expect(res).toBeNull();
  });

  it('accepts a data: URI in base64 (some instances inline bytes)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ base64: 'data:image/png;base64,aGVsbG8=', mimetype: 'image/png' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    const res = await fetchEvolutionMediaBase64({
      baseUrl: 'https://evolution.example.com',
      apiKey: 'k',
      instanceName: 'waCRM',
      messageKeyId: 'X',
      request: fetchMock as unknown as typeof fetch,
    });
    expect(res?.base64).toBe('data:image/png;base64,aGVsbG8=');
  });
});

describe('resolveEvolutionMessageMedia', () => {
  it('mirrors the downloaded bytes into chat-media and returns the URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ base64: Buffer.from('hello').toString('base64'), mimetype: 'image/jpeg' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const storage = makeStorage();
    const url = await resolveEvolutionMessageMedia({
      config: makeConfig() as never,
      rawPayload: RAW_IMAGE as never,
      accountId: ACCOUNT,
      storage,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(url.mediaUrl).toContain('chat-media');
    expect(url.mediaType).toBe('image/jpeg');
    expect(mirrorInboundMedia).toBeDefined();
  });

  it('falls back to null mediaUrl when the instance returns nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }));
    const storage = makeStorage();
    const url = await resolveEvolutionMessageMedia({
      config: makeConfig() as never,
      rawPayload: RAW_IMAGE as never,
      accountId: ACCOUNT,
      storage,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(url.mediaUrl).toBeNull();
    expect(url.mediaType).toBe('image/jpeg');
  });

  it('uses an inline data URI from the webhook and skips the fetch', async () => {
    const fetchMock = vi.fn();
    const storage = makeStorage();
    const res = await resolveEvolutionMessageMedia({
      config: makeConfig() as never,
      rawPayload: {
        key: { id: 'INLINE-1' },
        message: { imageMessage: { url: 'data:image/jpeg;base64,aGVsbG8=' } },
      } as never,
      accountId: ACCOUNT,
      storage,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.mediaUrl).toContain('chat-media');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
