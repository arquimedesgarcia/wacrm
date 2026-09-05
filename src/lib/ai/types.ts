// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic' | 'openai_compatible'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Base URL for OpenAI-compatible providers (OpenRouter, Ollama local).
   *  NULL for native openai/anthropic. */
  baseUrl: string | null
  /** Override for the models-catalog endpoint. NULL = derive
   *  `${baseUrl}/models` (the OpenAI-compatible convention). */
  modelsUrl: string | null
  /** Whitelist of fallback models tried when the configured one fails.
   *  Empty array = discover dynamically (when autoRefreshModels) or
   *  surface the upstream error. */
  fallbackModels: string[]
  /** When true and fallbackModels is empty, the runtime fetches the
   *  provider's `/models` catalog and filters for free entries before
   *  giving up. */
  autoRefreshModels: boolean
  /** Retries per model before jumping to the next fallback. 0..10. */
  maxRetries: number
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.). `providerStatus`
 * is the raw HTTP status returned by the upstream provider (when
 * applicable) so retry/fallback wrappers can branch on 404/5xx/429
 * without parsing the human-readable message.
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  readonly providerStatus: number | null
  constructor(
    message: string,
    opts: {
      code?: string
      status?: number
      providerStatus?: number | null
    } = {},
  ) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
    this.providerStatus = opts.providerStatus ?? null
  }
}
