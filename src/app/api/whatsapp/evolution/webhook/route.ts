// ============================================================
// Evolution API webhook receiver.
//
// Receives events from an Evolution API instance (Baileys / WhatsApp
// Web) and feeds them into the common WaCRM pipeline:
//   authentication → account resolution → contact/conversation
//   find-or-create → idempotent insert → automation/flow/AI fan-out.
//
// This endpoint is intentionally separate from the Meta webhook
// because the formats, auth and semantics are completely different.
// It only handles accounts whose whatsapp_config.provider = 'evolution'.
//
// The route acks immediately and does the expensive work inside
// `after()` so Evolution does not retry on a slow response.
// ============================================================

import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { EvolutionAdapter } from '@/lib/whatsapp/providers/evolution-adapter'
import {
  extractInstanceName,
  sanitizeWebhookPayload,
} from '@/lib/whatsapp/providers/evolution-webhook-helpers'
import { normalizeInboundPhone } from '@/lib/whatsapp/providers/normalize'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import type { NormalizedInboundEvent, NormalizedStatusEvent } from '@/lib/whatsapp/providers/types'

export const maxDuration = 60

// Lazy-initialized admin client.
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
 * POST handler for Evolution webhooks.
 *
 * Auth: Evolution v2.3.7 sends the configured custom header. We expect
 * the webhook to be configured with `apikey: <webhook_secret>` and we
 * compare it against the stored `evolution_webhook_secret` (decrypted).
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  let payload: unknown

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const instanceName = extractInstanceName(payload)
  if (!instanceName) {
    return NextResponse.json(
      { error: 'Missing instance name' },
      { status: 400 },
    )
  }

  // Resolve account + authenticate BEFORE acking so a bad request does
  // not get silently swallowed.
  const resolution = await resolveAccount(instanceName)
  if (!resolution) {
    return NextResponse.json(
      { error: 'Unknown Evolution instance' },
      { status: 401 },
    )
  }

  const { config, accountId } = resolution

  // Only process webhooks for accounts that are actively using Evolution.
  if (config.provider !== 'evolution') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!authenticateWebhook(request, config)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Strip secrets from the payload before any logging or processing.
  const sanitizedPayload = sanitizeWebhookPayload(payload)

  // Ack quickly, process in the background.
  after(async () => {
    try {
      await processEvolutionWebhook(sanitizedPayload, accountId, config.user_id as string)
    } catch (error) {
      console.error('[evolution webhook] processing error:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

// ============================================================
// Account resolution and auth
// ============================================================

async function resolveAccount(instanceName: string): Promise<{
  config: Record<string, unknown>
  accountId: string
} | null> {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'evolution')
    .eq('evolution_instance_name', instanceName)
    .maybeSingle()

  if (error || !data) {
    console.warn('[evolution webhook] no config for instance:', instanceName)
    return null
  }

  return { config: data as Record<string, unknown>, accountId: data.account_id as string }
}

function authenticateWebhook(
  request: Request,
  config: Record<string, unknown>,
): boolean {
  const secretCipher = config.evolution_webhook_secret
  if (!secretCipher || typeof secretCipher !== 'string') {
    console.warn('[evolution webhook] no webhook secret configured')
    return false
  }

  let expected: string
  try {
    expected = decrypt(secretCipher)
  } catch {
    console.warn('[evolution webhook] webhook secret decrypt failed')
    return false
  }

  const sent =
    request.headers.get('apikey') ??
    request.headers.get('x-evolution-api-secret') ??
    ''
  return sent === expected
}

// ============================================================
// Webhook processing pipeline
// ============================================================

async function processEvolutionWebhook(
  payload: unknown,
  accountId: string,
  configOwnerUserId: string,
) {
  const adapter = new EvolutionAdapter()
  const events = adapter.normalizeInbound(payload)

  for (const event of events) {
    try {
      if ('recipientPhone' in event) {
        await handleStatusUpdate(event as NormalizedStatusEvent)
        continue
      }

      const messageEvent = event as NormalizedInboundEvent
      if (!messageEvent.senderPhone) continue
      if (messageEvent.isFromMe) {
        // Outbound echoes from a linked device: update existing outbound
        // row if present, but do not create a new customer message.
        await handleFromMeEcho(messageEvent)
        continue
      }

      await handleInboundMessage(messageEvent, accountId, configOwnerUserId)
    } catch (err) {
      console.error('[evolution webhook] event processing error:', err)
    }
  }
}

// ============================================================
// Inbound message handling
// ============================================================

async function handleInboundMessage(
  event: NormalizedInboundEvent,
  accountId: string,
  configOwnerUserId: string,
) {
  const phone = normalizeInboundPhone(event.senderPhone)
  if (!phone) {
    console.warn('[evolution webhook] empty sender phone')
    return
  }

  // 1. Find or create contact.
  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    phone,
    event.displayName,
  )
  if (!contactOutcome) return
  const { contact, contactCreated } = contactOutcome

  // 2. Find or create conversation.
  const convOutcome = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contact.id,
  )
  if (!convOutcome) return
  const { conversation, created: convCreated } = convOutcome

  // 3. Conversation created event for public webhooks.
  if (convCreated) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: String(conversation.id),
      contact_id: String(contact.id),
    })
  }

  // 4. Reopen closed conversation if needed.
  await reopenClosedConversation(supabaseAdmin(), { id: String(conversation.id) })

  // 5. Idempotent insert.
  const messageId = await insertInboundMessage(event, String(conversation.id))
  if (!messageId) return

  // 6. Bump conversation summary.
  await bumpConversation(supabaseAdmin(), String(conversation.id), event.contentText)

  // 7. Mark any pending broadcast as replied.
  await flagBroadcastReplyIfAny(accountId, String(contact.id))

  // 8. Fan-out to automations, flows, AI, public webhooks.
  const isFirstInbound = contactCreated || (await isFirstCustomerMessage(String(conversation.id)))

  await runAutomationsForTrigger({
    accountId,
    triggerType: 'new_message_received',
    contactId: String(contact.id),
    context: {
      message_text: event.contentText ?? undefined,
      conversation_id: String(conversation.id),
    },
  })

  if (isFirstInbound) {
    await runAutomationsForTrigger({
      accountId,
      triggerType: 'first_inbound_message',
      contactId: String(contact.id),
      context: {
        message_text: event.contentText ?? undefined,
        conversation_id: String(conversation.id),
      },
    })
  }

  await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: String(contact.id),
    conversationId: String(conversation.id),
    message: {
      kind: event.contentType === 'interactive' ? 'interactive_reply' : 'text',
      text: event.contentText ?? '',
      reply_id: event.interactiveReplyId ?? '',
      reply_title: event.contentText ?? '',
      meta_message_id: event.providerMessageId,
    },
    isFirstInboundMessage: isFirstInbound,
  } as const)

  await dispatchInboundToAiReply({
    accountId,
    conversationId: String(conversation.id),
    contactId: String(contact.id),
    configOwnerUserId,
  })

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    message_id: messageId,
    conversation_id: conversation.id,
    contact_id: contact.id,
    text: event.contentText,
  })
}

