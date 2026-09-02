# Validación: estado de conexión en el panel Evolution API

## Resultado de la validación

El panel **muestra correctamente el estado al entrar en la mayoría de los
casos**, gracias a que el webhook de Evolution sincroniza
`whatsapp_config.status` (`syncConfigStatus` en
`src/app/api/whatsapp/evolution/webhook/route.ts`). Sin embargo, se
comprobó una **brecha de sincronización real** que puede producir estados
obsoletos en ambos sentidos.

## Causa comprobada

Doble fuente de verdad sin puente entre ellas:

1. `WhatsAppConfig.fetchConfig()` (`whatsapp-config.tsx:166-197`) ya
   consulta el estado **en vivo** vía `GET /api/whatsapp/evolution/config`
   (que a su vez ejecuta `EvolutionAdapter.getConnectionStatus()` →
   `connectionState === 'open'` en vivo), pero guarda el resultado en el
   estado `connectionStatus` **del contenedor**, que en la rama Evolution
   **no se renderiza ni se propaga**.
2. `EvolutionConfigPanel` inicializa su propio `connectionStatus` desde
   `initialConfig?.status` (campo **almacenado** en Supabase,
   `evolution-config-panel.tsx:31-33`) mediante `useState`, una sola vez
   al montar, y jamás recibe el resultado live del padre.

### Consecuencias

- **Falso positivo**: la instancia se desconecta y el webhook aún no
  procesó/sincronizó el evento (o hubo un reinicio sin evento) → el panel
  muestra "Connected" obsoleto hasta pulsar *Test Connection*.
- **Falso negativo**: el campo `status` almacenado quedó en
  `disconnected` (p. ej. emparejamiento completado desde el móvil sin que
  el último evento webhook se haya procesado) → el panel muestra
  "Not connected" aunque la instancia esté en línea.
- El handler `onConfigChange` del padre mezcla además el estado
  almacenado (`next.status`) con el live, reforzando la divergencia.

## Secuencia de montaje y carga (actual)

1. `WhatsAppConfig` espera auth + profile, llama `fetchConfig(accountId)`.
2. Carga la fila `whatsapp_config`; si `provider === 'evolution'`, hace
   health check live → guarda en estado **del padre** (invisible en rama
   Evolution).
3. `loading` termina → renderiza `EvolutionConfigPanel` con
   `initialConfig` → el panel fija `connectionStatus` desde el `status`
   almacenado.
4. Resultado live del paso 2 nunca llega al panel.

## Fuente de verdad

- **En vivo** (lo que ve el usuario): `GET /api/whatsapp/evolution/config`
  → `EvolutionAdapter.getConnectionStatus()`.
- **Almacenado** (`whatsapp_config.status`): mejor esfuerzo, sincronizado
  por webhook; puede ir retrasado.

El panel debe mostrar el valor **en vivo** cuando esté disponible y caer
al almacenado solo como valor inicial antes de que la comprobación live
termine.

## Ajuste aplicado (mínimo)

En `whatsapp-config.tsx`:

- Pasar al panel `liveStatus` / `liveStatusMessage` desde el estado del
  padre (que `fetchConfig` ya obtiene del endpoint Evolution), **solo
  cuando `config?.provider === 'evolution'`** para no cruzar estados de
  Meta cuando el usuario abre la pestaña Evolution sin configuración
  Evolution guardada (evita falsos positivos cruzados).

En `evolution-config-panel.tsx`:

- Nuevas props opcionales `liveStatus` / `liveStatusMessage`.
- `useEffect` que adopta el valor live cuando llega: omite `'unknown'`,
  guarda con comparación de igualdad antes de `setState`. Sin loops
  (dependencias de props, no de estado), no sobrescribe entradas del
  formulario (solo estado de presentación), y no marca conexión por
  defecto ( `'unknown'` no implica conectado).

Comportamiento de Meta: sin cambios (rama Meta no usa estas props).

## Tests de regresión

El repo no tiene infraestructura de tests de componentes (sin
Testing Library/jsdom). Cobertura aplicable:

- `npm run typecheck`, `npm run lint` (0 errores).
- `npm test`: suite existente (incluye `evolution/webhook/route.test.ts`,
  que cubre la sincronización de `whatsapp_config.status` por webhook).
- Verificación manual: entrar en Configuración → WhatsApp → Evolution con
  la instancia conectada (debe mostrar *Connected* sin pulsar nada) y con
  la instancia detenida (debe mostrar *Not connected* con el mensaje real
  del health check).

## Criterios de aceptación

1. Con instancia Evolution conectada, el panel muestra "Connected" al
   entrar, sin pulsar *Test Connection*.
2. Con instancia caída, muestra "Not connected" con el mensaje del health
   check live, aunque el `status` almacenado diga `connected`.
3. Sin configuración Evolution (fila Meta o sin fila), la pestaña
   Evolution muestra "Not connected / Configure and save to connect."
4. Sin llamadas al endpoint de Meta desde la rama Evolution ni al de
   Evolution desde la rama Meta.
5. Sin loops de renderizado ni sobrescritura de campos editables.
6. `typecheck`/`lint`/tests en verde (salvo fallos preexistentes de
   locale en `currency`/`date-utils`, ya documentados).
