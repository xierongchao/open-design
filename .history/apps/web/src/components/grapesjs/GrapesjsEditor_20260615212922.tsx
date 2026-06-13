import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Component, Editor as GrapesjsEditorInstance, Plugin } from 'grapesjs';
import { odStableIdPlugin, odStableIdPluginKey } from './od-stable-id-plugin';
import { odResizablePlugin, odResizablePluginKey } from './od-resizable-plugin';
import CanvasContextMenu, { type CanvasCtxMenuState } from './CanvasContextMenu';
import {
  applyCanvasHeadAssets,
  areDocumentsEqual,
  parseHtmlDocument,
  reassembleDocument,
  type ParsedDocument,
} from './html-document';
import {
  ensureComponentOdId,
  getComponentFromElement,
  getElementFromComponent,
  getOdIdFromComponent,
  resolveComponentForHostSelection,
} from './grapesjs-bridge-adapter';
import styles from './GrapesjsEditor.module.css';

function readOdIdFromComponent(comp: unknown): string | null {
  return getOdIdFromComponent(comp as Component);
}

/**
 * True when the keyboard focus is in an element that owns Space/letter keys
 * (form fields, contenteditable, the GrapesJS text-edit overlay). Used to keep
 * the Space-to-pan shortcut from swallowing scrolling/typing inside inputs.
 */
/** Computed-style properties the StylePanel renders, read from a canvas element. */
const STYLE_SNAPSHOT_PROPS = [
  'width','height','minWidth','maxWidth',
  'marginTop','marginRight','marginBottom','marginLeft',
  'paddingTop','paddingRight','paddingBottom','paddingLeft',
  'fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textAlign','textDecoration','textTransform','color',
  'backgroundColor','backgroundImage','backgroundSize','backgroundRepeat','backgroundPosition','opacity',
  'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','borderColor','borderRadius',
  'borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius',
  'boxShadow','transition','transform','cursor','overflow',
  'filter','backdropFilter','WebkitBackdropFilter',
  'outline','outlineWidth','outlineStyle','outlineColor','outlineOffset',
  'mixBlendMode',
  'display','flexDirection','justifyContent','alignItems','justifySelf','alignSelf','flexWrap','gap',
  'position','top','right','bottom','left','zIndex',
] as const;

