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

import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { EvolutionAdapter } from '@/lib/whatsapp/providers/evolution-adapter';
import { resolveEvolutionMessageMedia } from '@/lib/whatsapp/providers/evolution-media';
import {
  extractInstanceName,
  sanitizeWebhookPayload,
} from '@/lib/whatsapp/providers/evolution-webhook-helpers';
import { normalizeInboundPhone } from '@/lib/whatsapp/providers/normalize';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { shouldApplyMessageStatus } from '@/lib/whatsapp/providers/status';
import type {
  NormalizedInboundEvent,
  NormalizedReactionEvent,
  NormalizedStatusEvent,
} from '@/lib/whatsapp/providers/types';
import type { WhatsAppConfig } from '@/types';

export const maxDuration = 60;

// Lazy-initialized admin client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

/**
 * POST handler for Evolution webhooks.
 *
 * Auth: Evolution v2.3.7 sends the configured custom header. We expect
 * the webhook to be configured with `apikey: <webhook_secret>` and we
 * compare it against the stored `evolution_webhook_secret` (decrypted).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const instanceName = extractInstanceName(payload);
  if (!instanceName) {
    return NextResponse.json(
      { error: 'Missing instance name' },
      { status: 400 }
    );
  }

  // Resolve account + authenticate BEFORE acking so a bad request does
  // not get silently swallowed.
  const resolution = await resolveAccount(instanceName);
  if (!resolution) {
    return NextResponse.json(
      { error: 'Unknown Evolution instance' },
      { status: 401 }
    );
  }

  const { config, accountId } = resolution;

  // Only process webhooks for accounts that are actively using Evolution.
  if (config.provider !== 'evolution') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authenticateWebhook(request, config)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Strip secrets from the payload before any logging or processing.
  const sanitizedPayload = sanitizeWebhookPayload(payload);

  // Ack quickly, process in the background.
  after(async () => {
    try {
      await processEvolutionWebhook(
        sanitizedPayload,
        accountId,
        config.user_id as string,
        config
      );
    } catch (error) {
      console.error('[evolution webhook] processing error:', error);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

// ============================================================
// Account resolution and auth
// ============================================================

async function resolveAccount(instanceName: string): Promise<{
  config: Record<string, unknown>;
  accountId: string;
} | null> {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'evolution')
    .eq('evolution_instance_name', instanceName)
    .maybeSingle();

  if (error || !data) {
    console.warn('[evolution webhook] no config for instance:', instanceName);
    return null;
  }

  return {
    config: data as Record<string, unknown>,
    accountId: data.account_id as string,
  };
}

function authenticateWebhook(
  request: Request,
  config: Record<string, unknown>
): boolean {
  const secretCipher = config.evolution_webhook_secret;
  if (!secretCipher || typeof secretCipher !== 'string') {
    console.warn('[evolution webhook] no webhook secret configured');
    return false;
  }

  let expected: string;
  try {
    expected = decrypt(secretCipher);
  } catch {
    console.warn('[evolution webhook] webhook secret decrypt failed');
    return false;
  }

  const sent =
    request.headers.get('apikey') ??
    request.headers.get('x-evolution-api-secret') ??
    '';
  return sent === expected;
}

// ============================================================
// Webhook processing pipeline
// ============================================================

/**
 * Extract the connection state from a raw Evolution CONNECTION_UPDATE
 * payload. Evolution v2.3.7 sends the state under `data.state`.
 */
function extractConnectionState(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const event = String(p.event ?? '').toLowerCase();
  if (event !== 'connection.update' && event !== 'connection_update')
    return null;

  const data = p.data;
  if (!data || typeof data !== 'object') return null;
  const state = String(
    (data as Record<string, unknown>).state ?? ''
  ).toLowerCase();
  return state || null;
}

/**
 * Keep whatsapp_config.status in sync with the actual Evolution instance
 * state. This is the source of truth for the inbox "WhatsApp not connected"
 * banner and other UI indicators.
 */
