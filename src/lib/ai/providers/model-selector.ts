import {
  __resetDiscoveryCacheForTests,
  fetchAvailableModels,
} from './model-discovery'

// ============================================================
// ModelSelector: ordered list of models to try when the configured
// one fails. The first item is always the user's configured model;
// subsequent items come from `whitelist` (user-configured) or from
// the dynamic catalog (`fetchAvailableModels` filtered to free
// non-router models). If everything is exhausted and the provider
// is OpenRouter, falls back to the official `openrouter/free`
// router.
//
// The wrapper (openai.ts) calls `nextModel(reason)` once per *new*
// model attempt. Same-model retries are handled by the wrapper
// (track attempt count, sleep, call `generateOpenAiOnce` again
// with the model the selector gave us). This separation keeps the
// selector's job simple: hand back the next model slug.
// ============================================================

export interface ModelSelectorOptions {
  primary: string
  whitelist: string[]
  autoRefresh: boolean
  baseUrl: string | null
  apiKey: string
  modelsUrl?: string | null
}

export type SwitchReason =
  | { kind: 'http_status'; status: number }
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'empty_response' }
  | { kind: 'invalid_key' }
  | { kind: 'unknown' }

export class ModelSelector {
  private readonly opts: ModelSelectorOptions
  private dynamicModels: string[] | null = null
  private dynamicTried = false
  /** Index into the (primary, whitelist..., dynamic..., router) chain. */
  private cursor = -1
  private primary: string | null = null
  private routerReturned = false

  constructor(opts: ModelSelectorOptions) {
    this.opts = opts
  }

  /**
   * Returns the slug for the next attempt, or `null` when nothing is
   * left. The wrapper is expected to call this only when it wants to
   * switch models; same-model retries are handled separately.
   *
   * `reason` is currently informational — the selector is purely
   * positional. We keep the parameter for future heuristics
   * (e.g. "skip dynamic catalog when reason is `invalid_key`" or
   * "prefer the largest-context model when reason is `network`").
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async nextModel(_reason: SwitchReason): Promise<string | null> {
    this.cursor += 1

    if (this.cursor === 0) {
      this.primary = this.opts.primary
      return this.primary
    }

    const whitelistIndex = this.cursor - 1
    if (whitelistIndex < this.opts.whitelist.length) {
      return this.opts.whitelist[whitelistIndex]
    }

    if (this.opts.autoRefresh && !this.dynamicTried) {
      this.dynamicTried = true
      try {
        const result = await fetchAvailableModels({
          baseUrl: this.opts.baseUrl ?? '',
          apiKey: this.opts.apiKey,
          modelsUrl: this.opts.modelsUrl,
        })
        this.dynamicModels = result.models
          .filter((m) => m.isFree && !m.isRouter)
          .sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0))
          .map((m) => m.id)
      } catch {
        this.dynamicModels = []
      }
    }

    if (this.dynamicModels && this.dynamicModels.length > 0) {
      const dynamicIndex = whitelistIndex - this.opts.whitelist.length
      if (dynamicIndex < this.dynamicModels.length) {
        return this.dynamicModels[dynamicIndex]
      }
    }

    if (isOpenRouterBaseUrl(this.opts.baseUrl) && !this.routerReturned) {
      // Only fall through to the official free router when we
      // actually consulted the catalog (autoRefresh on). When
      // autoRefresh is off, the operator opted out of dynamic
      // discovery and the chain ends at the whitelist.
      if (!this.dynamicTried) return null
      const usedAll = whitelistIndex >= this.opts.whitelist.length
      const dynamicExhausted =
        !this.dynamicModels || this.dynamicModels.length === 0
      if (usedAll && dynamicExhausted) {
        this.routerReturned = true
        return 'openrouter/free'
      }
    }

    return null
  }

  /** Total times `nextModel` has been called in this chain. */
  attempts(): number {
    return this.cursor + 1
  }

  /** The primary model (set after the first `nextModel` call). */
  getPrimary(): string | null {
    return this.primary
  }

  /** True after the dynamic catalog has been fetched once. */
  hasTriedDynamic(): boolean {
    return this.dynamicTried
  }
}

function isOpenRouterBaseUrl(baseUrl: string | null): boolean {
  if (!baseUrl) return false
  const lower = baseUrl.toLowerCase()
  return (
    lower.startsWith('https://openrouter.ai/api/v1') ||
    lower.startsWith('https://openrouter.ai/api') ||
    lower === 'https://openrouter.ai/api' ||
    lower === 'https://openrouter.ai/api/'
  )
}

/** Re-export so tests can invalidate the cache cleanly. */
export const __resetSelectorDiscoveryCacheForTests = __resetDiscoveryCacheForTests