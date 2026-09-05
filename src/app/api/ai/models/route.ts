import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { errorCode } from '@/lib/api/v1/respond'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { fetchAvailableModels } from '@/lib/ai/providers/model-discovery'
import { AiError } from '@/lib/ai/types'

/**
 * GET /api/ai/models
 *
 * Returns the model's understanding of the provider's catalog — used by
 * the AI settings page to render an "Available models" list (with
 * free-tier badges) and to verify the configured `models_url` works
 * before the next fallback attempt needs it. Admin-only: it decrypts
 * the BYO provider key, which is a sensitive operation. Rate-limited
 * separately from draft / auto-reply generation (see RATE_LIMITS) so a
 * 200-row catalog fetch can't crowd out real replies.
 *
 * Response shape:
 *   { data: { endpoint, fetchedAt, models: DiscoveredModel[] } }
 *
 * `endpoint` is the actual URL that was queried (echoes `models_url`
 * when set, otherwise `${baseUrl}/models`). `fetchedAt` is the
 * wall-clock time the catalog was last refreshed on this Node process
 * — the runtime caches the response for 60 min, so most calls return
 * a non-fresh `fetchedAt`.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const limit = checkRateLimit(`aiModelsDiscovery:${accountId}`, RATE_LIMITS.aiModelsDiscovery)
    if (!limit.success) return rateLimitResponse(limit)

    // We need the BYO key + the base URL + the optional models_url
    // override. `loadAiConfig` is the canonical decrypter, but it
    // filters out inactive configs. Settings is allowed to inspect a
    // disabled config (e.g. to fix the URL before turning it on), so
    // we use the Playground-style "include inactive" mode.
    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    })
    if (!config) {
      return errorCode('ai_not_configured', 404, {
        message: 'AI is not configured for this account.',
      })
    }
    if (config.provider === 'anthropic') {
      return errorCode('unsupported_provider', 400, {
        message:
          'Model discovery is only available for OpenAI-compatible providers.',
      })
    }
    if (!config.baseUrl) {
      return errorCode('base_url_required', 400, {
        message: 'base_url is required for model discovery.',
      })
    }
    if (!config.apiKey) {
      return errorCode('key_required', 400, {
        message: 'API key is required for model discovery.',
      })
    }

    try {
      const result = await fetchAvailableModels({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        modelsUrl: config.modelsUrl,
      })
      return NextResponse.json({
        data: {
          endpoint: result.endpoint,
          fetchedAt: new Date(result.fetchedAt).toISOString(),
          models: result.models,
        },
      })
    } catch (err) {
      if (err instanceof AiError) {
        return errorCode(err.code, err.status, { message: err.message })
      }
      console.error('[ai/models] unexpected error:', err)
      return errorCode('models_discovery_failed', 500, {
        message: 'Could not fetch the model catalog.',
      })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}