# Fallback automático de modelos para AI providers (OpenRouter)

> **Estado:** propuesta pendiente de aprobación. Esta fase no incluye código desplegado ni aplicación de migraciones: la migración nueva se entrega como archivo `.sql` para revisión y ejecución manual por separado.

**Objetivo:** Cuando el modelo configurado por el usuario falla — porque fue descontinuado (`404`), porque el provider responde con `5xx`, o porque se quedó sin cuota (`429` con reintentos agotados) — el sistema elige automáticamente el siguiente modelo disponible (whitelist configurable del usuario o, en su defecto, discovery dinámico de los modelos `:free` del provider) y reintenta sin molestar al usuario.

---

## 1. Antecedentes

- El usuario reporta que los modelos `:free` de OpenRouter cambian frecuentemente (ej: `meta-llama/llama-3-8b-instruct:free` fue discontinuado) y quiere que el CRM siga respondiendo aunque el modelo configurado desaparezca.
- Hoy `src/lib/ai/providers/openai.ts:32-78` hace una sola llamada HTTP por generación. Ante cualquier `non-2xx`, `providerHttpError` lanza inmediatamente y el error burbujea al usuario final (`generateReply` en `src/lib/ai/generate.ts:25-54`).
- No existe ninguna infraestructura de retry, discovery ni fallback en `src/lib/ai/`.
- El provider canónico para OpenRouter ya está integrado vía `provider: 'openai_compatible'` + `baseUrl: 'https://openrouter.ai/api/v1'` (ver `src/lib/ai/config.ts:32-85` y `src/components/settings/ai-config.tsx:339-356`). Esta spec NO introduce un provider nuevo ni un adapter paralelo: reusa el existente.

### Correcciones al prompt original

El prompt recibido asumía paths que no existen en el repo:

- `src/lib/ai-providers/` → **no existe**. La carpeta real es `src/lib/ai/providers/` (singular). Los archivos nuevos vivirán ahí.
- `src/lib/settings.ts` → **no existe**. La configuración AI vive en `src/lib/ai/types.ts` (`AiConfig`) y se persiste en `ai_configs` (`supabase/migrations/029_ai_reply.sql`, ampliado en `048_ai_provider_openai_compatible.sql`).
- `src/lib/ai-providers/openrouter-adapter.ts` → **no se va a crear**. Ya existe `src/lib/ai/providers/openai.ts` que sirve tanto a `openai` como a `openai_compatible` (incluido OpenRouter). Crear un adapter paralelo duplicaría la ruta HTTP.
- "Cachea resultados por 1 hora (Redis/Supabase)" → **no hay Redis en el repo** (ver `src/lib/rate-limit.ts:46`, in-process `Map`). Se cacheará en memoria con TTL de 1 h, suficiente para una instancia única (Hostinger / Railway) y trivialmente ampliable a Redis más adelante.
- "Si whitelist está vacía → llama a `fetchAvailableModels()` y construye lista dinámica" → se mantiene **dentro** del flujo de fallback, pero NO se llama en cada request: se llama una vez al primer 404 y se cachea; ver §5.4.
- "Si error es 429 → espera y reintenta con mismo modelo" → según la decisión del usuario: reintentar el mismo modelo hasta 3 veces con backoff exponencial; si los 3 fallan, cambiar al siguiente modelo `:free`.

## 2. Hallazgos confirmados en el código

- `src/lib/ai/providers/openai.ts:32-78` — adapter único. Acepta `baseUrl`, hace `${baseUrl}/chat/completions`, soporta `Authorization: Bearer`, timeout y mapeo de error genérico.
- `src/lib/ai/providers/shared.ts:60-95` — `providerHttpError` mapea:
  - `401`/`403` → `code: 'invalid_key'` (no se reintenta, no se hace fallback: la key está mal).
  - `429` → `code: 'rate_limited'` (candidato a retry).
  - otros → `code: 'provider_error'` (incluye `404` y `5xx`; candidatos a fallback).
- `src/lib/ai/validate.ts:1-18` — `validateAiCredentials` invoca `generateReply` para el botón "Test key". Debe seguir funcionando: el "Test key" debe probar el modelo configurado, no iterar la whitelist (ver §5.5).
- `src/lib/ai/generate.ts:38-51` — dispatch por provider. El path `openai_compatible` cae en `generateOpenAi`. Esa función NO debe cambiar su firma; el wrapper de retry/fallback se aplica por encima.
- `src/lib/ai/config.ts:32-85` — `loadAiConfig` lee las columnas actuales. Hay que añadir las nuevas columnas aquí y en `types.ts`.
- `supabase/migrations/048_ai_provider_openai_compatible.sql` — la migración previa añadió `provider` enum y `base_url`. Esta spec añade `fallback_models`, `auto_refresh_models`, `max_retries`.
- `src/lib/rate-limit.ts:46` — patrón de `Map` con TTL aplicable al cache de modelos. Misma idea: `Map<key, { value, expiresAt }>` con sweep oportunista.

