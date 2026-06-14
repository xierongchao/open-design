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
  'backgroundColor','backgroundImage','opacity',
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
  if (!el) return fallback();
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
                bottom: -5px;
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
          const ZOOM_SENSITIVITY = 0.0012;
          const MAX_WHEEL_DELTA_PER_EVENT = 40;
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
                  const { display, direction } = readParentFlexInfo(parent);
                  const isFlexOrGrid = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid';
                  const reorderSibling = (container: Component, forward: boolean) => {
                    const comps = container.components();
                    const idx = (() => {
                      for (let i = 0; i < comps.length; i += 1) { if (comps.get(i) === sel) return i; }
                      return -1;
                    })();
                    if (idx < 0) return;
                    const swapIdx = forward ? idx + 1 : idx - 1;
                    if (swapIdx < 0 || swapIdx >= comps.length) return;
                    // Use GrapesJS's Component.move() — the documented reorder
                    // API (grapes.mjs:28613). It handles the remove+re-add
                    // atomically with correct index adjustment (when moving
                    // forward within the same parent, the target index shifts
                    // by -1 after removal). The earlier manual remove({silent})
                    // + add({at}) left the component in a half-detached state
                    // and the reorder silently no-op'd.
                    try { sel.move(container, { at: swapIdx }); } catch { /* ignore */ }
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
              // Shift+A: wrap the current multi-selection in a flex container
              // (row by default; switch to column afterwards via the StylePanel
              // flow control or the arrow-key reorder). Figma-style "auto-layout
              // wrap": when ≥2 components are selected (and share a common
              // parent), insert a new <div display:flex> at the first selected
              // sibling's position and move all selected components into it. A
              // single selected element is also wrapped (handy for converting
              // one item to a flex frame).
              if (!readOnlyRef.current && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && (ev.key === 'a' || ev.key === 'A')) {
                if (isTextInputTarget(ev.target)) return;
                try {
                  const all = (editor.getSelectedAll?.() ?? []) as Component[];
                  if (all.length === 0) return;
                  ev.preventDefault();
                  // Resolve the common parent (all selected must share one for
                  // a contiguous wrap). If they don't, bail on the first mismatch.
                  const first = all[0] as Component;
                  const parent = first.parent?.();
                  if (!parent) return;
                  for (const c of all) {
                    if (c.parent?.() !== parent) return;
                  }
                  // Snapshot each selected element's computed width/height
                  // BEFORE wrapping. Once they become flex items, flex would
                  // otherwise shrink/stretch them to the container's main axis.
                  // We pin their current px size as inline style + flex-shrink:0
                  // so they keep the dimensions the user saw at selection time.
                  const pinnedStyles: Array<{ comp: Component; style: Record<string, string> }> = [];
                  for (const c of all) {
                    const el = getElementFromComponent(c);
                    if (!el) continue;
                    const win = el.ownerDocument.defaultView;
                    if (!win) continue;
                    try {
                      const cs = win.getComputedStyle(el);
                      const w = cs.getPropertyValue('width');
                      const h = cs.getPropertyValue('height');
                      const patch: Record<string, string> = { 'flex-shrink': '0' };
                      if (w && /\d/.test(w)) patch.width = w;
                      if (h && /\d/.test(h)) patch.height = h;
                      pinnedStyles.push({ comp: c, style: patch });
                    } catch { /* ignore — best-effort pin */ }
                  }
                  // Apply the pinned sizes BEFORE creating the flex wrapper, so
                  // the snapshot reflects the pre-flex layout (flex hasn't
                  // touched them yet).
                  for (const { comp, style: patch } of pinnedStyles) {
                    try {
                      const merged = { ...(comp.getStyle?.() ?? {}), ...patch } as Parameters<typeof comp.setStyle>[0];
                      comp.setStyle(merged);
                    } catch { /* ignore */ }
                  }
                  // Create the flex wrapper as a plain div component.
                  const wrapper = parent.append({
                    type: 'div',
                    style: { display: 'flex', flexDirection: 'row', gap: '8px' },
                  }) as unknown as Component | undefined;
                  const flexContainer = (Array.isArray(wrapper) ? wrapper[0] : wrapper) as Component | undefined;
                  if (!flexContainer) return;
                  // Move it to the position of the first selected sibling so the
                  // wrap lands where the selection started, not at the end.
                  const firstIdx = (() => {
                    const comps = parent.components();
                    for (let i = 0; i < comps.length; i += 1) { if (comps.get(i) === first) return i; }
                    return -1;
                  })();
                  if (firstIdx >= 0) {
                    try { flexContainer.move(parent, { at: firstIdx }); } catch { /* ignore */ }
                  }
                  // Move each selected component into the wrapper, preserving
                  // their relative order.
                  for (const c of all) {
                    try { c.move(flexContainer); } catch { /* ignore */ }
                  }
                  editor.select(flexContainer);
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
            doc.addEventListener('keydown', onDocKey, true);
            doc.addEventListener('keyup', onDocKeyUp, true);
            doc.addEventListener('keypress', onDocKeyPress, true);
            detachCanvasDocKeys = () => {
              try {
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
              // Image components own their dblclick (active state) — don't
              // intercept.
              if (type === 'image') return;
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
            detachNestedSelect = () => {
              try {
                doc.removeEventListener('click', onClick, true);
                doc.removeEventListener('dblclick', onDblClick, true);
                doc.removeEventListener('contextmenu', onCtxMenu, true);
                delete (doc as unknown as { __odNestedSelect?: true }).__odNestedSelect;
              } catch { /* ignore */ }
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
