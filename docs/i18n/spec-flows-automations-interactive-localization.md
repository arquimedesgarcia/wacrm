# spec-flows-automations-interactive-localization.md

**Scope:** Convert hardcoded UI strings in the Flows editor, Automations builder, and Interactive message builder/preview into stable `next-intl` keys across `en`, `es`, and `ko`.

**Status:** draft, pending approval. No code changes until explicit authorization.

---

## 1. Summary

The Flows editor namespace (`Flows.*`) and Automations builder namespace (`Automations.*`) are already largely wired to `useTranslations` in `en.json`/`es.json`/`ko.json`. However, several files still contain hardcoded English strings that bypass the catalogue:

- `src/components/flows/header.tsx` — a new `EditorHeader` component with zero localization calls.
- `src/components/flows/forms/node-config-form.tsx` — a few hardcoded labels, aria-labels, and toast messages.
- `src/components/flows/flow-editor-state.tsx` — catch-block error messages and the delete confirmation.
- `src/components/flows/flow-editor-shell.tsx` — one hardcoded `aria-label`.
- `src/components/flows/shared.tsx` + `src/lib/flows/edges.ts` — `summarizeNode` fallbacks and `outgoingSlots` labels ("Next", "true", "false") are hardcoded.
- `src/lib/flows/validate.ts` — validation `message` fields are hardcoded English, rendered raw by `ValidationPanel`.
- `src/components/automations/automation-builder.tsx` — step category badges ("Condition", "Wait", "Action"), move-up/down aria-labels, a placeholder, a trigger label, and `previewFor` fallbacks.
- `src/components/interactive/interactive-builder.tsx` — **entirely unlocalized**, no `useTranslations` calls.
- `src/components/interactive/interactive-preview.tsx` — **entirely unlocalized**, hardcoded fallback text.
- `src/lib/whatsapp/interactive.ts` — `validateInteractivePayload` returns hardcoded English error strings, rendered raw by `interactive-builder.tsx`.
- `src/lib/whatsapp/meta-api.ts` — `INTERACTIVE_LIMITS` validation throws are server-side technical errors (not in scope — already covered by `Errors.apiErrors.*` on the server side).

---

## 2. Files in scope

**UI components:**
- `src/components/flows/header.tsx`
- `src/components/flows/validation-panel.tsx`
- `src/components/flows/flow-builder.tsx`
- `src/components/flows/flow-canvas.tsx`
- `src/components/flows/flow-editor-shell.tsx`
- `src/components/flows/flow-editor-state.tsx`
- `src/components/flows/forms/fields.tsx`
- `src/components/flows/forms/node-config-form.tsx`
- `src/components/flows/shared.tsx`
- `src/components/automations/automation-builder.tsx`
- `src/components/interactive/interactive-builder.tsx`
- `src/components/interactive/interactive-preview.tsx`

**Library files:**
- `src/lib/flows/validate.ts`
- `src/lib/whatsapp/interactive.ts`
- `src/lib/flows/edges.ts`

**Translation dictionaries:**
- `messages/en.json` (source of truth)
- `messages/es.json`, `messages/ko.json` (must mirror every new key)

**Tests:**
- `src/lib/flows/validate.test.ts`
- `src/lib/whatsapp/interactive.test.ts`
- `src/i18n/messages.test.ts` (parity — already exists)
- `src/i18n/icu-safety.test.ts` (ICU hosting — already exists)

---

## 3. Inventory classified

### 3.1 `src/components/flows/header.tsx` — `EditorHeader` + `StatusChip`

Currently has **no** `useTranslations` call.

| Text | Type | Proposed key |
|---|---|---|
| `"Back to Flows"` (title + aria-label) | UI | `Flows.header.backToFlows` |
| `"Flow name"` (placeholder + aria-label) | UI | `Flows.header.flowName` |
| `"Edited"` (dirty indicator) | UI | `Flows.header.edited` |
| `"Unsaved changes — hit Save to persist"` (title) | UI | `Flows.header.unsavedChanges` |
| `"Runs"` (button label) | UI | `Flows.header.runs` |
| `"Delete"` (button label) | UI | `Flows.header.delete` |
| `"Pause"` (button label) | UI | `Flows.header.pause` |
| `"Activate"` (button label) | UI | `Flows.header.activate` |
| `"Save"` (button label) | UI | `Flows.header.save` |
| `"Fix the issues below before activating"` (title tooltip) | UI | `Flows.header.fixIssuesBeforeActivating` |
| `"Draft"` (StatusChip label) | UI | `Flows.header.statusDraft` |
| `"Active"` (StatusChip label) | UI | `Flows.header.statusActive` |
| `"Archived"` (StatusChip label) | UI | `Flows.header.statusArchived` |
| `"Add a short description (internal — customers don't see this)"` (placeholder) | UI | `Flows.header.descriptionPlaceholder` |
| `"Flow description"` (aria-label) | UI | `Flows.header.descriptionAria` |

