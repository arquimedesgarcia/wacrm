-- ============================================================
-- Pizzería La Vecchia — catálogo de productos + datos de simulación
--
-- Diseñado para ser INDEPENDIENTE del motor de comunicaciones:
--   * No depende de contactos / conversations / messages de waCRM.
--   * Cada tabla tiene su propia PK y una columna `account_id` que
--     enlaza a la cuenta de waCRM SOLO para la simulación.
--   * La imagen URL es un campo genérico (`image_url`) que puede
--     apuntar a Supabase Storage, Railway o cualquier CDN.
--   * Si mañana migramos a otro motor, basta migrar estas tablas
--     (son auto-contenidas) y re-mapear `account_id` → `tenant_id`.
--
-- Tablas:
--   1. pizzeria_pizzas      — menú de pizzas
--   2. pizzeria_sizes       — tamaños con recargo
--   3. pizzeria_clients      — clientes de muestra
--   4. pizzeria_waiters      — meseros (round-robin)
--   5. pizzeria_orders       — pedidos de simulación
-- ============================================================

-- ============================================================
-- 1. Pizza menu items
-- ============================================================
CREATE TABLE IF NOT EXISTS pizzeria_pizzas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,          -- "marg", "napo", etc.
  name TEXT NOT NULL,         -- "Margarita"
  description TEXT,
  price_small NUMERIC(8,2),
  price_medium NUMERIC(8,2),
  price_large NUMERIC(8,2),
  ingredients TEXT[],         -- ingredient list
  is_vegetarian BOOLEAN NOT NULL DEFAULT FALSE,
  is_gluten_free BOOLEAN NOT NULL DEFAULT FALSE,
  image_url TEXT,             -- public URL to pizza photo
  preparation_minutes INTEGER DEFAULT 12,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_pizzeria_pizzas_account
  ON pizzeria_pizzas(account_id);

ALTER TABLE pizzeria_pizzas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pizzeria_pizzas_select" ON pizzeria_pizzas;
DROP POLICY IF EXISTS "pizzeria_pizzas_modify" ON pizzeria_pizzas;
CREATE POLICY "pizzeria_pizzas_select"
  ON pizzeria_pizzas FOR SELECT USING (is_account_member(account_id));
CREATE POLICY "pizzeria_pizzas_modify"
  ON pizzeria_pizzas FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- 2. Pizza sizes with price modifiers
-- ============================================================
CREATE TABLE IF NOT EXISTS pizzeria_sizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  size_key TEXT NOT NULL,       -- "pequena", "mediana", "grande"
  label TEXT NOT NULL,          -- "Pequeña", "Mediana", "Grande"
  price_modifier NUMERIC(8,2) NOT NULL DEFAULT 0,
  diameter_cm INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, size_key)
);

CREATE INDEX IF NOT EXISTS idx_pizzeria_sizes_account
  ON pizzeria_sizes(account_id);

ALTER TABLE pizzeria_sizes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pizzeria_sizes_select" ON pizzeria_sizes;
DROP POLICY IF EXISTS "pizzeria_sizes_modify" ON pizzeria_sizes;
CREATE POLICY "pizzeria_sizes_select"
  ON pizzeria_sizes FOR SELECT USING (is_account_member(account_id));
CREATE POLICY "pizzeria_sizes_modify"
  ON pizzeria_sizes FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- 3. Sample clients (for simulation)
-- ============================================================
CREATE TABLE IF NOT EXISTS pizzeria_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  preference TEXT,            -- "sin gluten", "extra orégano", etc.
  orders_total INTEGER NOT NULL DEFAULT 0,
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_pizzeria_clients_account
  ON pizzeria_clients(account_id);
CREATE INDEX IF NOT EXISTS idx_pizzeria_clients_phone
  ON pizzeria_clients(account_id, phone);

ALTER TABLE pizzeria_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pizzeria_clients_select" ON pizzeria_clients;
DROP POLICY IF EXISTS "pizzeria_clients_modify" ON pizzeria_clients;
CREATE POLICY "pizzeria_clients_select"
  ON pizzeria_clients FOR SELECT USING (is_account_member(account_id));
CREATE POLICY "pizzeria_clients_modify"
  ON pizzeria_clients FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- 4. Waiters / meseros (for round-robin assignment simulation)
