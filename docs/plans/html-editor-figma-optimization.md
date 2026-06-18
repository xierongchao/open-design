# HTML Editor Figma-Style Optimization Plan

Last reviewed: 2026-06-18.

Source inputs:

- User audit request for `docs/ui-region-map.md`, edit mode, code mode, edit properties, update performance, save mechanics, and canvas-panel communication.
- Code audit around `apps/web/src/components/FileViewer.tsx`, `FileWorkspace.tsx`, `ProjectView.tsx`, `components/grapesjs/*`, `runtime/srcdoc.ts`, and related tests.
- Repository rules from root `AGENTS.md`, `apps/AGENTS.md`, and `e2e/AGENTS.md`.

Status: implementation in progress. Phase 0 is complete; Phase 1 has a first behavior slice; Phase 2 has migrated the current-path web tests and e2e HTML preview coverage; Phase 3 has a first shared save controller; Phase 4 has a cached GrapesJS selection snapshot for the current hot paths; Phase 7 has cached selected-colors, canvas/page state, image fill, number scrub, color editor, color field, effect-control, stroke-control, layout-control, panel primitive, and transform-control Modules.

## Goal

Make HTML artifact editing feel closer to Figma:

- Selection, hover, inspect, and property edits should feel immediate.
- Canvas tools such as Edit, Comment, Draw, and Code should not block each other through stale legacy state.
- Canvas and edit panel should share one clear document/selection interface.
- Save should be durable, predictable, debounced, and flushable before mode switches or file switches.
- The implementation should become easier to navigate after context compaction, with large modules split behind deeper interfaces.

## Product Invariants

- HTML artifacts use GrapesJS as the primary visual editor path.
- Code mode and visual edit mode must operate on the same latest HTML document.
- Property panel edits should update the canvas optimistically, then save through a shared queue.
- Comment and Draw are tools over the canvas. Activating them should not require a slow legacy manual-edit shutdown when the current HTML canvas is already GrapesJS.
- Manual iframe edit mode is either a documented fallback or removed. It should not remain half-product and half-dead-code.
- Preview-only HTML, interactive runtime HTML, and editable static HTML may need different render transports, but the user-facing model should stay coherent.

## Resume Protocol

Use this section after context compaction or when continuing the optimization later.

1. Read this document first.
2. Read `docs/ui-region-map.md` to compare documented UI regions with the current implementation.
3. Run `git status --short` and treat all existing modified files as user work unless you made them in the current session.
4. Re-scan the current code anchors with `rg`, because line numbers in this document may drift:

```bash
rg -n "initialFallbackManualEditMode|manualEditMode|manual-edit-mode-toggle|exitManualEditModeAfterFlush|syncGrapesjsDocumentToSource|runtimeScript|grapesjsSidebarTab" apps/web/src/components
rg -n "walkAll|findComponentByOdId|getNormalizedBox|extractInspectTarget|collectColorsFromSelection|querySelectorAll" apps/web/src/components/grapesjs apps/web/src/components/FileViewer.tsx
rg -n "manual-edit-mode-toggle|ManualEditPanel|edit-mode/bridge|app-html-preview|app-manual-edit" apps/web/tests e2e/ui
```

5. Pick the first unchecked phase that still matches the codebase.
6. Before editing code, update this document if the phase needs a changed approach.
7. After each phase, append a dated note to "Discovery Log" with findings, decisions, and tests run.
8. If this document conflicts with the code, trust the code, then update this document before continuing.

## Current Diagnosis

### 1. GrapesJS path still shares legacy manual edit state

Current anchors from 2026-06-18:

- `apps/web/src/components/FileWorkspace.tsx` no longer passes an edit-mode default just because a file is HTML.
- `apps/web/src/components/FileViewer.tsx` exposes `initialFallbackManualEditMode` only for legacy iframe fallback tests/entry, while GrapesJS edit-panel state is derived from the GrapesJS path.
- `apps/web/src/components/FileViewer.tsx:7746` has `syncGrapesjsDocumentToSource`.
- `apps/web/src/components/FileViewer.tsx:7826`, `7865`, and nearby tool activation paths check `manualEditMode` and may call `exitManualEditModeAfterFlush`.
- `apps/web/src/components/FileViewer.tsx:9296`, `9302`, and `9495` sync GrapesJS content before mode transitions or saves.

Problem: `manualEditMode` is doing too much. It represents old iframe editing, GrapesJS edit availability, toolbar state, edit panel state, and exit/flush behavior. This makes tool switching slower and makes code difficult to reason about.

Target module depth: introduce a smaller HTML editor shell interface where callers ask for user-level actions such as select, edit styles, switch tool, switch source, save, and flush. The implementation decides whether GrapesJS or fallback iframe handles the action.

### 2. Manual edit toolbar and tests are inconsistent

Current anchors:

- `apps/web/src/components/FileViewer.tsx:9147` still contains the `manual-edit-mode-toggle` toolbar button, but it is commented out in the current worktree.
- `e2e/ui/app-manual-edit.test.ts` was renamed to `e2e/ui/app-html-preview.test.ts`; obsolete inspector/edit-save cases were removed, and the remaining tests now describe HTML preview toolbar, comment/mark, Deck, and Preview/Code behavior.
- `apps/web/tests/components/FileViewer.manual-edit*.tsx` were deleted after their only reusable helper invariant was moved to `apps/web/tests/viewer-utils.test.ts`.
- `ManualEditPanel.test.tsx` and `apps/web/tests/edit-mode/bridge.test.ts` still cover iframe manual-edit fallback details.

Problem: tests still encode an older product model and sometimes expect a toolbar entry that is not rendered. Some may be useful as fallback tests, but many now pull the architecture back toward the old iframe bridge.

Target: classify tests into migrate, keep-as-fallback, or delete. New P0 coverage should describe the current GrapesJS editor behavior.

### 3. Save mechanics are split across multiple paths

Current anchors:

- GrapesJS save and sync are in `FileViewer.tsx` around `syncGrapesjsDocumentToSource`.
- Inspect save paths and style updates use separate handlers.
- Old manual edit patch saving still exists in the same module.
- `components/grapesjs/html-document.ts` contains document round-trip helpers.

Problem: visual edits, code edits, inspect edits, viewport/canvas style saves, and old manual patches do not share one queue, version model, or flush interface.

Target: one `HtmlDocumentSaveController` module with a small interface:

- `updateFromCanvas(reason)`
- `updateFromSource(source, reason)`
- `scheduleSave(reason)`
- `flush(reason)`
- `cancelForFileSwitch()`
- `getStatus()`

The exact names can change, but callers should not know about timers, direct fetches, stale source snapshots, or pending style patch internals.

### 4. Canvas-panel communication uses repeated lookup work

Current anchors:

- `apps/web/src/components/grapesjs/grapesjs-bridge-adapter.ts:68` has `walkAll`.
- `apps/web/src/components/grapesjs/grapesjs-bridge-adapter.ts:90` has `findComponentByOdId`.
- `apps/web/src/components/grapesjs/grapesjs-bridge-adapter.ts:332` has `getNormalizedBox`.
- `apps/web/src/components/grapesjs/grapesjs-bridge-adapter.ts:381` has `extractInspectTarget`.
- `apps/web/src/components/FileViewer.tsx:5210` and nearby code compute box and inspect state separately.
- `apps/web/src/components/FileViewer.tsx:9360` and nearby code sometimes use the selected component directly to avoid a second walk.