## 3. Causa raíz del problema actual

- Sin retry ni fallback, cualquier error transitorio (rate limit, modelo caído, 5xx del provider) se devuelve al usuario como toast/banner.
- En el caso específico de OpenRouter y modelos `:free`, el modelo configurado puede dejar de existir sin aviso. El usuario descubre el problema solo cuando un cliente escribe y el bot no responde.
- `ai_configs.model` es un string libre editable (no hay allow-list), así que cualquier modelo que el usuario haya tipeado puede dejar de existir.

## 4. Alcance

### Incluye

- Migración nueva `049_ai_provider_fallback.sql` (entregada como archivo, NO aplicada) que añade:
  - `ai_configs.fallback_models text[] NOT NULL DEFAULT '{}'`
  - `ai_configs.auto_refresh_models boolean NOT NULL DEFAULT true`
  - `ai_configs.max_retries integer NOT NULL DEFAULT 3`
  - `ai_configs.models_url text` (nullable; `null` ⇒ derivar de `base_url`)
- Discovery dinámico de modelos del provider via `GET {modelsUrl ?? baseUrl}/models`. **Fuente de verdad para "gratis"**: `pricing.prompt === "0"` (no el sufijo `:free`). Cache en memoria 1 h.
- Wrapper de retry + fallback en `src/lib/ai/providers/openai.ts` (mismo archivo; sin adapter nuevo) que:
  1. Llama al modelo configurado.
  2. Si la respuesta es éxito → devuelve.
  3. Si es `401`/`403` → lanza `invalid_key` sin reintentos ni fallback (la key está mal para TODOS los modelos).
  4. Si es `429`, `5xx`, `404`, o timeout/network: reintenta el mismo modelo hasta `maxRetries` veces con backoff exponencial (1 s, 2 s, 4 s, +jitter).
  5. Si tras `maxRetries` sigue fallando, salta al siguiente modelo de la lista de fallback.
  6. Si la lista está vacía y `autoRefreshModels`, hace discovery y reordena por `context_length` desc.
  7. Si la lista descubierta está vacía y el provider es OpenRouter, usa `'openrouter/free'` (router oficial de modelos free).
  8. Si la lista se agota totalmente, lanza el último error real al usuario (con `code: 'provider_error'` o `rate_limited`).
- Lista de fallback híbrida:
  - Si `ai_configs.fallback_models` no está vacía → se usa tal cual.
  - Si está vacía y `autoRefreshModels = true` → discovery dinámico de modelos free del provider, cacheado 1 h, ordenado por context_length desc.
  - Si está vacía y `autoRefreshModels = false` → comportamiento actual (sin fallback, error al usuario).
  - Si el provider es OpenRouter y nada de lo anterior devuelve modelos → `'openrouter/free'` como último recurso.
- Nuevo endpoint público interno `GET /api/ai/models` (admin+) que ejecuta el discovery server-side y devuelve `{ models: [{ id, name, context_length, is_free }] }`. Rate-limited (5 req/min por cuenta — es interactivo, no se abuse).
- UI en `src/components/settings/ai-config.tsx`:
  - Campo **"Models URL"** debajo de **"Base URL"** cuando `provider === 'openai_compatible'`. Placeholder = `${baseUrl}/models` (derivado en vivo). Editable: si el usuario lo sobrescribe se envía tal cual en el `POST`.
  - Botón **"Update models"** al lado del campo. Llama a `GET /api/ai/models` (con el `models_url` actual o el derivado), refresca la lista en memoria, y muestra los modelos en una sección debajo.
  - Sección **"Available models"** que lista `id`, `name`, `context_length` y un badge `free` para los de `pricing.prompt === "0"`. Incluye también los routers `openrouter/free` y `openrouter/auto` para descubrirlos.
  - Click en un modelo → copia el `id` al campo **"Model"** (UX adicional, no requerida por el fix).
- Log estructurado (sin secretos) cada vez que se cambia de modelo: `{ event: 'ai.model_switch', from, to, reason }`. No hay UI nueva en este entregable; el dashboard se conectará después.
- Tests unitarios para discovery, selector y wrapper.