### 3.2 `src/components/flows/validation-panel.tsx`

Already uses `useTranslations("Flows.validation")`.

| Text | Type | Notes |
|---|---|---|
| `IssueLine` fallback: `` `Jump to node ${issue.node_key}` `` | UI (fallback) | Line 112 — only used when `t` prop is undefined. The `ValidationPanel` always passes `t`, but the fallback should be removed in favor of always using `t("jumpToNode", { key })`. Key already exists. |
| `issue.message` (rendered raw) | Validation msg | All issue messages from `validate.ts` are hardcoded English. See §3.9. |

### 3.3 `src/components/flows/forms/node-config-form.tsx`

Uses `useTranslations("Flows.builder.form")`.

| Text | Type | Proposed key |
|---|---|---|
| `"Body text"` (label, line 459) | UI | `Flows.builder.form.bodyText` (already exists, currently unused here) |
| `"Remove section"` (aria-label, line 501) | UI | `Flows.builder.form.removeSectionAria` |
| `"File is {size} MB — limit is 16 MB."` (toast.error, line 916) | UI + ICU | `Flows.builder.form.fileTooLarge` with `{size}` |
| `"File uploaded."` (toast.success, line 931) | UI | Reuse `Errors.apiErrors.file_uploaded` — already exists |
| `"Upload failed."` (fallback, line 934) | UI | Reuse `Errors.apiErrors.upload_failed` — already exists |

### 3.4 `src/components/flows/flow-editor-state.tsx`

Uses `useTranslations("Flows.editorState")`.

| Text | Type | Proposed key |
|---|---|---|
| `` `Save failed: ${res.status}` `` (line 349) | Error/UI | `Flows.editorState.saveFailed` + ICU `{status}` |
| `"Save failed"` (fallback, line 354) | Error/UI | `Flows.editorState.saveFailed` |
| `` `Status update failed: ${res.status}` `` (line 383) | Error/UI | `Flows.editorState.statusUpdateFailed` + ICU `{status}` |
| `"Status update failed"` (fallback, line 394) | Error/UI | `Flows.editorState.statusUpdateFailed` |
| `` `Delete "${state.name}"? Any active runs end immediately. This can't be undone.` `` (line 406) | UI confirm | `Flows.editorState.deleteConfirm` with ICU `{name}` |
| `` `Delete failed: ${res.status}` `` (line 413) | Error/UI | `Flows.editorState.deleteFailed` + ICU `{status}` |
| `"Delete failed"` (fallback, line 416) | Error/UI | `Flows.editorState.deleteFailed` |

### 3.5 `src/components/flows/flow-editor-shell.tsx`

Uses `useTranslations("Flows.builder")`.

| Text | Type | Proposed key |
|---|---|---|
| `"Editor view"` (aria-label, line 109) | UI | `Flows.builder.editorViewAria` |

### 3.6 `src/components/flows/shared.tsx`

`summarizeNode` accepts an optional `t` function. Fallback strings (used when `t` is not provided) are hardcoded English. `outgoingSlots` in `edges.ts` returns hardcoded labels.

| Text | Type | Proposed key |
|---|---|---|
| `"Next"` (from `outgoingSlots` in edges.ts, line 182) | UI | `Flows.edges.next` |
| `"true"` / `"false"` (from `outgoingSlots`, lines 186-187) | UI | `Flows.edges.true` / `Flows.edges.false` |
| `summarizeNode` fallbacks (e.g. "has tag", "contains", "exists", "missing", "Media", "Image", "Video", "Document", "Audio", "no file uploaded") | Fallback | Already covered by `Flows.summary.*` keys. Fallbacks are TECH (used when `t` is null). |

### 3.7 `src/components/flows/forms/fields.tsx`

Uses `useTranslations("Flows.builder.form")`.

| Text | Type | Notes |
|---|---|---|
| `"—"` (placeholder fallback, line 116) | UI | Replace with `t("none")` (key already exists) or `Common` equivalent. |

### 3.8 `src/components/flows/flow-builder.tsx` and `flow-canvas.tsx`

Already fully localized via `useTranslations`. No hardcoded UI strings found. The `summarizeNode` call already receives the `t` translator.

### 3.9 `src/lib/flows/validate.ts`

`ValidationIssue.message` is a hardcoded English string rendered raw by `ValidationPanel`. There are ~40 distinct messages. Proposed approach: add an optional `t` parameter to `validateFlowForActivation`, with message keys under `Flows.validation.issues.*`.

