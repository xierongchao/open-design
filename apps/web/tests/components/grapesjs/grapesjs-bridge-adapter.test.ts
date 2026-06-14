import { describe, expect, it } from 'vitest';

import type { Component, Editor } from 'grapesjs';

import {
  applyPreviewStyle,
  ensureComponentOdId,
  extractInspectTarget,
  findComponentByOdId,
  getCanvasIframe,
  getElementFromComponent,
  getNormalizedBox,
  getOdIdFromComponent,
  persistStyleOverride,
  readStyleOverride,
  resolveComponentForHostSelection,
  scanTweaksAvailability,
  setCanvasCssVariable,
} from '../../../src/components/grapesjs/grapesjs-bridge-adapter';

/**
 * Mock helpers — the adapter is intentionally pure so we can build a tiny
 * fake Component / Editor shape and exercise every helper without spinning
 * up a real GrapesJS instance (which would pull a browser env).
 */
function makeComp(opts: {
  attrs?: Record<string, unknown>;
  style?: Record<string, unknown>;
  tagName?: string;
  children?: Component[];
  rect?: { left: number; top: number; width: number; height: number };
  el?: HTMLElement;
  getEl?: HTMLElement | null;
  getElThrows?: boolean;
  cid?: string;
  modelId?: string;
}): Component {
  const attrs = opts.attrs ?? {};
  const style = opts.style ?? {};
  const children = opts.children ?? [];
  let parentRef: Component | null = null;
  const comp = {
    cid: opts.cid,
    getAttributes: () => ({ ...attrs }),
    setAttributes: (next: Record<string, unknown>) => Object.assign(attrs, next),
    getStyle: () => ({ ...style }),
    setStyle: (next: Record<string, unknown>) => {
      Object.assign(style, next);
      return comp;
    },
    get: (key: string) => (key === 'tagName' ? opts.tagName ?? 'div' : undefined),
    getId: () => opts.modelId ?? '',
    getEl: () => {
      if (opts.getElThrows) throw new Error('not rendered');
      return opts.getEl ?? undefined;
    },
    parent: () => parentRef,
    toHTML: () => '',
    components: () => {
      const list = children as unknown as Component[];
      Object.assign(list, {
        length: children.length,
        get: (i: number) => children[i],
      });
      return list as unknown as ReturnType<Component['components']>;
    },
    getCurrentView: () => (opts.el ? { el: opts.el } : undefined),
    view: opts.el ? { el: opts.el } : undefined,
    __setParent: (next: Component | null) => {
      parentRef = next;
    },
  } as unknown as Component;
  for (const child of children) {
    (child as unknown as { __setParent?: (next: Component | null) => void }).__setParent?.(comp);
  }
  return comp;
}

function makeEditor(opts: {
  roots?: Component[];
  frameEl?: HTMLIFrameElement | null;
  doc?: Document | null;
  cssRules?: Map<string, Record<string, string>>;
  commandRuns?: string[];
  onCommandRun?: (id: string) => void;
}): Editor {
  const roots = opts.roots ?? [];
  const rules = opts.cssRules ?? new Map<string, Record<string, string>>();
  const editor = {
    Components: {
      getComponents: () => {
        const list = roots as unknown as Component[];
        Object.assign(list, {
          length: roots.length,
          get: (i: number) => roots[i],
        });
        return list as unknown as ReturnType<Editor['Components']['getComponents']>;
      },
    },
    Canvas: {
      getFrameEl: () => opts.frameEl ?? null,
      getDocument: () => opts.doc ?? null,
    },
    Commands: {
      run: (id: string) => {
        opts.commandRuns?.push(id);
        opts.onCommandRun?.(id);
      },
    },
    Css: {
      setRule: (selector: string, decls: Record<string, string>) => {
        rules.set(selector, { ...decls });
      },
      getRule: (selector: string) => {
        const decl = rules.get(selector);
        return decl
          ? { getStyle: () => ({ ...decl }) }
          : null;
      },
    },
  } as unknown as Editor;
  return editor;
}

