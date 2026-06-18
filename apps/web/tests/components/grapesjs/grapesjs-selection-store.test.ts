import { describe, expect, it, vi } from 'vitest';
import type { Component, Editor } from 'grapesjs';

import {
  extractInspectTarget,
  extractInspectTargetFromComponent,
  findComponentByOdId,
  getNormalizedBoxFromComponent,
  getOdIdFromComponent,
} from '../../../src/components/grapesjs/grapesjs-bridge-adapter';
import {
  createGrapesjsSelectionStore,
  extractInspectTargetFromCurrentSelection,
  getCurrentSelectedComponent,
  readGrapesjsSelectionSnapshot,
} from '../../../src/components/grapesjs/grapesjs-selection-store';

vi.mock('../../../src/components/grapesjs/grapesjs-bridge-adapter', () => ({
  extractInspectTarget: vi.fn(() => ({ elementId: 'fallback' })),
  extractInspectTargetFromComponent: vi.fn(() => ({ elementId: 'selected' })),
  findComponentByOdId: vi.fn(),
  getNormalizedBoxFromComponent: vi.fn(() => ({ x: 1, y: 2, width: 3, height: 4 })),
  getOdIdFromComponent: vi.fn((component: { odId?: string }) => component.odId ?? null),
}));

describe('getCurrentSelectedComponent', () => {
  it('returns the current GrapesJS selection when available', () => {
    const selected = {} as Component;
    const editor = { getSelected: () => selected } as Editor;

    expect(getCurrentSelectedComponent(editor)).toBe(selected);
  });

  it('returns null when GrapesJS selection lookup throws', () => {
    const editor = { getSelected: () => { throw new Error('not ready'); } } as unknown as Editor;

    expect(getCurrentSelectedComponent(editor)).toBeNull();
  });
});

describe('extractInspectTargetFromCurrentSelection', () => {
  it('prefers the live selected component over a by-id tree lookup', () => {
    const selected = {} as Component;
    const editor = { getSelected: () => selected } as Editor;

    expect(extractInspectTargetFromCurrentSelection(editor, 'hero')).toEqual({ elementId: 'selected' });
    expect(extractInspectTargetFromComponent).toHaveBeenCalledWith(editor, selected);
    expect(extractInspectTarget).not.toHaveBeenCalled();
  });

  it('falls back to odId lookup when there is no selected component', () => {
    vi.mocked(extractInspectTarget).mockClear();
    vi.mocked(extractInspectTargetFromComponent).mockClear();
    vi.mocked(findComponentByOdId).mockReturnValue({ odId: 'hero' } as unknown as Component);
    const editor = { getSelected: () => null } as unknown as Editor;

    expect(extractInspectTargetFromCurrentSelection(editor, 'hero')).toEqual({ elementId: 'fallback' });
    expect(extractInspectTarget).toHaveBeenCalledWith(editor, 'hero');
    expect(extractInspectTargetFromComponent).not.toHaveBeenCalled();
  });
});

describe('readGrapesjsSelectionSnapshot', () => {
  it('returns one snapshot from the selected component', () => {
    const selected = { odId: 'hero', toHTML: () => '<h1>Hero</h1>' } as unknown as Component;
    const editor = { getSelected: () => selected } as Editor;

    expect(readGrapesjsSelectionSnapshot(editor, 'hero')).toEqual({
      component: selected,
      odId: 'hero',
      box: { x: 1, y: 2, width: 3, height: 4 },
      inspectTarget: { elementId: 'selected' },
      htmlHint: '<h1>Hero</h1>',
    });
    expect(getNormalizedBoxFromComponent).toHaveBeenCalledWith(editor, selected);
  });

  it('falls back to odId lookup when current selection belongs to another element', () => {
    vi.mocked(findComponentByOdId).mockClear();
    vi.mocked(extractInspectTarget).mockClear();
    vi.mocked(extractInspectTargetFromComponent).mockClear();
    const selected = { odId: 'selected' } as unknown as Component;
    const fallback = { odId: 'hovered', toHTML: () => '<p>Hovered</p>' } as unknown as Component;
    vi.mocked(findComponentByOdId).mockReturnValue(fallback);
    const editor = { getSelected: () => selected } as Editor;

    const snapshot = readGrapesjsSelectionSnapshot(editor, 'hovered');

    expect(snapshot?.component).toBe(fallback);
    expect(snapshot?.odId).toBe('hovered');
    expect(snapshot?.htmlHint).toBe('<p>Hovered</p>');
    expect(findComponentByOdId).toHaveBeenCalledWith(editor, 'hovered');
    expect(extractInspectTarget).toHaveBeenCalledWith(editor, 'hovered');
    expect(extractInspectTargetFromComponent).not.toHaveBeenCalled();
  });
});

describe('createGrapesjsSelectionStore', () => {
  it('reuses the cached snapshot for the same editor, selected component, and fallback id', () => {
    vi.mocked(getNormalizedBoxFromComponent).mockClear();
    const selected = { odId: 'hero', toHTML: () => '<h1>Hero</h1>' } as unknown as Component;
    const editor = { getSelected: () => selected } as Editor;
    const store = createGrapesjsSelectionStore();

    const first = store.readSnapshot(editor, 'hero');
    const second = store.readSnapshot(editor, 'hero');

    expect(second).toBe(first);
    expect(getNormalizedBoxFromComponent).toHaveBeenCalledTimes(1);
  });

  it('invalidates cached snapshots explicitly', () => {
    vi.mocked(getNormalizedBoxFromComponent).mockClear();
    const selected = { odId: 'hero', toHTML: () => '<h1>Hero</h1>' } as unknown as Component;
    const editor = { getSelected: () => selected } as Editor;
    const store = createGrapesjsSelectionStore();

    const first = store.readSnapshot(editor, 'hero');
    store.invalidate();
    const second = store.readSnapshot(editor, 'hero');

    expect(second).not.toBe(first);
    expect(getNormalizedBoxFromComponent).toHaveBeenCalledTimes(2);
  });

  it('keeps fallback ids isolated in the cache', () => {
    vi.mocked(findComponentByOdId).mockClear();
    vi.mocked(findComponentByOdId).mockImplementation((_editor, odId) => (
      { odId, toHTML: () => `<p>${odId}</p>` } as unknown as Component
    ));
    const editor = { getSelected: () => null } as unknown as Editor;
    const store = createGrapesjsSelectionStore();

    const first = store.readSnapshot(editor, 'first');
    const second = store.readSnapshot(editor, 'second');

    expect(first?.odId).toBe('first');
    expect(second?.odId).toBe('second');
    expect(findComponentByOdId).toHaveBeenCalledTimes(2);
  });
});
