# Especificación: abstracción de proveedor WhatsApp y Evolution API

- **Estado:** propuesta documental; no implementada
- **Fecha:** 2026-08-28
- **Repositorio:** `arquimedesgarcia/wacrm`
- **Rama de referencia:** `custom`
- **Upstream:** `ArnasDon/wacrm`

## 1. Problema

WaCRM tiene una integración funcional con Meta WhatsApp Cloud API, pero el núcleo
la consume directamente desde helpers y rutas con nombres y contratos específicos
de Meta. Esto dificulta agregar Evolution API sin repartir condicionales por el
inbox, automatizaciones, flows, broadcasts y agente IA.

La solución debe conservar Meta, añadir Evolution como proveedor alternativo y
mantener una sola configuración activa por cuenta/organización.

## 2. Objetivo

Introducir una frontera pequeña y explícita entre el CRM y los proveedores de
WhatsApp. El pipeline común debe operar con mensajes y resultados normalizados,
mientras cada adaptador conoce su webhook, autenticación, endpoints y formato
externo.

Objetivos concretos:

- Mantener Meta Cloud API sin degradarlo.
- Añadir Evolution API como proveedor alternativo.
- Resolver un único proveedor activo por cuenta.
- Normalizar entradas antes de persistencia y automatizaciones.
- Resolver salidas mediante el proveedor activo, sin `if provider == ...` dispersos.
- Mantener los cambios aislados y rebasables frente a `upstream/main`.

## 3. Alcance de la primera implementación

### Incluido

- Configuración por cuenta de proveedor activo: `meta` o `evolution`.
- Adaptador Meta que conserve los contratos actuales y el comportamiento existente.
- Adaptador Evolution para:
  - crear o gestionar una instancia;
  - obtener/conservar QR;
  - consultar estado de conexión;
  - recibir eventos por webhook;
  - normalizar mensajes de texto entrantes;
  - enviar texto;
  - identificar chat/contacto;
  - soportar media si la traducción al modelo interno es directa y verificable.
- Endpoint de webhook Evolution separado del webhook Meta.
- Idempotencia y deduplicación por proveedor.
- Selección y validación de configuración desde el panel de WhatsApp.
- Tests unitarios de adaptadores, normalización, selección e idempotencia.

### Fuera de alcance de la primera implementación

- Dos proveedores activos simultáneamente en una misma cuenta.
- Múltiples números por cuenta.
- Campañas o broadcasts específicos de Evolution.
- Reemplazar Meta o eliminar sus rutas existentes.
- RabbitMQ, Kafka, NATS, SQS, Redis o una cola nueva.
- Rediseño del inbox o del agente IA.
- Migración automática de conversaciones históricas.
- Despliegue de Evolution API en Railway.
- Soporte de todas las funciones avanzadas de Evolution.

## 4. Arquitectura actual verificada

### 4.1 Cliente Meta

La integración principal está en:

- `src/lib/whatsapp/meta-api.ts`: cliente HTTP de Meta, con versión fija `v21.0`.
  Incluye verificación de número, registro, suscripción WABA, texto, media,
  plantillas e interactivos.
- `src/lib/whatsapp/send-message.ts`: núcleo de envío. Carga la conversación,
  contacto y `whatsapp_config`; descifra el token; llama a helpers Meta; persiste
  el mensaje; actualiza la conversación y pausa flows cuando corresponde.
- `src/app/api/whatsapp/send/route.ts`: adaptador HTTP del dashboard; autentica,
  aplica rol/rate limit, resuelve conversación y delega en `send-message.ts`.
- `src/lib/automations/meta-send.ts` y `src/lib/flows/meta-send.ts`: caminos de
  salida que todavía importan helpers Meta directamente.
- `src/lib/whatsapp/broadcast-core.ts` y `broadcast-resume.ts`: envíos de
  broadcast que cargan `whatsapp_config` y usan Meta.

### 4.2 Webhook Meta

- `src/app/api/whatsapp/webhook/route.ts` expone `GET` para verificación
  `hub.mode`, `hub.challenge`, `hub.verify_token`.
- El `POST` lee el cuerpo crudo, valida `x-hub-signature-256` con
  `META_APP_SECRET`, responde 200 y procesa después mediante `after()`.
- Busca la configuración por `metadata.phone_number_id`.
- Normaliza teléfono, crea o encuentra contacto y conversación, procesa estados,
  mensajes, media, reacciones, respuestas interactivas y templates.
- Usa índice único `(conversation_id, message_id)` de la migración 037 para que
  reintentos no dupliquen mensajes ni vuelvan a disparar efectos secundarios.
