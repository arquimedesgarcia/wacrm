# Plan de implementación futura: Evolution API

- **Prerequisito:** aprobación explícita de `docs/evolution-api/spec.md`.
- **Estado:** planificación; no implementado.
- **Principio:** cambios aditivos en la rama `custom`; no alterar Meta más de lo
  necesario para conectarlo al contrato común.

## Fase 0 — Cerrar decisiones y congelar referencias

**Objetivo:** eliminar ambigüedades antes de tocar código.

- Elegir y fijar tag estable de Evolution API.
- Verificar rutas, payloads, headers, webhook auth y capacidades de ese tag.
- Revisar `LICENSE`, `NOTICE` y `TRADEMARKS` del tag.
- Decidir hosting separado, volumen persistente, Redis/Postgres y backups.
- Decidir columnas de configuración y alcance de historial multi-proveedor.
- Guardar links y ejemplos de payloads en `docs/evolution-api/references/`.

**Salida:** decisiones cerradas y fixtures documentados.

## Fase 1 — Contrato y fachada Meta sin cambio funcional

**Objetivo:** crear la frontera con riesgo mínimo.

Áreas esperadas, sujetas a confirmación:

- nuevos tipos/resolver/adaptador bajo `src/lib/whatsapp/providers/`;
- fachada Meta sobre `src/lib/whatsapp/meta-api.ts`;
- tests del contrato y equivalencia con los tests Meta existentes.

**Criterio:** todos los tests Meta pasan y no cambia el comportamiento productivo.

## Fase 2 — Resolver por cuenta y configuración segura

**Objetivo:** poder seleccionar un único proveedor.

Áreas esperadas:

- panel de configuración WhatsApp;
- `src/lib/whatsapp/encryption.ts` reutilizado;
- migración SQL mínima para proveedor y configuración Evolution;
- políticas/RLS revisadas;
- validación de URLs, instancia, API key y webhook secret.

**Criterio:** una cuenta no puede activar dos proveedores ni guardar una
configuración incompleta; los secretos no aparecen en cliente/logs.

## Fase 3 — Pipeline saliente de texto

**Objetivo:** que el camino común de texto use el proveedor activo.

Orden recomendado:

1. `src/lib/whatsapp/send-message.ts` usa el resolver.
2. Dashboard `/api/whatsapp/send` conserva auth/rate limit.
3. Public API `/api/v1/messages` conserva sus permisos y envelope.
4. `src/lib/flows/meta-send.ts`, automations y IA se renombran/refactorizan para
   llamar al contrato común, sin exponer detalles de proveedor.
5. Tests de envío Meta equivalentes a los actuales.

**Criterio:** texto Meta sigue funcionando; texto Evolution produce ID y estado
normalizados y persiste igual.

## Fase 4 — Webhooks y pipeline entrante

**Objetivo:** coexistencia segura de endpoints sin compartir formatos.

- Mantener `/api/whatsapp/webhook` para Meta.
- Crear endpoint Evolution independiente.
- Validar autenticidad antes de procesar.
- Resolver cuenta por instancia configurada.
- Normalizar antes de contacto/conversación/mensaje.
- Aplicar idempotencia antes de unread, automations, flows, IA y fan-out.
- Probar reintentos, mensajes propios, estados y eventos no soportados.

**Criterio:** un evento Evolution crea exactamente los mismos objetos comunes que
un evento Meta equivalente, sin duplicados ni cruce de cuentas.

## Fase 5 — QR, estado y UI administrativa

**Objetivo:** habilitar operación Evolution sin acoplar el inbox.

- Crear/consultar instancia según el tag fijado.
- Obtener QR con expiración y sin almacenar secretos en cliente.
- Refrescar estado de conexión.
- Mostrar aviso de riesgos/licencia.
- Reutilizar componentes UI existentes siempre que sea posible.

**Criterio:** administrador puede conectar, ver estado y desconectar; errores
externos son legibles y tipados.

## Fase 6 — Media, plantillas e interactivos por capacidad

**Objetivo:** ampliar solo lo que Evolution soporte con equivalencia verificable.

- Primero mapear media entrante/saliente al modelo de `messages`.
- Conservar MIME, media URL/ID y política de almacenamiento.
- Implementar templates/interactivos solo si la semántica es equivalente.
- Para lo no soportado, mostrar capacidad no disponible y no fingir éxito.

**Criterio:** tests por tipo y límites; no se rompe el camino Meta.

## Fase 7 — Verificación y rollback

Ejecutar desde raíz:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Añadir pruebas de integración con mocks, nunca con secretos reales:

- selección por cuenta;
- validación de configuración;
- autenticación de webhooks;
- normalización de fixtures Meta/Evolution;
- deduplicación y estados;
- aislamiento de cuentas;
- capacidades no soportadas.

### Rollback

- Desactivar `evolution` y volver `provider = meta` mediante configuración segura.
- Mantener endpoint Meta sin cambios durante todas las fases.
- No eliminar columnas ni datos en el rollback inicial.
- Si falla un deploy, volver a la última imagen/commit conocido y conservar la
  configuración Meta.
- Una migración de esquema posterior debe ser reversible solo si no destruye
  datos; preferir columnas nullable y feature flag.

## Riesgos principales

| Riesgo | Mitigación |
|---|---|
| Cambios de contrato entre versiones | Fijar tag y fixtures oficiales/reales |
| Rebase conflictivo en rutas Meta | Fachadas pequeñas y commits por fase |
| Duplicación por reintentos | Idempotencia DB antes del fan-out |
| Cruce de cuentas por payload | Resolver instancia desde configuración propia |
| Secretos expuestos | Reutilizar cifrado, no enviarlos al navegador |
| SSRF contra URL Evolution | Validación y guard existente |
| Diferencias de Baileys frente a Meta | Aviso operativo y decisión del owner |
| Licencia con condiciones adicionales | Aviso administrativo, NOTICE y revisión legal |
| Sesiones perdidas | Volumen persistente y backups de Evolution |

## Orden de commits recomendado

1. `docs(evolution): close provider reference and licensing decisions`
2. `feat(whatsapp): add provider contract and Meta adapter`
3. `feat(whatsapp): add account provider configuration`
4. `refactor(whatsapp): route text sends through provider resolver`
5. `feat(whatsapp): normalize Evolution inbound webhook`
6. `feat(whatsapp): add Evolution connection management`
7. `feat(whatsapp): add Evolution media capabilities`

No hacer push ni deploy de una fase sin revisión y pruebas de la fase anterior.
