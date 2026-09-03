import { describe, expect, it, vi, beforeEach } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';
import { EvolutionAdapter } from './evolution-adapter';
import { ProviderError } from './errors';
import type { WhatsAppConfig } from '@/types';

const encryptedApiKey = encrypt('evolution-api-key');
const encryptedWebhookSecret = encrypt('webhook-secret');

function makeConfig(overrides: Record<string, unknown> = {}): WhatsAppConfig {
  return {
    provider: 'evolution',
    evolution_base_url: 'https://evolution.example.com',
    evolution_api_key: encryptedApiKey,
    evolution_instance_name: 'waCRM',
    evolution_webhook_secret: encryptedWebhookSecret,
    ...overrides,
  } as unknown as WhatsAppConfig;
}

function jsonResponse(
  body: unknown,
  status = 200,
  statusText = 'OK'
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupFetch(mock: unknown) {
  vi.stubGlobal(
    'fetch',
    typeof mock === 'function'
      ? (mock as () => Promise<Response>)
      : vi.fn().mockResolvedValue(mock)
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('EvolutionAdapter configuration validation', () => {
  it('rejects missing base URL', async () => {
    const adapter = new EvolutionAdapter();
    await expect(
      adapter.verifyConfiguration(makeConfig({ evolution_base_url: '' }))
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects invalid base URL scheme', async () => {
    const adapter = new EvolutionAdapter();
    await expect(
      adapter.verifyConfiguration(
        makeConfig({ evolution_base_url: 'ftp://example.com' })
      )
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects missing instance name', async () => {
    const adapter = new EvolutionAdapter();
    await expect(
      adapter.verifyConfiguration(makeConfig({ evolution_instance_name: '' }))
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects plaintext stored API key', async () => {
    const adapter = new EvolutionAdapter();
    await expect(
      adapter.verifyConfiguration(
        makeConfig({ evolution_api_key: 'plaintext-key' })
      )
    ).rejects.toMatchObject({ code: 'CONFIGURATION_INVALID' });
  });

  it('rejects instance names with path separators', async () => {
    const adapter = new EvolutionAdapter();
    await expect(
      adapter.verifyConfiguration(
        makeConfig({ evolution_instance_name: 'wa/CRM' })
      )
    ).rejects.toMatchObject({ code: 'CONFIGURATION_INVALID' });
  });
});

describe('EvolutionAdapter verifyConfiguration', () => {
  it('returns identity when instance is connected', async () => {
    setupFetch(
      jsonResponse({ instance: { instanceName: 'waCRM', state: 'open' } })
    );
    const adapter = new EvolutionAdapter();
    const identity = await adapter.verifyConfiguration(makeConfig());
    expect(identity.provider).toBe('evolution');
    expect(identity.displayName).toBe('waCRM');
    expect(identity.providerInstanceId).toBe('waCRM');
  });

  it('throws 404 when instance state is undefined (instance does not exist)', async () => {
    setupFetch(
      jsonResponse({ instance: { instanceName: 'waCRM', state: undefined } })
    );
    const adapter = new EvolutionAdapter();
    await expect(
      adapter.verifyConfiguration(makeConfig())
    ).rejects.toMatchObject({
      code: 'PROVIDER_API_ERROR',
      status: 404,
    });
  });

  it('maps HTTP 401 to ProviderError status', async () => {
    setupFetch(
      jsonResponse(
        {
          status: 401,
          error: 'Unauthorized',
          response: { message: 'Invalid api key' },
        },
        401,
        'Unauthorized'
      )
    );
    const adapter = new EvolutionAdapter();
    await expect(
      adapter.verifyConfiguration(makeConfig())
    ).rejects.toMatchObject({
      code: 'PROVIDER_API_ERROR',
      status: 401,
    });
  });
});

describe('EvolutionAdapter getConnectionStatus', () => {
  it('reports connected for open state', async () => {
    setupFetch(
      jsonResponse({ instance: { instanceName: 'waCRM', state: 'open' } })
    );
    const adapter = new EvolutionAdapter();
    const status = await adapter.getConnectionStatus(makeConfig());
    expect(status.connected).toBe(true);
    expect(status.detail).toBe('open');
  });

  it('reports disconnected for connecting state', async () => {
    setupFetch(
      jsonResponse({ instance: { instanceName: 'waCRM', state: 'connecting' } })
    );
    const adapter = new EvolutionAdapter();
    const status = await adapter.getConnectionStatus(makeConfig());
    expect(status.connected).toBe(false);
    expect(status.detail).toBe('connecting');
  });

  it('reports disconnected for close state', async () => {
    setupFetch(
      jsonResponse({ instance: { instanceName: 'waCRM', state: 'close' } })
    );
    const adapter = new EvolutionAdapter();
    const status = await adapter.getConnectionStatus(makeConfig());
    expect(status.connected).toBe(false);
    expect(status.detail).toBe('close');
  });

  it('returns false and an error detail when the API is unreachable', async () => {
    setupFetch(Promise.reject(new TypeError('fetch failed')));
    const adapter = new EvolutionAdapter();
    const status = await adapter.getConnectionStatus(makeConfig());
    expect(status.connected).toBe(false);
    expect(status.detail).toMatch(/unreachable/);
  });
});

describe('EvolutionAdapter createOrConnect', () => {
  it('creates the instance when it does not exist and returns a QR', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ instance: { instanceName: 'waCRM', state: undefined } })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          instance: { instanceName: 'waCRM', state: 'close' },
          hash: 'TOKEN',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: '2@abc',
          base64: 'data:image/png;base64,iVBORw0KGgo',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          instance: { instanceName: 'waCRM', state: 'connecting' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new EvolutionAdapter();
    const result = await adapter.createOrConnect(makeConfig());

    expect(result.qr).not.toBeNull();
    expect(result.qr?.base64).toBe('data:image/png;base64,iVBORw0KGgo');
    expect(result.status.connected).toBe(false);

    const createCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(createCall[0]).toBe('https://evolution.example.com/instance/create');
    expect(createCall[1].method).toBe('POST');
    const body = JSON.parse(createCall[1].body as string);
    expect(body.instanceName).toBe('waCRM');
    expect(body.qrcode).toBe(true);
  });

  it('skips creation when instance already exists', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ instance: { instanceName: 'waCRM', state: 'close' } })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: '2@abc',
          base64: 'data:image/png;base64,iVBORw0KGgo',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          instance: { instanceName: 'waCRM', state: 'connecting' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new EvolutionAdapter();
    const result = await adapter.createOrConnect(makeConfig());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.qr).not.toBeNull();
  });

  it('tolerates a race where another request created the instance', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ instance: { instanceName: 'waCRM', state: undefined } })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: true, message: 'The "waCRM" instance already exists' },
          200
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: '2@abc',
          base64: 'data:image/png;base64,iVBORw0KGgo',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          instance: { instanceName: 'waCRM', state: 'connecting' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new EvolutionAdapter();
    const result = await adapter.createOrConnect(makeConfig());
    expect(result.qr).not.toBeNull();
  });
});

