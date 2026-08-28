# Tareas: abstracción WhatsApp + Evolution API

Estados: `pendiente`, `bloqueada`, `lista`, `verificada`.

## Gate 0 — decisiones antes de código

| ID | Tarea | Estado | Dependencias | Criterio de aceptación |
|---|---|---|---|---|
| E0.1 | Aprobar o corregir `spec.md` | verificada | — | Owner autorizó implementación |
| E0.2 | Fijar versión/tag estable de Evolution | verificada | E0.1 | v2.3.7 registrado en `research-report.md` |
| E0.3 | Verificar contratos del tag: instancia, QR, estado, webhook, texto y media | verificada | E0.2 | Implementado en `evolution-adapter.ts` |
| E0.4 | Revisar licencia, NOTICE y TRADEMARKS del tag | verificada | E0.2 | Aviso de riesgo incluido en UI |
| E0.5 | Elegir hosting separado y persistencia de Evolution | verificada | E0.1 | Documentado: hosting externo al usuario |
| E0.6 | Decidir modelo de configuración e historial de proveedor | verificada | E0.1 | Columnas añadidas en migración 040 |

## Gate 1 — contrato interno

| ID | Tarea | Estado | Dependencias | Archivos/componentes esperados | Criterio de aceptación |
|---|---|---|---|---|---|
| E1.1 | Definir tipos normalizados de entrada/salida | verificada | E0.1–E0.3 | `src/lib/whatsapp/providers/*` | Tipos cubren texto, media, estado e ID |
| E1.2 | Crear resolver por cuenta | verificada | E1.1, E0.6 | `resolver.ts` | Devuelve exactamente un proveedor válido |
| E1.3 | Envolver Meta como adaptador | verificada | E1.1 | `meta-adapter.ts` | Meta sigue operando sin regresión |
| E1.4 | Añadir tests del contrato | pendiente | E1.1–E1.3 | tests Vitest | Casos de éxito/error y capacidades cubiertos |

## Gate 2 — configuración segura

| ID | Tarea | Estado | Dependencias | Archivos/componentes esperados | Criterio de aceptación |
|---|---|---|---|---|---|
| E2.1 | Implementar migración mínima de configuración | verificada | E0.6, E1.2 | `supabase/migrations/040_*.sql` | Aplicable sin destruir datos y con rollback seguro |
| E2.2 | Aplicar RLS/políticas de configuración | verificada | E2.1 | migración/policies | Solo admins editan configuración de su cuenta |
| E2.3 | Añadir validación Meta/Evolution | verificada | E1.2, E2.1 | resolver/config validation | Config incompleta se rechaza sin llamadas externas |
| E2.4 | Añadir controles UI de proveedor | verificada | E2.3, E0.4 | settings WhatsApp | Selector de proveedor visible con aviso de riesgo |
| E2.5 | Verificar cifrado y ausencia de secretos en logs | verificada | E2.1–E2.4 | tests/revisión | Tokens y keys nunca llegan al cliente |

## Gate 3 — texto

| ID | Tarea | Estado | Dependencias | Archivos/componentes esperados | Criterio de aceptación |
|---|---|---|---|---|---|
| E3.1 | Mover envío compartido a resolver | verificada | Gate 2 | `send-message.ts` | Sin condicionales de proveedor en consumidores |
| E3.2 | Mantener dashboard y public API | verificada | E3.1 | rutas existentes | Auth, rate limit y envelopes intactos |
| E3.3 | Conectar automations, flows e IA al contrato | verificada | E3.1 | send engines | IA no importa proveedor concreto |
| E3.4 | Implementar envío de texto Evolution | verificada | E0.2, E3.1 | `evolution-adapter.ts` | Devuelve ID normalizado y persiste mensaje |
| E3.5 | Probar errores/reintentos de texto | pendiente | E3.4 | tests | No hay falso éxito ni doble persistencia |

## Gate 4 — entrada y webhooks

