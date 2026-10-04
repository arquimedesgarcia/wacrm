-- ============================================================
-- 053_pizzeria_kb_seed.sql — Seed de base de conocimiento para
-- Pizzería La Vecchia.
--
-- Inserta documentos y chunks en ai_knowledge_documents y
-- ai_knowledge_chunks que alimentan el auto-reply del IA.
--
-- Replay safety: si no hay cuenta, se omite con NOTICE (la CI corre
-- `supabase db reset` sobre una base vacía). Idempotente: los
-- documentos de la pizzería se identifican por título y se
-- re-crean (delete + insert) en cada corrida — nunca se duplican.
-- ============================================================

DO $kb$
DECLARE
  v_acct UUID;
  v_doc_menu_id UUID;
  v_doc_sizes_id UUID;
  v_doc_policies_id UUID;
  c_menu_title TEXT := 'Menú de Pizzería La Vecchia - Pizzas';
  c_sizes_title TEXT := 'Tamaños y Precios - Pizzería La Vecchia';
  c_policies_title TEXT := 'Políticas de Pizzería La Vecchia';
BEGIN
  IF NULLIF(current_setting('acct_id', true), '') IS NOT NULL THEN
    v_acct := current_setting('acct_id', true)::UUID;
  ELSE
    SELECT id INTO v_acct FROM accounts ORDER BY created_at LIMIT 1;
  END IF;

  IF v_acct IS NULL THEN
    RAISE NOTICE 'pizzeria KB seed: no account found — skipping';
    RETURN;
  END IF;

  -- Idempotency: re-crear los documentos de la pizzería desde cero.
  -- ON DELETE CASCADE limpia los chunks asociados.
  DELETE FROM ai_knowledge_documents
  WHERE account_id = v_acct
    AND title IN (c_menu_title, c_sizes_title, c_policies_title);

  -- Documento: Menú de pizzas
  INSERT INTO ai_knowledge_documents (account_id, created_by, title, content)
  VALUES (
    v_acct,
    NULL,
    c_menu_title,
    E'PIZZAS DISPONIBLES EN PIZZERÍA LA VECCHIA\n\n'
    '=== Margarita ($12 pequeña / $15 mediana / $18 grande) ===\n'
    'Descripción: Mozzarella, tomate y albahaca fresca. Clásica y equilibrada.\n'
    'Ingredientes: mozzarella, tomate, albahaca\n'
    'Categoría: Clásicas\n'
    'Vegetariana: Sí\n'
    'Sin gluten: No\n'
    'Tiempo preparación: 12 min\n\n'
    '=== Napolitana ($15 pequeña / $18 mediana / $21 grande) ===\n'
    'Descripción: Tomate, mozzarella, jamón, rúcula fresca y aceitunas negras.\n'
    'Ingredientes: mozzarella, tomate, jamón, rúcula, aceitunas\n'
    'Categoría: Clásicas con carne\n'
    'Vegetariana: No (tiene jamón)\n'
    'Sin gluten: No\n'
    'Tiempo preparación: 14 min\n'
    'Popular: Sí\n\n'
    '=== Pescadora ($18 pequeña / $21 mediana / $24 grande) ===\n'
    'Descripción: Salsa de ajo, queso, atún, aceitunas y pimientos rojos. Para los amantes del mar.\n'
    'Ingredientes: salsa de ajo, queso, atún, aceitunas, pimientos rojos\n'
    'Categoría: Especiales - mar\n'
    'Vegetariana: No (tiene atún)\n'
    'Sin gluten: No\n'
    'Tiempo preparación: 15 min\n\n'
    '=== La Vecchia Especial ($20 pequeña / $23 mediana / $26 grande) ===\n'
    'Descripción: Nuestra pizza estrella: chorizo, pimiento, cebolla caramelizada y orégano sobre base de tomate y mozzarella.\n'
    'Ingredientes: mozzarella, tomate, chorizo, pimiento rojo, cebolla caramelizada, orégano\n'
    'Categoría: Especiales\n'
    'Vegetariana: No (tiene chorizo)\n'
    'Sin gluten: No\n'
    'Tiempo preparación: 16 min\n'
    'Popular: Muy alta (es la pizza estrella de la casa)\n\n'
    '=== Vegetariana ($14 pequeña / $17 mediana / $20 grande) ===\n'
    'Descripción: Mozzarella, verduras frescas y aceitunas negras.\n'
    'Ingredientes: mozzarella, tomate, pimiento verde, pimiento rojo, cebolla, champiñones, aceitunas\n'
    'Categoría: Vegetarianas\n'
    'Vegetariana: Sí\n'
    'Sin gluten: No\n'
    'Tiempo preparación: 13 min\n\n'
    'NOTA: La Margarita y la Vegetariana son las únicas pizzas vegetarianas del menú.'
  )
  RETURNING id INTO v_doc_menu_id;

  -- Documento: Tamaños y precios
  INSERT INTO ai_knowledge_documents (account_id, created_by, title, content)
  VALUES (
    v_acct,
    NULL,
    c_sizes_title,
    E'TAMAÑOS DE PIZZA\n\n'
    'Pequeña (25 cm): Precio base. Sin recargo adicional.\n'
    'Mediana (30 cm): Recargo +$3 sobre el precio base.\n'
    'Grande (35 cm): Recargo +$5 sobre el precio base.\n\n'
    'PRECIOS POR TIPO DE PIZZA\n\n'
    'Margarita: $12 (peq) / $15 (med) / $18 (grande)\n'
    'Napolitana: $15 (peq) / $18 (med) / $21 (grande)\n'
    'Pescadora: $18 (peq) / $21 (med) / $24 (grande)\n'
    'La Vecchia Especial: $20 (peq) / $23 (med) / $26 (grande)\n'
    'Vegetariana: $14 (peq) / $17 (med) / $20 (grande)\n\n'
    'CARGOS DE ENTREGA\n'
    'Delivery pequeña/mediana: $2 extra\n'
    'Delivery grande: $3 extra\n'
    'Recogida: $0 (sin cargo)\n\n'
    'NOTA: Los precios mostrados son los precios finales por tamaño, '
    'NO precio base más recargo. El precio mostrado para "Grande" ya '
    'incluye el recargo correspondiente.'
  )
  RETURNING id INTO v_doc_sizes_id;

  -- Documento: Políticas
  INSERT INTO ai_knowledge_documents (account_id, created_by, title, content)
  VALUES (
    v_acct,
    NULL,
    c_policies_title,
    E'POLÍTICAS DE LA PIZZERÍA LA VECCHIA\n\n'
    'HORARIO:\n'
    '- Lunes a Domingos: 11:00 AM - 11:00 PM\n'
    '- Cierres: 25 dic, 1 ene, Semana Santa (jueves y viernes)\n'
    '- Último pedido de delivery: 10:00 PM\n'
    '- Último pedido de recogida: 10:30 PM\n\n'
    'CONTACTO:\n'
    '- Teléfono/WhatsApp: +58116789\n'
    '- Dirección: Av. 10, Casa 123, Caracas\n'
    '- Pedidos por WhatsApp (recomendado)\n\n'
    'PEDIDOS:\n'
    '- Mínimo: 1 pizza\n'
    '- Máximo: 10 pizzas (más = contactar al +58116789)\n'
    '- Más de 4 pizzas: confirmar por teléfono\n'
    '- Preparación: 12-16 min por pizza (procesamos varias simultáneamente)\n\n'
    'ENTREGA:\n'
    '- Zonas: El Paraíso, Chacao, Altamira, alrededores\n'
    '- Fuera de zona: consultar disponibilidad\n'
    '- Tiempo estimado: 20-40 min desde confirmación\n'
    '- Retrasos: avisar por WhatsApp\n\n'
    'RESERVAS:\n'
    '- Mínimo 4 personas, máximo 20\n'
    '- Confirmar: nombre, cantidad, hora, teléfono\n'
    '- Menos de 2 horas: consultar disponibilidad\n'
    '- Más de 6 personas: llamar al +58116789\n\n'
    'CANCELACIÓN Y DEVOLUCIÓN:\n'
    '- Cancelar pedido: antes de iniciar preparación\n'
    '- Una vez iniciada la preparación: NO se puede cancelar\n'
    '- Pedido incorrecto: se reemplaza o devuelve\n'
    '- El cliente es responsable de verificar el pedido al recibir\n\n'
    'PAGOS:\n'
    '- Efectivo: al recoger\n'
    '- Transferencia bancaria: enviar comprobante por WhatsApp\n'
    '- Zelle / Pago móvil: consultar disponibilidad al momento\n'
    '- No aceptamos tarjetas en la pizzería (solo efectivo)\n\n'
    'ALÉRGENOS:\n'
    '- Lácteos: todos los quesos contienen lácteos\n'
    '- Gluten: la base contiene gluten (salvo opción sin gluten si hay disponibilidad)\n'
    '- Aceitunas: algunas pizzas llevan aceitunas\n'
    '- Atún: puede contener trazas de soja\n'
    '- Para alérgenos específicos: consultar al momento del pedido\n\n'
    'OPCIONES ESPECIALES:\n'
    '- Sin gluten: consultar disponibilidad al momento del pedido\n'
    '- Sin queso: disponible para cualquier pizza (remover queso)\n'
    '- Extra orégano: $1 adicional\n'
    '- Borde extra crujiente: disponible bajo pedido'
  )
  RETURNING id INTO v_doc_policies_id;

  -- Chunks del menú
  INSERT INTO ai_knowledge_chunks (document_id, account_id, chunk_index, content)
  VALUES
    (v_doc_menu_id, v_acct, 0,
     E'PIZZA: Margarita\nSKU: marg\nPrecio: $12 (peq) / $15 (med) / $18 (grande)\nDescripción: Mozzarella, tomate y albahaca fresca. Clásica y equilibrada.\nIngredientes: mozzarella, tomate, albahaca\nVegetariana: Sí\nSin gluten: No\nPreparación: 12 min\nCategoría: Clásicas\n---\n'),
    (v_doc_menu_id, v_acct, 1,
     E'PIZZA: Napolitana\nSKU: napo\nPrecio: $15 (peq) / $18 (med) / $21 (grande)\nDescripción: Tomate, mozzarella, jamón, rúcula fresca y aceitunas negras.\nIngredientes: mozzarella, tomate, jamón, rúcula, aceitunas\nVegetariana: No (tiene jamón)\nSin gluten: No\nPreparación: 14 min\nPopular: Sí\nCategoría: Clásicas con carne\n---\n'),
    (v_doc_menu_id, v_acct, 2,
     E'PIZZA: Pescadora\nSKU: pesc\nPrecio: $18 (peq) / $21 (med) / $24 (grande)\nDescripción: Salsa de ajo, queso, atún, aceitunas y pimientos rojos.\nIngredientes: salsa de ajo, queso, atún, aceitunas, pimientos rojos\nVegetariana: No (tiene atún)\nSin gluten: No\nPreparación: 15 min\nCategoría: Especiales - mar\n---\n'),
    (v_doc_menu_id, v_acct, 3,
     E'PIZZA: La Vecchia Especial\nSKU: espec\nPrecio: $20 (peq) / $23 (med) / $26 (grande)\nDescripción: Pizza estrella: chorizo, pimiento, cebolla caramelizada y orégano.\nIngredientes: mozzarella, tomate, chorizo, pimiento rojo, cebolla caramelizada, orégano\nVegetariana: No (tiene chorizo)\nSin gluten: No\nPreparación: 16 min\nPopular: Muy alta (pizza estrella)\nCategoría: Especiales\n---\n'),
    (v_doc_menu_id, v_acct, 4,
     E'PIZZA: Vegetariana\nSKU: vege\nPrecio: $14 (peq) / $17 (med) / $20 (grande)\nDescripción: Mozzarella, verduras frescas y aceitunas negras.\nIngredientes: mozzarella, tomate, pimiento verde, pimiento rojo, cebolla, champiñones, aceitunas\nVegetariana: Sí\nSin gluten: No\nPreparación: 13 min\nCategoría: Vegetarianas\n---\n'),
    (v_doc_menu_id, v_acct, 5,
     E'COMPARATIVA VEGETARIANA:\n'
     'Margarita: vegetariana (queso, tomate, albahaca) - $12-18\n'
     'Vegetariana: vegetariana (verduras frescas) - $14-20\n'
     'Napolitana: NO vegetariana (jamón)\n'
     'Pescadora: NO vegetariana (atún)\n'
     'La Vecchia Especial: NO vegetariana (chorizo)\n---\n');

  -- Chunks de tamaños
  INSERT INTO ai_knowledge_chunks (document_id, account_id, chunk_index, content)
  VALUES
    (v_doc_sizes_id, v_acct, 0,
     E'TAMAÑOS DE PIZZA\n\n'
     'Pequeña (25 cm): Precio base. Sin recargo. Ideal para 1 persona.\n'
     'Mediana (30 cm): Recargo +$3. Ideal para 2 personas.\n'
     'Grande (35 cm): Recargo +$5. Ideal para 3-4 personas.\n---\n'),
    (v_doc_sizes_id, v_acct, 1,
     E'Precios: Margarita $12-18, Napolitana $15-21, Pescadora $18-24, La Vecchia Especial $20-26, Vegetariana $14-20\nDescripción de tamaños:\n- Pequeña (25cm): Sin recargo\n- Mediana (30cm): +$3\n- Grande (35cm): +$5\n---\n'),
    (v_doc_sizes_id, v_acct, 2,
     E'CARGOS DE ENTREGA:\n'
     'Delivery pequeña/mediana: $2 extra\n'
     'Delivery grande: $3 extra\n'
     'Recogida: $0 (sin cargo)\n---\n');

  -- Chunks de políticas
  INSERT INTO ai_knowledge_chunks (document_id, account_id, chunk_index, content)
  VALUES
    (v_doc_policies_id, v_acct, 0,
     E'HORARIO:\n'
     '- Lunes a Domingos: 11:00 AM - 11:00 PM\n'
     '- Cierres: 25 dic, 1 ene, Semana Santa (jueves y viernes)\n'
     '- Último pedido delivery: 10:00 PM\n'
     '- Último pedido recogida: 10:30 PM\n---\n'),
    (v_doc_policies_id, v_acct, 1,
     E'CONTACTO:\n'
     '- Teléfono/WhatsApp: +58116789\n'
     '- Dirección: Av. 10, Casa 123, Caracas\n'
     '- Pedidos por WhatsApp (recomendado)\n---\n'),
    (v_doc_policies_id, v_acct, 2,
     E'PEDIDOS:\n'
     '- Mínimo: 1 pizza\n'
     '- Máximo: 10 pizzas\n'
     '- Más de 4: confirmar por teléfono\n'
     '- Preparación: 12-16 min (varias simultáneas)\n---\n'),
    (v_doc_policies_id, v_acct, 3,
     E'ENTREGA:\n'
     '- Zonas: El Paraíso, Chacao, Altamira, alrededores\n'
     '- Fuera de zona: consultar\n'
     '- Tiempo: 20-40 min desde confirmación\n'
     '- Retrasos: avisar por WhatsApp\n---\n'),
    (v_doc_policies_id, v_acct, 4,
     E'RESERVAS:\n'
     '- Mínimo 4 personas, máximo 20\n'
     '- Confirmar: nombre, cantidad, hora, teléfono\n'
     '- Menos de 2 horas: consultar\n'
     '- Más de 6: llamar al +58116789\n---\n'),
    (v_doc_policies_id, v_acct, 5,
     E'CANCELACIÓN:\n'
     '- Antes de iniciar preparación: se puede cancelar\n'
     '- Una vez iniciada: NO se puede cancelar\n'
     '- Pedido incorrecto: reemplazar o devolver\n'
     '- El cliente verifica al recibir\n---\n'),
    (v_doc_policies_id, v_acct, 6,
     E'PAGOS:\n'
     '- Efectivo: al recoger\n'
     '- Transferencia: comprobante por WhatsApp\n'
     '- Zelle / Pago móvil: consultar al momento\n'
     '- No aceptamos tarjetas (solo efectivo)\n---\n'),
    (v_doc_policies_id, v_acct, 7,
     E'ALÉRGENOS:\n'
     '- Lácteos: todos los quesos\n'
     '- Gluten: base de pizza (salvo opción sin gluten)\n'
     '- Aceitunas: algunas pizzas\n'
     '- Atún: trazas de soja\n'
     '- Consultar al pedir para alérgenos específicos\n---\n'),
    (v_doc_policies_id, v_acct, 8,
     E'OPCIONES ESPECIALES:\n'
     '- Sin gluten: consultar disponibilidad\n'
     '- Sin queso: disponible (remover queso)\n'
     '- Extra orégano: $1 adicional\n'
     '- Borde extra crujiente: bajo pedido\n---\n');

  RAISE NOTICE 'pizzeria KB seed: 3 documents inserted for account %', v_acct;
END $kb$;
