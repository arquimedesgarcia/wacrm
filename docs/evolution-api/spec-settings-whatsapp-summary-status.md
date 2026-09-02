# Especificación: estado de WhatsApp en el resumen de Configuración (provider Evolution)

## Problema

En la página general de Configuración (`/settings`, sección "Overview"), el tile de
WhatsApp siempre muestra **"Aún no configurado"** aunque la cuenta tenga Evolution API
configurado y la instancia conectada.

## Causa comprobada

`src/components/settings/settings-overview.tsx` (líneas ~120-137) determina el estado
con dos heurísticas exclusivas de Meta:

1. **Detección de "configurado" basada solo en `phone_number_id`:**

   ```ts
   supabase.from('whatsapp_config').select('phone_number_id').eq('account_id', acctId)
   // ...
   configured: !!row.value.data?.phone_number_id
   ```

   La fila de Evolution **siempre guarda `phone_number_id = null`**
   (`src/app/api/whatsapp/evolution/config/route.ts`, `baseRow` en POST:
   `phone_number_id: null`, `access_token: null`, `waba_id: null`, `verify_token: null`).
   Por tanto `configured` es siempre `false` para cuentas Evolution → el tile renderiza
   `t('notSetup')` ("Aún no configurado"). No se consulta el campo `provider` ni los
   campos Evolution (`evolution_base_url`, `evolution_instance_name`).

2. **Health check siempre contra el endpoint de Meta:**

   ```ts
   fetch('/api/whatsapp/config', { cache: 'no-store' })
   ```

   Nunca se llama a `/api/whatsapp/evolution/config` (el endpoint que existe precisamente
   para consultar el estado real de la instancia Evolution, verificado en vivo con
   `EvolutionAdapter.getConnectionStatus`). El endpoint Meta solo entiende credenciales
   Meta; para una fila Evolution devuelve `connected: false`, lo que además provocaría
   que aunque `configured` se arreglara, el tile mostraría "Necesita reconexión" en
   lugar de "Conectado".

### Qué NO es la causa (verificado)

- No busca por `user_id`: la consulta ya usa `account_id` correctamente.
- No es un problema de nombres de campos antiguos en la consulta de Supabase.
- No es caché/sincronización: el fetch usa `cache: 'no-store'` y la fila existe con
  `provider = 'evolution'` guardada por `POST /api/whatsapp/evolution/config`.
- El panel de detalle (`whatsapp-config.tsx`) sí está bien: lee `provider`, consulta
  `/api/whatsapp/evolution/config` cuando corresponde y muestra el estado real. El
  fallo es solo del resumen (overview).

## Archivos afectados

| Archivo | Rol |
| --- | --- |
| `src/components/settings/settings-overview.tsx` | Único archivo con el defecto: lógica de `configured`/`connected` del tile WhatsApp. |
| `messages/{es,en,ko}.json` | Posibles claves nuevas de i18n para el subtítulo (p. ej. "Evolution — Conectado"). A confirmar en implementación. |

Archivos de referencia (sin cambios): `whatsapp-config.tsx`,
`src/app/api/whatsapp/evolution/config/route.ts` (GET devuelve
`{ connected, reason, message, instance_name, base_url, webhook_url }`),
`src/types/index.ts` (interface `WhatsAppConfig`).

## Flujo actual (defectuoso)

1. Overview monta → efecto con `user.id` + `accountId`.
2. `Promise.allSettled`:
   a. `SELECT phone_number_id FROM whatsapp_config WHERE account_id = ?` → fila
      Evolution devuelve `phone_number_id: null`.
   b. `GET /api/whatsapp/config` (Meta) → para fila Evolution, `connected: false`.
3. `configured = !!null → false` → tile muestra "Aún no configurado" siempre.

## Contrato de datos esperado

Fila `whatsapp_config` (una por cuenta, `UNIQUE(account_id)`):

- Provider Meta: `provider = 'meta'`, `phone_number_id` NOT NULL, token cifrado,
  `registered_at` opcional.
