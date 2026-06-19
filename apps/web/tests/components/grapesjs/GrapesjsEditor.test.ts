import { describe, expect, it, vi } from 'vitest';

import {
  appendGrapesjsCanvasToolComponent,
  arrangeGrapesjsSelectionAsFlex,
  attachGrapesjsCanvasViewportSync,
  buildGrapesjsCssStyleClipboard,
  buildGrapesjsCanvasToolComponent,
  calculateGrapesjsCornerRadiusDrag,
  calculateGrapesjsCornerRadiusFromPointer,
  calculateCanvasFitToViewport,
  calculateGrapesjsRadiusHandleInset,
  clipboardHasImageFile,
  dissolveGrapesjsFlexSelection,
  firstGrapesjsClipboardImageFile,
  getGrapesjsCanvasToolDragStyle,
  isGrapesjsEditorEditing,
  getGrapesjsIframeSelectionOutlineCss,
  getGrapesjsZoomStyleVars,
  offsetGrapesjsAbsolutePositionStyle,
  isGrapesjsCanvasChromeTarget,
  shouldHandleGrapesjsImagePaste,
  stopGrapesjsTextEditingForPointerTarget,
  upsertGrapesjsIframeSelectionStyle,
} from '../../../src/components/grapesjs/GrapesjsEditor';

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

describe('GrapesjsEditor iframe selection CSS', () => {
  it('overrides GrapesJS selected outline shorthand instead of only its width', () => {
    const css = getGrapesjsIframeSelectionOutlineCss();
    const selectedBlock = css.match(/html body \.gjs-selected,[^}]*\}/)?.[0] ?? '';

    expect(selectedBlock).toContain('html body .gjs-selected');
    expect(selectedBlock).toContain('outline: var(--od-gjs-hairline, 1px) solid #3b82f6 !important;');
    expect(selectedBlock).not.toContain('outline-width: var(--od-gjs-hairline, 1px) !important;');
  });

  it('can render element-picker selection outlines in green', () => {
    const css = getGrapesjsIframeSelectionOutlineCss('element-selection');

    expect(css).toContain('solid #10b981 !important;');
    expect(css).not.toContain('solid #3b82f6 !important;');
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
  components(): { length: number; get(index: number): FakeGrapesjsComponent | null };
  getAttributes(): Record<string, string>;
  setAttributes(next: Record<string, string>): void;
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
    components: () => ({
      get length() {
        return children.length;
      },
      get: (index: number) => children[index] ?? null,
    }),
    getAttributes: () => attrs,
    setAttributes(next) {
      Object.assign(attrs, next);
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

describe('GrapesjsEditor style clipboard', () => {
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
      color: '#111827',
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
      color: '#111827',
    });
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
});

describe('GrapesjsEditor canvas tools', () => {
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
