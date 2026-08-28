# Solicitud: Especificación documental para abstraer el proveedor de WhatsApp y agregar Evolution API

## Contexto

Tenemos una instancia funcional de **wacrm** desplegada en Railway, utilizando Supabase como backend/base de datos.

Actualmente el sistema está configurado para utilizar **Meta WhatsApp Cloud API**.

El objetivo de esta tarea es evaluar y especificar una modificación arquitectónica que permita agregar **Evolution API como segundo proveedor de comunicación con WhatsApp**, sin eliminar el proveedor actual de Meta y sin acoplar el CRM, las automatizaciones o el agente IA a un proveedor concreto.

**Esta tarea es exclusivamente documental.**

### No debes escribir código.
### No debes modificar código.
### No debes crear migraciones.
### No debes desplegar nada.

Tu trabajo termina con una propuesta de especificación documentada y una lista clara de decisiones abiertas.

---

# Objetivo arquitectónico

La arquitectura objetivo debe permitir:

```text
                    wacrm
                      │
          WhatsApp Provider Abstraction
                      │
             ┌────────┴────────┐
             │                 │
             ▼                 ▼
        Meta Cloud API    Evolution API
             │                 │
             ▼                 ▼
          WhatsApp        WhatsApp
```

El objetivo es que el núcleo de wacrm no dependa directamente de un proveedor concreto de WhatsApp.

La IA, CRM, conversaciones, automatizaciones y lógica de negocio deben trabajar sobre un modelo común.

---

# Requisitos obligatorios

## 1. Mantener Meta Cloud API

La integración actual con Meta **no debe eliminarse ni degradarse**.

Meta debe convertirse en un proveedor dentro de la abstracción.

## 2. Agregar Evolution API como segundo proveedor

Evolution API debe incorporarse como proveedor alternativo.

La especificación debe basarse en la versión actual oficialmente soportada de Evolution API y validar sus capacidades reales para:

- creación/gestión de instancia;
- conexión mediante QR;
- recepción de mensajes;
- envío de mensajes;
- webhooks;
- mensajes de texto;
- media;
- estado de conexión.

No asumir capacidades sin verificar la documentación y el código oficial.

## 3. Un único proveedor activo por organización

Cada organización debe tener **un solo proveedor de WhatsApp activo**.

Modelo conceptual:

```text
Organization
   │
   └── active_whatsapp_provider
          │
          ├── meta
          └── evolution
```

No se requiere soportar simultáneamente Meta y Evolution para una misma organización.

La especificación debe explicar:

- dónde se almacena esta configuración;
- cómo se selecciona;
- qué ocurre durante el cambio de proveedor;
- qué validaciones deben existir.

## 4. Mantener el pipeline común

El sistema actual debe evolucionar hacia:

```text
Proveedor
   │
   ▼
Adapter
   │
   ▼
Mensaje normalizado
   │
   ▼
Pipeline común de wacrm
   │
   ├── Persistencia
   ├── Conversaciones
   ├── Automatizaciones
   ├── Agente IA
   └── Respuesta
          │
          ▼
       Provider
```

El pipeline común no debe conocer detalles específicos de Meta ni Evolution.

## 5. No introducir lógica del proveedor en el agente IA

El agente IA no debe:

- saber qué proveedor está activo;
- llamar directamente a Evolution;
- llamar directamente a Meta;
- depender de formatos específicos de webhook.

El agente debe trabajar con mensajes normalizados.

---

# Análisis obligatorio del repositorio actual

Antes de proponer arquitectura, inspecciona el código real de wacrm y documenta:

1. Dónde se encuentra actualmente la integración con Meta.
2. Cómo entran los webhooks.
3. Cómo se valida el webhook.
4. Cómo se normaliza o persiste el mensaje.
5. Cómo se crean/actualizan conversaciones.
6. Cómo se envían mensajes salientes.
7. Cómo se manejan imágenes, documentos, audio y otros medios.
8. Cómo se conecta el pipeline con automatizaciones.
9. Cómo se conecta el pipeline con el agente IA.
10. Qué tablas/configuración de Supabase participan.
11. Qué componentes son reutilizables.
12. Qué puntos están actualmente acoplados a Meta.

No diseñes sobre supuestos si el código existente proporciona una respuesta.

---

# Arquitectura que debe evaluarse

La propuesta debe evaluar una abstracción equivalente conceptualmente a:

```text
WhatsAppProvider
    │
    ├── MetaProvider
    │
    └── EvolutionProvider
```

Pero debes adaptar los nombres y ubicación a las convenciones reales del proyecto.

La abstracción debe definir el mínimo contrato común necesario para:

- recibir eventos;
- normalizar mensajes entrantes;
- enviar mensajes;
- enviar media;
- consultar/configurar estado de conexión cuando aplique;
- resolver configuración por organización.

No crear una abstracción excesivamente grande.

La prioridad es:

> mínima arquitectura limpia compatible con la estructura existente de wacrm.

---

# Persistencia y configuración

La especificación debe proponer cómo almacenar:

- proveedor activo;
- configuración del proveedor;
- credenciales necesarias;
- Evolution API URL;
- Evolution API Key;
- nombre/identificador de instancia;
- identificadores de configuración por organización.

Las credenciales sensibles no deben almacenarse innecesariamente en texto plano.

Si wacrm ya tiene un patrón de almacenamiento seguro de configuración, debe reutilizarse.

---

# Webhooks

La especificación debe explicar claramente cómo coexistirán:

```text
Meta Webhook
     │
     ▼
Meta Adapter
     │
     ▼
Pipeline común
```