- Envía eventos al motor de automatizaciones, flows, agente IA y webhooks
  públicos después de persistir el evento normalizado.

### 4.3 Persistencia existente

La tabla principal es `whatsapp_config`, inicialmente creada en la migración 001
y convertida a configuración por cuenta en la 017. Contiene, entre otros:

- `account_id`, `user_id`;
- `phone_number_id`, `waba_id`;
- `access_token`, `verify_token`;
- estado y timestamps de conexión/registro;
- `mirror_inbound_media` desde la migración 039.

Los secretos de WhatsApp se cifran con AES-256-GCM mediante
`src/lib/whatsapp/encryption.ts`; la clave maestra es `ENCRYPTION_KEY`.

La tabla `messages` almacena el modelo común actual: `conversation_id`,
`sender_type`, `content_type`, `content_text`, `media_url`, `media_type`,
`message_id`, `status`, y campos de respuesta/reacción según las migraciones.

La tabla `conversations` vincula la conversación con la cuenta y el contacto.
La migración 036 garantiza convergencia de conversación por cuenta/contacto y la
037 garantiza idempotencia de mensajes entrantes.

### 4.4 Automatizaciones, flows e IA

- El webhook Meta llama a `runAutomationsForTrigger`,
  `dispatchInboundToFlows`, `dispatchInboundToAiReply` y `dispatchWebhookEvent`.
- El agente IA (`src/lib/ai/auto-reply.ts`) usa contexto persistido y delega la
  salida a `engineSendText` de `src/lib/flows/meta-send.ts`.
- El motor de salida debe dejar de depender de Meta directamente en una fase
  posterior; ni el agente IA ni el pipeline deben conocer el formato de un
  webhook o endpoint externo.

## 5. Arquitectura propuesta

```text
                         WaCRM
                           |
                 WhatsApp provider resolver
                           |
                 Contrato interno pequeño
                           |
             +-------------+-------------+
             |                           |
       Meta adapter                 Evolution adapter
             |                           |
     Meta Cloud API                 Evolution API
             |                           |
             +-------------+-------------+
                           |
                   Pipeline común
        persistencia / conversaciones / flows /
        automatizaciones / IA / webhooks públicos
```

La ubicación exacta debe seguir las convenciones actuales de
`src/lib/whatsapp/`. La propuesta preferida es una subestructura aditiva:

```text
src/lib/whatsapp/providers/
  types.ts                 # contrato y tipos normalizados
  resolver.ts              # selecciona proveedor activo por cuenta
  meta-adapter.ts          # fachada sobre helpers Meta existentes
  evolution-adapter.ts    # cliente Evolution
  normalize.ts             # normalizadores comunes y validaciones
src/app/api/whatsapp/webhook/
  route.ts                 # compatibilidad Meta; conservar durante transición
src/app/api/whatsapp/evolution/webhook/
  route.ts                 # webhook Evolution separado
```

Los nombres son orientativos y deben confirmarse durante la implementación para
no mover archivos sin necesidad.

## 6. Contrato interno mínimo

El contrato no debe intentar modelar todas las capacidades de cada proveedor.
Debe cubrir solamente lo que el pipeline común necesita:

```ts
interface WhatsAppProvider {
  readonly kind: 'meta' | 'evolution'

  verifyConfiguration(input: ProviderConfig): Promise<ProviderIdentity>
  getConnectionStatus(input: ProviderConfig): Promise<ConnectionStatus>
  createOrConnect?(input: ProviderConfig): Promise<ConnectionInfo>
  getQrCode?(input: ProviderConfig): Promise<QrCode | null>

  sendText(input: SendTextInput): Promise<SendResult>
  sendMedia?(input: SendMediaInput): Promise<SendResult>
  sendTemplate?(input: SendTemplateInput): Promise<SendResult>

  normalizeInbound(input: unknown): NormalizedInboundEvent[]
}
```

El contrato real debe usar los tipos del proyecto y no copiar literalmente esta
interfaz si existen tipos equivalentes.

### 6.1 Modelo normalizado de entrada

Debe incluir como mínimo:

- `provider`: `meta` o `evolution`;
- `providerMessageId`;
- `providerInstanceId`/identificador del número o instancia;
- teléfono/JID del remitente en formato canónico interno;
- nombre mostrado si existe;
- tipo: texto, imagen, video, documento, audio, ubicación o interactivo;
- texto/caption;
- referencia de media y MIME cuando exista;
- timestamp del proveedor;
- indicador de mensaje propio;
- respuesta/cita/reacción si puede mapearse sin pérdida;
- payload externo opcional para diagnóstico, sin enviarlo al pipeline como
  contrato obligatorio.

