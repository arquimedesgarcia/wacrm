// ============================================================
// Evolution historical import endpoint.
//
// POST starts a background import of contacts and recent messages from
// the connected Evolution instance. It acks immediately and runs the
// heavy work inside after() so the HTTP response does not timeout.
// ============================================================

import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/auth/account'
import { importEvolutionHistory } from '@/lib/whatsapp/evolution-import'
import { EvolutionAdapter } from '@/lib/whatsapp/providers/evolution-adapter'
import type { WhatsAppConfig } from '@/types'

export const maxDuration = 60

// Lazy-initialized service-role client for background work.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * POST /api/whatsapp/evolution/import
 *
 * Requires admin role. Returns immediately; the actual import runs in
 * the background via after().
 */
export async function POST() {
  let accountId: string
  let configOwnerUserId: string
  let config: WhatsAppConfig

  try {
    const accountResult = await requireRole('admin')
    accountId = accountResult.accountId
    configOwnerUserId = accountResult.userId

    const { data: row, error } = await accountResult.supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'evolution')
      .maybeSingle()

    if (error) {
      console.error('[evolution/import POST] error loading config:', error)
      return NextResponse.json(
        { error: 'Failed to load Evolution configuration' },
        { status: 500 },
      )
    }

    if (!row) {
      return NextResponse.json(
        { error: 'No Evolution configuration found for this account' },
        { status: 400 },
      )
    }

    config = row as WhatsAppConfig

    // Quick sanity check: the instance should be reachable before we queue
    // the background work.
    const adapter = new EvolutionAdapter()
    const status = await adapter.getConnectionStatus(config)
    if (!status.connected) {
      return NextResponse.json(
        { error: 'Evolution instance is not connected' },
        { status: 400 },
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[evolution/import POST] setup error:', message)
    return NextResponse.json(
      { error: message || 'Internal server error' },
      { status: 500 },
    )
  }

  after(async () => {
    try {
      const result = await importEvolutionHistory({
        db: supabaseAdmin(),
        accountId,
        ownerUserId: configOwnerUserId,
        config,
      })
      console.log('[evolution/import] completed:', result)
    } catch (error) {
      console.error('[evolution/import] background error:', error)
    }
  })

  return NextResponse.json({ success: true, started: true })
}
