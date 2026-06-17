import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { ManualEditPanel, emptyManualEditDraft, manualEditPatchSummary, normalizeManualEditStyles, type ManualEditDraft } from '../../src/components/ManualEditPanel';
import { emptyManualEditStyles, type ManualEditPatch, type ManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';

const target: ManualEditTarget = {
  id: 'hero-title',
  kind: 'text',
  label: 'Hero Title',
  tagName: 'h1',
  className: 'hero',
  text: 'Original',
  rect: { x: 0, y: 0, width: 120, height: 40 },
  fields: { text: 'Original' },
  attributes: { 'data-od-id': 'hero-title' },
  styles: emptyManualEditStyles(),
  isLayoutContainer: false,
  outerHtml: '<h1 data-od-id="hero-title">Original</h1>',
};

const siblingTarget: ManualEditTarget = {
  ...target,
  id: 'hero-body',
  kind: 'container',
  label: 'Hero Body',
  tagName: 'div',
  className: 'hero-body',
  text: 'Body',
  rect: { x: 180, y: 20, width: 90, height: 50 },
  fields: { text: 'Body' },
  attributes: { 'data-od-id': 'hero-body' },
  isLayoutContainer: false,
  outerHtml: '<div data-od-id="hero-body">Body</div>',
  parentId: 'hero-parent',
};

type OnDraftChange = (draft: ManualEditDraft) => void;
type OnStyleChange = (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
type OnInvalidStyle = (id: string, keys: Array<keyof ManualEditStyles>) => void;
type OnApplyPatch = (patch: ManualEditPatch, label: string) => void;
type OnError = (message: string) => void;
type OnClearSelection = () => void;
type OnSaveDraft = () => void;
type OnCancelDraft = () => void;

describe('ManualEditPanel', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = dom.window.document.querySelector('#root') as HTMLDivElement;
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    dom.window.close();
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'HTMLElement');
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  });

  it('renders the style inspector without the advanced editor entry', () => {
    renderPanel();

    expect(host.textContent).toContain('TYPOGRAPHY');
    expect(host.textContent).not.toContain('Advanced');
  });

  it('commits a manually typed fill color after blur', () => {
    const onStyleChange = vi.fn<OnStyleChange>();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), backgroundColor: '#000000' },
    });
    const colorInput = host.querySelector('.cc-color-compact input:not([type="color"])') as HTMLInputElement | null;
    if (!colorInput) throw new Error('Color input not found');

    act(() => {
      colorInput.value = 'f6f6f6';
      Simulate.change(colorInput);
      Simulate.blur(colorInput);
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      { backgroundColor: '#f6f6f6' },
      'Style: Hero Title',
    );
  });

  it('does not commit short hex while the user is still typing a full fill color', () => {
    const onStyleChange = vi.fn<OnStyleChange>();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), backgroundColor: '#000000' },
    });
    const colorInput = host.querySelector('.cc-color-compact input:not([type="color"])') as HTMLInputElement | null;
    if (!colorInput) throw new Error('Color input not found');

    act(() => {
      colorInput.value = 'f6f';
      Simulate.change(colorInput);
      Simulate.blur(colorInput);
    });

    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it('shows a readable selected element name in the titlebar', () => {
    renderPanel({
      selectedTarget: {
        ...target,
        id: 'path-0-0',
        kind: 'container',
        label: 'div.container.hero-split',
        className: 'container hero-split',
        text: 'Turn a brand brief into an editorial collage system.',
        attributes: { 'data-od-source-path': 'path-0-0' },
      },
    });

    expect(host.querySelector('.manual-edit-titlebar')?.textContent).toContain('Hero split');
    expect(host.querySelector('.manual-edit-titlebar')?.textContent).not.toContain('div.container');
  });

  it('shows a drag handle for floating edit panels', () => {
    renderPanel({ floatingStyle: { left: 20, top: 24, width: 320, height: 380 } });

    expect(host.querySelector('.manual-edit-drag-handle')).not.toBeNull();
    expect(host.querySelector('.manual-edit-drag-handle')?.getAttribute('aria-label')).toBe('Move edit panel');
  });

  it('does not show page-level controls inside an element inspector', () => {
    const onClearSelection = vi.fn();
    renderPanel({ onClearSelection });

    expect(host.querySelector('button[aria-label="Show page inspector"]')).toBeNull();
    expect(host.textContent).not.toContain('PAGE');
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it('keeps inspector controls scrollable separately from footer actions', () => {
    renderPanel();

    const scrollRegion = host.querySelector('.manual-edit-scroll');
    const footer = host.querySelector('.manual-edit-footer');
    const deleteButton = host.querySelector('button[aria-label="Delete element"]');

    expect(scrollRegion?.textContent).toContain('TYPOGRAPHY');
    expect(scrollRegion?.contains(deleteButton)).toBe(false);
    expect(footer?.contains(deleteButton)).toBe(true);
    expect(deleteButton?.textContent).toBe('');
    expect(footer?.textContent).toContain('Cancel');
    expect(footer?.textContent).toContain('Save');
  });

  it('keeps delete confirmation as an icon-only action', () => {
    renderPanel();

    const footer = host.querySelector('.manual-edit-footer');
    const deleteButton = host.querySelector('button[aria-label="Delete element"]') as HTMLButtonElement | null;
    if (!deleteButton) throw new Error('Delete button not found');

    act(() => {
      deleteButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const confirmDeleteButton = host.querySelector(
      '.manual-edit-delete-confirm-action[aria-label="Delete element"]',
    ) as HTMLButtonElement | null;
    if (!confirmDeleteButton) throw new Error('Confirm delete button not found');

    expect(footer?.contains(confirmDeleteButton)).toBe(true);
    expect(confirmDeleteButton.textContent).toBe('');
    expect(confirmDeleteButton.className).toContain('manual-edit-delete-btn');
    expect(host.querySelector('.manual-edit-delete-confirm')?.textContent).toBe('Cancel');
  });

  it('routes footer cancel and save actions', () => {
    const onCancelDraft = vi.fn<OnCancelDraft>();
    const onSaveDraft = vi.fn<OnSaveDraft>();
    renderPanel({ onCancelDraft, onSaveDraft });

    const footerButtons = Array.from(host.querySelectorAll('.manual-edit-footer button'));
    const cancel = footerButtons.find((button) => button.textContent === 'Cancel') as HTMLButtonElement | undefined;
    const save = footerButtons.find((button) => button.textContent === 'Save') as HTMLButtonElement | undefined;
    if (!cancel || !save) throw new Error('Footer action buttons not found');

    act(() => {
      cancel.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onCancelDraft).toHaveBeenCalledTimes(1);
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('normalizes font stacks and writes a usable font-family value', () => {
    const onDraftChange = vi.fn();
    const onStyleChange = vi.fn();
    renderPanel({
      onDraftChange,
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        fontFamily: '"Roboto", sans-serif',
        fontSize: '32px',
        color: '#111111',
        paddingTop: '8px',
      },
    });

    const fontSelect = host.querySelector('select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');
    expect(fontSelect.value).toBe('Roboto, Arial, sans-serif');

    act(() => {
      fontSelect.value = 'Georgia, serif';
      fontSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      styles: expect.objectContaining({ fontFamily: 'Georgia, serif' }),
    }));
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { fontFamily: 'Georgia, serif' }, 'Style: Hero Title');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ fontSize: '32px', color: '#111111', paddingTop: '8px' }),
      'Style: Hero Title',
    );
  });

  it('shows px-backed values without px in numeric inputs', () => {
    renderPanel({
      styles: {
        ...emptyManualEditStyles(),
        fontSize: '32px',
      },
    });

    const sizeRow = Array.from(host.querySelectorAll('.cc-row'))
      .find((row) => row.textContent?.includes('Size'));
    const sizeInput = sizeRow?.querySelector('input') as HTMLInputElement | null;
    if (!sizeInput) throw new Error('Size input not found');

    expect(sizeInput.value).toBe('32');
  });

  it('increments text typography rows with normalized values', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        fontSize: '32px',
        lineHeight: '1.4',
        letterSpacing: '1px',
      },
    });

    const sizeIncrease = host.querySelector('button[aria-label="Size increase"]') as HTMLButtonElement | null;
    const lineIncrease = host.querySelector('button[aria-label="Line increase"]') as HTMLButtonElement | null;
    const trackingDecrease = host.querySelector('button[aria-label="Tracking decrease"]') as HTMLButtonElement | null;
    if (!sizeIncrease || !lineIncrease || !trackingDecrease) throw new Error('Stepper button not found');

    act(() => {
      sizeIncrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      lineIncrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      trackingDecrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { fontSize: '33px' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { lineHeight: '1.5' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { letterSpacing: '0px' }, 'Style: Hero Title');
    expect(host.textContent).not.toContain('Opacity');
    expect(host.textContent).not.toContain('Padding');
  });

  it('does not persist an unchanged target style when the inspector opens', () => {
    vi.useFakeTimers();
    try {
      const onApplyPatch = vi.fn();
      renderPanel({ onApplyPatch });

      act(() => {
        vi.advanceTimersByTime(1600);
      });

      expect(onApplyPatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes valid style values before host preview/persistence', () => {
    expect(normalizeManualEditStyles({
      fontSize: '48',
      color: '#f00',
      opacity: '2',
      lineHeight: '1.4',
    }, { layoutEnabled: true })).toEqual({
      ok: true,
      styles: {
        fontSize: '48px',
        color: '#ff0000',
        opacity: '1',
        lineHeight: '1.4',
      },
    });
    expect(normalizeManualEditStyles({ lineHeight: '49px' }, { layoutEnabled: true })).toEqual({
      ok: true,
      styles: { lineHeight: '49px' },
    });
  });

  it('rejects invalid style values before host preview/persistence', () => {
    expect(normalizeManualEditStyles({ color: 'tomato' }, { layoutEnabled: true })).toEqual({
      ok: false,
      error: 'color must be a hex color.',
    });
    expect(normalizeManualEditStyles({ lineHeight: '-1px' }, { layoutEnabled: true })).toEqual({
      ok: false,
      error: 'Line height must be a positive number or px value.',
    });
  });

  it('treats empty values as inline style clears', () => {
    expect(normalizeManualEditStyles({ fontSize: '', color: '' }, { layoutEnabled: true })).toEqual({
      ok: true,
      styles: { fontSize: '', color: '' },
    });
  });

  it('does not validate unchanged computed line-height values on blur', () => {
    const onError = vi.fn();
    const onStyleChange = vi.fn();
    renderPanel({
      onError,
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        lineHeight: '48.96px',
      },
    });

    const lineInput = Array.from(host.querySelectorAll('.cc-row'))
      .find((row) => row.textContent?.includes('Line'))
      ?.querySelector('input') as HTMLInputElement | null;
    if (!lineInput) throw new Error('Line input not found');

    act(() => {
      lineInput.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: true }));
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it('accepts edited computed pixel line-height values', () => {
    const onError = vi.fn();
    const onStyleChange = vi.fn();
    renderPanel({
      onError,
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        lineHeight: '48.96px',
      },
    });

    const lineInput = Array.from(host.querySelectorAll('.cc-row'))
      .find((row) => row.textContent?.includes('Line'))
      ?.querySelector('input') as HTMLInputElement | null;
    if (!lineInput) throw new Error('Line input not found');

    act(() => {
      lineInput.value = '49px';
      Simulate.change(lineInput);
    });

    expect(onError).toHaveBeenCalledWith('');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { lineHeight: '49px' }, 'Style: Hero Title');
  });

  it('does not persist unchanged page styles when no target is selected', () => {
    vi.useFakeTimers();
    try {
      const onApplyPatch = vi.fn();
      renderPanel({ onApplyPatch, selectedTarget: null });

      act(() => {
        vi.advanceTimersByTime(1600);
      });

      expect(onApplyPatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits only the changed page style field', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null });

    const bgSwatch = host.querySelector('button[aria-label="Pick Background"]') as HTMLButtonElement | null;
    if (!bgSwatch) throw new Error('Background swatch not found');

    act(() => {
      bgSwatch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    const colorTile = host.querySelector('button[aria-label="#3b82f6"]') as HTMLButtonElement | null;
    if (!colorTile) throw new Error('Background color tile not found');
    act(() => {
      colorTile.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('__body__', { backgroundColor: '#3b82f6' }, 'Page styles');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ fontFamily: expect.any(String) }),
      'Page styles',
    );
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ fontSize: expect.any(String) }),
      'Page styles',
    );
  });

  it('does not emit untouched page fields when changing the page font', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null });

    const fontSelect = host.querySelector('.cc-row select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');

    act(() => {
      fontSelect.value = 'Georgia, serif';
      fontSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('__body__', { fontFamily: 'Georgia, serif' }, 'Page styles');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ backgroundColor: expect.any(String) }),
      'Page styles',
    );
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ fontSize: expect.any(String) }),
      'Page styles',
    );
  });

  it('shows an inactive Page inspector for fragment HTML sources', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null, pageStylesEnabled: false });

    expect(host.textContent).toContain('Page styles are available only for full HTML documents.');
    expect(host.textContent).not.toContain('Background');
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('select')).toBeNull();
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it('keeps explicit empty page values as field-specific clears', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null });

    const fontSelect = host.querySelector('.cc-row select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');

    act(() => {
      fontSelect.value = '';
      fontSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('__body__', { fontFamily: '' }, 'Page styles');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ backgroundColor: expect.any(String), fontFamily: expect.any(String) }),
      'Page styles',
    );
  });

  it('treats computed no-op stroke and shadow values as absent effects', () => {
    renderPanel({
      selectedTarget: { ...target, kind: 'container', isLayoutContainer: true },
      styles: {
        ...emptyManualEditStyles(),
        border: '0px none rgb(0, 0, 0)',
        borderTopWidth: '0px',
        borderRightWidth: '0px',
        borderBottomWidth: '0px',
        borderLeftWidth: '0px',
        borderStyle: 'none',
        boxShadow: 'none',
      },
    });

    expect(sectionByTitle('Stroke').querySelector('input')).toBeNull();
    expect(sectionByTitle('Effect').textContent).not.toContain('Drop shadow');
  });

  it('removes fill, stroke, and shadow as whole effects from the section action', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      selectedTarget: { ...target, kind: 'container', isLayoutContainer: true },
      styles: {
        ...emptyManualEditStyles(),
        backgroundColor: '#ffffff',
        border: '1px solid #111111',
        borderTopWidth: '1px',
        borderRightWidth: '1px',
        borderBottomWidth: '1px',
        borderLeftWidth: '1px',
        borderColor: '#111111',
        borderStyle: 'solid',
        boxShadow: '0px 4px 12px 0px rgba(0,0,0,0.2)',
      },
    });

    const fillAction = sectionActionButton('Fill');
    const strokeAction = sectionActionButton('Stroke');
    const effectAction = sectionActionButton('Effect');

    act(() => {
      fillAction.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      strokeAction.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      effectAction.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { backgroundColor: '' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', {
      border: '',
      borderTopWidth: '0px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      borderColor: '',
      borderStyle: 'none',
    }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { boxShadow: '' }, 'Style: Hero Title');
  });

  it('hides layout controls for non-layout single targets', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        gap: 'normal',
        flexDirection: 'row',
      },
    });

    const layoutSection = Array.from(host.querySelectorAll('.cc-section, .pp-section')).find((section) => (
      section.textContent?.includes('Auto Layout')
    ));
    expect(layoutSection).toBeUndefined();
    expect(normalizeManualEditStyles({ gap: '12', flexDirection: 'column' }, { layoutEnabled: false })).toEqual({
      ok: true,
      styles: {},
    });
  });

  it('enables layout controls for flex or grid containers', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: {
        ...emptyManualEditStyles(),
        gap: '8px',
        flexDirection: 'row',
      },
    });

    const layoutSection = sectionByTitle('Auto Layout');
    const gapInput = layoutSection.querySelector('.pp-main-axis-gap input') as HTMLInputElement | null;
    const verticalButton = layoutSection.querySelector('button[data-tooltip="Vertical"]') as HTMLButtonElement | null;
    if (!gapInput || !verticalButton) throw new Error('Layout controls not found');
    expect(gapInput.disabled).toBe(false);
    expect(verticalButton.disabled).toBe(false);

    act(() => {
      gapInput.value = '9';
      Simulate.change(gapInput);
      verticalButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { columnGap: '9px' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { display: 'flex', flexDirection: 'column' }, 'Style: Hero Title');
  });

  it('shows content, fixed, and fill sizing modes for elements inside auto layout parents', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      selectedTarget: {
        ...target,
        parentLayout: { display: 'flex', flexDirection: 'row' },
      },
      styles: {
        ...emptyManualEditStyles(),
        width: '120px',
        height: '40px',
      },
    });

    const widthMode = host.querySelector('select[data-testid="manual-edit-width-mode"]') as HTMLSelectElement | null;
    const heightMode = host.querySelector('select[data-testid="manual-edit-height-mode"]') as HTMLSelectElement | null;
    if (!widthMode || !heightMode) throw new Error('Sizing mode selects not found');

    expect(Array.from(widthMode.options).map((option) => option.textContent)).toEqual([
      '适应内容',
      '固定宽度',
      '撑满容器',
    ]);
    expect(Array.from(heightMode.options).map((option) => option.textContent)).toEqual([
      '适应内容',
      '固定高度',
      '撑满容器',
    ]);
    expect(host.querySelector('[data-size-axis="width"] [data-size-icon="width"]')).not.toBeNull();
    expect(host.querySelector('[data-size-axis="height"] [data-size-icon="height"]')).not.toBeNull();

    act(() => {
      widthMode.value = 'content';
      Simulate.change(widthMode);
      heightMode.value = 'content';
      Simulate.change(heightMode);
      widthMode.value = 'fill';
      Simulate.change(widthMode);
      heightMode.value = 'fill';
      Simulate.change(heightMode);
    });

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { width: 'auto' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { height: 'auto' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { width: '100%' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { height: '100%' }, 'Style: Hero Title');
  });

  it('uses one main-axis gap control and removes grid from auto layout direction controls', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: {
        ...emptyManualEditStyles(),
        display: 'flex',
        flexDirection: 'column',
        rowGap: '8px',
        columnGap: '12px',
      },
    });

    const layoutSection = sectionByTitle('Auto Layout');
    expect(layoutSection.querySelector('button[data-tooltip="Grid"]')).toBeNull();
    expect(layoutSection.querySelector('img[src$="/manual-edit-icons/vertical.svg"]')).not.toBeNull();
    expect(layoutSection.querySelector('img[src$="/manual-edit-icons/horizontal.svg"]')).not.toBeNull();
    expect(layoutSection.querySelector('img[src$="/manual-edit-icons/wrap.svg"]')).not.toBeNull();
    const mainGapInputs = layoutSection.querySelectorAll('.pp-main-axis-gap input');
    expect(mainGapInputs).toHaveLength(1);
    const flowRow = layoutSection.querySelector('.pp-flow-row');
    expect(flowRow?.querySelector('button[data-tooltip="Wrap"]')).not.toBeNull();

    const mainGap = mainGapInputs[0] as HTMLInputElement;
    act(() => {
      mainGap.value = '10';
      Simulate.change(mainGap);
    });

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { rowGap: '10px' }, 'Style: Hero Title');
    expect(onStyleChange).not.toHaveBeenCalledWith('hero-title', { columnGap: '10px' }, 'Style: Hero Title');
  });

  it('marks outer margin controls by physical side for directional spacing icons', () => {
    renderPanel();

    const marginSection = sectionByTitle('Position');
    expect(marginSection.querySelector('[data-spacing-side="top"]')).not.toBeNull();
    expect(marginSection.querySelector('[data-spacing-side="right"]')).not.toBeNull();
    expect(marginSection.querySelector('[data-spacing-side="bottom"]')).not.toBeNull();
    expect(marginSection.querySelector('[data-spacing-side="left"]')).not.toBeNull();
    expect(marginSection.querySelector('[data-spacing-side="top"] [data-spacing-icon="spacing-top"]')).not.toBeNull();
    expect(marginSection.querySelector('[data-spacing-side="right"] [data-spacing-icon="spacing-right"]')).not.toBeNull();
    expect(marginSection.querySelector('[data-spacing-side="bottom"] [data-spacing-icon="spacing-bottom"]')).not.toBeNull();
    expect(marginSection.querySelector('[data-spacing-side="left"] [data-spacing-icon="spacing-left"]')).not.toBeNull();
    expect(marginSection.querySelector('img[src$="/manual-edit-icons/spacing-top.svg"]')).not.toBeNull();
    expect(marginSection.querySelector('img[src$="/manual-edit-icons/spacing-right.svg"]')).not.toBeNull();
    expect(marginSection.querySelector('img[src$="/manual-edit-icons/spacing-bottom.svg"]')).not.toBeNull();
    expect(marginSection.querySelector('img[src$="/manual-edit-icons/spacing-left.svg"]')).not.toBeNull();
    expect(marginSection.querySelector('.pp-margin-axis-icons')).toBeNull();
  });

  it('places padding expand and arrangement controls in the inner spacing header', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: {
        ...emptyManualEditStyles(),
        display: 'flex',
        flexDirection: 'column',
      },
    });

    const layoutSection = sectionByTitle('Auto Layout');
    expect(layoutSection.querySelector('.pp-auto-layout-body')).not.toBeNull();
    expect(layoutSection.querySelector('.pp-auto-layout-left')).not.toBeNull();
    expect(layoutSection.querySelector('.pp-auto-layout-right')).not.toBeNull();
    const paddingHeader = layoutSection.querySelector('.pp-gap-header');
    expect(paddingHeader?.querySelector('img[src$="/manual-edit-icons/expanded-margin.svg"]')).not.toBeNull();
    expect(paddingHeader?.querySelector('button[data-padding-arrangement="vertical"] img[src$="/manual-edit-icons/vertical-margin.svg"]')).not.toBeNull();
    expect(paddingHeader?.querySelector('button[data-padding-arrangement="horizontal"] img[src$="/manual-edit-icons/horizontal-margin.svg"]')).not.toBeNull();

    const expand = paddingHeader?.querySelector<HTMLButtonElement>('button.pp-gap-toggle');
    if (!expand) throw new Error('Padding expand button not found');
    expect(expand.className).not.toContain('pp-gap-toggle-active');

    act(() => {
      expand.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const activeExpand = sectionByTitle('Auto Layout').querySelector<HTMLButtonElement>('button.pp-gap-toggle');
    expect(activeExpand?.className).toContain('pp-gap-toggle-active');

    act(() => {
      layoutSection.querySelector<HTMLButtonElement>('button[data-padding-arrangement="vertical"]')?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
      layoutSection.querySelector<HTMLButtonElement>('button[data-padding-arrangement="horizontal"]')?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      { display: 'flex', flexDirection: 'column', justifyContent: 'space-between' },
      'Style: Hero Title',
    );
    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      { display: 'flex', flexDirection: 'row', justifyContent: 'space-between' },
      'Style: Hero Title',
    );
  });

  it('maps horizontal auto-layout alignment dots to justify columns and align rows', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: {
        ...emptyManualEditStyles(),
        display: 'flex',
        flexDirection: 'row',
      },
    });

    const layoutSection = sectionByTitle('Auto Layout');
    const middleLeft = layoutSection.querySelector<HTMLButtonElement>(
      '.pp-align-grid-box button[data-align-row="1"][data-align-col="0"]',
    );
    if (!middleLeft) throw new Error('Middle-left alignment control not found');
    expect(middleLeft.getAttribute('data-tooltip-placement')).toBe('left');

    act(() => {
      middleLeft.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      { justifyContent: 'flex-start' },
      'Style: Hero Title',
    );
    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      { alignItems: 'center' },
      'Style: Hero Title',
    );
  });

  it('batch applies style changes when multiple targets are selected', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      selectedTargets: [{ ...target, parentId: 'hero-parent' }, siblingTarget],
    });

    const opacityInput = Array.from(host.querySelectorAll('.pp-section input'))
      .find((input) => input.closest('.pp-section')?.textContent?.includes('Opacity')) as HTMLInputElement | undefined;
    if (!opacityInput) throw new Error('Opacity input not found');

    act(() => {
      opacityInput.value = '65';
      Simulate.change(opacityInput);
    });

    expect(onStyleChange).toHaveBeenCalledWith('__selection__', { opacity: '0.65' }, 'Style: 2 elements');
  });

  it('shows same-parent alignment controls for non-auto-layout multi selections', () => {
    const onApplyPatch = vi.fn();
    renderPanel({
      onApplyPatch,
      selectedTargets: [{ ...target, parentId: 'hero-parent' }, siblingTarget],
    });

    const toolbar = host.querySelector('.pp-alignment-toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelector('button[data-align-action="left"]')).not.toBeNull();
    expect(toolbar?.querySelector('img[src$="/manual-edit-icons/distribute-horizontal.svg"]')).not.toBeNull();
    expect(toolbar?.querySelector('img[src$="/manual-edit-icons/distribute-vertical.svg"]')).not.toBeNull();

    act(() => {
      toolbar?.querySelector<HTMLButtonElement>('button[data-align-action="left"]')?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onApplyPatch).toHaveBeenCalledWith(
      {
        kind: 'align-elements',
        ids: ['hero-title', 'hero-body'],
        mode: 'left',
        rects: {
          'hero-title': target.rect,
          'hero-body': siblingTarget.rect,
        },
      },
      'Align left',
    );
  });

  it('shows a text textarea for single selected text elements', () => {
    const onDraftChange = vi.fn();
    const onApplyPatch = vi.fn();
    renderPanel({ onDraftChange, onApplyPatch });

    const textarea = host.querySelector('textarea[data-testid="manual-edit-textarea"]') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('Text textarea not found');

    act(() => {
      textarea.value = 'Rewritten headline';
      Simulate.change(textarea);
      Simulate.blur(textarea);
    });

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ text: 'Rewritten headline' }));
    expect(onApplyPatch).toHaveBeenCalledWith(
      { id: 'hero-title', kind: 'set-text', value: 'Rewritten headline' },
      'Edit text',
    );
  });

  it('summarizes full-source history entries without rendering the full file', () => {
    const source = '<html><body>' + 'x'.repeat(10_000) + '</body></html>';

    expect(manualEditPatchSummary({ kind: 'set-full-source', source })).toBe(
      JSON.stringify({ kind: 'set-full-source', bytes: source.length }),
    );
    expect(manualEditPatchSummary({ kind: 'set-full-source', source })).not.toContain('x'.repeat(100));
  });

  function sectionByTitle(title: string): HTMLElement {
    const section = Array.from(host.querySelectorAll('.cc-section, .pp-section'))
      .find((candidate) => {
        const heading = candidate.querySelector('.cc-section-head, .pp-section-head');
        return heading?.textContent?.replace('▾', '').trim() === title;
      }) as HTMLElement | undefined;
    if (!section) throw new Error(`${title} section not found`);
    return section;
  }

  function sectionActionButton(title: string): HTMLButtonElement {
    const button = sectionByTitle(title).querySelector('.pp-section-actions button') as HTMLButtonElement | null;
    if (!button) throw new Error(`${title} action not found`);
    return button;
  }

  function renderPanel({
    onDraftChange = vi.fn<OnDraftChange>(),
    onApplyPatch = vi.fn<OnApplyPatch>(),
    onError = vi.fn<OnError>(),
    onStyleChange = vi.fn<OnStyleChange>(),
    onInvalidStyle = vi.fn<OnInvalidStyle>(),
    onClearSelection = vi.fn<OnClearSelection>(),
    onCancelDraft = vi.fn<OnCancelDraft>(),
    onSaveDraft = vi.fn<OnSaveDraft>(),
    attributesText = '{}',
    selectedTarget = target,
    styles = emptyManualEditStyles(),
    pageStylesEnabled = true,
    floatingStyle,
    onFloatingPositionChange,
    selectedTargets,
  }: {
    onDraftChange?: OnDraftChange;
    onApplyPatch?: OnApplyPatch;
    onError?: OnError;
    onStyleChange?: OnStyleChange;
    onInvalidStyle?: OnInvalidStyle;
    onClearSelection?: OnClearSelection;
    onCancelDraft?: OnCancelDraft;
    onSaveDraft?: OnSaveDraft;
    attributesText?: string;
    selectedTarget?: ManualEditTarget | null;
    styles?: ReturnType<typeof emptyManualEditStyles>;
    pageStylesEnabled?: boolean;
    floatingStyle?: CSSProperties;
    onFloatingPositionChange?: (position: { left: number; top: number }) => void;
    selectedTargets?: ManualEditTarget[];
  } = {}) {
    const draft = {
      ...emptyManualEditDraft('<html></html>'),
      text: 'Updated copy',
      attributesText,
      styles,
      outerHtml: target.outerHtml,
    };
    act(() => {
      root.render(
        <ManualEditPanel
          targets={[target]}
          selectedTarget={selectedTarget}
          selectedTargets={selectedTargets}
          draft={draft}
          history={[]}
          error={null}
          canUndo={false}
          canRedo={false}
          pageStylesEnabled={pageStylesEnabled}
          onSelectTarget={vi.fn<(target: ManualEditTarget) => void>()}
          onDraftChange={onDraftChange}
          onStyleChange={onStyleChange}
          onInvalidStyle={onInvalidStyle}
          onApplyPatch={onApplyPatch}
          onError={onError}
          onClearSelection={onClearSelection}
          onCancelDraft={onCancelDraft}
          onSaveDraft={onSaveDraft}
          onUndo={vi.fn<() => void>()}
          onRedo={vi.fn<() => void>()}
          floatingStyle={floatingStyle}
          onFloatingPositionChange={onFloatingPositionChange}
        />,
      );
    });
  }

});