### No incluye

- UI nueva para editar `fallback_models` en la pantalla de AI Agents (se entrega solo el campo en DB + tipos; el form de edición queda para un PR siguiente si el usuario lo pide).
- Persistencia del modelo auto-seleccionado en `ai_configs.model` (preferible no reescribir la config del usuario silenciosamente).
- Endpoint público tipo `POST /api/ai/reload-models` (puede agregarse después).
- Webhooks salientes para notificar el cambio.
- Cambios al flujo de Anthropic (el wrapper aplica solo al path `openai_compatible`).
- Cambios al flujo de embeddings (sigue independiente).

## 5. Diseño propuesto

### 5.1 Migración `049_ai_provider_fallback.sql`

```sql
-- 049_ai_provider_fallback.sql
-- Idempotent.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS fallback_models text[] NOT NULL DEFAULT '{}';

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS auto_refresh_models boolean NOT NULL DEFAULT true;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3
    CHECK (max_retries BETWEEN 0 AND 10);

-- Optional override for the models-catalog endpoint. NULL = derive from
-- base_url (the OpenAI-compatible convention: `${baseUrl}/models`). Set
-- this when the provider exposes the catalog at a different path.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS models_url text;
```

Sin tocar RLS (las políticas actuales son por `is_account_member(account_id, 'admin')` para escritura, ya cubre las columnas nuevas).

### 5.2 `AiConfig` extendido (`src/lib/ai/types.ts`)

```ts
export interface AiConfig {
  // ...campos existentes...
  /** Whitelist opcional de modelos a probar si el configurado falla.
   *  Vacío = comportamiento discovery (si autoRefreshModels) o sin fallback. */
  fallbackModels: string[]
  /** Si true y fallbackModels está vacío, hace discovery de modelos free. */
  autoRefreshModels: boolean
  /** Reintentos por modelo antes de saltar al siguiente. Default 3, max 10. */
  maxRetries: number
  /** Override del endpoint de discovery. Null = derivar `${baseUrl}/models`. */
  modelsUrl: string | null
}
```

`src/lib/ai/config.ts:32-85` (loadAiConfig) lee las columnas nuevas con los defaults y los pasa al objeto. `src/lib/ai/config.test.ts` se amplía con un caso de "lee las cuatro columnas nuevas con defaults".

### 5.3 Nuevo `model-discovery.ts`

**Investigación verificada contra la API real de OpenRouter (2026-09-04):**

- Endpoint: **`GET https://openrouter.ai/api/v1/models`** (no requiere auth para el catálogo, pero enviaremos el Bearer por defensa y para futuro paywall).
- Headers opcionales que OpenRouter acepta: `HTTP-Referer` (app URL) y `X-Title` (app display name). **No son obligatorios** para que las llamadas funcionen; los usa OpenRouter para ranking interno. No se añaden en esta spec.
- Shape real de la respuesta:
  ```json
  {
    "data": [
      {
        "id": "inclusionai/ling-3.0-flash-sante:free",
        "canonical_slug": "inclusionai/ling-3.0-flash-sante",
        "name": "InclusionAI: Ling 3.0 Flash Sante (free)",
        "context_length": 131072,
        "pricing": { "prompt": "0", "completion": "0" },
        "architecture": { "modality": "text->text", ... },
        ...
      }
    ],
    "total_count": 431,
    "links": { "next": null }
  }
  ```
- **Criterio de "gratis"**: `pricing.prompt === "0"` (string `"0"`, no número). El sufijo `:free` en el slug **NO es fiable** como filtro:
  - De 431 modelos, **22** tienen `pricing.prompt === "0"` (free reales).
  - Solo **19** terminan en `:free`.
  - 2 modelos son free por precio sin sufijo: `google/lyria-3-pro-preview`, `google/lyria-3-clip-preview`.
  - **0** modelos tienen sufijo `:free` con precio > 0 (los sufijos `:batch`, `:thinking`, `:nitro`, `:floor` SÍ existen pero no cuentan como free).
- OpenRouter publica un router oficial para esto: **`openrouter/free`** (`pricing: {prompt: "0", completion: "0"}`). Este router rutea automáticamente entre los modelos free disponibles y es la mejor opción como "último fallback" cuando no queremos enumerar.

**Archivo:** `src/lib/ai/providers/model-discovery.ts`

