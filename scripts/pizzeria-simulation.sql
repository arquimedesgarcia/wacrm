-- ============================================================================
-- Pizzería La Vecchia — Script completo de simulación para Supabase SQL Editor
-- ============================================================================
--
-- TODO el script es UN ÚNICO bloque PL/pgSQL: no usa variables de sesión
-- (set_config/current_config), por lo que es inmune al error
-- "unrecognized configuration parameter" y a ejecuciones por partes.
--
-- QUÉ HACE
--   1. Borra TODO lo existente de la simulación (tablas pizzeria_*, flujo,
--      documentos de KB, contactos de simulación) y recomienza de cero.
--   2. Crea el esquema independiente pizzeria_* (portable a otro motor).
--   3. Carga menú, tamaños, clientes, meseros, pedidos, conversaciones.
--   4. Alimenta la base de conocimiento de IA (3 documentos + chunks).
--   5. Crea el flujo "Pizzería La Vecchia — Pedidos" (17 nodos, válido
--      según las reglas del engine de waCRM).
--
-- USO
--   * Si tu base tiene UNA sola cuenta: no edites nada, ejecuta todo.
--   * Si tienes varias cuentas: pega tu account_id en v_acct abajo
--     (obténlo con:  SELECT id, name FROM accounts;  )
-- ============================================================================

DO $pizzeria$
DECLARE
  -- ========================================================================
  -- 1) PEGA AQUÍ TU ACCOUNT_ID entre comillas simples.
  --    Deja NULL para usar tu primera cuenta.
  -- ========================================================================
  v_acct UUID := NULL;  -- ej: '550e8400-e29b-41d4-a716-446655440000'

  v_user        UUID;
  v_first       TEXT;
  v_count       INT;
  v_contact_id  UUID;
  v_conv_id     UUID;
  v_doc_menu    UUID;
  v_doc_sizes   UUID;
  v_doc_poli    UUID;
  v_flow_id     UUID;
  v_now         TIMESTAMPTZ := NOW();
