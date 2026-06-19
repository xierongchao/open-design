import { describe, expect, it, vi } from 'vitest';

import {
  appendGrapesjsCanvasToolComponent,
  alignGrapesjsPositionedSelection,
  applyGrapesjsCssStyleClipboardToComponents,
  arrangeGrapesjsSelectionAsFlex,
  attachGrapesjsCanvasViewportSync,
  attachGrapesjsResizePersistence,
  buildEditorDocument,
  buildGrapesjsCssStyleClipboard,
  buildGrapesjsCanvasToolComponent,
  canvasComponentHtml,
  calculateGrapesjsCornerRadiusDrag,
  calculateGrapesjsCornerRadiusFromPointer,
  calculateCanvasFitToViewport,
  calculateGrapesjsRadiusHandleInset,
  calculateGrapesjsSelectionStrokeRect,
  createGrapesjsComponentClipboardState,
  clearGrapesjsManagedInlineStyle,
  clipboardHasImageFile,
  dissolveGrapesjsFlexSelection,
  firstGrapesjsClipboardImageFile,
  getGrapesjsCanvasToolDragStyle,
  isGrapesjsEditorEditing,
  getGrapesjsIframeSelectionOutlineCss,
  getGrapesjsIframeSelectionStyleCss,
  getGrapesjsSelectionStrokeCss,
  GRAPESJS_CUT_EMIT_DELAY_MS,
  scheduleGrapesjsDeferredCutEmit,
  cancelGrapesjsDeferredCutEmit,
  scheduleGrapesjsCutAwareEmit,
  scheduleGrapesjsClipboardCutRemovalEmit,
  cancelGrapesjsPendingCutEmit,
  getGrapesjsZoomStyleVars,
  findGrapesjsPositionedDragComponent,
  mergeSelectionSnapshotStyles,
  offsetGrapesjsAbsolutePositionStyle,
  pasteGrapesjsImageToSelection,
  grapesjsShortcutLetterFromEvent,
  runGrapesjsHistoryShortcut,
  insertGrapesjsIconComponent,
  resizeGrapesjsPositionedSelectionToBounds,
  resolveGrapesjsPositionedToolDragOrigin,
  isGrapesjsCanvasChromeTarget,
  scheduleGrapesjsPlacementChange,
  shouldHandleGrapesjsImagePaste,
  stopGrapesjsTextEditingForPointerTarget,
  stripGrapesjsCanvasSizeSentinel,
  upsertGrapesjsIframeSelectionStyle,
} from '../../../src/components/grapesjs/GrapesjsEditor';
import {
  GRAPESJS_ICON_CATALOG,
  GRAPESJS_ICON_PAGE_SIZE,
  buildIconifySearchUrl,
  iconifySearchResultsToIcons,
  renderGrapesjsIconSvg,
  translateGrapesjsIconSearchQuery,
  visibleGrapesjsIconPage,
} from '../../../src/components/grapesjs/icon-library';
import { GRAPESJS_SHORTCUT_GROUPS } from '../../../src/components/grapesjs/shortcuts';

describe('GrapesjsEditor canvas fit', () => {
  it('centers the HTML frame vertically when it fits inside the canvas', () => {
    expect(calculateCanvasFitToViewport({
      frameWidth: 390,
      frameHeight: 891,
      canvasWidth: 1000,
      canvasHeight: 1200,
    })).toEqual({
      zoom: 100,
      x: 0,
      y: 155,
    });
  });

  it('keeps a taller HTML frame top-aligned instead of hiding the top content', () => {
    expect(calculateCanvasFitToViewport({
      frameWidth: 390,
      frameHeight: 1192,
      canvasWidth: 1000,
      canvasHeight: 1200,
    })).toEqual({
      zoom: 100,
      x: 0,
      y: 0,
    });
  });
});

describe('GrapesjsEditor zoom style vars', () => {
  it('keeps iframe canvas outlines visually hairline at high zoom', () => {
    expect(getGrapesjsZoomStyleVars(300)).toEqual({
      zoomDecimal: 3,
      canvasHairline: '0.3333px',
      screenHairline: '1px',
    });
  });

  it('keeps iframe canvas outlines accurate at 1000 percent zoom', () => {
    expect(getGrapesjsZoomStyleVars(1000)).toEqual({
      zoomDecimal: 10,
      canvasHairline: '0.1px',
      screenHairline: '1px',
    });
  });

  it('keeps host tool overlays in screen pixels instead of inverse zoom pixels', () => {
    expect(getGrapesjsZoomStyleVars(50)).toEqual({
      zoomDecimal: 0.5,
      canvasHairline: '2px',
      screenHairline: '1px',
    });
  });
});

describe('GrapesjsEditor rectangle radius handles', () => {
  it('uses the dominant inward drag direction from the original pointer position', () => {
    expect(calculateGrapesjsCornerRadiusDrag({
      corner: 'tl',
      startRadius: 2,
      deltaX: 18,
      deltaY: -5,
      width: 260,
      height: 160,
      zoom: 1,
    })).toBe(20);
  });

  it('keeps increasing when one drag axis drifts outward slightly', () => {
    expect(calculateGrapesjsCornerRadiusDrag({
      corner: 'tr',
      startRadius: 10,
      deltaX: -24,
      deltaY: -7,
      width: 260,
      height: 160,
      zoom: 1,
    })).toBe(34);
  });

  it('decreases radius only when both dominant movements go outward', () => {
    expect(calculateGrapesjsCornerRadiusDrag({
      corner: 'br',
      startRadius: 30,
      deltaX: 12,
      deltaY: 4,
      width: 260,
      height: 160,
      zoom: 1,
    })).toBe(18);
  });

  it('keeps a locked horizontal radius drag from jumping when the pointer drifts vertically', () => {
    expect(calculateGrapesjsCornerRadiusDrag({
      corner: 'tl',
      startRadius: 80,
      deltaX: 70,
      deltaY: 150,
      width: 590,
      height: 474,
      zoom: 1,
      axis: 'x',
    } as Parameters<typeof calculateGrapesjsCornerRadiusDrag>[0] & { axis: 'x' })).toBe(150);
  });

  it('uses the smaller inward axis before lock-in so scroll drift cannot spike the radius', () => {
    expect(calculateGrapesjsCornerRadiusDrag({
      corner: 'tl',
      startRadius: 0,
      deltaX: 80,
      deltaY: 230,
      width: 590,
      height: 474,
      zoom: 1,
    })).toBe(80);
  });

  it('tracks horizontal pointer movement without needing a diagonal drag', () => {
    expect(calculateGrapesjsCornerRadiusFromPointer({
      corner: 'tl',
      localX: 28,
      localY: 24,
      width: 260,
      height: 160,
      zoom: 1,
      handleInset: 24,
      axis: 'x',
    })).toBe(4);
  });

  it('tracks vertical pointer movement without needing a diagonal drag', () => {
    expect(calculateGrapesjsCornerRadiusFromPointer({
      corner: 'tl',
      localX: 24,
      localY: 36,
      width: 260,
      height: 160,
      zoom: 1,
      handleInset: 24,
      axis: 'y',
    })).toBe(12);
  });

  it('keeps the chosen drag axis stable when the other axis drifts', () => {
    expect(calculateGrapesjsCornerRadiusFromPointer({
      corner: 'tl',
      localX: 52,
      localY: 120,
      width: 260,
      height: 160,
      zoom: 1,
      handleInset: 24,
      axis: 'x',
    })).toBe(28);
  });

  it('does not snap to zero when one axis drifts slightly outward', () => {
    expect(calculateGrapesjsCornerRadiusFromPointer({
      corner: 'tr',
      localX: 220,
      localY: 20,
      width: 260,
      height: 160,
      zoom: 1,
      handleInset: 24,
    })).toBe(16);
  });

  it('uses the smaller inward pointer axis before lock-in so pointer drift cannot spike the radius', () => {
    expect(calculateGrapesjsCornerRadiusFromPointer({
      corner: 'tl',
      localX: 104,
      localY: 254,
      width: 590,
      height: 474,
      zoom: 1,
      handleInset: 24,
    })).toBe(80);
  });

  it('keeps radius handles inside the rectangle and away from resize corners', () => {
    expect(calculateGrapesjsRadiusHandleInset({
      radius: 0,
      zoom: 1,
      width: 120,
      height: 80,
      minInset: 24,
    })).toBe(24);

    expect(calculateGrapesjsRadiusHandleInset({
      radius: 60,
      zoom: 1,
      width: 120,
      height: 80,
      minInset: 24,
    })).toBe(32);
  });
});