async function updateConnectionStatus(accountId: string, payload: unknown) {
  const state = extractConnectionState(payload);
  if (!state) return;

  const isConnected = state === 'open';
  const status = isConnected ? 'connected' : 'disconnected';

  try {
    await supabaseAdmin()
      .from('whatsapp_config')
      .update({
        status,
        connected_at: isConnected ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('provider', 'evolution');
  } catch (err) {
    console.error(
      '[evolution webhook] failed to update connection status:',
      err
    );
  }
}

async function processEvolutionWebhook(
  payload: unknown,
  accountId: string,
  configOwnerUserId: string,
  config: Record<string, unknown>
) {
  // Sync the persisted config status before normalization so the inbox
  // banner reflects the real Evolution state even if the user has not
  // reloaded the page.
  await updateConnectionStatus(accountId, payload);

  const adapter = new EvolutionAdapter();
  const events = adapter.normalizeInbound(payload);

  for (const event of events) {
    try {
      if ('targetProviderMessageId' in event) {
        await handleInboundReaction(
          event as NormalizedReactionEvent,
          accountId,
          configOwnerUserId
        );
        continue;
      }
      if ('recipientPhone' in event) {
        await handleStatusUpdate(event as NormalizedStatusEvent);
        continue;
      }

      const messageEvent = event as NormalizedInboundEvent;
      if (!messageEvent.senderPhone) continue;
      if (messageEvent.isFromMe) {
        // Outbound echoes from a linked device: update existing outbound
        // row if present, otherwise create the message locally (it was
        // written on the linked phone itself). Never treated as inbound.
        await handleFromMeEcho(
          messageEvent,
          config,
          accountId,
          configOwnerUserId
        );
        continue;
      }

      await handleInboundMessage(
        messageEvent,
        accountId,
        configOwnerUserId,
        config
      );
    } catch (err) {
      console.error('[evolution webhook] event processing error:', err);
    }
  }
}

async function handleInboundReaction(
  event: NormalizedReactionEvent,
  accountId: string,
  configOwnerUserId: string
) {
  const actorPhone = normalizeInboundPhone(event.actorJid);
  if (!actorPhone || !isValidE164(actorPhone)) return;

  const db = supabaseAdmin();
  const { data: target } = await db
    .from('messages')
    .select('id, conversation_id, conversations(contact_id)')
    .eq('message_id', event.targetProviderMessageId)
    .limit(1)
    .maybeSingle();

  if (target) {
    const conversation = target.conversations as { contact_id?: string } | null;
    const actorId = conversation?.contact_id;
    if (!actorId) return;

    const reactionQuery = db
      .from('message_reactions')
      .delete()
      .eq('message_id', target.id)
      .eq('actor_type', 'customer')
      .eq('actor_id', actorId);
    if (!event.emoji) {
      await reactionQuery;
      return;
    }

    await db.from('message_reactions').upsert(
      {
        message_id: target.id,
        conversation_id: target.conversation_id,
        actor_type: 'customer',
        actor_id: actorId,
        emoji: event.emoji,
        created_at: event.timestamp,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    );
    return;
  }

  // The target may arrive later. Keep a visible, non-empty, idempotent row
  // without entering the inbound-message fan-out.
  if (!event.emoji) return;
  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    actorPhone
  );
  if (!contactOutcome) return;
  const convOutcome = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactOutcome.contact.id
  );
  if (!convOutcome) return;

  const existing = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', convOutcome.conversation.id)
    .eq('message_id', event.providerMessageId)
    .maybeSingle();
  if (existing.data) return;

  await db.from('messages').insert({
    conversation_id: convOutcome.conversation.id,
    sender_type: 'customer',
    content_type: 'text',
    content_text: event.emoji,
    message_id: event.providerMessageId,
    status: 'delivered',
    created_at: event.timestamp,
  });
}

// ============================================================
// Inbound message handling
// ============================================================

async function handleInboundMessage(
  event: NormalizedInboundEvent,
  accountId: string,
  configOwnerUserId: string,
  config: Record<string, unknown>
) {
  const phone = normalizeInboundPhone(event.senderPhone);
  if (!phone) {
    console.warn('[evolution webhook] empty sender phone');
    return;
  }
  // Defense in depth: the adapter only emits E.164-valid sender phones,
  // but a contact must never be created from anything else.
  if (!isValidE164(phone)) {
    console.warn('[evolution webhook] invalid sender phone, skipping:', phone);
    return;
  }

  // 1. Find or create contact.
  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    phone,
    event.displayName
  );
  if (!contactOutcome) return;
  const { contact, contactCreated } = contactOutcome;

  // 2. Find or create conversation.
  const convOutcome = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contact.id
  );
  if (!convOutcome) return;
  const { conversation, created: convCreated } = convOutcome;

  // 3. Conversation created event for public webhooks.
  if (convCreated) {
    await dispatchWebhookEvent(
      supabaseAdmin(),
      accountId,
      'conversation.created',
      {
        conversation_id: String(conversation.id),
        contact_id: String(contact.id),
      }
    );
  }

  // 4. Reopen closed conversation if needed.
  await reopenClosedConversation(supabaseAdmin(), {
    id: String(conversation.id),
  });

  // 5. Resolve durable media (Evolution delivers metadata only; the
  //    bytes live behind the instance). Best-effort: a failed mirror
  //    leaves mediaUrl null but we still persist the text/caption row.
  let mediaUrl: string | null = event.mediaUrl;
  let mediaType: string | null = event.mediaType;
  if (
    event.contentType === 'image' ||
    event.contentType === 'video' ||
    event.contentType === 'audio'
  ) {
    try {
      const resolved = await resolveEvolutionMessageMedia({
        config: config as unknown as WhatsAppConfig,
        rawPayload: (event.rawPayload ?? {}) as Record<string, unknown>,
        accountId,
        storage: supabaseAdmin().storage,
      });
      if (resolved.mediaUrl) {
        mediaUrl = resolved.mediaUrl;
      }
      // Always preserve the resolved/preserved MIME even when the bytes
      // could not be mirrored — the UI needs it to pick an audio icon.
      if (resolved.mediaType) {
        mediaType = resolved.mediaType;
      }
    } catch (err) {
      console.warn('[evolution webhook] media resolve failed:', err);
    }
  }

  // 6. Idempotent insert.
  const messageId = await insertInboundMessage(
    event,
    String(conversation.id),
    mediaUrl,
    mediaType
  );
  if (!messageId) return;

  // 6. Bump conversation summary.
  await bumpConversation(
    supabaseAdmin(),
    String(conversation.id),
    event.contentText
  );

  // 7. Mark any pending broadcast as replied.
  await flagBroadcastReplyIfAny(accountId, String(contact.id));

  // 8. Fan-out to automations, flows, AI, public webhooks.
  const isFirstInbound =
    contactCreated || (await isFirstCustomerMessage(String(conversation.id)));

  await runAutomationsForTrigger({
    accountId,
    triggerType: 'new_message_received',
    contactId: String(contact.id),
    context: {
      message_text: event.contentText ?? undefined,
      conversation_id: String(conversation.id),
    },
  });

  if (isFirstInbound) {
    await runAutomationsForTrigger({
      accountId,
      triggerType: 'first_inbound_message',
      contactId: String(contact.id),
      context: {
        message_text: event.contentText ?? undefined,
        conversation_id: String(conversation.id),
      },
    });
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
  } as const);

  await dispatchInboundToAiReply({
    accountId,
    conversationId: String(conversation.id),
    contactId: String(contact.id),
    configOwnerUserId,
  });

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    message_id: messageId,
    conversation_id: conversation.id,
    contact_id: contact.id,
    text: event.contentText,
  });
}