y:

```text
Evolution Webhook
     │
     ▼
Evolution Adapter
     │
     ▼
Pipeline común
```

Cada proveedor puede tener su endpoint y mecanismo de validación propio.

No se debe forzar que Meta y Evolution tengan el mismo formato de webhook.

La normalización debe ocurrir dentro del adaptador.

---

# Mensajes salientes

La especificación debe explicar cómo el sistema resolverá:

```text
Enviar mensaje
      │
      ▼
Resolver organización
      │
      ▼
Resolver proveedor activo
      │
      ▼
Adapter correspondiente
      │
      ├── Meta
      └── Evolution
```

El código de negocio no debe necesitar realizar condicionales repetidos del tipo:

```text
if provider == meta
```

dispersos por el sistema.

---

# Cambio de proveedor

Debe documentarse qué ocurre cuando una organización cambia de:

```text
Meta → Evolution
```

o:

```text
Evolution → Meta
```

Debe quedar claro:

- qué configuración debe existir antes del cambio;
- si puede haber mensajes históricos de ambos proveedores;
- cómo evitar mensajes duplicados;
- qué proveedor recibe nuevos mensajes después del cambio;
- qué ocurre con conversaciones abiertas;
- qué ocurre si se reciben eventos del proveedor anterior después del cambio.

No es necesario resolver una migración automática compleja si no es necesaria.

---

# Alcance de Evolution API

Para la primera implementación, evaluar como mínimo:

### Obligatorio

- conectar instancia;
- QR o mecanismo oficial equivalente;
- estado de conexión;
- recibir texto;
- enviar texto;
- webhook;
- identificación del chat/contacto;
- media si el pipeline actual de wacrm lo soporta de forma sencilla.

### No obligatorio en primera fase

No incluir salvo que el análisis del código existente demuestre que es necesario:

- múltiples proveedores simultáneos;
- multi-device complejo;
- múltiples números por organización;
- campañas masivas;
- integraciones nativas de Evolution con otros bots;
- RabbitMQ/Kafka;
- S3/MinIO si wacrm ya resuelve media de otra forma;
- funcionalidades avanzadas ajenas al objetivo.

---

# Licencia y obligaciones

Incluir una sección explícita sobre la licencia actual de Evolution API.

Verificar la versión y licencia del repositorio oficial que realmente se utilizará.

Documentar especialmente:

- condiciones comerciales;
- obligaciones de atribución;
- condiciones de uso en sistemas cerrados;
- si la implementación propuesta debe incluir una notificación administrativa sobre el uso de Evolution API.

No asumir que “Apache-2.0” significa automáticamente que no existen condiciones adicionales.

---

# Entregables

Debes actualizar o crear los siguientes documentos siguiendo el enfoque SDD utilizado en este proyecto:

## `spec.md`

Debe incluir:

- problema;
- objetivo;
- alcance;
- fuera de alcance;
- arquitectura actual;
- arquitectura propuesta;
- contratos;
- modelo de configuración;
- flujo de mensajes entrantes;
- flujo de mensajes salientes;
- selección del proveedor;
- cambio de proveedor;
- reglas de idempotencia/deduplicación;
- seguridad;
- licencia;
- criterios de aceptación.

## `plan.md`

Debe incluir:

- estrategia de implementación futura;
- fases;
- orden recomendado;
- archivos/componentes afectados según el análisis real;
- migraciones necesarias;
- pruebas;
- estrategia de rollback;
- riesgos.

## `tasks.md`

Debe incluir tareas pequeñas y verificables.

No debe contener tareas de implementación hasta que la especificación sea suficientemente precisa.

Cada tarea debe incluir:

- objetivo;
- archivos/componentes esperados;
- dependencias;
- criterio de aceptación.

---

# Decisiones arquitectónicas

Si encuentras decisiones que no pueden resolverse correctamente a partir del código y la documentación, no las inventes.

Crea una sección:

```text
DECISIONES ABIERTAS
```

Para cada decisión incluye:

1. Decisión necesaria.
2. Alternativas.
3. Recomendación.
4. Impacto.
5. Qué información falta.

---

# Prohibiciones

No debes:

- escribir código;
- modificar código;
- ejecutar migraciones;
- cambiar variables de Railway;
- desplegar Evolution API;
- eliminar Meta;
- modificar el agente IA;
- reescribir el CRM;
- rediseñar el sistema completo;
- agregar una abstracción genérica innecesaria;
- asumir que la versión actual de Evolution API coincide con documentación antigua.

---

# Criterio de calidad

La propuesta será considerada correcta únicamente si después de leer los documentos resultantes un segundo desarrollador puede responder con precisión:

1. Qué debe cambiar.
2. Por qué debe cambiar.
3. Dónde debe cambiar.
4. Cómo se conectará Evolution.
5. Cómo seguirá funcionando Meta.
6. Cómo se selecciona el proveedor.
7. Cómo el pipeline común permanece independiente.
8. Qué decisiones están cerradas.
9. Qué decisiones siguen abiertas.
10. Qué se implementará exactamente en la siguiente fase.

---

# Entrega final

Al terminar, no implementes nada.

Entrega un informe final con:

1. Resumen ejecutivo.
2. Arquitectura propuesta.
3. Documentos creados/modificados.
4. Decisiones cerradas.
5. Decisiones abiertas.
6. Riesgos detectados.
7. Cambios que se requerirán posteriormente para la implementación.
8. Confirmación explícita de que no se modificó código de producción.

Espera la aprobación explícita de la especificación antes de comenzar la implementación.