describe('EvolutionAdapter getQrCode', () => {
  it('extracts QR from nested qrcode object', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          qrcode: {
            base64: 'data:image/png;base64,iVBORw0KGgo',
            code: '2@abc',
          },
          instance: { instanceName: 'waCRM', status: 'connecting' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          instance: { instanceName: 'waCRM', state: 'connecting' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new EvolutionAdapter();
    const result = await adapter.getQrCode(makeConfig());
    expect(result.qr?.base64).toBe('data:image/png;base64,iVBORw0KGgo');
  });

  it('returns null QR when not available and not connected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          instance: { instanceName: 'waCRM', state: 'connecting' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new EvolutionAdapter();
    const result = await adapter.getQrCode(makeConfig());
    expect(result.qr).toBeNull();
    expect(result.status.detail).toBe('QR not available yet');
  });
});

describe('EvolutionAdapter sendText', () => {
  it('sends text and returns the provider message id', async () => {
    setupFetch(
      jsonResponse({
        key: { id: 'MSG-123' },
        messageTimestamp: 1700000000,
        status: 'SERVER_ACK',
      })
    );

    const adapter = new EvolutionAdapter();
    const result = await adapter.sendText(
      {
        db: {} as never,
        accountId: 'acct-1',
        userId: 'u-1',
        conversationId: 'cv-1',
        contactId: 'ct-1',
        to: '+15551234567',
        text: 'Hello',
      },
      makeConfig()
    );

    expect(result.provider).toBe('evolution');
    expect(result.providerMessageId).toBe('MSG-123');
    expect(result.status).toBe('sent');

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.number).toBe('15551234567');
    expect(body.text).toBe('Hello');
  });

  it('maps HTTP 403 to a ProviderError status', async () => {
    setupFetch(
      jsonResponse(
        {
          status: 403,
          error: 'Forbidden',
          response: { message: 'apikey not authorized' },
        },
        403,
        'Forbidden'
      )
    );

    const adapter = new EvolutionAdapter();
    await expect(
      adapter.sendText(
        {
          db: {} as never,
          accountId: 'acct-1',
          userId: 'u-1',
          conversationId: 'cv-1',
          contactId: 'ct-1',
          to: '+15551234567',
          text: 'Hello',
        },
        makeConfig()
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_API_ERROR', status: 403 });
  });
});

describe('EvolutionAdapter configureWebhook', () => {
  it('sets the webhook with the secret header', async () => {
    setupFetch(jsonResponse({}));

    const adapter = new EvolutionAdapter();
    await adapter.configureWebhook(
      makeConfig(),
      'https://wacrm.example.com/api/whatsapp/evolution/webhook',
      'webhook-secret'
    );

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('https://evolution.example.com/webhook/set/waCRM');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.webhook.enabled).toBe(true);
    expect(body.webhook.url).toBe(
      'https://wacrm.example.com/api/whatsapp/evolution/webhook'
    );
    expect(body.webhook.headers.apikey).toBe('webhook-secret');
    expect(body.webhook.events).toContain('MESSAGES_UPSERT');
  });
});

