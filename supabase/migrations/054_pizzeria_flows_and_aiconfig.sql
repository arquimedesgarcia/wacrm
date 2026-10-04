-- ============================================================
-- 054_pizzeria_flows_and_aiconfig.sql — Flujo de ejemplo de la
-- pizzería en la tabla `flows` de waCRM.
--
-- El grafo se construye con las reglas EXACTAS del engine
-- (src/lib/flows/engine.ts + types.ts):
--   * flows.entry_node_id guarda el NODE_KEY (string), no el UUID.
--   * start.config.next_node_key apunta al primer nodo real.
--   * send_buttons: máx. 3 botones, cada uno con reply_id (lo que
--     Meta devuelve al tocarlo) y next_node_key.
--   * collect_input captura la respuesta en flow_runs.vars[var_key];
--     un nodo condition solo puede leer vars que un collect_input
--     previo guardó.
--   * condition usa contains/equals case-sensitive; el texto del
--     prompt pide "sí o no" para que la comparación sea fiable.
--   * Interpolación simple: solo {{vars.nombre}} (sin expresiones).
--
-- AI configs: NO se inserta fila en ai_configs. La app espera una
-- clave AES-256-GCM cifrada (encrypt() del lado servidor) y decrypt()
-- revienta con un placeholder en claro. La clave OpenAI/Anthropic se
-- configura desde Ajustes → IA de la app, que la cifra correctamente.
--
-- Replay safety: sin cuenta o sin usuario se omite con NOTICE.
-- Idempotente: el flujo se re-crea (delete + insert) en cada corrida.
-- ============================================================

-- sort_order en flow_nodes (idempotent; la tabla original 010 no la define)
ALTER TABLE flow_nodes
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_flow_nodes_sort_order
  ON flow_nodes(flow_id, sort_order);

DO $flow$
DECLARE
  v_acct UUID;
  v_user UUID;
  v_flow_id UUID;