```ts
export interface DiscoveredModel {
  id: string
  name: string | null
  contextLength: number | null
  isFree: boolean
  isRouter: boolean   // openrouter/free, openrouter/auto
}

export interface DiscoveryResult {
  models: DiscoveredModel[]
  fetchedAt: number     // ms epoch
  endpoint: string        // el URL final que se usó (para debugging)
}

/**
 * Lista los modelos disponibles en el provider. El `modelsUrl` permite
 * override por config; si es null/vacío se deriva `${baseUrl}/models`
 * (convención OpenAI-compatible).
 */
export async function fetchAvailableModels(args: {
  baseUrl: string
  apiKey: string
  modelsUrl?: string | null
}): Promise<DiscoveryResult>
```

Implementación:
- Resuelve `endpoint = (args.modelsUrl && args.modelsUrl.trim()) || `${args.baseUrl.replace(/\/$/, '')}/models``.
- Llama `GET endpoint` con `Authorization: Bearer <key>` y `Accept: application/json`.
- Parsea `{ data: Model[], ... }` (no un array plano).
- Por cada item construye `DiscoveredModel`:
  - `id = item.id` (string).
  - `name = item.name ?? null`.
  - `contextLength = item.context_length ?? null`.
  - `isFree = item.pricing?.prompt === "0"` (string comparison).
  - `isRouter = item.id === 'openrouter/free' || item.id === 'openrouter/auto'`.
- Devuelve la lista **completa** (todos los modelos, no solo los free). El filtrado por `isFree` lo hace el caller.
- Cache en memoria: `Map<string, { result, expiresAt }>` con TTL de 60 min, keyed por `endpoint` (no por apiKey, para no tener fugas entre cuentas si dos cuentas usan el mismo provider).
- Si la respuesta no es 2xx, el body no es JSON, o `data` no es un array, lanza `AiError({ code: 'openrouter_discovery_failed', status: 502 })`.
- El cache se invalida al pasar 60 min; la siguiente llamada refetch.
- Si el catálogo devuelve **0 modelos**, `fetchAvailableModels` devuelve `{ models: [], ... }` (sin error).

`model-selector.ts` (§5.4) usa `fetchAvailableModels` y filtra `m.isFree && !m.isRouter` para construir su lista de fallback.

### 5.4 Nuevo `model-selector.ts`

**Archivo:** `src/lib/ai/providers/model-selector.ts`

```ts
export interface ModelSelectorOptions {
  primary: string
  whitelist: string[]               // puede estar vacío
  autoRefresh: boolean
  maxRetries: number
}

export interface SwitchReason {
  /** HTTP status que disparó el switch, o 'network' | 'timeout'. */
  kind: 'http_status' | 'network' | 'timeout' | 'unknown_model'
  status?: number
  message?: string
}

export class ModelSelector {
  constructor(opts: ModelSelectorOptions)
  /** Devuelve el modelo que se debe probar a continuación, o null si se agotaron. */
  async nextModel(reason: SwitchReason): Promise<string | null>
  /** Para tests: cuántos modelos lleva probados en esta cadena. */
  attempts(): number
}
```

Reglas:

1. La primera invocación devuelve `primary`.
2. Si la llamada falla con un `reason` no-recuperable (`invalid_key` por `401/403`), `nextModel` devuelve `null` inmediatamente.
3. Si falla con motivo recuperable (`429`, `5xx`, `404`, network, timeout), `nextModel` devuelve:
   - El siguiente elemento de `whitelist` si existe.
   - Si `whitelist` está vacío y `autoRefresh`: llama a `fetchAvailableModels({ baseUrl, apiKey, modelsUrl })`, filtra `m.isFree && !m.isRouter`, ordena por `contextLength` desc, devuelve el primero.
   - Si la lista descubierta está vacía y `args.baseUrl` apunta a OpenRouter (`https://openrouter.ai/api/v1` o `/api`): devuelve `'openrouter/free'` (router oficial de OpenRouter para modelos free).
   - Si nada: devuelve `null`.
4. `attempts()` cuenta las llamadas a `nextModel`; se usa para que el caller sepa cuándo parar (ver §5.5).

### 5.5 Wrapper de retry + fallback

**Archivo:** `src/lib/ai/providers/openai.ts` (modificación)

