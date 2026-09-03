// ============================================================
// Evolution inbound media resolver.
//
// Evolution webhook events carry only media *metadata* (a message key);
// the bytes live behind the instance and must be fetched through
// `/chat/getBase64FromMediaMessage/{instance}` (Evolution v2.3.7). The
// Meta webhook does the equivalent via getMediaUrl + mirrorInboundMedia;
// this module gives Evolution the same durable-storage outcome so images
// sent to a linked WhatsApp number actually render in the inbox.
//
// Everything here is BEST EFFORT and returns null rather than throwing:
// a webhook that starts failing is far worse than an attachment that
// expires (Meta retries the delivery, re-running every downstream side
// effect). On any failure we fall back to a null media_url and the
// pipeline keeps the text/caption row.
// ============================================================

import { decrypt } from '@/lib/whatsapp/encryption';
import { mirrorInboundMedia, type MirrorStorage } from '../mirror-inbound-media';
import type { WhatsAppConfig } from '@/types';

const REQUEST_TIMEOUT_MS = 10_000;

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Pull MIME / caption / filename out of a Baileys message object. */
function extractEvolutionMediaMeta(message: Record<string, unknown> | undefined): {
  mime: string | null;
  caption: string | null;
  fileName: string | null;
} {
  if (!message) return { mime: null, caption: null, fileName: null };

  const image = message.imageMessage as Record<string, unknown> | undefined;
  const video = message.videoMessage as Record<string, unknown> | undefined;
  const audio = message.audioMessage as Record<string, unknown> | undefined;
  const doc = message.documentMessage as Record<string, unknown> | undefined;
  const sticker = message.stickerMessage as Record<string, unknown> | undefined;

  if (image) {
    return { mime: str(image.mimetype), caption: str(image.caption), fileName: null };
  }
  if (video) {
    return { mime: str(video.mimetype), caption: str(video.caption), fileName: null };
  }
  if (audio) {
    return { mime: str(audio.mimetype), caption: null, fileName: null };
  }
  if (doc) {
    return {
      mime: str(doc.mimetype),
      caption: str(doc.caption),
      fileName: str(doc.fileName),
    };
  }
  if (sticker) {
    return { mime: str(sticker.mimetype), caption: null, fileName: null };
  }
  return { mime: null, caption: null, fileName: null };
}

/**
 * Some Evolution instances are configured with `base64: true` on the
 * webhook, in which case the message object already carries the bytes
 * inline (under `imageMessage.url` / `videoMessage.url` / …). Skip the
 * extra round-trip when present.
 */
function extractInlineBase64(message: Record<string, unknown> | undefined): string | null {
  if (!message) return null;
  const candidates = [
    message.imageMessage,
    message.videoMessage,
    message.audioMessage,
    message.documentMessage,
    message.stickerMessage,
  ];
  for (const candidate of candidates) {
    const c = candidate as Record<string, unknown> | undefined;
    const url = str(c?.url);
    if (url && /^data:/.test(url)) return url;
  }
  return null;
}

export interface FetchEvolutionMediaArgs {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  messageKeyId: string;
  /** Injected in tests. */
  request?: FetchImpl;
}