Problem: selection, comments, inspect panels, and property panels have overlapping data needs but do not share a stable selection snapshot. This creates extra tree walks and makes performance harder to tune.

Target: introduce an `EditorSelectionStore` module. It should cache the selected GrapesJS component, `odId`, element reference when available, normalized box, inspect target, and computed style snapshot. Callers subscribe to this store instead of recomputing from `odId`.

### 5. Large modules reduce locality

Current size snapshot from 2026-06-18:

- `apps/web/src/components/FileViewer.tsx`: 11222 lines.
- `apps/web/src/components/grapesjs/GrapesjsEditor.tsx`: 4252 lines.
- `apps/web/src/components/grapesjs/StylePanel.tsx`: 3095 lines.
- `apps/web/src/components/ManualEditPanel.tsx`: 2281 lines.
- `apps/web/src/runtime/srcdoc.ts`: 2283 lines.
- `apps/web/src/styles/viewer/core.css`: 2396 lines.
- `apps/web/src/styles/viewer/properties-panel.css`: 1042 lines.
- `apps/web/src/components/grapesjs/StylePanel.module.css`: 1367 lines.

Problem: these modules have broad interfaces and many internal responsibilities. Fixing save, selection, or tool switching requires reading too much unrelated implementation.

Target: extract deeper modules with narrow interfaces. Avoid pass-through modules. Use the deletion test: if deleting a module only moves its code without simplifying callers, do not keep that module.

### 6. Quasi-dead scaffolding should be resolved

Current anchors:

- `apps/web/src/components/FileViewer.tsx:4349` has `grapesjsSidebarTab`.
- `apps/web/src/components/grapesjs/GrapesjsEditor.tsx` exposes `layersPanelRef`, `stylePanelRef`, and related panel hooks.
- The main GrapesJS render path currently uses a custom `StylePanel`, while some sidebar scaffolding is not clearly wired.
- `apps/web/src/components/FileViewer.tsx:5094` computes `runtimeScript`.

Problem: unresolved scaffolding makes maintainers unsure which path is product and which path is historical.

Target: either implement the intended sidebar tabs or remove the scaffolding. For `runtimeScript`, document why it exists or remove/rename it if the GrapesJS decision no longer depends on it.

## Implementation Phases

### Phase 0 - Baseline and Document Sync

- [x] Re-read `docs/ui-region-map.md` and compare it to the current `FileViewer`, `FileWorkspace`, and GrapesJS layout.
- [x] Record the current dirty worktree state in this document if optimization work begins while user changes are present.
- [x] Confirm whether `manual-edit-mode-toggle` is currently rendered or commented in the active worktree.
- [x] List current GrapesJS, FileViewer, and manual edit tests before deleting or migrating anything.
- [x] Add any newly discovered anchors to "Current Diagnosis".

Acceptance criteria:

- This document describes the current code accurately enough for another agent to resume.
- No source code changes are made in this phase unless they are documentation-only updates to this file.

Suggested verification:

```bash
git status --short
rg -n "manual-edit-mode-toggle|initialFallbackManualEditMode|manualEditMode|app-html-preview|app-manual-edit" apps/web/src/components apps/web/tests e2e/ui e2e/package.json e2e/scripts .github/workflows
```

### Phase 1 - Separate HTML Editor State From Legacy Manual Edit State

Objective: stop using one `manualEditMode` flag for both current GrapesJS editing and old iframe manual editing.

Steps:

- [ ] Define the product states in code terms: preview, visual edit, source code, comment, draw, and fallback iframe edit.
- [x] Replace ambiguous `defaultEditMode` usage for HTML artifacts with a clearer editor entry state, such as `initialHtmlEditorMode` or a derived GrapesJS-first mode.
- [x] Ensure `FileWorkspace` and `ProjectView` do not force the old iframe edit mode just because the active file is HTML.
- [x] Change Comment and Draw activation so they do not call `exitManualEditModeAfterFlush` for the GrapesJS path.
- [x] Keep legacy iframe edit exit/flush only where fallback iframe edit is truly active.
- [ ] Update user-facing mode state and callbacks so the left nav, canvas toolbar, and right edit panel agree.

Phase 1 progress:

- 2026-06-18: `FileWorkspace` no longer passes `defaultEditMode` just because a file is HTML.
- 2026-06-18: `FileViewer` now uses `fallbackManualEditMode = manualEditMode && !useGrapesjs` for Draw and Comment tool switching.
- 2026-06-18: `activateManualEditTool` treats the GrapesJS path as edit-panel activation instead of starting legacy iframe manual edit.
- 2026-06-18: the public prop was renamed from `defaultEditMode` to `initialFallbackManualEditMode`, so the interface names the legacy iframe fallback instead of the primary edit mode.

Acceptance criteria:

- Opening an HTML artifact lands in the intended GrapesJS experience.
- Switching Edit -> Comment -> Draw -> Edit is immediate and does not wait on a legacy manual-edit flush unless fallback iframe edit is active.
- Source mode still receives the latest GrapesJS document before opening.
- Existing non-HTML preview and comment flows keep working.

Suggested tests:

```bash
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/web test -- apps/web/tests/components/FileViewer.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/GrapesjsEditor.test.ts
```

### Phase 2 - Test Inventory and Cleanup

Objective: make tests describe the current product, not the retired prototype.

Steps:

- [x] Classify `e2e/ui/app-manual-edit.test.ts` cases as migrate, fallback-only, or delete.
- [x] Classify `apps/web/tests/components/FileViewer.manual-edit*.tsx` cases the same way.
- [x] Classify `apps/web/tests/components/ManualEditPanel.test.tsx` and `apps/web/tests/edit-mode/bridge.test.ts`.
- [x] Preserve low-level source patch tests if the patch helpers remain used.
- [x] Add or strengthen GrapesJS tests for selection, property edits, code mode sync, and save flushing.
- [x] Replace old P0 manual edit e2e coverage with current HTML preview and GrapesJS editor coverage.

Phase 2 progress:

- 2026-06-18: `apps/web/tests/components/FileWorkspace.test.tsx` inline HTML preview case now asserts the GrapesJS editor path instead of the old manual iframe path.
- 2026-06-18: `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` now protects GrapesJS tool switching from the legacy manual edit flush.
- 2026-06-18: `apps/web/tests/components/FileViewer.test.tsx` no longer contains active tests that click `manual-edit-mode-toggle`; remaining references there only assert that the hidden toolbar entry is absent.
- 2026-06-18: `e2e/ui/app-manual-edit.test.ts` was renamed to `e2e/ui/app-html-preview.test.ts`; old manual inspector persistence cases and bridge helpers were removed, while toolbar, comment/mark, Deck, and Preview/Code coverage stayed active.
- 2026-06-18: e2e package scripts, P0 shard config, coverage-reminder workflow, and HTML preview coverage documentation now reference `app-html-preview.test.ts`.
- 2026-06-18: `apps/web/tests/components/FileViewer.manual-edit*.tsx` were deleted as obsolete primary-path integration tests. The reusable `cancelManualEditPendingStyleSnapshot` invariant moved to `apps/web/tests/viewer-utils.test.ts`.
- Classification:
  - Migrated/deleted as primary product coverage: `e2e/ui/app-html-preview.test.ts` current-path coverage and `apps/web/tests/components/FileViewer.test.tsx` manual toolbar cases.
  - Fallback-only if iframe edit remains: `apps/web/tests/components/ManualEditPanel.test.tsx`, `apps/web/tests/edit-mode/bridge.test.ts`, and iframe transport assertions in `apps/web/tests/runtime/srcdoc.test.ts`.
  - Keep as low-level utilities while still referenced: `apps/web/tests/edit-mode/source-patches.test.ts` and `apps/web/tests/viewer-utils.test.ts` manual viewport math.
  - Already migrated: `apps/web/tests/components/FileWorkspace.test.tsx` "previews an HTML file inline..." case.