- Renombrar la función interna actual a `generateOpenAiOnce(args, model)` para que reciba el modelo como parámetro (antes lo leía de `args.model`).
- Añadir `generateOpenAiWithFallback(args)` que:
  1. Construye `ModelSelector` con `primary = args.model`, `whitelist = (config?.fallbackModels ?? [])`, `autoRefresh = config?.autoRefreshModels ?? true`, `maxRetries = config?.maxRetries ?? 3`.
  2. Bucle:
     - `model = selector.nextModel(reason)` (la primera vez devuelve `primary`).
     - Llama `generateOpenAiOnce({...args, model})`.
     - Si éxito → devuelve.
     - Si error con `code: 'invalid_key'` → aborta y re-lanza (no fallback).
     - Si error recuperable → `selector.attempts()` cuenta. Si supera `maxRetries` * (1 + whitelist.length + 1), lanza el error.
     - Si `model === null` (lista agotada) → lanza el último error.
  3. Backoff entre reintentos del MISMO modelo: 1000, 2000, 4000 ms con jitter ±25%. Solo se reintenta con `AbortSignal.timeout` si quedó tiempo (no se excede `timeoutMs` original del caller).
- `generateReply` en `src/lib/ai/generate.ts:38-44` sigue llamando `generateOpenAi` — esa función ahora es el wrapper. La API pública no cambia.
- `validateAiCredentials` (`src/lib/ai/validate.ts:12-18`) sigue invocando `generateReply` con la config real. Esto significa que "Test key" SÍ prueba el fallback: si el modelo primario está caído, probará los siguientes. **Decisión explícita**: el usuario quiere saber si su config funciona end-to-end, no solo si la key es válida.

### 5.6 Logging

Cada vez que el selector salta de modelo, loggear:

```ts
console.warn('[ai] model switched', {
  from: previous,
  to: next,
  reason: 'http_status_404', // o el kind correspondiente
  status: 404,
  accountId, // para correlación, sin secretos
})
```

Sin secretos. Sin bodies. Solo metadatos.

### 5.7 Endpoint `GET /api/ai/models` (admin+)

**Archivo:** `src/app/api/ai/models/route.ts`

Server-side: descifra la `api_key` del account, llama a `fetchAvailableModels({ baseUrl, apiKey, modelsUrl })` con el `modelsUrl` y `baseUrl` guardados en DB, devuelve el resultado al cliente.

- **Auth**: `requireRole('admin')` (igual que `POST /api/ai/config`).
- **Rate limit**: 5 req/min por account (key: `ai-models-discovery:${accountId}`). Necesita entrada nueva en `RATE_LIMITS` (`adminAction` es muy generoso: 30/min — queremos proteger el provider del usuario).
- **Body de respuesta** (envelope estándar `{ data, error? }`):
  ```ts
  {
    data: {
      endpoint: string,             // el URL final usado (post-override)
      fetchedAt: number,            // ms epoch
      models: DiscoveredModel[]     // completo, no filtrado por free
    }
  }
  ```
- Si `loadAiConfig` devuelve `null` (no configurado) → `errorCode('ai_not_configured', 400)`.
- Si la key no se puede descifrar → `errorCode('ai_key_unavailable', 500)`.
- Si el provider devuelve un error HTTP (ej. 401) → propaga como `errorCode('ai_models_discovery_failed', 502, { message })`.

El handler **NUNCA** envía la `api_key` al cliente. Solo metadatos del catálogo.

### 5.8 UI — campos y botón en `ai-config.tsx`

**Archivo:** `src/components/settings/ai-config.tsx`

Cuando `provider === 'openai_compatible'`:

```
[ Base URL             ]   ← ya existe
[ Models URL           ]   ← NUEVO, debajo de Base URL
[ Update models  ⟳ ]       ← NUEVO botón al lado del input

─── Available models ───────
🔄 Showing 22 free models   (o "Showing N models, X free")
ID                            CONTEXT       STATUS
google/gemma-4-31b-it:free   131k          free
nvidia/nemotron-3-...         120k          free
…
openrouter/free               2M            router
openrouter/auto               2M            router
```

**Comportamiento:**

1. **Models URL**: placeholder en vivo derivado de `baseUrl` (`${baseUrl}/models`). El usuario puede sobrescribirlo. Si lo sobrescribe y guarda, el `POST /api/ai/config` persiste el valor en `ai_configs.models_url`. Si lo deja igual al derivado, se envía `undefined` y la columna queda `null`.

2. **Update models**: llama `GET /api/ai/models` con el `modelsUrl` actual (el del form, no el derivado, para que un override tome efecto inmediato antes de guardar). Muestra spinner mientras carga. Al éxito: renderiza la lista. Al error: toast con `tError(code)`.