/** Call Evolution's getBase64FromMediaMessage endpoint. Returns null on any failure. */
export async function fetchEvolutionMediaBase64(
  args: FetchEvolutionMediaArgs,
): Promise<{
  base64: string;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
} | null> {
  const { baseUrl, apiKey, instanceName, messageKeyId } = args;
  const request = args.request ?? ((u: string, i: RequestInit) => fetch(u, i));
  const url = `${baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({
        message: { key: { id: messageKeyId } },
        convertToMp4: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(
        `[evolution-media] getBase64FromMediaMessage failed: ${res.status}`
      );
      return null;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const base64 =
      typeof data.base64 === 'string'
        ? data.base64
        : typeof data.buffer === 'string'
          ? data.buffer
          : null;
    if (!base64) return null;

    const mimeType =
      typeof data.mimetype === 'string'
        ? data.mimetype
        : typeof data.mediaType === 'string'
          ? data.mediaType
          : null;
    const fileName = typeof data.fileName === 'string' ? data.fileName : null;

    let fileSize: number | null = null;
    const size = data.size as { fileLength?: string | number } | undefined;
    if (size && typeof size.fileLength !== 'undefined') {
      const n = Number(size.fileLength);
      if (Number.isFinite(n)) fileSize = n;
    }

    return { base64, mimeType, fileName, fileSize };
  } catch (err) {
    console.warn(
      '[evolution-media] getBase64FromMediaMessage error:',
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface ResolveEvolutionMediaArgs {
  config: WhatsAppConfig;
  /** The raw webhook message object (event.rawPayload). */
  rawPayload: Record<string, unknown>;
  accountId: string;
  /** Service-role Storage surface (narrow so tests can fake it). */
  storage: MirrorStorage;
  /** Injected in tests. */
  fetchImpl?: FetchImpl;
}

/**
 * Resolve a durable media URL for an inbound Evolution message.
 *
 * Returns `{ mediaUrl, mediaType }`. `mediaUrl` is null when the bytes
 * could not be fetched/mirrored — callers MUST still persist the text
 * row in that case. Never throws.
 */
export async function resolveEvolutionMessageMedia(
  args: ResolveEvolutionMediaArgs
): Promise<{ mediaUrl: string | null; mediaType: string | null }> {
  const { config, rawPayload, accountId, storage } = args;

  const key = (rawPayload?.key ?? {}) as Record<string, unknown>;
  const messageKeyId = typeof key.id === 'string' ? key.id : '';
  if (!messageKeyId) return { mediaUrl: null, mediaType: null };

  const message = (rawPayload?.message ?? {}) as Record<string, unknown>;
  const meta = extractEvolutionMediaMeta(message);

  // Fast path: bytes were inlined in the webhook payload.
  const inlineBase64 = extractInlineBase64(message);

  let base64 = inlineBase64;
  let mimeType = meta.mime;
  let fileName = meta.fileName;
  let fileSize: number | null = null;

  if (!base64) {
    let apiKey: string;
    try {
      apiKey = decrypt(config.evolution_api_key as string);
    } catch {
      return { mediaUrl: null, mediaType: meta.mime };
    }
    const baseUrlRaw = config.evolution_base_url as string | undefined;
    const instanceName = config.evolution_instance_name as string | undefined;
    if (!baseUrlRaw || !instanceName) {
      return { mediaUrl: null, mediaType: meta.mime };
    }
    const fetched = await fetchEvolutionMediaBase64({
      baseUrl: baseUrlRaw.replace(/\/+$/, ''),
      apiKey,
      instanceName,
      messageKeyId,
      request: args.fetchImpl,
    });
    if (!fetched) return { mediaUrl: null, mediaType: meta.mime };
    base64 = fetched.base64;
    mimeType = fetched.mimeType ?? meta.mime;
    fileName = fetched.fileName ?? meta.fileName;
    fileSize = fetched.fileSize;
  }

  const dataUriMatch = /^data:([^;]+);base64,([\s\S]*)$/.exec(base64);
  const base64Body = dataUriMatch ? dataUriMatch[2] : base64;
  const finalMime = mimeType ?? (dataUriMatch ? dataUriMatch[1] : null);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Body, 'base64');
  } catch {
    return { mediaUrl: null, mediaType: finalMime };
  }
  if (buffer.byteLength === 0) return { mediaUrl: null, mediaType: finalMime };

  const timestamp = (rawPayload?.messageTimestamp ?? null) as
    | string
    | number
    | null;

  const mirrored = await mirrorInboundMedia({
    storage,
    accountId,
    mediaId: messageKeyId,
    downloadUrl: '',
    accessToken: '',
    mimeType: finalMime,
    fileSize,
    fileName,
    messageTimestamp: timestamp,
    download: async () => ({
      buffer,
      contentType: finalMime ?? 'application/octet-stream',
    }),
  });

  return { mediaUrl: mirrored, mediaType: finalMime };
}
