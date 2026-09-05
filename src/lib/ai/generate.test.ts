import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    baseUrl: null,
    modelsUrl: null,
    fallbackModels: [],
    autoRefreshModels: true,
    maxRetries: 3,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toEqual({
      text: 'Hello there',
      handoff: false,
      usage: null,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({
      text: '',
      handoff: true,
      usage: null,
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toEqual({
      text: 'Let me get a human',
      handoff: true,
      usage: null,
    })
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toEqual({
      text: 'Hi',
      handoff: false,
      usage,
    })
  })
})

describe('generateReply — OpenAI', () => {
  it('calls the chat completions endpoint and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({
      text: 'Sure — happy to help!',
      handoff: false,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Incorrect API key' } }),
      ),
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '' } }] })),
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('generateReply — Anthropic', () => {
  it('calls the messages endpoint with the version header and parses text blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 30, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // Anthropic reports input/output only — total is summed by normalizeUsage.
    expect(res).toEqual({
      text: 'Hi there!',
      handoff: false,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
    expect(opts.headers['anthropic-version']).toBeTruthy()
  })

  it('detects handoff in the model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ content: [{ type: 'text', text: '[[HANDOFF]]' }] }),
      ),
    )
    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('drops a leading assistant turn so the payload starts on the customer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages).toHaveLength(1)
  })
})

describe('generateReply — OpenAI-compatible', () => {
  it('uses the baseUrl endpoint when provider is openai_compatible', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Hello from OpenRouter!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({
        provider: 'openai_compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({
      text: 'Hello from OpenRouter!',
      handoff: false,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('openrouter.ai/api/v1/chat/completions')
  })

  it('falls back to api.openai.com when no baseUrl is set for openai provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'ok' } }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'openai', baseUrl: null }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
  })
})

describe('generateReply — OpenAI fallback chain', () => {
  it('skips 404 (model not found) and tries the next whitelist model', async () => {
    const fetchMock = vi
      .fn()
      // Primary model: 404
      .mockResolvedValueOnce(errResponse(404, { error: { message: 'not found' } }))
      // Fallback model 1: 404
      .mockResolvedValueOnce(errResponse(404, { error: { message: 'not found' } }))
      // Fallback model 2: success
      .mockResolvedValueOnce(
        okResponse({
          choices: [{ message: { content: 'all good' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({
        provider: 'openai_compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'primary/missing',
        fallbackModels: ['backup/missing', 'backup/found'],
        autoRefreshModels: false,
      }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res.text).toBe('all good')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body))
    expect(bodies[0].model).toBe('primary/missing')
    expect(bodies[1].model).toBe('backup/missing')
    expect(bodies[2].model).toBe('backup/found')
  })

  it('retries a 429 up to maxRetries before moving on', { timeout: 15000 }, async () => {
    // `shouldAdvanceTime: true` makes any in-flight `setTimeout` resolve
    // when the awaited microtask queue runs, so we don't need to
    // manually drain timers while still being deterministic.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi
      .fn()
      // 2 x 429 (maxRetries: 2)
      .mockResolvedValueOnce(errResponse(429, { error: { message: 'rate' } }))
      .mockResolvedValueOnce(errResponse(429, { error: { message: 'rate' } }))
      // Whitelist model: 404 so we don't have to wait again
      .mockResolvedValueOnce(errResponse(404, { error: { message: 'gone' } }))
    vi.stubGlobal('fetch', fetchMock)

    const err = await generateReply({
      config: config({
        provider: 'openai_compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'primary/x',
        fallbackModels: ['backup/y'],
        autoRefreshModels: false,
        maxRetries: 2,
      }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AiError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('does not retry on 401 — invalid key aborts the chain', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errResponse(401, { error: { message: 'bad key' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateReply({
        config: config({
          provider: 'openai_compatible',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'x',
          fallbackModels: ['y', 'z'],
          autoRefreshModels: false,
        }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-throws the last error when every model in the chain fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // maxRetries=1 keeps the per-model backoff to a single 1-second
    // sleep (plus jitter), so the whole chain finishes in ~4s.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errResponse(500, { error: { message: 'boom' } }))
    vi.stubGlobal('fetch', fetchMock)

    const err = await generateReply({
      config: config({
        provider: 'openai_compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'a',
        fallbackModels: ['b'],
        autoRefreshModels: false,
        maxRetries: 1,
      }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AiError)
    // 1 primary retry + 1 fallback retry = 2.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