**Key validation messages to extract:**

| Current hardcoded message | Proposed key | ICU params |
|---|---|---|
| `"Flow name is required."` | `Flows.validation.issues.flowNameRequired` | — |
| `"Pick an entry node before activating."` | `Flows.validation.issues.entryNodeRequired` | — |
| ``"A flow needs at least one node before activation."`` | `Flows.validation.issues.noNodes` | — |
| `` `Entry node "${id}" doesn't exist.` `` | `Flows.validation.issues.entryNodeMissing` | `{key}` |
| `` `Duplicate node_key "${key}".` `` | `Flows.validation.issues.duplicateNodeKey` | `{key}` |
| `` `Node "${key}" is unreachable from the entry node.` `` | `Flows.validation.issues.unreachableNode` | `{key}` |
| `"Start node must point to a next node."` | `Flows.validation.issues.startNoNext` | — |
| `` `Start points to non-existent node "${id}".` `` | `Flows.validation.issues.startBadNext` | `{key}` |
| `"Send-message node needs a text body."` | `Flows.validation.issues.sendMessageNoText` | — |
| `"Send-message node must point to a next node."` | `Flows.validation.issues.sendMessageNoNext` | — |
| `` `Send-message points to non-existent node "${id}".` `` | `Flows.validation.issues.sendMessageBadNext` | `{key}` |
| `"Send-media node needs a media type..."` | `Flows.validation.issues.mediaNoType` | — |
| `"Send-media node needs a file..."` | `Flows.validation.issues.mediaNoFile` | — |
| `` `Caption exceeds ${N} chars...` `` | `Flows.validation.issues.captionTooLong` | `{limit}` |
| `"Send-media node must point to a next node."` | `Flows.validation.issues.mediaNoNext` | — |
| `` `Send-media points to non-existent node "${id}".` `` | `Flows.validation.issues.mediaBadNext` | `{key}` |
| `"Send-buttons node needs a text body."` | `Flows.validation.issues.buttonsNoText` | — |
| `"Send-buttons needs at least one button."` | `Flows.validation.issues.buttonsNoButtons` | — |
| `` `WhatsApp allows at most ${N} buttons...` `` | `Flows.validation.issues.buttonsTooMany` | `{limit}` |
| `` `Button ${n} needs a reply id.` `` | `Flows.validation.issues.buttonNoId` | `{index}` |
| `` `Duplicate button reply id "${id}".` `` | `Flows.validation.issues.buttonDuplicateId` | `{key}` |
| `` `Button ${n} needs a title.` `` | `Flows.validation.issues.buttonNoTitle` | `{index}` |
| `` `Button ${n} title is over ${N} chars...` `` | `Flows.validation.issues.buttonTitleTooLong` | `{index}`, `{limit}` |
| `` `Button ${n} needs a next node.` `` | `Flows.validation.issues.buttonNoNext` | `{index}` |
| `` `Button ${n} points to non-existent node "${id}".` `` | `Flows.validation.issues.buttonBadNext` | `{index}`, `{key}` |
| `"Send-list node needs a text body."` | `Flows.validation.issues.listNoText` | — |
| `"Send-list needs a button label..."` | `Flows.validation.issues.listNoButtonLabel` | — |
| `"Send-list needs at least one row."` | `Flows.validation.issues.listNoRows` | — |
| `` `Send-list allows at most ${N} rows...` `` | `Flows.validation.issues.listTooManyRows` | `{limit}` |
| `` `Row ${n} in section ${s} needs a reply id.` `` | `Flows.validation.issues.rowNoId` | `{index}`, `{section}` |
| `` `Duplicate list row id "${id}".` `` | `Flows.validation.issues.rowDuplicateId` | `{key}` |
| `` `Row ${n} needs a title.` `` | `Flows.validation.issues.rowNoTitle` | `{index}` |
| `` `Row ${n} title exceeds ${N} chars...` `` | `Flows.validation.issues.rowTitleTooLong` | `{index}`, `{limit}` |
| `` `Row ${n} description exceeds ${N} chars...` `` | `Flows.validation.issues.rowDescTooLong` | `{index}`, `{limit}` |
| `` `Row ${n} needs a next node.` `` | `Flows.validation.issues.rowNoNext` | `{index}` |
| `` `Row ${n} points to non-existent node "${id}".` `` | `Flows.validation.issues.rowBadNext` | `{index}`, `{key}` |
| `"Collect-input needs a prompt..."` | `Flows.validation.issues.collectNoPrompt` | — |
| `"Collect-input needs a var_key..."` | `Flows.validation.issues.collectNoVarKey` | — |
| `` `var_key "${key}" must be alphanumeric...` `` | `Flows.validation.issues.collectBadVarKey` | `{key}` |
| `"Collect-input must point to a next node."` | `Flows.validation.issues.collectNoNext` | — |
| `"Collect-input points to non-existent node..."` | `Flows.validation.issues.collectBadNext` | `{key}` |
| `"Condition needs a subject..."` | `Flows.validation.issues.conditionNoSubject` | — |
| `"Condition needs a subject_key..."` | `Flows.validation.issues.conditionNoSubjectKey` | — |
| `"Condition needs an operator."` | `Flows.validation.issues.conditionNoOperator` | — |
| `` `Operator "${op}" usually expects...` `` | `Flows.validation.issues.conditionEmptyValue` | `{operator}` |
| `` `Condition needs a node for the "${branch}" branch.` `` | `Flows.validation.issues.conditionNoBranch` | `{branch}` |
| `` `Condition's "${branch}" points to...` `` | `Flows.validation.issues.conditionBadBranch` | `{branch}`, `{key}` |
| `"Set-tag needs a mode..."` | `Flows.validation.issues.setTagNoMode` | — |
| `"Set-tag needs a tag to apply."` | `Flows.validation.issues.setTagNoTag` | — |
| `"Set-tag must point to a next node."` | `Flows.validation.issues.setTagNoNext` | — |
| `"Set-tag points to non-existent node..."` | `Flows.validation.issues.setTagBadNext` | `{key}` |
| `` `Unknown node type "${type}".` `` | `Flows.validation.issues.unknownNodeType` | `{type}` |
| `"Keyword triggers need at least one keyword."` | `Flows.validation.issues.keywordNoKeywords` | — |
| `` `${blanks} keyword${...} is/are blank...` `` | `Flows.validation.issues.keywordBlank` | `{count}` |