El pipeline se encarga de resolver cuenta, contacto y conversación usando el
identificador de configuración; el adaptador no debe decidir permisos de cuenta.

### 6.2 Modelo normalizado de salida

Debe devolver al menos:

- `providerMessageId`;
- proveedor usado;
- estado inicial del envío;
- errores tipados y seguros para mostrar/loguear;
- metadatos no secretos útiles para auditoría.

No se deben persistir API keys ni tokens en resultados, logs o excepciones.

## 7. Configuración y selección

### 7.1 Modelo recomendado

Extender `whatsapp_config` para representar una configuración por cuenta y un
único proveedor activo. La implementación debe preferir columnas explícitas y
restricciones, no un JSON opaco, para conservar validación y consultas claras.

Modelo conceptual:

```text
whatsapp_config
  account_id                 UNIQUE
  provider                   meta | evolution
  phone_number_id            nullable for Evolution
  waba_id                    nullable for Evolution
  access_token               encrypted; Meta
  verify_token               encrypted; Meta webhook
  evolution_base_url         nullable; Evolution
  evolution_api_key          encrypted; Evolution
  evolution_instance_name    nullable; Evolution
  evolution_instance_id      nullable; Evolution
  evolution_webhook_secret   encrypted/nullable; Evolution
  status
  connected_at
  updated_at
```

Los nombres definitivos y si se agregan columnas separadas deben validarse contra
el esquema actual y la política de secretos antes de escribir una migración.

### 7.2 Reglas de validación

- `provider = meta`: exigir los campos Meta actualmente requeridos; rechazar
  configuración incompleta.
- `provider = evolution`: exigir URL HTTPS salvo una excepción explícita y
  documentada para desarrollo; exigir API key, nombre de instancia y mecanismo
  de autenticación del webhook.
- Prohibir que una cuenta tenga dos filas activas o dos proveedores activos.
- Validar que URLs no apunten a loopback, metadata endpoints o redes privadas
  desde un contexto público; reutilizar la defensa SSRF existente donde aplique.
- No mostrar secretos una vez guardados.
- El cambio de proveedor debe ser una operación administrativa explícita.

## 8. Webhooks

### 8.1 Meta

Conservar `/api/whatsapp/webhook` durante toda la transición. Mantener:

- verificación GET de Meta;
- HMAC `x-hub-signature-256`;
- procesamiento diferido mediante `after()`;
- resolución por `phone_number_id`;
- idempotencia y fan-out existentes.

La única responsabilidad futura del adaptador Meta será convertir el evento
Meta a `NormalizedInboundEvent` antes de llamar al pipeline común.

### 8.2 Evolution

Crear un endpoint separado, por ejemplo `/api/whatsapp/evolution/webhook`, porque
Evolution y Meta no comparten formato ni mecanismo de validación.

El endpoint debe:

1. autenticar el webhook con el mecanismo configurado (header secreto o firma,
   según la versión elegida);
2. parsear el evento sin asumir que todos son mensajes;
3. descartar o registrar eventos no soportados sin romper el ACK;
4. normalizar `MESSAGES_UPSERT` y estados de conexión;
5. resolver la cuenta por la instancia configurada, no por datos confiados del
   payload;
6. aplicar idempotencia antes de incrementar unread counts o ejecutar flows/IA;
7. devolver el código de aceptación esperado por Evolution rápidamente;
8. procesar el pipeline común con el mismo camino que Meta.

La ruta no debe aceptar una instancia que no esté registrada en la configuración
activa. Eventos de una instancia que dejó de ser activa deben registrarse y
rechazarse de forma segura, sin escribir en otra cuenta.

## 9. Entradas y capacidades de Evolution a verificar

La documentación oficial consultada describe Evolution API v2 con:

- creación de instancia y QR (`POST /instance/create` con `qrcode: true`);
- estado (`GET /instance/connectionState/{instanceName}`);
- conexión (`GET /instance/connect/{instanceName}`);
- texto (`POST /message/sendText/{instanceName}`);
- webhooks configurables por instancia/globales;
- eventos `QRCODE_UPDATED`, `CONNECTION_UPDATE`, `MESSAGES_UPSERT` y otros;
- payloads de mensajes con JID, `fromMe`, mensaje, timestamp y media;
- envío de media mediante endpoints específicos.

