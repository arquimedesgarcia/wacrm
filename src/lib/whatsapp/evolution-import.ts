// ============================================================
// Historical import for Evolution API.
//
// Imports contacts and their text-message history from an already
// connected Evolution/Baileys instance into WaCRM's conversations.
//
// Principles:
//   * Idempotent: re-running the import does not duplicate contacts or
//     messages because we key off (conversation_id, message_id).
//   * Bounded: only imports messages up to `daysLimit` days old.
//   * Resilient: one failed contact/message does not abort the whole run.
//   * Group- and media-free for this first iteration.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WhatsAppConfig } from '@/types'
import {
  EvolutionAdapter,
  type EvolutionContact,
  type EvolutionMessage,
} from './providers/evolution-adapter'
import { normalizeInboundPhone } from './providers/normalize'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'

export interface ImportEvolutionHistoryOptions {
  /** Service-role or RLS-scoped Supabase client. */
  db: SupabaseClient
  /** Tenant account id. */
  accountId: string
  /** User id used as audit column for created rows. */
  ownerUserId: string
  /** Active Evolution config row. */
  config: WhatsAppConfig
  /** How many days back to import (default 30). */
  daysLimit?: number
  /** Page size for /chat/findContacts. */
  contactsBatchSize?: number
  /** Page size for /chat/findMessages. */
  messagesBatchSize?: number
}

export interface ImportEvolutionHistoryResult {
  importedContacts: number
  importedMessages: number
  skippedContacts: number
  skippedMessages: number
  errors: string[]
}

const DEFAULT_DAYS_LIMIT = 30
const DEFAULT_CONTACTS_BATCH = 100
const DEFAULT_MESSAGES_BATCH = 100

/**
 * Import contacts and recent message history from Evolution.
 *
 * This function can take seconds or minutes depending on the history size,
 * so callers should normally invoke it inside `after()` or a background job.
 */
