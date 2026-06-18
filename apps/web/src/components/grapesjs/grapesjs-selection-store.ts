import type { Component, Editor } from 'grapesjs';
import type { InspectTarget } from '../viewer-utils';
import {
  extractInspectTarget,
  extractInspectTargetFromComponent,
  findComponentByOdId,
  getNormalizedBoxFromComponent,
  getOdIdFromComponent,
  type NormalizedRect,
} from './grapesjs-bridge-adapter';

export interface GrapesjsSelectionSnapshot {
  component: Component;
  odId: string;
  box: NormalizedRect | null;
  inspectTarget: InspectTarget | null;
  htmlHint: string;
}

export interface GrapesjsSelectionStore {
  readSnapshot(
    editor: Editor,
    fallbackOdId: string | null | undefined,
    options?: { preferCurrentSelection?: boolean },
  ): GrapesjsSelectionSnapshot | null;
  readInspectTarget(
    editor: Editor,
    fallbackOdId: string | null | undefined,
    options?: { preferCurrentSelection?: boolean },
  ): InspectTarget | null;
  invalidate(): void;
}

type SelectionCacheEntry = {
  editor: Editor;
  fallbackOdId: string | null;
  preferCurrentSelection: boolean;
  selected: Component | null;
  snapshot: GrapesjsSelectionSnapshot | null;
};

export function getCurrentSelectedComponent(editor: Editor): Component | null {
  try {
    return (editor.getSelected?.() as Component | null | undefined) ?? null;
  } catch {
    return null;
  }
}

export function extractInspectTargetFromCurrentSelection(
  editor: Editor,
  fallbackOdId: string | null | undefined,
): InspectTarget | null {
  return readGrapesjsSelectionSnapshot(editor, fallbackOdId)?.inspectTarget ?? null;
}

export function readGrapesjsSelectionSnapshot(
  editor: Editor,
  fallbackOdId: string | null | undefined,
  options: { preferCurrentSelection?: boolean } = {},
): GrapesjsSelectionSnapshot | null {
  const preferCurrentSelection = options.preferCurrentSelection ?? true;
  const selected = preferCurrentSelection ? getCurrentSelectedComponent(editor) : null;
  return computeGrapesjsSelectionSnapshot(editor, fallbackOdId, preferCurrentSelection, selected);
}

export function createGrapesjsSelectionStore(): GrapesjsSelectionStore {
  let cache: SelectionCacheEntry | null = null;
  const readSnapshot: GrapesjsSelectionStore['readSnapshot'] = (editor, fallbackOdId, options = {}) => {
    const preferCurrentSelection = options.preferCurrentSelection ?? true;
    const selected = preferCurrentSelection ? getCurrentSelectedComponent(editor) : null;
    const normalizedFallback = fallbackOdId ?? null;
    if (
      cache &&
      cache.editor === editor &&
      cache.fallbackOdId === normalizedFallback &&
      cache.preferCurrentSelection === preferCurrentSelection &&
      cache.selected === selected
    ) {
      return cache.snapshot;
    }
    const snapshot = computeGrapesjsSelectionSnapshot(
      editor,
      normalizedFallback,
      preferCurrentSelection,
      selected,
    );
    cache = {
      editor,
      fallbackOdId: normalizedFallback,
      preferCurrentSelection,
      selected,
      snapshot,
    };
    return snapshot;
  };
  return {
    readSnapshot,
    readInspectTarget(editor, fallbackOdId, options = {}) {
      return readSnapshot(editor, fallbackOdId, options)?.inspectTarget ?? null;
    },
    invalidate() {
      cache = null;
    },
  };
}

function computeGrapesjsSelectionSnapshot(
  editor: Editor,
  fallbackOdId: string | null | undefined,
  preferCurrentSelection: boolean,
  selected: Component | null,
): GrapesjsSelectionSnapshot | null {
  const selectedOdId = selected ? getOdIdFromComponent(selected) : null;
  const shouldUseSelected =
    preferCurrentSelection &&
    selected != null &&
    (!fallbackOdId || selectedOdId == null || selectedOdId === fallbackOdId);
  const component = shouldUseSelected
    ? selected
    : (fallbackOdId ? findComponentByOdId(editor, fallbackOdId) : null);
  if (!component) return null;

  const inspectTarget = shouldUseSelected
    ? extractInspectTargetFromComponent(editor, component)
    : (fallbackOdId ? extractInspectTarget(editor, fallbackOdId) : null);
  const odId = getOdIdFromComponent(component) ?? fallbackOdId ?? inspectTarget?.elementId ?? '';

  return {
    component,
    odId,
    box: getNormalizedBoxFromComponent(editor, component),
    inspectTarget,
    htmlHint: componentHtmlHint(component),
  };
}

function componentHtmlHint(component: Component): string {
  try {
    return String(component.toHTML?.() ?? '').trim();
  } catch {
    return '';
  }
}