describe('GrapesjsEditor selection snapshot styles', () => {
  it('preserves authored fill dimensions so the style panel does not snap back to fixed', () => {
    expect(mergeSelectionSnapshotStyles(
      {
        width: '294px',
        height: '0px',
        backgroundColor: 'rgb(217, 217, 217)',
      },
      {
        width: '100%',
        height: '100%',
        background: '#D9D9D9',
      },
    )).toEqual({
      width: '100%',
      height: '100%',
      backgroundColor: 'rgb(217, 217, 217)',
    });
  });
});

describe('GrapesjsEditor canvas viewport sync', () => {
  it('updates overlays when either the host canvas or iframe document scrolls', () => {
    const hostCanvas = Object.assign(new EventTarget(), {
      querySelector: () => null,
    }) as unknown as HTMLElement;
    const frame = Object.assign(new EventTarget(), {
      parentElement: null,
    }) as unknown as HTMLElement;
    const canvasDoc = Object.assign(new EventTarget(), {
      documentElement: new EventTarget(),
      body: new EventTarget(),
      defaultView: new EventTarget(),
    }) as unknown as Document;
    const sync = vi.fn();
    const on = vi.fn();
    const off = vi.fn();
    const editor = {
      Canvas: {
        getElement: () => hostCanvas,
        getFrameEl: () => frame,
        getDocument: () => canvasDoc,
      },
      on,
      off,
    };

    const detach = attachGrapesjsCanvasViewportSync(editor, [], sync);

    hostCanvas.dispatchEvent(new Event('scroll'));
    canvasDoc.dispatchEvent(new Event('scroll'));

    expect(sync).toHaveBeenCalledTimes(2);
    expect(on).toHaveBeenCalledWith('canvas:frame:load:body', expect.any(Function));

    detach();
    hostCanvas.dispatchEvent(new Event('scroll'));

    expect(sync).toHaveBeenCalledTimes(2);
    expect(off).toHaveBeenCalledWith('canvas:frame:load:body', expect.any(Function));
  });
});

describe('GrapesjsEditor resize persistence', () => {
  it('commits changes when GrapesJS finishes a resize interaction', () => {
    const callbacks = new Map<string, (payload?: unknown) => void>();
    const editor = {
      on: vi.fn((event: string, callback: (payload?: unknown) => void) => {
        callbacks.set(event, callback);
      }),
      off: vi.fn(),
    };
    const refreshGeometry = vi.fn();
    const cleanupInlineStyle = vi.fn();
    const commitChange = vi.fn();
    const payload = { target: { id: 'rect' } };

    const detach = attachGrapesjsResizePersistence(editor, {
      refreshGeometry,
      cleanupInlineStyle,
      commitChange,
    });

    callbacks.get('component:resize:end')?.(payload);

    expect(refreshGeometry).toHaveBeenCalledTimes(1);
    expect(cleanupInlineStyle).toHaveBeenCalledWith(payload);
    expect(commitChange).toHaveBeenCalledTimes(1);

    detach();

    expect(editor.off).toHaveBeenCalledWith('component:resize:end', expect.any(Function));
  });

  it('commits and cleans inline styles when GrapesJS finishes a drag interaction', () => {
    const callbacks = new Map<string, (payload?: unknown) => void>();
    const editor = {
      on: vi.fn((event: string, callback: (payload?: unknown) => void) => {
        callbacks.set(event, callback);
      }),
      off: vi.fn(),
    };
    const refreshGeometry = vi.fn();
    const cleanupInlineStyle = vi.fn();
    const commitChange = vi.fn();
    const payload = { target: { id: 'rect' } };

    const detach = attachGrapesjsResizePersistence(editor, {
      refreshGeometry,
      cleanupInlineStyle,
      commitChange,
    });

    callbacks.get('component:drag:end')?.(payload);

    expect(refreshGeometry).toHaveBeenCalledTimes(1);
    expect(cleanupInlineStyle).toHaveBeenCalledWith(payload);
    expect(commitChange).toHaveBeenCalledTimes(1);

    detach();

    expect(editor.off).toHaveBeenCalledWith('component:drag:end', expect.any(Function));
  });

  it('coalesces resize update events to one visual refresh per animation frame', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    const cancelAnimationFrameSpy = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameSpy);
    const callbacks = new Map<string, (payload?: unknown) => void>();
    const editor = {
      on: vi.fn((event: string, callback: (payload?: unknown) => void) => {
        callbacks.set(event, callback);
      }),
      off: vi.fn(),
    };
    const refreshGeometry = vi.fn();
    const cleanupInlineStyle = vi.fn();
    const commitChange = vi.fn();

    attachGrapesjsResizePersistence(editor, {
      refreshGeometry,
      cleanupInlineStyle,
      commitChange,
    });

    callbacks.get('component:resize:update')?.({ target: { id: 'rect' } });
    callbacks.get('component:resize:move')?.({ target: { id: 'rect' } });

    expect(refreshGeometry).not.toHaveBeenCalled();

    rafCallbacks.shift()?.(16);

    expect(refreshGeometry).toHaveBeenCalledTimes(1);
    expect(cleanupInlineStyle).not.toHaveBeenCalled();
    expect(commitChange).not.toHaveBeenCalled();
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe('GrapesjsEditor iframe selection CSS', () => {
  it('draws the custom single-selection stroke without adding border width drift', () => {
    const css = getGrapesjsSelectionStrokeCss();

    expect(css).toContain('.od-selection-stroke');
    expect(css).toContain('border: 0;');
    expect(css).toContain('box-shadow: inset 0 0 0 var(--od-gjs-screen-hairline, 1px) var(--gjs-color-blue);');
    expect(css).not.toContain('border: var(--od-gjs-screen-hairline');
  });

  it('positions the host selection stroke from the iframe element rect at high zoom', () => {
    const rect = calculateGrapesjsSelectionStrokeRect({
      elementRect: fakeDomRect(32.25, 48.5, 418, 222),
      frameRect: fakeDomRect(100, 40, 1600, 900),
      toolsRect: fakeDomRect(199.5, 184.75, 1254, 666),
      zoom: 3,
    });

    expect(rect?.left).toBeCloseTo(-2.75);
    expect(rect?.top).toBeCloseTo(0.75);
    expect(rect?.width).toBeCloseTo(1254);
    expect(rect?.height).toBeCloseTo(666);
  });

  it('disables GrapesJS selected outlines so only the host stroke draws the single-selection box', () => {
    const css = getGrapesjsIframeSelectionOutlineCss();
    const selectedBlock = css.match(/html body \.gjs-selected,[^}]*\}/)?.[0] ?? '';

    expect(selectedBlock).toContain('html body .gjs-selected');
    expect(selectedBlock).toContain('outline: 0 !important;');
    expect(selectedBlock).not.toContain('outline-width: var(--od-gjs-hairline, 1px) !important;');
  });

  it('keeps hover outlines inside the iframe for discovery without affecting selected geometry', () => {
    const css = getGrapesjsIframeSelectionOutlineCss();
    const hoverBlock = css.match(/html body \.gjs-hovered,[^}]*\}/)?.[0] ?? '';

    expect(hoverBlock).toContain('html body .gjs-hovered');
    expect(hoverBlock).toContain('outline: var(--od-gjs-hairline, 1px) solid #3b82f6 !important;');
    expect(hoverBlock).toContain('outline-offset: calc(-1 * var(--od-gjs-hairline, 1px)) !important;');
  });

  it('can render element-picker selection outlines in green', () => {
    const css = getGrapesjsIframeSelectionOutlineCss('element-selection');

    expect(css).toContain('solid #10b981 !important;');
    expect(css).not.toContain('solid #3b82f6 !important;');
  });

  it('suppresses native single-selection controls while the multi-selection outer box is active', () => {
    const css = getGrapesjsIframeSelectionStyleCss('od-flex-child-hover');

    expect(css).toContain('.od-gjs-multi-selection-active .gjs-resizer');
    expect(css).toContain('.od-gjs-multi-selection-active .od-radius-handle');
    expect(css).toContain('.od-gjs-multi-selection-active .od-radius-badge');
    expect(css).toContain('.od-gjs-multi-selection-active [data-od-spacing-kind]');
    expect(css).toContain('.od-gjs-multi-selection-active [data-od-spacing-band]');
    expect(css).toContain('display: none !important;');
  });

  it('refreshes and moves an existing iframe style tag to the end of head', () => {
    const existingStyle = {
      parentNode: {},
      textContent: '.gjs-selected { outline-width: var(--od-gjs-hairline, 1px) !important; }',
      setAttribute() {},
    } as unknown as HTMLStyleElement;
    const appended: HTMLStyleElement[] = [];
    const fakeDoc = {
      head: {
        querySelector: () => existingStyle,
        appendChild: (node: HTMLStyleElement) => {
          appended.push(node);
          return node;
        },
      },
      createElement: () => {
        throw new Error('existing style should be reused');
      },
    } as unknown as Document;

    expect(upsertGrapesjsIframeSelectionStyle(fakeDoc, 'od-flex-child-hover')).toBe(true);
    expect(appended).toEqual([existingStyle]);
    expect(existingStyle.textContent).toContain('outline: var(--od-gjs-hairline, 1px) solid #3b82f6 !important;');
    expect(existingStyle.textContent).not.toContain('.gjs-selected { outline-width');
  });

  it('refreshes iframe style tags with the requested element-picker tone', () => {
    const existingStyle = {
      parentNode: {},
      textContent: '',
      setAttribute() {},
    } as unknown as HTMLStyleElement;
    const fakeDoc = {
      head: {
        querySelector: () => existingStyle,
        appendChild: (node: HTMLStyleElement) => node,
      },
      createElement: () => existingStyle,
    } as unknown as Document;

    expect(upsertGrapesjsIframeSelectionStyle(fakeDoc, 'od-flex-child-hover', 'element-selection')).toBe(true);
    expect(existingStyle.textContent).toContain('outline: var(--od-gjs-hairline, 1px) solid #10b981 !important;');
    expect(existingStyle.textContent).toContain('outline: var(--od-gjs-hairline, 1px) dashed #10b981 !important;');
  });
});

