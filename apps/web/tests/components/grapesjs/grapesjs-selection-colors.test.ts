// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Component, Editor } from 'grapesjs';

import {
  collectColorsFromSelection,
  createSelectionColorCollector,
  normalizeColorToHex,
  replaceColorsInSelection,
} from '../../../src/components/grapesjs/grapesjs-selection-colors';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function makeComponent(el: HTMLElement, style: Record<string, string> = {}): Component {
  return {
    getEl: () => el,
    getStyle: () => style,
    setStyle: vi.fn((next: Record<string, string>) => {
      Object.assign(style, next);
    }),
    components: () => [],
    trigger: vi.fn(),
  } as unknown as Component;
}

function makeEditor(selected: Component[]): Editor {
  return {
    getSelectedAll: () => selected,
    getSelected: () => selected[0] ?? null,
    Canvas: {
      getDocument: () => document,
    },
  } as unknown as Editor;
}

describe('normalizeColorToHex', () => {
  it('normalizes supported CSS colors and skips transparent values', () => {
    expect(normalizeColorToHex('#abc')).toBe('#AABBCC');
    expect(normalizeColorToHex('#aabbcc')).toBe('#AABBCC');
    expect(normalizeColorToHex('rgb(12, 34, 56)')).toBe('#0C2238');
    expect(normalizeColorToHex('rgba(12, 34, 56, 0)')).toBeNull();
    expect(normalizeColorToHex('transparent')).toBeNull();
  });
});

describe('collectColorsFromSelection', () => {
  it('collects explicit colors from the selected subtree', () => {
    const root = document.createElement('div');
    const child = document.createElement('span');
    root.appendChild(child);
    document.body.appendChild(root);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => ({
      getPropertyValue: (prop: string) => {
        if (el === root) {
          if (prop === 'background-color') return 'rgb(255, 0, 0)';
          if (prop === 'color') return 'rgb(0, 0, 0)';
          if (prop === 'border-top-width') return '0px';
        }
        if (el === child) {
          if (prop === 'background-color') return 'rgba(0, 0, 0, 0)';
          if (prop === 'color') return 'rgb(0, 0, 255)';
          if (prop === 'border-top-width') return '1px';
          if (prop === 'border-top-color') return 'rgb(0, 255, 0)';
        }
        if (prop === 'background-color') return 'rgba(0, 0, 0, 0)';
        if (prop === 'color') return 'rgb(0, 0, 0)';
        return '';
      },
    } as CSSStyleDeclaration));
    const comp = makeComponent(root);

    expect(collectColorsFromSelection(makeEditor([comp]))).toEqual([
      '#FF0000',
      '#0000FF',
      '#00FF00',
    ]);
  });
});

describe('createSelectionColorCollector', () => {
  it('reuses the cached color scan for the same editor and selected components', () => {
    const root = document.createElement('div');
    root.style.backgroundColor = 'rgb(255, 0, 0)';
    const querySelectorAll = vi.spyOn(root, 'querySelectorAll');
    const editor = makeEditor([makeComponent(root)]);
    const collector = createSelectionColorCollector();

    const first = collector.collect(editor);
    const second = collector.collect(editor);

    expect(second).toBe(first);
    expect(querySelectorAll).toHaveBeenCalledTimes(1);
  });

  it('recomputes after explicit invalidation', () => {
    const root = document.createElement('div');
    root.style.backgroundColor = 'rgb(255, 0, 0)';
    const querySelectorAll = vi.spyOn(root, 'querySelectorAll');
    const editor = makeEditor([makeComponent(root)]);
    const collector = createSelectionColorCollector();

    collector.collect(editor);
    collector.invalidate();
    collector.collect(editor);

    expect(querySelectorAll).toHaveBeenCalledTimes(2);
  });
});

describe('replaceColorsInSelection', () => {
  it('writes replacement colors into matching component styles', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      getPropertyValue: (prop: string) => (prop === 'background-color' ? 'rgb(255, 0, 0)' : ''),
    } as CSSStyleDeclaration));
    const style: Record<string, string> = {};
    const comp = makeComponent(root, style);
    const trigger = (comp as unknown as { trigger: ReturnType<typeof vi.fn> }).trigger;

    expect(replaceColorsInSelection(makeEditor([comp]), ['#ff0000'], '#00ff00')).toBe(1);
    expect(style['background-color']).toBe('#00ff00');
    expect(trigger).toHaveBeenCalledWith('change:attributes');
  });
});
