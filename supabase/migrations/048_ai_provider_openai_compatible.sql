-- ============================================================
-- 048_ai_provider_openai_compatible.sql
--
-- Adds support for OpenAI-compatible providers (OpenRouter, Ollama
-- local, etc.) to the ai_configs table. Extends the provider enum
-- and adds an optional base_url column.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Widen the provider CHECK constraint.
ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openai_compatible'));

-- Optional base URL for OpenAI-compatible providers. NULL for
-- native openai / anthropic (they always use their own endpoints).
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS base_url text;

-- Ensure base_url is only set for the openai_compatible provider.
-- (No CHECK constraint on the column itself — RLS + app-level
--  validation enforce this; a CHECK would make future provider
--  enum additions harder to migrate.)
