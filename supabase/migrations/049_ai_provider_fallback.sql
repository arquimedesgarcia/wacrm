-- ============================================================
-- 049_ai_provider_fallback.sql
--
-- Adds per-account AI model fallback controls and a configurable
-- discovery endpoint. The runtime wrapper in
-- src/lib/ai/providers/openai.ts uses these to retry a failing
-- model against the same provider, then jump to a configured
-- whitelist, and finally (when the whitelist is empty) discover
-- free models dynamically from the provider's catalog.
--
-- All columns are additive and default-safe: existing rows get
-- `fallback_models = '{}'`, `auto_refresh_models = true`,
-- `max_retries = 3`, `models_url = NULL` (which means "derive
-- `${base_url}/models`"). No data migration is required.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS fallback_models text[] NOT NULL DEFAULT '{}';

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS auto_refresh_models boolean NOT NULL DEFAULT true;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3
    CHECK (max_retries BETWEEN 0 AND 10);

-- Optional override for the models-catalog endpoint. NULL = derive
-- `${base_url}/models` (the OpenAI-compatible convention). Set this
-- when the provider exposes the catalog at a different path.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS models_url text;