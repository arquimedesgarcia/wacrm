# Especificación: normalización de teléfono en contactos creados automáticamente (Evolution API)

- **Fecha:** 2026-09-02
- **Rama:** custom
- **Estado:** Fases 0+1 implementadas (resolver `providers/jid.ts`, adaptador, importación y webhook); Fase 2 materializada en `scripts/cleanup-contacts-invalid-phone.sql` (ejecución manual pendiente)
- **Problema observado:** contacto creado automáticamente `Rosalys — 5842638954921490236991`. El número real de la región es `584263895492`; el segmento `1490236991` no pertenece al teléfono.

---

## 1. Trazado del flujo actual (origen del valor)

Los únicos caminos que crean contactos automáticamente con proveedor Evolution:

1. **Webhook en tiempo real** — `src/app/api/whatsapp/evolution/webhook/route.ts`
   - `handleInboundMessage()` (línea 245) toma `event.senderPhone` → `normalizeInboundPhone()` (línea 250) → `findOrCreateContact()` (línea 473) inserta en `contacts.phone`.
2. **Importación histórica** — `src/lib/whatsapp/evolution-import.ts`
   - `importContactHistory()` (línea 164) toma `contact.remoteJid` (viene de `POST /chat/findContacts`) → `normalizeInboundPhone()` (línea 188) → insert (línea 209).

Ambos convergen en:

- `EvolutionAdapter.normalizeHistoricalMessage()` — `src/lib/whatsapp/providers/evolution-adapter.ts:431`, extrae `key.remoteJid` → `normalizeInboundPhone()`.
- `normalizeInboundPhone()` — `src/lib/whatsapp/providers/normalize.ts:18`:

```ts
const local = phone.split('@')[0]
return normalizePhone(local)   // elimina todo lo que no sea dígito
```

- Deduplicación: `findExistingContact()` — `src/lib/contacts/dedupe.ts:35` (prefiltro SQL por últimos 8 dígitos + `phonesMatch()` por últimos 8 dígitos), y el unique index `(account_id, phone_normalized)` de la migración 022 (`phone_normalized` = dígitos de `phone`, generado por Postgres).

**Conclusión del trazado:** el valor almacenado en `contacts.phone` son los dígitos del *user part* del JID tal como llega en `key.remoteJid` (webhook) o `remoteJid` (`findContacts`). No hay concatenación en el código de WaCRM; el código **elimina separadores** de un JID cuyo user part ya contenía más que un teléfono.

## 2. Causa comprobada

### 2.1 Defecto propio (comprobado leyendo el código)