BEGIN
  -- ------------------------------------------------------------
  -- Resolve account / user (skip cleanly when missing)
  -- ------------------------------------------------------------
  IF NULLIF(current_setting('acct_id', true), '') IS NOT NULL THEN
    v_acct := current_setting('acct_id', true)::UUID;
  ELSE
    SELECT id INTO v_acct FROM accounts ORDER BY created_at LIMIT 1;
  END IF;

  IF v_acct IS NULL THEN
    RAISE NOTICE 'pizzeria flow: no account found — skipping';
    RETURN;
  END IF;

  SELECT owner_user_id INTO v_user FROM accounts WHERE id = v_acct;
  IF v_user IS NULL THEN
    SELECT id INTO v_user FROM auth.users LIMIT 1;
  END IF;

  IF v_user IS NULL THEN
    RAISE NOTICE 'pizzeria flow: no auth user found — skipping (flows.user_id is NOT NULL)';
    RETURN;
  END IF;

  -- ------------------------------------------------------------
  -- Re-create the flow (idempotent: ON DELETE CASCADE removes nodes)
  -- ------------------------------------------------------------
  DELETE FROM flows
  WHERE account_id = v_acct
    AND name = 'Pizzería La Vecchia — Pedidos';

  INSERT INTO flows (
    user_id, account_id, name, description, status,
    entry_node_id, trigger_type, trigger_config
  )
  VALUES (
    v_user,
    v_acct,
    'Pizzería La Vecchia — Pedidos',
    'Flujo de simulación: toma de pedidos por WhatsApp (menú, tamaño, confirmación, pago y entrega).',
    'active',
    'start_welcome',  -- NODE_KEY, no UUID — así lo espera el engine
    'keyword',
    '{"keywords": ["hola", "buenas", "pedido", "orden", "pizza", "menú", "menu"], "match_type": "contains"}'::JSONB
  )
  RETURNING id INTO v_flow_id;

  -- NODO 1: start — apunta al primer nodo real
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'start_welcome', 'start',
    '{"next_node_key": "greet"}'::JSONB, 0, 0, 0);

  -- NODO 2: saludo
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'greet', 'send_message',
    '{"text": "¡Hola! Bienvenido a Pizzería La Vecchia. ¿Qué te gustaría hacer hoy?", "next_node_key": "main_menu"}'::JSONB,
    0, 120, 1);

  -- NODO 3: menú de botones (máx. 3 por Meta; reply_id + next_node_key)
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'main_menu', 'send_buttons',
    '{"text": "Elige una opción para continuar:", "buttons": [{"reply_id": "btn_menu", "title": "Ver menú", "next_node_key": "show_menu"}, {"reply_id": "btn_order", "title": "Hacer pedido", "next_node_key": "ask_pizza"}, {"reply_id": "btn_agent", "title": "Hablar con agente", "next_node_key": "handoff_agent"}]}'::JSONB,
    0, 240, 2);

  -- NODO 4: menú de texto
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'show_menu', 'send_message',
    '{"text": "Nuestro menú:\n\n• Margarita — $12 / $15 / $18 (peq/med/gran)\n• Napolitana — $15 / $18 / $21\n• Pescadora — $18 / $21 / $24\n• La Vecchia Especial — $20 / $23 / $26\n• Vegetariana — $14 / $17 / $20\n\nTamaños: Pequeña 25cm, Mediana 30cm (+$3), Grande 35cm (+$5).\nDelivery: +$2 (peq/med), +$3 (gran).\n\nPara pedir, escribe *pedido*.", "next_node_key": "end_flow"}'::JSONB,
    0, 360, 3);

  -- NODO 5: capturar pizza
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'ask_pizza', 'collect_input',
    '{"prompt_text": "¿Qué pizza quieres? Escríbe el nombre (ej: margarita, napolitana, pescadora, la vecchia especial, vegetariana).", "var_key": "pizza", "next_node_key": "ask_size"}'::JSONB,
    280, 120, 4);

  -- NODO 6: capturar tamaño
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'ask_size', 'collect_input',
    '{"prompt_text": "¿Qué tamaño prefieres?\n• Pequeña (25cm) — precio base\n• Mediana (30cm) — +$3\n• Grande (35cm) — +$5", "var_key": "tamano", "next_node_key": "confirm_order"}'::JSONB,
    280, 240, 5);

  -- NODO 7: resumen del pedido
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'confirm_order', 'send_message',
    '{"text": "Resumen de tu pedido:\n\n• Pizza: {{vars.pizza}}\n• Tamaño: {{vars.tamano}}\n\n¿Confirmas? Responde *sí* o *no*.", "next_node_key": "ask_confirmation"}'::JSONB,
    280, 360, 6);

  -- NODO 8: capturar confirmación
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'ask_confirmation', 'collect_input',
    '{"prompt_text": "¿Confirmas el pedido? Responde sí o no.", "var_key": "confirmacion", "next_node_key": "check_negative"}'::JSONB,
    280, 480, 7);

  -- NODO 9: ¿contiene "no"? → cancelar; si no, verificar "sí"
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'check_negative', 'condition',
    '{"subject": "var", "subject_key": "confirmacion", "operator": "contains", "value": "no", "true_next": "order_cancelled", "false_next": "check_positive"}'::JSONB,
    280, 600, 8);

  -- NODO 10: ¿contiene "sí"? → pago; si no, re-preguntar
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'check_positive', 'condition',
    '{"subject": "var", "subject_key": "confirmacion", "operator": "contains", "value": "sí", "true_next": "payment_info", "false_next": "reconfirm"}'::JSONB,
    280, 720, 9);

  -- NODO 11: no se entendió la respuesta → volver a preguntar
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'reconfirm', 'send_message',
    '{"text": "No entendí tu respuesta. ¿Confirmas el pedido? Responde *sí* o *no*.", "next_node_key": "ask_confirmation"}'::JSONB,
    560, 720, 10);

  -- NODO 12: pedido cancelado
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'order_cancelled', 'send_message',
    '{"text": "Sin problema, pedido cancelado. Si quieres algo más, escríbenos *hola* y empezamos de nuevo.", "next_node_key": "end_flow"}'::JSONB,
    560, 600, 11);

  -- NODO 13: instrucciones de pago
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'payment_info', 'send_message',
    '{"text": "¡Genial, pedido confirmado!\n\nOpciones de pago:\n• Efectivo: al recoger\n• Transferencia: envía el comprobante por WhatsApp\n\nTiempo estimado: 20-40 min.", "next_node_key": "ask_delivery"}'::JSONB,
    560, 480, 12);

  -- NODO 14: tipo de entrega
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'ask_delivery', 'collect_input',
    '{"prompt_text": "¿Prefieres *delivery* o *recogida* en la pizzería? (dirección: Av. 10, Casa 123)", "var_key": "entrega", "next_node_key": "order_placed"}'::JSONB,
    560, 360, 13);

  -- NODO 15: cierre del pedido
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'order_placed', 'send_message',
    '{"text": "¡Gracias por tu pedido! 🎉 Te avisaremos por WhatsApp cuando esté listo.", "next_node_key": "end_flow"}'::JSONB,
    560, 240, 14);

  -- NODO 16: derivar a un agente humano
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'handoff_agent', 'handoff',
    '{"note": "Pizzería: el cliente pidió hablar con un agente."}'::JSONB,
    -280, 240, 15);

  -- NODO 17: fin
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y, sort_order)
  VALUES (v_flow_id, 'end_flow', 'end', '{}'::JSONB, 0, 840, 16);

  RAISE NOTICE 'pizzeria flow: created flow % (17 nodes) for account %', v_flow_id, v_acct;
END $flow$;
