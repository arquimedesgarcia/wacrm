import type { WhatsAppConfig } from '@/types'

/**
 * Supported WhatsApp provider kinds.
 *
 * The type is intentionally closed; adding a new provider is a
 * deliberate code change that forces updates to the resolver, tests
 * and provider contract rather than a runtime string.
 */
export type WhatsAppProviderKind = 'meta' | 'evolution'

/**
 * Normalized content type for inbound messages.
 *
 * Maps to the `messages.content_type` CHECK constraint values
 * (widened in migration 010). Stickers are normalized to 'image'.
 */
export type NormalizedContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'template'
  | 'interactive'

/**
 * Direction-aware status values used by providers.
 *
 * For outbound messages this is the lifecycle reported by the
 * provider's status webhook. For inbound messages the status is
 * fixed to 'delivered' from the pipeline's perspective.
 */
export type ProviderMessageStatus =
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'

/**
 * Normalized inbound event produced by every provider adapter.
 *
 * The pipeline consumes this shape and is responsible for resolving
 * account, contact, conversation, idempotency, unread counts and
 * fan-out to automations / flows / AI / public webhooks. The adapter
 * MUST NOT make account-level policy decisions.
 */
export interface NormalizedInboundEvent {
  /** Provider that emitted the event. */
  provider: WhatsAppProviderKind
  /** Provider-scoped instance / number identifier. */
  providerInstanceId: string
  /** Provider-scoped message id. Used for idempotency. */
  providerMessageId: string
  /** Canonical phone/JID of the remote party. */
  senderPhone: string
  /** Display name supplied by the provider, if any. */
  displayName?: string | null
  /** Event timestamp as an ISO 8601 string in UTC. */
  timestamp: string
  /** True when the message was sent by us (outbound echo). */
  isFromMe: boolean
  /** Normalized content type. */
  contentType: NormalizedContentType
  /** Text body or caption. */
  contentText: string | null
  /** Durable media URL when the event carries an attachment. */
  mediaUrl: string | null
  /** MIME type reported by the provider. */
  mediaType: string | null
  /** Stable id of the message this one replies to, when known. */
  replyToProviderMessageId: string | null
  /** For interactive/button replies: the stable option id. */
  interactiveReplyId: string | null
  /** Raw provider payload kept for diagnostics only. */
  rawPayload?: unknown
}

/**
 * Normalized status update event.
 *
 * Not every inbound webhook carries a message; status events are
 * delivered separately and must not be treated as conversations.
 */
export interface NormalizedReactionEvent {
  provider: WhatsAppProviderKind
  providerInstanceId: string
  /** Provider id of the reaction event itself, for fallback idempotency. */
  providerMessageId: string
  /** JID of the chat containing the reaction. */
  remoteJid: string
  /** JID of the customer who reacted. */
  actorJid: string
  /** Provider id of the target message. */
  targetProviderMessageId: string
  /** Empty string means remove the reaction. */
  emoji: string
  timestamp: string
  rawPayload?: unknown
}

export interface NormalizedStatusEvent {
  provider: WhatsAppProviderKind
  providerInstanceId: string
  providerMessageId: string
  /** Remote recipient phone/JID. */
  recipientPhone: string
  status: ProviderMessageStatus
  timestamp: string
  /** Provider-reported error, if status === 'failed'. */
  errorMessage?: string | null
}

/**
 * Union of inbound events a provider can normalize from a webhook.
 */
export type NormalizedWebhookEvent =
  | NormalizedInboundEvent
  | NormalizedReactionEvent
  | NormalizedStatusEvent

/**
 * Result type for every outbound send operation.
 *
 * Adapters must not expose API keys, tokens or raw response bodies
 * beyond the provider message id.
 */
export interface SendResult {
  provider: WhatsAppProviderKind
  providerMessageId: string
  status: ProviderMessageStatus
}

/**
 * Base fields shared by every outbound send input.
 */
