# HTML Editor Figma-Style Optimization Plan

Last reviewed: 2026-06-18.

Source inputs:

- User audit request for `docs/ui-region-map.md`, edit mode, code mode, edit properties, update performance, save mechanics, and canvas-panel communication.
- Code audit around `apps/web/src/components/FileViewer.tsx`, `FileWorkspace.tsx`, `ProjectView.tsx`, `components/grapesjs/*`, `runtime/srcdoc.ts`, and related tests.
- Repository rules from root `AGENTS.md`, `apps/AGENTS.md`, and `e2e/AGENTS.md`.

Status: planning document only. No source code has been changed by this plan.

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
rg -n "defaultEditMode|manualEditMode|manual-edit-mode-toggle|exitManualEditModeAfterFlush|syncGrapesjsDocumentToSource|runtimeScript|grapesjsSidebarTab" apps/web/src/components
rg -n "walkAll|findComponentByOdId|getNormalizedBox|extractInspectTarget|collectColorsFromSelection|querySelectorAll" apps/web/src/components/grapesjs apps/web/src/components/FileViewer.tsx
rg -n "manual-edit-mode-toggle|ManualEditPanel|edit-mode/bridge|app-manual-edit" apps/web/tests e2e/ui
```

5. Pick the first unchecked phase that still matches the codebase.
6. Before editing code, update this document if the phase needs a changed approach.
7. After each phase, append a dated note to "Discovery Log" with findings, decisions, and tests run.
8. If this document conflicts with the code, trust the code, then update this document before continuing.

## Current Diagnosis

### 1. GrapesJS path still shares legacy manual edit state

Current anchors from 2026-06-18:

- `apps/web/src/components/FileWorkspace.tsx:2652` and `apps/web/src/components/FileWorkspace.tsx:2809` pass `defaultEditMode`.
- `apps/web/src/components/FileViewer.tsx:4363` initializes `manualEditMode` from `defaultEditMode`.
- `apps/web/src/components/FileViewer.tsx:7746` has `syncGrapesjsDocumentToSource`.
- `apps/web/src/components/FileViewer.tsx:7826`, `7865`, and nearby tool activation paths check `manualEditMode` and may call `exitManualEditModeAfterFlush`.
- `apps/web/src/components/FileViewer.tsx:9296`, `9302`, and `9495` sync GrapesJS content before mode transitions or saves.

Problem: `manualEditMode` is doing too much. It represents old iframe editing, GrapesJS edit availability, toolbar state, edit panel state, and exit/flush behavior. This makes tool switching slower and makes code difficult to reason about.

Target module depth: introduce a smaller HTML editor shell interface where callers ask for user-level actions such as select, edit styles, switch tool, switch source, save, and flush. The implementation decides whether GrapesJS or fallback iframe handles the action.

### 2. Manual edit toolbar and tests are inconsistent

Current anchors:

- `apps/web/src/components/FileViewer.tsx:9137` still renders `data-testid="manual-edit-mode-toggle"` in the current worktree.
- `e2e/ui/app-manual-edit.test.ts` still exercises old manual edit behavior.
- `apps/web/tests/components/FileViewer.manual-edit*.tsx`, `ManualEditPanel.test.tsx`, and `apps/web/tests/edit-mode/bridge.test.ts` cover iframe manual-edit details.

Problem: tests still encode an older product model. Some may be useful as fallback tests, but many now pull the architecture back toward the old iframe bridge.

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

- [ ] Re-read `docs/ui-region-map.md` and compare it to the current `FileViewer`, `FileWorkspace`, and GrapesJS layout.
- [ ] Record the current dirty worktree state in this document if optimization work begins while user changes are present.
- [ ] Confirm whether `manual-edit-mode-toggle` is currently rendered or commented in the active worktree.
- [ ] List current GrapesJS, FileViewer, and manual edit tests before deleting or migrating anything.
- [ ] Add any newly discovered anchors to "Current Diagnosis".

Acceptance criteria:

- This document describes the current code accurately enough for another agent to resume.
- No source code changes are made in this phase unless they are documentation-only updates to this file.

Suggested verification:

```bash
git status --short
rg -n "manual-edit-mode-toggle|defaultEditMode|manualEditMode" apps/web/src/components apps/web/tests e2e/ui
```

### Phase 1 - Separate HTML Editor State From Legacy Manual Edit State

Objective: stop using one `manualEditMode` flag for both current GrapesJS editing and old iframe manual editing.

Steps:

- [ ] Define the product states in code terms: preview, visual edit, source code, comment, draw, and fallback iframe edit.
- [ ] Replace ambiguous `defaultEditMode` usage for HTML artifacts with a clearer editor entry state, such as `initialHtmlEditorMode` or a derived GrapesJS-first mode.
- [ ] Ensure `FileWorkspace` and `ProjectView` do not force the old iframe edit mode just because the active file is HTML.
- [ ] Change Comment and Draw activation so they do not call `exitManualEditModeAfterFlush` for the GrapesJS path.
- [ ] Keep legacy iframe edit exit/flush only where fallback iframe edit is truly active.
- [ ] Update user-facing mode state and callbacks so the left nav, canvas toolbar, and right edit panel agree.

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

- [ ] Classify `e2e/ui/app-manual-edit.test.ts` cases as migrate, fallback-only, or delete.
- [ ] Classify `apps/web/tests/components/FileViewer.manual-edit*.tsx` cases the same way.
- [ ] Classify `apps/web/tests/components/ManualEditPanel.test.tsx` and `apps/web/tests/edit-mode/bridge.test.ts`.
- [ ] Preserve low-level source patch tests if the patch helpers remain used.
- [ ] Add or strengthen GrapesJS tests for selection, property edits, code mode sync, and save flushing.
- [ ] Replace old P0 manual edit e2e coverage with current GrapesJS editor coverage.

Likely delete or quarantine candidates after migration:

- `e2e/ui/app-manual-edit.test.ts`, if iframe manual edit is not a product surface.
- `apps/web/tests/components/FileViewer.manual-edit.test.tsx`
- `apps/web/tests/components/FileViewer.manual-edit-history.test.tsx`
- `apps/web/tests/components/FileViewer.manual-edit-viewport.test.tsx`
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
```