describe('getOdIdFromComponent', () => {
  it('reads data-od-id first', () => {
    const comp = makeComp({ attrs: { 'data-od-id': 'path-0-1', 'data-od-source-path': 'src/App.tsx:42' } });
    expect(getOdIdFromComponent(comp)).toBe('path-0-1');
  });
  it('falls back to data-od-source-path', () => {
    const comp = makeComp({ attrs: { 'data-od-source-path': 'src/App.tsx:42' } });
    expect(getOdIdFromComponent(comp)).toBe('src/App.tsx:42');
  });
  it('falls back to data-od-runtime-id', () => {
    const comp = makeComp({ attrs: { 'data-od-runtime-id': 'r-7' } });
    expect(getOdIdFromComponent(comp)).toBe('r-7');
  });
  it('returns null when no id attributes present', () => {
    const comp = makeComp({ attrs: { class: 'btn' } });
    expect(getOdIdFromComponent(comp)).toBeNull();
  });
  it('ignores empty strings', () => {
    const comp = makeComp({ attrs: { 'data-od-id': '', 'data-od-source-path': 'src/App.tsx:42' } });
    expect(getOdIdFromComponent(comp)).toBe('src/App.tsx:42');
  });
  it('handles getAttributes throwing', () => {
    const comp = {
      getAttributes: () => {
        throw new Error('not ready');
      },
    } as unknown as Component;
    expect(getOdIdFromComponent(comp)).toBeNull();
  });
});

describe('findComponentByOdId', () => {
  it('walks the tree to find a matching component', () => {
    const leaf = makeComp({ attrs: { 'data-od-id': 'path-0-0-1' } });
    const mid = makeComp({ attrs: { 'data-od-id': 'path-0-0' }, children: [leaf] });
    const root = makeComp({ attrs: { 'data-od-id': 'path-0' }, children: [mid] });
    const editor = makeEditor({ roots: [root] });
    expect(findComponentByOdId(editor, 'path-0-0-1')).toBe(leaf);
    expect(findComponentByOdId(editor, 'path-0-0')).toBe(mid);
    expect(findComponentByOdId(editor, 'missing')).toBeNull();
  });
  it('returns null on empty id', () => {
    const editor = makeEditor({ roots: [] });
    expect(findComponentByOdId(editor, '')).toBeNull();
  });
});

describe('getElementFromComponent', () => {
  it('prefers the rendered element from getEl', () => {
    const viewEl = { id: 'view' } as HTMLElement;
    const getEl = { id: 'getEl' } as HTMLElement;
    const comp = makeComp({ el: viewEl, getEl });
    expect(getElementFromComponent(comp)).toBe(getEl);
  });

  it('falls back to the component view element', () => {
    const viewEl = { id: 'view' } as HTMLElement;
    const comp = makeComp({ el: viewEl });
    expect(getElementFromComponent(comp)).toBe(viewEl);
  });

  it('handles getEl throwing while the view is still available', () => {
    const viewEl = { id: 'view' } as HTMLElement;
    const comp = makeComp({ el: viewEl, getElThrows: true });
    expect(getElementFromComponent(comp)).toBe(viewEl);
  });

  it('ignores rendered Text nodes', () => {
    const textNode = { nodeType: 3 } as HTMLElement;
    const comp = makeComp({ getEl: textNode });
    expect(getElementFromComponent(comp)).toBeNull();
  });
});

describe('resolveComponentForHostSelection', () => {
  it('climbs from a text component to the nearest element-backed ancestor with an od id', () => {
    const textNode = { nodeType: 3 } as HTMLElement;
    const titleEl = { nodeType: 1 } as HTMLElement;
    const text = makeComp({ getEl: textNode });
    const title = makeComp({
      attrs: { 'data-od-id': 'heading-title' },
      getEl: titleEl,
      children: [text],
    });
    expect(resolveComponentForHostSelection(text)).toBe(title);
  });

  it('falls back to the first element-backed component when no ancestor has an od id yet', () => {
    const titleEl = { nodeType: 1 } as HTMLElement;
    const title = makeComp({ attrs: {}, getEl: titleEl });
    expect(resolveComponentForHostSelection(title)).toBe(title);
  });
});