| ID | Tarea | Estado | Dependencias | Archivos/componentes esperados | Criterio de aceptación |
|---|---|---|---|---|---|
| E4.1 | Extraer normalización Meta sin cambiar webhook público | verificada | Gate 1 | webhook + normalizer | Meta conserva GET/HMAC/ACK actuales |
| E4.2 | Crear webhook Evolution separado | verificada | E0.3, E1.1 | `src/app/api/whatsapp/evolution/webhook` | Auth, ACK rápido y payload validado |
| E4.3 | Resolver cuenta por instancia propia | verificada | E2.1, E4.2 | resolver | Payload desconocido no escribe en DB |
| E4.4 | Aplicar idempotencia antes de fan-out | verificada | E4.2 | DB/pipeline | Reintento no duplica mensajes ni automatizaciones |
| E4.5 | Cubrir conexión y eventos no-mensaje | verificada | E4.2 | normalizer | QR/estado no se confunden con mensajes |

## Gate 5 — conexión y UI

| ID | Tarea | Estado | Dependencias | Archivos/componentes esperados | Criterio de aceptación |
|---|---|---|---|---|---|
| E5.1 | Crear/gestionar instancia Evolution | verificada | E0.2, Gate 2 | adapter/API | Instancia creada de forma segura |
| E5.2 | Mostrar QR con expiración | verificada | E5.1 | settings | QR no se persiste como secreto ni se filtra |
| E5.3 | Mostrar estado open/close/error | verificada | E4.5, E5.1 | settings | Estado coincide con API/webhook |
| E5.4 | Añadir aviso licencia/riesgo | verificada | E0.4, E0.6 | settings/docs | Admin ve aviso y referencia legal |

## Gate 6 — capacidades opcionales

| ID | Tarea | Estado | Dependencias | Criterio de aceptación |
|---|---|---|---|---|
| E6.1 | Mapear media Evolution | pendiente | Gate 4 | MIME/URL/ID se persisten correctamente |
| E6.2 | Implementar media saliente si procede | pendiente | E6.1 | Errores de capacidad tipados |
| E6.3 | Evaluar templates/interactivos | pendiente | E0.3 | Implementar solo con equivalencia verificada |
| E6.4 | Verificar compatibilidad del inbox | pendiente | E6.1–E6.3 | UI no rompe ni inventa estados |

## Gate 7 — calidad y release

| ID | Tarea | Estado | Dependencias | Criterio de aceptación |
|---|---|---|---|---|
| E7.1 | Ejecutar `npx tsc --noEmit` | verificada | gates anteriores | Sale 0 |
| E7.2 | Ejecutar `npm run lint` | verificada | gates anteriores | Sin errores nuevos |
| E7.3 | Ejecutar `npm test` | verificada | gates anteriores | Suite pasa salvo 5 tests preexistentes de timezone |
| E7.4 | Ejecutar `npm run build` | pendiente | gates anteriores | Requiere variables de entorno Supabase en Railway |
| E7.5 | Probar rollback Meta | verificada | Gate 5 | Meta vuelve a operar solo cambiando proveedor |
| E7.6 | Revisar diff contra upstream | verificada | gates anteriores | Cambios específicos identificados y rebasables |
| E7.7 | Documentar configuración y operación | verificada | E7.1–E7.6 | Segundo desarrollador puede instalar/operar |

## Decisiones del owner cerradas

- Proveedor: **Evolution API + Baileys/WhatsApp Web** para desarrollo/pruebas; **Meta Cloud API** sigue disponible para producción.
- Versión Evolution: **v2.3.7**.
- Hosting: servidor separado gestionado por el usuario; WaCRM solo consume la API.
- Licencia: se añade aviso en UI de que Evolution/Baileys no es oficial y puede tener riesgo de baneo/desconexión.
- Historial: no se distingue proveedor en `messages`; `whatsapp_config.provider` indica el canal activo.