3. **Available models**: lista renderizada debajo del campo. Cada fila muestra `id`, `context_length` formateado (`131k`, `2M`), y un badge:
   - `free` (verde) si `isFree === true`.
   - `router` (gris) si `isRouter === true`.
   - Sin badge si es un modelo de pago.
   Click en una fila → copia `id` al input **Model**.

4. **Persistencia**: el botón "Save" ya existente persiste `models_url` junto con el resto. Si el campo está vacío o es igual al derivado, se envía `undefined` para que la columna quede `null`.

**Estado local nuevo**:
- `modelsUrl: string` (carga inicial: `data.models_url ?? ''`).
- `modelsUrlEdited: boolean` (true si el usuario tocó el campo).
- `availableModels: DiscoveredModel[] | null` (último fetch).
- `endpoint: string | null` (URL final usado en el último fetch).
- `fetchedAt: number | null`.
- `discoveryLoading: boolean`.
- `discoveryError: string | null`.

**i18n**: añadir las keys nuevas a `messages/en.json`, `messages/es.json`, `messages/ko.json`:
- `Settings.aiConfig.modelsUrl` ("Models URL")
- `Settings.aiConfig.modelsUrlDesc` ("Endpoint used to list available models. Defaults to <baseUrl>/models. Override only if your provider exposes the catalog at a different path.")
- `Settings.aiConfig.updateModels` ("Update models")
- `Settings.aiConfig.availableModels` ("Available models")
- `Settings.aiConfig.noModelsYet` ("Click Update models to fetch the list.")
- `Settings.aiConfig.modelsFetchError` ("Failed to fetch the model list. Check the Models URL and your API key.")

**Validación**: el campo `modelsUrl` se valida igual que `base_url` (http/https, no vacío si está presente) en `POST /api/ai/config`. Si se omite o es vacío tras trim, se persiste `null`.

## 6. Archivos a crear / modificar

### Crear

- `supabase/migrations/049_ai_provider_fallback.sql`
- `src/lib/ai/providers/model-discovery.ts`
- `src/lib/ai/providers/model-discovery.test.ts`
- `src/lib/ai/providers/model-selector.ts`
- `src/lib/ai/providers/model-selector.test.ts`
- `src/app/api/ai/models/route.ts`
- `src/app/api/ai/models/route.test.ts`

### Modificar

- `src/lib/ai/types.ts` — añadir `fallbackModels`, `autoRefreshModels`, `maxRetries`, `modelsUrl` a `AiConfig`.
- `src/lib/ai/config.ts` — leer las nuevas columnas en `loadAiConfig`.
- `src/lib/ai/config.test.ts` — caso para defaults (incluye `modelsUrl`).
- `src/lib/ai/providers/openai.ts` — extraer `generateOpenAiOnce(args, model)`; añadir `generateOpenAiWithFallback(args)`; exportar este último como `generateOpenAi` (sin cambio de nombre) para mantener compatibilidad con `generate.ts`.
- `src/lib/ai/generate.ts` — pasar `config.fallbackModels`, `autoRefreshModels`, `maxRetries`, `config.baseUrl` al wrapper.
- `src/lib/ai/generate.test.ts` — casos para fallback (404 → siguiente modelo), rate limit con reintentos, y "modelos agotados → lanza último error".
- `src/lib/rate-limit.ts` — añadir `RATE_LITS.aiModelsDiscovery` (5 req/min por account) si no existe un slot similar.
- `src/app/api/ai/config/route.ts` — leer y persistir `models_url` (con la misma validación http/https que `base_url`).
- `src/components/settings/ai-config.tsx` — campo `Models URL`, botón `Update models`, sección `Available models`. Estado local nuevo (§5.8).
- `src/lib/i18n/messages.test.ts` — no debería romperse (las nuevas keys se añaden a los tres locales en el mismo cambio).
- `messages/en.json`, `messages/es.json`, `messages/ko.json` — nuevas keys de §5.8.

### Documentación

- `.hermes/plans/2026-09-04_2200-ai-model-fallback.md` ← este archivo.
- Actualizar `.hermes/plans/2026-09-04_1100-inbox-realtime-resilience.md` solo si hay solapamiento (no lo hay).

## 7. Pruebas obligatorias

### `model-discovery.test.ts`