**Approach:** Add an optional `t` parameter to `validateFlowForActivation` matching the `summarizeNode` signature: `(key: string, values?: Record<string, string | number>) => string`. Each `message` becomes `t('issues.<key>', { ...params })` with an English fallback when `t` is undefined (for server-side/test contexts).

### 3.10 `src/components/automations/automation-builder.tsx`

Uses `useTranslations("Automations.builder")`.

| Text | Type | Proposed key |
|---|---|---|
| `"Untitled automation"` (line 705, fallback) | UI | `Automations.builder.untitledAutomation` (new key; `untitled` already exists but is more generic) |
| `"Tag"` (line 864, label for tag_added trigger) | UI | `Automations.builder.triggerTagLabel` |
| `"Cron expression or HH:mm"` (line 879, placeholder) | UI | `Automations.builder.cronPlaceholder` |
| `"Condition"` / `"Wait"` / `"Action"` (line 1136, step category badge) | UI | `Automations.builder.stepCategoryCondition`, `stepCategoryWait`, `stepCategoryAction` |
| `"Move up"` (line 1157, aria-label) | UI | `Automations.builder.moveUpAria` |
| `"Move down"` (line 1166, aria-label) | UI | `Automations.builder.moveDownAria` |
| `previewFor` fallbacks: `"no text yet"`, `"no body yet"`, `"pick a template"`, `"no url"`, `"?"` (lines 1531–1549) | UI preview | `Automations.builder.preview.noText`, `preview.noBody`, `preview.pickTemplate`, `preview.noUrl` |

### 3.11 `src/components/interactive/interactive-builder.tsx`

**Zero localization.** Needs `useTranslations("Interactive.builder")`.

| Text | Type | Proposed key |
|---|---|---|
| `"Reply buttons"` (KindButton label) | UI | `Interactive.builder.replyButtons` |
| `"List"` (KindButton label) | UI | `Interactive.builder.list` |
| `"Body"` (Field label) | UI | `Interactive.builder.bodyLabel` |
| `"What the customer reads above the options"` (placeholder) | UI | `Interactive.builder.bodyPlaceholder` |
| `"Header (optional)"` (Field label) | UI | `Interactive.builder.headerLabel` |
| `"Footer (optional)"` (Field label) | UI | `Interactive.builder.footerLabel` |
| `"Buttons ({count}/{max})"` (label, ICU) | UI | `Interactive.builder.buttonsCount` with `{count}`, `{max}` |
| `"id"` (placeholder for button/row id) | Technical | Keep as-is — field name, not UI |
| `"Button label"` (placeholder) | UI | `Interactive.builder.buttonTitlePlaceholder` |
| `"Add button"` (button) | UI | `Interactive.builder.addButton` |
| `"List button label"` (Field label) | UI | `Interactive.builder.listButtonLabel` |
| `"Rows ({total}/{max})"` (label, ICU) | UI | `Interactive.builder.rowsCount` with `{total}`, `{max}` |
| `"Section title (optional)"` (placeholder) | UI | `Interactive.builder.sectionTitlePlaceholder` |
| `"Remove section"` (aria-label) | UI | `Interactive.builder.removeSectionAria` |
| `"Row title"` (placeholder) | UI | `Interactive.builder.rowTitlePlaceholder` |
| `"Description (optional)"` (placeholder) | UI | `Interactive.builder.rowDescriptionPlaceholder` |
| `"Add row"` (button) | UI | `Interactive.builder.addRow` |
| `"Add section"` (button) | UI | `Interactive.builder.addSection` |
| `"Show reply IDs (advanced)"` (checkbox label) | UI | `Interactive.builder.showReplyIds` |
| `"Preview"` (span text) | UI | `Interactive.builder.preview` |

