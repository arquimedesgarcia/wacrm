import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  base_url: null,
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}
const ROW_COMPATIBLE = {
  ...ROW,
  provider: 'openai_compatible' as const,
  base_url: 'https://openrouter.ai/api/v1',
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })

  it('maps base_url from the DB row to baseUrl', async () => {
    const config = await loadAiConfig(dbReturning(ROW_COMPATIBLE), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai_compatible')
    expect(config!.baseUrl).toBe('https://openrouter.ai/api/v1')
  })

  it('returns null for baseUrl on native openai', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.baseUrl).toBeNull()
  })

  it('defaults modelsUrl, fallbackModels, autoRefreshModels and maxRetries when DB columns are null', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config!.modelsUrl).toBeNull()
    expect(config!.fallbackModels).toEqual([])
    expect(config!.autoRefreshModels).toBe(true)
    expect(config!.maxRetries).toBe(3)
  })

  it('maps the new columns from the DB row', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW_COMPATIBLE,
        models_url: 'https://example.com/catalog',
        fallback_models: ['m-a', 'm-b'],
        auto_refresh_models: false,
        max_retries: 5,
      }),
      'acct',
      { requireActive: false },
    )
    expect(config!.modelsUrl).toBe('https://example.com/catalog')
    expect(config!.fallbackModels).toEqual(['m-a', 'm-b'])
    expect(config!.autoRefreshModels).toBe(false)
    expect(config!.maxRetries).toBe(5)
  })
})
