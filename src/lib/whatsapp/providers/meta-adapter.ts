// ============================================================
// Meta Cloud API adapter for the internal WhatsApp provider
// contract.
//
// This is a thin facade over src/lib/whatsapp/meta-api.ts. It does
// NOT change Meta behaviour; it only translates between the internal
// provider contract and the existing Meta helpers so that senders,
// webhooks and the UI can be provider-agnostic.
//
// All heavy logic (phone variants, template resolution, media,
// interactive validation) stays in its original files.
// ============================================================

import type { WhatsAppConfig } from '@/types'
import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  verifyPhoneNumber,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import type {
  ConnectionStatus,
  ProviderIdentity,
  QrCode,
  SendInteractiveInput,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
  WhatsAppProvider,
  NormalizedWebhookEvent,
} from './types'
import { ProviderError, CapabilityNotSupportedError } from './errors'

export class MetaAdapter implements WhatsAppProvider {
  readonly kind = 'meta' as const

  async verifyConfiguration(config: WhatsAppConfig): Promise<ProviderIdentity> {
    const accessToken = this.#requireAccessToken(config)
    const phoneNumberId = this.#requirePhoneNumberId(config)

    try {
      const info = await verifyPhoneNumber({ phoneNumberId, accessToken })
      return {
        provider: 'meta',
        displayName: info.display_phone_number,
        providerInstanceId: info.id,
      }
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_API_ERROR',
        err instanceof Error ? err.message : 'Meta verification failed',
        { provider: 'meta', cause: err },
      )
    }
  }

  async getConnectionStatus(config: WhatsAppConfig): Promise<ConnectionStatus> {
    // Meta Cloud API does not expose a real-time "connected" socket.
    // We treat the config as connected when we can verify the number.
    try {
      const identity = await this.verifyConfiguration(config)
      return { connected: true, detail: identity.displayName }
    } catch {
      return { connected: false, detail: 'Unable to verify Meta phone number' }
    }
  }

  // QR pairing is not applicable to Meta Cloud API.
  createOrConnect?(
    config: WhatsAppConfig,
  ): Promise<{ qr?: QrCode | null; status: ConnectionStatus }> {
    void config
    throw new CapabilityNotSupportedError('QR pairing', 'meta')
  }

  getQrCode?(config: WhatsAppConfig): Promise<{
    qr: QrCode | null
    status: ConnectionStatus
  }> {
    void config
    throw new CapabilityNotSupportedError('QR pairing', 'meta')
  }

  async sendText(input: SendTextInput, config: WhatsAppConfig): Promise<SendResult> {
    const { to, text, replyToProviderMessageId } = input
    const accessToken = this.#requireAccessToken(config)
    const phoneNumberId = this.#requirePhoneNumberId(config)
    const phone = this.#normalizePhone(to)

    const waMessageId = await this.#withPhoneVariants(phone, async (p) =>
      sendTextMessage({
        phoneNumberId,
        accessToken,
        to: p,
        text,
        contextMessageId: replyToProviderMessageId ?? undefined,
      }),
    )

    return {
      provider: 'meta',
      providerMessageId: waMessageId,
      status: 'sent',
    }
  }

  async sendMedia(
    input: SendMediaInput,
    config: WhatsAppConfig,
  ): Promise<SendResult> {
    const { to, kind, url, caption, filename, replyToProviderMessageId } = input
    const accessToken = this.#requireAccessToken(config)
    const phoneNumberId = this.#requirePhoneNumberId(config)
    const phone = this.#normalizePhone(to)

    const waMessageId = await this.#withPhoneVariants(phone, async (p) =>
      sendMediaMessage({
        phoneNumberId,
        accessToken,
        to: p,
        kind: kind as MediaKind,
        link: url,
        caption: caption ?? undefined,
        filename: filename ?? undefined,
        contextMessageId: replyToProviderMessageId ?? undefined,
      }),
    )

    return {
      provider: 'meta',
      providerMessageId: waMessageId,
      status: 'sent',
    }
  }

  async sendTemplate(
    input: SendTemplateInput,
    config: WhatsAppConfig,
  ): Promise<SendResult> {
    const { to, templateName, language, params, replyToProviderMessageId } =
      input
    const accessToken = this.#requireAccessToken(config)
    const phoneNumberId = this.#requirePhoneNumberId(config)
    const phone = this.#normalizePhone(to)

    const waMessageId = await this.#withPhoneVariants(phone, async (p) =>
      sendTemplateMessage({
        phoneNumberId,
        accessToken,
        to: p,
        templateName,
        language: language ?? 'en_US',
        params,
        contextMessageId: replyToProviderMessageId ?? undefined,
      }),
    )

    return {
      provider: 'meta',
      providerMessageId: waMessageId,
      status: 'sent',
    }
  }

  async sendInteractive(
    input: SendInteractiveInput,
    config: WhatsAppConfig,
  ): Promise<SendResult> {
    const { to, payload, replyToProviderMessageId } = input
    const accessToken = this.#requireAccessToken(config)
    const phoneNumberId = this.#requirePhoneNumberId(config)
    const phone = this.#normalizePhone(to)

    const waMessageId = await this.#withPhoneVariants(phone, async (p) => {
      if (payload.kind === 'buttons') {
        return sendInteractiveButtons({
          phoneNumberId,
          accessToken,
          to: p,
          bodyText: payload.body,
          headerText: payload.header,
          footerText: payload.footer,
          buttons:
            payload.buttons?.map((b) => ({
              id: b.id,
              title: b.title,
            })) ?? [],
          contextMessageId: replyToProviderMessageId ?? undefined,
        })
      }
      return sendInteractiveList({
        phoneNumberId,
        accessToken,
        to: p,
        bodyText: payload.body,
        buttonLabel: payload.buttonLabel ?? 'Options',
        headerText: payload.header,
        footerText: payload.footer,
        sections:
          payload.sections?.map((s) => ({
            title: s.title,
            rows: s.rows.map((r) => ({
              id: r.id,
              title: r.title,
              description: r.description,
            })),
          })) ?? [],
        contextMessageId: replyToProviderMessageId ?? undefined,
      })
    })

    return {
      provider: 'meta',
      providerMessageId: waMessageId,
      status: 'sent',
    }
  }

  /**
   * Meta webhook normalization.
   *
   * For now this returns an empty array. The existing Meta webhook at
   * src/app/api/whatsapp/webhook/route.ts is large, battle-tested and
   * tightly coupled to Meta-specific events (status, reactions,
   * interactive replies, media mirroring). Refactoring it to use this
   * adapter is planned in a follow-up phase so we don't risk regressions
   * while introducing the abstraction.
   */
  normalizeInbound(payload: unknown): NormalizedWebhookEvent[] {
    void payload
    return []
  }

  // ============================================================
  // Helpers
  // ============================================================

  #requireAccessToken(config: WhatsAppConfig): string {
    if (!config.access_token) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Meta access token is missing',
        { provider: 'meta' },
      )
    }
    return decrypt(config.access_token)
  }

  #requirePhoneNumberId(config: WhatsAppConfig): string {
    if (!config.phone_number_id) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Meta phone number ID is missing',
        { provider: 'meta' },
      )
    }
    return config.phone_number_id
  }

  #normalizePhone(phone: string): string {
    const sanitized = sanitizePhoneForMeta(phone)
    if (!isValidE164(sanitized)) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        `Invalid phone number: ${phone}`,
        { provider: 'meta' },
      )
    }
    return sanitized
  }

  async #withPhoneVariants(
    phone: string,
    attempt: (phone: string) => Promise<{ messageId: string }>,
  ): Promise<string> {
    const variants = phoneVariants(phone)
    let lastError: unknown = null

    for (const variant of variants) {
      try {
        const result = await attempt(variant)
        return result.messageId
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(message)) {
          throw err
        }
        lastError = err
      }
    }

    if (lastError) throw lastError
    throw new Error('No phone variant succeeded')
  }
}
