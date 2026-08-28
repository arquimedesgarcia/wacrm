// ============================================================
// Evolution API configuration endpoints.
//
// GET  -> load config + connection state
// POST -> save/update config, create instance, return QR if needed
// DELETE -> remove config
//
// These endpoints are separate from /api/whatsapp/config because
// Evolution uses a completely different credential shape and
// verification flow.
// ============================================================

import { NextResponse } from 'next/server'
import type { ConnectionStatus } from '@/lib/whatsapp/providers/types'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { EvolutionAdapter } from '@/lib/whatsapp/providers/evolution-adapter'
import type { WhatsAppConfig } from '@/types'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
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

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: 'Profile not linked to an account.' },
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
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        { connected: false, reason: 'no_config', message: 'No Evolution configuration saved yet.' },
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

    return NextResponse.json({
      connected: status.connected,
      reason: status.connected ? undefined : 'disconnected',
      message: errorMessage || status.detail || 'Instance not connected.',
      instance_name: config.evolution_instance_name,
      base_url: config.evolution_base_url,
      // Never return secrets.
    })
  } catch (error) {
    console.error('[evolution/config GET] exception:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Profile not linked to an account.' }, { status: 403 })
    }

    const body = await request.json()
    const {
      base_url,
      api_key,
      instance_name,
      webhook_secret,
      create_instance = true,
    } = body

    if (!base_url || !api_key || !instance_name) {
      return NextResponse.json(
        { error: 'base_url, api_key and instance_name are required' },
        { status: 400 }
      )
    }

    const normalizedBaseUrl = String(base_url).replace(/\/+$/, '')
    const normalizedInstance = String(instance_name).trim()

    if (!/^https?:\/\/.+/i.test(normalizedBaseUrl)) {
      return NextResponse.json(
        { error: 'base_url must be a valid http(s) URL' },
        { status: 400 }
      )
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
      return NextResponse.json({ error: 'Failed to validate configuration' }, { status: 500 })
    }
    if (claimed) {
      return NextResponse.json(
        { error: 'This Evolution instance name is already linked to another account.' },
        { status: 409 }
      )
    }

    // Build a candidate config to verify credentials and create/connect.
    const candidateConfig = {
      provider: 'evolution',
      evolution_base_url: normalizedBaseUrl,
      evolution_api_key: api_key, // plaintext for verification; encrypted below
      evolution_instance_name: normalizedInstance,
      evolution_webhook_secret: webhook_secret || '',
      user_id: user.id,
    } as unknown as WhatsAppConfig

    const adapter = new EvolutionAdapter()
    let qr: { base64: string; raw?: string } | null = null
    let status: ConnectionStatus = { connected: false, detail: 'unknown' }
    let verifyError: string | null = null

    try {
      await adapter.verifyConfiguration(candidateConfig)
      if (create_instance) {
        const connect = await adapter.createOrConnect(candidateConfig)
        qr = connect.qr ?? null
        status = connect.status
      } else {
        status = await adapter.getConnectionStatus(candidateConfig)
      }
    } catch (err) {
      verifyError = err instanceof Error ? err.message : String(err)
      console.error('[evolution/config POST] verification failed:', verifyError)
      return NextResponse.json(
        { error: `Evolution API error: ${verifyError}` },
        { status: 400 }
      )
    }

    // Encrypt secrets before persistence.
    let encryptedApiKey: string
    let encryptedWebhookSecret: string | null
    try {
      encryptedApiKey = encrypt(api_key)
      encryptedWebhookSecret = webhook_secret ? encrypt(webhook_secret) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('[evolution/config POST] encryption failed:', message)
      return NextResponse.json(
        { error: 'Failed to encrypt credentials. Check ENCRYPTION_KEY.' },
        { status: 500 }
      )
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
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId)
      if (updateError) {
        console.error('[evolution/config POST] update failed:', updateError)
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          ...baseRow,
        })
      if (insertError) {
        console.error('[evolution/config POST] insert failed:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      connected: status.connected,
      qr: qr
        ? {
            base64: qr.base64,
            dataUrl: qr.base64.startsWith('data:') ? qr.base64 : `data:image/png;base64,${qr.base64}`,
          }
        : null,
      instance_name: normalizedInstance,
    })
  } catch (error) {
    console.error('[evolution/config POST] exception:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Profile not linked to an account.' }, { status: 403 })
    }

    const { error } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', 'evolution')

    if (error) {
      console.error('[evolution/config DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[evolution/config DELETE] exception:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
