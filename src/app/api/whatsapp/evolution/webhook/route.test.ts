import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { encrypt } from '@/lib/whatsapp/encryption';
import { POST } from './route';

// Hoisted mock state. `encrypt` is called lazily (not inside vi.hoisted)
// to avoid TDZ on the encryption module import.
const h = {
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  state: {
    config: null as Record<string, unknown> | null,
    messagesInserts: [] as Record<string, unknown>[],
    messageUpsertConflicts: 0,
    conversationUpdates: [] as Record<string, unknown>[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    storageUploads: [] as { bucket: string; path: string }[],
    contactsFindOrCreate: 0,
    conversationsFindOrCreate: 0,
    mediaBase64: null as string | null,
    existingMessage: null as Record<string, unknown> | null,
    messageUpdates: [] as Record<string, unknown>[],
    reactionUpserts: [] as Record<string, unknown>[],
    reactionDeletes: [] as Record<string, unknown>[],
  },
};

function buildConfig(): Record<string, unknown> {
  return {
    id: 'cfg-1',
    account_id: 'acct-1',
    provider: 'evolution',
    evolution_instance_name: 'waCRM',
    evolution_webhook_secret: encrypt('webhook-secret'),
    evolution_base_url: 'https://evolution.example.com',
    evolution_api_key: encrypt('evolution-api-key'),
    user_id: 'owner-1',
    status: 'disconnected',
  };
}

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), init)
    ),
  },
  after: (cb: () => Promise<void> | void) => {
    h.afterCallbacks.push(cb);
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => makeSupabaseMock()),
}));

function makeSupabaseMock() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    like: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data:
          h.state.config?.provider === 'evolution' &&
          h.state.config?.evolution_instance_name
            ? h.state.config
            : null,
        error: null,
      })
    ),
    single: vi.fn(() =>
      Promise.resolve({ data: { id: 'row-1' }, error: null })
    ),
    update: vi.fn(() => chain),
    insert: vi.fn((row: Record<string, unknown>) => {
      h.state.messagesInserts.push(row);
      return chain;
    }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'conversations') {
        return {
          ...chain,
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() =>
                    Promise.resolve({
                      data: [
                        { id: 'conv-1', account_id: 'acct-1', unread_count: 0 },
                      ],
                      error: null,
                    })
                  ),
                })),
              })),
            })),
          })),
          insert: vi.fn((row: Record<string, unknown>) => {
            h.state.conversationsFindOrCreate += 1;
            return {
              select: vi.fn(() =>
                Promise.resolve({ data: { id: 'conv-1', ...row }, error: null })
              ),
            };
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            h.state.conversationUpdates.push(payload);
            return Promise.resolve({ error: null });
          }),
        };
      }
      if (table === 'contacts') {
        const contactChain = {
          like: vi.fn(() => ({
            maybeSingle: vi.fn(() => {
              h.state.contactsFindOrCreate += 1;
              return Promise.resolve({
                data: { id: 'contact-1' },
                error: null,
              });
            }),
          })),
          maybeSingle: vi.fn(() => {
            h.state.contactsFindOrCreate += 1;
            return Promise.resolve({ data: { id: 'contact-1' }, error: null });
          }),
        };
        return {
          ...chain,
          select: vi.fn(() => ({ eq: vi.fn(() => contactChain) })),
          insert: vi.fn((row: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: { id: 'contact-1', ...row },
                  error: null,
                })
              ),
            })),
          })),
        };
      }
      if (table === 'message_reactions') {
        return {
          ...chain,
          select: vi.fn(() => chain),
          upsert: vi.fn((row: Record<string, unknown>) => {
            h.state.reactionUpserts.push(row);
            return Promise.resolve({ data: row, error: null });
          }),
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => {
                  h.state.reactionDeletes.push({ deleted: true });
                  return Promise.resolve({ error: null });
                }),
              })),
            })),
          })),
        };
      }
      if (table === 'messages') {
        const msgChain = {
          eq: vi.fn(() => msgChain),
          limit: vi.fn(() => msgChain),
          maybeSingle: vi.fn(() => {
            if (h.state.existingMessage) {
              return Promise.resolve({
                data: h.state.existingMessage,
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          }),
        };
        return {
          ...chain,
          select: vi.fn(() => msgChain),
          insert: vi.fn((row: Record<string, unknown>) => {
            h.state.messagesInserts.push(row);
            return {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({ data: { id: 'msg-1' }, error: null })
                ),
              })),
            };
          }),
          upsert: vi.fn((row: Record<string, unknown>) => {
            h.state.messagesInserts.push(row);
            return {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({ data: { id: 'msg-1' }, error: null })
                ),
              })),
            };
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            h.state.messageUpdates.push(payload);
            return Promise.resolve({ error: null });
          }),
        };
      }
      return chain;
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from: () => ({
        upload: (path: string) => {
          h.state.storageUploads.push({ bucket: 'chat-media', path });
          return Promise.resolve({ error: null });
        },
        getPublicUrl: (p: string) => ({
          data: { publicUrl: `https://cdn.test/chat-media/${p}` },
        }),
      }),
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  h.state.config = buildConfig();
  h.state.messagesInserts = [];
  h.state.messageUpsertConflicts = 0;
  h.state.conversationUpdates = [];
  h.state.rpcCalls = [];
  h.state.storageUploads = [];
  h.state.contactsFindOrCreate = 0;
  h.state.conversationsFindOrCreate = 0;
  h.state.mediaBase64 = Buffer.from('hello-bytes').toString('base64');
  h.state.existingMessage = null;
  h.state.messageUpdates = [];
  h.state.reactionUpserts = [];
  h.state.reactionDeletes = [];
});

