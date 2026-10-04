# Pizzería La Vecchia — Base de datos de simulación

## Arquitectura de la base de datos

### Esquema INDEPENDIENTE (migraciones 050 + 051)

Las tablas `pizzeria_*` son **completamente independientes** de las tablas de waCRM. No dependen de `contacts`, `conversations`, `messages` ni `tags`. Esto permite migrar fácilmente a otro motor de comunicaciones en el futuro.

```
pizzeria_pizzas     → menú de pizzas (sku, precios, ingredients, image_url)
pizzeria_sizes      → tamaños con recargo (size_key, price_modifier, diameter_cm)
pizzeria_clients    → clientes de muestra (phone, name, preference, orders_total)
pizzeria_waiters    → meseros para round-robin (waiter_key, name, phone)
pizzeria_orders     → pedidos de simulación (status, assigned_waiter, timestamps)
```

**Todas las tablas tienen `account_id`** como FK a `accounts(id)`, por lo que funcionan con el sistema multi-tenant de waCRM. Si mañana migras a otro motor, basta con re-mapear `account_id` → `tenant_id` y migrar estas 5 tablas. Los teléfonos usan el rango ficticio `+58105550xxx` (estilo 555-01xx) para que jamás colisionen con números reales.

### Esquema de SIMULACIÓN en waCRM (migración 051, partes B y C)

Para probar flows, la bandeja de entrada y la IA, el seed también inserta:

```
contacts           → 5 contactos (teléfonos de los clientes)
conversations      → 3 conversaciones abiertas (María, Ana, Patricia)
messages           → mensajes simulados (bot, customer, agent)
pizzeria_orders    → 2 pedidos enlazados a esas conversaciones
```

## Cómo aplicar los datos de simulación

### Opción A — Script para el SQL Editor de Supabase (recomendada)

El archivo **`scripts/pizzeria-simulation.sql`** es autónomo e idempotente: es **un único bloque PL/pgSQL** (sin variables de sesión, inmune al error `unrecognized configuration parameter`), que borra todo lo anterior de la simulación y reaplica esquema + datos + KB + flujo:

1. Si tu base tiene una sola cuenta: ejecuta el archivo completo tal cual.
2. Si tienes varias cuentas: pega tu UUID en la línea `v_acct UUID := NULL;` del inicio (obtén el UUID con `SELECT id, name FROM accounts;`).
3. El `RAISE NOTICE` final confirma cada parte.

### Opción B — Migraciones (050–054)

Si despliegas con `supabase db push` / `supabase db reset`:

```bash
supabase db push
```

Las migraciones 050–054 son **replay-safe**: en una base vacía (CI) crean solo el esquema y omiten el seed con un NOTICE; en tu base real insertan todo, idempotente.

> **Nota:** las migraciones anteriores (051–054 originales) abortaban en bases
> vacías, no eran idempotentes y el flujo tenía el grafo mal construido
> (`entry_node_id` con UUID en vez de node_key, 5 botones —Meta permite 3—,
> condiciones que leían vars que nadie capturaba). Todo eso está corregido.

## IA / Base de conocimiento

La migración 053 (y la Parte 3 del script) crean 3 documentos de KB: **Menú**, **Tamaños y Precios** y **Políticas**, con sus chunks, para que el asistente de IA responda con datos reales del negocio.

> ⚠️ **La clave de API de IA NO se inserta por SQL.** La app espera la clave
> cifrada con AES-256-GCM; un placeholder en texto plano hace que `decrypt()`
> falle y rompe todas las funciones de IA de la cuenta. Configura tu clave
> OpenAI/Anthropic en **Ajustes → IA** de la app (ahí se cifra correctamente).

Alternativa vía API: `POST /api/pizzeria/init-knowledge` (requiere sesión con
rol admin/owner) re-genera el documento del menú desde `pizzeria_pizzas` —
es el "puente" entre el esquema independiente y la KB de waCRM.

## Flujo de simulación

La migración 054 (y la Parte 4 del script) crea el flujo **"Pizzería La Vecchia — Pedidos"** (`status: active`, trigger por palabras clave: hola, pedido, pizza, menú...), construido con las reglas exactas del engine (`src/lib/flows/engine.ts`):

```
start → saludo → menú de 3 botones (Ver menú / Hacer pedido / Hablar con agente)
Hacer pedido → captura pizza → captura tamaño → resumen ({{vars.pizza}}…)
  → captura confirmación → ¿contiene "no"? → cancelar | ¿contiene "sí"? → pago
  → captura delivery/recogida → cierre → end
```

Puntos clave que antes estaban rotos y ahora son correctos:

- `flows.entry_node_id` guarda el **node_key** (`start_welcome`), no el UUID del nodo.
- El nodo `start` tiene `next_node_key` en su config.
- Botones: máx. 3, cada uno con `reply_id` **y** `next_node_key`.
- Las condiciones solo leen vars que un `collect_input` previo capturó.
- Interpolación simple `{{vars.nombre}}` (el engine no evalúa expresiones JS).

## Endpoints API

| Endpoint                        | Método | Descripción                                                                                                                                  |
| ------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/pizzeria/menu`            | GET    | Menú completo (pizzas, tamaños, info del restaurante) como JSON. Sin `?account_id` la RLS devuelve el menú de la cuenta del usuario logueado |
| `/api/pizzeria/media/:filename` | GET    | Sirve imágenes de pizzas (filesystem local → Supabase Storage)                                                                               |
| `/api/pizzeria/media/upload`    | POST   | Sube imágenes locales al bucket `pizzeria-media` (autenticado; nombres de archivo validados)                                                 |
| `/api/pizzeria/init-knowledge`  | POST   | Inserta/reemplaza el documento del menú en la KB de IA (admin/owner)                                                                         |

## Flujo de imágenes

1. Las 5 fotos de pizzas (una por SKU, 512×512 JPEG) están en `public/pizzeria/` y se sirven por `/api/pizzeria/media/<archivo>`.
2. `image_url` en `pizzeria_pizzas` guarda la ruta **relativa** (`/api/pizzeria/media/margarita.jpg`), así las filas sobreviven re-deploys y cambios de dominio.
3. Para servirlas desde Supabase Storage (opcional, recomendado en producción):
   ```bash
   curl -X POST "https://<tu-app>/api/pizzeria/media/upload" \
     -H "Cookie: <tu sesión>" \
     -H "Content-Type: application/json" \
     -d '{"account_id":"<TU_ACCOUNT_ID>","filenames":["margarita.jpg","napolitana.jpg","pescadora.jpg","la_vecchia.jpg","vegetariana.jpg"]}'
   ```
   y luego actualiza `image_url` a la `publicUrl` del bucket:
   ```sql
   UPDATE pizzeria_pizzas
   SET image_url = '<SUPABASE_URL>/storage/v1/object/public/pizzeria-media/account-<TU_ACCOUNT_ID>/' || sku_name
   WHERE account_id = '<TU_ACCOUNT_ID>';
   ```

## Datos de ejemplo

### Pizzas

| SKU   | Nombre              | Pequeña | Mediana | Grande | Vegetariana |
| ----- | ------------------- | ------- | ------- | ------ | ----------- |
| marg  | Margarita           | $12     | $15     | $18    | ✅          |
| napo  | Napolitana          | $15     | $18     | $21    | ❌          |
| pesc  | Pescadora           | $18     | $21     | $24    | ❌          |
| espec | La Vecchia Especial | $20     | $23     | $26    | ❌          |
| vege  | Vegetariana         | $14     | $17     | $20    | ✅          |

### Clientes de ejemplo

| Teléfono     | Nombre         | Preferencia           | Pedidos | Premium |
| ------------ | -------------- | --------------------- | ------- | ------- |
| +58105550101 | María González | sin gluten ocasional  | 7       | ✅      |
| +58105550102 | Carlos Pérez   | extra orégano         | 3       | ❌      |
| +58105550103 | Ana Ríos       | sin queso             | 1       | ❌      |
| +58105550104 | Luis Fernández | —                     | 5       | ❌      |
| +58105550105 | Patricia Díaz  | borde extra crujiente | 2       | ❌      |

### Meseros (round-robin)

| Key      | Nombre | Teléfono     |
| -------- | ------ | ------------ |
| mesero_1 | Juan   | +58105550901 |
| mesero_2 | María  | +58105550902 |
| mesero_3 | Carlos | +58105550903 |

## Convenciones de diseño

- **Independencia del motor**: Las tablas `pizzeria_*` NO tienen FKs a `contacts`, `conversations` o `messages`. `pizzeria_orders` usa `whatsapp_contact_phone` / `whatsapp_conversation_id` como referencias débiles (sin FK) que pueden enlazarse a waCRM pero no son obligatorias.
- **Imágenes portables**: `image_url` es un campo genérico que puede apuntar a cualquier CDN (el proxy `/api/pizzeria/media/:filename` desacopla la URL de la ubicación física).
- **Simulación adherida**: Los datos en `contacts`/`conversations`/`messages` son solo para pruebas. Se pueden borrar sin afectar el esquema independiente.
- **Vistas KB con RLS**: `pizzeria_*_kb_feed` usan `security_invoker = true` para respetar RLS (sin eso, cualquier usuario autenticado leería datos de todas las cuentas vía PostgREST).