### Phase 3 - Unified HTML Document Save Controller

Objective: make all HTML editing paths share one save queue and one flush contract.

Steps:

- [ ] Extract a save controller from `FileViewer` and GrapesJS save logic.
- [ ] Move debounce timers, pending flags, version/source snapshots, and flush behavior behind the controller interface.
- [ ] Route GrapesJS canvas changes, code mode saves, inspect/property saves, viewport/canvas style saves, and fallback manual patches through the controller.
- [ ] Replace direct save fetches in UI handlers with controller calls.
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

- [ ] Introduce an `EditorSelectionStore` module near `components/grapesjs/`.
- [ ] Store selected GrapesJS component, `odId`, element reference when available, normalized box, inspect target, and style snapshot.
- [ ] Replace repeated `findComponentByOdId`, `getNormalizedBox`, and `extractInspectTarget` calls in hot paths with store reads.
- [ ] Make comment snapshot, selection overlay, and style panel subscribe to the same selection interface.
- [ ] Add invalidation on GrapesJS component update, removal, canvas rerender, and source reload.
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
- [ ] Move `collectColorsFromSelection` or replace it with cached style snapshot from Phase 4.
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
- [ ] Use the Phase 4 selection/style snapshot instead of repeatedly calling `collectColorsFromSelection`.
- [ ] Keep local draft state per section so typing and sliders do not rerender the full panel unnecessarily.
- [ ] Throttle or batch high-frequency numeric controls before save, while still applying canvas preview immediately.
- [ ] Keep accessibility labels and keyboard behavior intact.

Acceptance criteria:

- Selecting different elements updates panel fields quickly.
- Dragging numeric style controls feels smooth and does not trigger excessive saves.
- Color collection no longer scans every descendant on every small interaction.

Suggested tests:

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/grapesjs/StylePanel.test.tsx
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