describe('EvolutionAdapter normalizeInbound', () => {
  it('normalizes a text message upsert', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'messages.upsert',
      instance: 'waCRM',
      data: {
        key: {
          remoteJid: '15551234567@s.whatsapp.net',
          fromMe: false,
          id: 'MSG-1',
        },
        message: { conversation: 'Hi there' },
        messageTimestamp: 1700000000,
        pushName: 'Alice',
      },
      apikey: 'secret-token',
      server_url: 'https://evolution.example.com',
    });

    expect(events).toHaveLength(1);
    const event = events[0] as {
      senderPhone: string;
      contentText: string;
      providerInstanceId: string;
    };
    expect(event.senderPhone).toBe('15551234567');
    expect(event.contentText).toBe('Hi there');
    expect(event.providerInstanceId).toBe('waCRM');
  });

  it('does not confuse messages.upsert status field with a status update', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'messages.upsert',
      instance: 'waCRM',
      data: {
        key: {
          remoteJid: '15551234567@s.whatsapp.net',
          fromMe: false,
          id: 'MSG-1',
        },
        message: { conversation: 'Hi there' },
        status: 'DELIVERED',
        messageTimestamp: 1700000000,
      },
    });

    expect(events).toHaveLength(1);
    expect('recipientPhone' in events[0]).toBe(false);
    expect((events[0] as { contentText: string }).contentText).toBe('Hi there');
  });

  it('normalizes messages.update status events using keyId', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'messages.update',
      instance: 'waCRM',
      data: {
        keyId: 'MSG-1',
        remoteJid: '15551234567@s.whatsapp.net',
        status: 'READ',
        messageTimestamp: 1700000000,
      },
    });

    expect(events).toHaveLength(1);
    const event = events[0] as {
      providerMessageId: string;
      status: string;
      recipientPhone: string;
    };
    expect(event.providerMessageId).toBe('MSG-1');
    expect(event.status).toBe('read');
    expect(event.recipientPhone).toBe('15551234567');
  });

  it('normalizes nested Baileys message update statuses', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'messages.update',
      instance: 'waCRM',
      data: {
        key: {
          id: 'MSG-NESTED-1',
          remoteJid: '15551234567@s.whatsapp.net',
        },
        update: { status: 4 },
        messageTimestamp: 1700000000,
      },
    });

    expect(events).toHaveLength(1);
    expect((events[0] as { providerMessageId: string }).providerMessageId).toBe(
      'MSG-NESTED-1',
    );
    expect((events[0] as { status: string }).status).toBe('read');
  });

  it('maps played status to read', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'messages.update',
      instance: 'waCRM',
      data: {
        keyId: 'MSG-PLAYED-1',
        remoteJid: '15551234567@s.whatsapp.net',
        status: 'PLAYED',
      },
    });

    expect((events[0] as { status: string }).status).toBe('read');
  });

  it('does not let an unknown provider status masquerade as sent', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'messages.update',
      instance: 'waCRM',
      data: {
        keyId: 'MSG-UNKNOWN-1',
        remoteJid: '15551234567@s.whatsapp.net',
        status: 'SOMETHING_NEW',
      },
    });

    expect(events).toHaveLength(0);
  });

  it('normalizes QR code events and strips secrets from rawPayload', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'qrcode.updated',
      instance: 'waCRM',
      data: {
        qrcode: {
          base64: 'data:image/png;base64,iVBORw0KGgo',
          code: '2@abc',
        },
      },
      apikey: 'secret-token',
      server_url: 'https://evolution.example.com',
    });

    expect(events).toHaveLength(1);
    const event = events[0] as {
      mediaUrl: string;
      rawPayload: Record<string, unknown>;
    };
    expect(event.mediaUrl).toBe('data:image/png;base64,iVBORw0KGgo');
    expect(event.rawPayload.apikey).toBeUndefined();
    expect(event.rawPayload.server_url).toBeUndefined();
  });

  it('normalizes connection updates and uses instance as providerInstanceId', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'connection.update',
      instance: 'waCRM',
      data: { state: 'open', statusReason: 200 },
      apikey: 'secret-token',
    });

    expect(events).toHaveLength(1);
    const event = events[0] as {
      providerInstanceId: string;
      contentText: string;
      rawPayload: Record<string, unknown>;
    };
    expect(event.providerInstanceId).toBe('waCRM');
    expect(event.contentText).toBe('Connection state: open');
    expect(event.rawPayload.apikey).toBeUndefined();
  });

  it('ignores unknown event types', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'chats.upsert',
      instance: 'waCRM',
      data: {},
    });
    expect(events).toHaveLength(0);
  });
});

