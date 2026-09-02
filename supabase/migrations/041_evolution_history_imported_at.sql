-- ============================================================
-- 041_evolution_history_imported_at.sql
--
-- Añade marca de tiempo para saber si una cuenta Evolution ya
-- importó su historial de contactos/mensajes. Se usa para:
--   * Evitar re-importar automáticamente en cada guardado.
--   * Permitir re-importar manualmente cuando el usuario lo pida.
--
-- Idempotente.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_history_imported_at TIMESTAMPTZ NULL;
