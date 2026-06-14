import type { Component, Editor } from 'grapesjs';
import type { ManualEditStyles } from '../../edit-mode/types';
import type { InspectStyleSnapshot, InspectTarget } from '../viewer-utils';

/**
 * GrapesJS → host bridge adapter.
 *
 * Replaces the postMessage flows (`od-edit-*`, `od:comment-*`, `od:inspect-*`,
 * `od:tweaks-available`) that the iframe-based manual edit / comment / inspect
 * bridges used to carry between the canvas and FileViewer. Each helper here
 * operates directly on the live Editor instance so we skip the cross-origin
 * hop entirely.
 *
 * Pure functions only — no React, no side effects beyond the editor state
 * they're asked to mutate. This keeps them trivially unit-testable and lets
 * FileViewer consume them without dragging React state into the adapter.
 */

const OD_ID_ATTR = 'data-od-id';
const OD_SOURCE_PATH_ATTR = 'data-od-source-path';
const OD_RUNTIME_ID_ATTR = 'data-od-runtime-id';

/** Common attribute bag shape GrapesJS exposes via Component.getAttributes(). */
type AttrBag = Record<string, unknown>;

function readAttrs(comp: Component): AttrBag | null {
  if (!comp) return null;
  let attrs: AttrBag | undefined;
  try {
    attrs = comp.getAttributes() as AttrBag | undefined;
  } catch {
    return null;
  }
  return attrs ?? null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asElement(value: unknown): HTMLElement | null {
  if (!value || typeof value !== 'object') return null;
  const nodeType = (value as { nodeType?: unknown }).nodeType;
  if (typeof nodeType === 'number') {
    return nodeType === 1 ? value as HTMLElement : null;
  }
  // Unit tests use tiny HTMLElement-shaped objects rather than real DOM
  // nodes; keep that path permissive while rejecting real Text nodes above.
  return value as HTMLElement;
}

/**
 * Read the stable data-od-id for a Component, falling back to
 * data-od-source-path / data-od-runtime-id. Matches the precedence used by
 * bridge.ts and od-stable-id-plugin so IDs round-trip across the two paths.
 */
export function getOdIdFromComponent(comp: Component): string | null {
  const attrs = readAttrs(comp);
  if (!attrs) return null;
  return (
    asString(attrs[OD_ID_ATTR]) ??
    asString(attrs[OD_SOURCE_PATH_ATTR]) ??
    asString(attrs[OD_RUNTIME_ID_ATTR])
  );
}

/** Walk the whole component tree, returning a flat array (breadth-first). */
function walkAll(editor: Editor): Component[] {
  const out: Component[] = [];
  const stack: Component[] = [];
  const roots = editor.Components.getComponents();
  for (let i = 0; i < roots.length; i += 1) {
    const root = roots.get(i);
    if (root) stack.push(root);
  }
  while (stack.length) {
    const node = stack.shift();
    if (!node) continue;
    out.push(node);
    const children = node.components();
    for (let i = 0; i < children.length; i += 1) {
      const child = children.get(i);
      if (child) stack.push(child);
    }
  }
  return out;
}

/** Find a Component by its data-od-id (or fallback attributes). */
export function findComponentByOdId(editor: Editor, odId: string): Component | null {
  if (!odId) return null;
  const all = walkAll(editor);
  for (const comp of all) {
    if (getOdIdFromComponent(comp) === odId) return comp;
  }
  return null;
}

/**
 * Resolve the rendered DOM element for a GrapesJS Component. Depending on
 * lifecycle timing and GrapesJS internals, the element can be exposed through
 * `getEl()`, a current view, or the legacy `view.el` property. Host features
 * should use this helper instead of picking one path and silently losing the
 * selection.
 */
export function getElementFromComponent(comp: Component | null | undefined): HTMLElement | null {
  if (!comp) return null;
  const withViews = comp as Component & {
    getCurrentView?: () => { el?: HTMLElement } | undefined;
    getView?: () => { el?: HTMLElement } | undefined;
    view?: { el?: HTMLElement };
  };
  try {
    const el = asElement(comp.getEl?.());
    if (el) return el;
  } catch {
    // fall through to view-based paths
  }
  try {
    const el = asElement(withViews.getCurrentView?.()?.el);
    if (el) return el;
  } catch {
    // fall through
  }
  try {
    const el = asElement(withViews.getView?.()?.el);
    if (el) return el;
  } catch {
    // fall through
  }
  return asElement(withViews.view?.el);
}

/**
 * Resolve the GrapesJS Component backing a canvas DOM element.
 *
 * GrapesJS tags each rendered element with a private `__gjsv` view marker
 * whose `.model` is the Component (same path the built-in select command
 * uses at grapes.mjs:49407). This helper reads that marker and walks up
 * `parentNode` until it finds one, mirroring the engine's own DOM→model
 * resolution. Returns null for the iframe document root or non-element
 * targets. Used by the nested-selection and Cmd+right-click menu flows
 * which start from a raw DOM event target.
 */
export function getComponentFromElement(el: Element | null | undefined): Component | null {
  if (!el || typeof (el as { nodeType?: number }).nodeType !== 'number') return null;
  if ((el as { nodeType: number }).nodeType !== 1) return null;
  type GjsViewMarker = { __gjsv?: { model?: Component } | null } & {
    __cashData?: { model?: Component } | null;
  };
  let node: Element | null = el;
  while (node) {
    const marker = node as unknown as GjsViewMarker;
    const model = marker.__gjsv?.model ?? marker.__cashData?.model;
    if (model) return model;
    // Stop at the iframe document — its parent is the host document.
    const parent = (node.parentElement ?? (node.parentNode as Element | null)) as Element | null;
    if (!parent || parent === node) break;
    if ((parent as { nodeType?: number }).nodeType === 9) break; // document
    node = parent;
  }
  return null;
}

function getComponentParent(comp: Component): Component | null {
  try {
    return comp.parent?.() ?? null;
  } catch {
    return null;
  }
}

function getComponentChildAt(parent: Component, index: number): Component | null {
  try {
    return parent.components?.().get(index) ?? null;
  } catch {
    return null;
  }
}

function getComponentChildrenLength(parent: Component): number {
  try {
    return parent.components?.().length ?? 0;
  } catch {
    return 0;
  }
}

function componentPathId(comp: Component): string | null {
  const parts: number[] = [];
  let node: Component | null = comp;
  while (node) {
    const parent = getComponentParent(node);
    if (!parent) break;
    const len = getComponentChildrenLength(parent);
    let index = -1;
    for (let i = 0; i < len; i += 1) {
      if (getComponentChildAt(parent, i) === node) {
        index = i;
        break;
      }
    }
    if (index < 0) return null;
    parts.unshift(index);
    node = parent;
  }
  return parts.length > 0 ? `path-${parts.join('-')}` : null;
}

function sanitizeIdPart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function fallbackComponentId(comp: Component): string | null {
  const path = componentPathId(comp);
  if (path) return path;
  try {
    const modelId = sanitizeIdPart(comp.getId?.() ?? '');
    if (modelId) return `gjs-${modelId}`;
  } catch {
    // fall through to cid
  }
  const cid = sanitizeIdPart(String((comp as { cid?: unknown }).cid ?? ''));
  return cid ? `gjs-${cid}` : null;
}

function assignOdId(comp: Component, odId: string): boolean {
  if (!odId) return false;
  const attrs = readAttrs(comp) ?? {};
  try {
    comp.setAttributes({ ...attrs, [OD_ID_ATTR]: odId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the Component the host should treat as selected. GrapesJS can fire
 * selection events for internal Text components; those often lack a stable
 * data-od-id and can expose a Text node instead of an HTMLElement. Climb to
 * the nearest element-backed ancestor so the host sidebar, highlight, and
 * inspect snapshot all operate on the visible DOM element the user clicked.
 */
export function resolveComponentForHostSelection(
  comp: Component | null | undefined,
): Component | null {
  if (!comp) return null;
  let node: Component | null = comp;
  let firstElementBacked: Component | null = null;
  for (let depth = 0; node && depth < 12; depth += 1) {
    const elementBacked = getElementFromComponent(node) !== null;
    if (elementBacked && !firstElementBacked) firstElementBacked = node;
    if (elementBacked && getOdIdFromComponent(node)) return node;
    node = getComponentParent(node);
  }
  return firstElementBacked ?? comp;
}

/**
 * Guarantee an id for a selected Component. The stable-id plugin should cover
 * normal elements, but selection can race initial tagging or land on a freshly
 * created/text-adjacent component. The fallback writes a deterministic path id
 * when possible, otherwise a sanitized GrapesJS model id.
 */
export function ensureComponentOdId(editor: Editor, comp: Component): string | null {
  const existing = getOdIdFromComponent(comp);
  if (existing) return existing;
  try {
    editor.Commands?.run?.('od-stable-id:refresh');
  } catch {
    // plugin command is best-effort; fallback below still makes selection usable.
  }
  const refreshed = getOdIdFromComponent(comp);
  if (refreshed) return refreshed;
  const fallback = fallbackComponentId(comp);
  if (!fallback) return null;
  return assignOdId(comp, fallback) ? fallback : null;
}

/**
 * Apply a partial style map to a Component, mirroring what
 * `od-edit-preview-style` used to do inside the iframe. We shallow-merge
 * with the existing style object so callers can send sparse overrides
 * (e.g. only `{ color: 'red' }`) without wiping unrelated props.
 *
 * Values use camelCase keys (GrapesJS convention) — `paddingTop`, not
 * `padding-top`. The host's inspect panel sends kebab-case prop names so
 * callers convert before invoking.
 */
export function applyPreviewStyle(
  editor: Editor,
  odId: string,
  styles: Partial<ManualEditStyles> | Record<string, string>,
): boolean {
  const comp = findComponentByOdId(editor, odId);
  if (!comp) return false;
  try {
    // GrapesJS's setStyle accepts StyleProps; we shallow-merge the current
    // style object with the sparse override map. The cast keeps the call
    // site types simple while remaining a structurally-correct partial.
    const merged = { ...(comp.getStyle() ?? {}), ...styles } as Parameters<typeof comp.setStyle>[0];
    comp.setStyle(merged);
    return true;
  } catch {
    return false;
  }
}

/** Normalised rectangle (0..1) relative to the canvas iframe viewport. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute a normalised rect for the Component, suitable for the comment
 * overlay's coordinate system. Returns null when the element is not in the
 * DOM, the canvas iframe is missing, or the iframe has zero size (which
 * would divide by zero).
 *
 * Note: under `devicePreviewMode: true`, the canvas iframe matches the
 * container width 1:1, so we don't apply a scale factor here. The host
 * can multiply by its own preview scale when drawing the overlay.
 */
export function getNormalizedBox(editor: Editor, odId: string): NormalizedRect | null {
  const comp = findComponentByOdId(editor, odId);
  if (!comp) return null;
  const el = getElementFromComponent(comp);
  if (!el) return null;
  let frame: HTMLIFrameElement | null = null;
  try {
    frame = editor.Canvas.getFrameEl() ?? null;
  } catch {
    frame = null;
  }
  const frameRect = frame?.getBoundingClientRect();
  if (!frameRect || frameRect.width === 0 || frameRect.height === 0) return null;
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left - frameRect.left,
    y: rect.top - frameRect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** True if the canvas document contains a `.tw-panel` / `.tw-hidden` node. */
export function scanTweaksAvailability(editor: Editor): boolean {
  try {
    const doc = editor.Canvas.getDocument();
    if (!doc) return false;
    return !!doc.querySelector('.tw-panel, .tw-hidden');
  } catch {
    return false;
  }
}

const INSPECT_PROPS = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderRadius',
  'textAlign',
  'fontFamily',
  'lineHeight',
] as const;

/** Build an InspectTarget snapshot from a Component's current state. */
export function extractInspectTarget(editor: Editor, odId: string): InspectTarget | null {
  const comp = findComponentByOdId(editor, odId);
  if (!comp) return null;
  return inspectTargetFromComponent(editor, comp, odId);
}

/**
 * Build an InspectTarget directly from a Component instance, skipping the
 * tree-walk lookup. Use this when the caller already holds the live selected
 * component (e.g. from editor.getSelected()) — the by-id lookup can miss
 * components whose data-od-id attribute GrapesJS stripped during setComponents
 * (it keeps AI-authored attributes on the DOM but not always on the model),
 * which left the inspect panel empty even though a component was clearly
 * selected.
 */
export function extractInspectTargetFromComponent(
  editor: Editor,
  comp: Component,
): InspectTarget | null {
  if (!comp) return null;
  const odId = getOdIdFromComponent(comp) ?? fallbackComponentPublicId(comp);
  return inspectTargetFromComponent(editor, comp, odId);
}

function fallbackComponentPublicId(comp: Component): string {
  // Prefer an existing id attribute, then tagName + index-ish, else 'element'.
  const attrs = readAttrs(comp) ?? {};
  const id = asString(attrs['id']);
  if (id) return id;
  try {
    const tag = (comp.get('tagName') as string | undefined) ?? 'element';
    return tag;
  } catch {
    return 'element';
  }
}

function inspectTargetFromComponent(
  editor: Editor,
  comp: Component,
  odId: string,
): InspectTarget | null {
  const attrs = readAttrs(comp) ?? {};
  const tagName = (() => {
    try {
      return (comp.get('tagName') as string | undefined) ?? 'div';
    } catch {
      return 'div';
    }
  })();
  const className = asString(attrs['class']) ?? '';
  const id = asString(attrs['id']);
  const selector = `${tagName}${id ? `#${id}` : ''}${className ? `.${className.split(/\s+/).join('.')}` : ''}`;
  const label = asString(attrs['data-od-label']) ?? tagName;
  const text = (() => {
    try {
      return (comp.toHTML?.() as string | undefined) ?? '';
    } catch {
      return '';
    }
  })().replace(/<[^>]*>/g, '').trim().slice(0, 120);

  let style: InspectStyleSnapshot = {};
  try {
    const doc = editor.Canvas.getDocument();
    if (!doc) {
      return {
        elementId: odId,
        selector,
        label,
        text,
        style,
      };
    }
    const el = getElementFromComponent(comp);
    if (el) {
      const computed = doc.defaultView?.getComputedStyle(el);
      if (computed) {
        style = INSPECT_PROPS.reduce<InspectStyleSnapshot>((acc, key) => {
          const value = computed.getPropertyValue(
            key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
          );
          if (value) (acc as Record<string, string>)[key] = value;
          return acc;
        }, {});
      }
    }
  } catch {
    // best-effort — empty snapshot is fine.
  }

  return {
    elementId: odId,
    selector,
    label,
    text,
    style,
  };
}

/** Return the Canvas iframe so the host can run requestPreviewSnapshot on it. */
export function getCanvasIframe(editor: Editor): HTMLIFrameElement | null {
  try {
    return editor.Canvas.getFrameEl() ?? null;
  } catch {
    return null;
  }
}

/**
 * Set a CSS variable on the canvas document (e.g. --brand-primary). Used by
 * the palette panel to swap theme tokens without going through postMessage.
 */
export function setCanvasCssVariable(
  editor: Editor,
  name: string,
  value: string,
): boolean {
  if (!name || !value) return false;
  try {
    const doc = editor.Canvas.getDocument();
    if (!doc?.documentElement) return false;
    doc.documentElement.style.setProperty(name, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist style overrides as a CSS rule scoped to the data-od-id selector.
 * This is what `saveInspectToSource` uses to write overrides back into the
 * source file in a way that survives GrapesJS round-trips: we write the
 * rule via editor.Css.setRule, and the next getDocument() will include it
 * in the CSS block that reassembleDocument places in <head>.
 */
export function persistStyleOverride(
  editor: Editor,
  odId: string,
  declarations: Record<string, string>,
): boolean {
  if (!odId) return false;
  const selector = `[${OD_ID_ATTR}="${odId}"]`;
  try {
    editor.Css.setRule(selector, declarations);
    return true;
  } catch {
    return false;
  }
}

/** Read the active override rule for an od-id, if any. */
export function readStyleOverride(
  editor: Editor,
  odId: string,
): Record<string, string> | null {
  if (!odId) return null;
  const selector = `[${OD_ID_ATTR}="${odId}"]`;
  try {
    const rule = editor.Css.getRule(selector);
    if (!rule) return null;
    const decl = (rule.getStyle() ?? {}) as Record<string, string>;
    return Object.keys(decl).length > 0 ? decl : null;
  } catch {
    return null;
  }
}