export async function importEvolutionHistory(
  options: ImportEvolutionHistoryOptions,
): Promise<ImportEvolutionHistoryResult> {
  const {
    db,
    accountId,
    ownerUserId,
    config,
    daysLimit = DEFAULT_DAYS_LIMIT,
    contactsBatchSize = DEFAULT_CONTACTS_BATCH,
    messagesBatchSize = DEFAULT_MESSAGES_BATCH,
  } = options

  const result: ImportEvolutionHistoryResult = {
    importedContacts: 0,
    importedMessages: 0,
    skippedContacts: 0,
    skippedMessages: 0,
    errors: [],
  }

  const adapter = new EvolutionAdapter()
  const instanceName = config.evolution_instance_name ?? 'unknown'
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysLimit)
  const cutoffIso = cutoffDate.toISOString()

  let contactsOffset = 0
  let contactsDone = false

  while (!contactsDone) {
    let contacts: EvolutionContact[] = []
    try {
      contacts = await adapter.findContacts(config, {
        limit: contactsBatchSize,
        offset: contactsOffset,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`findContacts failed at offset ${contactsOffset}: ${message}`)
      break
    }

    if (contacts.length === 0) {
      contactsDone = true
      break
    }

    for (const contact of contacts) {
      try {
        const outcome = await importContactHistory(
          db,
          adapter,
          accountId,
          ownerUserId,
          config,
          contact,
          messagesBatchSize,
          cutoffIso,
          instanceName,
        )
        result.importedContacts += outcome.importedContact ? 1 : 0
        result.importedMessages += outcome.importedMessages
        result.skippedContacts += outcome.skippedContact ? 1 : 0
        result.skippedMessages += outcome.skippedMessages
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`contact ${contact.remoteJid}: ${message}`)
      }
    }

    contactsOffset += contacts.length
    if (contacts.length < contactsBatchSize) {
      contactsDone = true
    }
  }

  // Persist the import timestamp only if we made any progress. If the whole
  // run errored out early we leave the column untouched so the next attempt
  // can retry from scratch.
  if (result.importedContacts > 0 || result.importedMessages > 0) {
    const { error: updateError } = await db
      .from('whatsapp_config')
      .update({ evolution_history_imported_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('provider', 'evolution')

    if (updateError) {
      result.errors.push(
        `Failed to persist import timestamp: ${updateError.message}`,
      )
    }
  }

  return result
}

interface ContactImportOutcome {
  importedContact: boolean
  importedMessages: number
  skippedContact: boolean
  skippedMessages: number
}

async function importContactHistory(
  db: SupabaseClient,
  adapter: EvolutionAdapter,
  accountId: string,
  ownerUserId: string,
  config: WhatsAppConfig,
  contact: EvolutionContact,
  messagesBatchSize: number,
  cutoffIso: string,
  instanceName: string,
): Promise<ContactImportOutcome> {
  const outcome: ContactImportOutcome = {
    importedContact: false,
    importedMessages: 0,
    skippedContact: false,
    skippedMessages: 0,
  }

  // Skip groups and broadcast lists in this iteration.
  if (/@(g\.us|broadcast|newsletter)$/i.test(contact.remoteJid)) {
    outcome.skippedContact = true
    return outcome
  }

  const phone = normalizeInboundPhone(contact.remoteJid)
  if (!phone) {
    outcome.skippedContact = true
    return outcome
  }

  // Find or create contact.
  let contactId: string
  const existingContact = await findExistingContact(db, accountId, phone)
  if (existingContact) {
    contactId = existingContact.id
    const newName = contact.pushName?.trim()
    if (newName && newName !== existingContact.name) {
      await db
        .from('contacts')
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq('id', contactId)
    }
  } else {
    const name = contact.pushName?.trim() || phone
    const { data: created, error } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone,
        name,
      })
      .select('id')
      .single()

    if (error) {
      if (isUniqueViolation(error)) {
        const raced = await findExistingContact(db, accountId, phone)
        if (raced) {
          contactId = raced.id
        } else {
          throw new Error('Contact race lost and could not recover')
        }
      } else {
        throw new Error(error.message)
      }
    } else if (!created) {
      throw new Error('Contact insert returned no row')
    } else {
      contactId = created.id
      outcome.importedContact = true
    }
  }

  // Find or create conversation.
  const conversationId = await findOrCreateConversationRow(
    db,
    accountId,
    ownerUserId,
    contactId,
  )

  // Fetch messages in pages.
  let messagesOffset = 0
  let messagesDone = false

  while (!messagesDone) {
    let messages: EvolutionMessage[] = []
    try {
      messages = await adapter.findMessages(config, contact.remoteJid, {
        limit: messagesBatchSize,
        offset: messagesOffset,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`findMessages failed: ${message}`)
    }

    if (messages.length === 0) {
      messagesDone = true
      break
    }

    for (const rawMsg of messages) {
      // The remoteJid filter is unreliable in some Evolution versions;
      // discard messages that clearly belong to another chat.
      const msgRemoteJid = rawMsg.key?.remoteJid
      if (msgRemoteJid && msgRemoteJid !== contact.remoteJid) {
        outcome.skippedMessages += 1
        continue
      }

      const event = adapter.normalizeHistoricalMessage(rawMsg, instanceName)
      if (!event) {
        outcome.skippedMessages += 1
        continue
      }

      // Skip non-text/media types for this iteration (media is left null).
      if (event.contentType !== 'text') {
        outcome.skippedMessages += 1
        continue
      }

      // Skip messages older than the cutoff window.
      if (event.timestamp < cutoffIso) {
        outcome.skippedMessages += 1
        continue
      }

      // Skip groups (second safety net).
      if (/@(g\.us|broadcast|newsletter)$/i.test(event.senderPhone)) {
        outcome.skippedMessages += 1
        continue
      }

      const inserted = await insertHistoricalMessage(
        db,
        conversationId,
        event,
      )
      if (inserted) {
        outcome.importedMessages += 1
      } else {
        outcome.skippedMessages += 1
      }
    }

    messagesOffset += messages.length
    if (messages.length < messagesBatchSize) {
      messagesDone = true
    }
  }

  return outcome
}

async function findOrCreateConversationRow(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
): Promise<string> {
  const { data: existing, error: findErr } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findErr) {
    throw new Error(`Conversation lookup failed: ${findErr.message}`)
  }

  if (existing && existing.length > 0) {
    return existing[0].id as string
  }

  const { data: newConv, error: convErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
    })
    .select('id')
    .single()

  if (convErr) {
    if (isUniqueViolation(convErr)) {
      const { data: raced } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) {
        return raced[0].id as string
      }
    }
    throw new Error(`Conversation create failed: ${convErr.message}`)
  }

  if (!newConv) {
    throw new Error('Conversation insert returned no row')
  }

  return newConv.id as string
}

async function insertHistoricalMessage(
  db: SupabaseClient,
  conversationId: string,
  event: ReturnType<EvolutionAdapter['normalizeHistoricalMessage']> & {},
): Promise<boolean> {
  if (!event) return false

  const providerMessageId = event.providerMessageId

  // Idempotency check.
  const { data: existing } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', providerMessageId)
    .maybeSingle()

  if (existing) return false

  const { error } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: event.isFromMe ? 'agent' : 'customer',
    content_type: event.contentType,
    content_text: event.contentText,
    media_url: null,
    media_type: null,
    message_id: providerMessageId,
    status: event.isFromMe ? 'sent' : 'delivered',
    created_at: event.timestamp,
  })

  if (error) {
    if (isUniqueViolation(error)) return false
    throw new Error(`Message insert failed: ${error.message}`)
  }

  return true
}
