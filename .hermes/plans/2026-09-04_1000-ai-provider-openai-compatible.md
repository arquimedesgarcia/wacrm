# AI Provider OpenAI-Compatible (OpenRouter) — Especificación

> **Estado:** propuesta, lista para implementar.

## Objetivo

Agregar soporte para proveedores OpenAI-compatible (OpenRouter, Ollama local, etc.) al sistema de IA de waCRM, permitiendo usar modelos gratuitos durante el desarrollo sin tocar la lógica de auto-reply, knowledge base ni handoff.

## Contexto

El sistema actual soporta solo `openai` y `anthropic` como providers (enum cerrado en `types.ts`). Los endpoints de chat están hardcodeados a `api.openai.com` y `api.anthropic.com`. Para desarrollo se necesita apuntar a OpenRouter (`https://openrouter.ai/api/v1`) con modelos gratuitos como `meta-llama/llama-3.3-8b-instruct:free`.

## Cambios requeridos

### 1. Migración SQL (048_ai_provider_openai_compatible.sql)

- Ampliar el CHECK constraint de `ai_configs.provider` de `'openai' | 'anthropic'` a `'openai' | 'anthropic' | 'openai_compatible'`.
- Agregar columna `base_url text` (nullable) — URL del endpoint OpenAI-compatible. Cuando `provider = 'openai_compatible'` es obligatoria; para `openai`/`anthropic` se ignora.
- Idempotent: `ADD COLUMN IF NOT EXISTS` + `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`.

### 2. `src/lib/ai/types.ts`

- Agregar `'openai_compatible'` al union type `AiProvider`.
- Agregar `baseUrl: string | null` al interface `AiConfig`.

### 3. `src/lib/ai/defaults.ts`

- Agregar entrada en `AI_PROVIDER_DEFAULT_MODEL` para `openai_compatible`: `'meta-llama/llama-3.3-8b-instruct:free'`.
- Nueva función `aiBaseUrl(config: AiConfig): string`:
  - Si `provider === 'openai_compatible'` → retorna `config.baseUrl ?? 'https://openrouter.ai/api/v1'`
  - Si `provider === 'openai'` → `'https://api.openai.com/v1'`
  - Si `provider === 'anthropic'` → `'https://api.anthropic.com'` (no se usa aquí, Anthropic tiene su propio adapter)

### 4. `src/lib/ai/providers/shared.ts`

- Agregar `baseUrl?: string` al interface `ProviderArgs`.

### 5. `src/lib/ai/providers/openai.ts`

- Cuando se proporciona `baseUrl`, usarlo en vez de `OPENAI_URL`:
  ```ts
  const url = args.baseUrl
    ? `${args.baseUrl.replace(/\/$/, '')}/chat/completions`
    : OPENAI_URL
  ```
- El resto del adapter (headers, parsing) se mantiene igual — la API de OpenRouter es 100% compatible.

### 6. `src/lib/ai/config.ts`

- Agregar `base_url` al `CONFIG_COLUMNS`.
- Mapear `row.base_url` → `config.baseUrl` en el return de `loadAiConfig`.

### 7. `src/app/api/ai/config/route.ts`

- Leer `base_url` del body (string opcional).
- Validación: cuando `provider === 'openai_compatible'`, `base_url` es requerido y debe ser una URL válida.
- Guardar `base_url` en la DB (plaintext — no es un secreto).

### 8. `src/lib/ai/generate.ts`

- Pasar `baseUrl: config.baseUrl` dentro de `providerArgs`.

### 9. Tests

- `generate.test.ts`: agregar test para `openai_compatible` que verifique que usa la URL personalizada.
- `config.test.ts`: agregar test que verifique que `baseUrl` se lee de la DB.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/048_ai_provider_openai_compatible.sql` | Nuevo — migración |
| `src/lib/ai/types.ts` | Extender enum + interface |
| `src/lib/ai/defaults.ts` | Default model + helper URL |
| `src/lib/ai/providers/shared.ts` | Agregar `baseUrl` a ProviderArgs |
| `src/lib/ai/providers/openai.ts` | Usar URL personalizada |
| `src/lib/ai/config.ts` | Leer `base_url` de DB |
| `src/app/api/ai/config/route.ts` | Accept/save `base_url` |
| `src/lib/ai/generate.ts` | Pass `baseUrl` al adapter |
| `src/lib/ai/generate.test.ts` | Test openai_compatible |
| `src/lib/ai/config.test.ts` | Test baseUrl read |

## Criterios de aceptación

- `npm run typecheck` → 0 errores.
- `npm run lint` → 0 errores nuevos.
- `npm test` → todos los tests pasan (incluyendo los nuevos).
- Un provider `openai_compatible` con `base_url: https://openrouter.ai/api/v1` y model `meta-llama/llama-3.3-8b-instruct:free` genera respuestas correctamente.
- `openai` y `anthropic` siguen funcionando exactamente igual (sin regressión).
- La migración es idempotente y segura para producción.

## Modelos gratuitos recomendados para OpenRouter

| Modelo | Límite diario | Notas |
|---|---|---|
| `meta-llama/llama-3.3-8b-instruct:free` | ~80K tokens | Buen equilibrio calidad/coste |
| `mistralai/mistral-7b-instruct:free` | ~reqs ilimitadas | Más rápido, menos capaz |
| `google/gemini-2.0-flash:free` | ~30K tokens | Multimodal |
| `meta-llama/llama-4-scout:free` | ~21K tokens | Más reciente |

## Nota sobre embeddings

La base de conocimientos usa embeddings de OpenAI (`text-embedding-3-small`). OpenRouter no ofrece endpoint de embeddings. Cuando no hay `embeddings_api_key`, la KB degrada gracefulmente a búsqueda lexical (FTS) — esto ya está implementado en `knowledge.ts`. No se requiere cambio adicional para embeddings en esta fase.

## Orden de implementación

1. Migración SQL.
2. Types + defaults.
3. ProviderArgs + OpenAI adapter.
4. Config loader + API route.
5. generate.ts.
6. Tests.
7. Typecheck + lint + tests completos.