async function insertInboundMessage(
  event: NormalizedInboundEvent,
  conversationId: string,
): Promise<string | null> {
  const providerMessageId = event.providerMessageId

  // Idempotency: if a row with this conversation + provider message id
  // already exists, this is a replay. Return the existing id without
  // side effects.
  const { data: existing } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', providerMessageId)
    .maybeSingle()

  if (existing) {
    return existing.id as string
  }

  const { data, error } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'customer',
      content_type: event.contentType,
      content_text: event.contentText,
      media_url: event.mediaUrl,
      media_type: event.mediaType,
      message_id: providerMessageId,
      status: 'delivered',
      created_at: event.timestamp,
    })
    .select('id')
    .single()

  if (error) {
    // Lost the race against a concurrent insert.
    if (isUniqueViolation(error)) {
      const { data: raced } = await supabaseAdmin()
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('message_id', providerMessageId)
        .maybeSingle()
      return (raced?.id as string) ?? null
    }
    console.error('[evolution webhook] message insert failed:', error)
    return null
  }

  return (data.id as string) ?? null
}

async function handleFromMeEcho(event: NormalizedInboundEvent) {
  // If we already have an outbound message with this provider id, mark
  // it as delivered/read. Otherwise ignore the echo.
  const { data: existing } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', event.providerMessageId)
    .maybeSingle()

  if (existing) {
    await supabaseAdmin()
      .from('messages')
      .update({ status: 'delivered' })
      .eq('id', existing.id)
  }
}

