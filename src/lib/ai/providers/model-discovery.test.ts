import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDiscoveryCacheForTests,
  fetchAvailableModels,
} from './model-discovery'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const FREE_CATALOG = {
  data: [
    {
      id: 'provider/a:free',
      name: 'A free',
      context_length: 131072,
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'provider/b:free',
      name: 'B free',
      context_length: 65536,
      pricing: { prompt: '0', completion: '0.000001' },
    },
    {
      id: 'provider/c',
      name: 'C paid',
      context_length: 8192,
      pricing: { prompt: '0.00001', completion: '0.00003' },
    },
    {
      id: 'openrouter/free',
      name: 'Free Router',
      context_length: 2000000,
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'provider/d-no-suffix-free',
      name: 'Lyria free (no suffix)',
      context_length: 8192,
      pricing: { prompt: '0', completion: '0' },
    },
  ],
  total_count: 5,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  __resetDiscoveryCacheForTests()
  vi.useRealTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchAvailableModels', () => {
  it('calls the resolved endpoint with a Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(FREE_CATALOG))
    vi.stubGlobal('fetch', fetchMock)

    await fetchAvailableModels({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/models')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    expect(init.headers.Accept).toBe('application/json')
  })

  it('uses modelsUrl override when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(FREE_CATALOG))
    vi.stubGlobal('fetch', fetchMock)

    await fetchAvailableModels({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      modelsUrl: 'https://example.com/my-catalog',
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/my-catalog')
  })

  it('returns the full catalog with isFree/isRouter flags', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(FREE_CATALOG)))

    const result = await fetchAvailableModels({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
    })

    expect(result.endpoint).toBe('https://openrouter.ai/api/v1/models')
    expect(result.models).toHaveLength(5)
    const byId = Object.fromEntries(result.models.map((m) => [m.id, m]))
    expect(byId['provider/a:free'].isFree).toBe(true)
    expect(byId['provider/b:free'].isFree).toBe(true)
    expect(byId['provider/c'].isFree).toBe(false)
    expect(byId['openrouter/free'].isFree).toBe(true)
    expect(byId['openrouter/free'].isRouter).toBe(true)
    expect(byId['provider/d-no-suffix-free'].isFree).toBe(true)
    expect(byId['provider/a:free'].name).toBe('A free')
    expect(byId['provider/a:free'].contextLength).toBe(131072)
  })

  it('returns an empty list (no error) when the catalog is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [] })),
    )

    const result = await fetchAvailableModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
    })

    expect(result.models).toEqual([])
    expect(result.endpoint).toBe('https://example.com/v1/models')
  })

  it('throws AiError(502) when the provider returns a non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'no' }, 401)),
    )

    await expect(
      fetchAvailableModels({
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
      }),
    ).rejects.toMatchObject({ code: 'provider_error', status: 502 })
  })

  it('throws AiError(502) when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json')
        },
      }),
    )

    await expect(
      fetchAvailableModels({
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
      }),
    ).rejects.toMatchObject({ code: 'provider_error', status: 502 })
  })

  it('throws AiError(502) when data is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: 'oops' })),
    )

    await expect(
      fetchAvailableModels({
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
      }),
    ).rejects.toMatchObject({ code: 'provider_error', status: 502 })
  })

  it('caches the result for 60 min (TTL respected)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(FREE_CATALOG))
    vi.stubGlobal('fetch', fetchMock)

    let now = 1_000_000
    const first = await fetchAvailableModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      now: () => now,
    })
    expect(first.models).toHaveLength(5)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Second call within TTL — must hit cache.
    now += 60 * 60 * 1000 - 1
    const second = await fetchAvailableModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      now: () => now,
    })
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Third call past TTL — must refetch.
    now += 2
    await fetchAvailableModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      now: () => now,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches per endpoint (different modelsUrl = different cache key)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(FREE_CATALOG))
    vi.stubGlobal('fetch', fetchMock)

    await fetchAvailableModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      modelsUrl: 'https://a.example.com/catalog',
    })
    await fetchAvailableModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      modelsUrl: 'https://b.example.com/catalog',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://a.example.com/catalog')
    expect(fetchMock.mock.calls[1][0]).toBe('https://b.example.com/catalog')
  })
})