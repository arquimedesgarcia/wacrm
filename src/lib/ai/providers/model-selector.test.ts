import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetSelectorDiscoveryCacheForTests,
  ModelSelector,
  type SwitchReason,
} from './model-selector'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const NETWORK_FAIL = { kind: 'network' } as SwitchReason
const STATUS_404 = { kind: 'http_status', status: 404 } as SwitchReason
const STATUS_401 = { kind: 'http_status', status: 401 } as SwitchReason

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  __resetSelectorDiscoveryCacheForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const CATALOG = {
  data: [
    { id: 'm-small', pricing: { prompt: '0' }, context_length: 8000 },
    { id: 'm-big', pricing: { prompt: '0' }, context_length: 131072 },
    { id: 'm-paid', pricing: { prompt: '0.001' }, context_length: 32000 },
    { id: 'openrouter/free', pricing: { prompt: '0' }, context_length: 1000000 },
  ],
}

describe('ModelSelector', () => {
  it('returns the primary model on the first call', async () => {
    const sel = new ModelSelector({
      primary: 'primary-a',
      whitelist: [],
      autoRefresh: false,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk',
    })
    expect(await sel.nextModel(NETWORK_FAIL)).toBe('primary-a')
    expect(sel.attempts()).toBe(1)
  })

  it('iterates the whitelist in order', async () => {
    const sel = new ModelSelector({
      primary: 'primary',
      whitelist: ['w-1', 'w-2'],
      autoRefresh: false,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk',
    })
    expect(await sel.nextModel(STATUS_404)).toBe('primary')
    expect(await sel.nextModel(STATUS_404)).toBe('w-1')
    expect(await sel.nextModel(STATUS_404)).toBe('w-2')
    expect(await sel.nextModel(STATUS_404)).toBeNull()
  })

  it('falls back to dynamic discovery sorted by context desc', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(CATALOG)))
    const sel = new ModelSelector({
      primary: 'primary',
      whitelist: [],
      autoRefresh: true,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk',
    })
    expect(await sel.nextModel(STATUS_404)).toBe('primary')
    expect(await sel.nextModel(STATUS_404)).toBe('m-big')
    expect(await sel.nextModel(STATUS_404)).toBe('m-small')
  })

  it('skips paid and openrouter/free entries from the dynamic list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(CATALOG)))
    const sel = new ModelSelector({
      primary: 'primary',
      whitelist: [],
      autoRefresh: true,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk',
    })
    await sel.nextModel(STATUS_404)
    await sel.nextModel(STATUS_404)
    await sel.nextModel(STATUS_404)
    expect(await sel.nextModel(STATUS_404)).toBeNull()
    expect(sel.hasTriedDynamic()).toBe(true)
  })

  it('returns openrouter/free as last resort for OpenRouter when discovery yields nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [] })),
    )
    const sel = new ModelSelector({
      primary: 'primary',
      whitelist: [],
      autoRefresh: true,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk',
    })
    expect(await sel.nextModel(STATUS_404)).toBe('primary')
    expect(await sel.nextModel(STATUS_404)).toBe('openrouter/free')
    expect(await sel.nextModel(STATUS_404)).toBeNull()
  })

  it('does NOT use openrouter/free for non-OpenRouter providers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [] })),
    )
    const sel = new ModelSelector({
      primary: 'primary',
      whitelist: [],
      autoRefresh: true,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk',
    })
    expect(await sel.nextModel(STATUS_404)).toBe('primary')
    expect(await sel.nextModel(STATUS_404)).toBeNull()
  })

  it('returns null when autoRefresh is false and whitelist is empty', async () => {
    const sel = new ModelSelector({
      primary: 'primary',
      whitelist: [],
      autoRefresh: false,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk',
    })
    expect(await sel.nextModel(STATUS_404)).toBe('primary')
    expect(await sel.nextModel(STATUS_404)).toBeNull()
  })

  it('is purely positional — the reason argument is informational', async () => {
    // The selector does NOT branch on reason. The wrapper (openai.ts)
    // is responsible for the invalid_key special case (it throws
    // before calling nextModel a second time). Verify the selector
    // advances identically for any reason.
    const sel = new ModelSelector({
      primary: 'primary',
      whitelist: ['w-1'],
      autoRefresh: false,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk',
    })
    expect(await sel.nextModel(STATUS_401)).toBe('primary')
    expect(await sel.nextModel(STATUS_401)).toBe('w-1')
    expect(await sel.nextModel(STATUS_401)).toBeNull()
  })
})