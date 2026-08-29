// ============================================================
// Evolution API adapter for the internal WhatsApp provider
// contract.
//
// Targets Evolution API v2.3.7 with Baileys / WhatsApp Web pairing.
// Supports:
//   - instance creation
//   - QR pairing
//   - connection state queries
//   - text send
//   - inbound webhook normalization for MESSAGES_UPSERT and status events
//
// Capabilities without equivalent semantics (Meta-style templates,
// interactive lists) throw CapabilityNotSupportedError.
// ============================================================

import type { WhatsAppConfig } from '@/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  normalizeInboundPhone,
  normalizeOutboundPhone,
  normalizeContentType,
  normalizeTimestamp,
  normalizeDisplayName,
} from './normalize'
import type {
  ConnectionStatus,
  ProviderIdentity,
  QrCode,
  SendResult,
  SendTextInput,
  WhatsAppProvider,
  NormalizedWebhookEvent,
  NormalizedInboundEvent,
  NormalizedStatusEvent,
} from './types'
import { ProviderError, CapabilityNotSupportedError } from './errors'

export class EvolutionAdapter implements WhatsAppProvider {
  readonly kind = 'evolution' as const

  async verifyConfiguration(config: WhatsAppConfig): Promise<ProviderIdentity> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config)

    try {
      await this.#fetchConnectionState(baseUrl, apiKey, instanceName)
      return {
        provider: 'evolution',
        displayName: instanceName,
        providerInstanceId: this.#getInstanceId(config) ?? instanceName,
      }
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_API_ERROR',
        err instanceof Error ? err.message : 'Evolution verification failed',
        { provider: 'evolution', cause: err },
      )
    }
  }

  async getConnectionStatus(config: WhatsAppConfig): Promise<ConnectionStatus> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config)

    try {
      const state = await this.#fetchConnectionState(baseUrl, apiKey, instanceName)
      const stateLower = String(state.state ?? state).toLowerCase()
      const connected = stateLower === 'open' || stateLower === 'connected'
      return {
        connected,
        detail: stateLower,
      }
    } catch (err) {
      return {
        connected: false,
        detail: err instanceof Error ? err.message : 'unknown',
      }
    }
  }

  async createOrConnect(
    config: WhatsAppConfig,
  ): Promise<{ qr?: QrCode | null; status: ConnectionStatus }> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config)

    try {
      // Ensure instance exists with QR enabled.
      await this.#request(`${baseUrl}/instance/create`, apiKey, {
        method: 'POST',
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          // Do not set webhook here; the caller owns webhook configuration.
        }),
      })

      const { qr, status } = await this.getQrCode(config)
      return { qr, status }
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_API_ERROR',
        err instanceof Error ? err.message : 'Evolution create/connect failed',
        { provider: 'evolution', cause: err },
      )
    }
  }

  async getQrCode(
    config: WhatsAppConfig,
  ): Promise<{ qr: QrCode | null; status: ConnectionStatus }> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config)

    try {
      const data = await this.#request(
        `${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`,
        apiKey,
        { method: 'GET' },
      )

      const status = await this.getConnectionStatus(config)
      const qrCode = this.#extractQrCode(data)

      if (!qrCode && !status.connected) {
        return {
          qr: null,
          status: { connected: false, detail: 'QR not available yet' },
        }
      }

      return { qr: qrCode, status }
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_API_ERROR',
        err instanceof Error ? err.message : 'Evolution QR fetch failed',
        { provider: 'evolution', cause: err },
      )
    }
  }

  async sendText(input: SendTextInput, config: WhatsAppConfig): Promise<SendResult> {
    const { to, text, replyToProviderMessageId } = input
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config)
    const phone = normalizeOutboundPhone(to)

    if (!phone) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Recipient phone is required',
        { provider: 'evolution' },
      )
    }

    const body: Record<string, unknown> = {
      number: phone,
      text,
    }
    if (replyToProviderMessageId) {
      body.quotedMessageId = replyToProviderMessageId
    }

    try {
      const data = (await this.#request(
        `${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`,
        apiKey,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      )) as { key?: { id?: string }; messageTimestamp?: number; status?: string }

      const providerMessageId =
        data.key?.id ??
        // Fallback: some Evolution responses use a flat id field.
        (data as unknown as { id?: string }).id ??
        `evolution-${Date.now()}`

      return {
        provider: 'evolution',
        providerMessageId,
        status: this.#normalizeStatus(data.status),
      }
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_API_ERROR',
        err instanceof Error ? err.message : 'Evolution send failed',
        { provider: 'evolution', cause: err },
      )
    }
  }

  sendMedia(): Promise<SendResult> {
    throw new CapabilityNotSupportedError('media send', 'evolution')
  }

  sendTemplate(): Promise<SendResult> {
    throw new CapabilityNotSupportedError('template send', 'evolution')
  }

  sendInteractive(): Promise<SendResult> {
    throw new CapabilityNotSupportedError('interactive send', 'evolution')
  }

  /**
   * Normalize Evolution webhook payloads.
   *
   * Supports:
   *   - messages.upsert (incoming text, media metadata)
   *   - status update events delivered as message updates with status
   *   - qrcode.updated (emitted as connection event with QR payload)
   *   - connection.update
   *
   * Unknown event types are ignored so the webhook can ack safely.
   */
  normalizeInbound(payload: unknown): NormalizedWebhookEvent[] {
    if (!payload || typeof payload !== 'object') return []

    const p = payload as Record<string, unknown>
    const event = String(p.event ?? '').toLowerCase()

    switch (event) {
      case 'messages.upsert':
      case 'messages_upsert':
        return this.#normalizeMessagesUpsert(p)
      case 'qrcode.updated':
      case 'qrcode_updated':
        return this.#normalizeQrCode(p)
      case 'connection.update':
      case 'connection_update':
        return this.#normalizeConnectionUpdate(p)
      default:
        // Best-effort: if it looks like a message update with status,
        // normalize as status event.
        if (p.data && typeof p.data === 'object') {
          const data = p.data as Record<string, unknown>
          if ('status' in data && 'id' in data) {
            return this.#normalizeStatusEvent(p)
          }
        }
        return []
    }
  }

  // ============================================================
  // Private helpers
  // ============================================================

  #requireConfig(config: WhatsAppConfig): {
    baseUrl: string
    apiKey: string
    instanceName: string
  } {
    const raw = config as unknown as Record<string, unknown>

    const baseUrl = raw.evolution_base_url
    const apiKeyCipher = raw.evolution_api_key
    const instanceName = raw.evolution_instance_name

    if (!baseUrl || typeof baseUrl !== 'string') {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution base URL is missing',
        { provider: 'evolution' },
      )
    }

    if (!apiKeyCipher || typeof apiKeyCipher !== 'string') {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution API key is missing',
        { provider: 'evolution' },
      )
    }

    if (!instanceName || typeof instanceName !== 'string') {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution instance name is missing',
        { provider: 'evolution' },
      )
    }

    let apiKey: string
    try {
      // During verification (POST /config) the candidate config carries the
      // plaintext API key before it is encrypted for storage. decrypt() will
      // fail on a non-cipher value, so fall back to the raw string in that
      // case.
      apiKey = decrypt(apiKeyCipher)
    } catch {
      apiKey = apiKeyCipher as string
    }

    return {
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey,
      instanceName,
    }
  }

  #getInstanceId(config: WhatsAppConfig): string | undefined {
    const raw = config as unknown as Record<string, unknown>
    return typeof raw.evolution_instance_id === 'string'
      ? raw.evolution_instance_id
      : undefined
  }

  async #fetchConnectionState(
    baseUrl: string,
    apiKey: string,
    instanceName: string,
  ): Promise<Record<string, unknown>> {
    return this.#request(
      `${baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      apiKey,
      { method: 'GET' },
    ) as Promise<Record<string, unknown>>
  }

  async #request(
    url: string,
    apiKey: string,
    init: RequestInit,
  ): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
        ...(init.headers ?? {}),
      },
    })

    if (!response.ok) {
      let message = `Evolution API error: ${response.status}`
      try {
        const body = (await response.json()) as { error?: string; message?: string }
        if (body.error || body.message) {
          message = body.error ?? body.message ?? message
        }
      } catch {
        // ignore non-JSON error body
      }
      throw new Error(message)
    }

    try {
      return await response.json()
    } catch {
      return {}
    }
  }

  #extractQrCode(data: unknown): QrCode | null {
    if (!data || typeof data !== 'object') return null
    const d = data as Record<string, unknown>

    const code =
      typeof d.base64 === 'string'
        ? d.base64
        : typeof d.qrcode === 'string'
          ? d.qrcode
          : typeof d.code === 'string'
            ? d.code
            : null

    if (!code) return null

    const base64 = code.startsWith('data:') ? code : `data:image/png;base64,${code}`
    return { base64, raw: code }
  }

  #normalizeStatus(status: unknown): 'sending' | 'sent' | 'failed' {
    const s = String(status ?? 'sent').toLowerCase()
    if (s === 'pending' || s === 'sending') return 'sending'
    if (s === 'failed' || s === 'error') return 'failed'
    return 'sent'
  }

  #normalizeMessagesUpsert(payload: Record<string, unknown>): NormalizedWebhookEvent[] {
    const data = payload.data
    if (!data || typeof data !== 'object') return []

    const d = data as Record<string, unknown>
    const messages = Array.isArray(d.messages) ? d.messages : [d]

    const events: NormalizedWebhookEvent[] = []

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue
      const m = msg as Record<string, unknown>

      const key = (m.key ?? {}) as Record<string, unknown>
      const messageContent = (m.message ?? {}) as Record<string, unknown>
      const pushName = normalizeDisplayName(String(m.pushName ?? ''))

      const fromJid = String(key.remoteJid ?? '')
      const fromPhone = normalizeInboundPhone(fromJid)
      if (!fromPhone) continue

      const providerInstanceId =
        typeof payload.instanceId === 'string'
          ? payload.instanceId
          : typeof d.instanceId === 'string'
            ? d.instanceId
            : 'unknown'

      const providerMessageId = String(key.id ?? `evolution-${Date.now()}`)
      const isFromMe = key.fromMe === true
      const timestamp = normalizeTimestamp(
        (m.messageTimestamp as string | number | undefined) ??
          (messageContent.messageTimestamp as string | number | undefined),
      )

      // Status-only update on a message we sent.
      if (m.status && typeof m.status === 'string') {
        events.push({
          provider: 'evolution',
          providerInstanceId,
          providerMessageId,
          recipientPhone: fromPhone,
          status: this.#mapInboundStatus(m.status),
          timestamp,
          errorMessage: null,
        } as NormalizedStatusEvent)
        continue
      }

      const conversationContent = (
        messageContent.conversation ?? {}
      ) as Record<string, unknown>
      const text =
        typeof conversationContent === 'string'
          ? conversationContent
          : String(conversationContent.text ?? messageContent.text ?? '')

      const type = normalizeContentType(
        messageContent.image
          ? 'image'
          : messageContent.video
            ? 'video'
            : messageContent.audio
              ? 'audio'
              : messageContent.document
                ? 'document'
                : messageContent.location
                  ? 'location'
                  : 'text',
      )

      const event: NormalizedInboundEvent = {
        provider: 'evolution',
        providerInstanceId,
        providerMessageId,
        senderPhone: fromPhone,
        displayName: pushName,
        timestamp,
        isFromMe,
        contentType: type,
        contentText: text || null,
        mediaUrl: null,
        mediaType: null,
        replyToProviderMessageId: null,
        interactiveReplyId: null,
        rawPayload: m,
      }

      events.push(event)
    }

    return events
  }

  #normalizeQrCode(payload: Record<string, unknown>): NormalizedWebhookEvent[] {
    const data = payload.data
    const qr = data && typeof data === 'object' ? this.#extractQrCode(data) : null

    return [
      {
        provider: 'evolution',
        providerInstanceId: String(
          payload.instanceId ??
            (data && typeof data === 'object'
              ? (data as Record<string, unknown>).instanceId ?? 'unknown'
              : 'unknown'),
        ),
        providerMessageId: `qr-${Date.now()}`,
        senderPhone: '',
        displayName: null,
        timestamp: normalizeTimestamp(undefined),
        isFromMe: false,
        contentType: 'text',
        contentText: qr ? 'QR code updated' : 'QR code event received',
        mediaUrl: qr?.base64 ?? null,
        mediaType: qr ? 'image/png' : null,
        replyToProviderMessageId: null,
        interactiveReplyId: null,
        rawPayload: payload,
      },
    ]
  }

  #normalizeConnectionUpdate(
    payload: Record<string, unknown>,
  ): NormalizedWebhookEvent[] {
    const data = payload.data
    const state =
      data && typeof data === 'object'
        ? String((data as Record<string, unknown>).state ?? '')
        : ''

    return [
      {
        provider: 'evolution',
        providerInstanceId: String(
          payload.instanceId ??
            (data && typeof data === 'object'
              ? (data as Record<string, unknown>).instanceId ?? 'unknown'
              : 'unknown'),
        ),
        providerMessageId: `conn-${Date.now()}`,
        senderPhone: '',
        displayName: null,
        timestamp: normalizeTimestamp(undefined),
        isFromMe: false,
        contentType: 'text',
        contentText: `Connection state: ${state || 'unknown'}`,
        mediaUrl: null,
        mediaType: null,
        replyToProviderMessageId: null,
        interactiveReplyId: null,
        rawPayload: payload,
      },
    ]
  }

  #normalizeStatusEvent(payload: Record<string, unknown>): NormalizedWebhookEvent[] {
    const data = payload.data as Record<string, unknown>
    const providerInstanceId = String(
      payload.instanceId ??
        (data && typeof data === 'object'
          ? (data as Record<string, unknown>).instanceId ?? 'unknown'
          : 'unknown'),
    )

    return [
      {
        provider: 'evolution',
        providerInstanceId,
        providerMessageId: String(data.id ?? `status-${Date.now()}`),
        recipientPhone: normalizeInboundPhone(String(data.remoteJid ?? '')),
        status: this.#mapInboundStatus(String(data.status ?? 'sent')),
        timestamp: normalizeTimestamp(data.timestamp as string | number | undefined),
        errorMessage: typeof data.error === 'string' ? data.error : null,
      } as NormalizedStatusEvent,
    ]
  }

  #mapInboundStatus(status: string): 'sending' | 'sent' | 'delivered' | 'read' | 'failed' {
    switch (status.toLowerCase()) {
      case 'pending':
      case 'sending':
        return 'sending'
      case 'sent':
      case 'server_ack':
        return 'sent'
      case 'delivered':
      case 'delivery_ack':
        return 'delivered'
      case 'read':
      case 'read_ack':
        return 'read'
      case 'failed':
      case 'error':
        return 'failed'
      default:
        return 'sent'
    }
  }
}