- Llama al endpoint, parsea `{ data: [...] }`, devuelve la lista **completa** mapeada a `DiscoveredModel[]` (no filtra).
- `modelsUrl` ausente ⇒ usa `${baseUrl}/models` derivado.
- `modelsUrl` presente y distinto ⇒ se usa tal cual (no se concatena a `baseUrl`).
- `isFree === true` cuando `pricing.prompt === "0"`.
- `isRouter === true` para `openrouter/free` y `openrouter/auto`.
- Cache: la segunda llamada en menos de 60 min NO vuelve a fetchear (el spy de fetch se llama una sola vez).
- Cache keyed por endpoint: `modelsUrl` distinto ⇒ segunda cache key, segunda llamada fetch.
- Cache: tras `vi.advanceTimersByTime(3_600_000)`, vuelve a fetchear.
- 401 del provider → lanza `AiError({ code: 'provider_error', status: 502 })`.
- 500 del provider → idem.
- Body inválido (no JSON) → lanza el mismo error.
- Body con `{ data: "no array" }` → lanza el mismo error.
- Si el catálogo está vacío, devuelve `{ models: [], ... }` (sin error).
- Mock: `fetch` responde con un JSON que incluye 22 modelos (20 free, 2 routers); el resultado tiene 22 items con flags correctos.

### `model-selector.test.ts`

- `nextModel` la primera vez devuelve `primary`.
- Tras `SwitchReason { kind: 'http_status', status: 404 }`, devuelve `whitelist[0]`.
- Tras agotar la whitelist con `autoRefresh: false`, devuelve `null`.
- Tras agotar la whitelist con `autoRefresh: true` y discovery exitoso con 3 modelos free (context 100k, 50k, 30k), devuelve el de 100k.
- Tras discovery exitoso pero lista vacía, con `baseUrl: 'https://openrouter.ai/api/v1'`, devuelve `'openrouter/free'`.
- Tras discovery exitoso pero lista vacía, con `baseUrl: 'http://localhost:11434/v1'` (Ollama), devuelve `null` (no es OpenRouter).
- `SwitchReason { kind: 'http_status', status: 401 }` → `null` inmediato, sin llamar a discovery.
- `attempts()` refleja el número de llamadas.
- El selector pasa `modelsUrl` (si lo tiene) a `fetchAvailableModels`.

### `generate.test.ts` (nuevos casos)

- Mock: primer modelo retorna 404, segundo retorna 200 → respuesta del segundo modelo.
- Mock: primer modelo retorna 429 tres veces, segundo retorna 200 → respuesta del segundo (verifica reintentos del mismo).
- Mock: todos los modelos retornan 404 → lanza `AiError` con `code: 'provider_error'` después de agotar.
- Mock: 401 en el primer modelo → lanza `invalid_key` inmediatamente, sin reintentos.
- Backoff: usa `vi.useFakeTimers()` y comprueba que entre reintentos del mismo modelo se llama a `setTimeout` con 1000, 2000, 4000 ms (+/- jitter ±25%).
- Sin red (fetch rejects con `TimeoutError`): un timeout cuenta como motivo recuperable y se reintenta.
- Latencia total: el reintento respeta el `timeoutMs` original (no se excede).
- Pasa `modelsUrl` al discovery cuando la whitelist está vacía.

### `src/app/api/ai/models/route.test.ts` (nuevo)

- GET sin auth → 401.
- GET con member (no admin) → 403.
- GET cuando no hay `ai_configs` row → `errorCode('ai_not_configured', 400)`.
- GET cuando el provider devuelve 401 → `errorCode('ai_models_discovery_failed', 502)`.
- GET con provider OK → `{ data: { endpoint, fetchedAt, models: [...] } }` con `endpoint` = `models_url ?? baseUrl + '/models'`.
- GET usa el `models_url` persistido, no el derivado (override tiene prioridad).
- Rate limit: 6 requests en 1 min → la 6ª devuelve 429.
- La respuesta **nunca** incluye `api_key`.

### UI — `ai-config.tsx` (sin tests automatizados nuevos, validación manual)

- Cargar la pantalla con un account configurado para OpenRouter ⇒ aparece el campo Models URL con placeholder `${baseUrl}/models`.
- Click en Update models sin Base URL configurada para openai_compatible ⇒ el botón está deshabilitado o muestra error claro.
- Click en Update models con Base URL correcta ⇒ aparece la lista con badges `free`/`router`.
- Sobrescribir Models URL con un valor inválido (ej. `not-a-url`) y guardar ⇒ el POST falla con `base_url_invalid` o equivalente.
- Sobrescribir Models URL y guardar ⇒ al recargar la pantalla, el campo viene con el valor persistido.

## 8. Criterios de aceptación