async function insertInboundMessage(
  event: NormalizedInboundEvent,
  conversationId: string,
  mediaUrl: string | null = event.mediaUrl,
  mediaType: string | null = event.mediaType
): Promise<string | null> {
  const providerMessageId = event.providerMessageId;

  // Idempotency: if a row with this conversation + provider message id
  // already exists, this is a replay. Return the existing id without
  // side effects.
  const { data: existing } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', providerMessageId)
    .maybeSingle();

  if (existing) {
    return existing.id as string;
  }

  const { data, error } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: event.isFromMe ? 'agent' : 'customer',
      content_type: event.contentType,
      content_text: event.contentText,
      media_url: mediaUrl,
      media_type: mediaType,
      message_id: providerMessageId,
      status: event.isFromMe ? 'sent' : 'delivered',
      created_at: event.timestamp,
    })
    .select('id')
    .single();

  if (error) {
    // Lost the race against a concurrent insert.
    if (isUniqueViolation(error)) {
      const { data: raced } = await supabaseAdmin()
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('message_id', providerMessageId)
        .maybeSingle();
      return (raced?.id as string) ?? null;
    }
    console.error('[evolution webhook] message insert failed:', error);
    return null;
  }

  return (data.id as string) ?? null;
}

async function handleFromMeEcho(
  event: NormalizedInboundEvent,
  config: Record<string, unknown>,
  accountId: string,
  configOwnerUserId: string
) {
  // If we already have a message with this provider id (an outbound send
  // that originated in WaCRM), treat the echo as a status update only.
  const { data: existing } = await supabaseAdmin()
    .from('messages')
    .select('id, conversation_id, status')
    .eq('message_id', event.providerMessageId)
    .maybeSingle();

  if (existing) {
    if (shouldApplyMessageStatus(existing.status, 'delivered')) {
      await supabaseAdmin()
        .from('messages')
        .update({ status: 'delivered' })
        .eq('id', existing.id)
        .eq('status', existing.status);
    }
    return;
  }

  // A fromMe message with no local row means it was written on the linked
  // phone itself. Resolve the recipient, find-or-create the conversation,
  // persist it as an outbound (agent) message, and bump the summary — but
  // do NOT count it as unread or fire inbound automations/flows/AI.
  const recipientPhone = normalizeInboundPhone(event.senderPhone);
  if (!recipientPhone || !isValidE164(recipientPhone)) {
    console.warn(
      '[evolution webhook] fromMe echo: unresolvable recipient',
      event.senderPhone
    );
    return;
  }

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    recipientPhone,
    event.displayName
  );
  if (!contactOutcome) return;
  const convOutcome = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactOutcome.contact.id
  );
  if (!convOutcome) return;

  // Resolve durable media (images/video/audio sent from the phone).
  let phoneMediaUrl: string | null = event.mediaUrl;
  let phoneMediaType: string | null = event.mediaType;
  if (
    event.contentType === 'image' ||
    event.contentType === 'video' ||
    event.contentType === 'audio'
  ) {
    try {
      const resolved = await resolveEvolutionMessageMedia({
        config: config as unknown as WhatsAppConfig,
        rawPayload: (event.rawPayload ?? {}) as Record<string, unknown>,
        accountId,
        storage: supabaseAdmin().storage,
      });
      if (resolved.mediaUrl) {
        phoneMediaUrl = resolved.mediaUrl;
      }
      // Preserve MIME even when bytes could not be mirrored.
      if (resolved.mediaType) {
        phoneMediaType = resolved.mediaType;
      }
    } catch (err) {
      console.warn('[evolution webhook] fromMe media resolve failed:', err);
    }
  }

  const messageId = await insertInboundMessage(
    event,
    String(convOutcome.conversation.id),
    phoneMediaUrl,
    phoneMediaType
  );
  if (!messageId) return;

  // Update the conversation summary WITHOUT bumping unread_count.
  await bumpConversationSummaryOnly(
    supabaseAdmin(),
    String(convOutcome.conversation.id),
    event.contentText
  );
}