type FakeGrapesjsComponent = {
  append(definition: { attributes?: Record<string, string>; style?: Record<string, string> }, opts?: { at?: number }): FakeGrapesjsComponent[];
  clone(): FakeGrapesjsComponent;
  components(): {
    length: number;
    add(definition: { attributes?: Record<string, string>; style?: Record<string, string> }, opts?: { at?: number }): FakeGrapesjsComponent[];
    at(index: number): FakeGrapesjsComponent | null;
    get(index: number): FakeGrapesjsComponent | null;
  };
  get(key: string): unknown;
  getAttributes(): Record<string, string>;
  setAttributes(next: Record<string, string>): void;
  addAttributes(next: Record<string, string>): void;
  removeAttributes(keys: string | string[]): void;
  getStyle(): Record<string, string>;
  setStyle(next: Record<string, string>): void;
  removeStyle(prop: string): void;
  getEl(): HTMLElement | null;
  move(nextParent: FakeGrapesjsComponent, opts?: { at?: number }): void;
  parent(): FakeGrapesjsComponent | null;
  remove(): void;
};

function fakeDomRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function fakeComponent(options: {
  attrs?: Record<string, string>;
  style?: Record<string, string>;
  rect?: DOMRect | null;
  el?: HTMLElement | null;
  mergeStyleUpdates?: boolean;
  type?: string;
} = {}): FakeGrapesjsComponent {
  let parent: FakeGrapesjsComponent | null = null;
  const children: FakeGrapesjsComponent[] = [];
  const attrs = { ...(options.attrs ?? {}) };
  let style = { ...(options.style ?? {}) };
  const el = options.el ?? (
    options.rect === null
      ? null
      : ({
          nodeType: 1,
          getBoundingClientRect: () => options.rect ?? fakeDomRect(0, 0, 1, 1),
        } as HTMLElement)
  );
  const comp: FakeGrapesjsComponent = {
    append(definition, opts) {
      const child = fakeComponent({
        attrs: definition.attributes,
        style: definition.style,
        rect: fakeDomRect(0, 0, 1, 1),
      });
      child.move(comp, opts);
      return [child];
    },
    clone() {
      return fakeComponent({
        attrs: { ...attrs },
        style: { ...style },
        rect: options.rect,
        type: options.type,
      });
    },
    components: () => ({
      get length() {
        return children.length;
      },
      add: (definition, opts) => comp.append(definition, opts),
      at: (index: number) => children[index] ?? null,
      get: (index: number) => children[index] ?? null,
    }),
    get(key) {
      if (key === 'type') return options.type;
      return undefined;
    },
    getAttributes: () => attrs,
    setAttributes(next) {
      Object.assign(attrs, next);
    },
    addAttributes(next) {
      Object.assign(attrs, next);
    },
    removeAttributes(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete attrs[key];
      }
    },
    getStyle: () => style,
    setStyle(next) {
      style = options.mergeStyleUpdates ? { ...style, ...next } : { ...next };
    },
    removeStyle(prop) {
      delete style[prop];
    },
    getEl: () => el,
    move(nextParent, opts) {
      const currentParent = parent;
      if (currentParent) {
        const currentChildren = currentParent.components();
        for (let i = 0; i < currentChildren.length; i += 1) {
          if (currentChildren.get(i) === comp) {
            (currentParent as unknown as { __children: FakeGrapesjsComponent[] }).__children.splice(i, 1);
            break;
          }
        }
      }
      parent = nextParent;
      const nextChildren = (nextParent as unknown as { __children: FakeGrapesjsComponent[] }).__children;
      nextChildren.splice(opts?.at ?? nextChildren.length, 0, comp);
    },
    parent: () => parent,
    remove() {
      if (!parent) return;
      const siblings = (parent as unknown as { __children: FakeGrapesjsComponent[] }).__children;
      const index = siblings.indexOf(comp);
      if (index >= 0) siblings.splice(index, 1);
      parent = null;
    },
  };
  (comp as unknown as { __children: FakeGrapesjsComponent[] }).__children = children;
  return comp;
}

