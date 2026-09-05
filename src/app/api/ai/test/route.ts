import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { errorCode } from '@/lib/api/v1/respond'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, type AiProvider } from '@/lib/ai/types'

/**
 * POST /api/ai/test  (admin+)
 *
 * "Test key" button: validate a candidate provider/model/key against
 * the provider WITHOUT saving. When `api_key` is omitted the stored
 * key is used, so an admin can re-test an existing config (e.g. after
 * changing the model). Returns `{ ok: true }` on success, 400 with the
 * provider's message on failure.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return errorCode('invalid_request_body', 400, {
        message: 'Invalid request body',
      })
    }

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'openai_compatible') {
      return errorCode('ai_provider_invalid', 400, {
        message: 'provider must be "openai", "anthropic", or "openai_compatible"',
      })
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) {
      return errorCode('model_required', 400, { message: 'model is required' })
    }

    // base_url for openai_compatible provider (needed for validateAiCredentials).
    let baseUrl: string | null = null
    if (provider === 'openai_compatible') {
      const rawUrl = typeof body.base_url === 'string' ? body.base_url.trim() : ''
      if (!rawUrl) {
        return errorCode('base_url_required', 400, {
          message: 'base_url is required for openai_compatible providers',
        })
      }
      try {
        new URL(rawUrl)
      } catch {
        return errorCode('base_url_invalid', 400, {
          message: 'base_url must be a valid URL',
        })
      }
      baseUrl = rawUrl
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    let apiKeyPlain = rawKey
    if (!apiKeyPlain) {
      const { data: existing } = await supabase
        .from('ai_configs')
        .select('api_key')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!existing?.api_key) {
        return errorCode('api_key_required', 400, {
          message: 'Enter an API key to test.',
        })
      }
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return errorCode('key_decrypt_failed', 400, {
          message:
            'Stored API key could not be decrypted — re-enter your key.',
        })
      }
    }

    try {
      await validateAiCredentials({
        provider,
        model,
        apiKey: apiKeyPlain,
        baseUrl,
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
      })
    } catch (err) {
      if (err instanceof AiError) {
        return errorCode(err.code, 400, { message: err.message })
      }
      console.error('[ai/test] validation error:', err)
      return errorCode('ai_test_failed', 400, {
        message: 'Could not validate the API key.',
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