describe('ensureComponentOdId', () => {
  it('keeps an existing id', () => {
    const comp = makeComp({ attrs: { 'data-od-id': 'existing' } });
    const runs: string[] = [];
    const editor = makeEditor({ roots: [comp], commandRuns: runs });
    expect(ensureComponentOdId(editor, comp)).toBe('existing');
    expect(runs).toEqual([]);
  });

  it('lets the stable-id plugin refresh before using the fallback', () => {
    const comp = makeComp({ attrs: {} });
    const runs: string[] = [];
    const editor = makeEditor({
      roots: [comp],
      commandRuns: runs,
      onCommandRun: () => {
        comp.setAttributes({ 'data-od-id': 'from-refresh' });
      },
    });
    expect(ensureComponentOdId(editor, comp)).toBe('from-refresh');
    expect(runs).toEqual(['od-stable-id:refresh']);
  });

  it('assigns a path id when refresh does not provide one', () => {
    const child = makeComp({ attrs: {} });
    const root = makeComp({ attrs: {}, children: [child] });
    const editor = makeEditor({ roots: [root] });
    expect(ensureComponentOdId(editor, child)).toBe('path-0');
    expect(child.getAttributes()['data-od-id']).toBe('path-0');
  });
});

describe('applyPreviewStyle', () => {
  it('merges sparse styles without wiping existing props', () => {
    const comp = makeComp({
      attrs: { 'data-od-id': 'x' },
      style: { color: 'red', padding: '8px' },
    });
    const editor = makeEditor({ roots: [comp] });
    const ok = applyPreviewStyle(editor, 'x', { color: 'blue' });
    expect(ok).toBe(true);
    expect(comp.getStyle()).toEqual({ color: 'blue', padding: '8px' });
  });
  it('returns false when the id is unknown', () => {
    const editor = makeEditor({ roots: [] });
    expect(applyPreviewStyle(editor, 'missing', { color: 'blue' })).toBe(false);
  });
});

describe('getNormalizedBox', () => {
  it('computes rect relative to canvas iframe', () => {
    const el = {
      getBoundingClientRect: () => ({ left: 110, top: 60, width: 50, height: 30 }),
    } as HTMLElement;
    const comp = makeComp({ attrs: { 'data-od-id': 'x' }, getEl: el });
    const frame = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 800 }),
    } as HTMLIFrameElement;
    const editor = makeEditor({ roots: [comp], frameEl: frame });
    expect(getNormalizedBox(editor, 'x')).toEqual({
      x: 10,
      y: 10,
      width: 50,
      height: 30,
    });
  });
  it('returns null when frame has zero size', () => {
    const el = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    } as HTMLElement;
    const comp = makeComp({ attrs: { 'data-od-id': 'x' }, el });
    const frame = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    } as HTMLIFrameElement;
    const editor = makeEditor({ roots: [comp], frameEl: frame });
    expect(getNormalizedBox(editor, 'x')).toBeNull();
  });
  it('returns null when component not found', () => {
    const editor = makeEditor({ roots: [] });
    expect(getNormalizedBox(editor, 'missing')).toBeNull();
  });
});

describe('scanTweaksAvailability', () => {
  it('returns true when canvas document has .tw-panel', () => {
    const doc = {
      querySelector: (sel: string) => (sel.includes('tw-panel') ? {} : null),
    } as unknown as Document;
    const editor = makeEditor({ doc });
    expect(scanTweaksAvailability(editor)).toBe(true);
  });
  it('returns false when nothing matches', () => {
    const doc = { querySelector: () => null } as unknown as Document;
    const editor = makeEditor({ doc });
    expect(scanTweaksAvailability(editor)).toBe(false);
  });
  it('returns false when canvas throws', () => {
    const editor = {
      Canvas: {
        getDocument: () => {
          throw new Error('no canvas');
        },
      },
    } as unknown as Editor;
    expect(scanTweaksAvailability(editor)).toBe(false);
  });
});