async function handleStatusUpdate(event: NormalizedStatusEvent) {
  console.info('[evolution webhook] status event received:', {
    instance: event.providerInstanceId,
    messageId: event.providerMessageId,
    status: event.status,
  });

  // Apply only forward lifecycle transitions. Evolution can deliver stale
  // updates after a message is already read.
  const { data: message } = await supabaseAdmin()
    .from('messages')
    .select('id, status')
    .eq('message_id', event.providerMessageId)
    .limit(1)
    .maybeSingle();

  if (message && shouldApplyMessageStatus(message.status, event.status)) {
    await supabaseAdmin()
      .from('messages')
      .update({ status: event.status })
      .eq('id', message.id)
      .eq('status', message.status);
  } else if (!message) {
    console.warn('[evolution webhook] status message not found:', {
      instance: event.providerInstanceId,
      messageId: event.providerMessageId,
      status: event.status,
    });
  }

  // Update broadcast_recipients if applicable.
  const update: Record<string, unknown> = { status: event.status };
  if (event.status === 'sent') update.sent_at = event.timestamp;
  if (event.status === 'delivered') update.delivered_at = event.timestamp;
  if (event.status === 'read') update.read_at = event.timestamp;

  const { data: recipient } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id')
    .eq('whatsapp_message_id', event.providerMessageId)
    .maybeSingle();

  if (recipient) {
    await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id);
  }

  // Public webhook fan-out.
  const { data: msgRow } = await supabaseAdmin()
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', event.providerMessageId)
    .limit(1)
    .maybeSingle();

  if (msgRow) {
    const conv = msgRow.conversations as { account_id: string } | null;
    const accountId = conv?.account_id;
    if (accountId) {
      await dispatchWebhookEvent(
        supabaseAdmin(),
        accountId,
        'message.status_updated',
        {
          whatsapp_message_id: event.providerMessageId,
          conversation_id: msgRow.conversation_id,
          status: event.status,
        }
      );
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
  displayName?: string | null
): Promise<{
  contact: { id: string; [key: string]: unknown };
  contactCreated: boolean;
} | null> {
  const existing = await findExistingContact(supabaseAdmin(), accountId, phone);
  if (existing) {
    return {
      contact: existing as { id: string; [key: string]: unknown },
      contactCreated: false,
    };
  }

  const name = displayName?.trim() || phone;
  const { data, error } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name,
    })
    .select('*')
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(
        supabaseAdmin(),
        accountId,
        phone
      );
      if (raced)
        return {
          contact: raced as { id: string; [key: string]: unknown },
          contactCreated: false,
        };
    }
    console.error('[evolution webhook] contact create failed:', error);
    return null;
  }

  return {
    contact: data as { id: string; [key: string]: unknown },
    contactCreated: true,
  };
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string
): Promise<{
  conversation: { id: string; [key: string]: unknown };
  created: boolean;
} | null> {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findError) {
    console.error('[evolution webhook] conversation find error:', findError);
    return null;
  }

  if (existingRows && existingRows.length > 0) {
    return {
      conversation: existingRows[0] as { id: string; [key: string]: unknown },
      created: false,
    };
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select('*')
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        return {
          conversation: raced[0] as { id: string; [key: string]: unknown },
          created: false,
        };
      }
    }
    console.error(
      '[evolution webhook] conversation create failed:',
      createError
    );
    return null;
  }

  return {
    conversation: newConv as { id: string; [key: string]: unknown },
    created: true,
  };
}