Likely delete or quarantine candidates after migration:

- `apps/web/tests/components/ManualEditPanel.test.tsx`
- `apps/web/tests/edit-mode/bridge.test.ts`, unless iframe fallback remains.

Acceptance criteria:

- P0 tests cover the current Figma-like HTML editor path.
- Retained manual-edit tests are explicitly fallback tests, not primary product tests.
- No test expects a removed toolbar or obsolete iframe bridge behavior.

Suggested tests:

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/GrapesjsEditor.test.ts
pnpm --filter @open-design/web test -- apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx
cd e2e && pnpm exec playwright test -c playwright.config.ts ui/app-grapesjs-canvas.test.ts
cd e2e && pnpm exec playwright test -c playwright.config.ts ui/app-html-preview.test.ts --grep "\\[P0\\]|\\[P1\\]"
```

### Phase 3 - Unified HTML Document Save Controller

Objective: make all HTML editing paths share one save queue and one flush contract.

Steps:

- [x] Extract a save controller from `FileViewer` and GrapesJS save logic.
- [x] Move the GrapesJS debounce timer and flush behavior behind the controller interface.
- [ ] Move remaining pending flags and version/source snapshots behind the controller interface.
- [x] Route GrapesJS canvas flushes, code mode saves, inspect saves, fallback manual patches, undo/redo, and manual viewport-size saves through the first controller slice.
- [x] Replace direct save fetches in UI handlers with controller calls.

Phase 3 progress:

- 2026-06-18: Added `apps/web/src/components/html-file-save-controller.ts` with `createHtmlFileSaveController`, `save`, `saveBestEffort`, and `saveOrThrow`.
- 2026-06-18: `FileViewer` now creates one HTML file save controller per project/file and uses it for GrapesJS auto-save flushes, GrapesJS interactive-mode flushes, Code saves, Inspect saves, fallback manual patches, manual undo/redo, and manual viewport-size persistence.
- 2026-06-18: GrapesJS canvas auto-save now calls `scheduleSave`; file switch/unmount and interactive-mode transitions call `flushScheduledSave` / `cancelScheduledSave`. `FileViewer` no longer owns `grapesjsAutoSaveTimerRef`.
- 2026-06-18: fallback iframe edit source round-trip tracking moved into `html-editor-source-roundtrip.ts`, replacing separate expected/external source refs with one tested state transition module.
- Remaining: move source file keys and fallback manual pending-style flags into deeper save/state modules.
- [ ] Add failure status and retry behavior that the UI can display.
- [ ] Ensure file switch and project switch cancel stale saves safely.

Acceptance criteria:

- A single flush call is enough before switching file, switching source mode, closing fallback edit, or leaving the editor.
- Rapid property edits coalesce into durable saves.
- Code mode never opens stale source after recent visual edits.
- Save failures do not silently lose edits or keep stale pending state forever.

Suggested tests:

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/FileViewer.test.tsx
pnpm --filter @open-design/web typecheck
```

### Phase 4 - Editor Selection Store and Canvas-Panel Interface

Objective: make selection, inspect, comments, and style panels use one shared selection snapshot.

Steps:

- [x] Introduce an `EditorSelectionStore` module near `components/grapesjs/`.
- [x] Store selected GrapesJS component, `odId`, normalized box, inspect target, and HTML hint in a snapshot.
- [ ] Add style snapshot storage so the property panel can reuse the same selection interface.
- [x] Replace repeated `findComponentByOdId`, `getNormalizedBox`, and `extractInspectTarget` calls in current selection/comment hot paths with store reads.
- [ ] Make comment snapshot, selection overlay, and style panel subscribe to the same selection interface.
- [x] Add first invalidation hooks for source reload, selection change, component/source change, style update, viewport changes, and zoom changes.
- [ ] Confirm deletion/undo/redo and canvas rerender invalidation once the store feeds more UI.
- [ ] Measure or log lookup count during selection changes while developing, then remove noisy instrumentation before finalizing.

Acceptance criteria:

- Selection changes require at most one full tree lookup when a direct component reference is unavailable.
- Property panel state and canvas selection remain in sync after delete, undo, redo, and source reload.
- Comment target geometry uses the same box as the selection overlay.

Suggested tests:

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/GrapesjsEditor.test.ts
pnpm --filter @open-design/web test -- apps/web/tests/comments.test.ts
pnpm --filter @open-design/web test -- apps/web/tests/components/CommentTargetOverlay.hover-class.test.tsx
```

Phase 4 progress:

- 2026-06-18: Added `apps/web/src/components/grapesjs/grapesjs-selection-store.ts` as the first selection seam. It centralizes the strategy "prefer the live GrapesJS selected component, then fall back to odId lookup" for Inspect target extraction.
- 2026-06-18: Replaced two repeated FileViewer hot-path blocks in selection and style-update handling with `extractInspectTargetFromCurrentSelection`.
- 2026-06-18: Comment snapshot creation now reads one selection snapshot for component, box, inspect target, and HTML hint instead of doing separate `getNormalizedBox`, `extractInspectTarget`, and `findComponentByOdId` lookups.
- 2026-06-18: `createGrapesjsSelectionStore` now caches snapshots for the same editor, selected component, fallback id, and selection preference. `FileViewer` invalidates it on source/file changes, GrapesJS changes, selection/style changes, viewport changes, custom viewport resize, and zoom changes.
- Remaining: add style snapshot support and migrate `StylePanel` / selection overlay to the same interface.

### Phase 5 - Split `FileViewer` Into Deeper HTML Editor Modules

Objective: reduce `FileViewer` responsibility while preserving behavior.

Candidate modules:

- `HtmlEditorShell`: owns HTML editor mode, toolbar state, panel layout, and editor transport choice.
- `HtmlEditorSaveProvider`: adapter from save controller to project file writes.
- `HtmlEditorSourceMode`: source editor sync and mode switching.
- `HtmlEditorCanvasTools`: Comment, Draw, board mode, and canvas tool activation.
- `HtmlPreviewTransport`: iframe URL/srcDoc transport and runtime bridge decisions.

Steps:

- [ ] Extract only one cohesive module at a time.
- [ ] Keep existing tests green between extractions.
- [ ] Avoid modules that merely pass props through. Apply the deletion test before keeping each module.
- [ ] Move CSS only when the rendered UI path is covered by tests or visual verification.

Acceptance criteria:

- `FileViewer` no longer owns all HTML editor state directly.
- Callers interact with a smaller interface for HTML editor actions.
- Behavior is unchanged except for explicitly planned improvements from earlier phases.

Suggested tests:

```bash
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/web test -- apps/web/tests/components/FileViewer.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/FileWorkspace.test.tsx
```

### Phase 6 - Split `GrapesjsEditor` Internal Responsibilities

Objective: keep GrapesJS as the implementation, but make its internal modules easier to reason about.

Candidate modules:

- Canvas boot and plugin registration.
- Selection forwarding and hover state.
- Keyboard shortcuts and tool commands.
- Zoom, pan, viewport, and spacing overlays.
- Image/crop controls.
- HTML document import/export glue.

Steps:

- [ ] Extract internal modules with private interfaces first.
- [ ] Keep the external `GrapesjsEditor` ref interface stable unless a phase explicitly changes it.
- [x] Move `collectColorsFromSelection` or replace it with cached style snapshot from Phase 4.
- [ ] Ensure overlays and controls still clean up event listeners.

Acceptance criteria:

- Selection and property edit tests still pass.
- Canvas overlays do not leak listeners across file switches.
- The external editor ref exposes fewer high-churn implementation details over time.

Suggested tests:

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/GrapesjsEditor.test.ts
pnpm --filter @open-design/web typecheck
```