BEGIN
  -- ==========================================================================
  -- 2) Resolución y validación de la cuenta
  -- ==========================================================================
  IF v_acct IS NULL THEN
    SELECT id::text INTO v_first FROM accounts ORDER BY created_at LIMIT 1;
    IF v_first IS NULL THEN
      RAISE EXCEPTION 'No hay cuentas en la base. Regístrate primero en la app y vuelve a ejecutar el script.';
    END IF;
    v_acct := v_first::UUID;
    RAISE NOTICE 'No se indicó account_id: usando la primera cuenta %', v_first;
  END IF;

  SELECT count(*) INTO v_count FROM accounts WHERE id = v_acct;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'La cuenta % no existe. Ejecuta SELECT id, name FROM accounts; y pega el UUID en v_acct al inicio del script.', v_acct;
  END IF;

  -- Usuario dueño (contacts.user_id / flows.user_id son NOT NULL)
  SELECT owner_user_id INTO v_user FROM accounts WHERE id = v_acct;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'La cuenta % no tiene un owner_user_id válido en auth.users.', v_acct;
  END IF;

  RAISE NOTICE 'Pizzería: trabajando sobre account_id %', v_acct;

  -- ==========================================================================
  -- 3) BORRADO COMPLETO de lo existente (recomenzar de cero)
  -- ==========================================================================
  -- Flujo (nombre actual y legacy de la migración 054 original)
  DELETE FROM flows
  WHERE account_id = v_acct
    AND name IN ('Pizzería La Vecchia — Pedidos', 'pizzeria_orders_flow');

  -- ai_configs con el placeholder en texto plano (rompía decrypt() y toda
  -- la IA de la cuenta). Una clave REAL configurada desde la app no coincide.
  DELETE FROM ai_configs
  WHERE account_id = v_acct
    AND api_key = 'PLEASE_CONFIGURE_YOUR_OPENAI_API_KEY';

  -- Documentos de KB de la pizzería (cascada: borra sus chunks)
  DELETE FROM ai_knowledge_documents
  WHERE account_id = v_acct
    AND title IN (
      'Menú de Pizzería La Vecchia - Pizzas',
      'Tamaños y Precios - Pizzería La Vecchia',
      'Políticas de Pizzería La Vecchia');

  -- Pedidos, clientes y meseros de simulación
  DELETE FROM pizzeria_orders  WHERE account_id = v_acct;
  DELETE FROM pizzeria_waiters WHERE account_id = v_acct;
  DELETE FROM pizzeria_clients WHERE account_id = v_acct;
  DELETE FROM pizzeria_sizes   WHERE account_id = v_acct;
  DELETE FROM pizzeria_pizzas  WHERE account_id = v_acct;

  -- Contactos de simulación (teléfonos enmascarados +581****xxxx o el rango
  -- +58116701-05 de los specs viejos). CASCADE borra sus conversations/messages.
  DELETE FROM contacts
  WHERE account_id = v_acct
    AND (phone LIKE '%*%' OR phone IN (
      '+58116701', '+58116702', '+58116703', '+58116704', '+58116705'));

  RAISE NOTICE 'Pizzería: datos anteriores eliminados';

  -- ==========================================================================
  -- 4) Esquema independiente (idempotente: CREATE IF NOT EXISTS)
  -- ==========================================================================
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pizzeria_order_status') THEN
    CREATE TYPE pizzeria_order_status AS ENUM (
      'new', 'confirmed', 'payment_received', 'preparing',
      'ready', 'delivering', 'delivered', 'cancelled'
    );
  END IF;

  CREATE TABLE IF NOT EXISTS pizzeria_pizzas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price_small NUMERIC(8,2),
    price_medium NUMERIC(8,2),
    price_large NUMERIC(8,2),
    ingredients TEXT[],
    is_vegetarian BOOLEAN NOT NULL DEFAULT FALSE,
    is_gluten_free BOOLEAN NOT NULL DEFAULT FALSE,
    image_url TEXT,
    preparation_minutes INTEGER DEFAULT 12,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, sku)
  );
  CREATE INDEX IF NOT EXISTS idx_pizzeria_pizzas_account ON pizzeria_pizzas(account_id);

  ALTER TABLE pizzeria_pizzas ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "pizzeria_pizzas_select" ON pizzeria_pizzas;
  DROP POLICY IF EXISTS "pizzeria_pizzas_modify" ON pizzeria_pizzas;
  CREATE POLICY "pizzeria_pizzas_select"
    ON pizzeria_pizzas FOR SELECT USING (is_account_member(account_id));
  CREATE POLICY "pizzeria_pizzas_modify"
    ON pizzeria_pizzas FOR ALL
    USING (is_account_member(account_id, 'admin'))
    WITH CHECK (is_account_member(account_id, 'admin'));

  CREATE TABLE IF NOT EXISTS pizzeria_sizes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    size_key TEXT NOT NULL,
    label TEXT NOT NULL,
    price_modifier NUMERIC(8,2) NOT NULL DEFAULT 0,
    diameter_cm INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, size_key)
  );
  CREATE INDEX IF NOT EXISTS idx_pizzeria_sizes_account ON pizzeria_sizes(account_id);

  ALTER TABLE pizzeria_sizes ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "pizzeria_sizes_select" ON pizzeria_sizes;
  DROP POLICY IF EXISTS "pizzeria_sizes_modify" ON pizzeria_sizes;
  CREATE POLICY "pizzeria_sizes_select"
    ON pizzeria_sizes FOR SELECT USING (is_account_member(account_id));
  CREATE POLICY "pizzeria_sizes_modify"
    ON pizzeria_sizes FOR ALL
    USING (is_account_member(account_id, 'admin'))
    WITH CHECK (is_account_member(account_id, 'admin'));

  CREATE TABLE IF NOT EXISTS pizzeria_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    name TEXT,
    preference TEXT,
    orders_total INTEGER NOT NULL DEFAULT 0,
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, phone)
  );
  CREATE INDEX IF NOT EXISTS idx_pizzeria_clients_phone ON pizzeria_clients(account_id, phone);

  ALTER TABLE pizzeria_clients ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "pizzeria_clients_select" ON pizzeria_clients;
  DROP POLICY IF EXISTS "pizzeria_clients_modify" ON pizzeria_clients;
  CREATE POLICY "pizzeria_clients_select"
    ON pizzeria_clients FOR SELECT USING (is_account_member(account_id));
  CREATE POLICY "pizzeria_clients_modify"
    ON pizzeria_clients FOR ALL
    USING (is_account_member(account_id, 'agent'))
    WITH CHECK (is_account_member(account_id, 'agent'));

  CREATE TABLE IF NOT EXISTS pizzeria_waiters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    waiter_key TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS pizzeria_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    client_id UUID REFERENCES pizzeria_clients(id) ON DELETE SET NULL,
    pizza_sku TEXT NOT NULL,
    size_key TEXT NOT NULL,
    size_label TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(8,2) NOT NULL,
    delivery_fee NUMERIC(8,2) DEFAULT 0,
    total_price NUMERIC(8,2) NOT NULL,
    service_type TEXT NOT NULL,
    address TEXT,
    client_phone TEXT,
    client_name TEXT,
    special_instructions TEXT,
    status pizzeria_order_status NOT NULL DEFAULT 'new',
    assigned_waiter_id UUID REFERENCES pizzeria_waiters(id) ON DELETE SET NULL,
    whatsapp_contact_phone TEXT,
    whatsapp_conversation_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_pizzeria_orders_status ON pizzeria_orders(account_id, status);
  CREATE INDEX IF NOT EXISTS idx_pizzeria_orders_created ON pizzeria_orders(account_id, created_at DESC);

  ALTER TABLE pizzeria_orders ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "pizzeria_orders_select" ON pizzeria_orders;
  DROP POLICY IF EXISTS "pizzeria_orders_modify" ON pizzeria_orders;
  CREATE POLICY "pizzeria_orders_select"
    ON pizzeria_orders FOR SELECT USING (is_account_member(account_id));
  CREATE POLICY "pizzeria_orders_modify"
    ON pizzeria_orders FOR ALL
    USING (is_account_member(account_id, 'agent'))
    WITH CHECK (is_account_member(account_id, 'agent'));

  -- Columnas extra para la KB (equivalente a migración 052)
  ALTER TABLE pizzeria_pizzas
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS tags TEXT[],
    ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS is_spicy BOOLEAN NOT NULL DEFAULT FALSE;

  -- Triggers updated_at
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

  -- Bucket de imágenes (las fotos viven en /public/pizzeria y se sirven por
  -- /api/pizzeria/media/<archivo>; el bucket es opcional para CDN)
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('pizzeria-media', 'pizzeria-media', TRUE, 5242880,
          ARRAY['image/png', 'image/jpeg', 'image/webp'])
  ON CONFLICT (id) DO NOTHING;

  DROP POLICY IF EXISTS "Pizzeria media is publicly readable" ON storage.objects;
  CREATE POLICY "Pizzeria media is publicly readable"
    ON storage.objects FOR SELECT USING (bucket_id = 'pizzeria-media');

  -- Vistas de texto para la KB. security_invoker = true: respetan RLS.
  DROP VIEW IF EXISTS pizzeria_kb_feed;
  CREATE VIEW pizzeria_kb_feed
  WITH (security_invoker = true) AS
    SELECT
      id, sku, name, description, ingredients,
      price_small, price_medium, price_large,
      preparation_minutes, category, tags, is_popular, notes,
      is_vegetarian, is_gluten_free, is_spicy,
      CONCAT(
        'PIZZA: ', name, E'\n',
        'SKU: ', sku, E'\n',
        'DESCRIPCIÓN: ', COALESCE(description, ''), E'\n',
        'INGREDIENTES: ', COALESCE(array_to_string(ingredients, ', '), ''), E'\n',
        'PRECIOS: Pequeña $', COALESCE(price_small::text, 'N/A'),
                  ' | Mediana $', COALESCE(price_medium::text, 'N/A'),
                  ' | Grande $', COALESCE(price_large::text, 'N/A'), E'\n',
        'TIEMPO PREPARACIÓN: ', COALESCE(preparation_minutes::text, ''), ' min', E'\n',
        'CATEGORÍA: ', COALESCE(category, ''), E'\n',
        'TAGS: ', COALESCE(array_to_string(tags, ', '), 'sin tags'), E'\n',
        'POPULAR: ', CASE WHEN is_popular THEN 'Sí' ELSE 'No' END, E'\n',
        'VEGETARIANA: ', CASE WHEN is_vegetarian THEN 'Sí' ELSE 'No' END, E'\n',
        'SIN GLUTEN: ', CASE WHEN is_gluten_free THEN 'Sí' ELSE 'No' END, E'\n',
        'NOTAS: ', COALESCE(notes, '')
      ) AS kb_text
    FROM pizzeria_pizzas
    WHERE account_id IS NOT NULL;

  DROP VIEW IF EXISTS pizzeria_sizes_kb_feed;
  CREATE VIEW pizzeria_sizes_kb_feed
  WITH (security_invoker = true) AS
    SELECT
      id, size_key, label, price_modifier, diameter_cm,
      CONCAT(
        'TAMAÑO: ', label, E'\n',
        'CLAVE: ', size_key, E'\n',
        'RECARGO DE PRECIO: +$', COALESCE(price_modifier::text, '0'), E'\n',
        'DIÁMETRO: ', COALESCE(diameter_cm::text, ''), ' cm'
      ) AS kb_text
    FROM pizzeria_sizes
    WHERE account_id IS NOT NULL;

  DROP VIEW IF EXISTS pizzeria_clients_kb_feed;
  CREATE VIEW pizzeria_clients_kb_feed
  WITH (security_invoker = true) AS
    SELECT
      id, phone, name, preference, orders_total, is_premium,
      CONCAT(
        'CLIENTE: ', COALESCE(name, 'Sin nombre'), E'\n',
        'TELÉFONO: ', phone, E'\n',
        'PREFERENCIA: ', COALESCE(preference, 'Sin preferencia registrada'), E'\n',
        'PEDIDOS TOTALES: ', orders_total, E'\n',
        'PREMIUM: ', CASE WHEN is_premium THEN 'Sí' ELSE 'No' END
      ) AS kb_text
    FROM pizzeria_clients
    WHERE account_id IS NOT NULL;

  DROP VIEW IF EXISTS pizzeria_waiters_kb_feed;
  CREATE VIEW pizzeria_waiters_kb_feed
  WITH (security_invoker = true) AS
    SELECT
      id, waiter_key, name, phone, is_active,
      CONCAT(
        'MESERO: ', name, E'\n',
        'CLAVE: ', waiter_key, E'\n',
        'TELÉFONO: ', COALESCE(phone, 'No registrado'), E'\n',
        'ACTIVO: ', CASE WHEN is_active THEN 'Sí' ELSE 'No' END
      ) AS kb_text
    FROM pizzeria_waiters
    WHERE account_id IS NOT NULL AND is_active = TRUE;

  -- ==========================================================================
  -- 5) Datos de simulación
  -- ==========================================================================
  -- Menú. image_url es ruta RELATIVA servida por la app
  -- (/api/pizzeria/media/<archivo>): sobrevive re-deploys y cambios de motor.
  INSERT INTO pizzeria_pizzas (account_id, sku, name, description, price_small, price_medium, price_large, ingredients, is_vegetarian, is_gluten_free, image_url, preparation_minutes, category, tags, is_popular)
  VALUES
    (v_acct, 'marg', 'Margarita',
     'Mozzarella, tomate y albahaca fresca. Clásica y equilibrada.',
     12.00, 15.00, 18.00,
     ARRAY['mozzarella', 'tomate', 'albahaca'], TRUE, FALSE,
     '/api/pizzeria/media/margarita.jpg', 12, 'Clásicas', ARRAY['clásica', 'favorita'], TRUE),
    (v_acct, 'napo', 'Napolitana',
     'Tomate, mozzarella, jamón, rúcula fresca y aceitunas negras.',
     15.00, 18.00, 21.00,
     ARRAY['mozzarella', 'tomate', 'jamón', 'rúcula', 'aceitunas'], FALSE, FALSE,
     '/api/pizzeria/media/napolitana.jpg', 14, 'Clásicas con carne', ARRAY['jamón', 'popular'], TRUE),
    (v_acct, 'pesc', 'Pescadora',
     'Salsa de ajo, queso, atún, aceitunas y pimientos rojos.',
     18.00, 21.00, 24.00,
     ARRAY['salsa de ajo', 'queso', 'atún', 'aceitunas', 'pimientos'], FALSE, FALSE,
     '/api/pizzeria/media/pescadora.jpg', 15, 'Especiales - mar', ARRAY['atún', 'mar'], FALSE),
    (v_acct, 'espec', 'La Vecchia Especial',
     'La estrella de la casa: chorizo, pimiento, cebolla caramelizada y orégano.',
     20.00, 23.00, 26.00,
     ARRAY['mozzarella', 'tomate', 'chorizo', 'pimiento rojo', 'cebolla caramelizada', 'orégano'], FALSE, FALSE,
     '/api/pizzeria/media/la_vecchia.jpg', 16, 'Especiales', ARRAY['estrella de la casa', 'chorizo'], TRUE),
    (v_acct, 'vege', 'Vegetariana',
     'Mozzarella, verduras frescas y aceitunas negras.',
     14.00, 17.00, 20.00,
     ARRAY['mozzarella', 'tomate', 'pimiento verde', 'pimiento rojo', 'cebolla', 'champiñones', 'aceitunas'], TRUE, FALSE,
     '/api/pizzeria/media/vegetariana.jpg', 13, 'Vegetarianas', ARRAY['verduras', 'vegetariana'], FALSE);

  INSERT INTO pizzeria_sizes (account_id, size_key, label, price_modifier, diameter_cm)
  VALUES
    (v_acct, 'pequena', 'Pequeña', 0.00, 25),
    (v_acct, 'mediana', 'Mediana', 3.00, 30),
    (v_acct, 'grande', 'Grande', 5.00, 35);

  INSERT INTO pizzeria_clients (account_id, phone, name, preference, orders_total, is_premium)
  VALUES
    (v_acct, '+58105550101', 'María González', 'sin gluten ocasional', 7, TRUE),
    (v_acct, '+58105550102', 'Carlos Pérez', 'extra orégano', 3, FALSE),
    (v_acct, '+58105550103', 'Ana Ríos', 'sin queso', 1, FALSE),
    (v_acct, '+58105550104', 'Luis Fernández', '', 5, FALSE),
    (v_acct, '+58105550105', 'Patricia Díaz', 'borde extra crujiente', 2, FALSE);

  INSERT INTO pizzeria_waiters (account_id, waiter_key, name, phone, is_active)
  VALUES
    (v_acct, 'mesero_1', 'Juan', '+58105550901', TRUE),
    (v_acct, 'mesero_2', 'María', '+58105550902', TRUE),
    (v_acct, 'mesero_3', 'Carlos', '+58105550903', TRUE);

  -- Contactos de simulación en waCRM
  INSERT INTO contacts (user_id, account_id, phone, name, email, company, created_at, updated_at)
  VALUES
    (v_user, v_acct, '+58105550101', 'María González', 'maria.gonzalez@email.com', 'Autónoma', v_now, v_now),
    (v_user, v_acct, '+58105550102', 'Carlos Pérez', 'carlos.perez@email.com', 'Freelance', v_now, v_now),
    (v_user, v_acct, '+58105550103', 'Ana Ríos', 'ana.rios@email.com', 'Estudiante', v_now, v_now),
    (v_user, v_acct, '+58105550104', 'Luis Fernández', 'luis.fernandez@email.com', 'Empresarial', v_now, v_now),
    (v_user, v_acct, '+58105550105', 'Patricia Díaz', 'patricia.diaz@email.com', 'Autónoma', v_now, v_now)
  ON CONFLICT (account_id, phone_normalized) WHERE phone_normalized <> '' DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    company = EXCLUDED.company;

  -- Conversaciones + mensajes (solo si no existen para ese contacto)
  SELECT id INTO v_contact_id FROM contacts WHERE account_id = v_acct AND phone = '+58105550101';
  SELECT id INTO v_conv_id FROM conversations WHERE account_id = v_acct AND contact_id = v_contact_id;
  IF v_conv_id IS NULL AND v_contact_id IS NOT NULL THEN
    INSERT INTO conversations (user_id, account_id, contact_id, status, last_message_text, last_message_at, unread_count, created_at, updated_at)
    VALUES (v_user, v_acct, v_contact_id, 'open', 'Sí, confirmo', v_now - INTERVAL '5 min', 0, v_now - INTERVAL '10 min', v_now - INTERVAL '5 min')
      RETURNING id INTO v_conv_id;
    INSERT INTO messages (conversation_id, sender_type, sender_id, content_type, content_text, message_id, status, created_at) VALUES
      (v_conv_id, 'bot', NULL, 'text', '¡Hola! Bienvenida a Pizzería La Vecchia. ¿Qué te gustaría pedir hoy?', NULL, 'read', v_now - INTERVAL '10 min'),
      (v_conv_id, 'customer', NULL, 'text', '¿Me puedes hacer una pizza Margarita mediana?', NULL, 'read', v_now - INTERVAL '9 min'),
      (v_conv_id, 'agent', NULL, 'text', '¡Claro! Una Margarita mediana es $15.00. ¿Para recoger o delivery? (el delivery tiene $2 de cargo)', NULL, 'read', v_now - INTERVAL '8 min'),
      (v_conv_id, 'customer', NULL, 'text', 'Delivery por favor, soy María. Vivo en Av. 10, Casa 123', NULL, 'read', v_now - INTERVAL '7 min'),
      (v_conv_id, 'agent', NULL, 'text', 'Perfecto. Tu pedido: Margarita mediana $15.00 + $2.00 delivery = $17.00 total. ¿Confirmamos?', NULL, 'read', v_now - INTERVAL '6 min'),
      (v_conv_id, 'customer', NULL, 'text', 'Sí, confirmo', NULL, 'read', v_now - INTERVAL '5 min');
  END IF;

  v_conv_id := NULL;
  SELECT id INTO v_contact_id FROM contacts WHERE account_id = v_acct AND phone = '+58105550103';
  SELECT id INTO v_conv_id FROM conversations WHERE account_id = v_acct AND contact_id = v_contact_id;
  IF v_conv_id IS NULL AND v_contact_id IS NOT NULL THEN
    INSERT INTO conversations (user_id, account_id, contact_id, status, last_message_text, last_message_at, unread_count, created_at, updated_at)
    VALUES (v_user, v_acct, v_contact_id, 'open', 'Recogida, por favor. ¿En cuánto tiempo está lista?', v_now - INTERVAL '3 min', 0, v_now - INTERVAL '8 min', v_now - INTERVAL '3 min')
      RETURNING id INTO v_conv_id;
    INSERT INTO messages (conversation_id, sender_type, sender_id, content_type, content_text, message_id, status, created_at) VALUES
      (v_conv_id, 'bot', NULL, 'text', '¡Hola Ana! ¿Qué pizza quieres hoy?', NULL, 'read', v_now - INTERVAL '8 min'),
      (v_conv_id, 'customer', NULL, 'text', 'Quiero pedir la Napolitana grande', NULL, 'read', v_now - INTERVAL '7 min'),
      (v_conv_id, 'agent', NULL, 'text', 'La Napolitana grande es $21.00. ¿Delivery o recogida?', NULL, 'read', v_now - INTERVAL '6 min'),
      (v_conv_id, 'customer', NULL, 'text', 'Recogida, por favor. ¿En cuánto tiempo está lista?', NULL, 'read', v_now - INTERVAL '3 min');
  END IF;

  v_conv_id := NULL;
  SELECT id INTO v_contact_id FROM contacts WHERE account_id = v_acct AND phone = '+58105550105';
  SELECT id INTO v_conv_id FROM conversations WHERE account_id = v_acct AND contact_id = v_contact_id;
  IF v_conv_id IS NULL AND v_contact_id IS NOT NULL THEN
    INSERT INTO conversations (user_id, account_id, contact_id, status, last_message_text, last_message_at, unread_count, created_at, updated_at)
    VALUES (v_user, v_acct, v_contact_id, 'open', 'Sí, me animo. ¿La pequeña?', v_now - INTERVAL '2 min', 0, v_now - INTERVAL '5 min', v_now - INTERVAL '2 min')
      RETURNING id INTO v_conv_id;
    INSERT INTO messages (conversation_id, sender_type, sender_id, content_type, content_text, message_id, status, created_at) VALUES
      (v_conv_id, 'bot', NULL, 'text', '¡Hola Patricia! ¿En qué puedo ayudarte?', NULL, 'read', v_now - INTERVAL '5 min'),
      (v_conv_id, 'customer', NULL, 'text', '¿Tienen algo vegetariano?', NULL, 'read', v_now - INTERVAL '4 min'),
      (v_conv_id, 'agent', NULL, 'text', '¡Claro! Tenemos la Vegetariana con pimiento, champiñones, cebolla y aceitunas ($14-20 según tamaño). ¿Te gustaría probarla?', NULL, 'read', v_now - INTERVAL '3 min'),
      (v_conv_id, 'customer', NULL, 'text', 'Sí, me animo. ¿La pequeña?', NULL, 'read', v_now - INTERVAL '2 min');
  END IF;

  -- Pedidos de simulación
  INSERT INTO pizzeria_orders (
    account_id, client_id, pizza_sku, size_key, size_label, quantity,
    unit_price, delivery_fee, total_price, service_type, address,
    client_phone, client_name, special_instructions, status,
    assigned_waiter_id, whatsapp_contact_phone, whatsapp_conversation_id,
    created_at, updated_at
  )
  SELECT
    v_acct,
    (SELECT id FROM pizzeria_clients WHERE account_id = v_acct AND phone = '+58105550101' LIMIT 1),
    'marg', 'mediana', 'Mediana', 1,
    15.00, 2.00, 17.00, 'delivery', 'Av. 10, Casa 123',
    '+58105550101', 'María González', '', 'preparing',
    (SELECT id FROM pizzeria_waiters WHERE account_id = v_acct AND waiter_key = 'mesero_1' LIMIT 1),
    '+58105550101',
    (SELECT id FROM conversations WHERE account_id = v_acct AND contact_id IN (SELECT id FROM contacts WHERE account_id = v_acct AND phone = '+58105550101') LIMIT 1),
    v_now - INTERVAL '6 minutes', v_now;

  INSERT INTO pizzeria_orders (
    account_id, client_id, pizza_sku, size_key, size_label, quantity,
    unit_price, delivery_fee, total_price, service_type, address,
    client_phone, client_name, special_instructions, status,
    assigned_waiter_id, whatsapp_contact_phone, whatsapp_conversation_id,
    created_at, updated_at
  )
  SELECT
    v_acct,
    (SELECT id FROM pizzeria_clients WHERE account_id = v_acct AND phone = '+58105550105' LIMIT 1),
    'vege', 'pequena', 'Pequeña', 1,
    14.00, 0.00, 14.00, 'recogida', NULL,
    '+58105550105', 'Patricia Díaz', 'borde extra crujiente', 'confirmed',
    (SELECT id FROM pizzeria_waiters WHERE account_id = v_acct AND waiter_key = 'mesero_2' LIMIT 1),
    '+58105550105',
    (SELECT id FROM conversations WHERE account_id = v_acct AND contact_id IN (SELECT id FROM contacts WHERE account_id = v_acct AND phone = '+58105550105') LIMIT 1),
    v_now - INTERVAL '2 minutes', v_now;

  -- ==========================================================================
  -- 6) Base de conocimiento de IA (3 documentos + chunks)
  -- ==========================================================================
  -- NOTA: la CLAVE de la API de IA NO se guarda aquí — configúrala desde la
  -- app (Ajustes → IA) para que quede cifrada correctamente.
  INSERT INTO ai_knowledge_documents (account_id, created_by, title, content)
  VALUES (v_acct, NULL, 'Menú de Pizzería La Vecchia - Pizzas',
    E'PIZZAS DISPONIBLES EN PIZZERÍA LA VECCHIA\n\n'
    '=== Margarita ($12 pequeña / $15 mediana / $18 grande) ===\n'
    'Mozzarella, tomate y albahaca fresca. Clásica y equilibrada.\n'
    'Vegetariana: Sí | Sin gluten: No | Preparación: 12 min\n\n'
    '=== Napolitana ($15 pequeña / $18 mediana / $21 grande) ===\n'
    'Tomate, mozzarella, jamón, rúcula fresca y aceitunas negras.\n'
    'Vegetariana: No (jamón) | Sin gluten: No | Preparación: 14 min | Popular: Sí\n\n'
    '=== Pescadora ($18 pequeña / $21 mediana / $24 grande) ===\n'
    'Salsa de ajo, queso, atún, aceitunas y pimientos rojos.\n'
    'Vegetariana: No (atún) | Sin gluten: No | Preparación: 15 min\n\n'
    '=== La Vecchia Especial ($20 pequeña / $23 mediana / $26 grande) ===\n'
    'Pizza estrella: chorizo, pimiento, cebolla caramelizada y orégano.\n'
    'Vegetariana: No (chorizo) | Sin gluten: No | Preparación: 16 min\n\n'
    '=== Vegetariana ($14 pequeña / $17 mediana / $20 grande) ===\n'
    'Mozzarella, verduras frescas y aceitunas negras.\n'
    'Vegetariana: Sí | Sin gluten: No | Preparación: 13 min\n\n'
    'NOTA: La Margarita y la Vegetariana son las únicas vegetarianas del menú.')
  RETURNING id INTO v_doc_menu;

  INSERT INTO ai_knowledge_documents (account_id, created_by, title, content)
  VALUES (v_acct, NULL, 'Tamaños y Precios - Pizzería La Vecchia',
    E'TAMAÑOS DE PIZZA\n\n'
    'Pequeña (25 cm): Precio base. Sin recargo.\n'
    'Mediana (30 cm): +$3 sobre el precio base.\n'
    'Grande (35 cm): +$5 sobre el precio base.\n\n'
    'PRECIOS: Margarita $12/$15/$18, Napolitana $15/$18/$21, Pescadora $18/$21/$24, '
    'La Vecchia Especial $20/$23/$26, Vegetariana $14/$17/$20 (peq/med/gran).\n\n'
    'CARGOS DE ENTREGA: Delivery pequeña/mediana $2, grande $3. Recogida $0.\n'
    'NOTA: los precios por tamaño son finales (el recargo ya está incluido).')
  RETURNING id INTO v_doc_sizes;

  INSERT INTO ai_knowledge_documents (account_id, created_by, title, content)
  VALUES (v_acct, NULL, 'Políticas de Pizzería La Vecchia',
    E'POLÍTICAS DE PIZZERÍA LA VECCHIA\n\n'
    'HORARIO: Lunes a Domingos 11:00 AM - 11:00 PM. Cierres: 25 dic, 1 ene, Semana Santa.\n'
    'Último pedido delivery 10:00 PM, recogida 10:30 PM.\n\n'
    'CONTACTO: Teléfono/WhatsApp +58116789. Dirección: Av. 10, Casa 123, Caracas.\n\n'
    'PEDIDOS: Mínimo 1, máximo 10 pizzas (más: llamar al +58116789). Más de 4: confirmar por teléfono.\n'
    'Preparación: 12-16 min por pizza.\n\n'
    'ENTREGA: Zonas El Paraíso, Chacao, Altamira y alrededores. Fuera de zona: consultar.\n'
    'Tiempo estimado 20-40 min desde confirmación.\n\n'
    'RESERVAS: Mínimo 4, máximo 20 personas. Confirmar nombre, cantidad, hora y teléfono.\n\n'
    'CANCELACIÓN: Se puede cancelar antes de iniciar la preparación; después NO.\n'
    'Pedido incorrecto: se reemplaza o devuelve.\n\n'
    'PAGOS: Efectivo al recoger. Transferencia: comprobante por WhatsApp.\n'
    'Zelle / Pago móvil: consultar. No aceptamos tarjetas.\n\n'
    'ALÉRGENOS: Lácteos en todos los quesos. Gluten en la base (salvo opción sin gluten).\n'
    'Sin queso disponible (remover queso). Extra orégano $1. Borde extra crujiente bajo pedido.')
  RETURNING id INTO v_doc_poli;

  INSERT INTO ai_knowledge_chunks (document_id, account_id, chunk_index, content)
  VALUES
    (v_doc_menu, v_acct, 0,
     E'PIZZA: Margarita | SKU: marg | $12/$15/$18 (peq/med/gran)\nMozzarella, tomate y albahaca. Vegetariana: Sí. Preparación: 12 min.\n---\n'),
    (v_doc_menu, v_acct, 1,
     E'PIZZA: Napolitana | SKU: napo | $15/$18/$21\nJamón, rúcula, aceitunas. Vegetariana: No. Preparación: 14 min. Popular: Sí.\n---\n'),
    (v_doc_menu, v_acct, 2,
     E'PIZZA: Pescadora | SKU: pesc | $18/$21/$24\nAtún, salsa de ajo, pimientos. Vegetariana: No. Preparación: 15 min.\n---\n'),
    (v_doc_menu, v_acct, 3,
     E'PIZZA: La Vecchia Especial | SKU: espec | $20/$23/$26\nChorizo, pimiento, cebolla caramelizada. Pizza estrella. Preparación: 16 min.\n---\n'),
    (v_doc_menu, v_acct, 4,
     E'PIZZA: Vegetariana | SKU: vege | $14/$17/$20\nVerduras frescas, champiñones, aceitunas. Vegetariana: Sí. Preparación: 13 min.\n---\n'),
    (v_doc_sizes, v_acct, 0,
     E'TAMAÑOS: Pequeña 25cm = precio base | Mediana 30cm = +$3 | Grande 35cm = +$5.\nCargos: delivery $2 (peq/med), $3 (gran), recogida $0.\n---\n'),
    (v_doc_poli, v_acct, 0,
     E'HORARIO: 11:00-23:00 todos los días. Último pedido delivery 22:00, recogida 22:30.\nContacto: +58116789, Av. 10 Casa 123 Caracas.\n---\n'),
    (v_doc_poli, v_acct, 1,
     E'PEDIDOS: 1-10 pizzas (más: llamar). Cancelación solo antes de iniciar preparación.\nPagos: efectivo o transferencia con comprobante. No tarjetas.\n---\n');

  -- ==========================================================================
  -- 7) Flujo "Pizzería La Vecchia — Pedidos" (grafo válido según el engine)
  -- ==========================================================================
  ALTER TABLE flow_nodes ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

  INSERT INTO flows (user_id, account_id, name, description, status, entry_node_id, trigger_type, trigger_config)
  VALUES (
    v_user, v_acct,
    'Pizzería La Vecchia — Pedidos',
    'Simulación: toma de pedidos por WhatsApp (menú, tamaño, confirmación, pago y entrega).',
    'active',
    'start_welcome',
    'keyword',
    '{"keywords": ["hola", "buenas", "pedido", "orden", "pizza", "menú", "menu"], "match_type": "contains"}'::JSONB
  )
  RETURNING id INTO v_flow_id;

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'start_welcome', 'start', '{"next_node_key": "greet"}'::JSONB, 0, 0, 0);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'greet', 'send_message',
    '{"text": "¡Hola! Bienvenido a Pizzería La Vecchia. ¿Qué te gustaría hacer hoy?", "next_node_key": "main_menu"}'::JSONB,
    0, 120, 1);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'main_menu', 'send_buttons',
    '{"text": "Elige una opción para continuar:", "buttons": [{"reply_id": "btn_menu", "title": "Ver menú", "next_node_key": "show_menu"}, {"reply_id": "btn_order", "title": "Hacer pedido", "next_node_key": "ask_pizza"}, {"reply_id": "btn_agent", "title": "Hablar con agente", "next_node_key": "handoff_agent"}]}'::JSONB,
    0, 240, 2);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'show_menu', 'send_message',
    '{"text": "Nuestro menú:\n\n• Margarita — $12 / $15 / $18 (peq/med/gran)\n• Napolitana — $15 / $18 / $21\n• Pescadora — $18 / $21 / $24\n• La Vecchia Especial — $20 / $23 / $26\n• Vegetariana — $14 / $17 / $20\n\nTamaños: Pequeña 25cm, Mediana 30cm (+$3), Grande 35cm (+$5).\nDelivery: +$2 (peq/med), +$3 (gran).\n\nPara pedir, escribe *pedido*.", "next_node_key": "end_flow"}'::JSONB,
    0, 360, 3);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'ask_pizza', 'collect_input',
    '{"prompt_text": "¿Qué pizza quieres? Escríbe el nombre (ej: margarita, napolitana, pescadora, la vecchia especial, vegetariana).", "var_key": "pizza", "next_node_key": "ask_size"}'::JSONB,
    280, 120, 4);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'ask_size', 'collect_input',
    '{"prompt_text": "¿Qué tamaño prefieres?\n• Pequeña (25cm) — precio base\n• Mediana (30cm) — +$3\n• Grande (35cm) — +$5", "var_key": "tamano", "next_node_key": "confirm_order"}'::JSONB,
    280, 240, 5);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'confirm_order', 'send_message',
    '{"text": "Resumen de tu pedido:\n\n• Pizza: {{vars.pizza}}\n• Tamaño: {{vars.tamano}}\n\n¿Confirmas? Responde *sí* o *no*.", "next_node_key": "ask_confirmation"}'::JSONB,
    280, 360, 6);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'ask_confirmation', 'collect_input',
    '{"prompt_text": "¿Confirmas el pedido? Responde sí o no.", "var_key": "confirmacion", "next_node_key": "check_negative"}'::JSONB,
    280, 480, 7);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'check_negative', 'condition',
    '{"subject": "var", "subject_key": "confirmacion", "operator": "contains", "value": "no", "true_next": "order_cancelled", "false_next": "check_positive"}'::JSONB,
    280, 600, 8);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'check_positive', 'condition',
    '{"subject": "var", "subject_key": "confirmacion", "operator": "contains", "value": "sí", "true_next": "payment_info", "false_next": "reconfirm"}'::JSONB,
    280, 720, 9);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'reconfirm', 'send_message',
    '{"text": "No entendí tu respuesta. ¿Confirmas el pedido? Responde *sí* o *no*.", "next_node_key": "ask_confirmation"}'::JSONB,
    560, 720, 10);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'order_cancelled', 'send_message',
    '{"text": "Sin problema, pedido cancelado. Si quieres algo más, escríbenos *hola* y empezamos de nuevo.", "next_node_key": "end_flow"}'::JSONB,
    560, 600, 11);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'payment_info', 'send_message',
    '{"text": "¡Genial, pedido confirmado!\n\nOpciones de pago:\n• Efectivo: al recoger\n• Transferencia: envía el comprobante por WhatsApp\n\nTiempo estimado: 20-40 min.", "next_node_key": "ask_delivery"}'::JSONB,
    560, 480, 12);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'ask_delivery', 'collect_input',
    '{"prompt_text": "¿Prefieres *delivery* o *recogida* en la pizzería? (dirección: Av. 10, Casa 123)", "var_key": "entrega", "next_node_key": "order_placed"}'::JSONB,
    560, 360, 13);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'order_placed', 'send_message',
    '{"text": "¡Gracias por tu pedido! Te avisaremos por WhatsApp cuando esté listo.", "next_node_key": "end_flow"}'::JSONB,
    560, 240, 14);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'handoff_agent', 'handoff',
    '{"note": "Pizzería: el cliente pidió hablar con un agente."}'::JSONB,
    -280, 240, 15);

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'end_flow', 'end', '{}'::JSONB, 0, 840, 16);

  RAISE NOTICE 'Pizzería: simulación completa — 5 pizzas, 5 clientes, 3 conversaciones, 2 pedidos, 3 documentos KB, flujo de 17 nodos.';
END $pizzeria$;

-- ============================================================================
-- VERIFICACIÓN RÁPIDA (opcional — reemplaza <TU_ACCOUNT_ID> y descomenta)
-- ============================================================================
-- SELECT sku, name, price_small, price_medium, price_large FROM pizzeria_pizzas
--   WHERE account_id = '<TU_ACCOUNT_ID>'::UUID;
-- SELECT id, status, last_message_text FROM conversations
--   WHERE account_id = '<TU_ACCOUNT_ID>'::UUID;
-- SELECT title FROM ai_knowledge_documents WHERE account_id = '<TU_ACCOUNT_ID>'::UUID;
-- SELECT name, entry_node_id, status FROM flows WHERE account_id = '<TU_ACCOUNT_ID>'::UUID;