async function bumpConversation(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  lastMessageText: string | null
) {
  try {
    await db.rpc('bump_conversation_on_inbound', {
      p_conversation_id: conversationId,
      p_last_message_text: lastMessageText ?? '',
    });
  } catch (err) {
    // Fallback if the RPC is unavailable (should not happen after migration 037).
    console.warn('[evolution webhook] bump RPC failed, falling back:', err);
    await db
      .from('conversations')
      .update({
        unread_count: 1,
        last_message_text: lastMessageText ?? '',
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
  }
}

/**
 * Update a conversation's last-message summary WITHOUT incrementing
 * unread_count. Used for messages written on the linked phone itself
 * (fromMe echoes with no existing local row): they are outbound from the
 * account's perspective, so they must not appear as unread customer
 * messages. Falls back to a plain summary update if the RPC is missing.
 */
async function bumpConversationSummaryOnly(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  lastMessageText: string | null
) {
  try {
    await db.rpc('bump_conversation_on_outbound', {
      p_conversation_id: conversationId,
      p_last_message_text: lastMessageText ?? '',
    });
  } catch {
    await db
      .from('conversations')
      .update({
        last_message_text: lastMessageText ?? '',
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
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
      .limit(1);

    if (error || !recs || recs.length === 0) return;

    await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', recs[0].id);
  } catch (err) {
    console.error('[evolution webhook] flagBroadcastReplyIfAny failed:', err);
  }
}

async function isFirstCustomerMessage(
  conversationId: string
): Promise<boolean> {
  const { count, error } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer');

  if (error) {
    console.error('[evolution webhook] first message check failed:', error);
    return false;
  }

  return (count ?? 0) <= 1;
}