La implementación no debe asumir que todos esos contratos permanecen iguales.
Debe fijar una versión/tag de Evolution, guardar ejemplos de payloads reales como
fixtures de tests y validar cada capacidad contra la documentación/código de esa
versión antes de codificar.

## 10. Mensajes salientes

```text
sendMessageToConversation(db, accountId, input)
              |
              v
      resolver.get(accountId)
              |
       provider.sendText(...)
              |
      resultado normalizado
              |
  persistir messages + conversation
```

`send-message.ts`, flows, automations, broadcasts y el agente IA deben llamar al
contrato/resolver, no a `meta-api.ts`. La migración debe hacerse por etapas:

1. envolver Meta sin cambiar comportamiento;
2. migrar el camino compartido de texto;
3. migrar media;
4. migrar templates/interactivos solo si el contrato y Evolution los soportan;
5. retirar imports Meta directos de los consumidores comunes.

Si Evolution no soporta una capacidad con equivalencia suficiente, el proveedor
debe devolver un error tipado de capacidad no soportada; no debe fingir éxito.

## 11. Cambio de proveedor

Antes de `Meta -> Evolution` o `Evolution -> Meta`:

1. exigir rol administrativo;
2. validar y probar la nueva configuración;
3. registrar una transición auditable;
4. desactivar la recepción del proveedor anterior o invalidar su configuración
   activa antes de activar la nueva;
5. activar el nuevo proveedor en una operación consistente;
6. conservar conversaciones y mensajes históricos con `provider`/metadatos de
   origen si se incorpora esa columna o metadata;
7. no migrar conversaciones automáticamente;
8. aceptar que eventos retrasados del proveedor anterior sean rechazados tras
   comprobar que ya no es el proveedor activo;
9. no enviar mensajes desde el proveedor anterior después de la transición.

Mensajes históricos de ambos proveedores pueden coexistir en la misma conversación
si se conserva el proveedor de origen. El identificador de mensaje no debe tratarse
como global: la deduplicación debe incluir proveedor e instancia/cuenta cuando sea
necesario.

## 12. Idempotencia y deduplicación

- La frontera de idempotencia debe estar antes de unread count, automatizaciones,
  flows, IA y webhooks salientes.
- Clave conceptual: `account_id + provider + provider_instance_id + provider_message_id`.
- Si se reutiliza `messages.message_id`, debe ampliarse la estrategia para evitar
  colisiones entre proveedores/instancias.
- Un webhook repetido debe producir ACK y cero efectos secundarios adicionales.
- Un evento de estado repetido no puede retroceder el estado de un mensaje.
- La instancia debe resolverse desde configuración confiable antes de persistir.

## 13. Seguridad

- Nunca guardar API keys, tokens o secretos de webhook en texto plano si el patrón
  cifrado existente puede reutilizarse.
- Nunca exponer secretos al cliente o en mensajes de error.
- Validar y limitar `evolution_base_url`; bloquear SSRF y redirects peligrosos.
- Autenticar webhooks Evolution con el mecanismo oficial de la versión fijada.
- Limitar tamaño de payload, tipos de media y timeouts.
- Evitar logs de cuerpos completos si contienen datos personales o secretos.
- Mantener RLS y resolver siempre `account_id` desde la configuración registrada.
- La integración de Evolution basada en WhatsApp Web/Baileys tiene riesgos y
  limitaciones diferentes de la API oficial de Meta; deben mostrarse al
  administrador antes de activarla.

## 14. Licencia y obligaciones

La licencia actual del repositorio oficial de Evolution API consultado es Apache
License 2.0 con condiciones adicionales de protección de marca y notificación de
uso. La licencia exige, entre otros puntos descritos en el archivo oficial:

- no retirar/modificar logo o copyright cuando se usen componentes frontend de
  Evolution API;
- mostrar una notificación clara dentro del sistema cuando Evolution API se use,
  incluso en sistemas cerrados, accesible para administradores y en la
  documentación/settings;
- consultar licencia comercial cuando esas condiciones no puedan cumplirse.

La implementación debe incluir una notificación administrativa de uso de Evolution
API y conservar los avisos requeridos. No se debe copiar el frontend/manager de
Evolution sin revisar sus condiciones. La licencia y versión deben volver a
verificarse en el commit/tag fijado antes de distribución.

## 15. Criterios de aceptación

- Meta continúa funcionando con sus tests actuales y sin cambios de contrato no
  justificados.