describe('GrapesjsEditor flex auto-layout dissolve', () => {
  it('restores absolute children relative to the canvas body when the GrapesJS wrapper has no DOM element', () => {
    const canvasBody = {
      nodeType: 1,
      getBoundingClientRect: () => fakeDomRect(200, 50, 800, 600),
    } as HTMLElement;
    const parent = fakeComponent({ rect: null });
    const wrapper = fakeComponent({
      attrs: {
        'data-od-auto-layout-wrapper': 'true',
        'data-od-position-mode': 'absolute',
      },
      style: {
        display: 'flex',
        width: '240px',
        height: '80px',
      },
      rect: fakeDomRect(220, 80, 240, 80),
    });
    const child = fakeComponent({
      attrs: {
        'data-od-canvas-tool': 'rectangle',
        'data-od-position-mode': 'flow',
      },
      style: {
        width: '64px',
        height: '36px',
        background: '#D9D9D9',
      },
      rect: fakeDomRect(220, 80, 64, 36),
    });
    wrapper.move(parent);
    child.move(wrapper);
    const selected = wrapper;
    const editor = {
      getSelected: () => selected,
      select: vi.fn(),
      Canvas: {
        getDocument: () => ({ body: canvasBody, documentElement: canvasBody }),
      },
    };

    expect(dissolveGrapesjsFlexSelection(editor as never)).toBe(true);

    expect(child.parent()).toBe(parent);
    expect(child.getStyle()).toMatchObject({
      position: 'absolute',
      left: '20px',
      top: '30px',
      width: '64px',
      height: '36px',
    });
    expect(child.getAttributes()['data-od-position-mode']).toBe('absolute');
    expect(parent.components().get(0)).toBe(child);
  });

  it('does not force originally flow children to absolute positioning when dissolving auto-layout', () => {
    const parent = fakeComponent({ rect: fakeDomRect(0, 0, 800, 600) });
    const wrapper = fakeComponent({
      attrs: {
        'data-od-auto-layout-wrapper': 'true',
        'data-od-position-mode': 'flow',
      },
      style: { display: 'flex' },
      rect: fakeDomRect(20, 30, 240, 80),
    });
    const child = fakeComponent({
      attrs: {
        'data-od-canvas-tool': 'rectangle',
        'data-od-position-mode': 'flow',
      },
      style: {
        width: '64px',
        height: '36px',
      },
      rect: fakeDomRect(20, 30, 64, 36),
    });
    wrapper.move(parent);
    child.move(wrapper);

    expect(dissolveGrapesjsFlexSelection({
      getSelected: () => wrapper,
      select: vi.fn(),
    } as never)).toBe(true);

    expect(child.parent()).toBe(parent);
    expect(child.getStyle()).not.toHaveProperty('position');
    expect(child.getAttributes()['data-od-position-mode']).toBe('flow');
  });

  it('wraps absolute children in an absolute flex container relative to the canvas body', () => {
    const canvasBody = {
      nodeType: 1,
      getBoundingClientRect: () => fakeDomRect(200, 50, 800, 600),
    } as HTMLElement;
    const parent = fakeComponent({ rect: null });
    const first = fakeComponent({
      attrs: {
        'data-od-canvas-tool': 'rectangle',
        'data-od-position-mode': 'absolute',
      },
      style: { position: 'absolute', left: '20px', top: '30px', width: '64px', height: '36px' },
      rect: fakeDomRect(220, 80, 64, 36),
    });
    const second = fakeComponent({
      attrs: {
        'data-od-canvas-tool': 'rectangle',
        'data-od-position-mode': 'absolute',
      },
      style: { position: 'absolute', left: '100px', top: '30px', width: '64px', height: '36px' },
      rect: fakeDomRect(300, 80, 64, 36),
    });
    first.move(parent);
    second.move(parent);
    const editor = {
      getSelectedAll: () => [first, second],
      select: vi.fn(),
      Canvas: {
        getDocument: () => ({ body: canvasBody, documentElement: canvasBody }),
      },
    };

    expect(arrangeGrapesjsSelectionAsFlex(editor as never)).toBe(true);

    const wrapper = parent.components().get(0);
    expect(wrapper?.getStyle()).toMatchObject({
      position: 'absolute',
      left: '20px',
      top: '30px',
      width: '144px',
      height: '36px',
    });
    expect(first.parent()).toBe(wrapper);
    expect(second.parent()).toBe(wrapper);
  });

  it('clears absolute positioning from wrapped children even when style updates merge', () => {
    const canvasBody = {
      nodeType: 1,
      getBoundingClientRect: () => fakeDomRect(200, 50, 800, 600),
    } as HTMLElement;
    const parent = fakeComponent({ rect: null });
    const first = fakeComponent({
      attrs: {
        'data-od-canvas-tool': 'rectangle',
        'data-od-position-mode': 'absolute',
      },
      style: { position: 'absolute', left: '20px', top: '30px', width: '64px', height: '36px' },
      rect: fakeDomRect(220, 80, 64, 36),
      mergeStyleUpdates: true,
    });
    const second = fakeComponent({
      attrs: {
        'data-od-canvas-tool': 'rectangle',
        'data-od-position-mode': 'absolute',
      },
      style: { position: 'absolute', left: '100px', top: '30px', width: '64px', height: '36px' },
      rect: fakeDomRect(300, 80, 64, 36),
      mergeStyleUpdates: true,
    });
    first.move(parent);
    second.move(parent);
    const editor = {
      getSelectedAll: () => [first, second],
      select: vi.fn(),
      Canvas: {
        getDocument: () => ({ body: canvasBody, documentElement: canvasBody }),
      },
    };

    expect(arrangeGrapesjsSelectionAsFlex(editor as never)).toBe(true);

    expect(first.getStyle()).not.toHaveProperty('position');
    expect(first.getStyle()).not.toHaveProperty('left');
    expect(first.getStyle()).not.toHaveProperty('top');
    expect(first.getAttributes()['data-od-position-mode']).toBe('flow');
  });

  it('updates an existing auto-layout wrapper direction without wrapping it again', () => {
    const parent = fakeComponent({ rect: null });
    const wrapper = fakeComponent({
      attrs: {
        'data-od-auto-layout-wrapper': 'true',
        'data-od-position-mode': 'absolute',
      },
      style: {
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'nowrap',
        position: 'absolute',
        left: '20px',
        top: '30px',
        width: '180px',
        height: '80px',
      },
      rect: fakeDomRect(220, 80, 180, 80),
    });
    const child = fakeComponent({
      attrs: {
        'data-od-canvas-tool': 'rectangle',
        'data-od-position-mode': 'absolute',
      },
      style: {
        position: 'absolute',
        left: '20px',
        top: '30px',
        width: '64px',
        height: '36px',
      },
      rect: fakeDomRect(220, 80, 64, 36),
      mergeStyleUpdates: true,
    });
    wrapper.move(parent);
    child.move(wrapper);
    const select = vi.fn();
    const editor = {
      getSelected: () => wrapper,
      getSelectedAll: () => [wrapper],
      select,
    };

    expect(arrangeGrapesjsSelectionAsFlex(editor as never, [], 'column')).toBe(true);

    expect(parent.components().length).toBe(1);
    expect(parent.components().get(0)).toBe(wrapper);
    expect(wrapper.getStyle()).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      flexWrap: 'nowrap',
      width: '180px',
      height: '80px',
    });
    expect(child.parent()).toBe(wrapper);
    expect(child.getStyle()).not.toHaveProperty('position');
    expect(child.getStyle()).not.toHaveProperty('left');
    expect(child.getStyle()).not.toHaveProperty('top');
    expect(child.getAttributes()['data-od-position-mode']).toBe('flow');
    expect(select).toHaveBeenCalledWith(wrapper);
  });

  it('uses an absolute auto-layout wrapper as the free-drag target for its flow children', () => {
    const wrapper = fakeComponent({
      attrs: {
        'data-od-auto-layout-wrapper': 'true',
        'data-od-position-mode': 'absolute',
      },
      style: {
        display: 'flex',
        position: 'absolute',
        left: '20px',
        top: '30px',
      },
    });
    const child = fakeComponent({
      attrs: {
        'data-od-canvas-tool': 'rectangle',
        'data-od-position-mode': 'flow',
      },
      style: {
        width: '64px',
        height: '36px',
      },
    });
    child.move(wrapper);

    expect(findGrapesjsPositionedDragComponent(child as never)).toBe(wrapper);
    expect(findGrapesjsPositionedDragComponent(wrapper as never)).toBe(wrapper);
  });
});

describe('GrapesjsEditor keyboard guards', () => {
  it('reads GrapesJS 0.23 editing state through the editor model', () => {
    const editor = {
      getModel: () => ({
        isEditing: () => true,
      }),
    };

    expect(isGrapesjsEditorEditing(editor)).toBe(true);
  });

  it('does not throw when the public editor has no isEditing method', () => {
    expect(isGrapesjsEditorEditing({ getModel: () => ({}) })).toBe(false);
  });

  it('stops rich text editing when the next pointer target is outside editable text', () => {
    const disableEditing = vi.fn();
    const editor = {
      getEditing: () => ({ view: { disableEditing } }),
      getSelected: () => null,
      Canvas: {
        getDocument: () => ({
          activeElement: null,
          defaultView: { getSelection: () => ({ removeAllRanges: vi.fn() }) },
        }),
      },
    };
    const target = { tagName: 'DIV', isContentEditable: false } as unknown as HTMLElement;

    expect(stopGrapesjsTextEditingForPointerTarget(editor, target)).toBe(true);
    expect(disableEditing).toHaveBeenCalledWith({ event: 'od-stop-text-editing' });
  });

  it('keeps rich text editing active when the pointer remains inside editable text', () => {
    const disableEditing = vi.fn();
    const editor = {
      getEditing: () => ({ view: { disableEditing } }),
      getSelected: () => null,
    };
    const target = { tagName: 'DIV', isContentEditable: true } as unknown as HTMLElement;

    expect(stopGrapesjsTextEditingForPointerTarget(editor, target)).toBe(false);
    expect(disableEditing).not.toHaveBeenCalled();
  });

  it('recognizes GrapesJS resize handles as canvas chrome targets', () => {
    const handle = {
      closest: vi.fn((selector: string) => (selector.includes('.gjs-resizer-h') ? handle : null)),
    } as unknown as Element;
    const regular = {
      closest: vi.fn(() => null),
    } as unknown as Element;

    expect(isGrapesjsCanvasChromeTarget(handle)).toBe(true);
    expect(isGrapesjsCanvasChromeTarget(regular)).toBe(false);
  });
});

