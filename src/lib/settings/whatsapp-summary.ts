// Derives the WhatsApp tile status shown on the settings overview.
//
// Why this lives in src/lib: the overview previously inlined
// `configured = !!row.phone_number_id`, which is only true for Meta
// rows — Evolution rows always store `phone_number_id = null` and keep
// their identity in `evolution_instance_name` / `evolution_base_url`.
// Extracting the rule keeps it testable and forces the provider split
// (Meta vs Evolution health endpoints) to be decided from the `provider`
// column, not from which credential fields happen to be populated.

export interface WhatsappSummaryRow {
  provider?: 'meta' | 'evolution' | null;
  phone_number_id?: string | null;
  evolution_instance_name?: string | null;
  evolution_base_url?: string | null;
}

export interface WhatsappSummary {
  configured: boolean;
  connected: boolean;
}

export function deriveWhatsappSummary(
  row: WhatsappSummaryRow | null,
  health: { connected?: boolean } | null
): WhatsappSummary {
  if (!row) return { configured: false, connected: false };

  // Rows written before migration 040 have provider = NULL; treat them
  // as Meta, matching every other read path in the codebase.
  const isEvolution = row.provider === 'evolution';
  const configured = isEvolution
    ? Boolean(row.evolution_instance_name || row.evolution_base_url)
    : Boolean(row.phone_number_id);

  return {
    configured,
    // "Connected" is only meaningful once a config exists; a truthy
    // health response on an unconfigured account must not happen, but
    // the guard keeps the invariant explicit.
    connected: configured && Boolean(health?.connected),
  };
}