- Provider Evolution: `provider = 'evolution'`, `phone_number_id = NULL`,
  `evolution_base_url` / `evolution_instance_name` NOT NULL,
  `evolution_api_key` / `evolution_webhook_secret` cifrados, `status` en
  `connected | disconnected` (último estado conocido, puede estar desfasado).

Health endpoints (ambos autenticados por sesión, sin secretos en la respuesta):

- `GET /api/whatsapp/config` → `{ connected, reason?, message?, needs_reset?, phone_info? }` (Meta).
- `GET /api/whatsapp/evolution/config` → `{ connected, reason?, message?, instance_name, base_url, webhook_url }` (Evolution, verifica en vivo).

## Comportamiento correcto

El overview debe distinguir tres estados (aplicables a ambos providers):

1. **Sin configuración guardada** → no existe fila para `account_id` → "Aún no configurado".
2. **Configuración guardada + conectada** → health check del provider activo devuelve
   `connected: true` → punto verde + "Conectado".
3. **Configuración guardada + no conectada** → health check `connected: false` →
   "Necesita reconexión".

Reglas por provider:

- **Meta**: `configured` se infiere de `phone_number_id` presente (estado actual, válido).
  Health: `GET /api/whatsapp/config`.
- **Evolution**: `configured` se infiere de `provider = 'evolution'` con
  `evolution_instance_name` (o `evolution_base_url`) presente — **nunca** de
  `phone_number_id`. Health: `GET /api/whatsapp/evolution/config`.
- La elección del health endpoint deriva del campo `provider` leído de la fila, no de
  suposiciones. Si `provider` es NULL (fila legada pre-migración 040), tratar como `meta`.

## Estrategia de actualización (mínima, sin cambios de backend)

En `settings-overview.tsx`, efecto de WhatsApp:

1. Seleccionar `provider, phone_number_id, evolution_instance_name, evolution_base_url`
   en lugar de solo `phone_number_id`.
2. Calcular `isEvolution = row.provider === 'evolution'`.
3. `configured = isEvolution ? !!(evolution_instance_name || evolution_base_url)
   : !!phone_number_id`.
4. Llamar al health endpoint según `isEvolution`
   (`/api/whatsapp/evolution/config` vs `/api/whatsapp/config`); mantener ambas
   llamadas en el `Promise.allSettled` existente (la segunda solo cuando aplica).
5. Opcional (UX): en el subtítulo conectado, mostrar el provider
   (p. ej. "Evolution — Conectado") para que sea consistente con la tarjeta de
   `whatsapp-config.tsx`. Requiere clave i18n nueva; si se descarta, mantener el
   texto actual.

No requiere migraciones SQL, ni cambios en rutas API, ni en Supabase/Railway.

## Tests

- Existe `src/**/*.test.ts(x)` con Vitest (Node). El componente overview no tiene test
  actual; el proyecto no usa Testing Library en el árbol inspeccionado, por lo que:
  - **Opción A (mínima)**: extraer la lógica de derivación de estado
    (`deriveWhatsappSummary(row, health)`) a una función pura en
    `src/lib/settings/whatsapp-summary.ts` y testearla con casos:
    fila Evolution conectada → configured+connected; fila Evolution desconectada →
    configured, not connected; sin fila → no configurado; fila Meta con/sin
    `phone_number_id`; `provider` NULL → ruta Meta.
  - **Opción B**: si ya hay infraestructura de render de componentes, test de
    `SettingsOverview` mockeando `createClient` y `fetch`.
- Ejecutar `npm run typecheck`, `npm run lint`, `npm test`.

## Criterios de aceptación

1. Cuenta con Evolution configurada y conectada: el tile muestra "Conectado" (punto
   verde), no "Aún no configurado".
2. Cuenta con Evolution configurada pero instancia caída: muestra "Necesita
   reconexión", no "Aún no configurado".
3. Cuenta Meta conectada: comportamiento idéntico al actual (sin regresión).
4. Cuenta sin fila en `whatsapp_config`: muestra "Aún no configurado".
5. `npm run typecheck`, `npm run lint` y `npm test` en verde.
6. Sin cambios de schema, sin secretos expuestos, sin claves hardcodeadas.
