# Especificación: localización de accesibilidad, placeholders y controles auxiliares

**Estado:** pendiente de aprobación para implementación  
**Rama:** `custom`  
**Fecha:** 2026-09-02  
**Tecnología:** Next.js, React, TypeScript, `next-intl`  
**Idiomas:** `en`, `es`, `ko`

## 1. Objetivo

Convertir en cadenas localizables los textos dirigidos al usuario que actualmente están escritos directamente en `placeholder`, `aria-label`, `title`, tooltips, navegación, controles con iconos y mensajes auxiliares.

La migración no debe traducir datos de negocio, contenido escrito por usuarios, identificadores ni valores técnicos.

## 2. Arquitectura i18n existente

Los diccionarios actuales son:

- `messages/en.json`
- `messages/es.json`
- `messages/ko.json`

La aplicación usa `next-intl` mediante `useTranslations()` en componentes cliente. `en.json` es el catálogo fuente y existen pruebas de paridad en:

- `src/i18n/messages.test.ts`
- `src/i18n/icu-safety.test.ts`

La paridad actual de catálogos debe conservarse.

## 3. Alcance de la auditoría

Se identificaron cadenas fijas en atributos y controles de los siguientes grupos:

### 3.1 Flows y automatizaciones

Archivos:

- `src/components/flows/header.tsx`
- `src/components/flows/forms/node-config-form.tsx`
- `src/components/flows/flow-editor-shell.tsx`
- `src/components/automations/automation-builder.tsx`

Candidatos localizables:

- `Back to Flows`
- `Flow name`
- `Flow description`
- `Add a short description...`
- `Remove section`
- `Move up`
- `Move down`
- `Open menu`
- `Editor view`
- `Pick a tag…`

Los valores `reply_id`, IDs de nodos, claves de variables y expresiones Cron son técnicos y no deben traducirse.

### 3.2 Configuración y plantillas

Archivos:

- `src/components/settings/appearance-panel.tsx`
- `src/components/settings/settings-rail.tsx`
- `src/components/settings/template-manager.tsx`
- `src/components/settings/evolution-config-panel.tsx`
- `src/components/settings/quick-replies-manager.tsx`

Candidatos localizables:

- `Color mode`
- `Settings sections`
- `Header text`
- placeholders descriptivos de Evolution API
- placeholders descriptivos de respuestas rápidas

Valores técnicos que pueden conservarse:

- URLs de ejemplo;
- `en_US` como código de idioma de plantilla;
- nombres de proveedores;
- nombres de APIs;
- nombres de instancias;
- nombres de campos o códigos técnicos.

### 3.3 Contactos, notificaciones y difusiones

Archivos:

- `src/app/(dashboard)/contacts/page.tsx`
- `src/app/(dashboard)/notifications/page.tsx`
- `src/app/(dashboard)/broadcasts/page.tsx`
- `src/app/(dashboard)/automations/page.tsx`

Candidatos localizables:

- `Unread`
- `Select all contacts on this page`
- `Filter by {tag}`
- `Remove {tag} filter`
- `Broadcast in progress`
- `Open menu`
- `active`

Los nombres de contactos, etiquetas y automatizaciones son datos del usuario. Solo se debe traducir el texto envolvente, usando interpolación.

### 3.4 Navegación y componentes auxiliares

Archivos:

- `src/components/layout/sidebar.tsx`
- `src/components/flows/validation-panel.tsx`
- `src/components/inbox/`
- `src/components/broadcasts/`
- `src/components/contacts/`

Candidatos localizables:

- `Primary`
- fallbacks de `aria-label` como `Jump to node {key}`;
- textos de botones iconográficos que no estén usando traducciones;
- tooltips y títulos auxiliares escritos directamente.

## 4. Clasificación obligatoria

Durante la implementación, cada coincidencia deberá clasificarse como una de estas categorías:

1. **Interfaz:** debe usar `t(...)`.
2. **Accesibilidad:** debe usar `t(...)` y mantenerse semánticamente equivalente.
3. **Ejemplo técnico:** puede permanecer fijo si no es una frase dirigida al usuario; si es descriptivo, debe traducirse.
4. **Valor técnico:** no traducir.
5. **Contenido del usuario:** no traducir.
6. **Código, ID, URL o formato:** no traducir.
7. **Comentario o texto no renderizado:** no requiere migración.

## 5. Namespaces propuestos

