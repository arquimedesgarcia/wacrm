import { describe, expect, it, beforeEach, vi } from 'vitest';
import { encrypt } from '@/lib/whatsapp/encryption';
import { EvolutionAdapter } from './evolution-adapter';
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

describe('EvolutionAdapter upsert status propagation', () => {
  it('emits a status event when an upsert message carries a delivered status', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'messages.upsert',
      instance: 'waCRM',
      data: {
        messages: [
          {
            key: {
              remoteJid: '15551234567@s.whatsapp.net',
              fromMe: true,
              id: 'OUT-STATUS-1',
            },
            message: { conversation: 'hi' },
            status: 'DELIVERED',
            messageTimestamp: 1700000000,
          },
        ],
      },
    });

    const statusEvent = events.find(
      (e) => 'recipientPhone' in e && e.providerMessageId === 'OUT-STATUS-1'
    ) as { status: string } | undefined;
    expect(statusEvent).toBeDefined();
    expect(statusEvent?.status).toBe('delivered');
  });

  it('does not emit a status event for a plain text inbound message', () => {
    const adapter = new EvolutionAdapter();
    const events = adapter.normalizeInbound({
      event: 'messages.upsert',
      instance: 'waCRM',
      data: {
        messages: [
          {
            key: {
              remoteJid: '15551234567@s.whatsapp.net',
              fromMe: false,
              id: 'IN-NOSTATUS-1',
            },
            message: { conversation: 'hello' },
            messageTimestamp: 1700000000,
          },
        ],
      },
    });

    const statusEvent = events.find(
      (e) => 'recipientPhone' in e && e.providerMessageId === 'IN-NOSTATUS-1'
    );
    expect(statusEvent).toBeUndefined();
  });
});
