-- ============================================================
-- 040_whatsapp_config_provider_evolution.sql
--
-- Extiende whatsapp_config para soportar Evolution API como
-- proveedor alternativo a Meta Cloud API.
--
-- Principios:
--   * Aditivo: no toca columnas Meta existentes.
--   * Una sola fila activa por account_id.
--   * Un solo proveedor activo por cuenta (CHECK).
--   * Secretos cifrados por la aplicación (evolution_api_key,
--     evolution_webhook_secret) usando encryption.ts.
--   * Campos Meta pasan a ser NULLables para poder tener una fila
--     válida exclusivamente de Evolution; el CHECK garantiza que
--     se rellenen los campos del proveedor elegido.
--
-- Idempotente — se puede re-ejecutar sin errores.
-- ============================================================

-- 1. Tipo enum para proveedores.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_provider') THEN
    CREATE TYPE whatsapp_provider AS ENUM ('meta', 'evolution');
  END IF;
END $$;

-- 2. Columnas de proveedor y configuración Evolution.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider whatsapp_provider NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS evolution_base_url TEXT,
  ADD COLUMN IF NOT EXISTS evolution_api_key TEXT,
  ADD COLUMN IF NOT EXISTS evolution_instance_name TEXT,
  ADD COLUMN IF NOT EXISTS evolution_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS evolution_webhook_secret TEXT;

-- 3. Los campos Meta ya son nullable o no? phone_number_id y access_token
--    fueron NOT NULL en 001. Debemos relajarlos para permitir una fila de
--    Evolution sin datos Meta. verify_token y waba_id ya eran nullable.
ALTER TABLE whatsapp_config
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;

-- 4. Índice único por cuenta: solo UNA fila de whatsapp_config por account.
--    Ya existe whatsapp_config_account_id_key desde 017, pero lo reforzamos
--    idempotentemente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_account_id_key'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_account_id_key UNIQUE (account_id);
  END IF;
END $$;

-- 5. CHECK para garantizar un único proveedor activo y datos completos.
--    Si provider = 'meta': se exige phone_number_id y access_token.
--    Si provider = 'evolution': se exige base_url, api_key e instance_name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_single_provider_check'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_single_provider_check
      CHECK (
        (
          provider = 'meta'
          AND phone_number_id IS NOT NULL
          AND phone_number_id <> ''
          AND access_token IS NOT NULL
          AND access_token <> ''
        )
        OR
        (
          provider = 'evolution'
          AND evolution_base_url IS NOT NULL
          AND evolution_base_url <> ''
          AND evolution_api_key IS NOT NULL
          AND evolution_api_key <> ''
          AND evolution_instance_name IS NOT NULL
          AND evolution_instance_name <> ''
        )
      );
  END IF;
END $$;

-- 6. Índices útiles.
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_provider
  ON whatsapp_config(provider);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_evolution_instance
  ON whatsapp_config(evolution_instance_id)
  WHERE evolution_instance_id IS NOT NULL;
