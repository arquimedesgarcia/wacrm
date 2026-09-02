// ============================================================
// Evolution API configuration endpoints.
//
// GET  -> load config + connection state
// POST -> save/update config, create instance, configure webhook,
//         return QR if needed
// DELETE -> remove config
//
// These endpoints are separate from /api/whatsapp/config because
// Evolution uses a completely different credential shape and
// verification flow.
//
// POST/DELETE require the 'admin' role because switching WhatsApp
// provider is an account-level administrative operation.
// ============================================================

import { NextResponse, after } from 'next/server'
import type { ConnectionStatus } from '@/lib/whatsapp/providers/types'
import { getCurrentAccount, requireRole } from '@/lib/auth/account'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'
import { EvolutionAdapter } from '@/lib/whatsapp/providers/evolution-adapter'
import { ProviderError } from '@/lib/whatsapp/providers'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { importEvolutionHistory } from '@/lib/whatsapp/evolution-import'
import { errorCode } from '@/lib/api/v1/respond'
import type { WhatsAppConfig } from '@/types'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof getCurrentAccount>>['supabase'],
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

export async function GET(request: Request) {
  try {
    const { supabase, userId } = await getCurrentAccount()

    const accountId = await resolveAccountId(supabase, userId)
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          error: { code: 'profile_no_account' },
          message: 'Profile not linked to an account.',
        },
        { status: 200 }
      )
    }

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'evolution')
      .maybeSingle()

    if (error) {
      console.error('[evolution/config GET] error:', error)
      return NextResponse.json(
        {
          connected: false,
          reason: 'db_error',
          error: { code: 'evolution_config_load_failed' },
          message: 'Failed to fetch configuration',
        },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          error: { code: 'evolution_not_configured' },
          message: 'No Evolution configuration saved yet.',
        },
        { status: 200 }
      )
    }

    const adapter = new EvolutionAdapter()
    let status: ConnectionStatus = { connected: false, detail: 'unknown' }
    let errorMessage: string | null = null
    try {
      status = await adapter.getConnectionStatus(config as WhatsAppConfig)
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
    }

    const webhookUrl = new URL(
      '/api/whatsapp/evolution/webhook',
      new URL(request.url).origin,
    ).toString()

    return NextResponse.json({
      connected: status.connected,
      reason: status.connected ? undefined : 'disconnected',
      message: errorMessage || status.detail || 'Instance not connected.',
      error: status.connected
        ? undefined
        : errorMessage
          ? { code: 'evolution_send_failed', params: { message: errorMessage } }
          : undefined,
      instance_name: config.evolution_instance_name,
      base_url: config.evolution_base_url,
      webhook_url: webhookUrl,
      // Never return secrets.
    })
  } catch (error) {
    console.error('[evolution/config GET] exception:', error)
    return errorCode('internal', 500, { message: 'Internal server error' })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId, accountId } = await requireRole('admin')

    const body = await request.json()
    const {
      base_url,
      api_key,
      instance_name,
      webhook_secret,
      create_instance = true,
    } = body

    if (!base_url || !api_key || !instance_name || !webhook_secret) {
      return errorCode('evolution_config_validate_failed', 400, {
        message: 'base_url, api_key, instance_name and webhook_secret are required',
      })
    }

    const normalizedBaseUrl = String(base_url).replace(/\/+$/, '')
    const normalizedInstance = String(instance_name).trim()
    const trimmedWebhookSecret = String(webhook_secret).trim()

    if (!/^https?:\/\/.+/i.test(normalizedBaseUrl)) {
      return errorCode('evolution_invalid_url', 400, {
        message: 'base_url must be a valid http(s) URL',
      })
    }

    const deliverable = await isDeliverableUrl(normalizedBaseUrl)
    if (!deliverable) {
      return errorCode('evolution_url_unreachable', 400, {
        message: 'base_url must resolve to a publicly-routable address',
      })
    }

    if (/[\/\\]/.test(normalizedInstance)) {
      return errorCode('evolution_instance_name_invalid', 400, {
        message: 'instance_name cannot contain path separators',
      })
    }

    // Reject if the instance name is already used by another account.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('provider', 'evolution')
      .eq('evolution_instance_name', normalizedInstance)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('[evolution/config POST] conflict check failed:', claimedError)
      return errorCode('config_validate_failed', 500, {
        message: 'Failed to validate configuration',
      })
    }
    if (claimed) {
      return errorCode('evolution_instance_already_linked', 409, {
        message: 'This Evolution instance name is already linked to another account.',
      })
    }

    // Encrypt secrets before any external call or persistence.
    let encryptedApiKey: string
    let encryptedWebhookSecret: string
    try {
      encryptedApiKey = encrypt(api_key)
      encryptedWebhookSecret = encrypt(trimmedWebhookSecret)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('[evolution/config POST] encryption failed:', message)
      return errorCode('config_encryption_corrupt', 500, {
        message: 'Failed to encrypt credentials. Check ENCRYPTION_KEY.',
      })
    }

    // Build a candidate config to verify credentials and create/connect.
    const candidateConfig = {
      provider: 'evolution',
      evolution_base_url: normalizedBaseUrl,
      evolution_api_key: encryptedApiKey,
      evolution_instance_name: normalizedInstance,
      evolution_webhook_secret: encryptedWebhookSecret,
      user_id: userId,
    } as unknown as WhatsAppConfig

    const adapter = new EvolutionAdapter()
    let qr: { base64: string; raw?: string } | null = null
    let status: ConnectionStatus = { connected: false, detail: 'unknown' }

    try {
      await adapter.verifyConfiguration(candidateConfig)

      if (create_instance) {
        const connect = await adapter.createOrConnect(candidateConfig)
        qr = connect.qr ?? null
        status = connect.status
      } else {
        status = await adapter.getConnectionStatus(candidateConfig)
      }

      // Configure the Evolution webhook to point back at this deployment.
      const webhookUrl = new URL(
        '/api/whatsapp/evolution/webhook',
        new URL(request.url).origin,
      ).toString()
      await adapter.configureWebhook(candidateConfig, webhookUrl, trimmedWebhookSecret)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[evolution/config POST] verification/webhook failed:', message)

      if (err instanceof ProviderError && err.status) {
        return errorCode('evolution_send_failed', err.status, {
          message,
          params: { message },
        })
      }
      return errorCode('evolution_send_failed', 400, {
        message: `Evolution API error: ${message}`,
        params: { message },
      })
    }

    const baseRow = {
      provider: 'evolution',
      phone_number_id: null,
      waba_id: null,
      access_token: null,
      verify_token: null,
      evolution_base_url: normalizedBaseUrl,
      evolution_api_key: encryptedApiKey,
      evolution_instance_name: normalizedInstance,
      evolution_webhook_secret: encryptedWebhookSecret,
      status: status.connected ? 'connected' : 'disconnected',
      connected_at: status.connected ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, evolution_history_imported_at')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId)
      if (updateError) {
        console.error('[evolution/config POST] update failed:', updateError)
        return errorCode('config_update_failed', 500, {
          message: 'Failed to update configuration',
        })
      }
    } else {
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: userId,
          ...baseRow,
        })
      if (insertError) {
        console.error('[evolution/config POST] insert failed:', insertError)
        return errorCode('evolution_config_save_failed', 500, {
          message: 'Failed to save configuration',
        })
      }
    }

    // Trigger a one-time historical import the first time the instance
    // becomes connected. The import runs in the background so saving stays
    // fast and cannot timeout.
    const shouldImportHistory =
      status.connected &&
      !existing?.evolution_history_imported_at &&
      baseRow.status === 'connected'

    if (shouldImportHistory) {
      after(async () => {
        try {
          const result = await importEvolutionHistory({
            db: supabaseAdmin(),
            accountId,
            ownerUserId: userId,
            config: {
              ...candidateConfig,
              id: existing?.id ?? '',
              user_id: userId,
              status: 'connected',
            } as WhatsAppConfig,
          })
          console.log('[evolution/config POST] history import completed:', result)
        } catch (error) {
          console.error('[evolution/config POST] history import failed:', error)
        }
      })
    }

    return NextResponse.json({
      success: true,
      connected: status.connected,
      history_import_started: shouldImportHistory,
      qr: qr
        ? {
            base64: qr.base64,
            dataUrl: qr.base64,
          }
        : null,
      instance_name: normalizedInstance,
    })
  } catch (error) {
    console.error('[evolution/config POST] exception:', error)
    return errorCode('internal', 500, { message: 'Internal server error' })
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { error } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', 'evolution')

    if (error) {
      console.error('[evolution/config DELETE] error:', error)
      return errorCode('evolution_config_clear_failed', 500, {
        message: 'Failed to delete configuration',
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[evolution/config DELETE] exception:', error)
    return errorCode('internal', 500, { message: 'Internal server error' })
  }
}