describe('GrapesjsEditor image paste filter', () => {
  const imageClipboard = {
    types: ['image/png'],
    items: [
      { kind: 'file', type: 'image/png' },
    ],
  } as unknown as DataTransfer;

  it('allows pure screenshot image paste', () => {
    expect(shouldHandleGrapesjsImagePaste({
      clipboardData: imageClipboard,
      lastInternalPasteAt: 0,
      now: 2_000,
    })).toBe(true);
  });

  it('skips image paste immediately after GrapesJS internal component paste', () => {
    expect(shouldHandleGrapesjsImagePaste({
      clipboardData: imageClipboard,
      lastInternalPasteAt: 1_700,
      now: 2_000,
    })).toBe(false);
  });

  it('skips screenshot paste while an internal component paste is suppressing clipboard images', () => {
    expect(shouldHandleGrapesjsImagePaste({
      clipboardData: imageClipboard,
      lastInternalPasteAt: 0,
      suppressImagePasteUntil: 2_500,
      now: 2_000,
    })).toBe(false);
  });

  it('skips mixed document/image clipboards so DOM paste wins', () => {
    expect(shouldHandleGrapesjsImagePaste({
      clipboardData: {
        types: ['text/html', 'image/png'],
        items: [
          { kind: 'string', type: 'text/html' },
          { kind: 'file', type: 'image/png' },
        ],
      } as unknown as DataTransfer,
      lastInternalPasteAt: 0,
      now: 2_000,
    })).toBe(false);
  });

  it('allows screenshot clipboards that expose image data through files only', () => {
    const imageFile = new File(['png'], 'shot.png', { type: 'image/png' });
    const filesOnlyClipboard = {
      types: ['Files'],
      items: [],
      files: {
        length: 1,
        0: imageFile,
        item: (index: number) => (index === 0 ? imageFile : null),
      },
    } as unknown as DataTransfer;

    expect(clipboardHasImageFile(filesOnlyClipboard)).toBe(true);
    expect(firstGrapesjsClipboardImageFile(filesOnlyClipboard)).toBe(imageFile);
    expect(shouldHandleGrapesjsImagePaste({
      clipboardData: filesOnlyClipboard,
      lastInternalPasteAt: 0,
      now: 2_000,
    })).toBe(true);
  });
});

