-- ============================================================
-- Limpieza: contactos con teléfono inválido creados por JIDs de
-- Evolution/Baileys mal resueltos (LID, sufijo de dispositivo,
-- user parts concatenados como "5842638954921490236991").
--
-- Documentación: docs/evolution-api/spec-contact-phone-normalization.md (§5).
--
-- Ejecutar MANUALMENTE en el SQL editor de Supabase, en este orden.
-- Hacer backup antes:
--   CREATE TABLE backup_contacts_20260902 AS SELECT * FROM contacts;
--
-- No trunca teléfonos: cada corrección exige el número correcto conocido
-- (verificado por el operador, p. ej. contra el teléfono real del cliente).
-- ============================================================

-- ------------------------------------------------------------
-- PASO 1 — Detección (solo lectura)
-- Lista todos los contactos cuyo phone_normalized no es E.164
-- plausible (7–15 dígitos, sin empezar por 0).
-- ------------------------------------------------------------
SELECT c.id,
       c.account_id,
       c.name,
       c.phone,
       c.phone_normalized,
       c.created_at
FROM contacts c
WHERE c.phone_normalized !~ '^[1-9][0-9]{6,14}$'
ORDER BY c.account_id, c.created_at;

-- ------------------------------------------------------------
-- PASO 2 — Corrección de UN contacto con número conocido.
--
-- Edita los tres valores y ejecuta el bloque completo en una
-- transacción. Ejemplo real: Rosalys, de
-- '5842638954921490236991' a '584263895492'.
--
-- Comportamiento:
--   a) Si el teléfono correcto NO existe en la cuenta: se actualiza
--      phone (phone_normalized se recalcula solo, es una columna
--      generada). El índice único de la migración 022 protege contra
--      colisiones.
--   b) Si el teléfono correcto YA existe (contacto duplicado): se
--      fusiona el afectado en el existente con la misma semántica de
--      merge_duplicate_contacts() (migración 022): re-point de tablas
--      hijas, tags/valores personalizados solo cuando no colisionan,
--      y borrado del contacto afectado. Sin pérdida de datos.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_bad_id      CONSTANT uuid := '00000000-0000-0000-0000-000000000000';  -- id del contacto afectado (PASO 1)
  v_correct_phone CONSTANT text := '584263895492';                        -- número correcto verificado
  v_bad         contacts%ROWTYPE;
  v_survivor    contacts%ROWTYPE;
BEGIN
  SELECT * INTO v_bad FROM contacts WHERE id = v_bad_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contacto % no existe', v_bad_id;
  END IF;

  -- El número correcto debe ser E.164 plausible.
  IF v_correct_phone !~ '^[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'Número correcto inválido: %', v_correct_phone;
  END IF;

  SELECT * INTO v_survivor
  FROM contacts
  WHERE account_id = v_bad.account_id
    AND phone_normalized = regexp_replace(v_correct_phone, '\D', '', 'g')
    AND id <> v_bad.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Caso a: corrección directa. El índice único abortará si por
    -- carrera ya existe otro contacto con ese número.
    UPDATE contacts
       SET phone = v_correct_phone,
           updated_at = now()
     WHERE id = v_bad_id;
    RAISE NOTICE 'Contacto % corregido a %', v_bad_id, v_correct_phone;
  ELSE
    -- Caso b: fusión en el contacto existente (misma lógica que la
    -- migración 022). Survivor = el contacto con el teléfono correcto.
    UPDATE conversations                 SET contact_id = v_survivor.id WHERE contact_id = v_bad.id;
    UPDATE contact_notes                 SET contact_id = v_survivor.id WHERE contact_id = v_bad.id;
    UPDATE deals                         SET contact_id = v_survivor.id WHERE contact_id = v_bad.id;
    UPDATE broadcast_recipients          SET contact_id = v_survivor.id WHERE contact_id = v_bad.id;
    UPDATE automation_logs               SET contact_id = v_survivor.id WHERE contact_id = v_bad.id;
    UPDATE automation_pending_executions SET contact_id = v_survivor.id WHERE contact_id = v_bad.id;

    UPDATE contact_tags ct SET contact_id = v_survivor.id
      WHERE ct.contact_id = v_bad.id
        AND NOT EXISTS (
          SELECT 1 FROM contact_tags s
          WHERE s.contact_id = v_survivor.id AND s.tag_id = ct.tag_id
        );
    DELETE FROM contact_tags WHERE contact_id = v_bad.id;

    UPDATE contact_custom_values cv SET contact_id = v_survivor.id
      WHERE cv.contact_id = v_bad.id
        AND NOT EXISTS (
          SELECT 1 FROM contact_custom_values s
          WHERE s.contact_id = v_survivor.id AND s.custom_field_id = cv.custom_field_id
        );
    DELETE FROM contact_custom_values WHERE contact_id = v_bad.id;

    UPDATE flow_runs SET contact_id = v_survivor.id
      WHERE contact_id = v_bad.id AND status <> 'active';

    DELETE FROM contacts WHERE id = v_bad.id;
    RAISE NOTICE 'Contacto % fusionado en % (%)', v_bad.id, v_survivor.id, v_survivor.phone;
  END IF;
END $$;

-- ------------------------------------------------------------
-- PASO 3 — Verificación (solo lectura)
-- Debe devolver 0 filas salvo los casos pendientes de revisión manual.
-- ------------------------------------------------------------
SELECT c.id, c.account_id, c.name, c.phone
FROM contacts c
WHERE c.phone_normalized !~ '^[1-9][0-9]{6,14}$'
ORDER BY c.account_id, c.created_at;