function readElementStyles(el: HTMLElement | null): Record<string, string> {
  if (!el) return {};
  try {
    const win = el.ownerDocument.defaultView;
    if (!win) return {};
    const cs = win.getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const key of STYLE_SNAPSHOT_PROPS) {
      const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const v = cs.getPropertyValue(cssKey);
      if (v) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Normalize a CSS color string (rgb()/rgba()/named/#hex) to an upper-case
 * 6-digit hex, dropping the alpha channel. Used by collectColorsFromSelection
 * and replaceColorsInSelection so "rgb(0,0,0)" and "#000000" compare equal.
 * Returns null for transparent / empty / unparseable values.
 */
function normalizeColorToHex(value: string | undefined): string | null {
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
  // Skip fully-transparent colors (alpha 0).
  const alphaM = v.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
  if (alphaM && Number(alphaM[1]) === 0) return null;
  return hex.toUpperCase();
}

/**
 * Recursively gather every color (background-color, border-*-color, color)
 * used inside the selection's subtree. Returns de-duplicated hex strings.
 * Reads computed style so colors from external CSS classes are included.
 */
function collectColorsFromSelection(editor: GrapesjsEditorInstance | null): string[] {
  if (!editor) return [];
  try {
    const all = (editor.getSelectedAll?.() ?? []) as Component[];
    if (all.length === 0) return [];
    const found = new Set<string>();
    const seen = new WeakSet<Element>();
    for (const comp of all) {
      const root = getElementFromComponent(comp);
      if (!root) continue;
      const win = root.ownerDocument.defaultView;
      if (!win) continue;
      const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
      for (const el of elements) {
        if (seen.has(el)) continue;
        seen.add(el);
        let cs: CSSStyleDeclaration;
        try { cs = win.getComputedStyle(el); } catch { continue; }
        // border-color resolves to currentColor (usually black) even when no
        // border is drawn, so only collect it when a border actually exists.
        const hasBorder = parseFloat(cs.getPropertyValue('border-top-width') || '0') > 0;
        // color is inherited; an empty <div> inherits black from <body>/<html>
        // but the user doesn't think of that as "their" color. Only collect a
        // colour when it DIFFERS from the parent's computed value (i.e. it was
        // explicitly set on this element, not inherited). The same applies to
        // background-color (initial transparent == parent's painted bg).
        const parent = (el as Element).parentElement;
        let pcs: CSSStyleDeclaration | null = null;
        if (parent) {
          try { pcs = win.getComputedStyle(parent); } catch { /* ignore */ }
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
        for (const c of candidates) {
          const hex = normalizeColorToHex(c);
          if (hex) found.add(hex);
        }
      }
    }
    return Array.from(found);
  } catch {
    return [];
  }
}

/**
 * Replace colors in the selection's subtree whose normalized hex matches a
 * target with `replacement`. Edits each component's inline style (so the
 * change round-trips through getDocument) and returns the edit count.
 */
function replaceColorsInSelection(editor: GrapesjsEditorInstance | null, targets: string[], replacement: string): number {
  if (!editor || targets.length === 0) return 0;
  try {
    const targetSet = new Set(targets.map((t) => normalizeColorToHex(t) ?? t.toUpperCase()));
    const all = (editor.getSelectedAll?.() ?? []) as Component[];
    let count = 0;
    const componentByEl = new Map<Element, Component>();
    const collectComponents = (comp: Component) => {
      const el = getElementFromComponent(comp);
      if (el) componentByEl.set(el, comp);
      try {
        const children = comp.components?.();
        if (children) for (const child of children) collectComponents(child as Component);
      } catch { /* ignore */ }
    };
    for (const comp of all) collectComponents(comp);
    const win = editor.Canvas.getDocument?.()?.defaultView ?? null;
    for (const [el, comp] of componentByEl) {
      if (!win) continue;
      let cs: CSSStyleDeclaration;
      try { cs = win.getComputedStyle(el); } catch { continue; }
      const props: Array<[string, string]> = [
        ['background-color', 'backgroundColor'],
        ['color', 'color'],
        ['border-top-color', 'borderTopColor'],
        ['border-right-color', 'borderRightColor'],
        ['border-bottom-color', 'borderBottomColor'],
        ['border-left-color', 'borderLeftColor'],
      ];
      let changed = false;
      const next = { ...(comp.getStyle?.() ?? {}) } as Record<string, string>;
      for (const [cssKey] of props) {
        const hex = normalizeColorToHex(cs.getPropertyValue(cssKey));
        if (hex && targetSet.has(hex)) {
          // GrapesJS getStyle()/setStyle() store keys AS-WRITTEN (no
          // camelCase<->kebab conversion) — getStyle() returns kebab-case
          // (matching the CSS source). Update the kebab key so it overwrites
          // the existing one; writing a camelCase key would ADD a parallel
          // key and the original kebab value would keep rendering.
          next[cssKey] = replacement;
          changed = true;
        }
      }
      if (changed) {
        try { comp.setStyle?.(next); count += 1; } catch { /* ignore */ }
      }
    }
    if (count > 0) {
      // Trigger a refresh so the canvas + StylePanel re-render with the new
      // colors (setStyle alone doesn't always fire the selection snapshot).
      try { editor.getSelected?.()?.trigger?.('change:attributes'); } catch { /* ignore */ }
    }
    return count;
  } catch {
    return 0;
  }
}

function toCssStyleProps(styles: Record<string, string>): Record<string, string> {
  // Convert camelCase keys to kebab-case CSS prop names for element.style assignment.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(styles)) {
    out[k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)] = v;
  }
  return out;
}

function getCanvasBodyElFromEditor(editor: { Canvas?: { getDocument?: () => Document | null } }): HTMLElement | null {
  try {
    const doc = editor.Canvas?.getDocument?.();
    return doc?.body ?? null;
  } catch {
    return null;
  }
}

/**
 * Read a flex/grid parent's display + flex-direction.
 *
 * GrapesJS `Component.getStyle()` only returns the model-registered inline
 * style (or a `#id` rule the editor created) — it does NOT read computed
 * style, so a flex layout coming from an external CSS class (Tailwind
 * `.flex`, an artifact `<style>`, etc.) is invisible to it. That made the
 * arrow-key reorder branch unreachable, so flex children were nudged
 * instead of reordered. We resolve the parent's real DOM element and read
 * the computed style, falling back to getStyle() only when the element
 * isn't materialized yet (cold iframe / freshly added component).
 */
function readParentFlexInfo(parent: Component | null | undefined): { display: string; direction: string } {
  const fallback = () => {
    const ps = (parent?.getStyle?.() ?? {}) as Record<string, string>;
    return {
      display: ps['display'] ?? 'block',
      direction: ps['flex-direction'] ?? 'row',
    };
  };
  const el = getElementFromComponent(parent ?? null);
  if (!el) {
    // Element not materialized (cold iframe). Return 'unknown' instead of
    // guessing 'block' so the caller can fall back to DOM-sibling reordering
    // rather than silently no-op'ing when the parent's flex comes from an
    // external CSS class the inline-only getStyle() can't see.
    return { display: 'unknown', direction: 'row' };
  }
  const win = el.ownerDocument.defaultView;
  if (!win) return fallback();
  try {
    const cs = win.getComputedStyle(el);
    return {
      display: cs.getPropertyValue('display') || 'block',
      direction: cs.getPropertyValue('flex-direction') || 'row',
    };
  } catch {
    return fallback();
  }
}

function isTextInputTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Handle exposed to FileViewer so the parent can drive Tab sync (pull the
 * current HTML when switching to the source Tab, push new HTML when
 * switching back) and toggle read-only mode without remounting.
 */
export interface SelectionSnapshot {
  hasSelection: boolean;
  tagName: string;
  selector: string;
  styles: Record<string, string>;
}

export interface GrapesjsEditorHandle {
  /** Body components HTML (no doctype, no head). */
  getHtml(): string;
  /** Editor-managed CSS rules (from `<style>` GrapesJS injects). */
  getCss(): string;
  /** Full document HTML suitable for writing back to the source file. */
  getDocument(): string;
  /** Replace the body components from a fresh HTML string. */
  setHtml(html: string): void;
  /** Toggle read-only / view-only mode at runtime. */
  setReadOnly(readOnly: boolean): void;
  /** Tear down the underlying editor. */
  destroy(): void;
  /** Apply a partial style map to every selected component (multi-select safe). */
  applyStyle(styles: Record<string, string>): void;
  /** Read computed styles of the canvas <body> (for the no-selection canvas panel). */
  getCanvasStyles(): Record<string, string>;
  /** Write styles to the canvas <body> (canvas-level background / font / size). */
  setCanvasStyles(styles: Record<string, string>): void;
  /** Switch the canvas device viewport (desktop/tablet/mobile) by setting the frame width. */
  setViewport(width: number, height: number): void;
  /** Set the canvas frame width/height in px (canvas-level W/H control). */
  setCanvasSize(width?: number, height?: number): void;
  /** Replace the `src` attribute of every selected component (used by paste /
   *  double-click-upload on an <img>). No-op when nothing is selected. */
  setSelectedSrc(src: string): void;
  /** Read the `src` of the first selected component ('' if none / not set). */
  getSelectedSrc(): string;
  /** Insert a new <img> component into the canvas (or into the selected
   *  container) and select it. Used by the screenshot-paste flow. */
  insertImageComponent(src: string): void;
  /** Re-assert the current selection so GrapesJS redraws the selection box +
   *  resize handles. Used after closing a host-side floating editor (color
   *  picker), which can otherwise leave the handles stale/missing. */
  reselectCurrent(): void;
  /** Toggle canvas 裁剪 mode: when on, dragging the selected element pans its
   *  background-position and the wheel scales its background-size. */
  setCropMode(on: boolean): void;
  /** Recursively collect every color (background/border/text) used inside the
   *  selection's subtree, de-duplicated. Returns [] when nothing is selected. */
  collectColorsFromSelection(): string[];
  /** Replace any color in the selection's subtree that matches a target (by
   *  normalized hex) with `replacement`. Returns the count of edits applied. */
  replaceColors(targets: string[], replacement: string): number;
  /**
   * Return the underlying GrapesJS Editor instance, or null when not yet
   * ready / already destroyed. Callers must null-check before use. The
   * grapesjs types are erased at compile time, so this does not pull the
   * heavy runtime into the type-only import path.
   */
  getEditor(): GrapesjsEditorInstance | null;
}

export interface GrapesjsEditorProps {
  /** Full HTML document (doctyped, with head + body). */
  html: string;
  /** Browser-resolvable project directory URL used for relative canvas assets. */
  baseHref?: string;
  /** True = pure preview (clicks pass through, no canvas editing). */
  readOnly?: boolean;
  /** Notify parent on body changes so it can mark the file dirty. */
  onChange?: (fullDocument: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Cmd/Ctrl+S handler — wired in addition to GrapesJS's own keymap. */
  onSave?: () => void;
  /** Optional className for the root container. */
  className?: string;
  /**
   * PR2: element selection changed (component:selected / component:deselected).
   * ids is the list of selected data-od-id values (empty when nothing is
   * selected). Replaces the iframe postMessage `od:comment-target(s)` flow.
   */
  onSelectTargets?: (ids: string[]) => void;
  /**
   * PR2: hover state changed (component:hover). Null when the pointer leaves
   * all components. Replaces the iframe `od-edit-hover` / `od:comment-hover`
   * flow.
   */
  onHoverTarget?: (id: string | null) => void;
  /**
   * PR2: a style or component mutation happened (styleUpdate /
   * component:update). Used by the host to drive dirty marking and any
   * reconcile that previously waited for the iframe's
   * `od-edit-preview-style-applied` ack.
   */
  onStyleUpdate?: () => void;
  /**
   * PR2: the tweaks template availability changed — true when the canvas
   * contains a `.tw-panel` / `.tw-hidden` node, false when it no longer does.
   * Replaces the iframe `od:tweaks-available` signal from srcdoc.
   */
  onTweaksAvailable?: (available: boolean) => void;
  /**
   * Fired on component:selected / component:deselected with a computed-style
   * snapshot of the first selected element, so the host's StylePanel can render
   * current values without reaching into GrapesJS internals. styles is empty
   * when nothing is selected.
   */
  onSelectionChange?: (info: SelectionSnapshot) => void;
  /** Fires when the canvas zoom changes so the host can update its zoom % display. */
  onZoomChange?: (zoom: number) => void;
  /**
   * Fires when the user double-clicks an <img> component. The host owns the
   * upload UI (the fill panel's image tab) so we suppress GrapesJS's native
   * asset-manager modal and hand control to the parent instead.
   */
  onImageEditRequest?: () => void;
  /**
   * PR3: when provided, the editor renders its LayerManager panel into this
   * container after `load`. The host owns the container's position/visibility
   * so it can dock into a sidebar or hide it per mode.
   */
  layersPanelRef?: RefObject<HTMLDivElement | null>;
  /**
   * PR3: when provided, the editor renders its StyleManager panel into this
   * container after `load`. The host owns the container's position/visibility.
   */
  stylePanelRef?: RefObject<HTMLDivElement | null>;
}

export const GrapesjsEditor = forwardRef<GrapesjsEditorHandle, GrapesjsEditorProps>(
  function GrapesjsEditor(props, ref) {
    const {
      html,
      baseHref,
      readOnly = false,
      onChange,
      onDirtyChange,
      onSave,
      className,
      onSelectTargets,
      onHoverTarget,
      onStyleUpdate,
      onTweaksAvailable,
      onSelectionChange,
      onZoomChange,
      onImageEditRequest,
      layersPanelRef,
      stylePanelRef,
    } = props;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<GrapesjsEditorInstance | null>(null);
    const parsedRef = useRef<ParsedDocument | null>(null);
    const baseHrefRef = useRef<string | undefined>(baseHref);
    const lastExternalHtmlRef = useRef<string>(html);
    const lastEmittedRef = useRef<string>('');
    const readOnlyRef = useRef<boolean>(readOnly);
    const onChangeRef = useRef(onChange);
    const onDirtyChangeRef = useRef(onDirtyChange);
    const onSaveRef = useRef(onSave);
    const onSelectTargetsRef = useRef(onSelectTargets);
    const onHoverTargetRef = useRef(onHoverTarget);
    const onStyleUpdateRef = useRef(onStyleUpdate);
    const onTweaksAvailableRef = useRef(onTweaksAvailable);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onZoomChangeRef = useRef(onZoomChange);
    const onImageEditRequestRef = useRef(onImageEditRequest);
    // When true, canvas pointer drag pans the selected element's
    // background-image and wheel scales it (裁剪 mode). Toggled from the
    // StylePanel when the user picks the 裁剪 fill-size option.
    const cropModeRef = useRef(false);
    // Tracks the order in which the user picked components (shift-click).
    // GrapesJS's getSelectedAll() doesn't guarantee pick order, so we maintain
    // our own array on component:selected/deselected. Used by Shift+A.
    const selectionOrderRef = useRef<Component[]>([]);
    // Refs set inside the boot effect so handle methods (useImperativeHandle,
    // which closes over a stable deps array) can reach into the live editor's
    // scheduleEmit + selection-snapshot helpers.
    const scheduleEmitRef = useRef<(() => void) | null>(null);
    const refreshSelectionSnapshotRef = useRef<(() => void) | null>(null);
    const syncZoomAttrRef = useRef<(() => void) | null>(null);
    const syncCoordsAttrRef = useRef<(() => void) | null>(null);
    const lastTweaksAvailableRef = useRef<boolean | null>(null);
    // Cmd+right-click layer-stack menu. The boot effect writes through
    // setCtxMenuRef (so the canvas-doc contextmenu handler can open it without
    // a React re-render of the editor), and ctxMenu drives the rendered
    // CanvasContextMenu below.
    const [ctxMenu, setCtxMenu] = useState<CanvasCtxMenuState | null>(null);
    const setCtxMenuRef = useRef<((menu: CanvasCtxMenuState | null) => void) | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Keep callback refs fresh without re-creating the editor.
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);
    useEffect(() => {
      onDirtyChangeRef.current = onDirtyChange;
    }, [onDirtyChange]);
    useEffect(() => {
      onSaveRef.current = onSave;
    }, [onSave]);
    useEffect(() => {
      onSelectTargetsRef.current = onSelectTargets;
    }, [onSelectTargets]);
    useEffect(() => {
      onHoverTargetRef.current = onHoverTarget;
    }, [onHoverTarget]);
    useEffect(() => {
      onStyleUpdateRef.current = onStyleUpdate;
    }, [onStyleUpdate]);
    useEffect(() => {
      onTweaksAvailableRef.current = onTweaksAvailable;
    }, [onTweaksAvailable]);
    useEffect(() => {
      onSelectionChangeRef.current = onSelectionChange;
    }, [onSelectionChange]);
    useEffect(() => {
      onZoomChangeRef.current = onZoomChange;
    }, [onZoomChange]);
    useEffect(() => {
      onImageEditRequestRef.current = onImageEditRequest;
    }, [onImageEditRequest]);
    // Bridge the imperative setCtxMenuRef (written by the canvas-doc
    // contextmenu handler inside the boot effect) to React state so the
    // CanvasContextMenu portal renders.
    useEffect(() => {
      setCtxMenuRef.current = (menu) => setCtxMenu(menu);
      return () => { setCtxMenuRef.current = null; };
    }, []);
    useEffect(() => {
      baseHrefRef.current = baseHref;
      applyCanvasHeadAssets(editorRef.current?.Canvas.getDocument() ?? null, parsedRef.current, baseHref);
    }, [baseHref]);
    useEffect(() => {
      readOnlyRef.current = readOnly;
      const editor = editorRef.current;
      if (!editor) return;
      // GrapesJS 0.23 ships a built-in `core:preview` command that
      // toggles a read-only mode where canvas clicks pass through and
      // selection is disabled — exactly the "view mode" semantics we
      // want for the toolbar toggle.
      try {
        if (readOnly) {
          editor.runCommand('core:preview');
        } else {
          editor.stopCommand('core:preview');
        }
      } catch {
        // ignore — best-effort toggle.
      }
    }, [readOnly]);

    const emitChange = useCallback(() => {
      const editor = editorRef.current;
      const parsed = parsedRef.current;
      if (!editor || !parsed) return;
      const bodyHtml = editor.getHtml();
      const css = editor.getCss() ?? '';
      const full = reassembleDocument(parsed, bodyHtml, css);
      if (areDocumentsEqual(full, lastEmittedRef.current)) return;
      lastEmittedRef.current = full;
      // CRITICAL loop-break: sync the emitted value to lastExternalHtmlRef so
      // that when the host echoes the same html back via the `html` prop (the
      // FileViewer onChange → setSource → <GrapesjsEditor html=...> round trip),
      // the html-prop effect recognises it as "the document we just produced"
      // and SKIPS editor.setComponents(). Without this, every selection (which
      // tags a data-od-id → component:update → emitChange) would round-trip
      // through the host and rebuild the whole canvas, wiping the active
      // selection — exactly the "selection gets refreshed away" symptom.
      lastExternalHtmlRef.current = full;
      onChangeRef.current?.(full);
      onDirtyChangeRef.current?.(true);
    }, []);

    // Boot the editor once.
    useEffect(() => {
      let disposed = false;
      setLoading(true);
      setLoadError(null);

      import('grapesjs')
        .then((mod) => {
          if (disposed || !containerRef.current) return;
          const grapesjs = mod.default;
          const parsed = parseHtmlDocument(html);
          parsedRef.current = parsed;
          lastExternalHtmlRef.current = html;

          const editor = grapesjs.init({
            container: containerRef.current,
            // We feed GrapesJS just the body so <head>/<script>/external
            // CSS survive round-trips. The full document is reassembled
            // in emitChange().
            components: parsed.bodyInner || '<div></div>',
            style: '',
            height: '100%',
            width: '100%',
            storageManager: false,
            undoManager: { maximumStackLength: 1000 },
            // Keep the canvas chrome minimal in PR1 — StyleManager /
            // Layers / Blocks panels ship in later PRs.
            panels: { defaults: [] },
            // Avoid GrapesJS shipping its own block panels for now.
            blockManager: { blocks: [] },
            // PR3: StyleManager sectors cover the common CSS surface the
            // built-in InspectPanel doesn't expose (border, shadow, flex,
            // transitions). Properties are declared with `extend: true` so
            // GrapesJS keeps its built-in property views.
            styleManager: {
              showComputed: true,
              highlightComputed: true,
              clearProperties: true,
              avoidComputed: [],
              sectors: [
                {
                  id: 'dimension',
                  name: 'Dimension',
                  properties: [
                    { property: 'width', units: ['px', '%', 'vw'], unit: 'px' },
                    { property: 'height', units: ['px', '%', 'vh'], unit: 'px' },
                    { property: 'min-width', units: ['px', '%'], unit: 'px' },
                    { property: 'max-width', units: ['px', '%'], unit: 'px' },
                    { property: 'margin', units: ['px', '%'], unit: 'px' },
                    { property: 'padding', units: ['px', '%'], unit: 'px' },
                  ],
                },
                {
                  id: 'typography',
                  name: 'Typography',
                  properties: [
                    { property: 'font-family' },
                    { property: 'font-size', units: ['px', 'em', 'rem', '%'], unit: 'px' },
                    {
                      property: 'font-weight',
                      type: 'select',
                      options: ['100','200','300','400','500','600','700','800','900'].map((v) => ({ id: v, label: v })),
                    },
                    { property: 'line-height' },
                    { property: 'letter-spacing', units: ['px','em'], unit: 'px' },
                    {
                      property: 'text-align',
                      type: 'select',
                      options: ['left','center','right','justify'].map((v) => ({ id: v, label: v })),
                    },
                    {
                      property: 'text-decoration',
                      type: 'select',
                      options: ['none','underline','line-through','overline'].map((v) => ({ id: v, label: v })),
                    },
                    {
                      property: 'text-transform',
                      type: 'select',
                      options: ['none','capitalize','uppercase','lowercase'].map((v) => ({ id: v, label: v })),
                    },
                  ],
                },
                {
                  id: 'colors',
                  name: 'Colors',
                  properties: [
                    { property: 'color' },
                    { property: 'background-color' },
                    { property: 'background-image' },
                    { property: 'opacity', type: 'slider', min: 0, max: 1, step: 0.05 },
                  ],
                },
                {
                  id: 'borders',
                  name: 'Borders',
                  properties: [
                    { property: 'border-width', units: ['px'], unit: 'px' },
                    {
                      property: 'border-style',
                      type: 'select',
                      options: ['none','solid','dashed','dotted','double'].map((v) => ({ id: v, label: v })),
                    },
                    { property: 'border-color' },
                    { property: 'border-radius', units: ['px','%'], unit: 'px' },
                  ],
                },
                {
                  id: 'effects',
                  name: 'Effects',
                  properties: [
                    { property: 'box-shadow' },
                    { property: 'transition' },
                    {
                      property: 'cursor',
                      type: 'select',
                      options: ['auto','default','pointer','crosshair','move','text','wait','help','not-allowed'].map((v) => ({ id: v, label: v })),
                    },
                  ],
                },
                {
                  id: 'flex',
                  name: 'Flex',
                  properties: [
                    {
                      property: 'display',
                      type: 'select',
                      options: ['block','inline','inline-block','flex','inline-flex','grid','none'].map((v) => ({ id: v, label: v })),
                    },
                    {
                      property: 'flex-direction',
                      type: 'select',
                      options: ['row','row-reverse','column','column-reverse'].map((v) => ({ id: v, label: v })),
                    },
                    {
                      property: 'justify-content',
                      type: 'select',
                      options: ['flex-start','flex-end','center','space-between','space-around','space-evenly'].map((v) => ({ id: v, label: v })),
                    },
                    {
                      property: 'align-items',
                      type: 'select',
                      options: ['flex-start','flex-end','center','baseline','stretch'].map((v) => ({ id: v, label: v })),
                    },
                    {
                      property: 'flex-wrap',
                      type: 'select',
                      options: ['nowrap','wrap','wrap-reverse'].map((v) => ({ id: v, label: v })),
                    },
                    { property: 'gap', units: ['px','em'], unit: 'px' },
                  ],
                },
                {
                  id: 'position',
                  name: 'Position',
                  properties: [
                    {
                      property: 'position',
                      type: 'select',
                      options: ['static','relative','absolute','fixed','sticky'].map((v) => ({ id: v, label: v })),
                    },
                    { property: 'top', units: ['px','%'], unit: 'px' },
                    { property: 'right', units: ['px','%'], unit: 'px' },
                    { property: 'bottom', units: ['px','%'], unit: 'px' },
                    { property: 'left', units: ['px','%'], unit: 'px' },
                    { property: 'z-index', type: 'integer' },
                  ],
                },
              ],
            },
            plugins: [odStableIdPlugin as Plugin, odResizablePlugin as Plugin],
            pluginsOpts: {
              [odStableIdPluginKey]: { skipHostNodes: true },
              [odResizablePluginKey]: {},
            },
            // Make the iframe canvas match the artifact's natural width
            // rather than GrapesJS's default 1280px device frame.
            devicePreviewMode: true,
            // Hide the built-in per-component action toolbar (move/copy/delete).
            // All of those actions are reachable via keyboard / drag, and the
            // toolbar clutters the selection. Figma-style editors rely on the
            // selection outline + resize handles instead.
            showToolbar: false,
            // Figma-style free-form canvas: infiniteCanvas lets the user pan
            // beyond the document bounds (so zoomed-out / panned views don't
            // clip). We intentionally do NOT enable scrollableCanvas: its
            // native scroll fights our Space/middle-mouse setCoords() pan and
            // snaps the canvas back on keyup. Our own pointer handlers own the
            // pan; a bare wheel inside the canvas scrolls the artifact page.
            canvas: {
              infiniteCanvas: true,
            },
            telemetry: false,
          });

          editorRef.current = editor;
          // Inject theme overrides into the host <head> so they load AFTER
          // GrapesJS's runtime <style> injection and win the cascade. The
          // built-in toolbar + hover badge are disabled at the source
          // (showToolbar:false + custom hover spot below), so we no longer
          // restyle them — only the selection outline, the resize handles,
          // and our own dimension badge.
          try {
            const STYLE_ID = 'od-gjs-theme-override';
            const doc = containerRef.current?.ownerDocument ?? document;
            doc.getElementById(STYLE_ID)?.remove();
            const overrideStyle = doc.createElement('style');
            overrideStyle.id = STYLE_ID;
            overrideStyle.textContent = `
              .gjs-selected, .gjs-hovered { outline-color: var(--accent, #c96442) !important; }
              .gjs-cv-canvas__frame, .gjs-clm-tags { border-color: var(--accent, #c96442) !important; }
              .gjs-resizer-h {
                background-color: #fff !important;
                border: 2px solid var(--gjs-color-blue) !important;
              }
              .od-dimension-badge {
                position: absolute;
                left: 50%;
                bottom: -25px;
                transform: translate(-50%, 100%);
                padding: 1px 6px;
                background: #000;
                color: #fff;
                font-size: 12px;
                line-height: 1.4;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
                border-radius: 3px;
                pointer-events: none;
                z-index: 11;
                display: none;
              }
            `;
            doc.head?.appendChild(overrideStyle);
          } catch { /* ignore */ }
          // Suppress the built-in hover badge (the small "div"/"text" tag at
          // the element's top-left). CommandSelectComponent.updateToolsLocal
          // only renders the badge when there is NO custom 'hover' spot
          // (grapes.mjs:49717-49718). Registering one — even a static one on
          // the wrapper — flips that check and hides the badge globally,
          // without overriding the whole select command. The actual
          // addSpot() call is deferred to `load` (below) so the wrapper
          // component exists; the eager call here may race a cold iframe.
          const applyCurrentCanvasHead = () => {
            applyCanvasHeadAssets(editor.Canvas.getDocument(), parsedRef.current, baseHrefRef.current);
          };

          // Selection dimension badge — a small "W x H" label pinned to the
          // bottom-center of the selected element's tool box (Figma-style).
          // `canvas:tools:update` fires on every selection change, hover,
          // resize tick, scroll, and container resize; its `width`/`height`
          // are zoom-scaled screen px, so we divide by the zoom decimal to
          // show the element's real CSS dimensions. We only act on the
          // `global` type (the actual selection); `local` is hover.
          let dimensionBadge: HTMLDivElement | null = null;
          const ensureDimensionBadge = () => {
            if (dimensionBadge) return dimensionBadge;
            try {
              const toolsEl = (editor.Canvas as unknown as {
                getToolsEl?: (view?: unknown) => HTMLElement | null;
              }).getToolsEl?.();
              if (!toolsEl) return null;
              const hostDoc = toolsEl.ownerDocument;
              const badge = hostDoc.createElement('div');
              badge.className = 'od-dimension-badge';
              badge.setAttribute('aria-hidden', 'true');
              toolsEl.appendChild(badge);
              dimensionBadge = badge;
              return badge;
            } catch {
              return null;
            }
          };
          type ToolsUpdatePayload = { type?: string; width?: number; height?: number };
          const onToolsUpdate = (opts: ToolsUpdatePayload) => {
            if (!opts || opts.type !== 'global') return;
            const badge = ensureDimensionBadge();
            if (!badge) return;
            const w = typeof opts.width === 'number' ? opts.width : 0;
            const h = typeof opts.height === 'number' ? opts.height : 0;
            const zoom = (() => {
              try {
                const z = (editor.Canvas as unknown as { getZoomDecimal?: () => number }).getZoomDecimal?.();
                return typeof z === 'number' && z > 0 ? z : (editor.Canvas.getZoom?.() ?? 100) / 100;
              } catch {
                return 1;
              }
            })();
            const cssW = Math.round(w / zoom);
            const cssH = Math.round(h / zoom);
            badge.textContent = `${cssW} × ${cssH}`;
            badge.style.display = 'block';
          };
          const hideDimensionBadge = () => {
            if (dimensionBadge) dimensionBadge.style.display = 'none';
          };
          editor.on('canvas:tools:update', onToolsUpdate);
          editor.on('component:deselected', hideDimensionBadge);
          editor.on('component:selected', () => {
            // Ensure the badge shows even when tools:update fires before the
            // badge element existed (first selection right after load).
            ensureDimensionBadge();
          });
          // ── Spacing guides: draggable padding / gap / margin overlays ──
          // The visible guide is a thin line while the hit target stays large
          // enough to drag. The striped value band and compact value badge only
          // appear on hover/drag. Gap guides belong to the selected flex
          // container itself and are generated between every adjacent child.
          type SpacingSide = 'top' | 'right' | 'bottom' | 'left';
          type SpacingKind = 'padding' | 'margin' | 'gap';
          type SpacingItem = {
            band: HTMLDivElement;
            handle: HTMLDivElement;
            line: HTMLDivElement;
            prop: string;
            side: SpacingSide;
            kind: SpacingKind;
            index?: number;
            target?: Component;
            value?: number;
          };
          let spacingItems: SpacingItem[] = [];
          let gapSpacingItems: SpacingItem[] = [];
          let spacingTip: HTMLDivElement | null = null;
          let spacingAttached = false;
          let spacingDrag: {
            item: SpacingItem;
            target: Component;
            overlay: HTMLDivElement;
            startX: number;
            startY: number;
            startVal: number;
            zoom: number;
          } | null = null;
          let detachSpacingHandles: (() => void) | null = null;
          const STRIPE: Record<SpacingKind, string> = {
            padding: 'repeating-linear-gradient(45deg, rgba(59,130,246,0.45) 0 2px, rgba(59,130,246,0.10) 2px 6px)',
            margin: 'repeating-linear-gradient(45deg, rgba(234,179,8,0.45) 0 2px, rgba(234,179,8,0.10) 2px 6px)',
            gap: 'repeating-linear-gradient(45deg, rgba(168,85,247,0.45) 0 2px, rgba(168,85,247,0.10) 2px 6px)',
          };
          const SOLID: Record<SpacingKind, string> = { padding: '#3b82f6', margin: '#eab308', gap: '#a855f7' };
          const allSpacingItems = () => [...spacingItems, ...gapSpacingItems];
          const pxOf = (s: string | undefined): number => {
            if (!s) return 0;
            const m = /^(-?[\d.]+)/.exec(s);
            const v = m && m[1] ? parseFloat(m[1]) : 0;
            return Number.isFinite(v) ? v : 0;
          };
          const readSpacingVal = (comp: Component, prop: string): number => {
            const el = getElementFromComponent(comp) as HTMLElement | null;
            const win = el?.ownerDocument.defaultView ?? null;
            if (!el || !win) return 0;
            try { return pxOf(win.getComputedStyle(el).getPropertyValue(prop)); } catch { return 0; }
          };
          const setSpacingRect = (
            node: HTMLElement,
            left: number,
            top: number,
            width: number,
            height: number,
          ) => {
            node.style.left = `${left}px`;
            node.style.top = `${top}px`;
            node.style.width = `${Math.max(0, width)}px`;
            node.style.height = `${Math.max(0, height)}px`;
          };
          const configureSpacingItem = (item: SpacingItem) => {
            const isHorizontal = item.side === 'top' || item.side === 'bottom';
            item.handle.setAttribute('data-od-spacing-handle', item.kind);
            item.handle.setAttribute('data-od-spacing-kind', item.kind);
            item.handle.setAttribute('data-od-spacing-prop', item.prop);
            item.band.setAttribute('data-od-spacing-band', item.kind);
            item.band.setAttribute('data-od-spacing-band-kind', item.kind);
            item.band.setAttribute('data-od-spacing-prop', item.prop);
            if (typeof item.index === 'number') {
              item.handle.setAttribute('data-od-spacing-index', String(item.index));
              item.band.setAttribute('data-od-spacing-index', String(item.index));
            } else {
              item.handle.removeAttribute('data-od-spacing-index');
              item.band.removeAttribute('data-od-spacing-index');
            }
            item.handle.style.cursor = isHorizontal ? 'ns-resize' : 'ew-resize';
            item.line.style.left = isHorizontal ? '0' : '50%';
            item.line.style.top = isHorizontal ? '50%' : '0';
            item.line.style.width = isHorizontal ? '100%' : '1px';
            item.line.style.height = isHorizontal ? '1px' : '100%';
            item.line.style.transform = isHorizontal ? 'translateY(-50%)' : 'translateX(-50%)';
          };
          const showSpacingTip = (item: SpacingItem, clientX?: number, clientY?: number) => {
            if (!spacingTip) return;
            const target = item.target ?? editor.getSelected?.() as Component | undefined;
            if (!target) return;
            const value = item.value ?? readSpacingVal(target, item.prop);
            spacingTip.textContent = String(Math.round(value));
            spacingTip.style.background = SOLID[item.kind];
            spacingTip.style.display = 'block';
            if (typeof clientX === 'number' && typeof clientY === 'number') {
              spacingTip.style.left = `${clientX + 10}px`;
              spacingTip.style.top = `${clientY - 8}px`;
              spacingTip.style.transform = 'translateY(-100%)';
              return;
            }
            const rect = item.handle.getBoundingClientRect();
            spacingTip.style.left = `${rect.left + rect.width / 2}px`;
            spacingTip.style.top = `${rect.top - 4}px`;
            spacingTip.style.transform = 'translate(-50%, -100%)';
          };
          const setSpacingItemActive = (item: SpacingItem, active: boolean) => {
            item.band.style.backgroundImage = active ? STRIPE[item.kind] : 'none';
            if (active) {
              showSpacingTip(item);
            } else if (spacingDrag?.item !== item && spacingTip) {
              spacingTip.style.display = 'none';
            }
          };
          const makeSpacingItem = (
            toolsEl: HTMLElement,
            prop: string,
            side: SpacingSide,
            kind: SpacingKind,
            index?: number,
          ): SpacingItem => {
            const hostDoc = toolsEl.ownerDocument;
            const band = hostDoc.createElement('div');
            band.style.cssText = 'position:absolute;z-index:14;pointer-events:none;display:none;background-image:none;';
            const handle = hostDoc.createElement('div');
            handle.style.cssText = 'position:absolute;z-index:18;display:none;background:transparent;pointer-events:auto;touch-action:none;';
            const line = hostDoc.createElement('div');
            line.style.cssText = `position:absolute;background:${SOLID[kind]};pointer-events:none;`;
            handle.appendChild(line);
            toolsEl.appendChild(band);
            toolsEl.appendChild(handle);
            const item: SpacingItem = { band, handle, line, prop, side, kind, index };
            configureSpacingItem(item);
            handle.addEventListener('mouseenter', () => setSpacingItemActive(item, true));
            handle.addEventListener('mouseleave', () => {
              if (spacingDrag?.item !== item) setSpacingItemActive(item, false);
            });
            return item;
          };
          const ensureSpacingHandles = () => {
            if (spacingAttached) return;
            const toolsEl = (editor.Canvas as unknown as { getToolsEl?: () => HTMLElement | null }).getToolsEl?.();
            if (!toolsEl) return;
            const hostDoc = toolsEl.ownerDocument;
            spacingTip = hostDoc.createElement('div');
            spacingTip.setAttribute('data-od-spacing-tip', 'true');
            spacingTip.style.cssText = 'position:fixed;z-index:2147483647;min-width:16px;padding:1px 4px;border-radius:2px;background:#111;color:#fff;font:600 10px/1.4 system-ui;text-align:center;pointer-events:none;display:none;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25);';
            hostDoc.body.appendChild(spacingTip);
            spacingItems = [
              makeSpacingItem(toolsEl, 'padding-top', 'top', 'padding'),
              makeSpacingItem(toolsEl, 'padding-bottom', 'bottom', 'padding'),
              makeSpacingItem(toolsEl, 'padding-left', 'left', 'padding'),
              makeSpacingItem(toolsEl, 'padding-right', 'right', 'padding'),
              makeSpacingItem(toolsEl, 'margin-top', 'top', 'margin'),
              makeSpacingItem(toolsEl, 'margin-bottom', 'bottom', 'margin'),
              makeSpacingItem(toolsEl, 'margin-left', 'left', 'margin'),
              makeSpacingItem(toolsEl, 'margin-right', 'right', 'margin'),
            ];
            spacingAttached = true;
            // Capture on the host document. The GrapesJS canvas element is an
            // ancestor of the tools layer, so a toolsEl capture listener is too
            // late: the canvas already saw pointerdown and started its component
            // drag. document capture runs before that ancestor.
            const onHostPointerDown = (ev: PointerEvent) => {
              const target = (ev.target as Element | null)?.closest?.('[data-od-spacing-kind]') as HTMLDivElement | null;
              if (!target) return;
              const item = allSpacingItems().find((candidate) => candidate.handle === target);
              if (!item) return;
              onSpacingDragStart(ev, item);
            };
            hostDoc.addEventListener('pointerdown', onHostPointerDown, true);
            detachSpacingHandles = () => {
              hostDoc.removeEventListener('pointerdown', onHostPointerDown, true);
              for (const item of allSpacingItems()) {
                item.band.remove();
                item.handle.remove();
              }
              spacingItems = [];
              gapSpacingItems = [];
              spacingTip?.remove();
              spacingTip = null;
              closeSpacingInputEditor();
              spacingAttached = false;
            };
          };
          const positionSpacingHandles = () => {
            ensureSpacingHandles();
            if (!spacingAttached) return;
            const toolsEl = (editor.Canvas as unknown as { getToolsEl?: () => HTMLElement | null }).getToolsEl?.();
            const sel = editor.getSelected?.() as Component | undefined;
            for (const item of allSpacingItems()) {
              item.band.style.display = 'none';
              item.handle.style.display = 'none';
              item.target = undefined;
              item.value = undefined;
              if (spacingDrag?.item !== item) item.band.style.backgroundImage = 'none';
            }
            if (!sel || !toolsEl) return;
            const el = getElementFromComponent(sel) as HTMLElement | null;
            const win = el?.ownerDocument.defaultView ?? null;
            if (!el || !win) return;
            const zoom = (() => {
              const z = (editor.Canvas as unknown as { getZoomDecimal?: () => number }).getZoomDecimal?.();
              return typeof z === 'number' && z > 0 ? z : (editor.Canvas.getZoom?.() ?? 100) / 100;
            })();
            let cs: CSSStyleDeclaration;
            try { cs = win.getComputedStyle(el); } catch { return; }
            const boxW = toolsEl.clientWidth;
            const boxH = toolsEl.clientHeight;
            const GUIDE_LENGTH = 24;
            const HIT_THICKNESS = 8;
            const layoutSide = (
              item: SpacingItem,
              cssValue: number,
              bandLeft: number, bandTop: number, bandW: number, bandH: number,
              guideX: number, guideY: number,
            ) => {
              item.target = sel;
              item.value = cssValue;
              configureSpacingItem(item);
              setSpacingRect(item.band, bandLeft, bandTop, bandW, bandH);
              const isHorizontal = item.side === 'top' || item.side === 'bottom';
              setSpacingRect(
                item.handle,
                guideX - (isHorizontal ? GUIDE_LENGTH / 2 : HIT_THICKNESS / 2),
                guideY - (isHorizontal ? HIT_THICKNESS / 2 : GUIDE_LENGTH / 2),
                isHorizontal ? GUIDE_LENGTH : HIT_THICKNESS,
                isHorizontal ? HIT_THICKNESS : GUIDE_LENGTH,
              );
              item.band.style.display = 'block';
              item.handle.style.display = 'block';
            };
            const pTCss = Math.max(0, pxOf(cs.paddingTop));
            const pBCss = Math.max(0, pxOf(cs.paddingBottom));
            const pLCss = Math.max(0, pxOf(cs.paddingLeft));
            const pRCss = Math.max(0, pxOf(cs.paddingRight));
            const mTCss = Math.max(0, pxOf(cs.marginTop));
            const mBCss = Math.max(0, pxOf(cs.marginBottom));
            const mLCss = Math.max(0, pxOf(cs.marginLeft));
            const mRCss = Math.max(0, pxOf(cs.marginRight));
            const pT = pTCss * zoom;
            const pB = pBCss * zoom;
            const pL = pLCss * zoom;
            const pR = pRCss * zoom;
            const mT = mTCss * zoom;
            const mB = mBCss * zoom;
            const mL = mLCss * zoom;
            const mR = mRCss * zoom;
            for (const it of spacingItems) {
              if (it.kind === 'padding') {
                if (it.side === 'top') layoutSide(it, pTCss, 0, 0, boxW, pT, boxW / 2, pT);
                else if (it.side === 'bottom') layoutSide(it, pBCss, 0, boxH - pB, boxW, pB, boxW / 2, boxH - pB);
                else if (it.side === 'left') layoutSide(it, pLCss, 0, 0, pL, boxH, pL, boxH / 2);
                else layoutSide(it, pRCss, boxW - pR, 0, pR, boxH, boxW - pR, boxH / 2);
              } else {
                // Margin guide lines sit OUTSIDE the border box by ~10px so they
                // don't overlap the selection outline even when margin is 0.
                if (it.side === 'top') layoutSide(it, mTCss, -mL, -mT, boxW + mL + mR, mT, boxW / 2, -mT - 10);
                else if (it.side === 'bottom') layoutSide(it, mBCss, -mL, boxH, boxW + mL + mR, mB, boxW / 2, boxH + mB + 10);
                else if (it.side === 'left') layoutSide(it, mLCss, -mL, -mT, mL, boxH + mT + mB, -mL - 10, boxH / 2);
                else layoutSide(it, mRCss, boxW, -mT, mR, boxH + mT + mB, boxW + mR + 10, boxH / 2);
              }
            }

            const display = cs.getPropertyValue('display');
            if (display !== 'flex' && display !== 'inline-flex') return;
            const isColumn = cs.getPropertyValue('flex-direction').startsWith('column');
            const containerRect = el.getBoundingClientRect();
            const childRects = Array.from(el.children)
              .map((child) => child.getBoundingClientRect())
              .filter((rect) => rect.width > 0 && rect.height > 0)
              .sort((a, b) => isColumn ? a.top - b.top : a.left - b.left);
            const requiredGapItems = Math.max(0, childRects.length - 1);
            while (gapSpacingItems.length < requiredGapItems) {
              const index = gapSpacingItems.length;
              gapSpacingItems.push(makeSpacingItem(
                toolsEl,
                'gap',
                isColumn ? 'bottom' : 'right',
                'gap',
                index,
              ));
            }
            const gapCss = Math.max(0, pxOf(cs.getPropertyValue('gap')));
            for (let index = 0; index < requiredGapItems; index += 1) {
              const first = childRects[index];
              const second = childRects[index + 1];
              const item = gapSpacingItems[index];
              if (!first || !second || !item) continue;
              item.side = isColumn ? 'bottom' : 'right';
              item.index = index;
              item.target = sel;
              item.value = gapCss;
              configureSpacingItem(item);
              if (isColumn) {
                const gapStart = (first.bottom - containerRect.top) * zoom;
                const gapEnd = (second.top - containerRect.top) * zoom;
                const crossStart = (Math.max(first.left, second.left) - containerRect.left) * zoom;
                const crossEnd = (Math.min(first.right, second.right) - containerRect.left) * zoom;
                const guideX = (crossStart + crossEnd) / 2;
                const guideY = (gapStart + gapEnd) / 2;
                setSpacingRect(item.band, crossStart, gapStart, Math.max(0, crossEnd - crossStart), Math.max(0, gapEnd - gapStart));
                setSpacingRect(item.handle, guideX - GUIDE_LENGTH / 2, guideY - HIT_THICKNESS / 2, GUIDE_LENGTH, HIT_THICKNESS);
              } else {
                const gapStart = (first.right - containerRect.left) * zoom;
                const gapEnd = (second.left - containerRect.left) * zoom;
                const crossStart = (Math.max(first.top, second.top) - containerRect.top) * zoom;
                const crossEnd = (Math.min(first.bottom, second.bottom) - containerRect.top) * zoom;
                const guideX = (gapStart + gapEnd) / 2;
                const guideY = (crossStart + crossEnd) / 2;
                setSpacingRect(item.band, gapStart, crossStart, Math.max(0, gapEnd - gapStart), Math.max(0, crossEnd - crossStart));
                setSpacingRect(item.handle, guideX - HIT_THICKNESS / 2, guideY - GUIDE_LENGTH / 2, HIT_THICKNESS, GUIDE_LENGTH);
              }
              item.band.style.display = 'block';
              item.handle.style.display = 'block';
            }
          };
          const hideSpacingHandles = () => {
            for (const item of allSpacingItems()) {
              item.band.style.display = 'none';
              item.handle.style.display = 'none';
              item.band.style.backgroundImage = 'none';
            }
            if (spacingTip) spacingTip.style.display = 'none';
          };
          // A single host-doc-level editor for the spacing "click to type"
          // popup. Only one value can be edited at a time, so we keep one
          // floating <input> and re-anchor it to whichever guide handle the
          // user clicked. Stored on the boot-effect closure so the detach
          // path below can remove it on teardown.
          let spacingInputEditor: HTMLDivElement | null = null;
          const closeSpacingInputEditor = () => {
            if (spacingInputEditor) {
              spacingInputEditor.remove();
              spacingInputEditor = null;
            }
          };
          // Open the click-to-edit popup for a spacing guide. Anchor it next
          // to the handle and pre-fill the current value. Typing commits
          // live (input/change), Enter/blur commits + closes, Escape closes
          // without rollback (changes were already applied live).
          const openSpacingInputEditor = (
            item: SpacingItem,
            target: Component,
            anchorScreenX: number,
            anchorScreenY: number,
          ) => {
            const hostDoc = item.handle.ownerDocument;
            const hostWindow = hostDoc.defaultView;
            if (!hostWindow) return;
            closeSpacingInputEditor();
            const wrap = hostDoc.createElement('div');
            wrap.setAttribute('data-od-spacing-input', 'true');
            wrap.style.cssText = 'position:fixed;z-index:2147483647;display:flex;align-items:center;gap:2px;padding:3px;background:#111;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.28);';
            const input = hostDoc.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.step = '1';
            input.value = String(Math.round(readSpacingVal(target, item.prop)));
            input.style.cssText = 'width:80px;padding:2px 4px;border-radius:4px;background:#000;color:#fff;font:600 12px/1.4 system-ui;text-align:center;outline:none;-moz-appearance:textfield;box-shadow:0 2px 8px rgba(0,0,0,.28);';
            // Hide the native number spinners — they steal vertical pixel space
            // and fight the value entry.
            const hideSpin = hostDoc.createElement('style');
            hideSpin.textContent = 'input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}';
            wrap.appendChild(hideSpin);
            wrap.appendChild(input);
            hostDoc.body.appendChild(wrap);
            spacingInputEditor = wrap;
            // Anchor to the right of the click point; fall above if it would
            // overflow the right edge.
            const anchorLeft = anchorScreenX + 8;
            const w = 80;
            const maxLeft = hostWindow.innerWidth - w - 4;
            wrap.style.left = `${Math.min(anchorLeft, Math.max(4, maxLeft))}px`;
            wrap.style.top = `${Math.max(4, anchorScreenY - 14)}px`;
            const apply = (raw: string) => {
              const parsed = Math.max(0, Math.round(Number(raw)));
              const v = Number.isFinite(parsed) ? parsed : 0;
              try {
                const merged = { ...(target.getStyle?.() ?? {}) } as Record<string, string>;
                merged[item.prop] = `${v}px`;
                target.setStyle(merged as Parameters<typeof target.setStyle>[0]);
                refreshSelectionSnapshotRef.current?.();
                editor.refresh({ tools: true });
                positionSpacingHandles();
              } catch { /* ignore */ }
            };
            const commit = () => {
              apply(input.value);
              closeSpacingInputEditor();
              scheduleEmitRef.current?.();
            };
            input.addEventListener('input', () => apply(input.value));
            input.addEventListener('change', () => apply(input.value));
            input.addEventListener('keydown', (ke: KeyboardEvent) => {
              if (ke.key === 'Enter') { ke.preventDefault(); commit(); }
              else if (ke.key === 'Escape') { ke.preventDefault(); closeSpacingInputEditor(); }
              ke.stopPropagation();
            });
            input.addEventListener('blur', commit);
            // Stop pointer events on the popup from leaking into the canvas
            // (which would deselect / reselect and hide the handles).
            wrap.addEventListener('pointerdown', (pe) => { pe.stopPropagation(); });
            hostWindow.requestAnimationFrame(() => { input.focus(); input.select(); });
          };
          const onSpacingDragStart = (ev: PointerEvent, item: SpacingItem) => {
            if (readOnlyRef.current || cropModeRef.current) return;
            // A click that opens the input popup would be confusing if one is
            // already open — close it first so the new handle's value wins.
            closeSpacingInputEditor();
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            const target = item.target ?? editor.getSelected?.() as Component | undefined;
            if (!target) return;
            const startVal = readSpacingVal(target, item.prop);
            const zoom = (() => {
              const z = (editor.Canvas as unknown as { getZoomDecimal?: () => number }).getZoomDecimal?.();
              return typeof z === 'number' && z > 0 ? z : (editor.Canvas.getZoom?.() ?? 100) / 100;
            })();
            const hostDoc = item.handle.ownerDocument;
            const hostWindow = hostDoc.defaultView;
            if (!hostWindow) return;
            const overlay = hostDoc.createElement('div');
            overlay.setAttribute('data-od-spacing-drag-overlay', 'true');
            overlay.style.cssText = `position:fixed;inset:0;z-index:2147483646;cursor:${item.handle.style.cursor};background:transparent;touch-action:none;`;
            hostDoc.body.appendChild(overlay);
            spacingDrag = { item, target, overlay, startX: ev.clientX, startY: ev.clientY, startVal, zoom };
            setSpacingItemActive(item, true);
            const dragSign = item.kind === 'gap'
              ? 1
              : item.kind === 'padding'
                ? (item.side === 'top' || item.side === 'left' ? 1 : -1)
                : (item.side === 'bottom' || item.side === 'right' ? 1 : -1);
            // Track whether the pointer crossed the drag threshold. A press
            // that stays within the threshold is a "click" → open the input
            // popup; a press that exceeds it is a drag → live-edit the value.
            const CLICK_THRESHOLD_PX = 5;
            let moved = false;
            const move = (me: PointerEvent) => {
              const d = spacingDrag;
              if (!d) return;
              me.preventDefault();
              me.stopPropagation();
              const dxMove = me.clientX - d.startX;
              const dyMove = me.clientY - d.startY;
              if (!moved && Math.hypot(dxMove, dyMove) < CLICK_THRESHOLD_PX) return;
              moved = true;
              const horizontal = d.item.side === 'left' || d.item.side === 'right';
              const rawDelta = horizontal ? dxMove : dyMove;
              const next = Math.max(0, Math.round(d.startVal + (rawDelta / d.zoom) * dragSign));
              d.item.value = next;
              showSpacingTip(d.item, me.clientX, me.clientY);
              try {
                const merged = { ...(d.target.getStyle?.() ?? {}) } as Record<string, string>;
                merged[d.item.prop] = `${next}px`;
                d.target.setStyle(merged as Parameters<typeof d.target.setStyle>[0]);
                refreshSelectionSnapshotRef.current?.();
                editor.refresh({ tools: true });
                positionSpacingHandles();
              } catch { /* ignore */ }
            };
            const up = (ue: PointerEvent) => {
              const d = spacingDrag;
              spacingDrag = null;
              if (spacingTip) spacingTip.style.display = 'none';
              if (d) {
                d.item.band.style.backgroundImage = 'none';
                d.overlay.remove();
              }
              hostWindow.removeEventListener('pointermove', move, true);
              hostWindow.removeEventListener('pointerup', up, true);
              hostWindow.removeEventListener('pointercancel', up, true);
              // Click (no drag) → open the numeric input popup. The drag
              // path already wrote each move, so a drag commit just emits.
              if (!moved && d) {
                openSpacingInputEditor(d.item, d.target, ue.clientX, ue.clientY);
                return;
              }
              scheduleEmitRef.current?.();
            };
            hostWindow.addEventListener('pointermove', move, true);
            hostWindow.addEventListener('pointerup', up, true);
            hostWindow.addEventListener('pointercancel', up, true);
          };
          editor.on('canvas:tools:update', (opts: { type?: string }) => {
            if (opts && opts.type === 'global') positionSpacingHandles();
          });
          editor.on('component:deselected', hideSpacingHandles);
          editor.on('component:selected', () => {
            // Opening a new selection should not leave a stale value popup
            // from the previous element's spacing guide.
            closeSpacingInputEditor();
            ensureSpacingHandles();
            positionSpacingHandles();
          });
          // NOTE: we intentionally do NOT install a capture-phase click
          // interceptor on the canvas document. GrapesJS's own click → select
          // pipeline (including its native selection box, resize handles, and
          // the StyleManager target sync) is the source of truth here; an
          // earlier custom interceptor called preventDefault/stopPropagation
          // before GrapesJS could run, which masked the native selection
          // activation. If a future feature needs to enrich canvas clicks, do
          // it by listening to `component:selected` instead of hijacking the
          // raw event.
          editor.on('canvas:frame:load:head', applyCurrentCanvasHead);
          editor.on('canvas:frame:load:body', applyCurrentCanvasHead);
          applyCurrentCanvasHead();
          // Restore persisted canvas size (saved via setCanvasSize) from the
          // document <html> data attributes so it survives reload / file switch.
          try {
            const bootDoc = editor.Canvas.getDocument?.();
            const bootRoot = bootDoc?.documentElement;
            const savedW = bootRoot?.getAttribute('data-od-canvas-width');
            const savedH = bootRoot?.getAttribute('data-od-canvas-height');
            const bootFrame = editor.Canvas.getFrameEl?.();
            if (bootFrame) {
              if (savedW) bootFrame.style.width = `${savedW}px`;
              if (savedH) bootFrame.style.height = `${savedH}px`;
            }
          } catch { /* ignore */ }

          editor.on('load', () => {
            if (disposed) return;
            applyCurrentCanvasHead();
            setLoading(false);
            // Register a custom 'hover' spot so CommandSelectComponent skips
            // rendering the built-in hover badge (see comment above the init
            // style block). Done on load so the wrapper component exists.
            try {
              const root = editor.Components.getComponents().get?.(0);
              (editor.Canvas as unknown as {
                addSpot?: (spot: { type: string; component?: unknown }) => void;
              }).addSpot?.({ type: 'hover', component: root });
            } catch { /* ignore — badge suppression is best-effort */ }
            // PR2: tag the canvas iframe so PreviewDrawOverlay's
            // snapshotHostIframe fallback chain finds it on the GrapesJS
            // path (no srcdoc/url-load iframe is mounted there).
            try {
              const frame = editor.Canvas.getFrameEl();
              if (frame) {
                frame.setAttribute('data-od-active', 'true');
                frame.setAttribute('data-od-render-mode', 'grapesjs');
              }
            } catch {
              // ignore — non-fatal, snapshot just falls back to first iframe
            }
            if (readOnlyRef.current) {
              try {
                editor.runCommand('core:preview');
              } catch {
                // ignore
              }
            }
            // PR3: render Layers / StyleManager panels into host-provided
            // containers. The host owns the containers' position and
            // visibility; we just hand GrapesJS's rendered root over.
            try {
              if (layersPanelRef?.current) {
                const layersEl = editor.Layers.render();
                layersPanelRef.current.replaceChildren(layersEl);
              }
            } catch {
              // ignore — non-fatal, panel stays empty
            }
            try {
              if (stylePanelRef?.current) {
                const styleEl = editor.StyleManager.render();
                stylePanelRef.current.replaceChildren(styleEl);
              }
            } catch {
              // ignore — non-fatal, panel stays empty
            }
            // The frame body is guaranteed loaded by the time `load` fires, so
            // attach the interactive-mode link-unblock handler here (the eager
            // applyLinkUnblockState() below may race a not-yet-loaded frame and
            // silently no-op).
            applyLinkUnblockState();
          });

          // Figma-style canvas navigation. GrapesJS 0.23 ships the primitives
          // (Canvas.setZoom / setCoords / fitViewport) but no default key/mouse
          // bindings for them, so we wire the conventional affordances:
          //   • Ctrl/Cmd + wheel  → zoom toward the cursor
          //   • Cmd/Ctrl + 0      → reset zoom to 100%
          //   • Cmd/Ctrl + 9      → fit content to viewport
          //   • Space (held) + drag, OR middle-mouse drag → pan the canvas
          // We attach to the editor's outer canvas element (not the iframe
          // body) so the gestures don't conflict with text editing or link
          // clicks inside the artifact. The Space key is tracked globally so
          // the cursor flips to grab even before the mouse is over the canvas.
          const ZOOM_MIN = 25;
          const ZOOM_MAX = 300;
          // Sensitivity deliberately on the higher side: the user reported the
          // Cmd+wheel zoom step felt too small. 0.004 ≈ 3.3× the previous
          // 0.0012, so a normal wheel tick produces a clearly-visible zoom
          // change. MAX_WHEEL_DELTA_PER_EVENT is raised in step so fast/large
          // wheel events aren't clamped back to a small effective delta.
          const ZOOM_SENSITIVITY = 0.004;
          const MAX_WHEEL_DELTA_PER_EVENT = 60;
          const canvasEl = (() => {
            try {
              return editor.Canvas.getElement?.() ?? containerRef.current;
            } catch {
              return containerRef.current;
            }
          })();

          const spaceDownRef = { current: false };
          // Mirror the live canvas zoom onto the container as a data attribute.
          // This is a cheap observability hook (no DOM layout, no React state):
          // tests can assert the user-visible zoom without reaching into
          // GrapesJS internals, and a future status bar can read it directly.
          const syncZoomAttr = () => {
            try {
              const z = editor.Canvas.getZoom?.();
              if (typeof z === 'number') {
                if (rootRef.current) {
                  rootRef.current.dataset.odCanvasZoom = String(Number(z.toFixed(3)));
                }
                onZoomChangeRef.current?.(z);
              }
            } catch {
              // ignore
            }
          };
          // Mirror the canvas pan offset too, so tests can assert the pan
          // survives keyup (the "弹回原位" regression) without reaching into
          // GrapesJS internals.
          const syncCoordsAttr = () => {
            try {
              const c = editor.Canvas.getCoords?.();
              if (c && rootRef.current) {
                const x = typeof c.x === 'number' ? Math.round(c.x) : 0;
                const y = typeof c.y === 'number' ? Math.round(c.y) : 0;
                rootRef.current.dataset.odCanvasCoords = `${x},${y}`;
              }
            } catch {
              // ignore
            }
          };
          type ForwardedCanvasEvent = Event & { _parentEvent?: Event };
          const consumeCanvasEvent = (ev: Event) => {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            const parentEvent = (ev as ForwardedCanvasEvent)._parentEvent;
            parentEvent?.preventDefault();
            parentEvent?.stopPropagation();
            parentEvent?.stopImmediatePropagation();
          };
          const canvasEventClientPoint = (
            ev: MouseEvent | PointerEvent | WheelEvent,
            zoom: number,
          ) => {
            const parentEvent = (ev as ForwardedCanvasEvent)._parentEvent;
            if (!parentEvent) return { x: ev.clientX, y: ev.clientY };
            const frameRect = (ev.target as Element | null)?.getBoundingClientRect?.();
            if (!frameRect) return { x: ev.clientX, y: ev.clientY };
            const scale = zoom / 100;
            return {
              x: frameRect.left + ev.clientX * scale,
              y: frameRect.top + ev.clientY * scale,
            };
          };
          syncZoomAttr();
          syncCoordsAttr();
          editor.on('canvas:zoom', () => { syncZoomAttr(); syncCoordsAttr(); });
          syncZoomAttrRef.current = syncZoomAttr;
          syncCoordsAttrRef.current = syncCoordsAttr;
          const onKeyDownCanvas = (ev: KeyboardEvent) => {
            // Never hijack keys while the user is typing in an input / the
            // GrapesJS text-edit overlay (contenteditable) — those own the
            // keystroke for editing.
            if (isTextInputTarget(ev.target)) return;
            if (ev.code === 'Space') {
              // preventDefault is essential: the browser's default for Space
              // is to scroll the page/canvas. With scrollableCanvas enabled
              // that native scroll fights our setCoords() pan and snaps the
              // canvas back to its origin on keyup — the "弹回原位" symptom.
              // Suppressing the default lets our pointer-driven pan own the
              // position entirely.
              ev.preventDefault();
              // Ignore key-repeat (held Space fires repeated keydown events);
              // only the first should flip the cursor / start the pan modifier.
              if (ev.repeat) return;
              spaceDownRef.current = true;
              ensurePanOverlay();
              updatePanCursor();
              return;
            }
            // Esc clears the current selection (Figma-style). GrapesJS doesn't
            // bind Esc by default when the canvas focus is inside the iframe,
            // so we drive it explicitly.
            if (ev.key === 'Escape') {
              try {
                const sel = editor.getSelected?.();
                if (sel) {
                  ev.preventDefault();
                  editor.select(undefined);
                }
              } catch {
                // ignore
              }
              return;
            }
            // Delete / Backspace removes the selected component(s). Guard with
            // a modifier-free check so we don't swallow Cmd+Backspace (browser
            // navigation) or Cmd+Delete.
            if (
              !readOnlyRef.current &&
              !ev.metaKey &&
              !ev.ctrlKey &&
              !ev.altKey &&
              (ev.key === 'Delete' || ev.key === 'Backspace')
            ) {
              try {
                const all = editor.getSelectedAll?.() ?? [];
                if (all.length > 0) {
                  ev.preventDefault();
                  all.forEach((c: unknown) => {
                    try {
                      (c as Component).remove?.();
                    } catch {
                      // ignore — some components (wrapper) can't be removed
                    }
                  });
                  editor.select(undefined);
                }
              } catch {
                // ignore
              }
              return;
            }
            // Undo / Redo. GrapesJS 0.23's UndoManager has NO default keyboard
            // binding — core:undo / core:redo commands exist but nothing maps
            // a key combo to them. Wire the standard shortcuts:
            //   Cmd/Ctrl+Z        → undo
            //   Cmd/Ctrl+Shift+Z  → redo (Mac convention)
            //   Cmd/Ctrl+Y        → redo (Windows convention)
            if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && (ev.key === 'z' || ev.key === 'Z')) {
              ev.preventDefault();
              try {
                if (ev.shiftKey) editor.runCommand('core:redo');
                else editor.runCommand('core:undo');
              } catch { /* ignore */ }
              return;
            }
            if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && (ev.key === 'y' || ev.key === 'Y')) {
              ev.preventDefault();
              try {
                editor.runCommand('core:redo');
              } catch { /* ignore */ }
              return;
            }
            if ((ev.metaKey || ev.ctrlKey) && (ev.key === '0' || ev.key === 'Equal')) {
              ev.preventDefault();
              try {
                editor.Canvas.setZoom(100);
                editor.Canvas.setCoords(0, 0);
                syncZoomAttr();
                syncCoordsAttr();
              } catch {
                // ignore
              }
            }
            if ((ev.metaKey || ev.ctrlKey) && ev.key === '9') {
              ev.preventDefault();
              try {
                editor.Canvas.fitViewport({ zoom: (z) => Math.min(z, 100) });
                syncZoomAttr();
                syncCoordsAttr();
              } catch {
                // ignore
              }
            }
          };
          const onKeyUpCanvas = (ev: KeyboardEvent) => {
            if (ev.code === 'Space') {
              // Suppress the keyup default too, since some browsers fire a
              // scroll/activation on Space release.
              if (!isTextInputTarget(ev.target)) ev.preventDefault();
              spaceDownRef.current = false;
              if (panning && panMode === 'space') finishPan();
              else if (!panning) removePanOverlay();
              updatePanCursor();
            }
          };
          const onKeyPressCanvas = (ev: KeyboardEvent) => {
            if (ev.code !== 'Space' || isTextInputTarget(ev.target)) return;
            consumeCanvasEvent(ev);
          };
          const onWheelCanvas = (ev: WheelEvent) => {
            // In 裁剪 mode the canvas wheel owns background-size scaling; the
            // crop handler (capture phase on the canvas doc) already swallows
            // the event for the selected element. Bail out here so the board
            // never zooms/pans while cropping.
            if (cropModeRef.current) return;
            // Only zoom when the modifier is held — a bare wheel inside the
            // canvas should scroll the artifact page (the natural expectation
            // for reading a tall HTML doc).
            if (!(ev.metaKey || ev.ctrlKey)) return;
            consumeCanvasEvent(ev);
            try {
              const current = editor.Canvas.getZoom?.() ?? 100;
              const deltaModeScale = ev.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? 16
                : ev.deltaMode === WheelEvent.DOM_DELTA_PAGE
                  ? Math.max(1, canvasEl?.clientHeight ?? 100)
                  : 1;
              const deltaPixels = ev.deltaY * deltaModeScale;
              const boundedDelta = Math.max(
                -MAX_WHEEL_DELTA_PER_EVENT,
                Math.min(MAX_WHEEL_DELTA_PER_EVENT, deltaPixels),
              );
              const factor = Math.exp(-boundedDelta * ZOOM_SENSITIVITY);
              const next = Math.min(
                ZOOM_MAX,
                Math.max(ZOOM_MIN, Number((current * factor).toFixed(3))),
              );
              if (next === current) return;
              // GrapesJS stores canvas coords relative to the viewport center.
              // Normalize forwarded iframe events into host coordinates, then
              // preserve the canvas-space point under the cursor.
              const canvasRect = canvasEl?.getBoundingClientRect();
              const coords = editor.Canvas.getCoords?.() ?? { x: 0, y: 0 };
              const oldX = typeof coords.x === 'number' ? coords.x : 0;
              const oldY = typeof coords.y === 'number' ? coords.y : 0;
              if (canvasRect) {
                const point = canvasEventClientPoint(ev, current);
                const cx = point.x - canvasRect.left - canvasRect.width / 2;
                const cy = point.y - canvasRect.top - canvasRect.height / 2;
                const ratio = next / current;
                const newX = cx - (cx - oldX) * ratio;
                const newY = cy - (cy - oldY) * ratio;
                // Set coords BEFORE zoom so updateFramesArea renders the final
                // state in one pass (setZoom triggers updateFramesArea which
                // reads coords; if we set zoom first with old coords, there's
                // a one-frame visual jump toward the origin).
                editor.Canvas.setCoords(newX, newY);
                editor.Canvas.setZoom(next);
              } else {
                editor.Canvas.setZoom(next);
              }
              syncZoomAttr();
              syncCoordsAttr();
            } catch {
              // ignore
            }
          };

          // Pan via an overlay layer. When Space is held or middle-mouse is
          // pressed, we insert a transparent <div> that covers the canvas and
          // sits above the iframe + GrapesJS tool layer. This physically
          // intercepts ALL pointer events so GrapesJS's own canvas drag /
          // selection / scroll handlers never fire during a pan — the root
          // cause of the in-canvas flicker. The overlay is removed on
          // pointerup / Space-release.
          let panning = false;
          let panMode: 'middle' | 'space' | null = null;
          let panStartX = 0;
          let panStartY = 0;
          let panOriginX = 0;
          let panOriginY = 0;
          let panOverlay: HTMLDivElement | null = null;
          let restorePointerEventsTimer: number | null = null;
          const updatePanCursor = () => {
            const active = panning || spaceDownRef.current;
            if (canvasEl) canvasEl.style.cursor = active ? (panning ? 'grabbing' : 'grab') : '';
            if (panOverlay) panOverlay.style.cursor = panning ? 'grabbing' : 'grab';
          };
          // Disable pointer events on the GrapesJS canvas element entirely
          // during pan. This is the definitive fix for in-canvas flicker:
          // with pointer-events:none, GrapesJS's canvas drag / selection /
          // autoscroll handlers CANNOT fire — the overlay owns all input.
          const setCanvasPointerEvents = (enabled: boolean) => {
            if (canvasEl) canvasEl.style.pointerEvents = enabled ? '' : 'none';
          };
          const removePanOverlay = () => {
            if (panOverlay) {
              panOverlay.remove();
              panOverlay = null;
            }
            // Defer restoring canvas pointer-events by one frame. Removing the
            // overlay while the cursor is over the canvas can deliver a burst
            // of pointerenter/pointermove to GrapesJS, which re-triggers its
            // drag/scroll handlers and snaps the canvas back to its last-known
            // pre-pan position. The 1-frame delay lets the browser settle
            // pointer state before GrapesJS sees input again.
            if (restorePointerEventsTimer) clearTimeout(restorePointerEventsTimer);
            restorePointerEventsTimer = window.setTimeout(() => {
              restorePointerEventsTimer = null;
              setCanvasPointerEvents(true);
            }, 16);
          };
          const ensurePanOverlay = () => {
            if (panOverlay || !canvasEl) return;
            if (restorePointerEventsTimer) {
              clearTimeout(restorePointerEventsTimer);
              restorePointerEventsTimer = null;
            }
            // Kill pointer events on the canvas FIRST, so even the initial
            // middle-click doesn't leak through to GrapesJS.
            setCanvasPointerEvents(false);
            const host = canvasEl.parentElement ?? canvasEl;
            const overlay = host.ownerDocument.createElement('div');
            overlay.setAttribute('data-od-pan-overlay', 'true');
            overlay.style.cssText = 'position:absolute;inset:0;z-index:9999;cursor:grab;background:transparent;';
            overlay.addEventListener('pointerdown', onPointerDown);
            host.appendChild(overlay);
            panOverlay = overlay;
          };
          const onPointerDown = (ev: PointerEvent) => {
            // 裁剪 mode owns the canvas drag; suppress middle/space panning so
            // it doesn't fight the background-position drag.
            if (cropModeRef.current) return;
            const isMiddle = ev.button === 1;
            const isSpacePan = spaceDownRef.current && ev.button === 0;
            if (!isMiddle && !isSpacePan) return;
            consumeCanvasEvent(ev);
            panning = true;
            panMode = isMiddle ? 'middle' : 'space';
            ensurePanOverlay();
            try {
              const coords = editor.Canvas.getCoords?.() ?? { x: 0, y: 0 };
              panOriginX = typeof coords.x === 'number' ? coords.x : 0;
              panOriginY = typeof coords.y === 'number' ? coords.y : 0;
            } catch {
              panOriginX = 0;
              panOriginY = 0;
            }
            const point = canvasEventClientPoint(ev, editor.Canvas.getZoom?.() ?? 100);
            panStartX = point.x;
            panStartY = point.y;
            updatePanCursor();
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp, { once: true });
          };
          const onPointerMove = (ev: PointerEvent) => {
            if (!panning) return;
            ev.preventDefault();
            const point = canvasEventClientPoint(ev, editor.Canvas.getZoom?.() ?? 100);
            const dx = point.x - panStartX;
            const dy = point.y - panStartY;
            try {
              editor.Canvas.setCoords(panOriginX + dx, panOriginY + dy);
              syncCoordsAttr();
            } catch {
              // ignore
            }
          };
          const finishPan = () => {
            if (!panning) return;
            panning = false;
            panMode = null;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            // Keep the overlay + pointer-events:none if Space is still held
            // (so the user can pan again without re-triggering GrapesJS).
            // Only restore canvas pointer events when BOTH pan and space end.
            if (!spaceDownRef.current) {
              removePanOverlay();
            }
            syncCoordsAttr();
            updatePanCursor();
          };
          function onPointerUp() {
            finishPan();
          }
          const onContextMenuBlock = (ev: MouseEvent) => {
            // Middle-mouse pan fires a context menu on release in some
            // browsers; suppress it only while/after panning.
            if (panning || spaceDownRef.current) ev.preventDefault();
          };

          if (canvasEl) {
            canvasEl.addEventListener('wheel', onWheelCanvas, { capture: true, passive: false });
            canvasEl.addEventListener('pointerdown', onPointerDown, true);
            canvasEl.addEventListener('contextmenu', onContextMenuBlock);
          }
          window.addEventListener('keydown', onKeyDownCanvas, true);
          window.addEventListener('keyup', onKeyUpCanvas, true);
          window.addEventListener('keypress', onKeyPressCanvas, true);

          // Canvas-document keydown for Esc/Delete/Backspace — the host window
          // handler doesn't fire while focus is inside the canvas iframe.
          let detachCanvasDocKeys: (() => void) | null = null;
          const attachCanvasDocKeys = () => {
            const doc = (() => {
              try { return editor.Canvas.getDocument(); } catch { return null; }
            })();
            if (!doc) return;
            if ((doc as unknown as { __odCanvasKeys?: true }).__odCanvasKeys) return;
            (doc as unknown as { __odCanvasKeys?: true }).__odCanvasKeys = true;
            const onDocKey = (ev: KeyboardEvent) => {
              if (isTextInputTarget(ev.target)) return;
              if (ev.code === 'Space') {
                onKeyDownCanvas(ev);
                consumeCanvasEvent(ev);
                return;
              }
              // Undo/Redo inside the canvas iframe (focus is here after a
              // canvas click, so the host-window handler won't fire).
              if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && (ev.key === 'z' || ev.key === 'Z')) {
                ev.preventDefault();
                try { ev.shiftKey ? editor.runCommand('core:redo') : editor.runCommand('core:undo'); } catch { /* ignore */ }
                return;
              }
              if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && (ev.key === 'y' || ev.key === 'Y')) {
                ev.preventDefault();
                try { editor.runCommand('core:redo'); } catch { /* ignore */ }
                return;
              }
              if (ev.key === 'Escape') {
                try {
                  if (editor.getSelected?.()) { ev.preventDefault(); editor.select(undefined); }
                } catch { /* ignore */ }
                return;
              }
              if (!readOnlyRef.current && !ev.metaKey && !ev.ctrlKey && !ev.altKey && (ev.key === 'Delete' || ev.key === 'Backspace')) {
                try {
                  const all = editor.getSelectedAll?.() ?? [];
                  if (all.length > 0) {
                    ev.preventDefault();
                    all.forEach((c: unknown) => { try { (c as Component).remove?.(); } catch { /* ignore */ } });
                    editor.select(undefined);
                  }
                } catch { /* ignore */ }
                return;
              }
              // Arrow keys: in a flex/grid parent they REORDER the selected
              // element among siblings (Figma auto-layout behaviour); in a
              // non-flex parent they nudge position ±1px (Shift=±10px), and
              // Alt+arrow also reorders. The flex/grid detection reads the
              // parent's COMPUTED display (see readParentFlexInfo) so layouts
              // coming from external CSS classes are honoured, not just inline
              // styles GrapesJS tracks.
              if (!readOnlyRef.current && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
                try {
                  const sel = editor.getSelected?.() as Component | undefined;
                  if (!sel) return;
                  ev.preventDefault();
                  const step = ev.shiftKey ? 10 : 1;
                  const parent = sel.parent?.();
                  let { display, direction } = readParentFlexInfo(parent);
                  // When the parent's display couldn't be resolved (cold
                  // iframe / not materialized), probe its live DOM element so
                  // an external-CSS flex parent is still recognised.
                  if (display === 'unknown' && parent) {
                    const pEl = getElementFromComponent(parent);
                    const pWin = pEl?.ownerDocument.defaultView ?? null;
                    if (pEl && pWin) {
                      try {
                        const pcs = pWin.getComputedStyle(pEl);
                        const d = pcs.getPropertyValue('display') || '';
                        if (d) { display = d; direction = pcs.getPropertyValue('flex-direction') || direction; }
                      } catch { /* ignore */ }
                    }
                  }
                  const isFlexOrGrid = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid';
                  const reorderSibling = (container: Component, forward: boolean) => {
                    // Move the SELECTED component to the slot adjacent to its
                    // current neighbour. GrapesJS Component.move() applies
                    // `sameParent && at > index ? at-1`, so we pass a pre-shift
                    // index that the adjustment maps to the real target:
                    //   forward  → target idx+1 → pass idx+2 (at-1 → idx+1)
                    //   backward → target idx-1 → pass idx-1 (no adjustment)
                    // This composes correctly across repeated presses: after a
                    // forward swap sel is at idx+1, the next forward targets
                    // idx+2, etc.
                    const comps = container.components();
                    const idx = (() => {
                      for (let i = 0; i < comps.length; i += 1) { if (comps.at(i) === sel) return i; }
                      return -1;
                    })();
                    if (idx >= 0) {
                      const target = forward ? idx + 1 : idx - 1;
                      if (target < 0 || target >= comps.length) return;
                      const passAt = forward ? idx + 2 : idx - 1;
                      try { sel.move(container, { at: passAt }); } catch { /* ignore */ }
                      editor.select(sel);
                      return;
                    }
                    // Fallback: resolve via the live DOM and move the selected
                    // element relative to its neighbour.
                    const selEl = getElementFromComponent(sel);
                    if (!selEl) return;
                    const sibEl = forward ? selEl.nextElementSibling : selEl.previousElementSibling;
                    if (!sibEl) return;
                    const sibComp = getComponentFromElement(sibEl as Element | null);
                    if (!sibComp) return;
                    const sibParent = sibComp.parent?.() ?? container;
                    const sibComps = sibParent.components?.();
                    const sibIdx = (() => {
                      if (!sibComps) return -1;
                      for (let i = 0; i < sibComps.length; i += 1) { if (sibComps.at(i) === sibComp) return i; }
                      return -1;
                    })();
                    if (sibIdx < 0) return;
                    try { sel.move(sibParent, { at: forward ? sibIdx + 1 : sibIdx }); } catch { /* ignore */ }
                    editor.select(sel);
                  };
                  if (isFlexOrGrid && parent) {
                    const isColumn = String(direction).startsWith('column');
                    // In a column, Up/Down = forward/backward; in a row, Left/Right.
                    const isMainAxis = isColumn
                      ? (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')
                      : (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight');
                    if (!isMainAxis) return; // cross-axis arrow does nothing in flex
                    reorderSibling(parent, ev.key === 'ArrowDown' || ev.key === 'ArrowRight');
                  } else {
                    // Non-flex parent: nudge position ±1px (Shift=±10px).
                    // Alt+arrow in non-flex also reorders siblings.
                    if (ev.altKey && parent) {
                      reorderSibling(parent, ev.key === 'ArrowDown' || ev.key === 'ArrowRight');
                    } else {
                      const style = sel.getStyle?.() ?? {};
                      const pos = (style as Record<string, string>)['position'] ?? 'static';
                      const next: Record<string, string> = { ...(style as Record<string, string>) };
                      if (pos === 'static') next['position'] = 'relative';
                      const nudge = (cur: string | undefined, delta: number): string => {
                        const m = String(cur ?? '0px').match(/^(-?[\d.]+)(px)?$/);
                        const base = m && m[1] ? parseFloat(m[1]) : 0;
                        return `${base + delta}px`;
                      };
                      if (ev.key === 'ArrowUp') next['top'] = nudge(next['top'], -step);
                      else if (ev.key === 'ArrowDown') next['top'] = nudge(next['top'], step);
                      else if (ev.key === 'ArrowLeft') next['left'] = nudge(next['left'], -step);
                      else if (ev.key === 'ArrowRight') next['left'] = nudge(next['left'], step);
                      sel.setStyle(next as Parameters<typeof sel.setStyle>[0]);
                    }
                  }
                } catch { /* ignore */ }
                return;
              }
              // Shift+A: wrap the current multi-selection in a NEW flex
              // container, leaving the picked elements in their original
              // visual positions. Selection order does NOT affect layout:
              // children are collected in DOM order and the gap is the real
              // distance between adjacent picked elements, so the wrapped
              // frame lands where the elements already were.
              if (!readOnlyRef.current && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && (ev.key === 'a' || ev.key === 'A')) {
                if (isTextInputTarget(ev.target)) return;
                try {
                  const picked = selectionOrderRef.current.length > 0
                    ? selectionOrderRef.current.slice()
                    : ((editor.getSelectedAll?.() ?? []) as Component[]);
                  if (picked.length === 0) return;
                  ev.preventDefault();
                  const zoom = (editor.Canvas.getZoom?.() ?? 100) / 100 || 1;
                  const rectOf = (comp: Component): { x: number; y: number; w: number; h: number } | null => {
                    const el = getElementFromComponent(comp);
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: r.left / zoom, y: r.top / zoom, w: r.width / zoom, h: r.height / zoom };
                  };
                  // All picked elements must share the SAME direct parent —
                  // that parent is where the wrapper gets inserted. If they
                  // don't share a parent, bail (cross-container grouping is
                  // out of scope; the user can group within one container).
                  const parents = new Set(picked.map((c) => c.parent?.() ?? null));
                  if (parents.size !== 1) return;
                  const parent = picked[0]?.parent?.();
                  if (!parent) return;
                  // Order the picked elements by their current DOM position
                  // (NOT by pick order). This is what keeps each element where
                  // it already is once they flow into the new flex wrapper.
                  const ordered = picked
                    .map((comp) => ({ comp, rect: rectOf(comp) }))
                    .filter((e): e is { comp: Component; rect: { x: number; y: number; w: number; h: number } } => !!e.rect);
                  if (ordered.length === 0) return;
                  ordered.sort((p, q) => (p.rect.y - q.rect.y) || (p.rect.x - q.rect.x));
                  const orderedComps = ordered.map((e) => e.comp);
                  // Orientation from the first/last DOM-ordered centres.
                  const first = ordered[0]!.rect;
                  const last = ordered[ordered.length - 1]!.rect;
                  const horizontal = Math.abs((last.x + last.w / 2) - (first.x + first.w / 2))
                    >= Math.abs((last.y + last.h / 2) - (first.y + first.h / 2));
                  const direction = horizontal ? 'row' : 'column';
                  // Gap = average real spacing between adjacent picked
                  // elements along the main axis (clamped ≥ 0). This
                  // preserves the original visual spacing inside the wrapper.
                  let gap = 0;
                  if (ordered.length > 1) {
                    let totalGap = 0;
                    for (let i = 1; i < ordered.length; i += 1) {
                      const prev = ordered[i - 1]!.rect;
                      const cur = ordered[i]!.rect;
                      if (horizontal) {
                        totalGap += Math.max(0, cur.x - (prev.x + prev.w));
                      } else {
                        totalGap += Math.max(0, cur.y - (prev.y + prev.h));
                      }
                    }
                    gap = Math.round(totalGap / (ordered.length - 1));
                  }
                  // Size the wrapper to the picked elements' bounding box so
                  // it occupies exactly the region they filled — keeping the
                  // visual footprint stable regardless of the parent's layout.
                  const minX = Math.min(...ordered.map((e) => e.rect.x));
                  const minY = Math.min(...ordered.map((e) => e.rect.y));
                  const maxX = Math.max(...ordered.map((e) => e.rect.x + e.rect.w));
                  const maxY = Math.max(...ordered.map((e) => e.rect.y + e.rect.h));
                  const wrapW = Math.round(maxX - minX);
                  const wrapH = Math.round(maxY - minY);
                  // Insert the wrapper at the DOM index of the first
                  // (DOM-ordered) picked element, so it takes that element's
                  // slot and the un-picked siblings stay put.
                  const firstPickedComp = orderedComps[0]!;
                  const insertAt = (() => {
                    const pc = parent.components();
                    for (let i = 0; i < pc.length; i += 1) { if (pc.get(i) === firstPickedComp) return i; }
                    return pc.length;
                  })();
                  const created = parent.append(
                    {
                      tagName: 'div',
                      style: {
                        'display': 'flex',
                        'flex-direction': direction,
                        'gap': `${gap}px`,
                        'width': `${wrapW}px`,
                        'height': `${wrapH}px`,
                      },
                    } as never,
                    { at: insertAt } as never,
                  );
                  const wrapper = (Array.isArray(created) ? created[0] : created) as Component | null;
                  if (!wrapper) return;
                  // Move each picked element into the wrapper in DOM order.
                  // Re-inserting at sequential indices preserves their order
                  // and keeps them in the same relative positions inside the
                  // flex container.
                  orderedComps.forEach((comp, i) => {
                    try { comp.move(wrapper, { at: i }); } catch { /* ignore */ }
                  });
                  editor.select(wrapper);
                  scheduleEmitRef.current?.();
                } catch { /* ignore */ }
                return;
              }
              // Shift+Cmd/Ctrl+G: dissolve the selected flex/grid container —
              // move its children back into the grandparent (at the container's
              // position) and clear the flex/grid display so it becomes a plain
              // box. This is the inverse of Shift+A auto-arrange.
              if (!readOnlyRef.current && ev.shiftKey && (ev.metaKey || ev.ctrlKey) && (ev.key === 'g' || ev.key === 'G')) {
                if (isTextInputTarget(ev.target)) return;
                try {
                  const sel = editor.getSelected?.() as Component | undefined;
                  if (!sel) return;
                  ev.preventDefault();
                  const parent = sel.parent?.();
                  if (!parent) return;
                  // Only dissolve when the selection is actually a flex/grid
                  // container; otherwise this is a no-op.
                  const el = getElementFromComponent(sel);
                  const win = el?.ownerDocument.defaultView ?? null;
                  let display = '';
                  if (el && win) {
                    try { display = win.getComputedStyle(el).getPropertyValue('display') || ''; } catch { /* ignore */ }
                  }
                  const isLayout = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid'
                    || String(sel.getStyle?.()?.['display'] ?? sel.getStyle?.()?.display ?? '') === 'flex';
                  if (!isLayout) return;
                  // Capture the container's index, then hoist each child into
                  // the grandparent at that index (preserving order), and clear
                  // the container's flex/grid styling.
                  const containerIdx = (() => {
                    const pc = parent.components();
                    for (let i = 0; i < pc.length; i += 1) { if (pc.get(i) === sel) return i; }
                    return -1;
                  })();
                  const children = Array.from(sel.components?.() ?? []) as Component[];
                  // If the container has no children there's nothing to hoist;
                  // just clear the layout display.
                  let insertAt = containerIdx >= 0 ? containerIdx : parent.components().length;
                  for (const child of children.slice()) {
                    try { child.move(parent, { at: insertAt }); insertAt += 1; } catch { /* ignore */ }
                  }
                  try {
                    const st = { ...(sel.getStyle?.() ?? {}) } as Record<string, string>;
                    delete st['display'];
                    delete st['flex-direction'];
                    delete st['flex-wrap'];
                    delete st['justify-content'];
                    delete st['align-items'];
                    delete st['gap'];
                    sel.setStyle(st as Parameters<typeof sel.setStyle>[0]);
                  } catch { /* ignore */ }
                  // If the container is now empty + styleless, remove it; else
                  // keep it selected.
                  if ((sel.components?.() ?? []).length === 0) {
                    try {
                      editor.select(parent);
                      sel.remove();
                    } catch { /* ignore */ }
                  } else {
                    editor.select(sel);
                  }
                  scheduleEmitRef.current?.();
                } catch { /* ignore */ }
                return;
              }
            };
            const onDocKeyUp = (ev: KeyboardEvent) => {
              if (ev.code !== 'Space' || isTextInputTarget(ev.target)) return;
              onKeyUpCanvas(ev);
              consumeCanvasEvent(ev);
            };
            const onDocKeyPress = (ev: KeyboardEvent) => {
              if (ev.code !== 'Space' || isTextInputTarget(ev.target)) return;
              consumeCanvasEvent(ev);
            };
            // ── 裁剪 mode: drag the selected element to pan its background-image,
            //    wheel to scale its background-size. Active only while
            //    cropModeRef.current is true and the pointer is over the
            //    selected component (which must have a background-image).
            const cropSelectedEl = (): HTMLElement | null => {
              try {
                const sel = editor.getSelected?.() as Component | undefined;
                if (!sel) return null;
                return getElementFromComponent(sel) as HTMLElement | null;
              } catch { return null; }
            };
            const readBgPos = (el: HTMLElement): { x: number; y: number } => {
              const st = el.style;
              // background-position is stored as e.g. "12px -30px" or keywords.
              const v = String(st.backgroundPosition || st.getPropertyValue('background-position') || '0px 0px');
              const parts = v.split(/\s+/);
              const num = (s: string): number => {
                const mm = /^(-?[\d.]+)/.exec(s);
                return mm && mm[1] ? parseFloat(mm[1]) : 0;
              };
              return { x: parts[0] ? num(parts[0]) : 0, y: parts[1] ? num(parts[1]) : 0 };
            };
            const readBgSize = (el: HTMLElement): { w: number; h: number } => {
              const st = el.style;
              const v = String(st.backgroundSize || st.getPropertyValue('background-size') || 'cover');
              // px form: "640px 480px"; keywords fall back to the element box.
              const m = /^([\d.]+)px\s+([\d.]+)px$/.exec(v);
              if (m && m[1] && m[2]) return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
              const w = el.clientWidth || 1;
              const h = el.clientHeight || 1;
              return { w, h };
            };
            let cropDragging = false;
            let cropStart = { x: 0, y: 0, posX: 0, posY: 0 };
            const onCropPointerDown = (ev: PointerEvent) => {
              if (readOnlyRef.current || !cropModeRef.current) return;
              if (ev.button !== 0) return;
              const el = cropSelectedEl();
              if (!el) return;
              // Only start a crop drag when the pointer is over the selected
              // element itself (not its children / other elements).
              if (!el.contains(ev.target as Node)) return;
              const bg = el.style.backgroundImage || '';
              if (!bg || bg === 'none') return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              cropDragging = true;
              const zoom = (editor.Canvas.getZoom?.() ?? 100) / 100;
              const pos = readBgPos(el);
              cropStart = { x: ev.clientX, y: ev.clientY, posX: pos.x, posY: pos.y };
              // stash zoom on the closure via a ref-like local captured by move
              (cropStart as unknown as { zoom: number }).zoom = zoom;
              el.style.cursor = 'grabbing';
            };
            const onCropPointerMove = (ev: PointerEvent) => {
              if (!cropDragging) return;
              const el = cropSelectedEl();
              if (!el) return;
              ev.preventDefault();
              const zoom = (cropStart as unknown as { zoom: number }).zoom || 1;
              const dx = (ev.clientX - cropStart.x) / zoom;
              const dy = (ev.clientY - cropStart.y) / zoom;
              const nx = Math.round(cropStart.posX + dx);
              const ny = Math.round(cropStart.posY + dy);
              try {
                const sel = editor.getSelected?.() as Component | undefined;
                if (sel) {
                  const merged = { ...(sel.getStyle?.() ?? {}) } as Record<string, string>;
                  merged['background-position'] = `${nx}px ${ny}px`;
                  sel.setStyle?.(merged);
                } else {
                  el.style.backgroundPosition = `${nx}px ${ny}px`;
                }
                refreshSelectionSnapshotRef.current?.();
              } catch { /* ignore */ }
            };
            const finishCropDrag = (el: HTMLElement | null) => {
              if (!cropDragging) return;
              cropDragging = false;
              if (el) el.style.cursor = '';
              scheduleEmitRef.current?.();
            };
            const onCropPointerUp = (ev: PointerEvent) => {
              if (!cropDragging) return;
              finishCropDrag(cropSelectedEl());
            };
            const onCropWheel = (ev: WheelEvent) => {
              if (readOnlyRef.current || !cropModeRef.current) return;
              const el = cropSelectedEl();
              if (!el || !el.contains(ev.target as Node)) return;
              const bg = el.style.backgroundImage || '';
              if (!bg || bg === 'none') return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              const size = readBgSize(el);
              // Scale around the cursor: keep the image point under the
              // pointer stationary. delta < 0 (wheel up) = zoom in.
              const factor = ev.deltaY < 0 ? 1.05 : 1 / 1.05;
              const newW = Math.max(8, Math.round(size.w * factor));
              const newH = Math.max(8, Math.round(size.h * factor));
              try {
                const sel = editor.getSelected?.() as Component | undefined;
                if (sel) {
                  const merged = { ...(sel.getStyle?.() ?? {}) } as Record<string, string>;
                  merged['background-size'] = `${newW}px ${newH}px`;
                  sel.setStyle?.(merged);
                } else {
                  el.style.backgroundSize = `${newW}px ${newH}px`;
                }
                refreshSelectionSnapshotRef.current?.();
              } catch { /* ignore */ }
            };
            doc.addEventListener('pointerdown', onCropPointerDown, true);
            doc.addEventListener('pointermove', onCropPointerMove, true);
            doc.addEventListener('pointerup', onCropPointerUp, true);
            doc.addEventListener('wheel', onCropWheel, { capture: true, passive: false });
            doc.addEventListener('keydown', onDocKey, true);
            doc.addEventListener('keyup', onDocKeyUp, true);
            doc.addEventListener('keypress', onDocKeyPress, true);
            detachCanvasDocKeys = () => {
              try {
                doc.removeEventListener('pointerdown', onCropPointerDown, true);
                doc.removeEventListener('pointermove', onCropPointerMove, true);
                doc.removeEventListener('pointerup', onCropPointerUp, true);
                doc.removeEventListener('wheel', onCropWheel, { capture: true } as EventListenerOptions);
                doc.removeEventListener('keydown', onDocKey, true);
                doc.removeEventListener('keyup', onDocKeyUp, true);
                doc.removeEventListener('keypress', onDocKeyPress, true);
                delete (doc as unknown as { __odCanvasKeys?: true }).__odCanvasKeys;
              } catch { /* ignore */ }
            };
          };
          editor.on('load', attachCanvasDocKeys);
          editor.on('canvas:frame:load:body', attachCanvasDocKeys);
          attachCanvasDocKeys();

          // Figma-style nested selection on the canvas document:
          //   • plain click inside a flex/grid ancestor → select the OUTERMOST
          //     flex/grid container (so multi-level auto-layout behaves like a
          //     single frame). Non-flex layouts fall through to GrapesJS's
          //     default innermost-select.
          //   • Cmd/Ctrl+click → select the INNERMOST component (deep select),
          //     bypassing GrapesJS's Cmd+click = multi-select-toggle branch.
          //   • double-click on a non-text container → select its first child
          //     ("enter" one level). Text components keep their native
          //     dblclick→RTE behaviour, so we don't intercept those.
          //   • Cmd/Ctrl + right-click → open the layer-stack context menu
          //     (handled via onCtxMenu below).
          let detachNestedSelect: (() => void) | null = null;
          const attachNestedSelect = () => {
            const doc = (() => {
              try { return editor.Canvas.getDocument(); } catch { return null; }
            })();
            if (!doc) return;
            if ((doc as unknown as { __odNestedSelect?: true }).__odNestedSelect) return;
            (doc as unknown as { __odNestedSelect?: true }).__odNestedSelect = true;
            // The React host document (outside the canvas iframe) — used so the
            // clipboard paste listener works even when focus is on a host UI
            // control rather than inside the canvas frame.
            const hostDocument = containerRef.current?.ownerDocument ?? document;

            // Resolve the computed `display` of a GrapesJS component's rendered
            // element. Returns '' when the element isn't materialised yet.
            const componentDisplay = (comp: Component | null | undefined): string => {
              const el = getElementFromComponent(comp ?? null);
              if (!el) return '';
              const win = el.ownerDocument.defaultView;
              if (!win) return '';
              try { return win.getComputedStyle(el).getPropertyValue('display') || ''; } catch { return ''; }
            };
            // Only FLEX containers drive the "click content → select frame"
            // behaviour. Grid is intentionally excluded: a grid ancestor must
            // NOT capture clicks meant for its flex children (the user's
            // reported bug was a grid wrapper being selected instead of the
            // flex frame they clicked into).
            const isFlexDisplay = (display: string): boolean =>
              display === 'flex' || display === 'inline-flex';

            // Walk a component's ancestors and return the NEAREST FLEX
            // container (or null if none). Starts at the parent so a click on
            // a flex container's own padding area (ev.target === the flex
            // element itself) does NOT climb to that container's parent — the
            // click is "on the container", not "in its content".
            //
            // Examples (flex1 > flex1-1 > flex1-1-1/2):
            //   • click flex1 padding → comp=flex1, parent not flex → null
            //     → default selects flex1 (the clicked element).
            //   • click flex1-1-2     → comp=flex1-1-2, nearest flex ancestor
            //     is flex1-1 → select flex1-1.
            //   • click flex1-2        → comp=flex1-2, nearest flex ancestor is
            //     flex1 → select flex1.
            const findNearestFlexAncestor = (comp: Component | null): Component | null => {
              let node: Component | null | undefined = comp?.parent?.();
              while (node) {
                // Stop at the wrapper root (no parent) — selecting it would be
                // a no-op and confuse the user.
                if (!node.parent?.()) break;
                if (isFlexDisplay(componentDisplay(node))) return node;
                node = node.parent?.();
              }
              return null;
            };

            const onClick = (ev: MouseEvent) => {
              if (readOnlyRef.current) return;
              if (isTextInputTarget(ev.target)) return;
              // Cmd/Ctrl+click = deep select (innermost). Stop propagation so
              // GrapesJS's own click→select (which treats Cmd as multi-select
              // toggle) doesn't run.
              if (ev.metaKey || ev.ctrlKey) {
                const inner = getComponentFromElement(ev.target as Element | null);
                if (!inner) return;
                ev.preventDefault();
                ev.stopImmediatePropagation();
                editor.select(inner);
                return;
              }
              // Plain click: if the clicked element sits INSIDE a flex
              // container (i.e. it is that container's content), select the
              // NEAREST flex ancestor (the frame wrapping the content). A click
              // on a flex container's own padding area is "on the container"
              // (ev.target === the container), so its parent is inspected and
              // the container itself is selected via the default fall-through.
              // Grid ancestors never capture the click.
              const comp = getComponentFromElement(ev.target as Element | null);
              if (!comp) return;
              const ancestor = findNearestFlexAncestor(comp);
              if (!ancestor) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              // No event arg → avoids GrapesJS's Cmd/Shift multi-select branch.
              editor.select(ancestor);
            };

            // Flex-aware hover: when the pointer is over an element that lives
            // INSIDE a flex container, redirect the GrapesJS hover highlight to
            // that container (so the hover box matches the "click selects the
            // container" behaviour) and add a dashed blue outline to the actual
            // child under the cursor. This removes the jarring mismatch where
            // hovering a flex child drew the hover outline on the child but
            // clicking selected the container.
            const FLEX_CHILD_HOVER_CLASS = 'od-flex-child-hover';
            // Inject the outline style into the canvas iframe document (the
            // child element lives inside the iframe, so a host-side stylesheet
            // wouldn't reach it). Idempotent via a marker attribute.
            try {
              const head = doc.head;
              if (head && !head.querySelector('style[data-od-flex-child-hover]')) {
                const styleEl = doc.createElement('style');
                styleEl.setAttribute('data-od-flex-child-hover', 'true');
                styleEl.textContent = `.${FLEX_CHILD_HOVER_CLASS}{outline:1px dashed #3b82f6 !important;outline-offset:1px !important;}`;
                head.appendChild(styleEl);
              }
            } catch { /* ignore */ }
            let lastChildHoverEl: HTMLElement | null = null;
            const clearChildHover = () => {
              if (lastChildHoverEl) {
                lastChildHoverEl.classList.remove(FLEX_CHILD_HOVER_CLASS);
                lastChildHoverEl = null;
              }
            };
            const onMouseOver = (ev: MouseEvent) => {
              if (readOnlyRef.current) {
                clearChildHover();
                return;
              }
              const comp = getComponentFromElement(ev.target as Element | null);
              if (!comp) { clearChildHover(); return; }
              const ancestor = findNearestFlexAncestor(comp);
              if (!ancestor) {
                clearChildHover();
                return;
              }
              // The element actually under the cursor (the flex child). Tag it
              // with the dashed outline. Skip when the pointer is directly on
              // the flex container itself (no child to outline).
              const childEl = getElementFromComponent(comp) as HTMLElement | null;
              if (childEl && childEl !== lastChildHoverEl) {
                clearChildHover();
                childEl.classList.add(FLEX_CHILD_HOVER_CLASS);
                lastChildHoverEl = childEl;
              }
              // Redirect the editor hover to the flex container. GrapesJS
              // listens for `mouseover` on the body in the BUBBLE phase; this
              // capture-phase handler runs first, so stopImmediatePropagation
              // prevents GrapesJS from marking the child as hovered, and
              // setHovered then drives the .gjs-hovered box onto the container.
              ev.stopImmediatePropagation();
              try {
                (editor as unknown as { setHovered?: (cmp: Component | null) => void })
                  .setHovered?.(ancestor);
              } catch { /* ignore */ }
            };
            const onMouseOut = (ev: MouseEvent) => {
              // Only clear when leaving the canvas document entirely (relatedTarget
              // is null/outside the doc) — otherwise mouseover fires for the new
              // target and re-tags it before this clears.
              const related = ev.relatedTarget as Node | null;
              if (related && doc.contains(related)) return;
              clearChildHover();
            };

            const onDblClick = (ev: MouseEvent) => {
              if (readOnlyRef.current) return;
              if (isTextInputTarget(ev.target)) return;
              const comp = getComponentFromElement(ev.target as Element | null);
              if (!comp) return;
              let type = '';
              try { type = String(comp.get?.('type') ?? ''); } catch { /* ignore */ }
              const isText = type === 'text' || type === 'textnode';
              // Text elements: first dblclick SELECTS (don't enter edit yet);
              // a second dblclick on the already-selected text enters edit
              // mode. This matches Figma: dblclick a text → select it, dblclick
              // again → caret. We block the native RTE on the first dblclick by
              // selecting + stopImmediatePropagation; on the second dblclick the
              // component is already selected, so we fall through and let
              // GrapesJS's own dblclick→onActive fire the RTE.
              if (isText) {
                const current = editor.getSelected?.();
                if (current === comp) return; // already selected → let RTE engage
                ev.preventDefault();
                ev.stopImmediatePropagation();
                editor.select(comp);
                return;
              }
              // Double-click on an <img>: hand control to the host so it can
              // open the fill panel's image tab (replace src) instead of
              // GrapesJS's native asset-manager modal.
              if (type === 'image') {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                onImageEditRequestRef.current?.();
                return;
              }
              // Single-click selected the outer flex ancestor; double-click
              // "enters" one level by selecting the actual component under the
              // cursor (not its first child — that would descend too far and
              // break the flex-arrow-key reorder, whose parent must be the
              // flex container the user just left).
              ev.preventDefault();
              ev.stopImmediatePropagation();
              editor.select(comp);
            };

            // Cmd/Ctrl + right-click → layer-stack context menu. Builds the
            // ancestor chain (innermost → outermost) and hands it to the host
            // via setCtxMenuRef so the React-rendered CanvasContextMenu shows.
            const onCtxMenu = (ev: MouseEvent) => {
              if (!(ev.metaKey || ev.ctrlKey)) return;
              const comp = getComponentFromElement(ev.target as Element | null);
              if (!comp) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              // Collect ancestor chain innermost→outermost.
              const chain: Component[] = [];
              let node: Component | null | undefined = comp;
              while (node) {
                chain.push(node);
                const next = node.parent?.();
                if (!next || next === node) break;
                node = next;
              }
              // The menu portals into host document.body with position:fixed,
              // so it needs BROWSER VIEWPORT coords, not canvas-space coords.
              // The contextmenu event's clientX/Y are relative to the iframe's
              // viewport; convert by adding the iframe's offset on screen.
              // (canvasEventClientPoint applies the zoom scale, which is wrong
              // here — that produces the off-by-zoom drift the user saw.)
              const frame = editor.Canvas.getFrameEl?.();
              const rect = frame?.getBoundingClientRect();
              setCtxMenuRef.current?.({
                components: chain,
                screenX: ev.clientX + (rect?.left ?? 0),
                screenY: ev.clientY + (rect?.top ?? 0),
              });
            };

            doc.addEventListener('click', onClick, true);
            doc.addEventListener('dblclick', onDblClick, true);
            doc.addEventListener('contextmenu', onCtxMenu, true);
            doc.addEventListener('mouseover', onMouseOver, true);
            doc.addEventListener('mouseout', onMouseOut, true);
            detachNestedSelect = () => {
              try {
                doc.removeEventListener('click', onClick, true);
                doc.removeEventListener('dblclick', onDblClick, true);
                doc.removeEventListener('contextmenu', onCtxMenu, true);
                doc.removeEventListener('mouseover', onMouseOver, true);
                doc.removeEventListener('mouseout', onMouseOut, true);
                clearChildHover();
                delete (doc as unknown as { __odNestedSelect?: true }).__odNestedSelect;
              } catch { /* ignore */ }
            };

            // Clipboard image paste: when the user pastes a screenshot (e.g.
            // Ctrl/Cmd+V after a screenshot tool) while the canvas has focus,
            // insert it as an <img> — or, if an <img> is selected, replace
            // its src. We attach to BOTH the canvas doc and the host window so
            // the paste works whether focus is inside the iframe or outside.
            const handleImagePaste = async (ev: ClipboardEvent) => {
              if (readOnlyRef.current) return;
              const items = ev.clipboardData?.items;
              if (!items || items.length === 0) return;
              let imageItem: DataTransferItem | null = null;
              for (const item of Array.from(items)) {
                if (item.kind === 'file' && item.type.startsWith('image/')) { imageItem = item; break; }
              }
              if (!imageItem) return;
              const file = imageItem.getAsFile();
              if (!file) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              try {
                const { readImageFileToDataUrl } = await import('./image-upload');
                const { dataUrl, width, height } = await readImageFileToDataUrl(file);
                const sel = editor.getSelected?.() as Component | undefined;
                const isImg = sel && String(sel.get?.('type') ?? '') === 'image';
                if (isImg) {
                  // Pasting onto an <img> replaces its src directly.
                  try { sel.addAttributes?.({ src: dataUrl }); } catch { /* ignore */ }
                  refreshSelectionSnapshotRef.current?.();
                } else {
                  // Otherwise insert a sized <div> with the screenshot as a
                  // background-image fill, so the user can reuse the fill
                  // panel's image settings (size/repeat) on it afterwards.
                  const wrapper = editor.Components.getComponents().get(0);
                  // Size the div to the image's natural dimensions (clamped)
                  // so the pasted screenshot is visible at a sensible size.
                  const w = width > 0 ? Math.min(width, 800) : 320;
                  const h = height > 0 ? Math.min(height, 800) : 240;
                  const created = (sel ?? wrapper)?.append?.({
                    tagName: 'div',
                    style: {
                      width: `${w}px`,
                      height: `${h}px`,
                      'background-image': `url("${dataUrl}")`,
                      'background-size': 'cover',
                      'background-position': 'center',
                      'background-repeat': 'no-repeat',
                    },
                  } as never);
                  const node = Array.isArray(created) ? (created[0] ?? null) : (created ?? null);
                  if (node) {
                    // Re-assert via kebab-case setStyle to be certain the
                    // background round-trips (the component-def style object
                    // sometimes drops large data URLs during parsing).
                    try {
                      (node as Component).setStyle?.({
                        'width': `${w}px`,
                        'height': `${h}px`,
                        'background-image': `url("${dataUrl}")`,
                        'background-size': 'cover',
                        'background-position': 'center',
                        'background-repeat': 'no-repeat',
                      } as Record<string, string>);
                    } catch { /* ignore */ }
                    try { editor.select(node as Component); } catch { /* ignore */ }
                  }
                }
                scheduleEmitRef.current?.();
              } catch { /* ignore — invalid image or read failure */ }
            };
            const onDocPaste = (ev: ClipboardEvent) => { void handleImagePaste(ev); };
            doc.addEventListener('paste', onDocPaste, true);
            const onHostPaste = (ev: ClipboardEvent) => { void handleImagePaste(ev); };
            hostDocument.addEventListener('paste', onHostPaste, true);
            const prevDetach = detachNestedSelect;
            detachNestedSelect = () => {
              try { doc.removeEventListener('paste', onDocPaste, true); } catch { /* ignore */ }
              try { hostDocument.removeEventListener('paste', onHostPaste, true); } catch { /* ignore */ }
              prevDetach?.();
            };
          };
          editor.on('load', attachNestedSelect);
          editor.on('canvas:frame:load:body', attachNestedSelect);
          attachNestedSelect();

          // Interactive-mode link navigation. GrapesJS's core canvas click
          // handler unconditionally calls preventDefault() on every <a> click
          // inside the canvas iframe (to keep links from navigating away from
          // the editor). That's correct for edit mode, but it breaks the
          // "Interactive" prototype-demo mode where the user wants to click a
          // link and actually navigate. So in read-only / preview mode we run
          // a capture-phase handler on the canvas document that — BEFORE
          // GrapesJS's own handler — re-enables the default for <a> clicks by
          // stopping further propagation (which defeats GrapesJS's preventDefault
          // listener) and letting the browser perform the navigation natively.
          // We only do this when readOnly is on, so edit mode keeps its link-
          // suppressing behaviour.
          let detachLinkUnblock: (() => void) | null = null;
          const applyLinkUnblockState = () => {
            const doc = (() => {
              try {
                return editor.Canvas.getDocument();
              } catch {
                return null;
              }
            })();
            if (!doc) return;
            // The handler is idempotent — re-attaching would double-fire, so
            // we guard with a marker and (re)attach once per document.
            if ((doc as unknown as { __odLinkUnblock?: true }).__odLinkUnblock) return;
            (doc as unknown as { __odLinkUnblock?: true }).__odLinkUnblock = true;
            const onLinkClick = (ev: MouseEvent) => {
              if (!readOnlyRef.current) return;
              const target = ev.target as Element | null;
              const anchor = target?.closest?.('a');
              if (!anchor) return;
              // GrapesJS's editor-level click listener calls preventDefault() on
              // every <a> click to keep links from navigating away from the
              // editor. stopImmediatePropagation() defeats that listener, then
              // we drive the navigation ourselves so the iframe actually moves
              // to the link's target (hash for same-document, or a full load for
              // an external/relative href resolved against the canvas <base>).
              ev.stopImmediatePropagation();
              ev.preventDefault();
              const href = anchor.getAttribute('href') || '';
              if (!href) return;
              const win = doc.defaultView;
              if (!win) return;
              try {
                if (href.startsWith('#')) {
                  win.location.hash = href;
                } else {
                  win.location.href = href;
                }
              } catch {
                // Cross-origin or sandboxed — best-effort, ignore.
              }
            };
            doc.addEventListener('click', onLinkClick, true);
            detachLinkUnblock = () => {
              try {
                doc.removeEventListener('click', onLinkClick, true);
                delete (doc as unknown as { __odLinkUnblock?: true }).__odLinkUnblock;
              } catch {
                // ignore
              }
            };
          };
          editor.on('canvas:frame:load:body', applyLinkUnblockState);
          applyLinkUnblockState();

          (editor as unknown as { _odCanvasNavDetach?: () => void })._odCanvasNavDetach = () => {
            if (canvasEl) {
              canvasEl.removeEventListener('wheel', onWheelCanvas, true);
              canvasEl.removeEventListener('pointerdown', onPointerDown, true);
              canvasEl.removeEventListener('contextmenu', onContextMenuBlock);
            }
            window.removeEventListener('keydown', onKeyDownCanvas, true);
            window.removeEventListener('keyup', onKeyUpCanvas, true);
            window.removeEventListener('keypress', onKeyPressCanvas, true);
            window.removeEventListener('pointermove', onPointerMove);
            if (restorePointerEventsTimer) clearTimeout(restorePointerEventsTimer);
            removePanOverlay();
            detachLinkUnblock?.();
            detachCanvasDocKeys?.();
            detachNestedSelect?.();
            try { editor.off('canvas:tools:update', onToolsUpdate); } catch { /* ignore */ }
            try { editor.off('component:deselected', hideDimensionBadge); } catch { /* ignore */ }
            try { dimensionBadge?.remove(); } catch { /* ignore */ }
            dimensionBadge = null;
            detachSpacingHandles?.();
            detachSpacingHandles = null;
          };

          // Dirty + change signal. We debounce so drag/style updates don't
          // emit dozens of onChange events.
          //
          // IMPORTANT: do NOT subscribe `editor.on('change', ...)`. GrapesJS
          // fires `change` on every internal model attribute mutation —
          // including selection, hover, and per-frame drag state — so it runs
          // dozens of times during a single drag. That kept resetting the
          // 150ms debounce and forced `reassembleDocument` string
          // concatenation on a hot path, which was a primary source of jank
          // vs the official demo. `component:update` + `styleUpdate` already
          // cover the mutations we care about (DOM content + style); structural
          // moves are reflected via the subsequent `component:update`.
          let emitTimer: ReturnType<typeof setTimeout> | null = null;
          const scheduleEmit = () => {
            if (emitTimer) clearTimeout(emitTimer);
            emitTimer = setTimeout(() => {
              emitTimer = null;
              emitChange();
            }, 150);
          };
          editor.on('component:update', scheduleEmit);
          editor.on('styleUpdate', scheduleEmit);
          scheduleEmitRef.current = scheduleEmit;
          // Expose a way to re-emit the selection snapshot after a style write
          // so the StylePanel shows updated values. We defer 1 rAF so the
          // computed style has time to reflow.
          refreshSelectionSnapshotRef.current = () => {
            window.requestAnimationFrame(() => {
              const cb = onSelectionChangeRef.current;
              if (!cb) return;
              try {
                const all = editor.getSelectedAll?.() ?? [];
                const first = all[0];
                if (!first) { cb({ hasSelection: false, tagName: '', selector: '', styles: {} }); return; }
                const comp = first as Component;
                const el = getElementFromComponent(comp);
                const snapStyles = readElementStyles(el);
                let tagName = 'div';
                try { tagName = (comp.get('tagName') as string) ?? 'div'; } catch { /* ignore */ }
                let selector = tagName;
                try {
                  const attrs = comp.getAttributes() as Record<string, unknown>;
                  const id = typeof attrs['id'] === 'string' ? attrs['id'] : '';
                  const cls = typeof attrs['class'] === 'string' ? attrs['class'] : '';
                  selector = `${tagName}${id ? `#${id}` : ''}${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`;
                } catch { /* ignore */ }
                cb({ hasSelection: true, tagName, selector, styles: snapStyles });
              } catch { /* ignore */ }
            });
          };

          // PR2: selection / hover / style / tweaks event forwarding. These
          // replace the iframe postMessage flows (od:comment-target(s),
          // od-edit-hover, od-edit-preview-style-applied, od:tweaks-available)
          // when the canvas is driven by GrapesJS. Reading data-od-id from
          // attributes reuses the same path-style id scheme the
          // od-stable-id-plugin maintains, so the host can map a target back
          // to its source location without ambiguity.
          const readOdId = readOdIdFromComponent;

          const renderExternalPanels = () => {
            try {
              if (layersPanelRef?.current && !layersPanelRef.current.childElementCount) {
                const layersEl = editor.Layers.render();
                layersPanelRef.current.replaceChildren(layersEl);
              }
            } catch {
              // ignore — non-fatal, panel stays empty
            }
            try {
              if (stylePanelRef?.current && !stylePanelRef.current.childElementCount) {
                const styleEl = editor.StyleManager.render();
                stylePanelRef.current.replaceChildren(styleEl);
              }
            } catch {
              // ignore — non-fatal, panel stays empty
            }
          };

          // Selection forwarding to the host. We intentionally do NOT:
          //   • re-select via editor.select() on a rAF — that fought the
          //     native selection pipeline whenever a Text component needed
          //     normalising to its element-backed ancestor, and was a major
          //     cause of "click but no activation".
          //   • call StyleManager.select() manually — StyleManager follows
          //     editor selection on its own; the manual call doubled the
          //     work on every click.
          //   • paint a custom .od-gjs-selected highlight — the 9999px
          //     box-shadow it injected forced a full-iframe repaint and
          //     visually masked GrapesJS's native selection box. GrapesJS's
          //     own tool layer is the selection affordance now.
          const normalizeForHostSelection = (comp: unknown): Component | null => {
            return resolveComponentForHostSelection(comp as Component);
          };
          // Sync the external StyleManager target on selection. The panel is
          // rendered into a host container via editor.StyleManager.render(),
          // and unlike GrapesJS's built-in panel it does NOT auto-follow
          // editor selection — without this call its inputs stay empty.
          const syncStyleManagerTarget = (hostComp: Component | null) => {
            if (!hostComp) return;
            try {
              const selectStyleTarget = editor.StyleManager.select as unknown as (
                target: unknown,
                opts?: { component?: unknown },
              ) => unknown;
              selectStyleTarget(hostComp, { component: hostComp });
            } catch { /* ignore — best-effort target sync. */ }
          };
          const forwardSelection = () => {
            const cb = onSelectTargetsRef.current;
            if (!cb) return;
            let selected: unknown[] = [];
            try {
              selected = editor.getSelectedAll?.() ?? [];
            } catch {
              // GrapesJS < 0.21 fallback path.
              const single = editor.getSelected?.();
              selected = single ? [single] : [];
            }
            // Sync the external StyleManager so the right-hand Style panel
            // shows the selected element's properties. GrapesJS's StyleManager
            // is single-target, so we feed it the first selected component.
            const firstSelected = selected[0];
            const firstHost = firstSelected ? normalizeForHostSelection(firstSelected) : null;
            if (firstHost) {
              syncStyleManagerTarget(firstHost);
            } else {
              try { editor.StyleManager.select(''); } catch { /* ignore */ }
            }
            const ids = selected
              .map((c) => {
                const hostComp = normalizeForHostSelection(c);
                // Guarantee an id for the selected component so the host can
                // build an InspectTarget. The write can trigger
                // component:update → emitChange, but emitChange syncs the
                // emitted value to lastExternalHtmlRef, so the host's echo of
                // the same html is recognised as "ours" and does NOT trigger a
                // canvas rebuild (which would wipe the selection).
                return hostComp ? ensureComponentOdId(editor, hostComp) : readOdId(c);
              })
              .filter((id): id is string => typeof id === 'string' && id.length > 0);
            cb(ids);
            // Emit a computed-style snapshot so the host's StylePanel renders
            // current values. Debounced via rAF so rapid selection changes
            // (e.g. drag-select) don't thrash getComputedStyle.
            const emitSelectionSnapshot = () => {
              const cb2 = onSelectionChangeRef.current;
              if (!cb2) return;
              try {
                const all = editor.getSelectedAll?.() ?? [];
                const first = all[0];
                if (!first) {
                  cb2({ hasSelection: false, tagName: '', selector: '', styles: {} });
                  return;
                }
                const comp = first as Component;
                const el = getElementFromComponent(comp);
                const styles = readElementStyles(el);
                let tagName = 'div';
                try { tagName = (comp.get('tagName') as string) ?? 'div'; } catch { /* ignore */ }
                let selector = tagName;
                try {
                  const attrs = comp.getAttributes() as Record<string, unknown>;
                  const id = typeof attrs['id'] === 'string' ? attrs['id'] : '';
                  const cls = typeof attrs['class'] === 'string' ? attrs['class'] : '';
                  selector = `${tagName}${id ? `#${id}` : ''}${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`;
                } catch { /* ignore */ }
                cb2({ hasSelection: true, tagName, selector, styles });
              } catch { /* ignore */ }
            };
            window.requestAnimationFrame(emitSelectionSnapshot);
          };
          editor.on('component:selected', forwardSelection);
          editor.on('component:deselected', forwardSelection);
          // Maintain pick order for Shift+A auto-layout. Push on select
          // (dedup), splice on deselect, clear when selection empties.
          editor.on('component:selected', (comp: unknown) => {
            const c2 = comp as Component;
            if (!c2) return;
            const arr = selectionOrderRef.current;
            if (!arr.includes(c2)) arr.push(c2);
          });
          editor.on('component:deselected', (comp: unknown) => {
            const c2 = comp as Component;
            const arr = selectionOrderRef.current;
            const i = arr.indexOf(c2);
            if (i >= 0) arr.splice(i, 1);
            if ((editor.getSelectedAll?.() ?? []).length === 0) arr.length = 0;
          });

          const forwardHover = (comp: unknown) => {
            const cb = onHoverTargetRef.current;
            if (!cb) return;
            const hostComp = normalizeForHostSelection(comp);
            cb(hostComp ? readOdId(hostComp) : readOdId(comp));
          };
          editor.on('component:hover', forwardHover);

          const forwardStyleUpdate = () => {
            onStyleUpdateRef.current?.();
          };
          editor.on('styleUpdate', forwardStyleUpdate);
          editor.on('component:update', forwardStyleUpdate);

          // tweaks template availability — re-scan on every component
          // structural change. We dedupe via lastTweaksAvailableRef so we
          // only fire when the boolean actually flips.
          const scanTweaks = (): boolean => {
            try {
              const doc = editor.Canvas.getDocument();
              if (!doc) return false;
              return !!doc.querySelector('.tw-panel, .tw-hidden');
            } catch {
              return false;
            }
          };
          const forwardTweaks = () => {
            const cb = onTweaksAvailableRef.current;
            if (!cb) return;
            const available = scanTweaks();
            if (lastTweaksAvailableRef.current === available) return;
            lastTweaksAvailableRef.current = available;
            cb(available);
          };
          editor.on('component:create', forwardTweaks);
          editor.on('component:remove', forwardTweaks);
          editor.on('load', forwardTweaks);

          // Save shortcut — GrapesJS doesn't ship a default Cmd+S.
          const onKeyDown = (ev: KeyboardEvent) => {
            if ((ev.metaKey || ev.ctrlKey) && (ev.key === 's' || ev.key === 'S')) {
              ev.preventDefault();
              onSaveRef.current?.();
            }
            // Stop Cmd+Z from bubbling to FileViewer's manual-edit undo
            // handler when we own the canvas.
            if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')) {
              ev.stopPropagation();
            }
          };
          containerRef.current.addEventListener('keydown', onKeyDown);
          (editor as unknown as { _odKeyDown?: typeof onKeyDown })._odKeyDown = onKeyDown;
        })
        .catch((err) => {
          if (disposed) return;
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });

      return () => {
        disposed = true;
        const editor = editorRef.current;
        if (editor) {
          try {
            (editor as unknown as { _odCanvasNavDetach?: () => void })._odCanvasNavDetach?.();
          } catch {
            // ignore
          }
          try {
            editor.destroy();
          } catch {
            // ignore — GrapesJS sometimes throws on double destroy.
          }
          editorRef.current = null;
        }
        parsedRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // React to external html prop changes (e.g. user edited source Tab).
    useEffect(() => {
      if (areDocumentsEqual(html, lastExternalHtmlRef.current)) return;
      const editor = editorRef.current;
      if (!editor) return;
      const parsed = parseHtmlDocument(html);
      parsedRef.current = parsed;
      lastExternalHtmlRef.current = html;
      lastEmittedRef.current = '';
      // Reset components — od-stable-id-plugin will re-tag path-based ids
      // but preserve explicit data-od-id from the AI.
      try {
        editor.setComponents(parsed.bodyInner || '<div></div>');
        applyCanvasHeadAssets(editor.Canvas.getDocument(), parsed, baseHrefRef.current);
      } catch {
        // ignore
      }
    }, [html]);

    // PR3: the host may mount the panel containers AFTER editor load (e.g.
    // the sidebar only mounts when the user opens inspect mode). Re-render
    // panels whenever a previously-null container becomes available.
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || loading) return;
      try {
        if (layersPanelRef?.current && !layersPanelRef.current.childElementCount) {
          const layersEl = editor.Layers.render();
          layersPanelRef.current.replaceChildren(layersEl);
        }
      } catch {
        // ignore
      }
      try {
        if (stylePanelRef?.current && !stylePanelRef.current.childElementCount) {
          const styleEl = editor.StyleManager.render();
          stylePanelRef.current.replaceChildren(styleEl);
        }
      } catch {
        // ignore
      }
    }, [loading, layersPanelRef, stylePanelRef]);

    useImperativeHandle(
      ref,
      (): GrapesjsEditorHandle => ({
        getHtml: () => editorRef.current?.getHtml() ?? '',
        getCss: () => editorRef.current?.getCss() ?? '',
        getDocument: () => {
          const editor = editorRef.current;
          const parsed = parsedRef.current;
          if (!editor || !parsed) return html;
          return reassembleDocument(parsed, editor.getHtml(), editor.getCss() ?? '');
        },
        setHtml: (next: string) => {
          const editor = editorRef.current;
          if (!editor) return;
          const parsed = parseHtmlDocument(next);
          parsedRef.current = parsed;
          lastExternalHtmlRef.current = next;
          lastEmittedRef.current = '';
          try {
            editor.setComponents(parsed.bodyInner || '<div></div>');
            applyCanvasHeadAssets(editor.Canvas.getDocument(), parsed, baseHrefRef.current);
          } catch {
            // ignore
          }
        },
        setReadOnly: (ro: boolean) => {
          readOnlyRef.current = ro;
          const editor = editorRef.current;
          if (!editor) return;
          try {
            if (ro) {
              editor.runCommand('core:preview');
            } else {
              editor.stopCommand('core:preview');
            }
          } catch {
            // ignore
          }
        },
        destroy: () => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            editor.destroy();
          } catch {
            // ignore
          }
          editorRef.current = null;
        },
        applyStyle: (styles: Record<string, string>) => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            const all = editor.getSelectedAll?.() ?? [];
            for (const c of all) {
              const comp = c as Component;
              const merged = { ...(comp.getStyle?.() ?? {}), ...styles } as Parameters<typeof comp.setStyle>[0];
              comp.setStyle?.(merged);
            }
            // Re-emit the selection snapshot so the StylePanel's NumberScrub /
            // color inputs reflect the just-written values (computed style
            // reads fresh after setStyle).
            refreshSelectionSnapshotRef.current?.();
          } catch { /* ignore */ }
        },
        getCanvasStyles: () => {
          const editor = editorRef.current;
          const body = editor ? readElementStyles(getCanvasBodyElFromEditor(editor)) : {};
          return body;
        },
        setCanvasStyles: (styles: Record<string, string>) => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            const body = getCanvasBodyElFromEditor(editor);
            if (body) Object.assign(body.style, toCssStyleProps(styles));
            // Also persist onto the wrapper component so getDocument round-trips.
            const wrapper = editor.Components.getComponents().get(0);
            if (wrapper) {
              const merged = { ...(wrapper.getStyle?.() ?? {}), ...styles } as Parameters<typeof wrapper.setStyle>[0];
              wrapper.setStyle?.(merged);
            }
          } catch { /* ignore */ }
        },
        setViewport: (width: number, height: number) => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            // GrapesJS DeviceManager drives the canvas frame width.
            const dm = editor.DeviceManager;
            if (dm) {
              try {
                dm.add?.({ id: 'od-custom', name: 'Custom', width: `${width}px` });
                dm.select?.('od-custom');
              } catch { /* fall through */ }
            }
            const frame = editor.Canvas.getFrameEl?.();
            if (frame) {
              frame.style.width = `${width}px`;
              frame.style.height = `${height}px`;
            }
            // Reset zoom to 100% and recenter the frame in the viewport so the
            // user isn't left looking at a panned/zoomed corner after switching
            // device. fitViewport auto-scales to fit, then we clamp to ≤100%
            // so small devices (mobile) don't blow up beyond actual size.
            editor.Canvas.setZoom(100);
            editor.Canvas.setCoords(0, 0);
            try {
              editor.Canvas.fitViewport({ zoom: (z: number) => Math.min(z, 100) });
            } catch { /* ignore — fitViewport best-effort */ }
            syncZoomAttrRef.current?.();
            syncCoordsAttrRef.current?.();
          } catch { /* ignore */ }
        },
        setCanvasSize: (width?: number, height?: number) => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            const frame = editor.Canvas.getFrameEl?.();
            if (frame) {
              if (typeof width === 'number' && width > 0) frame.style.width = `${width}px`;
              if (typeof height === 'number' && height > 0) frame.style.height = `${height}px`;
            }
            // Persist into the document <html> so getDocument() round-trips
            // the size through auto-save (the canvas frame DOM is transient —
            // it isn't part of the artifact HTML). On reload, the boot effect
            // reads these attrs and re-applies them to the frame.
            const doc = editor.Canvas.getDocument?.();
            const root = doc?.documentElement;
            if (root) {
              if (typeof width === 'number' && width > 0) root.setAttribute('data-od-canvas-width', String(width));
              if (typeof height === 'number' && height > 0) root.setAttribute('data-od-canvas-height', String(height));
            }
            // Trigger auto-save so the new size is written to the file.
            scheduleEmitRef.current?.();
          } catch { /* ignore */ }
        },
        setSelectedSrc: (src: string) => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            const all = (editor.getSelectedAll?.() ?? []) as Component[];
            for (const c of all) {
              try { c.addAttributes?.({ src }); } catch { /* ignore */ }
            }
            refreshSelectionSnapshotRef.current?.();
          } catch { /* ignore */ }
        },
        getSelectedSrc: () => {
          const editor = editorRef.current;
          if (!editor) return '';
          try {
            const sel = editor.getSelected?.() as Component | undefined;
            if (!sel) return '';
            // Prefer the model attribute; fall back to the rendered <img>'s
            // current src (covers cases where the attribute key differs).
            const attr = sel.get?.('attributes');
            const modelSrc = attr && typeof attr === 'object' ? String((attr as Record<string, unknown>).src ?? '') : '';
            if (modelSrc) return modelSrc;
            const el = getElementFromComponent(sel);
            if (el && (el as HTMLElement).tagName === 'IMG') {
              return (el as HTMLImageElement).getAttribute('src') ?? (el as HTMLImageElement).src ?? '';
            }
            return '';
          } catch { return ''; }
        },
        insertImageComponent: (src: string) => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            const selected = editor.getSelected?.() as Component | undefined;
            // Insert a sized <div> with the image as a background-image fill so
            // the fill panel's image settings can be reused on it.
            const host = (selected && selected.get?.('components') != null) ? selected : null;
            const target = host ?? editor.Components.getComponents().get(0);
            const created = target?.append?.({
              tagName: 'div',
              style: {
                width: '320px',
                height: '240px',
                backgroundImage: `url("${src}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
              },
            } as never);
            const node = Array.isArray(created) ? (created[0] ?? null) : (created ?? null);
            if (node) {
              try { editor.select(node as Component); } catch { /* ignore */ }
            }
            scheduleEmitRef.current?.();
          } catch { /* ignore */ }
        },
        reselectCurrent: () => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            const sel = editor.getSelected?.() as Component | undefined;
            if (!sel) return;
            // Re-selecting with no event arg re-asserts the selection and
            // forces the canvas to redraw the box + resize handles.
            editor.select(sel);
            refreshSelectionSnapshotRef.current?.();
          } catch { /* ignore */ }
        },
        setCropMode: (on: boolean) => {
          cropModeRef.current = on;
        },
        collectColorsFromSelection: () => collectColorsFromSelection(editorRef.current),
        replaceColors: (targets: string[], replacement: string) => replaceColorsInSelection(editorRef.current, targets, replacement),
        getEditor: () => editorRef.current ?? null,
      }),
      [html, layersPanelRef, stylePanelRef],
    );

    const rootClass = useMemo(() => {
      const parts = [styles.root];
      if (className) parts.push(className);
      return parts.filter(Boolean).join(' ');
    }, [className]);

    return (
      <div className={rootClass} ref={rootRef}>
        {loading ? (
          <div className={styles.loadingShell} role="status" aria-live="polite">
            <span className={styles.loadingSpinner} aria-hidden />
            <span className={styles.loadingText}>Loading canvas…</span>
          </div>
        ) : null}
        {loadError ? (
          <div className={styles.errorShell} role="alert">
            Canvas failed to load: {loadError}
          </div>
        ) : null}
        <div
          ref={containerRef}
          className={styles.canvas}
          // Inline-block so GrapesJS's internal sizing has a baseline.
          style={{ display: loading ? 'none' : 'block' }}
        />
        {ctxMenu ? (
          <CanvasContextMenu
            editor={editorRef.current}
            components={ctxMenu.components}
            screenX={ctxMenu.screenX}
            screenY={ctxMenu.screenY}
            onSelect={(comp) => {
              try { editorRef.current?.select(comp); } catch { /* ignore */ }
              setCtxMenu(null);
            }}
            onClose={() => {
              try { (editorRef.current as unknown as { setHovered?: (c: unknown) => void })?.setHovered?.(null); } catch { /* ignore */ }
              setCtxMenu(null);
            }}
          />
        ) : null}
      </div>
    );
  },
);

export default GrapesjsEditor;