### Phase 7 - Split and Optimize `StylePanel`

Objective: make the property panel responsive under frequent selection and style changes.

Steps:

- [ ] Split layout, fill/color, typography, effects, canvas/page, and advanced sections into focused modules.
- [x] Move selected-subtree color collection behind a cached Module instead of keeping the recursive scan inside `GrapesjsEditor`.
- [x] Use the Phase 4 selection/style snapshot instead of repeatedly calling `collectColorsFromSelection` from `StylePanel`.
- [x] Repair fill image crop/upload and gradient-stop editing paths before splitting the fill section.
- [ ] Keep local draft state per section so typing and sliders do not rerender the full panel unnecessarily.
- [ ] Throttle or batch high-frequency numeric controls before save, while still applying canvas preview immediately.
- [ ] Keep accessibility labels and keyboard behavior intact.

Phase 7 progress:

- 2026-06-18: Added `apps/web/src/components/grapesjs/grapesjs-selection-colors.ts` as a deeper Module for selected-subtree color collection and replacement.
- 2026-06-18: `GrapesjsEditor` now uses a `createSelectionColorCollector` cache for `collectColorsFromSelection()` and invalidates it on selection changes, style/component updates, source replacement, host style writes, and successful color replacement.
- 2026-06-18: Fixed a hidden color-normalization bug where `rgb(..., 0)` values such as pure red or green were misread as alpha `0` and skipped. This affected both the "selected colors" list and color replacement.
- 2026-06-18: `SelectionSnapshot` now carries `selectedColors`, and `StylePanel` reads those colors from the snapshot instead of calling an editor handle method. `collectColorsFromSelection` was removed from `GrapesjsEditorHandle`, reducing that Interface.
- 2026-06-18: Added `style-panel-canvas-state.ts` as the canvas/page state Module for the no-selection panel. It owns canvas style/size snapshot polling and canvas style/size writes, so `StylePanel` no longer carries that refresh loop directly.
- 2026-06-18: Repaired image fill crop mode so the upload/replace action remains available, the inline crop editor appears inside the fill popover, existing pixel crop CSS round-trips into the crop controls, and replacement uploads preserve crop sizing.
- 2026-06-18: Improved `GradientEditor` usability: the stop bar now displays the live gradient, supports click-to-add stops, keeps a selected-stop state, uses Chinese labels, and interpolates hex stop colors when inserting a new stop.
- 2026-06-18: Removed unsupported/dead editing-panel controls: unused multi-shadow parsing/building helpers, the nonfunctional stroke width-profile reverse button, and effect options (`Noise`, `Texture`) that had no style writer.
- 2026-06-18: Wired advanced stroke cap/join controls to real CSS writes (`stroke-linecap`, `stroke-linejoin`) and covered them in `StylePanel.test.tsx`.
- 2026-06-18: Extracted `image-fill-control.tsx` from `StylePanel`. The new Module owns image upload, size/repeat selection, crop UI, and crop size round-trip helpers behind a small `ImageFillControl` Interface.
- 2026-06-18: Extracted `number-scrub.tsx` from `StylePanel`. The new Module owns number parsing/display and scrub interaction, and now deduplicates repeated pointermove events that stay in the same scrub bucket.
- 2026-06-18: Extracted `color-editor-popover.tsx` from `StylePanel`. The new Module owns HSV canvas picking, alpha/format inputs, palette swatches, fill mode switching, gradient/image fill branches, and the HEX/RGB/HSL parser behind a direct `ColorEditor` Interface.
- 2026-06-18: Preserved color editor alpha behavior during extraction: 6-digit HEX keeps the current alpha, while 8-digit HEX uses the typed alpha channel. Added direct coverage for formatting, draft parsing, solid-only use, and image-fill routing.
- 2026-06-18: Extracted `color-fields.tsx` from `StylePanel`. The new Module owns manual color text normalization, solid color property rows, visibility toggles, and selected-color rows behind a shared `ColorTextInput` / `ColorProperty` / `SelectedColor` Interface.
- 2026-06-18: Extracted `effect-controls.ts` from `StylePanel`. The new Module owns effect type options, default shadow draft state, single-shadow CSS building, effect type transitions, visibility toggles, and clear-all style patches. The floating effect title select now uses the same transition path and writes CSS instead of only changing local state.
- 2026-06-18: Extracted `stroke-controls.ts` from `StylePanel`. The new Module owns stroke visibility, color, width, position, dash, and constrained SVG stroke cap/join parsing.
- 2026-06-18: Extracted `layout-controls.ts` from `StylePanel`. The new Module owns dimension-mode derivation, flow patches, and alignment-axis patches for the automatic-layout section.
- 2026-06-18: Extracted `style-panel-primitives.tsx` from `StylePanel`. Floating panels, icon buttons, segmented icon groups, compact selects, property sections, labeled controls, and popover positioning now live behind a reusable panel primitive Interface.
- 2026-06-18: Extracted `transform-controls.ts` from `StylePanel`. Rotation parsing/replacement and flip transforms now have direct tests; horizontal/vertical flip toggles no longer stack duplicate `scaleX(-1)` / `scaleY(-1)` operations.
- 2026-06-18: `StylePanel.tsx` is down to 1632 lines after the image fill, number scrub, canvas/page state, selected-colors, color editor, color field, effect-control, stroke-control, layout-control, primitive, and transform-control extractions; the extracted Modules are independently covered by focused tests.
- Remaining: split heavy StylePanel sections and move more derived style state into the selection/style snapshot.

Acceptance criteria:

- Selecting different elements updates panel fields quickly.
- Dragging numeric style controls feels smooth and does not trigger excessive saves.
- Color collection no longer scans every descendant on every small interaction.