### 3.12 `src/components/interactive/interactive-preview.tsx`

**Zero localization.** Comment says "Kept namespace-free (plain English) so it can be dropped into the composer, the automation builder, and the quick-replies manager without namespace coupling."

Proposed approach: add `useTranslations("Interactive.preview")` since the component is always used in a browser context.

| Text | Type | Proposed key |
|---|---|---|
| `"Message body…"` (fallback span, line 39) | UI | `Interactive.preview.emptyBody` |
| `"Button"` (fallback span, line 59) | UI | `Interactive.preview.emptyButton` |
| `"Menu"` (fallback span, line 70) | UI | `Interactive.preview.emptyMenu` |

### 3.13 `src/lib/whatsapp/interactive.ts`

`validateInteractivePayload` returns `{ ok: true } | { ok: false; error: string }`. The `error` string is hardcoded English and rendered directly in `interactive-builder.tsx` line 167.

**Proposed approach:** Add an optional `t` parameter matching the `validateInteractivePayload` signature. Each `fail(error)` call becomes `fail(t ? t('issues.<key>', { ...params }) : fallbackEnglish)`.

| Current hardcoded error | Proposed key | ICU params |
|---|---|---|
| `"Interactive message payload is required."` | `Interactive.validation.payloadRequired` | — |
| `"Interactive message body text is required."` | `Interactive.validation.bodyRequired` | — |
| `` `Body text exceeds the ${N}-char limit.` `` | `Interactive.validation.bodyTooLong` | `{limit}` |
| `` `Header exceeds the ${N}-char limit.` `` | `Interactive.validation.headerTooLong` | `{limit}` |
| `` `Footer exceeds the ${N}-char limit.` `` | `Interactive.validation.footerTooLong` | `{limit}` |
| `"Add at least one reply button."` | `Interactive.validation.needButton` | — |
| `` `A reply-button message allows at most ${N} buttons.` `` | `Interactive.validation.tooManyButtons` | `{limit}` |
| `"Every button needs an id."` | `Interactive.validation.buttonNoId` | — |
| `` `Duplicate button id "${id}".` `` | `Interactive.validation.buttonDuplicateId` | `{id}` |
| `"Every button needs a label."` | `Interactive.validation.buttonNoLabel` | — |
| `` `Button label "${title}" exceeds ${N} chars.` `` | `Interactive.validation.buttonLabelTooLong` | `{title}`, `{limit}` |
| `"The list needs a button label."` | `Interactive.validation.listNoButtonLabel` | — |
| `` `List button label exceeds ${N} chars.` `` | `Interactive.validation.listButtonLabelTooLong` | `{limit}` |
| `"Add at least one list section."` | `Interactive.validation.needSection` | — |
| `` `A list allows at most ${N} sections.` `` | `Interactive.validation.tooManySections` | `{limit}` |
| `"Every list section needs rows."` | `Interactive.validation.sectionNoRows` | — |
| `"Every list row needs an id."` | `Interactive.validation.rowNoId` | — |
| `` `Duplicate list row id "${id}".` `` | `Interactive.validation.rowDuplicateId` | `{id}` |
| `"Every list row needs a title."` | `Interactive.validation.rowNoTitle` | — |
| `` `List row title "${title}" exceeds ${N} chars.` `` | `Interactive.validation.rowTitleTooLong` | `{title}`, `{limit}` |
| `` `List row description exceeds ${N} chars.` `` | `Interactive.validation.rowDescTooLong` | `{limit}` |
| `"Add at least one list row."` | `Interactive.validation.needRow` | — |
| `` `A list allows at most ${N} rows in total.` `` | `Interactive.validation.tooManyRows` | `{limit}` |
| `"Interactive message must be reply buttons or a list."` | `Interactive.validation.badKind` | — |