describe('extractInspectTarget', () => {
  it('builds an InspectTarget snapshot from computed style', () => {
    const fakeEl = {} as Element;
    const computed = {
      getPropertyPriority: () => '',
      getPropertyValue: (name: string) => {
        if (name === 'color') return 'rgb(255,0,0)';
        if (name === 'background-color') return 'rgb(0,0,255)';
        return '';
      },
    } as unknown as CSSStyleDeclaration;
    const win = { getComputedStyle: () => computed } as unknown as Window;
    const doc = {
      defaultView: win,
      querySelector: () => fakeEl,
    } as unknown as Document;
    const comp = makeComp({
      attrs: { 'data-od-id': 'x', class: 'btn primary', id: 'cta' },
      tagName: 'button',
      getEl: fakeEl as HTMLElement,
    });
    const editor = makeEditor({ roots: [comp], doc });
    const target = extractInspectTarget(editor, 'x');
    expect(target).not.toBeNull();
    expect(target?.elementId).toBe('x');
    expect(target?.selector).toBe('button#cta.btn.primary');
    expect(target?.label).toBe('button');
    expect(target?.style.color).toBe('rgb(255,0,0)');
    expect(target?.style.backgroundColor).toBe('rgb(0,0,255)');
  });
  it('returns null when component is missing', () => {
    const editor = makeEditor({ roots: [] });
    expect(extractInspectTarget(editor, 'missing')).toBeNull();
  });
});

describe('getCanvasIframe', () => {
  it('returns the canvas frame element', () => {
    const frame = {} as HTMLIFrameElement;
    const editor = makeEditor({ frameEl: frame });
    expect(getCanvasIframe(editor)).toBe(frame);
  });
  it('returns null when canvas throws', () => {
    const editor = {
      Canvas: {
        getFrameEl: () => {
          throw new Error('no canvas');
        },
      },
    } as unknown as Editor;
    expect(getCanvasIframe(editor)).toBeNull();
  });
});

describe('setCanvasCssVariable', () => {
  it('writes a CSS variable on the document element', () => {
    const styleMap: Record<string, string> = {};
    const docEl = {
      style: {
        setProperty: (name: string, value: string) => {
          styleMap[name] = value;
        },
      },
    } as unknown as HTMLElement;
    const doc = { documentElement: docEl } as unknown as Document;
    const editor = makeEditor({ doc });
    expect(setCanvasCssVariable(editor, '--brand-primary', '#f00')).toBe(true);
    expect(styleMap['--brand-primary']).toBe('#f00');
  });
  it('returns false on missing doc', () => {
    const editor = makeEditor({ doc: null });
    expect(setCanvasCssVariable(editor, '--x', 'y')).toBe(false);
  });
  it('returns false on empty inputs', () => {
    const editor = makeEditor({});
    expect(setCanvasCssVariable(editor, '', 'y')).toBe(false);
    expect(setCanvasCssVariable(editor, '--x', '')).toBe(false);
  });
});

describe('persistStyleOverride / readStyleOverride', () => {
  it('writes a Css rule keyed by data-od-id selector and reads it back', () => {
    const editor = makeEditor({});
    const ok = persistStyleOverride(editor, 'path-0-1', { color: 'red', 'font-size': '14px' });
    expect(ok).toBe(true);
    expect(readStyleOverride(editor, 'path-0-1')).toEqual({
      color: 'red',
      'font-size': '14px',
    });
  });
  it('returns null when no rule exists', () => {
    const editor = makeEditor({});
    expect(readStyleOverride(editor, 'unknown')).toBeNull();
  });
  it('rejects empty id', () => {
    const editor = makeEditor({});
    expect(persistStyleOverride(editor, '', { color: 'red' })).toBe(false);
    expect(readStyleOverride(editor, '')).toBeNull();
  });
});
