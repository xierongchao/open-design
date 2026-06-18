import type { Component, Editor } from 'grapesjs';
import { getElementFromComponent } from './grapesjs-bridge-adapter';

/**
 * Normalize a CSS color string (rgb()/rgba()/named/#hex) to an upper-case
 * 6-digit hex, dropping the alpha channel. Returns null for transparent,
 * empty, or unparseable values.
 */
export function normalizeColorToHex(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v || v === 'transparent' || v === 'none' || v === 'initial' || v === 'inherit') return null;
  if (/^#[0-9a-f]{6}$/.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  }
  const m = v.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (!m) return null;
  const to = (n: string) => Math.round(Number(n)).toString(16).padStart(2, '0');
  const hex = `#${to(m[1] ?? '0')}${to(m[2] ?? '0')}${to(m[3] ?? '0')}`;
  // Skip fully-transparent rgba() colors. Do not apply this to rgb(), whose
  // third channel can legitimately be 0 (for example pure red or green).
  if (v.startsWith('rgba')) {
    const alphaM = v.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/);
    if (alphaM && Number(alphaM[1]) === 0) return null;
  }
  return hex.toUpperCase();
}

function readSelectedComponents(editor: Editor | null): Component[] {
  if (!editor) return [];
  try {
    return (editor.getSelectedAll?.() ?? []) as Component[];
  } catch {
    try {
      const selected = editor.getSelected?.() as Component | null | undefined;
      return selected ? [selected] : [];
    } catch {
      return [];
    }
  }
}

function sameComponents(a: readonly Component[], b: readonly Component[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function collectColorsFromComponents(components: readonly Component[]): string[] {
  if (components.length === 0) return [];
  try {
    const found = new Set<string>();
    const seen = new WeakSet<Element>();
    for (const comp of components) {
      const root = getElementFromComponent(comp);
      if (!root) continue;
      const win = root.ownerDocument.defaultView;
      if (!win) continue;
      const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
      for (const el of elements) {
        if (seen.has(el)) continue;
        seen.add(el);
        let cs: CSSStyleDeclaration;
        try {
          cs = win.getComputedStyle(el);
        } catch {
          continue;
        }
        // border-color resolves to currentColor even when no border is drawn,
        // so only collect it when a border actually exists.
        const hasBorder = parseFloat(cs.getPropertyValue('border-top-width') || '0') > 0;
        // Skip inherited text/background colors so empty wrapper divs do not
        // surface body defaults as user-owned colors.
        const parent = el.parentElement;
        let pcs: CSSStyleDeclaration | null = null;
        if (parent) {
          try {
            pcs = win.getComputedStyle(parent);
          } catch {
            // ignore
          }
        }
        const differs = (prop: string): boolean => {
          const cur = cs.getPropertyValue(prop);
          const par = pcs ? pcs.getPropertyValue(prop) : '';
          return cur !== par;
        };
        const candidates: string[] = [];
        if (differs('background-color')) candidates.push(cs.getPropertyValue('background-color'));
        if (differs('color')) candidates.push(cs.getPropertyValue('color'));
        if (hasBorder) candidates.push(cs.getPropertyValue('border-top-color'));
        for (const color of candidates) {
          const hex = normalizeColorToHex(color);
          if (hex) found.add(hex);
        }
      }
    }
    return Array.from(found);
  } catch {
    return [];
  }
}

/** Recursively gather every user-owned color used inside the selection tree. */
export function collectColorsFromSelection(editor: Editor | null): string[] {
  return collectColorsFromComponents(readSelectedComponents(editor));
}

export interface SelectionColorCollector {
  collect(editor: Editor | null): string[];
  invalidate(): void;
}

/**
 * Cache the expensive selected-subtree color scan until the selection identity
 * or editor changes. Call invalidate after style/component mutations.
 */
export function createSelectionColorCollector(): SelectionColorCollector {
  let cache: { editor: Editor; components: Component[]; colors: string[] } | null = null;
  return {
    collect(editor) {
      if (!editor) return [];
      const components = readSelectedComponents(editor);
      if (cache && cache.editor === editor && sameComponents(cache.components, components)) {
        return cache.colors;
      }
      const colors = collectColorsFromComponents(components);
      cache = { editor, components, colors };
      return colors;
    },
    invalidate() {
      cache = null;
    },
  };
}

function collectComponentTree(comp: Component, out: Map<Element, Component>): void {
  const el = getElementFromComponent(comp);
  if (el) out.set(el, comp);
  try {
    const children = comp.components?.();
    if (children) {
      for (const child of children) collectComponentTree(child as Component, out);
    }
  } catch {
    // ignore
  }
}

/**
 * Replace colors in the selection's subtree whose normalized hex matches a
 * target with `replacement`. Edits each component's inline style so the change
 * round-trips through getDocument.
 */
export function replaceColorsInSelection(editor: Editor | null, targets: string[], replacement: string): number {
  if (!editor || targets.length === 0) return 0;
  try {
    const targetSet = new Set(targets.map((target) => normalizeColorToHex(target) ?? target.toUpperCase()));
    const selected = readSelectedComponents(editor);
    let count = 0;
    const componentByEl = new Map<Element, Component>();
    for (const comp of selected) collectComponentTree(comp, componentByEl);
    const win = editor.Canvas.getDocument?.()?.defaultView ?? null;
    for (const [el, comp] of componentByEl) {
      if (!win) continue;
      let cs: CSSStyleDeclaration;
      try {
        cs = win.getComputedStyle(el);
      } catch {
        continue;
      }
      const props = [
        'background-color',
        'color',
        'border-top-color',
        'border-right-color',
        'border-bottom-color',
        'border-left-color',
      ];
      let changed = false;
      const next = { ...(comp.getStyle?.() ?? {}) } as Record<string, string>;
      for (const cssKey of props) {
        const hex = normalizeColorToHex(cs.getPropertyValue(cssKey));
        if (hex && targetSet.has(hex)) {
          next[cssKey] = replacement;
          changed = true;
        }
      }
      if (changed) {
        try {
          comp.setStyle?.(next);
          count += 1;
        } catch {
          // ignore
        }
      }
    }
    if (count > 0) {
      try {
        editor.getSelected?.()?.trigger?.('change:attributes');
      } catch {
        // ignore
      }
    }
    return count;
  } catch {
    return 0;
  }
}
