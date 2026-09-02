import { describe, expect, it, vi, beforeEach } from 'vitest'

import { encrypt } from '@/lib/whatsapp/encryption'
import { importEvolutionHistory } from './evolution-import'
import type { WhatsAppConfig } from '@/types'

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(),
  isUniqueViolation: vi.fn((err: { code?: string } | null) => err?.code === '23505'),
}))

import { findExistingContact } from '@/lib/contacts/dedupe'

const encryptedApiKey = encrypt('evolution-api-key')

function makeConfig(overrides: Record<string, unknown> = {}): WhatsAppConfig {
  return {
    provider: 'evolution',
    evolution_base_url: 'https://evolution.example.com',
    evolution_api_key: encryptedApiKey,
    evolution_instance_name: 'waCRM',
    evolution_webhook_secret: encrypt('webhook-secret'),
    status: 'connected',
    user_id: 'owner-uuid',
    ...overrides,
  } as unknown as WhatsAppConfig
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Build a minimal chained Supabase mock that supports the exact queries
 * used by evolution-import.ts.
 */
function createMockDb(options: { existingMessages?: Array<Record<string, unknown>> } = {}) {
  const messages = options.existingMessages ? [...options.existingMessages] : []
  let messageSeq = 0
  let contactSeq = 0
  let conversationSeq = 0
  let currentTable = ''

  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => {
      if (currentTable === 'messages') {
        // The evolution-import helper queries by (conversation_id, message_id).
        // We don't track conversation_id, so return the first matching message_id
        // if the caller provided one through the chain. For simplicity, return null
        // on the first call and the existing row on any later call.
        return { data: messages[0] ?? null, error: null }
      }
      return { data: null, error: null }
    }),
    single: vi.fn(() => {
      if (currentTable === 'contacts') {
        contactSeq += 1
        return { data: { id: `contact-${contactSeq}` }, error: null }
      }
      if (currentTable === 'conversations') {
        conversationSeq += 1
        return { data: { id: `conv-${conversationSeq}` }, error: null }
      }
      return { data: null, error: null }
    }),
    insert: vi.fn((row: Record<string, unknown>) => {
      if (currentTable === 'messages') {
        messageSeq += 1
        messages.push({ id: `msg-${messageSeq}`, ...row })
      }
      return chain
    }),
    update: vi.fn(() => chain),
  }

  return {
    from: vi.fn((table: string) => {
      currentTable = table
      return chain
    }),
    _messages: messages,
  } as unknown as Parameters<typeof importEvolutionHistory>[0]['db']
}

beforeEach(() => {
  vi.restoreAllMocks()
  ;(findExistingContact as ReturnType<typeof vi.fn>).mockReset()
})

describe('importEvolutionHistory', () => {
  it('imports one contact and its recent text messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            contacts: [
              { id: 'c1', remoteJid: '15551234567@s.whatsapp.net', pushName: 'Alice' },
            ],
            total: 1,
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            messages: [
              {
                key: {
                  remoteJid: '15551234567@s.whatsapp.net',
                  fromMe: false,
                  id: 'HIST-1',
                },
                message: { conversation: 'Hello from history' },
                messageTimestamp: Math.floor(Date.now() / 1000) - 86400,
              },
            ],
          }),
        ),
    )

    ;(findExistingContact as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const db = createMockDb()

    const result = await importEvolutionHistory({
      db,
      accountId: 'account-1',
      ownerUserId: 'owner-1',
      config: makeConfig(),
    })

    expect(result.importedContacts).toBe(1)
    expect(result.importedMessages).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('skips messages older than the cutoff', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            contacts: [
              { id: 'c1', remoteJid: '15551234567@s.whatsapp.net', pushName: 'Alice' },
            ],
            total: 1,
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            messages: [
              {
                key: {
                  remoteJid: '15551234567@s.whatsapp.net',
                  fromMe: false,
                  id: 'HIST-OLD',
                },
                message: { conversation: 'Too old' },
                messageTimestamp: Math.floor(Date.now() / 1000) - 60 * 86400,
              },
            ],
          }),
        ),
    )

    ;(findExistingContact as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const db = createMockDb()

    const result = await importEvolutionHistory({
      db,
      accountId: 'account-1',
      ownerUserId: 'owner-1',
      config: makeConfig(),
      daysLimit: 30,
    })

    expect(result.importedMessages).toBe(0)
    expect(result.skippedMessages).toBe(1)
  })

  it('does not duplicate messages on a second run', async () => {
    const message = {
      key: {
        remoteJid: '15551234567@s.whatsapp.net',
        fromMe: false,
        id: 'HIST-1',
      },
      message: { conversation: 'Hello again' },
      messageTimestamp: Math.floor(Date.now() / 1000) - 86400,
    }

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            contacts: [{ id: 'c1', remoteJid: '15551234567@s.whatsapp.net', pushName: 'Alice' }],
            total: 1,
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ messages: [message] }))
        .mockResolvedValueOnce(
          jsonResponse({
            contacts: [{ id: 'c1', remoteJid: '15551234567@s.whatsapp.net', pushName: 'Alice' }],
            total: 1,
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ messages: [message] })),
    )

    ;(findExistingContact as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    // First run creates the message.
    const firstDb = createMockDb()
    const first = await importEvolutionHistory({
      db: firstDb,
      accountId: 'account-1',
      ownerUserId: 'owner-1',
      config: makeConfig(),
    })
    expect(first.importedMessages).toBe(1)

    // Second run should see the existing row and count it as skipped.
    const secondDb = createMockDb({ existingMessages: [{ id: 'msg-existing', message_id: 'HIST-1' }] })
    const second = await importEvolutionHistory({
      db: secondDb,
      accountId: 'account-1',
      ownerUserId: 'owner-1',
      config: makeConfig(),
    })
    expect(second.importedMessages).toBe(0)
    expect(second.skippedMessages).toBe(1)
  })

  it('skips group chats', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            contacts: [
              { id: 'g1', remoteJid: '120363000000000000@g.us', pushName: 'Group' },
            ],
            total: 1,
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ messages: [] })),
    )

    ;(findExistingContact as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const db = createMockDb()

    const result = await importEvolutionHistory({
      db,
      accountId: 'account-1',
      ownerUserId: 'owner-1',
      config: makeConfig(),
    })

    expect(result.skippedContacts).toBe(1)
    expect(result.importedContacts).toBe(0)
  })
})
