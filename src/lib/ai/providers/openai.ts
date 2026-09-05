import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import { mergeConsecutive, normalizeUsage, providerHttpError, toNetworkError } from './shared'
import { ModelSelector } from './model-selector'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export interface GenerateOpenAiArgs {
  apiKey: string
  model: string
  baseUrl?: string | null
  modelsUrl?: string | null
  fallbackModels?: string[]
  autoRefreshModels?: boolean
  maxRetries?: number
  systemPrompt: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  timeoutMs: number
  /** Test-only: override random jitter source. Returns 0..1. */
  jitter?: () => number
  /** Test-only: override the sleep used between retries. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Call OpenAI's Chat Completions endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 *
 * When `baseUrl` is provided, calls `${baseUrl}/chat/completions`
 * instead of api.openai.com — enabling OpenAI-compatible providers
 * (OpenRouter, Ollama local, etc.). The OpenAI Chat Completions schema
 * is 100% compatible, so no other changes are needed.
 *
 * Failure handling (issue #459 — free-model catalog churn):
 * - 401/403 (invalid_key) → re-thrown immediately. The key would be
 *   wrong for every model on the provider, so there is nothing to fall
 *   back to.
 * - 404 / 400 with a model that doesn't exist / empty body → skip to
 *   the next fallback model (retrying the same slug is pointless).
 * - 429, 5xx, network/timeout → the request is retried with the same
 *   model up to `maxRetries` times (default 3) with exponential backoff
 *   (1 s, 2 s, 4 s + ±25% jitter).
 * - Once the retry budget for one model is exhausted, the configured
 *   `fallbackModels` whitelist is tried in order, then (when
 *   `autoRefreshModels`) the provider's free catalog, then (for
 *   OpenRouter) `openrouter/free`. When the chain runs out the last
 *   error is re-thrown.
 */
export async function generateOpenAi(args: GenerateOpenAiArgs): Promise<ProviderResult> {
  const maxRetries = args.maxRetries ?? 3
  const selector = new ModelSelector({
    primary: args.model,
    whitelist: args.fallbackModels ?? [],
    autoRefresh: args.autoRefreshModels ?? true,
    baseUrl: args.baseUrl ?? null,
    apiKey: args.apiKey,
    modelsUrl: args.modelsUrl ?? null,
  })

  let lastError: unknown = null
  // We retry the same model on transient failures (429, 5xx, network,
  // timeout) up to `maxRetries` times before advancing the chain.
  // The selector only moves when the wrapper asks for the *next*
  // model. Same-model retries are entirely the wrapper's job.
  let currentModel: string | null = null
  let attemptsForCurrentModel = 0

  while (true) {
    if (currentModel === null) {
      const next = await selector.nextModel({ kind: 'unknown' })
      if (!next) {
        if (lastError) throw lastError
        throw new AiError('No model available to retry.', {
          code: 'provider_error',
          status: 502,
        })
      }
      currentModel = next
      attemptsForCurrentModel = 0
    }

    attemptsForCurrentModel += 1

    try {
      return await generateOpenAiOnce({ ...args, model: currentModel })
    } catch (err) {
      // Invalid key: every model on this provider will fail the same
      // way. Bail out without burning the rest of the chain.
      if (err instanceof AiError && err.code === 'invalid_key') {
        throw err
      }

      // Model-specific failures (404 not-found, 400 bad request on a
      // particular slug, empty body): retrying the same model is
      // pointless. Move on to the next fallback immediately.
      const ps = err instanceof AiError ? err.providerStatus : null
      const isModelSpecific =
        err instanceof AiError && err.code === 'empty_response'
      if (ps === 404 || ps === 400 || isModelSpecific) {
        lastError = err
        currentModel = null
        continue
      }

      // Transient (429, 5xx, network, timeout): retry up to maxRetries.
      if (attemptsForCurrentModel < maxRetries) {
        const sleeper = args.sleep ?? sleep
        await sleeper(backoffMs(attemptsForCurrentModel, args.jitter))
        continue
      }

      // Out of retries for this model — move to the next.
      lastError = err
      currentModel = null
    }
  }
}

/**
 * Single attempt at the chat completions endpoint. Throws
 * `providerHttpError`, `toNetworkError`, or `AiError(empty_response)`.
 */
async function generateOpenAiOnce(
  args: GenerateOpenAiArgs & { model: string },
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, baseUrl } = args

  const endpoint = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/chat/completions`
    : OPENAI_URL

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI', res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('OpenAI returned an empty response.', {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}

/** Backoff in ms: attempt 1 → 1000, 2 → 2000, 3 → 4000 with ±25% jitter. */
function backoffMs(attempt: number, jitterFn: (() => number) | undefined): number {
  const base = 1000 * Math.pow(2, attempt - 1)
  const jitter = jitterFn ?? Math.random
  return Math.round(base * (0.75 + 0.5 * jitter()))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}