- Un modelo free configurado que devuelva 404 ya no rompe la generación: el sistema prueba el siguiente y devuelve respuesta.
- Un `429` se reintenta hasta 3 veces antes de saltar al siguiente modelo.
- Un `401`/`403` falla rápido sin reintentos (la key está mal para todos los modelos).
- Si la whitelist está vacía y `autoRefresh = true`, el primer 404 dispara discovery dinámico.
- Si la whitelist está vacía y `autoRefresh = false`, comportamiento actual (sin fallback).
- Si el `models_url` está configurado se usa tal cual; si está vacío se deriva de `base_url`.
- El usuario puede sobrescribir el `models_url` desde la UI y el valor persiste en `ai_configs.models_url`.
- Click en "Update models" refresca la lista visible y la cachea en memoria 1 h.
- La UI muestra badges `free` / `router` según el flag `isFree` / `isRouter`.
- La respuesta de `GET /api/ai/models` nunca incluye `api_key`.
- Ningún secret aparece en logs.
- `npm run typecheck`, `npm run lint` y `npm test` pasan; los warnings existentes se reportan por separado.
- La migración `049_ai_provider_fallback.sql` se entrega como archivo pero **no se aplica**. El usuario la revisa y la aplica por separado.

## 9. Riesgos y decisiones pendientes

1. **Backoff con jitter**: el jitter ±25% puede no ser suficiente para entornos con concurrencia. Documentar que si dos instancias golpean el rate limit al mismo tiempo, ambas esperarán aproximadamente lo mismo. Si en producción vemos amplificación del 429, ajustar el jitter.
2. **Discovery en fallback path**: hacer una llamada HTTP extra en el camino de fallo añade latencia. Se cachea 1 h, pero la primera vez que un usuario ve un 404, su respuesta tarda `~retry timeouts + discovery + retry again`. Es aceptable para el problema que estamos resolviendo (cero disponibilidad vs. respuesta lenta).
3. **Persistencia del modelo auto-seleccionado**: si el modelo A falla 5 veces seguidas hoy, el sistema prueba B, C, D... pero mañana vuelve a probar A. Si A sigue caído, gasta timeouts antes de llegar a B. Decisión propuesta: NO reescribir `ai_configs.model` automáticamente. Si en producción vemos patrón claro de modelo muerto, añadir un flag `autoPruneDeadModels` en una spec futura.
4. **Compatibilidad hacia atrás**: cuentas existentes tienen `fallback_models = '{}'`, `auto_refresh_models = true`, `max_retries = 3`, `models_url = NULL`. El wrapper aplica los defaults automáticamente. Sin acción manual del usuario.
5. **Migración**: por política del repo, **no se aplica**. Se entrega como archivo `.sql` idempotente para revisión.
6. **`HTTP-Referer` / `X-Title`**: OpenRouter los usa para ranking. No son obligatorios. **No se añaden en esta spec** para mantener el alcance; se pueden añadir en una spec futura dedicada a "OpenRouter hardening".
7. **Rate limit del endpoint de discovery**: 5 req/min por account. Suficiente para uso interactivo. Si vemos abuso, endurecer.
8. **`models_url` sin sanitización de path**: el campo es texto libre. Si el usuario pone una URL maliciosa, el servidor hace fetch a ella. Aceptable porque es admin-only y el admin ya controla la cuenta. Si en producción queremos endurecer, validar contra `^https?://` (igual que `base_url`).
9. **UI sin tests automatizados**: la pantalla de AI Agents es client-component con muchos efectos; añadir tests de React requeriría `@testing-library/react` (no está en el repo). Se valida manualmente contra la cuenta del usuario.

## 10. Orden de implementación posterior a la aprobación

1. Tests rojos en `model-discovery.test.ts`, `model-selector.test.ts`, los nuevos casos de `generate.test.ts`, y `api/ai/models/route.test.ts`.
2. Crear `model-discovery.ts` y `model-selector.ts`.
3. Crear `app/api/ai/models/route.ts`.
4. Modificar `openai.ts` (extraer `Once`, añadir `WithFallback`).
5. Modificar `types.ts`, `config.ts`, `generate.ts`, `app/api/ai/config/route.ts`.
6. Crear la migración `049_ai_provider_fallback.sql`.
7. Modificar `ai-config.tsx` (campo, botón, lista) + `messages/*.json` (i18n).
8. Añadir `RATE_LITS.aiModelsDiscovery` en `rate-limit.ts`.
9. Correr suite completa, typecheck, lint.
10. Validación manual contra la cuenta OpenRouter del usuario (un modelo que devuelva 404 + uno bueno, override del `models_url`, refresh).
11. Commit único, push separado. La migración queda como archivo sin aplicar.