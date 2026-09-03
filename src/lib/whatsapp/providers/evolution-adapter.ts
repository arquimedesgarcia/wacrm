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
//   - inbound webhook normalization for MESSAGES_UPSERT, MESSAGES_UPDATE,
//     QRCODE_UPDATED and CONNECTION_UPDATE events
//
// Capabilities without equivalent semantics (Meta-style templates,
// interactive lists) throw CapabilityNotSupportedError.
// ============================================================

import type { WhatsAppConfig } from '@/types';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  normalizeInboundPhone,
  normalizeOutboundPhone,
  normalizeContentType,
  normalizeTimestamp,
  normalizeDisplayName,
} from './normalize';
import { parseJid, resolveInboundPhone } from './jid';
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
} from './types';
import { ProviderError, CapabilityNotSupportedError } from './errors';

const REQUEST_TIMEOUT_MS = 10_000;
const GET_RETRY_DELAY_MS = 500;
const GET_MAX_ATTEMPTS = 2;

export interface EvolutionContact {
  id: string;
  remoteJid: string;
  pushName?: string | null;
  profilePictureUrl?: string | null;
}

export interface EvolutionMessage {
  key?: {
    id?: string;
    remoteJid?: string;
    fromMe?: boolean;
  };
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number | string;
}

export class EvolutionAdapter implements WhatsAppProvider {
  readonly kind = 'evolution' as const;

