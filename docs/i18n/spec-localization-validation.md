# Especificación de validación de localización

## Objetivo

Auditar únicamente la implementación de localización existente, sin modificar código ni configuración externa, y producir un informe breve de hallazgos verificables.

## Alcance

- Código de la rama `custom` del repositorio.
- Diccionarios `messages/en.json`, `messages/es.json` y `messages/ko.json`.
- Componentes, páginas, utilidades y pruebas que participen en la interfaz o en la gestión de mensajes.
- Comandos de verificación definidos por el proyecto: `npm run typecheck`, `npm run lint` y `npm test`.

## Restricciones

- No editar código, diccionarios ni pruebas durante la auditoría.
- No corregir hallazgos.
- No hacer `push` ni otras operaciones Git remotas.
- No modificar Railway, Supabase ni otros sistemas externos.
- No solicitar, leer, imprimir ni incluir secretos.
- Mantener la salida de consola no verbose; conservar solo evidencia resumida.

## Procedimiento

1. Confirmar repositorio, rama activa y estado inicial del árbol de trabajo. No sobrescribir cambios preexistentes.
2. Inventariar los tres diccionarios y comparar programáticamente sus claves, incluyendo claves anidadas, para detectar diferencias entre `en`, `es` y `ko`.
3. Localizar todos los usos de traducción y revisar:
   - textos visibles fijos en inglés o español fuera de los diccionarios;
   - `placeholder`, `title`, `aria-label` y atributos equivalentes;
   - Toasts, alertas, confirmaciones y mensajes de estado;
   - manejo de errores de API y respuestas que puedan depender de texto fijo en inglés;
   - usos de `t.raw()` y `t.rich()` frente a usos normales de `t()`.
4. Revisar claves huérfanas: claves presentes en diccionarios pero no referenciadas por la aplicación, distinguiendo referencias dinámicas justificadas de claves realmente no utilizadas.
5. Revisar los mensajes ICU: sintaxis, variables, pluralización, selección, interpolación y consistencia de variables entre idiomas; marcar cualquier mensaje que no pueda validarse estáticamente.
6. Confirmar que nombres propios, IDs, URLs, códigos, identificadores técnicos y contenido introducido por usuarios no se envuelvan indebidamente en traducción.
7. Ejecutar, sin cambios entre comandos:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
8. Comprobar el estado final del árbol de trabajo para confirmar que la auditoría no produjo modificaciones distintas del archivo de esta especificación.

## Criterios de aceptación

- No quedan textos visibles fijos en inglés o español fuera de los diccionarios, o cada excepción queda documentada con archivo y ubicación.
- `placeholder`, `title` y `aria-label` visibles para el usuario están localizados.
- Toasts y confirmaciones usan claves de traducción.
- Los errores de API no dependen de texto fijo en inglés.
- `messages/en.json`, `messages/es.json` y `messages/ko.json` tienen exactamente las mismas claves.
- No existen claves huérfanas sin justificación.
- Los mensajes ICU son válidos y se usan con sus variables correctas.
- `t.raw()` y `t.rich()` se usan solamente para datos que requieren su semántica específica.
- Nombres, IDs, URLs, códigos y contenido del usuario permanecen sin traducir.
- Los tres comandos de verificación terminan exitosamente.

## Evidencia e informe

Registrar solo resultados resumidos: estado por criterio, archivos y ubicaciones de hallazgos, diferencias de claves, errores de ICU o usos incorrectos, y salida final de cada comando. No incluir valores secretos ni contenido sensible. Si una comprobación está limitada por análisis estático o por una referencia dinámica, declararlo explícitamente.

## Resultado

La auditoría se considerará completa únicamente cuando todos los criterios anteriores hayan sido revisados y los comandos hayan sido ejecutados. Los hallazgos se reportarán sin aplicar correcciones.