The existing `interactive.test.ts` asserts on exact `error` strings (e.g. line 80: `expect(res).toEqual({ ok: false, error: 'Duplicate button id "dup".' })`). These tests must be updated to either:
- Call without `t` and still expect the English fallback, or
- Call with a mock `t` and assert on the translated key.

### 3.14 `src/lib/flows/validate.test.ts`

Same issue as above. The test asserts on `scope`, `field`, and partial `message` matches. If messages become translated, the test should pass a `t` function (or none, getting English fallback) and assert on `scope`/`field` rather than exact `message` strings.

---

## 4. Data that must NOT be translated

| Category | Examples in scope | Reason |
|---|---|---|
| Node keys | `"start"`, `"menu"`, `"ho"`, `"node_key"`, `"next_node_key"` | Internal identifiers; rendered in `<code>` badges |
| Button reply IDs | `"btn_1"`, `"yes"`, `"no"`, `"more_info"` | WhatsApp returns these verbatim in webhooks |
| Row reply IDs | `"row_1"`, `"row_2"`, `"seo"`, `"ads"` | Same — WhatsApp echoes these |
| Step config field names | `"text"`, `"button_label"`, `"footer_text"`, `"media_url"`, `"var_key"`, `"subject_key"`, `"reply_id"` | Technical config keys |
| Cron expressions | `"0 9 * * 1-5"` | Expression syntax |
| User-entered values | Flow name, description, button titles, body text, footer text, prompt text, caption, filename, var_key, tag UUID, subject_key, contact field values, URLs, template names | These are DATA sent to WhatsApp, not UI |
| Technical constants | `"__none__"` sentinel value in NodeKeySelect | Internal plumbing |
| `INTERACTIVE_LIMITS` constants | Numbers like `1024`, `20`, `24`, `72`, `10`, `3` | Rendered in labels like `"≤24"` or interpolated programmatically, not via ICU |
| `interactivePayloadPreviewText` fallback | `"[buttons]"`, `"[list]"` | Technical fallback used in DB column `last_message_text` |

---

## 5. Proposed namespaces and keys

### 5.1 New top-level namespace: `Interactive`

```
Interactive.builder.*     — interactive-builder.tsx strings
Interactive.preview.*     — interactive-preview.tsx fallback strings
Interactive.validation.*  — validateInteractivePayload error codes
```

### 5.2 Extend `Flows` namespace

| New sub-namespace | Contents |
|---|---|
| `Flows.header` | All `EditorHeader` + `StatusChip` strings (§3.1) |
| `Flows.editorState` | Error messages + delete confirm (§3.4 — extend existing) |
| `Flows.builder` | `editorViewAria`, `form.bodyText` (already exists, wire it), `form.removeSectionAria`, `form.fileTooLarge` (extend existing) |
| `Flows.edges` | Canvas edge labels: `next`, `true`, `false` (§3.6) |
| `Flows.validation.issues.*` | Validation issue messages (§3.9 — extend existing `Flows.validation`) |

### 5.3 Extend `Automations` namespace

| New keys (under existing `Automations.builder`) | Purpose |
|---|---|
| `untitledAutomation` | Fallback name |
| `triggerTagLabel` | "Tag" label for tag_added trigger |
| `cronPlaceholder` | Cron input placeholder |
| `stepCategoryCondition` | "Condition" badge |
| `stepCategoryWait` | "Wait" badge |
| `stepCategoryAction` | "Action" badge |
| `moveUpAria` | aria-label |
| `moveDownAria` | aria-label |
| `preview.noText` | fallback |
| `preview.noBody` | fallback |
| `preview.pickTemplate` | fallback |
| `preview.noUrl` | fallback |

---

## 6. ICU usage