afterEach(() => {
  vi.resetModules();
});

function makePostRequest(payload: unknown, secret?: string) {
  const request = new Request(
    'https://wacrm.example.com/api/whatsapp/evolution/webhook',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: secret ?? 'webhook-secret',
      },
      body: JSON.stringify(payload),
    }
  );
  return POST(request as never).then(async (res) => {
    for (const cb of h.afterCallbacks) {
      await cb();
    }
    h.afterCallbacks = [];
    return res;
  });
}

// Intercept Evolution media fetch to return the hoisted base64.
function stubEvolutionFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.includes('getBase64FromMediaMessage')
      ) {
        if (!h.state.mediaBase64) {
          return new Response('', { status: 404 });
        }
        return new Response(
          JSON.stringify({
            base64: h.state.mediaBase64,
            mimetype: 'image/jpeg',
            fileName: null,
            size: { fileLength: String(Buffer.from('hello-bytes').byteLength) },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    })
  );
}

describe('Evolution webhook: customer reactions', () => {
  it('upserts a resolved reaction without inserting a message or firing automation', async () => {
    h.state.existingMessage = {
      id: 'target-local-1',
      conversation_id: 'conv-1',
      conversations: { contact_id: 'contact-1' },
    };

    await makePostRequest({
      event: 'MESSAGES_UPSERT',
      instance: 'waCRM',
      data: {
        key: { remoteJid: '15551234567@s.whatsapp.net', id: 'REACTION-1' },
        message: {
          reactionMessage: {
            key: { remoteJid: '15551234567@s.whatsapp.net', id: 'TARGET-1' },
            text: '❤️',
          },
        },
        messageTimestamp: 1700000000,
      },
    });

    expect(h.state.reactionUpserts).toEqual([
      expect.objectContaining({
        message_id: 'target-local-1',
        actor_type: 'customer',
        actor_id: 'contact-1',
        emoji: '❤️',
      }),
    ]);
    expect(h.state.messagesInserts).toEqual([]);
    expect(h.state.rpcCalls).toEqual([]);
  });

  it('creates a non-empty fallback message when the target is not local', async () => {
    await makePostRequest({
      event: 'MESSAGES_UPSERT',
      instance: 'waCRM',
      data: {
        key: {
          remoteJid: '15551234567@s.whatsapp.net',
          id: 'REACTION-FALLBACK-1',
        },
        message: {
          reactionMessage: {
            key: {
              remoteJid: '15551234567@s.whatsapp.net',
              id: 'MISSING-TARGET',
            },
            text: '🔥',
          },
        },
      },
    });

    const fallback = h.state.messagesInserts.find(
      (message) => message.message_id === 'REACTION-FALLBACK-1'
    );
    expect(fallback).toMatchObject({
      content_type: 'text',
      content_text: '🔥',
      sender_type: 'customer',
    });
    expect(fallback?.content_text).not.toBe('');
  });

  it('removes a resolved customer reaction without creating an empty message', async () => {
    h.state.existingMessage = {
      id: 'target-local-1',
      conversation_id: 'conv-1',
      conversations: { contact_id: 'contact-1' },
    };

    await makePostRequest({
      event: 'MESSAGES_UPSERT',
      instance: 'waCRM',
      data: {
        key: { remoteJid: '15551234567@s.whatsapp.net', id: 'REACTION-2' },
        message: {
          reactionMessage: {
            key: { remoteJid: '15551234567@s.whatsapp.net', id: 'TARGET-1' },
            text: '',
          },
        },
      },
    });

    expect(h.state.reactionDeletes).toHaveLength(1);
    expect(h.state.messagesInserts).toEqual([]);
  });
});