  async verifyConfiguration(config: WhatsAppConfig): Promise<ProviderIdentity> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config);

    try {
      const state = await this.#fetchConnectionState(
        baseUrl,
        apiKey,
        instanceName
      );
      const stateLower = this.#connectionStateValue(state);

      // connectionState returns HTTP 200 even for unknown instances, but
      // state is undefined. Treat that as "not found" instead of success.
      if (stateLower === 'unknown') {
        throw new ProviderError(
          'PROVIDER_API_ERROR',
          `Evolution instance "${instanceName}" does not exist or is not reachable`,
          { provider: 'evolution', status: 404 }
        );
      }

      return {
        provider: 'evolution',
        displayName: instanceName,
        providerInstanceId: this.#getInstanceId(config) ?? instanceName,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        'PROVIDER_API_ERROR',
        err instanceof Error ? err.message : 'Evolution verification failed',
        { provider: 'evolution', cause: err }
      );
    }
  }

  async getConnectionStatus(config: WhatsAppConfig): Promise<ConnectionStatus> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config);

    try {
      const state = await this.#fetchConnectionState(
        baseUrl,
        apiKey,
        instanceName
      );
      const stateLower = this.#connectionStateValue(state);
      return {
        connected: stateLower === 'open',
        detail: stateLower,
      };
    } catch (err) {
      return {
        connected: false,
        detail: this.#safeErrorDetail(err),
      };
    }
  }

  async createOrConnect(
    config: WhatsAppConfig
  ): Promise<{ qr?: QrCode | null; status: ConnectionStatus }> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config);

    try {
      const exists = await this.#instanceExists(baseUrl, apiKey, instanceName);

      if (!exists) {
        try {
          await this.#request(
            `${baseUrl}/instance/create`,
            apiKey,
            {
              method: 'POST',
              body: JSON.stringify({
                instanceName,
                qrcode: true,
                integration: 'WHATSAPP-BAILEYS',
              }),
            },
            { allowRetry: false }
          );
        } catch (err) {
          // Race condition: another request created it in the meantime.
          const isAlreadyExists =
            err instanceof ProviderError &&
            (err.status === 400 ||
              err.status === 409 ||
              /already|exists/i.test(err.message));
          if (!isAlreadyExists) throw err;
        }
      }

      return this.getQrCode(config);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        'PROVIDER_API_ERROR',
        err instanceof Error ? err.message : 'Evolution create/connect failed',
        { provider: 'evolution', cause: err }
      );
    }
  }

  async getQrCode(
    config: WhatsAppConfig
  ): Promise<{ qr: QrCode | null; status: ConnectionStatus }> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config);

    try {
      const data = await this.#request(
        `${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`,
        apiKey,
        { method: 'GET' },
        { allowRetry: true }
      );

      if (this.#isErrorResponse(data)) {
        throw this.#providerErrorFromResponse(data, 404);
      }

      let status = await this.getConnectionStatus(config);
      let qrCode = this.#extractQrCode(data);

      // The QR can take a moment to be generated right after /instance/create.
      // Retry once before giving up so the user sees the pairing code.
      if (!qrCode && !status.connected) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          const retry = await this.#request(
            `${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`,
            apiKey,
            { method: 'GET' },
            { allowRetry: true }
          );
          if (!this.#isErrorResponse(retry)) {
            qrCode = this.#extractQrCode(retry);
          }
        } catch {
          // keep the original result
        }
        status = await this.getConnectionStatus(config);
      }

      if (!qrCode && !status.connected) {
        return {
          qr: null,
          status: { connected: false, detail: 'QR not available yet' },
        };
      }

      return { qr: qrCode, status };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        'PROVIDER_API_ERROR',
        err instanceof Error ? err.message : 'Evolution QR fetch failed',
        { provider: 'evolution', cause: err }
      );
    }
  }

  async sendText(
    input: SendTextInput,
    config: WhatsAppConfig
  ): Promise<SendResult> {
    const { to, text } = input;
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config);
    const phone = normalizeOutboundPhone(to);

    if (!phone) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Recipient phone is required',
        { provider: 'evolution' }
      );
    }

    const body: Record<string, unknown> = {
      number: phone,
      text,
    };

    // Note: Evolution v2.3.7 supports quoted replies via a full
    // { key, message } structure. WaCRM does not yet store the quoted
    // message body from Evolution, so we omit quoting to avoid sending
    // an invalid payload.

    try {
      const data = (await this.#request(
        `${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`,
        apiKey,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        { allowRetry: false }
      )) as Record<string, unknown>;

      const key = (data.key ?? {}) as Record<string, unknown>;
      const providerMessageId = String(
        key.id ?? data.keyId ?? `evolution-${Date.now()}`
      );

      return {
        provider: 'evolution',
        providerMessageId,
        status: this.#normalizeStatus(data.status),
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        'PROVIDER_API_ERROR',
        err instanceof Error ? err.message : 'Evolution send failed',
        { provider: 'evolution', cause: err }
      );
    }
  }

  sendMedia(): Promise<SendResult> {
    throw new CapabilityNotSupportedError('media send', 'evolution');
  }

  sendTemplate(): Promise<SendResult> {
    throw new CapabilityNotSupportedError('template send', 'evolution');
  }

  sendInteractive(): Promise<SendResult> {
    throw new CapabilityNotSupportedError('interactive send', 'evolution');
  }

  /**
   * Configure the instance webhook on Evolution.
   *
   * Evolution v2.3.7 uses POST /webhook/set/{instanceName} with a
   * nested `webhook` object. The caller supplies the public URL where
   * WaCRM receives events and the secret that Evolution must send in
   * the `apikey` header.
   */
  async configureWebhook(
    config: WhatsAppConfig,
    webhookUrl: string,
    webhookSecret: string
  ): Promise<void> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config);

    // Defensive validation: the URL must be plain and parseable. This catches
    // accidental template literals like `@url:...` or backticks that could be
    // injected by a misconfigured proxy or environment variable.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        `Webhook URL is not a valid URL: ${webhookUrl}`,
        { provider: 'evolution' }
      );
    }

    if (!/^https?:$/i.test(parsedUrl.protocol)) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        `Webhook URL must use http or https: ${webhookUrl}`,
        { provider: 'evolution' }
      );
    }

    // Audit log so operators can verify the exact URL sent to Evolution.
    console.log('[evolution] configuring webhook URL:', parsedUrl.toString());

    await this.#request(
      `${baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`,
      apiKey,
      {
        method: 'POST',
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: parsedUrl.toString(),
            byEvents: false,
            base64: false,
            headers: { apikey: webhookSecret },
            events: [
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'QRCODE_UPDATED',
              'CONNECTION_UPDATE',
            ],
          },
        }),
      },
      { allowRetry: false }
    );
  }

  /**
   * Fetch contacts stored on the Evolution instance.
   *
   * Uses POST /chat/findContacts/{instanceName}. The endpoint returns both
   * saved contacts and users the instance has chatted with.
   *
   * Since the WhatsApp LID rollout the same person can appear twice in
   * one response: once as `phone@s.whatsapp.net` and once as `lid@lid`.
   * A LID is never a phone, so entries whose pushName matches a PN entry
   * in the same response are dropped here; unpaired LID entries are left
   * for the import layer to skip (they cannot yield a phone).
   */
  async findContacts(
    config: WhatsAppConfig,
    options: { limit?: number; offset?: number } = {}
  ): Promise<EvolutionContact[]> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config);
    const { limit = 100, offset = 0 } = options;

    const data = (await this.#request(
      `${baseUrl}/chat/findContacts/${encodeURIComponent(instanceName)}`,
      apiKey,
      {
        method: 'POST',
        body: JSON.stringify({ limit, offset }),
      },
      { allowRetry: true }
    )) as Record<string, unknown>;

    const contacts = Array.isArray(data.contacts)
      ? data.contacts
      : Array.isArray(data)
        ? data
        : [];

    const mapped = contacts
      .map((item) => {
        const c = item as Record<string, unknown>;
        return {
          id: String(c.id ?? ''),
          remoteJid: String(c.remoteJid ?? ''),
          pushName: c.pushName as string | null | undefined,
          profilePictureUrl: c.profilePictureUrl as string | null | undefined,
        };
      })
      .filter((c) => c.remoteJid && c.remoteJid.trim() !== '');

    const pnNames = new Set(
      mapped
        .filter((c) => {
          const server = parseJid(c.remoteJid)?.server;
          return server === 's.whatsapp.net' || server === 'hosted';
        })
        .map((c) => c.pushName?.trim())
        .filter((name): name is string => Boolean(name))
    );

    return mapped.filter((c) => {
      const server = parseJid(c.remoteJid)?.server;
      const isLidIdentity = server === 'lid' || server === 'hosted.lid';
      if (
        isLidIdentity &&
        c.pushName?.trim() &&
        pnNames.has(c.pushName.trim())
      ) {
        return false;
      }
      return true;
    });
  }

  /**
   * Fetch historical messages for a single remote JID.
   *
   * Uses POST /chat/findMessages/{instanceName}. The `where.key.remoteJid`
   * filter is requested but Evolution versions may ignore it; callers should
   * discard messages whose `key.remoteJid` does not match.
   */
  async findMessages(
    config: WhatsAppConfig,
    remoteJid: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<EvolutionMessage[]> {
    const { baseUrl, apiKey, instanceName } = this.#requireConfig(config);
    const { limit = 100, offset = 0 } = options;

    const data = (await this.#request(
      `${baseUrl}/chat/findMessages/${encodeURIComponent(instanceName)}`,
      apiKey,
      {
        method: 'POST',
        body: JSON.stringify({
          where: { key: { remoteJid } },
          limit,
          offset,
        }),
      },
      { allowRetry: true }
    )) as Record<string, unknown>;

    if (Array.isArray(data)) return data as EvolutionMessage[];
    if (Array.isArray(data.messages))
      return data.messages as EvolutionMessage[];
    if (Array.isArray(data.data)) return data.data as EvolutionMessage[];
    return [];
  }

  /**
   * Normalize a single historical message returned by /chat/findMessages
   * into the same shape used by inbound webhook events.
   *
   * Returns null when the message has no usable sender phone (e.g. groups
   * or malformed payloads).
   */
  normalizeHistoricalMessage(
    msg: unknown,
    providerInstanceId?: string
  ): NormalizedInboundEvent | null {
    if (!msg || typeof msg !== 'object') return null;
    const m = msg as Record<string, unknown>;

    const key = (m.key ?? {}) as Record<string, unknown>;
    const messageContent = (m.message ?? {}) as Record<string, unknown>;
    const pushName = normalizeDisplayName(String(m.pushName ?? ''));

    // Resolve the sender phone by classifying the JID domain: PN, LID,
    // group, broadcast… A LID is never a phone — it is resolved through
    // remoteJidAlt/participantAlt when Evolution provides the mapping.
    // Events without a resolvable phone (groups, unmapped LIDs, invalid
    // user parts like "5842638954921490236991") are skipped and logged
    // so the raw key fields stay observable for diagnosis.
    const identity = resolveInboundPhone({
      remoteJid: key.remoteJid,
      remoteJidAlt: key.remoteJidAlt,
      participant: key.participant,
      participantAlt: key.participantAlt,
    });
    if (!identity.phone) {
      console.warn(
        '[evolution] inbound skipped, no resolvable phone:',
        JSON.stringify({
          remoteJid: key.remoteJid ?? null,
          remoteJidAlt: key.remoteJidAlt ?? null,
          participant: key.participant ?? null,
          participantAlt: key.participantAlt ?? null,
          addressingMode: key.addressingMode ?? null,
          reason: identity.skipReason,
        })
      );
      return null;
    }
    const fromPhone = identity.phone;

    const providerMessageId = String(key.id ?? `evolution-${Date.now()}`);
    const isFromMe = key.fromMe === true;
    const timestamp = normalizeTimestamp(
      (m.messageTimestamp as string | number | undefined) ??
        (messageContent.messageTimestamp as string | number | undefined)
    );

    const mediaContent = messageContent as Record<string, { caption?: unknown }>;
    const conversationContent = (messageContent.conversation ?? {}) as Record<
      string,
      unknown
    >;
    const text =
      typeof conversationContent === 'string'
        ? conversationContent
        : String(
            conversationContent.text ??
              messageContent.text ??
              mediaContent.imageMessage?.caption ??
              mediaContent.videoMessage?.caption ??
              mediaContent.documentMessage?.caption ??
              '',
          );

    const type = normalizeContentType(
      messageContent.imageMessage || messageContent.stickerMessage
        ? 'image'
        : messageContent.videoMessage
          ? 'video'
          : messageContent.audioMessage
            ? 'audio'
            : messageContent.documentMessage
              ? 'document'
              : messageContent.locationMessage
                ? 'location'
                : 'text'
    );

    return {
      provider: 'evolution',
      providerInstanceId: providerInstanceId ?? 'unknown',
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
    };
  }

  /**
   * Normalize Evolution webhook payloads.
   *
   * Supports:
   *   - messages.upsert (incoming text, media metadata)
   *   - messages.update (status updates)
   *   - qrcode.updated (emitted as connection event with QR payload)
   *   - connection.update
   *
   * Unknown event types are ignored so the webhook can ack safely.
   */
  normalizeInbound(payload: unknown): NormalizedWebhookEvent[] {
    if (!payload || typeof payload !== 'object') return [];

    const p = payload as Record<string, unknown>;
    const event = String(p.event ?? '').toLowerCase();

    switch (event) {
      case 'messages.upsert':
      case 'messages_upsert':
        return this.#normalizeMessagesUpsert(p);
      case 'messages.update':
      case 'messages_update':
        return this.#normalizeMessagesUpdate(p);
      case 'qrcode.updated':
      case 'qrcode_updated':
        return this.#normalizeQrCode(p);
      case 'connection.update':
      case 'connection_update':
        return this.#normalizeConnectionUpdate(p);
      default:
        return [];
    }
  }

  // ============================================================
  // Private helpers
  // ============================================================

  #requireConfig(config: WhatsAppConfig): {
    baseUrl: string;
    apiKey: string;
    instanceName: string;
  } {
    const raw = config as unknown as Record<string, unknown>;

    const baseUrlRaw = raw.evolution_base_url;
    const apiKeyCipher = raw.evolution_api_key;
    const instanceNameRaw = raw.evolution_instance_name;

    if (!baseUrlRaw || typeof baseUrlRaw !== 'string') {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution base URL is missing',
        { provider: 'evolution' }
      );
    }

    const baseUrl = baseUrlRaw.replace(/\/+$/, '');

    try {
      new URL(baseUrl);
    } catch {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution base URL is not a valid URL',
        { provider: 'evolution' }
      );
    }

    if (!/^https?:\/\/.+/i.test(baseUrl)) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution base URL must use http or https',
        { provider: 'evolution' }
      );
    }

    if (!apiKeyCipher || typeof apiKeyCipher !== 'string') {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution API key is missing',
        { provider: 'evolution' }
      );
    }

    let apiKey: string;
    try {
      apiKey = decrypt(apiKeyCipher);
    } catch {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution API key is not encrypted or is corrupted',
        { provider: 'evolution' }
      );
    }

    if (!apiKey) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution API key is empty after decryption',
        { provider: 'evolution' }
      );
    }

    if (!instanceNameRaw || typeof instanceNameRaw !== 'string') {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution instance name is missing',
        { provider: 'evolution' }
      );
    }

    const instanceName = instanceNameRaw.trim();
    if (!instanceName) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution instance name is empty',
        { provider: 'evolution' }
      );
    }

    if (/[\/\\]/.test(instanceName)) {
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Evolution instance name cannot contain path separators',
        { provider: 'evolution' }
      );
    }

    return { baseUrl, apiKey, instanceName };
  }

  #getInstanceId(config: WhatsAppConfig): string | undefined {
    const raw = config as unknown as Record<string, unknown>;
    return typeof raw.evolution_instance_id === 'string'
      ? raw.evolution_instance_id
      : undefined;
  }

  #connectionStateValue(payload: Record<string, unknown>): string {
    const instance = payload.instance;
    if (instance && typeof instance === 'object') {
      const nested = instance as Record<string, unknown>;
      return String(nested.state ?? nested.status ?? 'unknown').toLowerCase();
    }
    return String(payload.state ?? payload.status ?? 'unknown').toLowerCase();
  }

  async #fetchConnectionState(
    baseUrl: string,
    apiKey: string,
    instanceName: string
  ): Promise<Record<string, unknown>> {
    return (await this.#request(
      `${baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      apiKey,
      { method: 'GET' },
      { allowRetry: true }
    )) as Record<string, unknown>;
  }

  /**
   * Returns true when the instance is already registered on the Evolution
   * server. connectionState returns 200 for missing instances but with an
   * undefined state, so we key off the presence of a string state value.
   */
  async #instanceExists(
    baseUrl: string,
    apiKey: string,
    instanceName: string
  ): Promise<boolean> {
    try {
      const state = await this.#fetchConnectionState(
        baseUrl,
        apiKey,
        instanceName
      );
      const instance = state.instance;
      return (
        !!instance &&
        typeof instance === 'object' &&
        typeof (instance as Record<string, unknown>).state === 'string'
      );
    } catch {
      return false;
    }
  }

  async #request(
    url: string,
    apiKey: string,
    init: RequestInit,
    options: { allowRetry?: boolean } = {}
  ): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    // Evolution v2.3.7 only reads the `apikey` header. Do not send
    // Authorization: Bearer — it is ignored and leaks the key to any
    // proxy that logs Authorization.
    headers['apikey'] = apiKey;

    const execute = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await fetch(url, {
          ...init,
          headers: { ...headers, ...(init.headers ?? {}) },
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    const maxAttempts = options.allowRetry ? GET_MAX_ATTEMPTS : 1;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await execute();

        if (!response.ok) {
          if (
            options.allowRetry &&
            attempt < maxAttempts - 1 &&
            response.status >= 500
          ) {
            await new Promise((resolve) =>
              setTimeout(resolve, GET_RETRY_DELAY_MS)
            );
            continue;
          }
          throw await this.#apiError(response);
        }

        try {
          return await response.json();
        } catch {
          return {};
        }
      } catch (err) {
        lastError = err;
        if (options.allowRetry && attempt < maxAttempts - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, GET_RETRY_DELAY_MS)
          );
          continue;
        }
        if (err instanceof ProviderError) throw err;
        throw this.#networkError(err);
      }
    }

    if (lastError instanceof ProviderError) throw lastError;
    throw this.#networkError(lastError);
  }

  async #apiError(response: Response): Promise<ProviderError> {
    let detail: string | null = null;
    try {
      const body = (await response.json()) as {
        error?: boolean | string;
        message?: string;
        response?: { message?: string } | string;
        status?: number;
      };

      if (body.error === true && typeof body.message === 'string') {
        detail = body.message;
      } else if (typeof body.error === 'string') {
        detail = body.error;
      } else if (typeof body.message === 'string') {
        detail = body.message;
      } else if (
        body.response &&
        typeof body.response === 'object' &&
        body.response.message
      ) {
        detail = body.response.message;
      } else if (typeof body.response === 'string') {
        detail = body.response;
      }
    } catch {
      // ignore non-JSON error body
    }

    const message = detail
      ? `Evolution API error: ${response.status} ${response.statusText} — ${detail}`
      : `Evolution API error: ${response.status} ${response.statusText}`;

    return new ProviderError('PROVIDER_API_ERROR', message, {
      provider: 'evolution',
      status: response.status,
    });
  }

  #networkError(err: unknown): ProviderError {
    const message = err instanceof Error ? err.message : String(err);
    return new ProviderError(
      'PROVIDER_API_ERROR',
      `Evolution API unreachable: ${message}`,
      { provider: 'evolution', cause: err }
    );
  }

  #isErrorResponse(
    data: unknown
  ): data is { error: true; message?: string; status?: number } {
    return (
      !!data &&
      typeof data === 'object' &&
      (data as Record<string, unknown>).error === true
    );
  }

  #providerErrorFromResponse(
    data: Record<string, unknown>,
    fallbackStatus: number
  ): ProviderError {
    const message =
      typeof data.message === 'string'
        ? data.message
        : 'Evolution API returned an error';
    const status =
      typeof data.status === 'number' ? data.status : fallbackStatus;
    return new ProviderError('PROVIDER_API_ERROR', message, {
      provider: 'evolution',
      status,
    });
  }

  #extractQrCode(data: unknown): QrCode | null {
    if (!data || typeof data !== 'object') return null;

    // Evolution v2.3.7 returns the QR in several shapes depending on the
    // endpoint and instance state, e.g.:
    //   { base64: "..." }
    //   { qrcode: { base64: "...", code: "..." } }
    //   { code: "...", base64: "..." }
    // Search recursively so the pairing QR is found wherever it is nested.
    const seen = new Set<unknown>();

    const walk = (node: unknown, depth = 0): string | null => {
      if (!node || typeof node !== 'object' || depth > 6 || seen.has(node))
        return null;
      seen.add(node);

      if (Array.isArray(node)) {
        for (const item of node) {
          const found = walk(item, depth + 1);
          if (found) return found;
        }
        return null;
      }

      const d = node as Record<string, unknown>;

      // Prefer the rendered image, then the raw pairing code.
      for (const key of ['base64', 'qrcodeBase64', 'code', 'qrcode', 'qr']) {
        const value = d[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }

      for (const key of [
        'qrcode',
        'qr',
        'data',
        'instance',
        'response',
        'result',
      ]) {
        const value = d[key];
        if (value && typeof value === 'object') {
          const found = walk(value, depth + 1);
          if (found) return found;
        }
      }

      return null;
    };

    const code = walk(data);
    if (!code) return null;

    // Ignore very short strings such as pairing codes if they somehow end
    // up under a searched key.
    if (code.length < 12) return null;

    const base64 = code.startsWith('data:')
      ? code
      : `data:image/png;base64,${code}`;
    return { base64, raw: code };
  }

  #normalizeStatus(status: unknown): 'sending' | 'sent' | 'failed' {
    const s = String(status ?? 'sent').toLowerCase();
    if (s === 'pending' || s === 'sending') return 'sending';
    if (s === 'failed' || s === 'error') return 'failed';
    return 'sent';
  }

  #providerInstanceId(payload: Record<string, unknown>): string {
    const fromInstance = payload.instance;
    if (typeof fromInstance === 'string' && fromInstance) {
      return fromInstance;
    }

    const data = payload.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (typeof d.instanceId === 'string' && d.instanceId) {
        return d.instanceId;
      }
    }

    const fromId = payload.instanceId;
    if (typeof fromId === 'string' && fromId) {
      return fromId;
    }

    return 'unknown';
  }

  #sanitizeRawPayload(
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const clone = { ...payload };
    delete clone.apikey;
    delete clone.server_url;
    return clone;
  }

  #normalizeMessagesUpsert(
    payload: Record<string, unknown>
  ): NormalizedWebhookEvent[] {
    const data = payload.data;
    if (!data || typeof data !== 'object') return [];

    const d = data as Record<string, unknown>;
    const messages = Array.isArray(d.messages) ? d.messages : [d];
    const providerInstanceId = this.#providerInstanceId(payload);

    const events: NormalizedWebhookEvent[] = [];
    for (const msg of messages) {
      const event = this.normalizeHistoricalMessage(msg, providerInstanceId);
      if (event) events.push(event);
    }
    return events;
  }

  #normalizeMessagesUpdate(
    payload: Record<string, unknown>
  ): NormalizedWebhookEvent[] {
    const data = payload.data;
    if (!data || typeof data !== 'object') return [];

    const updates = Array.isArray(data) ? data : [data];
    const providerInstanceId = this.#providerInstanceId(payload);
    const events: NormalizedWebhookEvent[] = [];

    for (const u of updates) {
      if (!u || typeof u !== 'object') continue;
      const update = u as Record<string, unknown>;

      const key = (update.key ?? {}) as Record<string, unknown>;
      const keyId = String(update.keyId ?? key.id ?? '');
      const remoteJid = String(update.remoteJid ?? key.remoteJid ?? '');
      const nestedUpdate =
        update.update && typeof update.update === 'object'
          ? (update.update as Record<string, unknown>)
          : null;
      const rawStatus = update.status ?? nestedUpdate?.status;

      if (!keyId) continue;

      const status = this.#mapInboundStatus(rawStatus);
      if (!status) continue;

      events.push({
        provider: 'evolution',
        providerInstanceId,
        providerMessageId: keyId,
        recipientPhone: normalizeInboundPhone(remoteJid),
        status,
        timestamp: normalizeTimestamp(
          update.messageTimestamp as string | number | undefined
        ),
        errorMessage: typeof update.error === 'string' ? update.error : null,
      } as NormalizedStatusEvent);
    }

    return events;
  }

  #normalizeQrCode(payload: Record<string, unknown>): NormalizedWebhookEvent[] {
    const data = payload.data;
    const qr =
      data && typeof data === 'object' ? this.#extractQrCode(data) : null;

    return [
      {
        provider: 'evolution',
        providerInstanceId: this.#providerInstanceId(payload),
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
        rawPayload: this.#sanitizeRawPayload(payload),
      },
    ];
  }

  #normalizeConnectionUpdate(
    payload: Record<string, unknown>
  ): NormalizedWebhookEvent[] {
    const data = payload.data;
    const state =
      data && typeof data === 'object'
        ? String((data as Record<string, unknown>).state ?? '')
        : '';

    return [
      {
        provider: 'evolution',
        providerInstanceId: this.#providerInstanceId(payload),
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
        rawPayload: this.#sanitizeRawPayload(payload),
      },
    ];
  }

  #mapInboundStatus(
    status: unknown
  ): 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | null {
    if (typeof status === 'number') {
      switch (status) {
        case 0:
          return 'failed';
        case 1:
          return 'sending';
        case 2:
          return 'sent';
        case 3:
          return 'delivered';
        case 4:
        case 5:
          return 'read';
        default:
          return null;
      }
    }

    if (typeof status !== 'string') return null;

    switch (status.toLowerCase()) {
      case 'pending':
      case 'sending':
        return 'sending';
      case 'sent':
      case 'server_ack':
        return 'sent';
      case 'delivered':
      case 'delivery_ack':
        return 'delivered';
      case 'read':
      case 'read_ack':
      case 'played':
        return 'read';
      case 'failed':
      case 'error':
        return 'failed';
      default:
        return null;
    }
  }

  #safeErrorDetail(err: unknown): string {
    if (err instanceof ProviderError) return err.message;
    if (err instanceof Error) return err.message;
    return 'unknown';
  }
}
