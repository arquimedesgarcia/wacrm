import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { encrypt } from '@/lib/whatsapp/encryption'

const configUpdates: Array<Record<string, unknown>> = []

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init)),
  },
  after: vi.fn((cb: () => Promise<void>) => cb()),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => makeSupabaseMock()),
}))

function makeSupabaseMock() {
  const builder = {
    from: vi.fn((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data:
              table === 'whatsapp_config'
                ? {
                    id: 'cfg-1',
                    account_id: 'acct-1',
                    provider: 'evolution',
                    evolution_instance_name: 'waCRM',
                    evolution_webhook_secret: encrypt('webhook-secret'),
                    user_id: 'owner-1',
                    status: 'disconnected',
                  }
                : null,
            error: null,
          }),
        ),
        update: vi.fn((payload: Record<string, unknown>) => {
          if (table === 'whatsapp_config') {
            configUpdates.push(payload)
          }
          return chain
        }),
      }
      return chain
    }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  }
  return builder
}

beforeEach(() => {
  vi.restoreAllMocks()
  configUpdates.length = 0
})

afterEach(() => {
  vi.resetModules()
})

async function makePostRequest(payload: unknown) {
  const { POST } = await import('./route')
  const request = new Request('https://wacrm.example.com/api/whatsapp/evolution/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: 'webhook-secret' },
    body: JSON.stringify(payload),
  })
  return POST(request)
}

describe('Evolution webhook connection updates', () => {
  it('updates whatsapp_config.status to connected on CONNECTION_UPDATE open', async () => {
    const response = await makePostRequest({
      event: 'CONNECTION_UPDATE',
      instance: 'waCRM',
      data: { state: 'open' },
    })

    expect(response.status).toBe(200)
    expect(configUpdates).toHaveLength(1)
    expect(configUpdates[0].status).toBe('connected')
    expect(configUpdates[0].connected_at).toBeDefined()
  })

  it('updates whatsapp_config.status to disconnected on CONNECTION_UPDATE close', async () => {
    const response = await makePostRequest({
      event: 'CONNECTION_UPDATE',
      instance: 'waCRM',
      data: { state: 'close' },
    })

    expect(response.status).toBe(200)
    expect(configUpdates).toHaveLength(1)
    expect(configUpdates[0].status).toBe('disconnected')
  })

  it('treats connecting as disconnected', async () => {
    const response = await makePostRequest({
      event: 'CONNECTION_UPDATE',
      instance: 'waCRM',
      data: { state: 'connecting' },
    })

    expect(response.status).toBe(200)
    expect(configUpdates[0].status).toBe('disconnected')
  })
})
