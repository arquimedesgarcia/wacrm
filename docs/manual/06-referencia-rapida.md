# 06 — Referencia rápida

> Tablas de consulta, checklist previo al activar y resolución de problemas.

---

## 1. Triggers × compatibilidad

| Trigger | Envía mensajes | Dispara aunque un Flujo consuma | Proveedor |
|---|---|---|---|
| New message received | ✅ | ❌ (suprimido) | Meta + Evolution |
| First inbound message | ✅ | ✅ | Meta + Evolution |
| New contact created | ✅ | ✅ | Meta + Evolution |
| Keyword match | ✅ | ❌ (suprimido) | Meta + Evolution |
| Interactive reply | ✅ | ❌ (suprimido) | **Solo Meta** |
| Tag added | ⚠️ Solo si el contacto tiene conversación | ✅ | Meta + Evolution |
| ~~Conversation assigned~~ | — | ⚠️ Sin despachador: nunca dispara | — |
| ~~Time based~~ | — | ⚠️ Sin despachador: nunca dispara | — |

## 2. Nodos/pasos que suspenden vs auto-avanzan

| Sistema | Suspenden (esperan al cliente) | Auto-avanzan | Terminan |
|---|---|---|---|
| Flujos | Send buttons, Send list, Collect input | Start, Send message, Send media, Condition, Set tag | Handoff, End |
| Automatizaciones | Wait (espera de tiempo, reanuda el cron) | Todo lo demás | (no hay nodo final; la lista termina) |

## 3. Límites de Meta (mensajería interactiva)

| Elemento | Límite |
|---|---|
| Botones por mensaje | 3 |
| Título de botón | 20 caracteres |
| Filas de lista (total, todas las secciones) | 10 |
| Título de fila | 24 caracteres |
| Descripción de fila | 72 caracteres |
| Body/caption | 1024 caracteres |
| Header/footer de botones | 60 caracteres |
| Label del botón de lista | 20 caracteres |
| Media en flujos (bucket flow-media) | 16 MB, MIME permitidos (png/jpeg/webp, mp4/3gpp, Office/PDF/txt) |

## 4. Variables de interpolación

| Placeholder | Dónde | Origen |
|---|---|---|
| `{{ message.text }}` | Automatizaciones (send_message, update_contact_field) | Mensaje que disparó la regla |
| `{{ vars.<nombre> }}` | Automatizaciones | Solo vía `POST /api/automations/engine` (integraciones) |
| `{{vars.clave}}` | Flujos (send_message, prompt de collect_input, caption de media) | Nodo Collect input del mismo run |
| ❌ `{{contact.name}}` etc. | **No existen** | Usa campos personalizados + update_contact_field |

## 5. Estados

**Runs de Flujo:** `active` · `completed` · `handed_off` · `timed_out` · `paused_by_agent` · `failed`
**Logs de Automatización:** `success` · `partial` (terminó en wait) · `failed`
**Conversación:** `open` · `pending` (espera humano) · `closed` (se reabre al escribir el cliente)

## 6. Endpoints y cron

| Endpoint | Para qué | Requisito |
|---|---|---|
| `GET /api/automations/cron` | Reanudar esperas (`wait`), 50 por llamada | Header `x-cron-secret: AUTOMATION_CRON_SECRET` |
| `GET /api/flows/cron` | Cerrar runs abandonados (timeout) | Mismo header |
| `POST /api/automations/engine` | Disparar automatizaciones manualmente / desde integraciones (admite `context.vars`) | Rol ≥ agente |
| `POST /api/flows/[id]/activate` | Activar flujo con validación de servidor | Rol ≥ agente |
| `PUT /api/flows/[id]` | Editar flujo, incl. `fallback_policy` y `assign_to` de handoff (sin UI) | Rol ≥ agente |

**Programación sugerida del pinger:** cada 1-5 minutos para el cron de automatizaciones (volumen alto de esperas); cada 15-60 minutos para el de flujos.

## 7. Checklist antes de activar en producción

- [ ] Nombre y descripción claros; switch Active solo tras probar.
- [ ] Trigger correcto y configurado (keywords sin errores de tipeo; `match_type` adecuado).
- [ ] Etiquetas/pipelines/agentes referenciados existen y son los correctos.
- [ ] Textos dentro de los límites de Meta; botones con reply_ids significativos.
- [ ] Sin condiciones AND/OR esperadas (no existen); cada condición = un test.
- [ ] Los `wait` tienen cron configurado y probado (verificar un log `partial` → `success`).
- [ ] No hay bucle de etiquetas > 3 niveles.
- [ ] No solapa con IA (si hay automatización `new_message_received`/`keyword_match` amplia, la IA se calla) ni con otro flujo del mismo trigger.
- [ ] Handoff definido: ¿quién recibe las conversaciones `pending`?
- [ ] Revisados los logs tras las primeras ejecuciones reales.

## 8. Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| La espera (`wait`) nunca continúa | Sin cron o secret mal configurado | Define `AUTOMATION_CRON_SECRET`; programa pings a `/api/automations/cron`; comprueba que responde 200 |
| El cliente queda "atrapado" y ningún flujo dispara | Run activo sin timeout (cron de flujos caído) | Activa `/api/flows/cron`; revisa Runs y marca/manualmente o espera el timeout |
| Doble respuesta al cliente | Evolution sin supresión, o automatización amplia + IA | Con Meta no debe pasar; con Evolution desactiva IA en esos casos; evita `new_message_received` global si usas IA |
| La IA nunca responde | Una automatización de contenido la silencia; o conversación asignada/pausada; o tope `auto_reply_max_per_conversation` | Revisa triggers activos; desasigna o reactiva "Let AI reply again"; revisa Ajustes → IA |
| El flujo no arranca | Trigger manual (no se auto-dispara), keyword con mayúsculas sensibles, otro run activo, o flujo inactivo | Activa el flujo; revisa `case_sensitive` y match_type; espera al timeout o al cierre del run actual |
| `tag_added` no envía mensaje | El contacto no tiene conversación existente | Envía primero algo que cree conversación, o usa el envío desde el flujo |
| Fallo en paso de webhook | URL privada (SSRF), >10 s, no 2xx | URL pública, respuesta rápida, sin redirects; el fallo detiene la automatización (sin reintentos) |
| Placeholders vacíos en mensajes | Clave inexistente (no hay `{{contact.*}}`) | Usa solo `{{ message.text }}`, `{{ vars.* }}` (Flujos: `{{vars.*}}`) |
| "Fuera de horario" repetido toda la noche | Sin etiqueta antispam | Patrón E del capítulo 04 |
| Trigger *Time based* / *Conversation assigned* no hace nada | Sin despachador implementado | Usa `time_of_day` en condiciones; asigna con el paso *Assign conversation* |
| Plantilla enviada sin rellenar variables | UI no edita `variables` de `send_template` | Envía vía API o ajusta la plantilla en Meta sin variables |