Las claves nuevas deben agruparse por funcionalidad y no por componente visual:

```text
Flows.accessibility
Flows.header
Flows.controls
Automations.accessibility
Settings.accessibility
Settings.templates
Settings.evolution
Contacts.accessibility
Notifications.accessibility
Broadcasts.accessibility
Common.accessibility
Common.placeholders
```

Los nombres exactos deben ajustarse al catálogo existente para evitar duplicados semánticos.

Ejemplos de claves:

```text
Flows.header.back
Flows.header.namePlaceholder
Flows.header.descriptionPlaceholder
Flows.header.descriptionAria
Flows.header.unsavedChangesTitle
Flows.controls.removeSection
Flows.controls.moveUp
Flows.controls.moveDown
Flows.controls.openMenu
Settings.accessibility.colorMode
Settings.accessibility.sections
Contacts.accessibility.selectAllPage
Contacts.accessibility.filterByTag
Contacts.accessibility.removeTagFilter
Broadcasts.accessibility.inProgress
```

## 6. Parámetros e ICU

Las cadenas con datos variables deben usar parámetros:

```tsx
 t('filterByTag', { tag: tag.name })
```

No se deben concatenar frases traducibles manualmente si la estructura puede variar entre idiomas.

Los IDs literales como `reply_id`, `{{1}}` y URLs de ejemplo deben conservarse como valores interpolados o literales técnicos según el caso.

## 7. Tratamiento de fallbacks

No se deben conservar fallbacks fijos en inglés dentro de atributos de accesibilidad:

```tsx
aria-label={condition ? t('jumpToNode', { key }) : `Jump to node ${key}`}
```

Debe existir una única fuente traducible. Si el traductor no está disponible en un componente reutilizable, se debe rediseñar la interfaz para recibir el texto ya localizado o usar el mecanismo compatible de `next-intl`.

No se deben usar claves traducibles dinámicas sin una lista controlada de valores.

## 8. Estrategia de implementación posterior

La implementación deberá ejecutarse en este orden:

1. Añadir las claves en `messages/en.json`.
2. Añadir las mismas claves traducidas en `messages/es.json` y `messages/ko.json`.
3. Migrar atributos `aria-label`, `title` y placeholders.
4. Migrar textos de botones y controles auxiliares.
5. Migrar tooltips y fallbacks.
6. Revisar que el texto dinámico del usuario no se traduzca.
7. Ejecutar la búsqueda de regresión para detectar nuevos literales.

No se deben hacer refactorizaciones no relacionadas con localización.

## 9. Pruebas requeridas

Como mínimo:

```bash
npm run typecheck
npm run lint
npm test -- src/i18n/messages.test.ts src/i18n/icu-safety.test.ts
```

Además, deben añadirse o actualizarse pruebas para verificar:

- paridad de claves entre los tres diccionarios;
- interpolación correcta de etiquetas, nombres e IDs;
- `aria-label` traducido en cada locale;
- placeholders traducidos;
- ausencia de fallbacks fijos en inglés;
- conservación de URLs, IDs, códigos y valores técnicos;
- ausencia de errores ICU.

## 10. Posible automatización preventiva

Después de la migración se recomienda añadir un detector estático para revisar:

- `placeholder="..."` con frases;
- `aria-label="..."`;
- `title="..."`;
- textos literales dentro de JSX;
- labels de botones;
- tooltips fijos.

El detector debe permitir una lista explícita de excepciones para URLs, códigos, IDs, nombres de proveedores, formatos y contenido técnico.

## 11. Criterios de aceptación

- Los textos dirigidos al usuario en `placeholder`, `aria-label` y `title` cambian al seleccionar `en`, `es` o `ko`.
- Los controles con iconos tienen nombres accesibles localizados.
- No quedan frases fijas de interfaz en inglés o español dentro del alcance definido.
- Los nombres, etiquetas, URLs, IDs, códigos y contenido del usuario no son traducidos accidentalmente.
- `messages/en.json`, `messages/es.json` y `messages/ko.json` tienen exactamente las mismas claves.
- No se introducen usos incorrectos de `t()`, `t.raw()` o `t.rich()`.
- TypeScript, ESLint y las pruebas de i18n pasan.
- No se modifican Railway, Supabase ni configuraciones externas.

## 12. Decisión pendiente

Esta especificación debe ser revisada y aprobada antes de modificar código.

No se debe comenzar la implementación hasta recibir autorización explícita.