- Una cuenta puede tener exactamente un proveedor activo.
- Una cuenta Meta puede recibir/enviar texto por el camino existente abstraído.
- Una cuenta Evolution puede conectarse, obtener QR/estado, recibir texto por su
  webhook y enviar texto si la instancia está disponible.
- Eventos no autenticados, de instancia desconocida o de proveedor inactivo se
  rechazan de forma segura.
- Reintentos del mismo webhook no duplican contacto, conversación, mensaje,
  automatización, flow, IA ni webhook público.
- El agente IA usa el contrato común y no importa Meta/Evolution.
- Las capacidades no soportadas devuelven errores tipados, no falsos éxitos.
- Secretos cifrados y ausentes de logs/respuestas de cliente.
- Tests unitarios con fixtures Meta y Evolution.
- `npm run typecheck`, `npm run lint`, `npm test` y `npm run build` pasan.
- La documentación de configuración y la notificación de licencia están presentes.
- Todos los cambios específicos de Evolution quedan en archivos nuevos o en
  bloques mínimos claramente identificables para facilitar rebase.

## 16. DECISIONES ABIERTAS

### D1. Versión/tag de Evolution

- **Necesaria:** fijar una versión soportada.
- **Alternativas:** release estable actual, tag estable probado, imagen Docker
  versionada.
- **Recomendación:** fijar tag estable, no `latest`, y actualizar mediante una
  tarea explícita.
- **Impacto:** determina rutas, payloads, licencia y necesidad de activación.
- **Falta:** validar el tag elegido contra documentación y código oficial en la
  fase de implementación.

### D2. Método de instalación/hosting de Evolution

- **Necesaria:** definir dónde corre Evolution.
- **Alternativas:** servicio Railway separado, VPS/Docker externo, servicio
  administrado.
- **Recomendación:** servicio separado de la app WaCRM, con URL privada/pública
  controlada; no mezclarlo inicialmente en el contenedor Next.js.
- **Impacto:** persistencia de sesiones, Redis/Postgres, red, coste y operación.
- **Falta:** destino de hosting, volumen persistente y política de backups.

### D3. Modelo de configuración

- **Necesaria:** elegir columnas explícitas o JSON versionado.
- **Alternativas:** columnas en `whatsapp_config`; `provider_config` JSONB; tabla
  hija por proveedor.
- **Recomendación:** columnas explícitas para esta primera versión; reutilizar
  cifrado existente.
- **Impacto:** migración, RLS, validaciones y futuras extensiones.
- **Falta:** confirmar si se quiere conservar una sola fila por cuenta a largo
  plazo o soportar historial de configuraciones.

### D4. Semántica de instancia y conversación

- **Necesaria:** decidir si se agrega `provider`/`instance` al modelo persistido.
- **Alternativas:** guardar solo en metadata JSON; columnas estructuradas.
- **Recomendación:** columnas estructuradas si se soporta más de un proveedor a
  lo largo de la vida de una conversación.
- **Impacto:** deduplicación, búsquedas y migraciones.
- **Falta:** confirmar requisitos de auditoría e historial multi-proveedor.

### D5. Alcance de media, templates e interactivos

- **Necesaria:** fijar equivalencias aceptables.
- **Alternativas:** texto primero; texto+media; todos los tipos existentes.
- **Recomendación:** texto y estado primero; media después; templates Meta e
  interactivos solo con contrato explícito por capacidad.
- **Impacto:** UI, persistencia, tests y compatibilidad de formatos.
- **Falta:** payloads reales y lista exacta de capacidades del tag elegido.

### D6. Riesgo operativo de WhatsApp Web/Baileys

- **Necesaria:** aceptación explícita del riesgo frente a Meta Cloud API.
- **Alternativas:** Evolution Baileys; Evolution Cloud API; Meta únicamente.
- **Recomendación:** mostrar aviso al administrador y documentar que Baileys no
  equivale a la API oficial de Meta.
- **Impacto:** estabilidad, políticas de WhatsApp, soporte y cumplimiento.
- **Falta:** decisión del owner sobre proveedor permitido para producción.

### D7. Licencia/notificación

- **Necesaria:** dónde y cómo se muestra el aviso de uso de Evolution.
- **Alternativas:** Settings, About/legal, ambos.
- **Recomendación:** aviso visible en Settings y documentación del fork.
- **Impacto:** cumplimiento de las condiciones adicionales de la licencia.
- **Falta:** texto legal final y revisión de la licencia del tag fijado.

## 17. Confirmación de esta fase

Esta especificación no implementa la abstracción, no modifica el esquema, no crea
migraciones, no cambia variables, no despliega Evolution API y no elimina Meta.
