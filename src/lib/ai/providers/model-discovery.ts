import { AiError } from '../types'

// ============================================================
// Discovery for AI provider catalogs (OpenAI-compatible).
//
// OpenRouter exposes `GET /api/v1/models` and returns
// `{ data: Model[], total_count, links }`. Other OpenAI-compatible
// providers (Ollama, vLLM, OpenPipe) generally expose the same
// shape at `${baseUrl}/models`. We keep the entire catalog here so
// the caller can decide what to filter on; the selector then picks
// the free models (pricing.prompt === "0") for its fallback chain.
//
// Caching: in-memory `Map<endpoint, { result, expiresAt }>` with a
// 60-minute TTL. The cache key is the resolved endpoint URL, NOT
// the API key, so two accounts pointing at the same provider share
// the same TTL window. Idempotent — safe to call from concurrent
// requests; the second caller waits on the in-flight promise.
// ============================================================

export interface DiscoveredModel {
  id: string
  name: string | null
  contextLength: number | null
  isFree: boolean
  isRouter: boolean
}

export interface DiscoveryResult {
  models: DiscoveredModel[]
  fetchedAt: number
  endpoint: string
}

interface ProviderModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown }
}

interface ProviderCatalog {
  data?: unknown
}

const CACHE_TTL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 15_000

interface CacheEntry {
  result: DiscoveryResult
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<DiscoveryResult>>()

function resolveEndpoint(baseUrl: string, modelsUrl?: string | null): string {
  const raw = (modelsUrl ?? '').trim()
  if (raw) return raw.replace(/\/$/, '')
  return `${baseUrl.replace(/\/$/, '')}/models`
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v)
  }
  return null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function mapModel(raw: ProviderModel): DiscoveredModel | null {
  const id = str(raw.id)
  if (!id) return null
  const pricing = raw.pricing ?? {}
  // Free = prompt price is the literal string "0" (OpenRouter's
  // convention). Anything >0 or non-numeric is treated as paid.
  const prompt = pricing.prompt
  const isFree = typeof prompt === 'string' && prompt.trim() === '0'
  const isRouter = id === 'openrouter/free' || id === 'openrouter/auto'
  return {
    id,
    name: str(raw.name),
    contextLength: num(raw.context_length),
    isFree,
    isRouter,
  }
}

function discoveryError(): AiError {
  return new AiError('Failed to fetch the model catalog from the provider.', {
    code: 'provider_error',
    status: 502,
  })
}

/**
 * Fetch the provider's model catalog. Throws `AiError({ code: 'provider_error', status: 502 })`
 * on non-2xx responses, non-JSON bodies, or unparseable shapes.
 */
export async function fetchAvailableModels(args: {
  baseUrl: string
  apiKey: string
  modelsUrl?: string | null
  /** Override TTL for tests (ms). */
  cacheTtlMs?: number
  /** Override fetch timeout (ms). */
  fetchTimeoutMs?: number
  /** Optional clock injection for tests. */
  now?: () => number
}): Promise<DiscoveryResult> {
  const endpoint = resolveEndpoint(args.baseUrl, args.modelsUrl)
  const now = args.now ?? Date.now
  const ttl = args.cacheTtlMs ?? CACHE_TTL_MS
  const timeoutMs = args.fetchTimeoutMs ?? FETCH_TIMEOUT_MS

  const cached = cache.get(endpoint)
  if (cached && cached.expiresAt > now()) {
    return cached.result
  }

  const existing = inflight.get(endpoint)
  if (existing) return existing

  const promise = (async () => {
    let res: Response
    try {
      res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw discoveryError()
    }

    if (!res.ok) {
      throw discoveryError()
    }

    let body: ProviderCatalog
    try {
      body = (await res.json()) as ProviderCatalog
    } catch {
      throw discoveryError()
    }

    if (!Array.isArray(body.data)) {
      throw discoveryError()
    }

    const models: DiscoveredModel[] = []
    for (const raw of body.data as ProviderModel[]) {
      const mapped = mapModel(raw)
      if (mapped) models.push(mapped)
    }

    const result: DiscoveryResult = {
      models,
      fetchedAt: now(),
      endpoint,
    }
    cache.set(endpoint, { result, expiresAt: now() + ttl })
    return result
  })()

  inflight.set(endpoint, promise)
  try {
    return await promise
  } finally {
    inflight.delete(endpoint)
  }
}

/** Test-only: invalidate the in-memory cache. */
export function __resetDiscoveryCacheForTests(): void {
  cache.clear()
  inflight.clear()
}