describe('EvolutionAdapter secret handling', () => {
  it('sends only the apikey header, never Authorization', async () => {
    setupFetch(
      jsonResponse({ instance: { instanceName: 'waCRM', state: 'open' } })
    );

    const adapter = new EvolutionAdapter();
    await adapter.verifyConfiguration(makeConfig());

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBeDefined();
    expect(headers.Authorization).toBeUndefined();
  });

  it('does not leak the API key in error messages', async () => {
    setupFetch(
      jsonResponse(
        {
          status: 401,
          error: 'Unauthorized',
          response: { message: 'Invalid api key' },
        },
        401,
        'Unauthorized'
      )
    );

    const adapter = new EvolutionAdapter();
    await expect(adapter.verifyConfiguration(makeConfig())).rejects.toSatisfy(
      (err: ProviderError) => {
        return (
          err.message.includes('Evolution API error') &&
          !err.message.includes('evolution-api-key')
        );
      }
    );
  });
});

describe('EvolutionAdapter configureWebhook URL validation', () => {
  it('rejects a webhook URL prefixed with @url:', async () => {
    const adapter = new EvolutionAdapter();
    await expect(
      adapter.configureWebhook(
        makeConfig(),
        '@url:https://wacrm.example.com/webhook',
        'secret'
      )
    ).rejects.toMatchObject({ code: 'CONFIGURATION_INVALID' });
  });

  it('rejects a webhook URL containing backticks', async () => {
    const adapter = new EvolutionAdapter();
    await expect(
      adapter.configureWebhook(
        makeConfig(),
        '`https://wacrm.example.com/webhook`',
        'secret'
      )
    ).rejects.toMatchObject({ code: 'CONFIGURATION_INVALID' });
  });
});