Suggested tests:

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/StylePanel.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/image-fill-control.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/number-scrub.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/color-editor-popover.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/color-fields.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/effect-controls.test.ts
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/stroke-controls.test.ts
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/layout-controls.test.ts
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/style-panel-primitives.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/transform-controls.test.ts
pnpm --filter @open-design/web test -- apps/web/tests/components/GradientEditor.test.tsx
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/GrapesjsEditor.test.ts
```

### Phase 8 - Retire or Contain Legacy Iframe Manual Edit

Objective: make the old manual edit bridge clearly fallback-only or remove it.

Steps:

- [ ] Decide whether iframe manual edit remains supported for any artifact class.
- [ ] If it remains, rename code and tests to say `fallback iframe edit`.
- [ ] If it does not remain, remove `ManualEditPanel`, `edit-mode/bridge`, obsolete srcDoc bridge injection, obsolete tests, and stale i18n keys.
- [ ] Keep `source-patches` only if another current path uses it.
- [ ] Update docs and `docs/ui-region-map.md` to reflect the new product surface.

Acceptance criteria:

- No primary HTML editor path depends on iframe manual edit concepts.
- Test names and UI labels match the supported product.
- Removed code is not referenced by route, toolbar, i18n, CSS, or tests.

Suggested tests:

```bash
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/web test
pnpm guard
```

### Phase 9 - Documentation and Final Verification

Objective: make the optimized architecture discoverable for future agents and maintainers.

Steps:

- [ ] Update `docs/ui-region-map.md` with the final UI regions and code anchors.
- [ ] Update this plan with completed phases, decisions, and deleted tests.
- [ ] Add or update a short architecture note if the save controller or selection store becomes a central interface.
- [ ] Run repository-level validation appropriate to the touched files.

Acceptance criteria:

- A future maintainer can answer "where does selection live?", "where does save live?", and "which tests cover HTML editing?" without reading all of `FileViewer`.
- Documentation matches the implementation.

Suggested final validation:

```bash
pnpm guard
pnpm typecheck
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/web test
cd e2e && pnpm typecheck
cd e2e && pnpm exec playwright test -c playwright.config.ts ui/app-grapesjs-canvas.test.ts
```

Do not use root `pnpm test` or root `pnpm build`; this repo keeps tests and builds package-scoped.

## Open Decisions

- Is iframe manual edit still a supported product fallback, or should it be fully retired?
- Should GrapesJS layers/style sidebar scaffolding become product UI, or should it be removed in favor of the current custom panel?
- Should interactive runtime HTML be editable in GrapesJS by default, or should it open as preview-first with a separate explicit edit action?
- Should autosave be fully Figma-like immediate persistence, or optimistic local canvas updates with debounced file persistence?
- What is the minimum accepted visual editor P0 e2e coverage before deleting old manual edit P0 tests?

## Discovery Log

| Date | Phase | Finding | Action | Files |
| --- | --- | --- | --- | --- |
| 2026-06-18 | Audit | `manualEditMode` still influences GrapesJS tool switching and source sync. | Plan Phase 1 to split current HTML editor state from fallback iframe edit state. | `apps/web/src/components/FileViewer.tsx`, `apps/web/src/components/FileWorkspace.tsx` |
| 2026-06-18 | Audit | Manual edit tests still target the older iframe-oriented product model. | Plan Phase 2 to migrate, quarantine, or delete obsolete tests. | `e2e/ui/app-manual-edit.test.ts`, `apps/web/tests/components/FileViewer.manual-edit*.tsx`, `apps/web/tests/edit-mode/bridge.test.ts` |
| 2026-06-18 | Audit | Save paths are spread across GrapesJS sync, inspect/property saves, code mode, and manual patch saves. | Plan Phase 3 for a unified save controller. | `apps/web/src/components/FileViewer.tsx`, `apps/web/src/components/grapesjs/html-document.ts` |
| 2026-06-18 | Audit | Selection and inspect paths can repeatedly walk the GrapesJS tree by `odId`. | Plan Phase 4 for a shared selection store and cached snapshot. | `apps/web/src/components/grapesjs/grapesjs-bridge-adapter.ts`, `apps/web/src/components/FileViewer.tsx` |
| 2026-06-18 | Audit | `FileViewer`, `GrapesjsEditor`, `StylePanel`, and `srcdoc` are large enough to hide unrelated concerns. | Plan Phases 5 to 7 for deeper modules with narrower interfaces. | `apps/web/src/components/FileViewer.tsx`, `apps/web/src/components/grapesjs/GrapesjsEditor.tsx`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/src/runtime/srcdoc.ts` |
| 2026-06-18 | Phase 0 | The active toolbar source contains `manual-edit-mode-toggle` only inside a commented block, while tests still search for it. | Updated this plan to treat those tests as migration/delete candidates. | `apps/web/src/components/FileViewer.tsx`, `apps/web/tests/components/FileViewer.test.tsx`, `e2e/ui/app-manual-edit.test.ts` |
| 2026-06-18 | Phase 1 | HTML files were forcing the legacy manual edit flag through `FileWorkspace`, so GrapesJS tool switches could still pass through iframe flush logic. | Removed the default legacy edit prop from HTML `FileWorkspace` render paths and added `fallbackManualEditMode` for Draw/Comment activation. | `apps/web/src/components/FileWorkspace.tsx`, `apps/web/src/components/FileViewer.tsx` |
| 2026-06-18 | Phase 1 | The `defaultEditMode` prop name still implied the old iframe edit path was the default HTML editor interface. | Renamed it to `initialFallbackManualEditMode` and kept it limited to explicit fallback/test entry. | `apps/web/src/components/FileViewer.tsx`, `apps/web/tests/components/FileViewer.test.tsx`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Validation | `pnpm --filter @open-design/web typecheck` is blocked by existing unrelated errors in `ProjectView`, `ProjectView.questionFormKey.test.ts`, and `runtime/exports.test.ts`. `pnpm --filter @open-design/web test -- <file>` also forwards an extra `--` and ran the full suite; direct Vitest invocation works. | Use `pnpm --dir apps/web exec vitest run -c vitest.config.ts <file>` for focused web tests until the script behavior is clarified. | `apps/web/package.json`, `apps/web/vitest.config.ts` |
| 2026-06-18 | Validation | Focused GrapesJS tests passed after the Phase 1 slice. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/FileViewer.grapesjs-interactive.test.tsx` and `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/grapesjs/GrapesjsEditor.test.ts`. | `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx`, `apps/web/tests/components/grapesjs/GrapesjsEditor.test.ts` |
| 2026-06-18 | Phase 2 | `FileWorkspace.test.tsx` still expected Design Files HTML preview to open the old iframe manual edit canvas. | Added a focused GrapesJS editor mock and migrated that case to assert the current GrapesJS default path and selection callback. | `apps/web/tests/components/FileWorkspace.test.tsx` |
| 2026-06-18 | Validation | The migrated `FileWorkspace` case passes in isolation. Full `FileWorkspace.test.tsx` still has unrelated existing failures in generation preview/navigation cases. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/FileWorkspace.test.tsx -t "previews an HTML file inline"`. | `apps/web/tests/components/FileWorkspace.test.tsx` |
| 2026-06-18 | Phase 2 | `FileViewer.test.tsx` had three old manual-edit toolbar tests that clicked an entry no longer rendered. | Removed those obsolete primary-path tests from the main viewer suite and simplified the comment-count toolbar order assertion to current visible buttons. | `apps/web/tests/components/FileViewer.test.tsx` |
| 2026-06-18 | Validation | Targeted current-path viewer tests pass; the sandbox-shim case still fails on a pre-existing `data-od-active` assertion unrelated to manual edit cleanup. | Ran focused `FileViewer.test.tsx` cases for hidden preview toolbar controls and comment count; recorded sandbox-shim failure for follow-up. | `apps/web/tests/components/FileViewer.test.tsx` |
| 2026-06-18 | Phase 2 | The old manual-edit e2e file mixed obsolete iframe inspector coverage with still-useful HTML preview coverage. | Renamed it to `app-html-preview.test.ts`, removed obsolete inspector/edit-save cases and shallow bridge helpers, and updated package scripts, P0 shard config, coverage-reminder workflow, and HTML preview coverage docs. | `e2e/ui/app-html-preview.test.ts`, `e2e/package.json`, `e2e/scripts/ui-p0-shards.ts`, `.github/workflows/e2e-coverage-reminder.yml`, `docs/testing/html-preview-coverage-summary.zh-CN.md` |
| 2026-06-18 | Validation | The renamed e2e file is discoverable and e2e TypeScript still checks. | Ran `pnpm exec playwright test -c playwright.config.ts --list ui/app-html-preview.test.ts`, `pnpm typecheck` from `e2e/`, and `git diff --check`. | `e2e/ui/app-html-preview.test.ts`, `e2e/tsconfig.json` |
| 2026-06-18 | Phase 2 | `FileViewer.manual-edit*.tsx` were obsolete primary-path integration tests around a toolbar entry that is no longer rendered. | Moved the reusable pending-style snapshot invariant to `viewer-utils.test.ts` and deleted the three old FileViewer manual-edit integration files. | `apps/web/tests/viewer-utils.test.ts`, `apps/web/tests/components/FileViewer.manual-edit.test.tsx`, `apps/web/tests/components/FileViewer.manual-edit-history.test.tsx`, `apps/web/tests/components/FileViewer.manual-edit-viewport.test.tsx` |
| 2026-06-18 | Validation | The retained low-level helper coverage and current GrapesJS path still pass after deleting old manual-edit integration tests. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/viewer-utils.test.ts` and `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/FileViewer.grapesjs-interactive.test.tsx`. | `apps/web/tests/viewer-utils.test.ts`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Validation | The `initialFallbackManualEditMode` rename is covered by the current GrapesJS focused suite. The sandbox-shim focused case still fails on the pre-existing `data-od-active` assertion. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/FileViewer.grapesjs-interactive.test.tsx` and `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/FileViewer.test.tsx -t "renders sandbox-shim artifacts"`. | `apps/web/src/components/FileViewer.tsx`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx`, `apps/web/tests/components/FileViewer.test.tsx` |
| 2026-06-18 | Phase 3 | HTML saves were still spread across direct `writeProjectTextFile*` calls and hand-written inspect `fetch` calls. | Added the first `html-file-save-controller` slice and routed GrapesJS flush, Code save, Inspect save, fallback manual patch, undo/redo, and viewport-size save calls through it. | `apps/web/src/components/html-file-save-controller.ts`, `apps/web/src/components/FileViewer.tsx` |
| 2026-06-18 | Validation | The new save controller interface and current-path GrapesJS tests pass. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/html-file-save-controller.test.ts`, `tests/components/FileViewer.grapesjs-interactive.test.tsx`, and `tests/viewer-utils.test.ts`. | `apps/web/tests/components/html-file-save-controller.test.ts`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx`, `apps/web/tests/viewer-utils.test.ts` |
| 2026-06-18 | Phase 3 | GrapesJS debounce timer state still lived in `FileViewer`, so autosave scheduling remained split from saving. | Added `scheduleSave`, `flushScheduledSave`, and `cancelScheduledSave` to the save controller and removed `grapesjsAutoSaveTimerRef` from `FileViewer`. | `apps/web/src/components/html-file-save-controller.ts`, `apps/web/src/components/FileViewer.tsx` |
| 2026-06-18 | Validation | Scheduled save coalescing and GrapesJS current-path tests pass after moving debounce into the controller. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/html-file-save-controller.test.ts` and `tests/components/FileViewer.grapesjs-interactive.test.tsx`. | `apps/web/tests/components/html-file-save-controller.test.ts`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Validation | `git diff --check` passes. `pnpm --filter @open-design/web typecheck` still fails only on existing unrelated `ProjectView`, question-form test export, and runtime exports errors. | Recorded typecheck blockers so the next continuation does not confuse them with this optimization work. | `apps/web/src/components/ProjectView.tsx`, `apps/web/tests/components/ProjectView.questionFormKey.test.ts`, `apps/web/tests/runtime/exports.test.ts` |
| 2026-06-18 | Phase 3 | Fallback iframe edit used two loose refs to distinguish local save round trips from external rewrites. | Extracted `html-editor-source-roundtrip.ts` with explicit enter/local-save/reconcile transitions and replaced the loose refs in `FileViewer`. | `apps/web/src/components/html-editor-source-roundtrip.ts`, `apps/web/src/components/FileViewer.tsx` |
| 2026-06-18 | Validation | Source round-trip transitions, save controller behavior, and current GrapesJS path pass after the extraction. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/html-editor-source-roundtrip.test.ts`, `tests/components/html-file-save-controller.test.ts`, and `tests/components/FileViewer.grapesjs-interactive.test.tsx`. | `apps/web/tests/components/html-editor-source-roundtrip.test.ts`, `apps/web/tests/components/html-file-save-controller.test.ts`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Phase 4 | FileViewer repeated the live-selected-component-first Inspect target extraction in both selection and style-update paths. | Added `grapesjs-selection-store.ts` and routed both hot paths through `extractInspectTargetFromCurrentSelection`. | `apps/web/src/components/grapesjs/grapesjs-selection-store.ts`, `apps/web/src/components/FileViewer.tsx` |
| 2026-06-18 | Validation | The first selection seam and GrapesJS current path pass. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/grapesjs/grapesjs-selection-store.test.ts` and `tests/components/FileViewer.grapesjs-interactive.test.tsx`. | `apps/web/tests/components/grapesjs/grapesjs-selection-store.test.ts`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Phase 4 | GrapesJS comment snapshots repeated component lookup work for geometry, inspect metadata, and HTML hint. | Added `readGrapesjsSelectionSnapshot`, exported `getNormalizedBoxFromComponent`, and routed comment snapshot creation through the shared selection snapshot. | `apps/web/src/components/grapesjs/grapesjs-selection-store.ts`, `apps/web/src/components/grapesjs/grapesjs-bridge-adapter.ts`, `apps/web/src/components/FileViewer.tsx` |
| 2026-06-18 | Validation | Selection snapshot, bridge adapter, and current GrapesJS path pass after reducing duplicate lookups. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts tests/components/grapesjs/grapesjs-selection-store.test.ts`, `tests/components/grapesjs/grapesjs-bridge-adapter.test.ts`, and `tests/components/FileViewer.grapesjs-interactive.test.tsx`. | `apps/web/tests/components/grapesjs/grapesjs-selection-store.test.ts`, `apps/web/tests/components/grapesjs/grapesjs-bridge-adapter.test.ts`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Validation | Focused validation still passes; web typecheck is back to the known unrelated blockers only. | Ran grouped focused Vitest for source/save/selection/bridge/GrapesJS/viewer-utils, `git diff --check`, and `pnpm --filter @open-design/web typecheck`. | `apps/web/tests/components/grapesjs/grapesjs-selection-store.test.ts`, `apps/web/tests/components/ProjectView.questionFormKey.test.ts`, `apps/web/tests/runtime/exports.test.ts` |
| 2026-06-18 | Phase 4 | The selection snapshot needed real cache locality, but cached geometry can become stale when canvas geometry changes. | Added `createGrapesjsSelectionStore` with explicit invalidation and wired invalidation to source/file changes, GrapesJS change events, selection/style updates, viewport changes, custom viewport resize, and zoom changes. | `apps/web/src/components/grapesjs/grapesjs-selection-store.ts`, `apps/web/src/components/FileViewer.tsx` |
| 2026-06-18 | Validation | Cached selection-store behavior, save controller, source round-trip, bridge adapter, current GrapesJS interaction, and the migrated FileWorkspace HTML preview case pass. Web typecheck still fails only on the known unrelated `ProjectView`, question-form export, and runtime export errors. | Ran focused Vitest for selection/save/source/bridge/GrapesJS and `FileWorkspace.test.tsx -t "previews an HTML file inline while keeping the Design Files tree and toolbar visible"`, plus `git diff --check` and `pnpm --filter @open-design/web typecheck`. | `apps/web/tests/components/grapesjs/grapesjs-selection-store.test.ts`, `apps/web/tests/components/html-file-save-controller.test.ts`, `apps/web/tests/components/html-editor-source-roundtrip.test.ts`, `apps/web/tests/components/FileWorkspace.test.tsx` |
| 2026-06-18 | Phase 7 | `StylePanel` called the expensive selected-subtree color scan through the editor handle; the implementation lived as private code inside `GrapesjsEditor`. | Extracted `grapesjs-selection-colors.ts`, added `createSelectionColorCollector`, and routed the editor handle through the cached collector with explicit invalidation. | `apps/web/src/components/grapesjs/grapesjs-selection-colors.ts`, `apps/web/src/components/grapesjs/GrapesjsEditor.tsx`, `apps/web/tests/components/grapesjs/grapesjs-selection-colors.test.ts` |
| 2026-06-18 | Phase 7 | The color normalizer treated the third `rgb()` channel as alpha, so values ending in `0` such as pure red/green were skipped and could not be replaced. | Fixed alpha handling to apply only to `rgba()` and covered it with `normalizeColorToHex`, collection, and replacement tests. | `apps/web/src/components/grapesjs/grapesjs-selection-colors.ts`, `apps/web/tests/components/grapesjs/grapesjs-selection-colors.test.ts` |
| 2026-06-18 | Validation | HTML editor focused tests pass after the selection-color extraction. Web typecheck still fails only on the known unrelated `ProjectView`, question-form export, and runtime export errors. | Ran focused Vitest for source/save/selection-store/selection-colors/bridge/GrapesJS/StylePanel/current FileViewer path, plus `git diff --check` and `pnpm --filter @open-design/web typecheck`. | `apps/web/tests/components/grapesjs/grapesjs-selection-colors.test.ts`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx`, `apps/web/tests/components/grapesjs/GrapesjsEditor.test.ts`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Phase 7 | The selected-colors data still crossed a shallow editor-handle Interface even after the collector was cached. | Added `selectedColors` to `SelectionSnapshot`, made `StylePanel` consume it from props, and removed `collectColorsFromSelection` from `GrapesjsEditorHandle`. | `apps/web/src/components/grapesjs/GrapesjsEditor.tsx`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx` |
| 2026-06-18 | Validation | The selected-colors snapshot migration keeps current HTML editor focused coverage green. Web typecheck still fails only on the known unrelated `ProjectView`, question-form export, and runtime export errors. | Ran focused Vitest for source/save/selection-store/selection-colors/bridge/GrapesJS/StylePanel/current FileViewer path, `FileWorkspace.test.tsx -t "previews an HTML file inline while keeping the Design Files tree and toolbar visible"`, plus `git diff --check` and `pnpm --filter @open-design/web typecheck`. | `apps/web/tests/components/grapesjs/StylePanel.test.tsx`, `apps/web/tests/components/grapesjs/GrapesjsEditor.test.ts`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx`, `apps/web/tests/components/FileWorkspace.test.tsx` |
| 2026-06-18 | Phase 7 | The no-selection canvas/page panel mixed canvas snapshot polling, style writes, size writes, and section rendering inside `StylePanel`. | Added `style-panel-canvas-state.ts` and moved canvas style/size snapshot polling plus canvas style/size writes behind `useStylePanelCanvasState`. | `apps/web/src/components/grapesjs/style-panel-canvas-state.ts`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/style-panel-canvas-state.test.tsx` |
| 2026-06-18 | Validation | The canvas/page state extraction keeps current HTML editor focused coverage green. Web typecheck still fails only on the known unrelated `ProjectView`, question-form export, and runtime export errors. | Ran focused Vitest for source/save/selection-store/selection-colors/style-panel-canvas-state/bridge/GrapesJS/StylePanel/current FileViewer path, plus `git diff --check` and `pnpm --filter @open-design/web typecheck`. | `apps/web/tests/components/grapesjs/style-panel-canvas-state.test.tsx`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Phase 7 | Image fill crop mode hid the upload/replace affordance and only showed a hint, so users could not comfortably replace images or adjust crop from the fill popover. | Kept the image upload/replace button mounted in crop mode, rendered `CropEditor` inline, read existing `background-size: Npx Npx` / `background-position` into crop state, and preserved crop sizing when replacing the image. | `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx` |
| 2026-06-18 | Phase 7 | Gradient editing was hard to operate because the stop bar did not show the live gradient, did not support click-to-add, and had English/non-specific controls. | Added a live gradient stop bar, click/keyboard add-stop behavior, selected-stop feedback, Chinese labels, accessible stop inputs, and hex color interpolation with a non-hex fallback. | `apps/web/src/components/GradientEditor.tsx`, `apps/web/src/styles/viewer/properties-panel.css`, `apps/web/tests/components/GradientEditor.test.tsx` |
| 2026-06-18 | Phase 7 | The advanced stroke panel exposed controls that did nothing (`onChange={() => undefined}` / `onClick={() => undefined}`), and StylePanel still carried unused multi-shadow helpers. | Wired stroke cap/join controls to CSS writes, removed the unsupported width-profile reverse control, removed unused shadow parse/build helpers, and removed unsupported Noise/Texture effect options. | `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/src/components/grapesjs/StylePanel.module.css`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx` |
| 2026-06-18 | Validation | The editing-panel, fill, gradient, selection, save, canvas-state, and FileViewer current HTML editor paths pass after the latest StylePanel work. Full `FileWorkspace.test.tsx` still fails unrelated Design Files/generation-preview cases when run wholesale. | Ran focused Vitest for GradientEditor, StylePanel, style-panel-canvas-state, selected colors, selection store, save controller, source round-trip, bridge adapter, GrapesJS editor, current FileViewer path, and the migrated FileWorkspace HTML preview case. | `apps/web/tests/components/GradientEditor.test.tsx`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx`, `apps/web/tests/components/FileWorkspace.test.tsx` |
| 2026-06-18 | Validation | `git diff --check` passes. `pnpm --filter @open-design/web typecheck` is still blocked by the known unrelated `ProjectView`, question-form export, and runtime export errors. `pnpm guard` is still blocked by repository-level pre-existing guard items: residual `apps/web/scripts/build.mjs`, non-exact CodeMirror/dependency specs, `e2e/test-css.mts` layout, and `tools/.DS_Store`. | Recorded blockers separately from this editing-panel slice so the next continuation does not treat them as new StylePanel regressions. | `apps/web/src/components/ProjectView.tsx`, `apps/web/package.json`, `e2e/test-css.mts`, `tools/.DS_Store` |
| 2026-06-18 | Phase 7 | Image upload/crop and size mapping still lived inside `StylePanel`, so the fill section could not be tested or evolved without loading the whole panel. | Extracted `image-fill-control.tsx` with `ImageFillControl`, `bgSizeFromOption`, and `optionFromBgSize`, then added direct tests for upload, crop-mode availability, and size round-trip behavior. | `apps/web/src/components/grapesjs/image-fill-control.tsx`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/image-fill-control.test.tsx` |
| 2026-06-18 | Phase 7 | High-frequency numeric scrub logic lived inline in `StylePanel`, and repeated pointermove events in the same scrub bucket could send redundant style writes. | Extracted `number-scrub.tsx` with `NumberScrub`, `pxToNum`, and `fieldDisplay`; added per-drag dedupe for repeated pointermove values and direct tests for parsing, keyboard commits, and scrub dedupe. | `apps/web/src/components/grapesjs/number-scrub.tsx`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/number-scrub.test.tsx` |
| 2026-06-18 | Validation | The new image fill and number scrub Modules keep the HTML editor focus path green. Web typecheck still fails only on the known unrelated `ProjectView`, question-form export, and runtime export errors. | Ran focused Vitest for source/save/selection-store/selection-colors/style-panel-canvas-state/bridge/GrapesJS/StylePanel/image-fill-control/number-scrub/GradientEditor/current FileViewer path, plus the migrated FileWorkspace HTML preview case and `git diff --check`. | `apps/web/tests/components/grapesjs/image-fill-control.test.tsx`, `apps/web/tests/components/grapesjs/number-scrub.test.tsx`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Phase 7 | The HSV color picker, palette, fill mode switcher, gradient branch, and image branch still lived as a large private implementation inside `StylePanel`. | Extracted `color-editor-popover.tsx`, removed the old inline `ColorEditor` and parser helpers from `StylePanel`, and kept the public panel interaction routed through the new Module. | `apps/web/src/components/grapesjs/color-editor-popover.tsx`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/color-editor-popover.test.tsx` |
| 2026-06-18 | Validation | Color editor extraction keeps the HTML editor focused suite green; web typecheck remains blocked only by the known unrelated `ProjectView`, question-form export, and runtime export errors. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts` for 13 HTML editor focused test files (107 tests), plus `pnpm --filter @open-design/web typecheck`. | `apps/web/tests/components/grapesjs/color-editor-popover.test.tsx`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Validation | `git diff --check` passes. `pnpm guard` still fails only on the known repo-level blockers: residual `apps/web/scripts/build.mjs`, non-exact CodeMirror/dependency specs, `e2e/test-css.mts` layout, and `tools/.DS_Store`. | Re-ran guard after the color editor extraction and recorded the blockers separately from the HTML editor work. | `apps/web/scripts/build.mjs`, `apps/web/package.json`, `e2e/test-css.mts`, `tools/.DS_Store` |
| 2026-06-18 | Phase 7 | Manual color text input, visibility toggles, and selected-color rows were repeated inside `StylePanel`, even though the same color-input rules are used by fill, text, stroke, shadow, and batch replacement. | Extracted `color-fields.tsx` with `cssColorToHex`, `normalizeTypedCssColor`, `ColorTextInput`, `ColorProperty`, and `SelectedColor`; removed the inline implementations from `StylePanel`. | `apps/web/src/components/grapesjs/color-fields.tsx`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/color-fields.test.tsx` |
| 2026-06-18 | Validation | Color field extraction keeps the HTML editor focused suite green. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts` for 14 HTML editor focused test files (111 tests). | `apps/web/tests/components/grapesjs/color-fields.test.tsx`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Validation | `git diff --check` passes. `pnpm --filter @open-design/web typecheck` still fails only on the known unrelated `ProjectView`, question-form export, and runtime export errors. | Re-ran typecheck and whitespace validation after the color field extraction. | `apps/web/src/components/ProjectView.tsx`, `apps/web/tests/components/ProjectView.questionFormKey.test.ts`, `apps/web/tests/runtime/exports.test.ts` |
| 2026-06-18 | Phase 7 | Effect type behavior was split between the main effect row and floating effect panel; the floating title select only changed local state and did not apply the selected CSS effect. | Extracted `effect-controls.ts` with effect options, shadow CSS building, type transitions, visibility toggles, and clear-all patches; both the main row and floating title now use the same transition Interface. | `apps/web/src/components/grapesjs/effect-controls.ts`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/effect-controls.test.ts` |
| 2026-06-18 | Validation | Effect-control extraction keeps the HTML editor focused suite green. | Ran `pnpm --dir apps/web exec vitest run -c vitest.config.ts` for 15 HTML editor focused test files (115 tests). | `apps/web/tests/components/grapesjs/effect-controls.test.ts`, `apps/web/tests/components/grapesjs/StylePanel.test.tsx`, `apps/web/tests/components/FileViewer.grapesjs-interactive.test.tsx` |
| 2026-06-18 | Validation | `git diff --check` passes. `pnpm --filter @open-design/web typecheck` still fails only on the known unrelated `ProjectView`, question-form export, and runtime export errors. | Re-ran typecheck and whitespace validation after the effect-control extraction. | `apps/web/src/components/ProjectView.tsx`, `apps/web/tests/components/ProjectView.questionFormKey.test.ts`, `apps/web/tests/runtime/exports.test.ts` |
| 2026-06-18 | Phase 7 | Stroke add/remove/color/visibility, stroke position mapping, dash building, and cap/join parsing still lived inline in `StylePanel`. | Extracted `stroke-controls.ts` with direct tests and routed the selected-element stroke section through the new Module. | `apps/web/src/components/grapesjs/stroke-controls.ts`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/stroke-controls.test.ts` |
| 2026-06-18 | Phase 7 | Auto-layout flow, dimension-mode derivation, and alignment-axis mapping were intertwined with the `StylePanel` render tree. | Extracted `layout-controls.ts` with direct tests for flow, dimension, and alignment patches. | `apps/web/src/components/grapesjs/layout-controls.ts`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/layout-controls.test.ts` |
| 2026-06-18 | Phase 7 | Panel-level UI primitives were embedded in `StylePanel`, making future section extractions carry too much local UI machinery. | Extracted `style-panel-primitives.tsx` for floating panels, icon controls, selects, sections, labels, and popover positioning; added direct primitive coverage. | `apps/web/src/components/grapesjs/style-panel-primitives.tsx`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/style-panel-primitives.test.tsx` |
| 2026-06-18 | Phase 7 | Transform helpers were inline, and repeated flip clicks stacked duplicate `scaleX(-1)` / `scaleY(-1)` operations. | Extracted `transform-controls.ts`; flip buttons now toggle the matching scale transform while preserving other transform operations. | `apps/web/src/components/grapesjs/transform-controls.ts`, `apps/web/src/components/grapesjs/StylePanel.tsx`, `apps/web/tests/components/grapesjs/transform-controls.test.ts` |
| 2026-06-18 | Validation | The expanded HTML editor focused suite passes after the stroke/layout/primitive/transform extractions. `git diff --check` passes. Web typecheck remains blocked only by the known unrelated `ProjectView`, question-form export, and runtime export errors. | Ran focused Vitest for 19 HTML editor files (130 tests), `git diff --check`, and `pnpm --filter @open-design/web typecheck`. | `apps/web/tests/components/grapesjs/stroke-controls.test.ts`, `apps/web/tests/components/grapesjs/layout-controls.test.ts`, `apps/web/tests/components/grapesjs/style-panel-primitives.test.tsx`, `apps/web/tests/components/grapesjs/transform-controls.test.ts` |
