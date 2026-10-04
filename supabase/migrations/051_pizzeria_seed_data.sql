-- ============================================================
-- 051_pizzeria_seed_data.sql — Seed data for Pizzería La Vecchia simulation
--
-- Inserts sample data into BOTH:
--   A) The INDEPENDENT pizzeria schema (migration 050)
--   B) waCRM core tables (contacts, conversations, messages) for flow testing
--   C) pizzeria_orders, linked to the conversations created in B
--
-- Replay safety (CI runs `supabase db reset` on an EMPTY database):
--   * If `accounts` has no rows, NO data is inserted — the schema from
--     050 still applies and the seed simply skips with a NOTICE.
--   * If the account has no users in auth.users, only Part A is seeded.
--   * Everything is idempotent: upserts on natural keys, conversations
--     are only created when missing, and simulation orders are
--     delete-and-recreate so re-running never duplicates.
--
-- Account resolution: psql `-v acct_id=...` (or `SELECT set_config(
-- 'acct_id', '...', false)` in the SQL Editor) > first account.
-- ============================================================

DO $seed$
DECLARE
  v_acct UUID;
  v_user UUID;
  v_contact_id UUID;
  v_conv_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- ------------------------------------------------------------
  -- Resolve account (skip the whole seed when there is none)
  -- ------------------------------------------------------------
  IF NULLIF(current_setting('acct_id', true), '') IS NOT NULL THEN
    v_acct := current_setting('acct_id', true)::UUID;
  ELSE
    SELECT id INTO v_acct FROM accounts ORDER BY created_at LIMIT 1;
  END IF;

  IF v_acct IS NULL THEN
    RAISE NOTICE 'pizzeria seed: no account found — skipping data seed (schema only)';
    RETURN;
  END IF;
  RAISE NOTICE 'pizzeria seed: using account_id %', v_acct;

  -- ------------------------------------------------------------
  -- PART A: Pizzería data (independent schema — fully portable)
  -- ------------------------------------------------------------

  -- A1. Pizzas. image_url is a RELATIVE path served by the app's media
  --     proxy (/api/pizzeria/media/<file>), so rows survive re-deploys
  --     and engine swaps. After uploading to Supabase Storage you can
  --     switch the column to the bucket publicUrl (see upload endpoint).
  INSERT INTO pizzeria_pizzas (account_id, sku, name, description, price_small, price_medium, price_large, ingredients, is_vegetarian, is_gluten_free, image_url, preparation_minutes)
  VALUES
    (v_acct, 'marg', 'Margarita',
     'Mozzarella, tomate y albahaca fresca. Clásica y equilibrada.',
     12.00, 15.00, 18.00,
     ARRAY['mozzarella', 'tomate', 'albahaca'], TRUE, FALSE,
     '/api/pizzeria/media/margarita.jpg', 12),
    (v_acct, 'napo', 'Napolitana',
     'Tomate, mozzarella, jamón, rúcula fresca y aceitunas negras.',
     15.00, 18.00, 21.00,
     ARRAY['mozzarella', 'tomate', 'jamón', 'rúcula', 'aceitunas'], FALSE, FALSE,
     '/api/pizzeria/media/napolitana.jpg', 14),
    (v_acct, 'pesc', 'Pescadora',
     'Salsa de ajo, queso, atún, aceitunas y pimientos rojos.',
     18.00, 21.00, 24.00,
     ARRAY['salsa de ajo', 'queso', 'atún', 'aceitunas', 'pimientos'], FALSE, FALSE,
     '/api/pizzeria/media/pescadora.jpg', 15),
    (v_acct, 'espec', 'La Vecchia Especial',
     'La estrella de la casa: chorizo, pimiento, cebolla caramelizada y orégano.',
     20.00, 23.00, 26.00,
     ARRAY['mozzarella', 'tomate', 'chorizo', 'pimiento rojo', 'cebolla caramelizada', 'orégano'], FALSE, FALSE,
     '/api/pizzeria/media/la_vecchia.jpg', 16),
    (v_acct, 'vege', 'Vegetariana',
     'Mozzarella, verduras frescas y aceitunas negras.',
     14.00, 17.00, 20.00,
     ARRAY['mozzarella', 'tomate', 'pimiento verde', 'pimiento rojo', 'cebolla', 'champiñones', 'aceitunas'], TRUE, FALSE,
     '/api/pizzeria/media/vegetariana.jpg', 13)
  ON CONFLICT (account_id, sku) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_small = EXCLUDED.price_small,
    price_medium = EXCLUDED.price_medium,
    price_large = EXCLUDED.price_large,
    ingredients = EXCLUDED.ingredients,
    is_vegetarian = EXCLUDED.is_vegetarian,
    is_gluten_free = EXCLUDED.is_gluten_free,
    image_url = EXCLUDED.image_url,
    preparation_minutes = EXCLUDED.preparation_minutes;

  -- A2. Pizza sizes with price modifiers
  INSERT INTO pizzeria_sizes (account_id, size_key, label, price_modifier, diameter_cm)
  VALUES
    (v_acct, 'pequena', 'Pequeña', 0.00, 25),
    (v_acct, 'mediana', 'Mediana', 3.00, 30),
    (v_acct, 'grande', 'Grande', 5.00, 35)
  ON CONFLICT (account_id, size_key) DO UPDATE SET
    label = EXCLUDED.label,
    price_modifier = EXCLUDED.price_modifier,
    diameter_cm = EXCLUDED.diameter_cm;

  -- A3. Sample clients (matches specs/pizzeria_database.json)
  INSERT INTO pizzeria_clients (account_id, phone, name, preference, orders_total, is_premium)
  VALUES
    (v_acct, '+58105550101', 'María González', 'sin gluten ocasional', 7, TRUE),
    (v_acct, '+58105550102', 'Carlos Pérez', 'extra orégano', 3, FALSE),
    (v_acct, '+58105550103', 'Ana Ríos', 'sin queso', 1, FALSE),
    (v_acct, '+58105550104', 'Luis Fernández', '', 5, FALSE),
    (v_acct, '+58105550105', 'Patricia Díaz', 'borde extra crujiente', 2, FALSE)
  ON CONFLICT (account_id, phone) DO UPDATE SET
    name = EXCLUDED.name,
    preference = EXCLUDED.preference,
    orders_total = EXCLUDED.orders_total,
    is_premium = EXCLUDED.is_premium;

  -- A4. Waiters / meseros for round-robin assignment simulation
  INSERT INTO pizzeria_waiters (account_id, waiter_key, name, phone, is_active)
  VALUES
    (v_acct, 'mesero_1', 'Juan', '+58105550901', TRUE),
    (v_acct, 'mesero_2', 'María', '+58105550902', TRUE),
    (v_acct, 'mesero_3', 'Carlos', '+58105550903', TRUE)
  ON CONFLICT (account_id, waiter_key) DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    is_active = EXCLUDED.is_active;

  -- ------------------------------------------------------------
  -- PART B: waCRM simulation data (contacts, conversations, messages)
  --
  -- contacts.user_id is NOT NULL REFERENCES auth.users, so this part
  -- needs a real user. Prefer the account owner; fall back to any
  -- auth user. When none exists (fresh CI database), Part A stands
  -- alone and the rest is skipped.
  -- ------------------------------------------------------------
  SELECT owner_user_id INTO v_user FROM accounts WHERE id = v_acct;
  IF v_user IS NULL THEN
    SELECT id INTO v_user FROM auth.users LIMIT 1;
  END IF;

  IF v_user IS NULL THEN
    RAISE NOTICE 'pizzeria seed: no auth user found — skipping waCRM simulation data (contacts/conversations/orders)';
    RETURN;
  END IF;

  -- B1. Contacts (5 pizzeria clients as waCRM contacts). Upsert on the
  --     authoritative dedup index (account_id, phone_normalized).
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

  -- B2. Conversations + messages. One conversation per client, only
  --     created when missing (unique index on (account_id, contact_id)),
  --     and messages are inserted only together with their new
  --     conversation so re-runs never duplicate history.
  --     (Helper inline: each block resolves its contact, checks for an
  --     existing conversation, and early-continues via IF EXISTS.)

  -- === María: Margarita order in progress ===
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

  -- === Ana: Napolitana order ===
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

  -- === Patricia: Vegetarian inquiry ===
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

  -- ------------------------------------------------------------
  -- PART C: Simulated orders.
  -- Delete-and-recreate keeps re-runs idempotent (orders have no
  -- natural unique key) and guarantees the weak conversation links
  -- point at the conversations that now exist (Part B ran first).
  -- ------------------------------------------------------------
  DELETE FROM pizzeria_orders
  WHERE account_id = v_acct
    AND client_phone IN ('+58105550101', '+58105550105');

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
    '+58105550101', 'María González', '',
    'preparing',
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
    '+58105550105', 'Patricia Díaz', 'borde extra crujiente',
    'confirmed',
    (SELECT id FROM pizzeria_waiters WHERE account_id = v_acct AND waiter_key = 'mesero_2' LIMIT 1),
    '+58105550105',
    (SELECT id FROM conversations WHERE account_id = v_acct AND contact_id IN (SELECT id FROM contacts WHERE account_id = v_acct AND phone = '+58105550105') LIMIT 1),
    v_now - INTERVAL '2 minutes', v_now;

  RAISE NOTICE 'pizzeria seed: done for account %', v_acct;
END $seed$;