describe('EvolutionAdapter historical import', () => {
  it('findContacts paginates through contacts', async () => {
    setupFetch(
      jsonResponse({
        contacts: [
          {
            id: 'c1',
            remoteJid: '15551234567@s.whatsapp.net',
            pushName: 'Alice',
          },
          {
            id: 'c2',
            remoteJid: '15559876543@s.whatsapp.net',
            pushName: 'Bob',
          },
        ],
        total: 2,
      })
    );

    const adapter = new EvolutionAdapter();
    const contacts = await adapter.findContacts(makeConfig(), {
      limit: 50,
      offset: 0,
    });

    expect(contacts).toHaveLength(2);
    expect(contacts[0].remoteJid).toBe('15551234567@s.whatsapp.net');
    expect(contacts[1].pushName).toBe('Bob');

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('https://evolution.example.com/chat/findContacts/waCRM');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      limit: 50,
      offset: 0,
    });
  });

  it('findContacts drops LID entries that have a PN twin in the same response', async () => {
    setupFetch(
      jsonResponse({
        contacts: [
          {
            id: 'c1',
            remoteJid: '15551234567@s.whatsapp.net',
            pushName: 'Alice',
          },
          { id: 'c2', remoteJid: '232134862233733@lid', pushName: 'Alice' },
          {
            id: 'c3',
            remoteJid: '15559876543@s.whatsapp.net',
            pushName: 'Bob',
          },
          // Unpaired LID: kept here, the import layer skips it (no phone).
          { id: 'c4', remoteJid: '241357803152418@lid', pushName: 'Carol' },
        ],
      })
    );

    const adapter = new EvolutionAdapter();
    const contacts = await adapter.findContacts(makeConfig());

    expect(contacts.map((c) => c.remoteJid)).toEqual([
      '15551234567@s.whatsapp.net',
      '15559876543@s.whatsapp.net',
      '241357803152418@lid',
    ]);
  });

  it('findMessages filters by remoteJid', async () => {
    setupFetch(
      jsonResponse({
        messages: [
          {
            key: {
              remoteJid: '15551234567@s.whatsapp.net',
              fromMe: false,
              id: 'HIST-1',
            },
            message: { conversation: 'Old hello' },
            messageTimestamp: 1700000000,
          },
        ],
      })
    );

    const adapter = new EvolutionAdapter();
    const messages = await adapter.findMessages(
      makeConfig(),
      '15551234567@s.whatsapp.net',
      {
        limit: 100,
        offset: 0,
      }
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].key?.id).toBe('HIST-1');

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('https://evolution.example.com/chat/findMessages/waCRM');
    const body = JSON.parse(init.body as string);
    expect(body.where.key.remoteJid).toBe('15551234567@s.whatsapp.net');
  });

  it('normalizeHistoricalMessage skips group JIDs', () => {
    const adapter = new EvolutionAdapter();
    const event = adapter.normalizeHistoricalMessage({
      key: { remoteJid: '120363000000000000@g.us', fromMe: false, id: 'G-1' },
      message: { conversation: 'Group message' },
      messageTimestamp: 1700000000,
    });

    // A group JID is not a user phone; storing its digits would create a
    // garbage contact (docs/evolution-api/spec-contact-phone-normalization.md).
    expect(event).toBeNull();
  });

  it('normalizeHistoricalMessage resolves a LID through remoteJidAlt', () => {
    const adapter = new EvolutionAdapter();
    const event = adapter.normalizeHistoricalMessage({
      key: {
        remoteJid: '1490236991@lid',
        remoteJidAlt: '584263895492@s.whatsapp.net',
        fromMe: false,
        id: 'LID-1',
      },
      message: { conversation: 'Hola' },
      messageTimestamp: 1700000000,
      pushName: 'Rosalys',
    });

    expect(event).not.toBeNull();
    expect(event?.senderPhone).toBe('584263895492');
  });

  it('normalizeHistoricalMessage skips a LID without an alternate phone', () => {
    const adapter = new EvolutionAdapter();
    const event = adapter.normalizeHistoricalMessage({
      key: { remoteJid: '1490236991@lid', fromMe: false, id: 'LID-2' },
      message: { conversation: 'Hola' },
      messageTimestamp: 1700000000,
    });

    expect(event).toBeNull();
  });

  it('normalizeHistoricalMessage strips the device suffix', () => {
    const adapter = new EvolutionAdapter();
    const event = adapter.normalizeHistoricalMessage({
      key: {
        remoteJid: '584263895492:2@s.whatsapp.net',
        fromMe: false,
        id: 'DEV-1',
      },
      message: { conversation: 'Hola' },
      messageTimestamp: 1700000000,
    });

    expect(event).not.toBeNull();
    expect(event?.senderPhone).toBe('584263895492');
  });

  it('normalizeHistoricalMessage skips an invalid PN user part instead of truncating it', () => {
    const adapter = new EvolutionAdapter();
    const event = adapter.normalizeHistoricalMessage({
      key: {
        remoteJid: '5842638954921490236991@s.whatsapp.net',
        fromMe: false,
        id: 'BAD-1',
      },
      message: { conversation: 'Hola' },
      messageTimestamp: 1700000000,
    });

    // 22 digits is not E.164; without an alt mapping the event is dropped.
    expect(event).toBeNull();
  });

  it('normalizeHistoricalMessage marks own messages as fromMe', () => {
    const adapter = new EvolutionAdapter();
    const event = adapter.normalizeHistoricalMessage({
      key: {
        remoteJid: '15551234567@s.whatsapp.net',
        fromMe: true,
        id: 'OWN-1',
      },
      message: { conversation: 'Sent from phone' },
      messageTimestamp: 1700000000,
    });

    expect(event).not.toBeNull();
    expect(event?.isFromMe).toBe(true);
    expect(event?.contentText).toBe('Sent from phone');
  });
});