`normalizeInboundPhone` hace exactamente lo que la documentación de Baileys prohíbe explícitamente ("*Never split a JID string with `.split('@')`*", [baileys.wiki/concepts/jids](https://baileys.wiki/concepts/jids)):

- **No distingue el dominio del JID.** `@lid`, `@hosted`, `@g.us`, `@broadcast`, `@newsletter`, `@c.us` se tratan igual que `@s.whatsapp.net`.
- **No elimina el sufijo de dispositivo.** Un PN JID multidispositivo `584263895492:2@s.whatsapp.net` se convierte en `5842638954922` (teléfono contaminado). El sufijo `:device` puede aparecer en cualquier mensaje entrante.
- **Un LID no es un teléfono.** `1490236991@lid` se almacenaría como teléfono `1490236991`.
- **El webhook no filtra grupos.** `normalizeHistoricalMessage` acepta cualquier `remoteJid`; un JID de grupo `timestamp-random@g.us` produce un contacto con los dígitos concatenados del JID del grupo. (La importación histórica sí filtra `@(g.us|broadcast|newsletter)` en `evolution-import.ts:183`; el webhook no tiene filtro equivalente.)
- **El adaptador nunca lee** `key.remoteJidAlt`, `key.participantAlt`, `key.addressingMode` ni `data.sender`, que son los campos que Evolution/Baileys usan para comunicar el teléfono real cuando `remoteJid` viene como LID.
- **Sin validación a la entrada.** `findOrCreateContact` inserta cualquier cadena de dígitos sin pasar `isValidE164` (7–15 dígitos). Un valor de 22 dígitos nunca debería llegar a `contacts.phone`.

### 2.2 Comportamiento upstream confirmado (Evolution API v2.3.7 / Baileys 7.x)

- WhatsApp migra usuarios a **LID** (Linked Identity JID); `key.remoteJid` puede llegar como `NNNN@lid` **sin** teléfono, y `key.remoteJidAlt` / `key.participantAlt` transportan el PN (`...@s.whatsapp.net`) correspondiente. Meta-issue: [evolution-api#1872](https://github.com/evolution-foundation/evolution-api/issues/1872); ejemplos de payload con `remoteJid`/`remoteJidAlt`/`addressingMode`: [evolution-api#2267](https://github.com/evolution-foundation/evolution-api/issues/2267), [Baileys#2185](https://github.com/WhiskeySockets/Baileys/issues/2185).
- `POST /chat/findContacts` devuelve **dos filas por la misma persona** (una `...@lid` y otra `...@s.whatsapp.net`) para contactos migrados (verificado en instancia real: [tutorial WEC](https://wec.wiline.com/docs/tutorials/whatsapp-ai-assistant-evolution-api/)).
- Los síntomas persisten en v2.3.7 según el propio seguimiento upstream ([evolution-api#1872, Status](https://github.com/evolution-foundation/evolution-api/issues/1872)).

### 2.3 Clasificación del valor observado `5842638954921490236991`

- **No es un teléfono:** 22 dígitos > máximo E.164 de 15. El prefijo `584263895492` sí es E.164 plausible (VE, 58 + 10).
- **Es un string de dígitos derivado de un JID:** es la firma exacta de tomar el user part de un JID con un separador (`:` o `-`) y eliminarlo. Es decir: `teléfono real + fragmento de identificador` donde el fragmento `1490236991` es un identificador interno (LID, sufijo o aleatorio de dominio), no parte del número.
- **Qué no se puede afirmar sin el payload crudo:** la forma exacta del JID que Evolution envió en este caso. Candidatos compatibles con la evidencia:
  a. user part `584263895492:1490236991@…` (PN con segmento adicional no estándar emitido por Evolution/Baileys);
  b. Evolution emitiendo PN+LID ya concatenados en `remoteJid` (clase de bug de saneamiento de `remoteJid` que el changelog de v2.3.7 menciona: "Enhanced remoteJid validation and processing");
  c. un evento 1:1 anómalo (p. ej. proveniente de anuncio/broadcast, cf. [evolution-api#2267](https://github.com/evolution-foundation/evolution-api/issues/2267)).
- Por eso la implementación incluye **Fase 0 de instrumentación** (abajo) para capturar el `key` crudo real antes de fijar afinaciones de la regla.

## 3. Teléfono vs JID vs LID (modelo de identidad)

| Concepto | Forma | ¿Es teléfono? | Uso correcto en WaCRM |
| --- | --- | --- | --- |
| Teléfono E.164 | `584263895492` | Sí | `contacts.phone`, dedupe, envío |
| PN JID | `584263895492[@s.whatsapp.net]` (con sufijo opcional `:device`) | Sí, tras quitar dominio y `:device` | Fuente del teléfono |
| LID JID | `1490236991@lid` (con sufijo opcional `:device`) | **No** — identificador opaco por cuenta | Nunca como `phone`; solo para resolver vía `remoteJidAlt`/`participantAlt` |
| Grupo | `timestamp-random@g.us` | No | Descartar (contacto = persona) |
| Broadcast/status/newsletter | `…@broadcast`, `status@broadcast`, `…@newsletter` | No | Descartar |

Regla de oro upstream: LID→PN no es resoluble en general desde WaCRM; solo se puede usar el par `remoteJidAlt`/`participantAlt` **cuando el payload lo incluye**. Si no viene, no se debe crear contacto con el LID.

## 4. Regla de normalización propuesta (clasificación, no truncado)

**No se trunca a longitud fija.** Se clasifica el JID por dominio y se actúa según la clase:

1. **Parsear** `valor` como JID: `user[:device]@server`. Nunca con regex ciega de dígitos.
2. **Clasificar por `server`:**
   - `s.whatsapp.net` → candidato = `user`. Si contiene `:` (sufijo de dispositivo), quedarse con la parte anterior **solo si** el candidato completo no es E.164 válido y la parte anterior sí lo es (evita mutilar números válidos; elimina `:2`, `:14`, etc.).
   - `lid`, `hosted`, `hosted.lid`, `bot`, `c.us` → **no es teléfono**. Resolver en este orden: `remoteJidAlt` (1:1) / `participantAlt` (grupos) / `data.sender` → repetir clasificación sobre el valor resuelto. Si no hay resolución disponible: **omitir el evento/contacto** (log estructurado) — jamás crear contacto con el LID.
   - `g.us`, `broadcast`, `newsletter`, `status@broadcast` → descartar el evento para creación de contacto (mismo comportamiento que la importación histórica).
3. **Validar** el resultado con `isValidE164` (7–15 dígitos). Si falla → no crear contacto; log con `key` crudo (ya sanitizado de secretos) para diagnóstico.
4. **`findContacts` (importación):** ignorar entradas `@lid` cuando existe su par PN en la misma respuesta (mismo `pushName`); nunca importar una entrada `@lid` como teléfono.
5. **Salida (envío):** `normalizeOutboundPhone`/`sendText` ya reciben teléfonos desde `contacts.phone`; no cambia su contrato, pero se beneficia de que `contacts.phone` deja de contener LIDs.

Punto de aplicación único: extender `normalizeInboundPhone` (o un nuevo `resolveInboundPhone(jid, key)`) en `providers/normalize.ts`, consumiendo `key.remoteJidAlt`/`key.participantAlt` desde `EvolutionAdapter.normalizeHistoricalMessage` y `findContacts`.

## 5. Tratamiento de contactos existentes ya afectados

1. **Detección (solo lectura):** listar contactos donde `phone_normalized` no cumpla E.164 (longitud < 7 o > 15, o empiece por `0`). Con service role, sin modificar nada.
2. **Corrección caso a caso, sin truncado ciego:**
   - Para cada contacto afectado, localizar el JID crudo original en `messages.raw_payload` (columna que guarda el payload del proveedor) para determinar la clase real (LID, `:device`, grupo, etc.) y el teléfono correcto vía `remoteJidAlt` si está presente.
   - Si el teléfono correcto se determina con evidencia (p. ej. `Rosalys` → `584263895492`): actualizar `contacts.phone`; `phone_normalized` se recalcula solo (columna generada). Si ya existe un contacto con ese número, fusionar con la semántica de `merge_duplicate_contacts()` (migración 022: re-point de conversaciones, mensajes, deals, etc., antes de borrar).
   - Si no se puede determinar: dejar el contacto y marcarlo para revisión manual (no borrar datos).
3. **Script/one-shot documentado** en la fase de implementación, ejecutado solo con autorización explícita y contra un backup previo.

## 6. Impacto sobre deduplicación

- Hoy, un mismo cliente puede aparecer como **tres contactos**: `584263895492` (correcto), `5842638954922` (con `:device`), `1490236991` (LID). `phonesMatch` por últimos 8 dígitos **no** los empareja (sufijos distintos), y el unique index de la migración 022 solo cubre igualdad exacta de dígitos.
- Con la regla del §4, todos los caminos convergen al PN canónico antes de tocar la dedupe: `findExistingContact` y el índice único vuelven a ser suficientes. No se requiere cambiar `dedupe.ts` ni la migración 022.
- La importación histórica deja de crear el duplicado `@lid` (hoy crearía un contacto por la fila `...@lid` de `findContacts`).

## 7. Tests de regresión (Vitest, sin red ni credenciales)

Nuevos casos en los tests del adaptador/normalizador (fixtures de payloads, como los ya existentes en `evolution-adapter.test.ts`):

- `584263895492@s.whatsapp.net` → `584263895492`.
- `584263895492:2@s.whatsapp.net` → `584263895492`.
- `1490236991@lid` + `remoteJidAlt: 584263895492@s.whatsapp.net` → `584263895492`.
- `1490236991@lid` sin `remoteJidAlt` → evento omitido, **sin** contacto creado.
- Grupo `123456789-123@g.us` con `participant: 1490236991@lid` + `participantAlt` → usa el PN del participante (o se omite según se decida en la fase 1; el webhook hoy no soporta grupos como contactos, así que lo consistente es omitir).
- `status@broadcast`, `…@newsletter` → omitidos.
- `findContacts` devolviendo par PN+LID del mismo `pushName` → una sola fila importada, con el PN.
- Caso real observado: payload cuyo `remoteJid` produce `5842638954921490236991` tras saneamiento → validación E.164 rechaza la creación y loguea el `key` crudo.
- Salida: ningún test existente de `phone-utils`/`dedupe` se rompe (`npm test`, `npm run typecheck`, `npm run lint`).

## 8. Fases

- **Fase 0 — Instrumentación (diagnóstico, sin cambio de comportamiento):** log estructurado (con payload ya sanitizado) de `key.remoteJid`, `remoteJidAlt`, `participant`, `participantAlt`, `addressingMode` y del candidato final cada vez que un valor entrante no pase E.164. Objetivo: capturar el payload real del caso `Rosalys` y confirmar la clase del JID (§2.3).
- **Fase 1 — Normalización (§4):** cambios en `providers/normalize.ts` + `evolution-adapter.ts` (+ filtro de grupos en el webhook si aplica), con los tests del §7.
- **Fase 2 — Limpieza (§5):** detección y corrección de contactos afectados, solo tras autorización y con backup.

## 9. Criterios de aceptación

1. Ningún contacto se crea con un valor que no pase `isValidE164`.
2. Ningún identificador `@lid`, de grupo, broadcast o newsletter se almacena en `contacts.phone`.
3. Cuando el payload trae `remoteJidAlt`/`participantAlt`, el teléfono almacenado es el del PN alterno.
4. Los eventos sin resolución PN se omiten con log, sin efectos colaterales (sin conversación ni mensaje huérfanos).
5. La importación histórica no genera duplicados PN/LID.
6. `npm test`, `npm run typecheck` y `npm run lint` en verde.
7. Compatibilidad verificada contra los contratos de Evolution API v2.3.7 documentados ([webhooks](https://evolutionapi-evolution-api-90.mintlify.app/events/webhooks), [JIDs de Baileys](https://baileys.wiki/concepts/jids)).
