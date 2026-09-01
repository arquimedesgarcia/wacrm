// ============================================================
// Pure helpers for the Evolution webhook receiver.
//
// Kept separate from the route so they can be unit-tested without
// standing up a Supabase client.
// ============================================================

/**
 * Extract the instance name from an Evolution webhook payload.
 *
 * Evolution v2.3.7 sends the instance name as a top-level string:
 *   { event: "...", instance: "waCRM", data: { ... } }
 *
 * We also accept a few legacy/nested shapes for backward compatibility
 * with payloads that may come from older versions or custom headers.
 */
export function extractInstanceName(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>

  // Official v2.3.7 shape.
  if (typeof p.instance === 'string' && p.instance) {
    return p.instance
  }

  const fromData =
    p.instanceName ??
    (p.data && typeof p.data === 'object'
      ? (p.data as Record<string, unknown>).instanceName
      : undefined)
  if (typeof fromData === 'string' && fromData) return fromData

  // Fallback: some Evolution payloads carry the instance name under
  // `instance.instanceName`.
  const instance = p.instance
  if (instance && typeof instance === 'object') {
    const name = (instance as Record<string, unknown>).instanceName
    if (typeof name === 'string' && name) return name
  }

  return null
}

/**
 * Return a shallow copy of the payload with secrets removed.
 *
 * Evolution includes the instance token in the body under `apikey` and
 * exposes the server URL under `server_url`. We strip both before
 * logging, normalizing or persisting the payload.
 */
export function sanitizeWebhookPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload

  const clone = { ...(payload as Record<string, unknown>) }
  delete clone.apikey
  delete clone.server_url
  return clone
}