describe('GrapesjsEditor history shortcuts', () => {
  it('runs one undo command and consumes the key event at the first handler', () => {
    const editor = { runCommand: vi.fn() };
    const ev = {
      key: 'z',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    expect(runGrapesjsHistoryShortcut(editor, ev)).toBe(true);

    expect(editor.runCommand).toHaveBeenCalledTimes(1);
    expect(editor.runCommand).toHaveBeenCalledWith('core:undo');
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(ev.stopPropagation).toHaveBeenCalledTimes(1);
    expect(ev.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('maps shift-undo and ctrl-y to redo', () => {
    const editor = { runCommand: vi.fn() };
    const redoFromShiftZ = {
      key: 'Z',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    const redoFromY = {
      key: 'y',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    expect(runGrapesjsHistoryShortcut(editor, redoFromShiftZ)).toBe(true);
    expect(runGrapesjsHistoryShortcut(editor, redoFromY)).toBe(true);

    expect(editor.runCommand).toHaveBeenNthCalledWith(1, 'core:redo');
    expect(editor.runCommand).toHaveBeenNthCalledWith(2, 'core:redo');
  });

  it('ignores alternate-modified z shortcuts so style-copy shortcuts keep working', () => {
    const editor = { runCommand: vi.fn() };
    const ev = {
      key: 'z',
      metaKey: true,
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    expect(runGrapesjsHistoryShortcut(editor, ev)).toBe(false);
    expect(editor.runCommand).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});

describe('GrapesjsEditor style clipboard', () => {
  it('stores cloned component snapshots before multi-cut removes the originals', () => {
    const first = fakeComponent({
      attrs: { 'data-od-id': 'first', 'data-od-canvas-tool': 'rectangle' },
      style: { position: 'absolute', left: '10px', top: '12px' },
    });
    const second = fakeComponent({
      attrs: { 'data-od-id': 'second', 'data-od-canvas-tool': 'rectangle' },
      style: { position: 'absolute', left: '80px', top: '12px' },
    });
    const clipboard = createGrapesjsComponentClipboardState([first as never, second as never], true);

    first.setStyle({ position: 'absolute', left: '999px', top: '999px' });
    second.setStyle({ position: 'absolute', left: '888px', top: '888px' });

    expect(clipboard?.cut).toBe(true);
    expect(clipboard?.pasteCount).toBe(0);
    expect(clipboard?.components).toHaveLength(2);
    expect(clipboard?.components[0]).not.toBe(first);
    expect(clipboard?.components[0]?.getAttributes()).toEqual({ 'data-od-canvas-tool': 'rectangle' });
    expect(clipboard?.components[0]?.getStyle()).toMatchObject({ left: '10px', top: '12px' });
    expect(clipboard?.components[1]?.getAttributes()).toEqual({ 'data-od-canvas-tool': 'rectangle' });
    expect(clipboard?.components[1]?.getStyle()).toMatchObject({ left: '80px', top: '12px' });
  });

  it('delays cut removal emits so the first paste can cancel the invisible intermediate state', () => {
    vi.useFakeTimers();
    try {
      const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
      const cutPendingRef = { current: false };
      const emit = vi.fn();

      scheduleGrapesjsClipboardCutRemovalEmit(timerRef, cutPendingRef, emit);
      expect(cutPendingRef.current).toBe(true);
      vi.advanceTimersByTime(GRAPESJS_CUT_EMIT_DELAY_MS - 1);
      expect(emit).not.toHaveBeenCalled();

      expect(cancelGrapesjsPendingCutEmit(timerRef, cutPendingRef)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(emit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('defers cut emits long enough for paste to cancel the intermediate removed state', () => {
    vi.useFakeTimers();
    try {
      const ref: { current: ReturnType<typeof setTimeout> | null } = { current: null };
      const emit = vi.fn();

      scheduleGrapesjsDeferredCutEmit(ref, emit);
      vi.advanceTimersByTime(GRAPESJS_CUT_EMIT_DELAY_MS - 1);
      expect(emit).not.toHaveBeenCalled();

      expect(cancelGrapesjsDeferredCutEmit(ref)).toBe(true);
      vi.advanceTimersByTime(1);

      expect(emit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes component update emits through the pending cut delay until the first paste cancels it', () => {
    vi.useFakeTimers();
    try {
      const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
      const cutPendingRef = { current: true };
      const emit = vi.fn();

      scheduleGrapesjsCutAwareEmit(timerRef, cutPendingRef, emit);
      vi.advanceTimersByTime(GRAPESJS_CUT_EMIT_DELAY_MS - 1);
      expect(emit).not.toHaveBeenCalled();

      expect(cancelGrapesjsPendingCutEmit(timerRef, cutPendingRef)).toBe(true);
      expect(cutPendingRef.current).toBe(false);
      vi.advanceTimersByTime(1);
      expect(emit).not.toHaveBeenCalled();

      scheduleGrapesjsCutAwareEmit(timerRef, cutPendingRef, emit);
      expect(emit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a delayed cut emit after the grace period when no paste arrives', () => {
    vi.useFakeTimers();
    try {
      const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
      const cutPendingRef = { current: true };
      const emit = vi.fn();

      scheduleGrapesjsCutAwareEmit(timerRef, cutPendingRef, emit);
      vi.advanceTimersByTime(GRAPESJS_CUT_EMIT_DELAY_MS);

      expect(cutPendingRef.current).toBe(false);
      expect(emit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('copies visual CSS properties without layout size or position', () => {
    expect(buildGrapesjsCssStyleClipboard({
      width: '240px',
      height: '80px',
      position: 'absolute',
      left: '12px',
      top: '30px',
      backgroundColor: 'rgb(10, 20, 30)',
      backgroundImage: 'url("shot.png")',
      borderTopWidth: '2px',
      borderRightWidth: '2px',
      borderBottomWidth: '2px',
      borderLeftWidth: '2px',
      borderStyle: 'solid',
      borderColor: '#f97316',
      borderRadius: '10px',
      paddingTop: '8px',
      paddingRight: '12px',
      paddingBottom: '8px',
      paddingLeft: '12px',
      opacity: '0.72',
      fontFamily: 'Inter, sans-serif',
      fontSize: '18px',
      fontWeight: '700',
      lineHeight: '1.4',
      letterSpacing: '0px',
      textAlign: 'center',
      textDecoration: 'underline',
      textTransform: 'uppercase',
      color: '#111827',
      boxShadow: '0 12px 24px rgba(0, 0, 0, 0.16)',
    })).toEqual({
      'background-color': 'rgb(10, 20, 30)',
      'background-image': 'url("shot.png")',
      'border-top-width': '2px',
      'border-right-width': '2px',
      'border-bottom-width': '2px',
      'border-left-width': '2px',
      'border-style': 'solid',
      'border-color': '#f97316',
      'border-radius': '10px',
      'padding-top': '8px',
      'padding-right': '12px',
      'padding-bottom': '8px',
      'padding-left': '12px',
      opacity: '0.72',
      'font-family': 'Inter, sans-serif',
      'font-size': '18px',
      'font-weight': '700',
      'line-height': '1.4',
      'letter-spacing': '0px',
      'text-align': 'center',
      'text-decoration': 'underline',
      'text-transform': 'uppercase',
      color: '#111827',
      'box-shadow': '0 12px 24px rgba(0, 0, 0, 0.16)',
    });
  });

  it('copies authored kebab-case CSS properties when computed styles are unavailable', () => {
    expect(buildGrapesjsCssStyleClipboard({
      'background-color': '#ce6666',
      'border-radius': '18px',
      'border-color': '#111111',
      'border-style': 'solid',
      'border-top-width': '1px',
      'box-shadow': '0 8px 18px rgba(0, 0, 0, 0.2)',
      opacity: '0.6',
    })).toEqual({
      'background-color': '#ce6666',
      'border-radius': '18px',
      'border-color': '#111111',
      'border-style': 'solid',
      'border-top-width': '1px',
      'box-shadow': '0 8px 18px rgba(0, 0, 0, 0.2)',
      opacity: '0.6',
    });
  });

  it('pastes visual CSS to the target rule and live element without replacing layout geometry', () => {
    const setProperty = vi.fn();
    const target = fakeComponent({
      style: {
        position: 'absolute',
        left: '770px',
        top: '327px',
        width: '397px',
        height: '181px',
        'background-color': '#d9d9d9',
      },
      el: {
        nodeType: 1,
        style: {
          setProperty,
          removeProperty: vi.fn(),
          length: 2,
        },
      } as unknown as HTMLElement,
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    try {
      expect(applyGrapesjsCssStyleClipboardToComponents([target as never], {
        width: '999px',
        height: '999px',
        position: 'relative',
        left: '0px',
        top: '0px',
        'background-color': 'rgb(199, 103, 103)',
        'border-radius': '13px',
        'border-color': '#111111',
        'border-style': 'solid',
        'border-top-width': '1px',
      })).toBe(true);

      expect(target.getStyle()).toMatchObject({
        position: 'absolute',
        left: '770px',
        top: '327px',
        width: '397px',
        height: '181px',
        'background-color': 'rgb(199, 103, 103)',
        'border-radius': '13px',
        'border-color': '#111111',
        'border-style': 'solid',
        'border-top-width': '1px',
      });
      expect(setProperty).toHaveBeenCalledWith('background-color', 'rgb(199, 103, 103)');
      expect(setProperty).toHaveBeenCalledWith('border-radius', '13px');
      expect(setProperty).not.toHaveBeenCalledWith('width', expect.any(String));
      expect(setProperty).not.toHaveBeenCalledWith('left', expect.any(String));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offsets absolute pasted components without touching other style properties', () => {
    expect(offsetGrapesjsAbsolutePositionStyle({
      position: 'absolute',
      left: '12px',
      top: '30px',
      width: '240px',
    }, { x: 24, y: -10 })).toEqual({
      position: 'absolute',
      left: '36px',
      top: '20px',
      width: '240px',
    });
  });

  it('uses the DOM position as absolute drag origin when model left/top are temporarily missing', () => {
    expect(resolveGrapesjsPositionedToolDragOrigin({
      styleLeft: undefined,
      styleTop: undefined,
      elementRect: fakeDomRect(420, 260, 160, 96),
      rootRect: fakeDomRect(100, 80, 1920, 1080),
    })).toEqual({ left: 320, top: 180 });
  });

  it('clears DOM inline styles after promoting canvas tool styles into GrapesJS CSS rules', () => {
    const removeProperty = vi.fn();
    const removeAttribute = vi.fn();
    const component = fakeComponent({
      style: {
        width: '281px',
        height: '316px',
        'box-sizing': 'border-box',
        borderRadius: '2px',
      },
      el: {
        nodeType: 1,
        style: {
          removeProperty,
          length: 0,
        },
        removeAttribute,
      } as unknown as HTMLElement,
    });

    clearGrapesjsManagedInlineStyle(component as never);

    expect(removeProperty).toHaveBeenCalledWith('width');
    expect(removeProperty).toHaveBeenCalledWith('height');
    expect(removeProperty).toHaveBeenCalledWith('box-sizing');
    expect(removeProperty).toHaveBeenCalledWith('border-radius');
    expect(removeAttribute).toHaveBeenCalledWith('style');
  });
});

describe('GrapesjsEditor positioned geometry', () => {
  it('aligns multiple absolute selections to their shared left edge', () => {
    const canvasBody = {
      nodeType: 1,
      getBoundingClientRect: () => fakeDomRect(200, 50, 800, 600),
    } as HTMLElement;
    const parent = fakeComponent({ rect: null });
    const first = fakeComponent({
      attrs: { 'data-od-position-mode': 'absolute' },
      style: { position: 'absolute', left: '20px', top: '30px', width: '64px', height: '36px' },
      rect: fakeDomRect(220, 80, 64, 36),
    });
    const second = fakeComponent({
      attrs: { 'data-od-position-mode': 'absolute' },
      style: { position: 'absolute', left: '100px', top: '90px', width: '80px', height: '40px' },
      rect: fakeDomRect(300, 140, 80, 40),
    });
    first.move(parent);
    second.move(parent);
    const editor = {
      getSelectedAll: () => [first, second],
      Canvas: {
        getDocument: () => ({ body: canvasBody, documentElement: canvasBody }),
      },
    };

    expect(alignGrapesjsPositionedSelection(editor as never, 'left')).toBe(true);

    expect(first.getStyle()).toMatchObject({ left: '20px', top: '30px' });
    expect(second.getStyle()).toMatchObject({ left: '20px', top: '90px' });
  });

  it('distributes multiple absolute selections horizontally without changing outer items', () => {
    const canvasBody = {
      nodeType: 1,
      getBoundingClientRect: () => fakeDomRect(200, 50, 800, 600),
    } as HTMLElement;
    const parent = fakeComponent({ rect: null });
    const first = fakeComponent({
      attrs: { 'data-od-position-mode': 'absolute' },
      style: { position: 'absolute', left: '20px', top: '30px', width: '40px', height: '36px' },
      rect: fakeDomRect(220, 80, 40, 36),
    });
    const second = fakeComponent({
      attrs: { 'data-od-position-mode': 'absolute' },
      style: { position: 'absolute', left: '100px', top: '30px', width: '40px', height: '36px' },
      rect: fakeDomRect(300, 80, 40, 36),
    });
    const third = fakeComponent({
      attrs: { 'data-od-position-mode': 'absolute' },
      style: { position: 'absolute', left: '220px', top: '30px', width: '40px', height: '36px' },
      rect: fakeDomRect(420, 80, 40, 36),
    });
    first.move(parent);
    second.move(parent);
    third.move(parent);
    const editor = {
      getSelectedAll: () => [first, second, third],
      Canvas: {
        getDocument: () => ({ body: canvasBody, documentElement: canvasBody }),
      },
    };

    expect(alignGrapesjsPositionedSelection(editor as never, 'distribute-x')).toBe(true);

    expect(first.getStyle()).toMatchObject({ left: '20px' });
    expect(second.getStyle()).toMatchObject({ left: '120px' });
    expect(third.getStyle()).toMatchObject({ left: '220px' });
  });

  it('applies pasted screenshot data as the selected rectangle background', () => {
    const rectangle = fakeComponent({
      attrs: { 'data-od-canvas-tool': 'rectangle', 'data-od-position-mode': 'absolute' },
      style: { position: 'absolute', left: '20px', top: '30px', width: '240px', height: '120px' },
      rect: fakeDomRect(220, 80, 240, 120),
    });
    const parent = fakeComponent({ rect: null });
    rectangle.move(parent);
    const select = vi.fn();
    const editor = {
      getSelected: () => rectangle,
      select,
    };

    expect(pasteGrapesjsImageToSelection(editor as never, {
      dataUrl: 'data:image/png;base64,shot',
      width: 1024,
      height: 512,
    })).toBe(rectangle);

    expect(rectangle.components().length).toBe(0);
    expect(rectangle.getStyle()).toMatchObject({
      position: 'absolute',
      left: '20px',
      top: '30px',
      width: '240px',
      height: '120px',
      'background-image': 'url("data:image/png;base64,shot")',
      'background-repeat': 'no-repeat',
      'background-position': 'center',
      'background-size': 'cover',
    });
    expect(select).toHaveBeenCalledWith(rectangle);
  });

  it('pastes screenshots directly onto the artboard at natural image size', () => {
    const wrapper = fakeComponent({ rect: null });
    const select = vi.fn();
    const editor = {
      getSelected: () => null,
      select,
      Components: {
        getComponents: () => ({
          get: (index: number) => (index === 0 ? wrapper : null),
          at: (index: number) => (index === 0 ? wrapper : null),
        }),
      },
    };

    const created = pasteGrapesjsImageToSelection(editor as never, {
      dataUrl: 'data:image/png;base64,shot',
      width: 642,
      height: 630,
      point: { x: 12, y: 18 },
    });

    expect(created).toBe(wrapper.components().get(0));
    expect(created?.getStyle()).toMatchObject({
      position: 'absolute',
      left: '12px',
      top: '18px',
      width: '642px',
      height: '630px',
      'background-image': 'url("data:image/png;base64,shot")',
      'background-repeat': 'no-repeat',
      'background-position': 'center',
      'background-size': 'cover',
    });
    expect(select).toHaveBeenCalledWith(created);
  });
});

describe('GrapesjsEditor arrange shortcuts', () => {
  it('resolves macOS Option-modified keys from KeyboardEvent.code', () => {
    expect(grapesjsShortcutLetterFromEvent({
      key: 'å',
      code: 'KeyA',
    } as KeyboardEvent)).toBe('a');
    expect(grapesjsShortcutLetterFromEvent({
      key: '˙',
      code: 'KeyH',
    } as KeyboardEvent)).toBe('h');
  });
});

describe('GrapesjsEditor icon components', () => {
  it('builds remote icon search URLs from Chinese queries with preferred Chinese-friendly collections first', () => {
    expect(translateGrapesjsIconSearchQuery('邮件')).toBe('mail');
    const url = buildIconifySearchUrl({ query: '邮件', limit: 24 });

    expect(url).toContain('https://api.iconify.design/search');
    expect(url).toContain('query=mail');
    expect(url).toContain('limit=24');
    expect(url).toContain('prefixes=icon-park-outline%2Cicon-park-solid%2Cant-design');
  });

  it('expands Chinese mobile searches across more remote icon collections', () => {
    expect(translateGrapesjsIconSearchQuery('手机')).toBe('mobile phone');
    const url = buildIconifySearchUrl({ query: '手机' });

    expect(url).toContain('query=mobile+phone');
    expect(url).toContain('limit=100');
    expect(url).toContain('material-symbols');
    expect(url).toContain('lucide');
    expect(url).toContain('heroicons');
    expect(url).toContain('mingcute');
  });

  it('maps remote Iconify search results into currentColor mask icons', () => {
    const icons = iconifySearchResultsToIcons({
      icons: ['icon-park-outline:mail', 'ant-design:home-outlined'],
    });

    expect(icons[0]).toMatchObject({
      id: 'remote-icon-park-outline-mail',
      label: 'Mail',
      library: 'remote',
      remoteIcon: 'icon-park-outline:mail',
      remoteSvgUrl: 'https://api.iconify.design/icon-park-outline/mail.svg',
    });

    const svg = renderGrapesjsIconSvg({
      label: 'Mail',
      path: '',
      size: 32,
      strokeWidth: 2,
      color: '#333333',
      variant: 'linear',
      remoteSvgUrl: icons[0]?.remoteSvgUrl,
    });

    expect(svg).toContain('data-od-remote-icon');
    expect(svg).toContain('background-color:currentColor');
    expect(svg).toContain('mask-image:url(&quot;https://api.iconify.design/icon-park-outline/mail.svg&quot;)');
  });

  it('ships an expanded icon catalog in lazily renderable pages', () => {
    expect(GRAPESJS_ICON_CATALOG.length).toBeGreaterThanOrEqual(320);
    expect(visibleGrapesjsIconPage({ library: 'all', query: '', limit: GRAPESJS_ICON_PAGE_SIZE }).items.length).toBe(GRAPESJS_ICON_PAGE_SIZE);
    expect(GRAPESJS_ICON_PAGE_SIZE).toBe(100);
    expect(visibleGrapesjsIconPage({ library: 'all', query: '', limit: GRAPESJS_ICON_PAGE_SIZE }).hasMore).toBe(true);
  });

  it('renders inserted SVG icons so resizing the selected element scales the visible icon', () => {
    const svg = renderGrapesjsIconSvg({
      label: 'Mail',
      path: 'M4 6h16v12H4z M4 7l8 6 8-6',
      size: 32,
      strokeWidth: 2,
      color: '#333333',
      variant: 'linear',
    });

    expect(svg).toContain('width="100%"');
    expect(svg).toContain('height="100%"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toContain('stroke="#333333"');
  });

  it('adds configured SVG icons directly to the artboard', () => {
    const wrapper = fakeComponent({ rect: null });
    const select = vi.fn();
    const editor = {
      select,
      Components: {
        getComponents: () => ({
          get: (index: number) => (index === 0 ? wrapper : null),
          at: (index: number) => (index === 0 ? wrapper : null),
        }),
      },
    };

    const created = insertGrapesjsIconComponent(editor as never, {
      label: 'Mail',
      path: 'M4 6h16v12H4z M4 7l8 6 8-6',
      size: 32,
      strokeWidth: 2,
      color: '#333333',
      variant: 'linear',
    });

    expect(created).toBe(wrapper.components().get(0));
    expect(created?.getAttributes()).toMatchObject({
      'data-od-canvas-tool': 'icon',
      'data-od-position-mode': 'absolute',
      'data-od-icon-label': 'Mail',
    });
    expect(created?.getStyle()).toMatchObject({
      position: 'absolute',
      width: '32px',
      height: '32px',
      color: '#333333',
    });
    expect(select).toHaveBeenCalledWith(created);
  });
});

describe('GrapesjsEditor multi-selection bounds resize', () => {
  it('resizes multiple positioned selections through a shared outer box without wrapping them', () => {
    const parent = fakeComponent({ rect: null });
    const first = fakeComponent({
      attrs: { 'data-od-canvas-tool': 'rectangle', 'data-od-position-mode': 'absolute' },
      style: { position: 'absolute', left: '0px', top: '0px', width: '100px', height: '100px' },
      rect: fakeDomRect(0, 0, 100, 100),
    });
    const second = fakeComponent({
      attrs: { 'data-od-canvas-tool': 'rectangle', 'data-od-position-mode': 'absolute' },
      style: { position: 'absolute', left: '200px', top: '50px', width: '100px', height: '50px' },
      rect: fakeDomRect(200, 50, 100, 50),
    });
    const third = fakeComponent({
      attrs: { 'data-od-canvas-tool': 'rectangle', 'data-od-position-mode': 'absolute' },
      style: { position: 'absolute', left: '50px', top: '200px', width: '150px', height: '100px' },
      rect: fakeDomRect(50, 200, 150, 100),
    });
    first.move(parent);
    second.move(parent);
    third.move(parent);
    const beforeChildren = parent.components().length;
    const editor = {
      getSelectedAll: () => [first, second, third],
    };

    expect(resizeGrapesjsPositionedSelectionToBounds(editor as never, {
      left: 0,
      top: 0,
      width: 600,
      height: 150,
    })).toBe(true);

    expect(parent.components().length).toBe(beforeChildren);
    expect(first.getStyle()).toMatchObject({ left: '0px', top: '0px', width: '200px', height: '50px' });
    expect(second.getStyle()).toMatchObject({ left: '400px', top: '25px', width: '200px', height: '25px' });
    expect(third.getStyle()).toMatchObject({ left: '100px', top: '100px', width: '300px', height: '50px' });
  });
});

describe('GrapesjsEditor shortcut help', () => {
  it('documents arrange shortcuts alongside the categorized help content', () => {
    const arrange = GRAPESJS_SHORTCUT_GROUPS.find((group) => group.id === 'arrange');

    expect(arrange?.title).toBe('排列');
    expect(arrange?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '左对齐', shortcut: '⌥ A' }),
      expect.objectContaining({ label: '左对齐', icon: expect.any(String) }),
      expect.objectContaining({ label: '水平平均分布', shortcut: '⇧ ⌥ H' }),
      expect.objectContaining({ label: '添加自动布局', shortcut: '⇧ A' }),
    ]));
  });
});

describe('GrapesjsEditor canvas tools', () => {
  it('does not emit autosave while a canvas tool is only inserted for live placement', () => {
    const scheduleEmit = vi.fn();

    scheduleGrapesjsPlacementChange('insert', scheduleEmit);

    expect(scheduleEmit).not.toHaveBeenCalled();

    scheduleGrapesjsPlacementChange('finish', scheduleEmit);
    scheduleGrapesjsPlacementChange('cancel', scheduleEmit);

    expect(scheduleEmit).toHaveBeenCalledTimes(2);
  });

  it('does not inject a selectable placeholder div for an empty artboard body', () => {
    expect(canvasComponentHtml({
      doctype: '<!doctype html>',
      htmlOpen: '<html>',
      head: '<head></head>',
      bodyOpen: '<body>',
      bodyInner: '',
      bodyClose: '</body>',
      htmlClose: '</html>',
    })).toBe('');
  });

  it('removes the legacy empty gjs-size canvas sentinel from loaded body html', () => {
    expect(canvasComponentHtml({
      doctype: '<!doctype html>',
      htmlOpen: '<html>',
      head: '<head></head>',
      bodyOpen: '<body>',
      bodyInner: '<div data-gjs-type="default" data-od-id="gjs-size" id="abc"></div><section>Real</section>',
      bodyClose: '</body>',
      htmlClose: '</html>',
    })).toBe('<section>Real</section>');
  });

  it('removes an accidental nested body wrapper before GrapesJS parses components', () => {
    expect(canvasComponentHtml({
      doctype: '<!doctype html>',
      htmlOpen: '<html>',
      head: '<head></head>',
      bodyOpen: '<body>',
      bodyInner: '<body data-od-id="gjs-il5b" id="il5b"><div id="rect"></div></body>',
      bodyClose: '</body>',
      htmlClose: '</html>',
    })).toBe('<div id="rect"></div>');
  });

  it('serializes canvas body styles without stealing style from the first real component', () => {
    const parsed = {
      doctype: '<!doctype html>',
      htmlOpen: '<html>',
      head: '<head></head>',
      bodyOpen: '<body>',
      bodyInner: '',
      bodyClose: '</body>',
      htmlClose: '</html>',
    };
    const editor = {
      getHtml: () => '<div style="position:absolute;left:120px;top:80px;width:160px;height:96px"></div>',
      getCss: () => '',
      Components: {
        getComponents: () => ({
          get: () => ({
            getStyle: () => ({
              position: 'absolute',
              left: '120px',
              top: '80px',
              width: '160px',
              height: '96px',
            }),
          }),
        }),
      },
    };

    const serialized = buildEditorDocument(editor as never, parsed, undefined, {
      backgroundColor: '#ffffff',
    });

    expect(serialized).toContain('<body style="background-color:#ffffff">');
    expect(serialized).not.toContain('<body style="position:absolute');
    expect(serialized).toContain('<div style="position:absolute;left:120px;top:80px;width:160px;height:96px"></div>');
  });

  it('strips only empty gjs-size sentinel nodes', () => {
    expect(stripGrapesjsCanvasSizeSentinel(
      '<div data-gjs-type="default" data-od-id="gjs-size"></div><div data-od-id="gjs-size">content</div>',
    )).toBe('<div data-od-id="gjs-size">content</div>');
  });

  it('serializes editor body HTML without nesting a body tag into the saved body', () => {
    const parsed = {
      doctype: '<!doctype html>',
      htmlOpen: '<html>',
      head: '<head></head>',
      bodyOpen: '<body>',
      bodyInner: '',
      bodyClose: '</body>',
      htmlClose: '</html>',
    };
    const editor = {
      getHtml: () => '<body id="gjs-root"><div id="rect"></div></body>',
      getCss: () => '#rect{width:220px;height:96px;}',
    };

    const serialized = buildEditorDocument(editor as never, parsed);

    expect(serialized).toContain('<body>\n<div id="rect"></div>\n</body>');
    expect(serialized).not.toContain('<body id="gjs-root">');
  });

  it('creates absolutely positioned rectangle components at the clicked point', () => {
    const component = buildGrapesjsCanvasToolComponent('rectangle', { x: 42.4, y: 75.6 });

    expect(component.tagName).toBe('div');
    expect(component.attributes).toEqual({
      'data-od-canvas-tool': 'rectangle',
      'data-od-position-mode': 'absolute',
    });
    expect(component.style).toMatchObject({
      position: 'absolute',
      left: '42px',
      top: '76px',
      width: '160px',
      height: '96px',
      background: '#D9D9D9',
      border: '0',
    });
    expect(component).not.toHaveProperty('draggable');
  });

  it('creates text components with editable text content', () => {
    const component = buildGrapesjsCanvasToolComponent('text', { x: 12, y: 16 });

    expect(component.content).toBe('输入文本');
    expect(component.editable).toBe(true);
    expect(component.droppable).toBe(false);
    expect(component.style).toMatchObject({
      position: 'absolute',
      left: '12px',
      top: '16px',
      'font-family': 'system-ui, sans-serif',
      'font-size': '14px',
      'font-weight': '400',
      'line-height': '20px',
      display: 'inline-block',
      'min-width': '24px',
      'min-height': '20px',
    });
    expect(component.style).not.toHaveProperty('width');
    expect(component.style).not.toHaveProperty('height');
  });

  it('creates flow rectangle components without absolute positioning for flex insertion', () => {
    const component = buildGrapesjsCanvasToolComponent('rectangle', { x: 42, y: 75 }, { mode: 'flow' });

    expect(component.attributes).toEqual({
      'data-od-canvas-tool': 'rectangle',
      'data-od-position-mode': 'flow',
    });
    expect(component.style).toMatchObject({
      width: '160px',
      height: '96px',
      background: '#D9D9D9',
      border: '0',
    });
    expect(component.style).not.toHaveProperty('position');
    expect(component).not.toHaveProperty('draggable');
  });

  it('calculates line length and rotation from the drag vector', () => {
    expect(getGrapesjsCanvasToolDragStyle('line', { x: 10, y: 20 }, { x: 110, y: 120 })).toMatchObject({
      position: 'absolute',
      left: '10px',
      top: '20px',
      width: '141px',
      height: '2px',
      transform: 'rotate(45deg)',
      'transform-origin': 'left center',
    });
  });

  it('locks rectangular drag sizing to a square when Shift is held', () => {
    expect(
      getGrapesjsCanvasToolDragStyle('rectangle', { x: 10, y: 20 }, { x: 90, y: 62 }, 'absolute', {
        lockAspect: true,
      }),
    ).toMatchObject({
      position: 'absolute',
      left: '10px',
      top: '20px',
      width: '80px',
      height: '80px',
    });
  });

  it('appends placed components to the GrapesJS wrapper instead of the first body child', () => {
    const wrapperAppend = vi.fn((component) => ({ component }));
    const firstChildAppend = vi.fn();
    const editor = {
      getWrapper: () => ({ append: wrapperAppend }),
      Components: {
        getComponents: () => ({ get: () => ({ append: firstChildAppend }) }),
      },
    };

    const node = appendGrapesjsCanvasToolComponent(editor, 'rectangle', { x: 24, y: 32 });

    expect(node).toBeTruthy();
    expect(wrapperAppend).toHaveBeenCalledTimes(1);
    expect(firstChildAppend).not.toHaveBeenCalled();
    expect(wrapperAppend.mock.calls[0]?.[0]).toMatchObject({
      attributes: {
        'data-od-canvas-tool': 'rectangle',
        'data-od-position-mode': 'absolute',
      },
      style: {
        position: 'absolute',
        left: '24px',
        top: '32px',
      },
    });
  });
});
