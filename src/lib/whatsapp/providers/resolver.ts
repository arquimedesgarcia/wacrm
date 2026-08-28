import type { SupabaseClient } from '@supabase/supabase-js'
import type { WhatsAppConfig } from '@/types'
import type {
  WhatsAppProvider,
  WhatsAppProviderKind,
} from './types'
import { ProviderError } from './errors'
import { MetaAdapter } from './meta-adapter'
import { EvolutionAdapter } from './evolution-adapter'

/**
 * Resolve the active WhatsApp provider for a config row.
 *
 * Defaults to `meta` when the `provider` column is missing or
 * unrecognized, preserving backward compatibility with existing rows.
 */
export function getProviderForConfig(
  config: WhatsAppConfig | null | undefined,
): WhatsAppProvider {
  if (!config) {
    throw new ProviderError(
      'CONFIGURATION_MISSING',
      'WhatsApp configuration not found for this account.',
      { provider: 'meta' },
    )
  }

  const kind = resolveProviderKind(config)

  switch (kind) {
    case 'meta':
      return new MetaAdapter()
    case 'evolution':
      return new EvolutionAdapter()
    default:
      throw new ProviderError(
        'PROVIDER_NOT_SUPPORTED',
        `WhatsApp provider "${String(kind)}" is not supported.`,
        { provider: kind as WhatsAppProviderKind },
      )
  }
}

/**
 * Load the account's WhatsApp config and return its active provider.
 *
 * The config is loaded with `single()` — duplicate rows are a data
 * integrity issue handled by the caller (log + fail).
 */
export async function resolveProviderForAccount(
  db: SupabaseClient,
  accountId: string,
): Promise<{ provider: WhatsAppProvider; config: WhatsAppConfig }> {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()

  if (error || !config) {
    throw new ProviderError(
      'CONFIGURATION_MISSING',
      'WhatsApp configuration not found for this account.',
      { provider: 'meta' },
    )
  }

  return { provider: getProviderForConfig(config), config }
}

/**
 * Return the provider kind for a config row, defaulting to `meta`.
 *
 * The `provider` column was added in migration 040. Rows created
 * before it default to `meta`.
 */
export function resolveProviderKind(
  config: WhatsAppConfig,
): WhatsAppProviderKind {
  const raw = (config as unknown as Record<string, unknown>).provider
  if (raw === 'evolution') return 'evolution'
  return 'meta'
}