export interface SendBaseInput {
  /** Supabase client (RLS or service role). */
  db: SupabaseClient
  /** Tenant account id. */
  accountId: string
  /** Acting user id (audit / sender-of-record). */
  userId: string
  /** Internal conversation id. */
  conversationId: string
  /** Internal contact id. */
  contactId: string
  /** Phone/JID of the recipient. */
  to: string
  /** Provider message id this message replies to. */
  replyToProviderMessageId?: string | null
}

/**
 * Input for sending a free-form text message.
 */
export interface SendTextInput extends SendBaseInput {
  /** Message body. */
  text: string
  /** Marks an AI auto-reply for the inbox badge. */
  aiGenerated?: boolean
}

/**
 * Input for sending media.
 */
export interface SendMediaInput extends SendBaseInput {
  kind: 'image' | 'video' | 'document' | 'audio'
  url: string
  caption?: string | null
  filename?: string | null
}

/**
 * Input for sending an approved template.
 */
export interface SendTemplateInput extends SendBaseInput {
  templateName: string
  language?: string | null
  params?: string[]
}

/**
 * Input for sending an interactive message (buttons or list).
 */
export interface SendInteractiveInput extends SendBaseInput {
  payload: {
    kind: 'buttons' | 'list'
    body: string
    header?: string
    footer?: string
    buttons?: Array<{ id: string; title: string }>
    buttonLabel?: string
    sections?: Array<{
      title: string
      rows: Array<{ id: string; title: string; description?: string }>
    }>
  }
}

/**
 * Minimal provider identity returned by configuration verification.
 */
export interface ProviderIdentity {
  provider: WhatsAppProviderKind
  /** Human-readable identifier of the connected number/instance. */
  displayName: string
  /** Provider-side number or instance id. */
  providerInstanceId: string
}

/**
 * Generic connection status.
 */
export interface ConnectionStatus {
  connected: boolean
  /** Provider-specific detail string suitable for logs. */
  detail: string | null
}

/**
 * QR code payload returned by providers that support pairing via QR.
 */
export interface QrCode {
  /** Base64-encoded QR image, or a data-URI. */
  base64: string
  /** Raw string the provider returned (useful for custom rendering). */
  raw?: string
}

/**
 * Internal provider contract.
 *
 * The interface is intentionally small: it only models what the
 * common pipeline needs right now. Capabilities that a provider
 * cannot support with equivalent semantics (e.g. Meta templates on
 * Evolution) must return a typed error rather than fake success.
 */
export interface WhatsAppProvider {
  readonly kind: WhatsAppProviderKind

  /** Verify credentials/connection and return a stable identity. */
  verifyConfiguration(config: WhatsAppConfig): Promise<ProviderIdentity>

  /** Query whether the provider is currently able to send/receive. */
  getConnectionStatus(config: WhatsAppConfig): Promise<ConnectionStatus>

  /** Create or reconnect the provider-side instance (Evolution QR flow). */
  createOrConnect?(
    config: WhatsAppConfig,
  ): Promise<{ qr?: QrCode | null; status: ConnectionStatus }>

  /** Fetch a fresh QR code if supported. */
  getQrCode?(
    config: WhatsAppConfig,
  ): Promise<{ qr: QrCode | null; status: ConnectionStatus }>

  /** Outbound sends. */
  sendText(input: SendTextInput, config: WhatsAppConfig): Promise<SendResult>
  sendMedia?(
    input: SendMediaInput,
    config: WhatsAppConfig,
  ): Promise<SendResult>
  sendTemplate?(
    input: SendTemplateInput,
    config: WhatsAppConfig,
  ): Promise<SendResult>
  sendInteractive?(
    input: SendInteractiveInput,
    config: WhatsAppConfig,
  ): Promise<SendResult>

  /**
   * Convert a raw provider webhook payload into normalized inbound
   * events. The return is an array because a single webhook can carry
   * multiple messages or status updates.
   */
  normalizeInbound(payload: unknown): NormalizedWebhookEvent[]
}

// Needed for SendBaseInput (above) without importing at top.
import type { SupabaseClient } from '@supabase/supabase-js'