| Key | Format | Parameters |
|---|---|---|
| `Flows.header.unsavedChanges` | plain | — |
| `Flows.editorState.saveFailed` | `{status}` | interpolated number |
| `Flows.editorState.statusUpdateFailed` | `{status}` | interpolated number |
| `Flows.editorState.deleteFailed` | `{status}` | interpolated number |
| `Flows.editorState.deleteConfirm` | ICU | `{name}` |
| `Flows.builder.form.fileTooLarge` | ICU | `{size}` (number, formatted to 1 decimal) |
| `Flows.validation.summary` | already ICU | `{errorCount}`, `{warningCount}` — pluralized |
| `Flows.validation.issues.keywordBlank` | ICU plural | `{count}` |
| `Flows.validation.issues.buttonNoId` | ICU | `{index}` (1-based) |
| `Flows.validation.issues.buttonNoTitle` | ICU | `{index}` |
| `Flows.validation.issues.buttonTitleTooLong` | ICU | `{index}`, `{limit}` |
| `Flows.validation.issues.buttonNoNext` | ICU | `{index}` |
| `Flows.validation.issues.buttonBadNext` | ICU | `{index}`, `{key}` |
| `Flows.validation.issues.rowNoId` | ICU | `{index}`, `{section}` |
| `Flows.validation.issues.rowNoTitle` | ICU | `{index}` |
| `Flows.validation.issues.rowTitleTooLong` | ICU | `{index}`, `{limit}` |
| `Flows.validation.issues.rowDescTooLong` | ICU | `{index}`, `{limit}` |
| `Flows.validation.issues.rowNoNext` | ICU | `{index}` |
| `Flows.validation.issues.rowBadNext` | ICU | `{index}`, `{key}` |
| `Flows.validation.issues.conditionNoBranch` | ICU | `{branch}` |
| `Flows.validation.issues.conditionBadBranch` | ICU | `{branch}`, `{key}` |
| `Flows.validation.issues.conditionEmptyValue` | ICU | `{operator}` |
| `Interactive.builder.buttonsCount` | ICU | `{count}`, `{max}` |
| `Interactive.builder.rowsCount` | ICU | `{total}`, `{max}` |
| `Interactive.validation.bodyTooLong` | ICU | `{limit}` |
| `Interactive.validation.headerTooLong` | ICU | `{limit}` |
| `Interactive.validation.footerTooLong` | ICU | `{limit}` |
| `Interactive.validation.tooManyButtons` | ICU | `{limit}` |
| `Interactive.validation.buttonDuplicateId` | ICU | `{id}` |
| `Interactive.validation.buttonLabelTooLong` | ICU | `{title}`, `{limit}` |
| `Interactive.validation.listButtonLabelTooLong` | ICU | `{limit}` |
| `Interactive.validation.tooManySections` | ICU | `{limit}` |
| `Interactive.validation.rowDuplicateId` | ICU | `{id}` |
| `Interactive.validation.rowTitleTooLong` | ICU | `{title}`, `{limit}` |
| `Interactive.validation.rowDescTooLong` | ICU | `{limit}` |
| `Interactive.validation.tooManyRows` | ICU | `{limit}` |

---

## 7. `t.raw()` usage

| Context | Why |
|---|---|
| `Flows.builder.nodesEmpty` (line 178 of flow-builder.tsx) | Already uses `t.rich()` for `<strong>` markup — keep as-is |
| `Interactive.builder` — no `t.raw()` needed | All strings are plain text or simple ICU. The `{count}/{max}` counters are computed in JSX, not in the message string |
| Existing `Settings.templates.step3_2` etc. | Already handled with `t.raw()` + `dangerouslySetInnerHTML` — not in scope |

No new `t.raw()` usage is required for this spec. All new keys are either plain strings or use standard ICU interpolation (no custom markup).

---

## 8. Testing plan

### 8.1 Existing tests to update

| Test file | Change required |
|---|---|
| `src/lib/flows/validate.test.ts` | Pass optional `t` (or omit for English fallback). Assert on `scope`/`field`/`severity` instead of exact `message`. |
| `src/lib/whatsapp/interactive.test.ts` | Pass optional `t` (or omit). Update assertions that check exact `error` strings (line 80 is the only exact-match assertion). |

### 8.2 New tests

| Test file | Purpose |
|---|---|
| `src/components/flows/__i18n__/header.test.tsx` | Renders `EditorHeader` with `NextIntlClientProvider` in `es` and `ko`; asserts all UI strings come from catalogue. |
| `src/components/flows/__i18n__/validation-panel.test.tsx` | Renders `ValidationPanel` with mock issues; asserts localized messages render for `es`/`ko`. |
| `src/components/flows/__i18n__/node-config-form.test.tsx` | Asserts `"Body text"` label and `"Remove section"` aria-label are localized. |
| `src/components/flows/__i18n__/flow-editor-state.test.tsx` | Asserts save/delete error toasts are localized (mock fetch). |
| `src/components/automations/__i18n__/automation-builder.test.tsx` | Asserts step category badges, move aria-labels, cron placeholder are localized. |
| `src/components/interactive/__i18n__/interactive-builder.test.tsx` | Asserts all hardcoded strings are localized; `validation.error` renders via catalogue. |
| `src/components/interactive/__i18n__/interactive-preview.test.tsx` | Asserts fallback strings render via catalogue. |

### 8.3 Parity and ICU tests (already exist, must stay green)

| Test | Already covers |
|---|---|
| `src/i18n/messages.test.ts` | Key parity: every `en.json` key exists in `es.json` and `ko.json` |
| `src/i18n/icu-safety.test.ts` | Flags ICU-hostile keys read with plain `t()` |

### 8.4 New infrastructural test (recommended)

