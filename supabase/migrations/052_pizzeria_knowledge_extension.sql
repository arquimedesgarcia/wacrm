-- ============================================================
-- 052_pizzeria_knowledge_extension.sql — Extiende pizzeria_pizzas
-- para que la base de conocimiento pueda consultar productos.
--
-- Crea vistas de texto listo para ingestar en la KB, plus columnas
-- adicionales para búsqueda por categoría y atributos.
--
-- Las vistas usan security_invoker = true (Postgres 15+): se ejecutan
-- con los permisos/RLS del usuario que consulta, NO con los del owner.
-- Sin esto, cualquier usuario autenticado leería los datos de TODAS
-- las cuentas a través de la API de PostgREST.
-- ============================================================

-- ============================================================
-- 1. Columnas extra para IA — categoría, tags, info nutricional,
--    popularidad (para que la KB pueda responder "¿qué pizza es la
--    más popular?" o "¿tenés algo para celíacos?")
-- ============================================================
ALTER TABLE pizzeria_pizzas
  ADD COLUMN IF NOT EXISTS category TEXT,           -- ej: "clásicas", "especiales", "vegetarianas", "con carne"
  ADD COLUMN IF NOT EXISTS tags TEXT[],             -- ej: ARRAY['sin gluten', 'poco masaje'] para búsqueda por atributos
  ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notes TEXT,              -- notas de preparación, alérgenos, variaciones
  ADD COLUMN IF NOT EXISTS is_spicy BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- 2. Vista pizzeria_kb_feed — texto listo para ingestar en KB.
--    Se usa para generar documents que la base de conocimiento
--    pueda consultar. La IA recibe el menú completo como contexto.
-- ============================================================
CREATE OR REPLACE VIEW pizzeria_kb_feed
WITH (security_invoker = true) AS
  SELECT
    id,
    sku,
    name,
    description,
    ingredients,
    price_small,
    price_medium,
    price_large,
    preparation_minutes,
    category,
    tags,
    is_popular,
    notes,
    is_vegetarian,
    is_gluten_free,
    is_spicy,
    -- Genera un texto estructurado que la KB puede indexar
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
      'PICANTE: ', CASE WHEN is_spicy THEN 'Sí' ELSE 'No' END, E'\n',
      'VEGETARIANA: ', CASE WHEN is_vegetarian THEN 'Sí' ELSE 'No' END, E'\n',
      'SIN GLUTEN: ', CASE WHEN is_gluten_free THEN 'Sí' ELSE 'No' END, E'\n',
      'NOTAS: ', COALESCE(notes, ''),
      E'\n---'
    ) AS kb_text
  FROM pizzeria_pizzas
  WHERE account_id IS NOT NULL;

-- ============================================================
-- 3. Vista de resumen de tamaños — para que la KB pueda responder
--    preguntas sobre tamaños y precios.
-- ============================================================
CREATE OR REPLACE VIEW pizzeria_sizes_kb_feed
WITH (security_invoker = true) AS
  SELECT
    id,
    size_key,
    label,
    price_modifier,
    diameter_cm,
    CONCAT(
      'TAMAÑO: ', label, E'\n',
      'CLAVE: ', size_key, E'\n',
      'RECORTE DE PRECIO: +$', COALESCE(price_modifier::text, '0'), E'\n',
      'DIÁMETRO: ', COALESCE(diameter_cm::text, ''), ' cm', E'\n',
      'NOTA: La pizza pequeña tiene precio base (recorte 0); mediana +$3; grande +$5.'
    ) AS kb_text
  FROM pizzeria_sizes
  WHERE account_id IS NOT NULL;

-- ============================================================
-- 4. Vista de clientes frecuentes con preferencias —
--    para que la KB pueda personalizar respuestas ("María siempre
--    pide sin gluten").
-- ============================================================
CREATE OR REPLACE VIEW pizzeria_clients_kb_feed
WITH (security_invoker = true) AS
  SELECT
    id,
    phone,
    name,
    preference,
    orders_total,
    is_premium,
    CONCAT(
      'CLIENTE: ', COALESCE(name, 'Sin nombre'), E'\n',
      'TELÉFONO: ', phone, E'\n',
      'PREFERENCIA: ', COALESCE(preference, 'Sin preferencia registrada'), E'\n',
      'PEDIDOS TOTALES: ', orders_total, E'\n',
      'PREMIUM: ', CASE WHEN is_premium THEN 'Sí (cliente frecuente)' ELSE 'No' END, E'\n',
      '---'
    ) AS kb_text
  FROM pizzeria_clients
  WHERE account_id IS NOT NULL;

-- ============================================================
-- 5. Vista de meseros para asignación round-robin —
--    para que la KB pueda responder "¿quién está de turno?"
-- ============================================================
CREATE OR REPLACE VIEW pizzeria_waiters_kb_feed
WITH (security_invoker = true) AS
  SELECT
    id,
    waiter_key,
    name,
    phone,
    is_active,
    CONCAT(
      'MESERO: ', name, E'\n',
      'CLAVE: ', waiter_key, E'\n',
      'TELÉFONO: ', COALESCE(phone, 'No registrado'), E'\n',
      'ACTIVO: ', CASE WHEN is_active THEN 'Sí' ELSE 'No' END, E'\n',
      '---'
    ) AS kb_text
  FROM pizzeria_waiters
  WHERE account_id IS NOT NULL AND is_active = TRUE;

-- ============================================================
-- 6. Restricción de integridad para KB de políticas
-- ============================================================
-- Esta vista es auxiliar: la KB real se alimenta desde los
-- documentos insertados directamente en ai_knowledge_documents
-- (ver migración 053). Se mantiene aquí para consistencia.

