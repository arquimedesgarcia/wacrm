import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { errorCode } from '@/lib/api/v1/respond'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'

// Quick replies — reusable snippets (plain text or a saved interactive
// message) shared across the account. GET lists; POST creates. Mirrors
// the automations route: RLS-scoped read via the user client, service-
// role write after an explicit role check.

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    // RLS (quick_replies_select) scopes to the caller's account.
    const { data, error } = await supabase
      .from('quick_replies')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      return errorCode('quick_replies_load_failed', 500, {
        message: error.message,
      })
    }
    return NextResponse.json({ quick_replies: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return errorCode('invalid_json', 400, { message: 'Invalid JSON' })

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const kind = body.kind === 'interactive' ? 'interactive' : 'text'
  if (!title) {
    return errorCode('quick_reply_title_required', 400, {
      message: 'title is required',
    })
  }

  let content_text: string | null = null
  let interactive_payload: unknown = null

  if (kind === 'interactive') {
    const result = validateInteractivePayload(body.interactive_payload)
    if (!result.ok) {
      return errorCode('interactive_invalid', 400, { message: result.error })
    }
    interactive_payload = body.interactive_payload
  } else {
    const text = typeof body.content_text === 'string' ? body.content_text : ''
    if (!text.trim()) {
      return errorCode('quick_reply_content_required', 400, {
        message: 'content_text is required for text quick replies',
      })
    }
    content_text = text
  }

  const { data, error } = await supabaseAdmin()
    .from('quick_replies')
    .insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      title,
      kind,
      content_text,
      interactive_payload,
    })
    .select()
    .single()

  if (error) {
    return errorCode('quick_reply_create_failed', 500, { message: error.message })
  }
  return NextResponse.json({ quick_reply: data }, { status: 201 })
}