| Test file | Purpose |
|---|---|
| `src/lib/flows/__i18n__/validate-i18n.test.ts` | Calls `validateFlowForActivation` with a mock `t` that returns `key:param` format; asserts every issue message is routed through `t()`. |
| `src/lib/whatsapp/__i18n__/interactive-i18n.test.ts` | Same for `validateInteractivePayload`. |

---

## 9. Implementation order

1. **Dictionaries first** — add all new keys to `messages/en.json`, then mirror to `es.json` and `ko.json`. This keeps `messages.test.ts` green at every step.
2. **Library functions** — add optional `t` parameter to `validateFlowForActivation` and `validateInteractivePayload`. Update existing tests to pass `t` or assert on non-message fields.
3. **`edges.ts`** — make `outgoingSlots` accept an optional `t` for "Next"/"true"/"false" labels.
4. **`header.tsx`** — add `useTranslations("Flows.header")`, replace all hardcoded strings.
5. **`flow-editor-shell.tsx`** — localize `"Editor view"` aria-label.
6. **`flow-editor-state.tsx`** — localize error toasts and delete confirm.
7. **`node-config-form.tsx`** — wire `"Body text"` to existing key; add `"Remove section"` aria-label; localize file upload toasts.
8. **`fields.tsx`** — replace `"—"` fallback with `t("none")`.
9. **`automation-builder.tsx`** — localize step badges, aria-labels, placeholder, `previewFor` fallbacks.
10. **`interactive-builder.tsx`** — add `useTranslations("Interactive.builder")`, replace all strings.
11. **`interactive-preview.tsx`** — add `useTranslations("Interactive.preview")`, replace fallback strings.
12. **Run** `npm run typecheck && npm run lint && npm test && npm run build`.

---

## 10. Acceptance criteria

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
2. `src/i18n/messages.test.ts` — every new key exists in `en`, `es`, and `ko`.
3. `src/i18n/icu-safety.test.ts` — green (no new ICU-hostile keys wired to plain `t()`).
4. Grep for every hardcoded string listed in §3 across the listed files returns **zero matches** in non-comment JSX/props (exempt: `TECH` values like `"__none__"`, sample IDs like `"Option 1"`, `reply_id` field-name placeholders, and `INTERACTIVE_LIMITS` numeric constants).
5. `header.tsx` uses `useTranslations("Flows.header")` and no string literal appears as visible text, placeholder, aria-label, title, or toast message.
6. `interactive-builder.tsx` uses `useTranslations("Interactive.builder")` and every UI string routes through `t()`.
7. `interactive-preview.tsx` uses `useTranslations("Interactive.preview")` and fallback strings route through `t()`.
8. `validateFlowForActivation` and `validateInteractivePayload` accept an optional `t` parameter; when provided, all `message`/`error` fields are produced via `t()`; when omitted, English fallback strings are returned (backward-compatible).
9. `interactive.test.ts` and `validate.test.ts` pass with and without a `t` parameter.
10. `previewFor` in `automation-builder.tsx` localizes its fallback strings via `Automations.builder.preview.*`.
11. `automation-builder.tsx` localizes `"Condition"`/`"Wait"`/`"Action"` badges, `"Move up"`/`"Move down"` aria-labels, `"Cron expression or HH:mm"` placeholder, and the `"Tag"` trigger label.

---

## 11. Risks and follow-ups

1. **`summarizeNode` fallbacks** (shared.tsx) — These are used when `t` is null. They are TECH fallbacks, not primary UI. No change required, but document that all callers should pass `t`.
2. **`interactive.ts` and `validate.ts` are shared libraries** — They are also used server-side (inflows from Meta webhooks, cron, etc.). The optional `t` parameter ensures server-side callers are unaffected. The `message`/`error` fields become `string` either way.
3. **Existing `interactivePayloadPreviewText`** returns `[buttons]`/`[list]` — These are stored in `conversations.last_message_text` and shown as message previews in the inbox. Treating them as TECH (not translatable) is intentional.
4. **`previewFor` in automation-builder** — Currently returns plain strings for collapsed-step preview. These are UI-level summaries, not WhatsApp content. Localizing them is safe.
5. **`NODE_META` labels in `shared.tsx`** — Already localized via `Flows.builder.nodes.*` keys in en.json. The `label` and `blurb` fields in `NODE_META` are the English source values; components look them up via `t(\`nodes.${node.node_type}.label\`)`. No change needed.
6. **`INTERACTIVE_LIMITS`** numbers in labels (e.g. `"≤20"`, `"1–3"`) — These are already baked into existing localized strings like `Flows.builder.form.optionTitlePlaceholder` ("Visible title (≤20 chars)"). No separate localization needed for the numbers themselves.