-- ============================================================
CREATE TABLE IF NOT EXISTS pizzeria_waiters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  waiter_key TEXT NOT NULL,     -- "mesero_1", etc.
  name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, waiter_key)
);

CREATE INDEX IF NOT EXISTS idx_pizzeria_waiters_account
  ON pizzeria_waiters(account_id) WHERE is_active = TRUE;

ALTER TABLE pizzeria_waiters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pizzeria_waiters_select" ON pizzeria_waiters;
DROP POLICY IF EXISTS "pizzeria_waiters_modify" ON pizzeria_waiters;
CREATE POLICY "pizzeria_waiters_select"
  ON pizzeria_waiters FOR SELECT USING (is_account_member(account_id));
CREATE POLICY "pizzeria_waiters_modify"
  ON pizzeria_waiters FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- 5. Simulated orders (tracks conversation simulation state)
-- ============================================================
-- Idempotency: Postgres has no CREATE TYPE IF NOT EXISTS, so guard via
-- pg_type. Re-running this migration must not abort on an existing enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pizzeria_order_status') THEN
    CREATE TYPE pizzeria_order_status AS ENUM (
      'new',          -- just created, awaiting confirmation
      'confirmed',     -- client confirmed
      'payment_received', -- payment screenshot sent
      'preparing',
      'ready',
      'delivering',
      'delivered',
      'cancelled'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pizzeria_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id UUID REFERENCES pizzeria_clients(id) ON DELETE SET NULL,
  pizza_sku TEXT NOT NULL,           -- references pizzeria_pizzas.sku
  size_key TEXT NOT NULL,            -- references pizzeria_sizes.size_key
  size_label TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(8,2) NOT NULL,
  delivery_fee NUMERIC(8,2) DEFAULT 0,
  total_price NUMERIC(8,2) NOT NULL,
  service_type TEXT NOT NULL,         -- "delivery" or "recogida"
  address TEXT,
  client_phone TEXT,
  client_name TEXT,
  special_instructions TEXT,
  status pizzeria_order_status NOT NULL DEFAULT 'new',
  assigned_waiter_id UUID REFERENCES pizzeria_waiters(id) ON DELETE SET NULL,
  whatsapp_contact_phone TEXT,        -- link to waCRM contact phone
  whatsapp_conversation_id UUID,      -- link to waCRM conversation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pizzeria_orders_account
  ON pizzeria_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_pizzeria_orders_status
  ON pizzeria_orders(account_id, status);
CREATE INDEX IF NOT EXISTS idx_pizzeria_orders_client
  ON pizzeria_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_pizzeria_orders_waiter
  ON pizzeria_orders(assigned_waiter_id);
CREATE INDEX IF NOT EXISTS idx_pizzeria_orders_created
  ON pizzeria_orders(account_id, created_at DESC);

ALTER TABLE pizzeria_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pizzeria_orders_select" ON pizzeria_orders;
DROP POLICY IF EXISTS "pizzeria_orders_modify" ON pizzeria_orders;
CREATE POLICY "pizzeria_orders_select"
  ON pizzeria_orders FOR SELECT USING (is_account_member(account_id));
CREATE POLICY "pizzeria_orders_modify"
  ON pizzeria_orders FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- updated_at triggers
-- ============================================================
DROP TRIGGER IF EXISTS set_updated_at ON pizzeria_pizzas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pizzeria_pizzas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON pizzeria_clients;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pizzeria_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON pizzeria_waiters;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pizzeria_waiters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON pizzeria_orders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pizzeria_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Storage bucket for pizza images
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pizzeria-media',
  'pizzeria-media',
  TRUE,
  5242880,  -- 5 MB — pizza photos only, keep it tight
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS: account-scoped writes, public reads
DROP POLICY IF EXISTS "Pizzeria media is publicly readable" ON storage.objects;
CREATE POLICY "Pizzeria media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'pizzeria-media');

DROP POLICY IF EXISTS "Members can upload pizzeria media" ON storage.objects;
CREATE POLICY "Members can upload pizzeria media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'pizzeria-media'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update pizzeria media" ON storage.objects;
CREATE POLICY "Members can update pizzeria media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'pizzeria-media'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete pizzeria media" ON storage.objects;
CREATE POLICY "Members can delete pizzeria media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'pizzeria-media'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