async function handleStatusUpdate(event: NormalizedStatusEvent) {
  // Update messages.status.
  await supabaseAdmin()
    .from('messages')
    .update({ status: event.status })
    .eq('message_id', event.providerMessageId)

  // Update broadcast_recipients if applicable.
  const update: Record<string, unknown> = { status: event.status }
  if (event.status === 'sent') update.sent_at = event.timestamp
  if (event.status === 'delivered') update.delivered_at = event.timestamp
  if (event.status === 'read') update.read_at = event.timestamp

  const { data: recipient } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id')
    .eq('whatsapp_message_id', event.providerMessageId)
    .maybeSingle()

  if (recipient) {
    await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id)
  }

  // Public webhook fan-out.
  const { data: msgRow } = await supabaseAdmin()
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', event.providerMessageId)
    .limit(1)
    .maybeSingle()

  if (msgRow) {
    const conv = msgRow.conversations as { account_id: string } | null
    const accountId = conv?.account_id
    if (accountId) {
      await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.status_updated', {
        whatsapp_message_id: event.providerMessageId,
        conversation_id: msgRow.conversation_id,
        status: event.status,
      })
    }
  }
}

// ============================================================
// Helpers
// ============================================================

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  displayName?: string | null,
): Promise<{ contact: { id: string; [key: string]: unknown }; contactCreated: boolean } | null> {
  const existing = await findExistingContact(supabaseAdmin(), accountId, phone)
  if (existing) {
    return { contact: existing as { id: string; [key: string]: unknown }, contactCreated: false }
  }

  const name = displayName?.trim() || phone
  const { data, error } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name,
    })
    .select('*')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced as { id: string; [key: string]: unknown }, contactCreated: false }
    }
    console.error('[evolution webhook] contact create failed:', error)
    return null
  }

  return { contact: data as { id: string; [key: string]: unknown }, contactCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
): Promise<{ conversation: { id: string; [key: string]: unknown }; created: boolean } | null> {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[evolution webhook] conversation find error:', findError)
    return null
  }

  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0] as { id: string; [key: string]: unknown }, created: false }
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select('*')
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) {
        return { conversation: raced[0] as { id: string; [key: string]: unknown }, created: false }
      }
    }
    console.error('[evolution webhook] conversation create failed:', createError)
    return null
  }

  return { conversation: newConv as { id: string; [key: string]: unknown }, created: true }
}

async function bumpConversation(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  lastMessageText: string | null,
) {
  try {
    await db.rpc('bump_conversation_on_inbound', {
      p_conversation_id: conversationId,
      p_last_message_text: lastMessageText ?? '',
    })
  } catch (err) {
    // Fallback if the RPC is unavailable (should not happen after migration 037).
    console.warn('[evolution webhook] bump RPC failed, falling back:', err)
    await db
      .from('conversations')
      .update({
        unread_count: 1,
        last_message_text: lastMessageText ?? '',
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
  }
}

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', recs[0].id)
  } catch (err) {
    console.error('[evolution webhook] flagBroadcastReplyIfAny failed:', err)
  }
}

async function isFirstCustomerMessage(conversationId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')

  if (error) {
    console.error('[evolution webhook] first message check failed:', error)
    return false
  }

  return (count ?? 0) <= 1
}