describe('Evolution webhook: inbound image media', () => {
  it('persists a durable chat-media URL for an inbound image', async () => {
    stubEvolutionFetch();

    await makePostRequest({
      event: 'MESSAGES_UPSERT',
      instance: 'waCRM',
      data: {
        messages: [
          {
            key: {
              remoteJid: '15551234567@s.whatsapp.net',
              fromMe: false,
              id: 'IMG-IN-1',
            },
            message: {
              imageMessage: { mimetype: 'image/jpeg', caption: 'look' },
            },
            messageTimestamp: 1700000000,
          },
        ],
      },
    });

    const inserted = h.state.messagesInserts.find(
      (m) => m.message_id === 'IMG-IN-1'
    );
    expect(inserted).toBeDefined();
    expect(inserted?.sender_type).toBe('customer');
    expect(String(inserted?.media_url)).toContain('chat-media');
    expect(inserted?.media_type).toBe('image/jpeg');
    expect(inserted?.content_type).toBe('image');
    // Mirror used the account-scoped path.
    expect(h.state.storageUploads.length).toBeGreaterThan(0);
  });

  it('persists text even when media fetch fails', async () => {
    h.state.mediaBase64 = null;
    stubEvolutionFetch();

    await makePostRequest({
      event: 'MESSAGES_UPSERT',
      instance: 'waCRM',
      data: {
        messages: [
          {
            key: {
              remoteJid: '15551234567@s.whatsapp.net',
              fromMe: false,
              id: 'IMG-FAIL-1',
            },
            message: {
              imageMessage: { mimetype: 'image/jpeg', caption: 'still text' },
            },
            messageTimestamp: 1700000000,
          },
        ],
      },
    });

    const inserted = h.state.messagesInserts.find(
      (m) => m.message_id === 'IMG-FAIL-1'
    );
    expect(inserted).toBeDefined();
    expect(inserted?.media_url).toBeNull();
    expect(inserted?.content_text).toBe('still text');
  });
});

describe('Evolution webhook: fromMe reply written on the phone', () => {
  it('creates an agent message + bumps summary without unread', async () => {
    stubEvolutionFetch();

    await makePostRequest({
      event: 'MESSAGES_UPSERT',
      instance: 'waCRM',
      data: {
        messages: [
          {
            key: {
              remoteJid: '15551234567@s.whatsapp.net',
              fromMe: true,
              id: 'PHONE-REPLY-1',
            },
            message: { conversation: 'Replied from my phone' },
            messageTimestamp: 1700000000,
          },
        ],
      },
    });

    const inserted = h.state.messagesInserts.find(
      (m) => m.message_id === 'PHONE-REPLY-1'
    );
    expect(inserted).toBeDefined();
    expect(inserted?.sender_type).toBe('agent');
    expect(inserted?.content_text).toBe('Replied from my phone');

    // Summary refreshed, but NOT via the inbound RPC (which bumps unread).
    expect(
      h.state.rpcCalls.some((c) => c.name === 'bump_conversation_on_outbound')
    ).toBe(true);
    expect(
      h.state.rpcCalls.some((c) => c.name === 'bump_conversation_on_inbound')
    ).toBe(false);
  });

  it('does not create a duplicate when an existing outbound row exists', async () => {
    stubEvolutionFetch();
    h.state.existingMessage = {
      message_id: 'DUP-1',
      conversation_id: 'conv-1',
    };

    const request = new Request(
      'https://wacrm.example.com/api/whatsapp/evolution/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: 'webhook-secret',
        },
        body: JSON.stringify({
          event: 'MESSAGES_UPSERT',
          instance: 'waCRM',
          data: {
            messages: [
              {
                key: {
                  remoteJid: '15551234567@s.whatsapp.net',
                  fromMe: true,
                  id: 'DUP-1',
                },
                message: { conversation: 'dup' },
                messageTimestamp: 1700000000,
              },
            ],
          },
        }),
      }
    );

    await makePostRequest(JSON.parse(await request.text()));
    expect(
      h.state.messagesInserts.filter((m) => m.message_id === 'DUP-1').length
    ).toBe(0);
  });
});

describe('Evolution webhook: status updates advance outbound state', () => {
  it('updates an outbound message to delivered', async () => {
    stubEvolutionFetch();
    h.state.existingMessage = {
      message_id: 'OUT-1',
      conversation_id: 'conv-1',
      status: 'sent',
    };

    await makePostRequest({
      event: 'MESSAGES_UPDATE',
      instance: 'waCRM',
      data: {
        keyId: 'OUT-1',
        remoteJid: '15551234567@s.whatsapp.net',
        status: 'DELIVERED',
      },
    });

    expect(h.state.messageUpdates).toContainEqual({ status: 'delivered' });
  });

  it('does not downgrade a read message back to delivered', async () => {
    stubEvolutionFetch();
    h.state.existingMessage = {
      message_id: 'OUT-READ-1',
      conversation_id: 'conv-1',
      status: 'read',
    };

    await makePostRequest({
      event: 'MESSAGES_UPDATE',
      instance: 'waCRM',
      data: {
        keyId: 'OUT-READ-1',
        remoteJid: '15551234567@s.whatsapp.net',
        status: 'DELIVERED',
      },
    });

    expect(h.state.messageUpdates.some((u) => u.status === 'delivered')).toBe(
      false
    );
  });
});
