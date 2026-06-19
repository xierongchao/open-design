import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { Component, Editor as GrapesjsEditorInstance, Plugin } from 'grapesjs';
import { odStableIdPlugin, odStableIdPluginKey } from './od-stable-id-plugin';
import { odResizablePlugin, odResizablePluginKey } from './od-resizable-plugin';
import CanvasContextMenu, { type CanvasCtxMenuState } from './CanvasContextMenu';
import {
  applyCanvasBodyAttributes,
  applyCanvasHeadAssets,
  areDocumentsEqual,
  extractSavedEditorCss,
  normalizeCanvasBodyHtml,
  parseHtmlDocument,
  readCanvasBodyStyleOverrides,
  reassembleDocument,
  resolveCanvasBodyAssetUrls,
  restoreCanvasBodyAssetUrls,
  type ParsedDocument,
} from './html-document';
import {
  ensureComponentOdId,
  getComponentFromElement,
  getElementFromComponent,
  getOdIdFromComponent,
  resolveComponentForHostSelection,
} from './grapesjs-bridge-adapter';
import {
  createSelectionColorCollector,
  replaceColorsInSelection,
} from './grapesjs-selection-colors';
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

export function mergeSelectionSnapshotStyles(
  computed: Record<string, string>,
  authored: Record<string, string>,
): Record<string, string> {
  const out = { ...computed };
  for (const key of ['width', 'height'] as const) {
    const authoredValue = authored[key];
    if (typeof authoredValue === 'string' && authoredValue.trim()) {
      out[key] = authoredValue;
    }
  }
  return out;
}

function toCssStyleProps(styles: Record<string, string>): Record<string, string> {
  // Convert kebab-case CSS prop names to camelCase for CSSStyleDeclaration assignment.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(styles)) {
    out[k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = v;
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

const CANVAS_BODY_STYLE_PROPS = [
  'backgroundColor',
  'backgroundImage',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'color',
  'opacity',
] as const;

const FLEX_CHILD_HOVER_CLASS = 'od-flex-child-hover';
export type GrapesjsSelectionTone = 'default' | 'element-selection';
export type GrapesjsSelectionChrome = 'edit' | 'element-selection';
export type GrapesjsCanvasTool =
  | 'cursor'
  | 'rectangle'
  | 'line'
  | 'circle'
  | 'image'
  | 'text';
export type GrapesjsPlaceableCanvasTool = Exclude<GrapesjsCanvasTool, 'cursor'>;
export type GrapesjsCanvasPlacementMode = 'absolute' | 'flow';
export type GrapesjsPlacementChangePhase = 'insert' | 'finish' | 'cancel';

export interface GrapesjsCanvasPoint {
  x: number;
  y: number;
}

export interface GrapesjsCanvasToolComponentOptions {
  width?: number;
  height?: number;
  angle?: number;
  mode?: GrapesjsCanvasPlacementMode;
}

type GrapesjsAppendTarget = { append?: (...args: any[]) => unknown };

function grapesjsSelectionColor(tone: GrapesjsSelectionTone | undefined): string {
  return tone === 'element-selection' ? '#10b981' : '#3b82f6';
}

export function isGrapesjsPlaceableCanvasTool(tool: GrapesjsCanvasTool): tool is GrapesjsPlaceableCanvasTool {
  return tool !== 'cursor';
}

export function scheduleGrapesjsPlacementChange(
  phase: GrapesjsPlacementChangePhase,
  scheduleEmit: (() => void) | null | undefined,
): void {
  if (phase === 'insert') return;
  scheduleEmit?.();
}

export function isGrapesjsEditorEditing(editor: unknown): boolean {
  const direct = (editor as { isEditing?: unknown } | null)?.isEditing;
  if (typeof direct === 'function') {
    try {
      return Boolean(direct.call(editor));
    } catch {
      return false;
    }
  }
  const model = (() => {
    try {
      return (editor as { getModel?: () => unknown } | null)?.getModel?.();
    } catch {
      return null;
    }
  })();
  const modelIsEditing = (model as { isEditing?: unknown } | null)?.isEditing;
  if (typeof modelIsEditing === 'function') {
    try {
      return Boolean(modelIsEditing.call(model));
    } catch {
      return false;
    }
  }
  const getEditing = (editor as { getEditing?: unknown } | null)?.getEditing;
  if (typeof getEditing === 'function') {
    try {
      return Boolean(getEditing.call(editor));
    } catch {
      return false;
    }
  }
  return false;
}

function clipboardItems(data: DataTransfer | null | undefined): DataTransferItem[] {
  return data?.items ? Array.from(data.items) : [];
}

function clipboardFiles(data: DataTransfer | null | undefined): File[] {
  const files = data?.files;
  if (!files) return [];
  const out: File[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files.item?.(i) ?? files[i];
    if (file) out.push(file);
  }
  return out;
}

export function firstGrapesjsClipboardImageFile(data: DataTransfer | null | undefined): File | null {
  for (const item of clipboardItems(data)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
    if (file) return file;
  }
  return clipboardFiles(data).find((file) => file.type.startsWith('image/')) ?? null;
}

export function clipboardHasImageFile(data: DataTransfer | null | undefined): boolean {
  return clipboardItems(data).some((item) => item.kind === 'file' && item.type.startsWith('image/')) ||
    Boolean(firstGrapesjsClipboardImageFile(data));
}

export function clipboardHasDocumentPayload(data: DataTransfer | null | undefined): boolean {
  const types = data?.types ? Array.from(data.types) : [];
  if (types.some((type) => type === 'text/html' || type === 'text/plain' || type === 'text/uri-list')) {
    return true;
  }
  return clipboardItems(data).some((item) => item.kind === 'string' && (
    item.type === 'text/html' ||
    item.type === 'text/plain' ||
    item.type === 'text/uri-list'
  ));
}

export function shouldHandleGrapesjsImagePaste({
  clipboardData,
  lastInternalPasteAt,
  now = Date.now(),
}: {
  clipboardData: DataTransfer | null | undefined;
  lastInternalPasteAt: number;
  now?: number;
}): boolean {
  if (!clipboardHasImageFile(clipboardData)) return false;
  if (now - lastInternalPasteAt < 600) return false;
  if (clipboardHasDocumentPayload(clipboardData)) return false;
  return true;
}

const GRAPESJS_CANVAS_TOOL_FILL = '#D9D9D9';
const GRAPESJS_CANVAS_TOOL_MIN_SIZE = 1;
const GRAPESJS_STYLE_CLIPBOARD_PROPS: Array<[string, string]> = [
  ['backgroundColor', 'background-color'],
  ['backgroundImage', 'background-image'],
  ['borderTopWidth', 'border-top-width'],
  ['borderRightWidth', 'border-right-width'],
  ['borderBottomWidth', 'border-bottom-width'],
  ['borderLeftWidth', 'border-left-width'],
  ['borderStyle', 'border-style'],
  ['borderColor', 'border-color'],
  ['borderRadius', 'border-radius'],
  ['paddingTop', 'padding-top'],
  ['paddingRight', 'padding-right'],
  ['paddingBottom', 'padding-bottom'],
  ['paddingLeft', 'padding-left'],
  ['opacity', 'opacity'],
  ['fontFamily', 'font-family'],
  ['fontSize', 'font-size'],
  ['fontWeight', 'font-weight'],
  ['lineHeight', 'line-height'],
  ['letterSpacing', 'letter-spacing'],
  ['textAlign', 'text-align'],
  ['color', 'color'],
];

function px(value: number): string {
  return `${Math.max(GRAPESJS_CANVAS_TOOL_MIN_SIZE, Math.round(value))}px`;
}

export function buildGrapesjsCssStyleClipboard(style: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [camelKey, cssKey] of GRAPESJS_STYLE_CLIPBOARD_PROPS) {
    const value = style[camelKey]?.trim();
    if (value) out[cssKey] = value;
  }
  return out;
}

export function offsetGrapesjsAbsolutePositionStyle(
  style: Record<string, string | undefined>,
  offset: { x: number; y: number },
): Record<string, string | undefined> {
  if (style.position !== 'absolute') return { ...style };
  const parsePx = (value: string | undefined): number | null => {
    const match = value?.match(/^-?\d+(?:\.\d+)?px$/);
    return match ? Number.parseFloat(match[0]) : null;
  };
  const left = parsePx(style.left);
  const top = parsePx(style.top);
  return {
    ...style,
    ...(left == null ? {} : { left: `${Math.round(left + offset.x)}px` }),
    ...(top == null ? {} : { top: `${Math.round(top + offset.y)}px` }),
  };
}

function parseCssPxStrict(value: unknown): number | null {
  const match = String(value ?? '').trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveGrapesjsPositionedToolDragOrigin(input: {
  styleLeft?: unknown;
  styleTop?: unknown;
  elementRect?: Pick<DOMRect, 'left' | 'top'> | null;
  rootRect?: Pick<DOMRect, 'left' | 'top'> | null;
}): { left: number; top: number } {
  const fallbackLeft = input.elementRect && input.rootRect ? input.elementRect.left - input.rootRect.left : 0;
  const fallbackTop = input.elementRect && input.rootRect ? input.elementRect.top - input.rootRect.top : 0;
  return {
    left: parseCssPxStrict(input.styleLeft) ?? fallbackLeft,
    top: parseCssPxStrict(input.styleTop) ?? fallbackTop,
  };
}

function basePlacedStyle(
  point: GrapesjsCanvasPoint,
  width: number,
  height: number,
  mode: GrapesjsCanvasPlacementMode,
): Record<string, string> {
  const size = {
    width: px(width),
    height: px(height),
    'box-sizing': 'border-box',
  };
  if (mode === 'flow') return size;
  return {
    ...size,
    position: 'absolute',
    left: `${Math.max(0, Math.round(point.x))}px`,
    top: `${Math.max(0, Math.round(point.y))}px`,
  };
}

export function getGrapesjsCanvasToolDragStyle(
  tool: GrapesjsPlaceableCanvasTool,
  start: GrapesjsCanvasPoint,
  current: GrapesjsCanvasPoint,
  mode: GrapesjsCanvasPlacementMode = 'absolute',
  options: { lockAspect?: boolean } = {},
): Record<string, string> {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  if (tool === 'line') {
    const length = Math.max(GRAPESJS_CANVAS_TOOL_MIN_SIZE, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return {
      ...basePlacedStyle(start, length, 2, mode),
      transform: `rotate(${Number(angle.toFixed(2))}deg)`,
      'transform-origin': 'left center',
    };
  }
  let width = Math.max(GRAPESJS_CANVAS_TOOL_MIN_SIZE, dx);
  let height = Math.max(GRAPESJS_CANVAS_TOOL_MIN_SIZE, dy);
  if (options.lockAspect) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }
  return basePlacedStyle(start, width, height, mode);
}

export type GrapesjsRadiusCorner = 'tl' | 'tr' | 'bl' | 'br';

export function calculateGrapesjsCornerRadiusFromPointer(input: {
  corner: GrapesjsRadiusCorner;
  localX: number;
  localY: number;
  width: number;
  height: number;
  zoom: number;
  handleInset: number;
  axis?: 'x' | 'y' | null;
}): number {
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;
  if (input.width <= 1 || input.height <= 1) return 0;
  const xDist = input.corner.endsWith('r') ? input.width - input.localX : input.localX;
  const yDist = input.corner.startsWith('b') ? input.height - input.localY : input.localY;
  const xRadius = xDist - input.handleInset;
  const yRadius = yDist - input.handleInset;
  const screenRadius = input.axis === 'x'
    ? xRadius
    : input.axis === 'y'
      ? yRadius
      : (xRadius > 0 && yRadius > 0 ? Math.min(xRadius, yRadius) : Math.max(xRadius, yRadius));
  const maxRadius = Math.max(0, Math.min(input.width, input.height) / 2 / zoom);
  return Math.round(Math.max(0, Math.min(maxRadius, screenRadius / zoom)));
}

export function calculateGrapesjsCornerRadiusDrag(input: {
  corner: GrapesjsRadiusCorner;
  startRadius: number;
  deltaX: number;
  deltaY: number;
  width: number;
  height: number;
  zoom: number;
  axis?: 'x' | 'y' | null;
}): number {
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;
  if (input.width <= 1 || input.height <= 1) return 0;
  const inwardX = input.corner.endsWith('r') ? -input.deltaX : input.deltaX;
  const inwardY = input.corner.startsWith('b') ? -input.deltaY : input.deltaY;
  const screenDelta = (() => {
    if (input.axis === 'x') return inwardX;
    if (input.axis === 'y') return inwardY;
    if (inwardX > 0 && inwardY > 0) return Math.min(inwardX, inwardY);
    const positiveDelta = Math.max(inwardX, inwardY);
    return positiveDelta > 0 ? positiveDelta : Math.min(inwardX, inwardY);
  })();
  const maxRadius = Math.max(0, Math.min(input.width, input.height) / 2 / zoom);
  return Math.round(Math.max(0, Math.min(maxRadius, input.startRadius + screenDelta / zoom)));
}

export function calculateGrapesjsRadiusHandleInset(input: {
  radius: number;
  zoom: number;
  width: number;
  height: number;
  minInset: number;
  edgePadding?: number;
}): number {
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;
  const edgePadding = input.edgePadding ?? 8;
  const maxInset = Math.max(0, Math.min(input.width, input.height) / 2 - edgePadding);
  return Math.min(maxInset, input.minInset + Math.max(0, input.radius) * zoom);
}

export function buildGrapesjsCanvasToolComponent(
  tool: GrapesjsPlaceableCanvasTool,
  point: GrapesjsCanvasPoint,
  options: GrapesjsCanvasToolComponentOptions = {},
): Record<string, unknown> {
  const mode = options.mode ?? 'absolute';
  const commonAttrs = {
    'data-od-canvas-tool': tool,
    'data-od-position-mode': mode,
  };
  if (tool === 'rectangle') {
    return {
      tagName: 'div',
      attributes: commonAttrs,
      style: {
        ...basePlacedStyle(point, options.width ?? 160, options.height ?? 96, mode),
        background: GRAPESJS_CANVAS_TOOL_FILL,
        border: '0',
        'border-radius': '2px',
      },
    };
  }
  if (tool === 'circle') {
    return {
      tagName: 'div',
      attributes: commonAttrs,
      style: {
        ...basePlacedStyle(point, options.width ?? 112, options.height ?? 112, mode),
        background: GRAPESJS_CANVAS_TOOL_FILL,
        border: '0',
        'border-radius': '999px',
      },
    };
  }
  if (tool === 'line') {
    return {
      tagName: 'div',
      attributes: commonAttrs,
      style: {
        ...basePlacedStyle(point, options.width ?? 180, 2, mode),
        background: GRAPESJS_CANVAS_TOOL_FILL,
        border: '0',
        transform: `rotate(${options.angle ?? 0}deg)`,
        'transform-origin': 'left center',
      },
    };
  }
  if (tool === 'text') {
    const positionedStyle: Record<string, string> = mode === 'flow'
      ? {}
      : {
          position: 'absolute',
          left: `${Math.max(0, Math.round(point.x))}px`,
          top: `${Math.max(0, Math.round(point.y))}px`,
        };
    if (options.width !== undefined) positionedStyle.width = px(options.width);
    if (options.height !== undefined) positionedStyle['min-height'] = px(options.height);
    return {
      type: 'text',
      tagName: 'div',
      attributes: commonAttrs,
      editable: true,
      droppable: false,
      content: '输入文本',
      style: {
        ...positionedStyle,
        color: '#111827',
        'font-family': 'system-ui, sans-serif',
        'font-size': '14px',
        'font-weight': '400',
        'line-height': '20px',
        display: 'inline-block',
        'min-width': '24px',
        'min-height': '20px',
        'white-space': 'pre-wrap',
        'overflow-wrap': 'break-word',
        padding: '0',
        background: 'transparent',
      },
    };
  }
  return {
    tagName: 'div',
    attributes: commonAttrs,
    style: {
      ...basePlacedStyle(point, options.width ?? 240, options.height ?? 160, mode),
      background: GRAPESJS_CANVAS_TOOL_FILL,
      border: '0',
      'background-size': 'cover',
      'background-position': 'center',
      'background-repeat': 'no-repeat',
    },
  };
}

function firstGrapesjsComponent(created: unknown): Component | null {
  if (Array.isArray(created)) return (created[0] as Component | undefined) ?? null;
  return (created as Component | null | undefined) ?? null;
}

export function appendGrapesjsCanvasToolComponent(
  editor: unknown,
  tool: GrapesjsPlaceableCanvasTool,
  point: GrapesjsCanvasPoint,
  options: GrapesjsCanvasToolComponentOptions & { parent?: GrapesjsAppendTarget | null } = {},
): Component | null {
  const component = buildGrapesjsCanvasToolComponent(tool, point, options);
  const editorLike = editor as {
    addComponents?: (components: unknown) => unknown;
    getWrapper?: () => { append?: (components: unknown) => unknown } | null;
    Components?: {
      getWrapper?: () => { append?: (components: unknown) => unknown } | null;
      getComponents?: () => { get?: (index: number) => { append?: (components: unknown) => unknown } | null };
    };
  } | null;
  if (options.parent) {
    try {
      return firstGrapesjsComponent(options.parent.append?.(component));
    } catch {
      return null;
    }
  }
  try {
    const added = editorLike?.addComponents?.(component);
    const node = firstGrapesjsComponent(added);
    if (node) return node;
  } catch {
    // fall through to wrapper append
  }
  try {
    const wrapper =
      editorLike?.getWrapper?.() ??
      editorLike?.Components?.getWrapper?.() ??
      editorLike?.Components?.getComponents?.().get?.(0);
    const added = wrapper?.append?.(component);
    return firstGrapesjsComponent(added);
  } catch {
    return null;
  }
}

function getComponentAttributes(comp: Component | null | undefined): Record<string, unknown> {
  try { return comp?.getAttributes?.() ?? {}; } catch { return {}; }
}

function setComponentAttributes(comp: Component, patch: Record<string, string>): void {
  try {
    comp.setAttributes?.({ ...getComponentAttributes(comp), ...patch });
  } catch { /* ignore */ }
}

function getComponentStyleRecord(comp: Component | null | undefined): Record<string, string> {
  try { return { ...(comp?.getStyle?.() ?? {}) } as Record<string, string>; } catch { return {}; }
}

function toCssPropertyName(prop: string): string {
  return prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

export function clearGrapesjsManagedInlineStyle(
  comp: Component | null | undefined,
  props?: Iterable<string>,
): void {
  const el = getElementFromComponent(comp) as HTMLElement | null;
  if (!el?.style) return;
  const styleProps = props ? Array.from(props) : Object.keys(getComponentStyleRecord(comp));
  for (const prop of styleProps) {
    try { el.style.removeProperty(toCssPropertyName(prop)); } catch { /* ignore */ }
  }
  try {
    if (el.style.length === 0) el.removeAttribute('style');
  } catch { /* ignore */ }
}

const ABSOLUTE_PLACEMENT_STYLE_PROPS = ['position', 'left', 'top', 'right', 'bottom'] as const;

function clearComponentAbsolutePlacement(comp: Component): void {
  const next = getComponentStyleRecord(comp);
  for (const prop of ABSOLUTE_PLACEMENT_STYLE_PROPS) {
    delete next[prop];
  }
  comp.setStyle?.({
    ...next,
    position: '',
    left: '',
    top: '',
    right: '',
    bottom: '',
  } as Parameters<typeof comp.setStyle>[0]);
  for (const prop of ABSOLUTE_PLACEMENT_STYLE_PROPS) {
    try { comp.removeStyle?.(prop); } catch { /* ignore */ }
  }
  const el = getElementFromComponent(comp) as HTMLElement | null;
  if (el?.style) {
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
  }
}

export function isGrapesjsCanvasToolComponent(comp: Component | null | undefined): boolean {
  return Boolean(getComponentAttributes(comp)['data-od-canvas-tool']);
}

export function isGrapesjsAbsoluteCanvasToolComponent(comp: Component | null | undefined): boolean {
  const attrs = getComponentAttributes(comp);
  return Boolean(attrs['data-od-canvas-tool']) && attrs['data-od-position-mode'] === 'absolute';
}

export function isGrapesjsPositionedDragComponent(comp: Component | null | undefined): boolean {
  const attrs = getComponentAttributes(comp);
  if (attrs['data-od-position-mode'] !== 'absolute') return false;
  return Boolean(attrs['data-od-canvas-tool']) || attrs['data-od-auto-layout-wrapper'] === 'true';
}

export function findGrapesjsPositionedDragComponent(comp: Component | null | undefined): Component | null {
  let node: Component | null | undefined = comp;
  while (node) {
    if (isGrapesjsPositionedDragComponent(node)) return node;
    const parent = node.parent?.();
    if (!parent || parent === node) break;
    node = parent;
  }
  return null;
}

function isGrapesjsAutoLayoutWrapper(comp: Component | null | undefined): boolean {
  return getComponentAttributes(comp)['data-od-auto-layout-wrapper'] === 'true';
}

type GrapesjsLayoutAxis = 'row' | 'column';

type GrapesjsComponentBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function componentBox(comp: Component, rootRect?: DOMRect | null): GrapesjsComponentBox | null {
  const el = getElementFromComponent(comp) as HTMLElement | null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const originLeft = rootRect?.left ?? 0;
  const originTop = rootRect?.top ?? 0;
  const left = rect.left - originLeft;
  const top = rect.top - originTop;
  return {
    x: left,
    y: top,
    w: rect.width,
    h: rect.height,
    left,
    top,
    right: left + rect.width,
    bottom: top + rect.height,
  };
}

function canvasDocumentRootRect(editor: GrapesjsEditorInstance): DOMRect | null {
  try {
    const doc = editor.Canvas.getDocument?.();
    const root = doc?.body ?? doc?.documentElement ?? null;
    return root?.getBoundingClientRect?.() ?? null;
  } catch {
    return null;
  }
}

function componentCoordinateRootRect(editor: GrapesjsEditorInstance, parent: Component): DOMRect | null {
  const parentEl = getElementFromComponent(parent) as HTMLElement | null;
  if (parentEl) return parentEl.getBoundingClientRect();
  return canvasDocumentRootRect(editor);
}

function directComponentIndex(parent: Component, child: Component): number {
  try {
    const children = parent.components();
    for (let i = 0; i < children.length; i += 1) {
      if (children.get(i) === child) return i;
    }
  } catch { /* ignore */ }
  return -1;
}

function directComponentChildren(parent: Component): Component[] {
  const out: Component[] = [];
  try {
    const children = parent.components();
    for (let i = 0; i < children.length; i += 1) {
      const child = children.get(i);
      if (child) out.push(child);
    }
  } catch { /* ignore */ }
  return out;
}

function inferLayoutAxis(boxes: GrapesjsComponentBox[]): GrapesjsLayoutAxis {
  if (boxes.length < 2) return 'row';
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return (right - left) >= (bottom - top) ? 'row' : 'column';
}

function averageMainAxisGap(boxes: GrapesjsComponentBox[], axis: GrapesjsLayoutAxis): number {
  if (boxes.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < boxes.length; i += 1) {
    const prev = boxes[i - 1];
    const cur = boxes[i];
    if (!prev || !cur) continue;
    total += axis === 'row'
      ? Math.max(0, cur.left - prev.right)
      : Math.max(0, cur.top - prev.bottom);
  }
  return Math.round(total / Math.max(1, boxes.length - 1));
}

function normalizeGrapesjsAutoLayoutChildForFlow(comp: Component): void {
  const attrs = getComponentAttributes(comp);
  const style = getComponentStyleRecord(comp);
  const isOdCanvasTool = Boolean(attrs['data-od-canvas-tool']);
  const wasAbsolute = attrs['data-od-position-mode'] === 'absolute' || style.position === 'absolute';
  if (!isOdCanvasTool && !wasAbsolute) return;
  clearComponentAbsolutePlacement(comp);
  if (isOdCanvasTool || attrs['data-od-position-mode']) {
    setComponentAttributes(comp, { 'data-od-position-mode': 'flow' });
  }
}

function updateGrapesjsAutoLayoutWrapperAxis(wrapper: Component, axis: GrapesjsLayoutAxis): void {
  const style = getComponentStyleRecord(wrapper);
  delete style.flexDirection;
  delete style['flex-direction'];
  delete style.flexWrap;
  delete style['flex-wrap'];
  wrapper.setStyle?.({
    ...style,
    display: 'flex',
    flexDirection: axis,
    'flex-direction': axis,
    flexWrap: 'nowrap',
    'flex-wrap': 'nowrap',
  } as Parameters<typeof wrapper.setStyle>[0]);
  for (const child of directComponentChildren(wrapper)) {
    normalizeGrapesjsAutoLayoutChildForFlow(child);
  }
}

function updateSelectedGrapesjsAutoLayoutWrapperAxis(
  editor: GrapesjsEditorInstance,
  axis: GrapesjsLayoutAxis,
): boolean {
  const selected = (() => {
    try { return editor.getSelected?.() as Component | undefined; } catch { return undefined; }
  })();
  if (!isGrapesjsAutoLayoutWrapper(selected)) return false;
  updateGrapesjsAutoLayoutWrapperAxis(selected as Component, axis);
  try { editor.select(selected); } catch { /* ignore */ }
  return true;
}

function selectedComponentsForLayout(
  editor: GrapesjsEditorInstance,
  selectionOrder: Component[],
): Component[] {
  const selected = (() => {
    try { return (editor.getSelectedAll?.() ?? []) as Component[]; } catch { return []; }
  })();
  const selectedSet = new Set(selected);
  const ordered = selectionOrder.filter((comp) => selectedSet.has(comp));
  const out: Component[] = [];
  for (const comp of [...ordered, ...selected]) {
    if (comp?.parent?.() && !out.includes(comp)) out.push(comp);
  }
  return out;
}

export function arrangeGrapesjsSelectionAsFlex(
  editor: GrapesjsEditorInstance,
  selectionOrder: Component[] = [],
  preferredAxis?: GrapesjsLayoutAxis,
): boolean {
  if (preferredAxis && updateSelectedGrapesjsAutoLayoutWrapperAxis(editor, preferredAxis)) return true;
  const picked = selectedComponentsForLayout(editor, selectionOrder);
  if (picked.length === 0) return false;
  const parents = new Set(picked.map((comp) => comp.parent?.() ?? null));
  if (parents.size !== 1) return false;
  const parent = picked[0]?.parent?.();
  if (!parent) return false;
  const parentRect = componentCoordinateRootRect(editor, parent);
  const items = picked
    .map((comp) => ({ comp, box: componentBox(comp, parentRect) }))
    .filter((item): item is { comp: Component; box: GrapesjsComponentBox } => Boolean(item.box));
  if (items.length === 0) return false;
  const absoluteItems = items.every(({ comp }) => isGrapesjsAbsoluteCanvasToolComponent(comp));
  const axis = preferredAxis ?? inferLayoutAxis(items.map((item) => item.box));
  items.sort((a, b) => axis === 'row'
    ? (a.box.left - b.box.left) || (a.box.top - b.box.top)
    : (a.box.top - b.box.top) || (a.box.left - b.box.left));
  const boxes = items.map((item) => item.box);
  const minX = Math.min(...boxes.map((box) => box.left));
  const minY = Math.min(...boxes.map((box) => box.top));
  const maxX = Math.max(...boxes.map((box) => box.right));
  const maxY = Math.max(...boxes.map((box) => box.bottom));
  const wrapW = Math.max(1, Math.round(maxX - minX));
  const wrapH = Math.max(1, Math.round(maxY - minY));
  const gap = averageMainAxisGap(boxes, axis);
  const firstPicked = items[0]?.comp;
  if (!firstPicked) return false;
  const firstIndex = directComponentIndex(parent, firstPicked);
  const created = parent.append(
    {
      tagName: 'div',
      attributes: {
        'data-od-auto-layout-wrapper': 'true',
        'data-od-position-mode': absoluteItems ? 'absolute' : 'flow',
      },
      style: {
        display: 'flex',
        'flex-direction': axis,
        gap: `${gap}px`,
        width: `${wrapW}px`,
        height: `${wrapH}px`,
        'box-sizing': 'border-box',
        ...(absoluteItems
          ? { position: 'absolute', left: `${Math.round(minX)}px`, top: `${Math.round(minY)}px` }
          : {}),
      },
    } as never,
    { at: firstIndex >= 0 ? firstIndex : parent.components().length } as never,
  );
  const wrapper = (Array.isArray(created) ? created[0] : created) as Component | null;
  if (!wrapper) return false;
  items.forEach(({ comp }, index) => {
    try {
      if (absoluteItems) {
        clearComponentAbsolutePlacement(comp);
        setComponentAttributes(comp, { 'data-od-position-mode': 'flow' });
      }
      comp.move(wrapper, { at: index });
    } catch { /* ignore */ }
  });
  try { editor.select(wrapper); } catch { /* ignore */ }
  return true;
}

export function dissolveGrapesjsFlexSelection(editor: GrapesjsEditorInstance): boolean {
  const selected = (() => {
    try { return editor.getSelected?.() as Component | undefined; } catch { return undefined; }
  })();
  if (!selected) return false;
  const parent = selected.parent?.();
  if (!parent) return false;
  const el = getElementFromComponent(selected) as HTMLElement | null;
  const parentRect = componentCoordinateRootRect(editor, parent);
  const style = getComponentStyleRecord(selected);
  const display = (() => {
    if (style.display) return style.display;
    try { return el?.ownerDocument.defaultView?.getComputedStyle(el).getPropertyValue('display') ?? ''; } catch { return ''; }
  })();
  const attrs = getComponentAttributes(selected);
  const isAutoLayoutWrapper = attrs['data-od-auto-layout-wrapper'] === 'true';
  const isLayout = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid';
  if (!isAutoLayoutWrapper || !isLayout) return false;
  const shouldRestoreAbsolute = attrs['data-od-position-mode'] === 'absolute';
  const containerIndex = directComponentIndex(parent, selected);
  const children = directComponentChildren(selected);
  const childBoxes = new Map<Component, GrapesjsComponentBox>();
  if (shouldRestoreAbsolute) {
    for (const child of children) {
      const box = componentBox(child, parentRect);
      if (box) childBoxes.set(child, box);
    }
  }
  let insertAt = containerIndex >= 0 ? containerIndex : parent.components().length;
  for (const child of children.slice()) {
    try {
      child.move(parent, { at: insertAt });
      insertAt += 1;
      const box = childBoxes.get(child);
      if (box) {
        child.setStyle?.({
          ...getComponentStyleRecord(child),
          position: 'absolute',
          left: `${Math.round(box.left)}px`,
          top: `${Math.round(box.top)}px`,
          width: `${Math.round(box.w)}px`,
          height: `${Math.round(box.h)}px`,
        } as Parameters<typeof child.setStyle>[0]);
        setComponentAttributes(child, { 'data-od-position-mode': 'absolute' });
      }
    } catch { /* ignore */ }
  }
  try {
    selected.remove();
  } catch {
    delete style.display;
    delete style['flex-direction'];
    delete style.flexDirection;
    delete style['flex-wrap'];
    delete style.flexWrap;
    delete style['justify-content'];
    delete style.justifyContent;
    delete style['align-items'];
    delete style.alignItems;
    delete style.gap;
    selected.setStyle?.(style as Parameters<typeof selected.setStyle>[0]);
  }
  try { editor.select(children.length > 1 ? children : (children[0] ?? parent)); } catch { /* ignore */ }
  return true;
}

type GrapesjsCanvasViewportSyncEditor = {
  Canvas?: {
    getElement?: () => HTMLElement | null | undefined;
    getFrameEl?: () => HTMLElement | null | undefined;
    getDocument?: () => Document | null | undefined;
  };
  on?: (event: string, callback: () => void) => unknown;
  off?: (event: string, callback: () => void) => unknown;
};

export function attachGrapesjsCanvasViewportSync(
  editor: GrapesjsCanvasViewportSyncEditor,
  hostTargets: Array<EventTarget | null | undefined>,
  sync: () => void,
): () => void {
  const seen = new Set<EventTarget>();
  const scrollOptions: AddEventListenerOptions = { capture: true, passive: true };
  const addScrollTarget = (target: EventTarget | null | undefined) => {
    if (!target || seen.has(target)) return;
    seen.add(target);
    target.addEventListener('scroll', sync, scrollOptions);
  };
  const attachCurrentTargets = () => {
    hostTargets.forEach(addScrollTarget);
    const canvasEl = (() => {
      try { return editor.Canvas?.getElement?.() ?? null; } catch { return null; }
    })();
    addScrollTarget(canvasEl);
    if (canvasEl) {
      addScrollTarget(canvasEl.querySelector('.gjs-cv-canvas__frames'));
      addScrollTarget(canvasEl.querySelector('.gjs-cv-canvas'));
    }
    const frame = (() => {
      try { return editor.Canvas?.getFrameEl?.() ?? null; } catch { return null; }
    })();
    addScrollTarget(frame?.parentElement ?? null);
    const doc = (() => {
      try { return editor.Canvas?.getDocument?.() ?? null; } catch { return null; }
    })();
    addScrollTarget(doc);
    addScrollTarget(doc?.documentElement);
    addScrollTarget(doc?.body);
    addScrollTarget(doc?.defaultView);
  };
  attachCurrentTargets();
  try { editor.on?.('canvas:frame:load:body', attachCurrentTargets); } catch { /* ignore */ }
  return () => {
    for (const target of seen) {
      target.removeEventListener('scroll', sync, scrollOptions);
    }
    seen.clear();
    try { editor.off?.('canvas:frame:load:body', attachCurrentTargets); } catch { /* ignore */ }
  };
}

type GrapesjsResizePersistenceEditor = {
  on?: (event: string, callback: (payload?: unknown) => void) => unknown;
  off?: (event: string, callback: (payload?: unknown) => void) => unknown;
};

export function attachGrapesjsResizePersistence(
  editor: GrapesjsResizePersistenceEditor,
  handlers: {
    refreshGeometry: () => void;
    cleanupInlineStyle?: (payload?: unknown) => void;
    commitChange: () => void;
  },
): () => void {
  const onLiveResize = () => {
    handlers.refreshGeometry();
  };
  const onInteractionCommit = (payload?: unknown) => {
    handlers.refreshGeometry();
    handlers.cleanupInlineStyle?.(payload);
    handlers.commitChange();
  };
  const bindings: Array<[string, (payload?: unknown) => void]> = [
    ['component:resize', onLiveResize],
    ['component:resize:move', onLiveResize],
    ['component:resize:update', onLiveResize],
    ['component:resize:end', onInteractionCommit],
    ['component:drag:end', onInteractionCommit],
  ];
  for (const [event, callback] of bindings) {
    try { editor.on?.(event, callback); } catch { /* ignore */ }
  }
  return () => {
    for (const [event, callback] of bindings) {
      try { editor.off?.(event, callback); } catch { /* ignore */ }
    }
  };
}

function applyCanvasBodyStyleOverrides(
  editor: GrapesjsEditorInstance,
  styles: Record<string, string>,
) {
  const body = getCanvasBodyElFromEditor(editor);
  if (!body) return;
  const cssStyleProps = toCssStyleProps(styles);
  for (const prop of CANVAS_BODY_STYLE_PROPS) {
    if (!(prop in cssStyleProps)) {
      try {
        (body.style as unknown as Record<string, string>)[prop] = '';
      } catch {
        // ignore individual unsupported CSS properties
      }
    }
  }
  for (const [prop, value] of Object.entries(cssStyleProps)) {
    try {
      (body.style as unknown as Record<string, string>)[prop] = value;
    } catch {
      // ignore individual unsupported CSS properties
    }
  }
}

function mergeCanvasStyleSnapshot(
  computed: Record<string, string>,
  sourceOverrides: Record<string, string>,
): Record<string, string> {
  return { ...computed, ...sourceOverrides };
}

function nonEmptyStyleRecord(style: Record<string, string>): Record<string, string> | undefined {
  return Object.keys(style).length > 0 ? style : undefined;
}

export function stripGrapesjsCanvasSizeSentinel(html: string): string {
  return html.replace(
    /<div\b(?=[^>]*\bdata-od-id=(["'])gjs-size\1)(?=[^>]*\bdata-gjs-type=(["'])default\2)[^>]*>\s*<\/div>/gi,
    '',
  );
}

export function buildEditorDocument(
  editor: GrapesjsEditorInstance,
  parsed: ParsedDocument,
  baseHref?: string,
  canvasBodyStyle: Record<string, string> = {},
): string {
  const bodyHtml = normalizeCanvasBodyHtml(
    stripGrapesjsCanvasSizeSentinel(restoreCanvasBodyAssetUrls(editor.getHtml(), baseHref)),
  );
  return reassembleDocument(
    parsed,
    bodyHtml,
    editor.getCss() ?? '',
    nonEmptyStyleRecord(canvasBodyStyle),
  );
}

export function canvasComponentHtml(parsed: ParsedDocument, baseHref?: string): string {
  return normalizeCanvasBodyHtml(
    stripGrapesjsCanvasSizeSentinel(resolveCanvasBodyAssetUrls(parsed.bodyInner, baseHref)),
  );
}

function setEditorManagedCss(editor: GrapesjsEditorInstance, css: string): void {
  try {
    (editor as unknown as { setStyle?: (css: string) => unknown }).setStyle?.(css);
  } catch {
    // ignore
  }
}

function applyCanvasFrameSize(
  editor: GrapesjsEditorInstance,
  width: number,
  height: number,
) {
  try {
    const canvasEl = editor.Canvas.getElement?.() as HTMLElement | null | undefined;
    if (canvasEl) {
      canvasEl.style.setProperty('--od-gjs-frame-width', `${width}px`);
      canvasEl.style.setProperty('--od-gjs-frame-height', `${height}px`);
    }
  } catch {
    // ignore — direct frame sizing below is the source of truth
  }
  try {
    const frameModel = (editor.Canvas as unknown as {
      getFrame?: () => { set?: (attrs: Record<string, string>, opts?: Record<string, unknown>) => void };
    }).getFrame?.();
    frameModel?.set?.(
      { width: `${width}px`, height: `${height}px`, minHeight: `${height}px` },
      { noUndo: 1 },
    );
  } catch {
    // ignore — DOM sizing still keeps the visual frame correct
  }
  const frame = editor.Canvas.getFrameEl?.();
  if (!frame) return;
  const applySize = (el: HTMLElement | null | undefined) => {
    if (!el) return;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.minWidth = `${width}px`;
    el.style.maxWidth = `${width}px`;
    el.style.minHeight = `${height}px`;
    el.style.maxHeight = `${height}px`;
    el.style.flexBasis = `${width}px`;
  };
  applySize(frame);
  const wrapper = frame.parentElement as HTMLElement | null;
  applySize(wrapper);
  const frameBox = wrapper?.parentElement as HTMLElement | null;
  if (
    frameBox &&
    (
      frameBox.classList.contains('gjs-frame') ||
      frameBox.classList.contains('gjs-frame-wrapper')
    )
  ) {
    applySize(frameBox);
  }
  try {
    const doc = editor.Canvas.getDocument?.();
    if (doc?.documentElement) {
      doc.documentElement.style.width = `${width}px`;
      doc.documentElement.style.minWidth = '0';
    }
    if (doc?.body) {
      doc.body.style.width = `${width}px`;
      doc.body.style.minWidth = '0';
    }
  } catch {
    // ignore — frame sizing still succeeded
  }
}

export function calculateCanvasFitToViewport({
  frameWidth,
  frameHeight,
  canvasWidth,
  canvasHeight,
  padding = 48,
}: {
  frameWidth: number;
  frameHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  padding?: number;
}): { zoom: number; x: number; y: number } {
  if (canvasWidth < 50 || canvasHeight < 50 || frameWidth <= 0 || frameHeight <= 0) {
    return { zoom: 100, x: 0, y: 0 };
  }
  const availableWidth = Math.max(1, canvasWidth - padding);
  const availableHeight = Math.max(1, canvasHeight - padding);
  const widthRatio = frameWidth > 0 ? availableWidth / frameWidth : 1;
  const shouldFit = frameWidth > availableWidth;
  const nextZoom = shouldFit
    ? Math.max(25, Math.min(100, widthRatio * 100))
    : 100;
  const zoom = Number.isFinite(nextZoom) ? nextZoom : 100;
  const zoomScale = zoom / 100;
  const scaledHeight = frameHeight * zoomScale;
  const y = scaledHeight <= availableHeight
    ? Math.max(0, Math.round((canvasHeight - scaledHeight) / 2))
    : 0;
  return { zoom, x: 0, y };
}

export function getGrapesjsZoomStyleVars(zoom: number): {
  zoomDecimal: number;
  canvasHairline: string;
  screenHairline: string;
} {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 100;
  const zoomDecimal = Math.max(0.01, safeZoom / 100);
  return {
    zoomDecimal,
    canvasHairline: `${Number((1 / zoomDecimal).toFixed(4))}px`,
    screenHairline: '1px',
  };
}

export function getGrapesjsIframeSelectionOutlineCss(tone: GrapesjsSelectionTone = 'default'): string {
  const selectionColor = grapesjsSelectionColor(tone);
  return `
                  html body .gjs-selected,
                  html body .gjs-hovered,
                  .gjs-selected,
                  .gjs-hovered {
                    outline: var(--od-gjs-hairline, 1px) solid ${selectionColor} !important;
                    outline-offset: calc(-1 * var(--od-gjs-hairline, 1px)) !important;
                  }
                  .gjs-com-dashed * {
                    outline-width: var(--od-gjs-hairline, 1px) !important;
                  }
  `;
}

export function getGrapesjsIframeSelectionStyleCss(
  hoverClass: string,
  tone: GrapesjsSelectionTone = 'default',
): string {
  const selectionColor = grapesjsSelectionColor(tone);
  return `
                  .${hoverClass} {
                    outline: var(--od-gjs-hairline, 1px) dashed ${selectionColor} !important;
                    outline-offset: var(--od-gjs-hairline, 1px) !important;
                  }
                  ${getGrapesjsIframeSelectionOutlineCss(tone)}
  `;
}

export function upsertGrapesjsIframeSelectionStyle(
  doc: Document,
  hoverClass: string,
  tone: GrapesjsSelectionTone = 'default',
): boolean {
  const head = doc.head;
  if (!head) return false;
  const selector = 'style[data-od-flex-child-hover]';
  const styleEl = (
    head.querySelector(selector) as HTMLStyleElement | null
  ) ?? doc.createElement('style');
  styleEl.setAttribute('data-od-flex-child-hover', 'true');
  styleEl.textContent = getGrapesjsIframeSelectionStyleCss(hoverClass, tone);
  head.appendChild(styleEl);
  return true;
}

function fitCanvasFrameToViewport(editor: GrapesjsEditorInstance) {
  const size = readCanvasFrameSize(editor);
  const canvasEl = editor.Canvas.getElement?.() as HTMLElement | null | undefined;
  const rect = canvasEl?.getBoundingClientRect?.();
  const fit = calculateCanvasFitToViewport({
    frameWidth: size?.width ?? 0,
    frameHeight: size?.height ?? 0,
    canvasWidth: rect?.width ?? 0,
    canvasHeight: rect?.height ?? 0,
  });
  editor.Canvas.setZoom(fit.zoom);
  editor.Canvas.setCoords(fit.x, fit.y);
}

function readCanvasFrameSize(editor: GrapesjsEditorInstance): { width: number; height: number } | null {
  const frame = editor.Canvas.getFrameEl?.();
  if (!frame) return null;
  const width = Number.parseInt(frame.style.width || '', 10) || frame.offsetWidth || 0;
  const height = Number.parseInt(frame.style.height || '', 10) || frame.offsetHeight || 0;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
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

const GRAPESJS_CANVAS_CHROME_SELECTOR = [
  '.gjs-resizer',
  '.gjs-resizer-h',
  '.gjs-toolbar',
  '.od-radius-handle',
  '.od-radius-badge',
  '.od-dimension-badge',
  '.od-selection-stroke',
  '[data-od-spacing-kind]',
  '[data-od-spacing-band]',
].join(',');

export function isGrapesjsCanvasChromeTarget(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return Boolean(el?.closest?.(GRAPESJS_CANVAS_CHROME_SELECTOR));
}

type GrapesjsTextViewLike = {
  activeRte?: unknown;
  disableEditing?: (opts?: Record<string, unknown>) => unknown;
  onActive?: (event?: unknown) => unknown;
};

function readGrapesjsEditingModel(editor: unknown): unknown {
  const direct = (editor as { getEditing?: unknown } | null)?.getEditing;
  if (typeof direct === 'function') {
    try {
      const editing = direct.call(editor);
      if (editing) return editing;
    } catch {
      // Fall through to the editor model.
    }
  }
  const model = (() => {
    try {
      return (editor as { getModel?: () => unknown } | null)?.getModel?.();
    } catch {
      return null;
    }
  })();
  const fromModel = (model as { getEditing?: unknown } | null)?.getEditing;
  if (typeof fromModel === 'function') {
    try {
      return fromModel.call(model);
    } catch {
      return null;
    }
  }
  return null;
}

function textViewFromComponent(comp: unknown): GrapesjsTextViewLike | null {
  const directView = (comp as { view?: unknown } | null)?.view;
  if (directView && (
    typeof (directView as GrapesjsTextViewLike).disableEditing === 'function' ||
    typeof (directView as GrapesjsTextViewLike).onActive === 'function'
  )) {
    return directView as GrapesjsTextViewLike;
  }
  const getView = (comp as { getView?: unknown } | null)?.getView;
  if (typeof getView === 'function') {
    try {
      const view = getView.call(comp);
      if (view && (
        typeof (view as GrapesjsTextViewLike).disableEditing === 'function' ||
        typeof (view as GrapesjsTextViewLike).onActive === 'function'
      )) {
        return view as GrapesjsTextViewLike;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function addTextViewCandidate(candidates: GrapesjsTextViewLike[], view: GrapesjsTextViewLike | null) {
  if (!view || candidates.includes(view)) return;
  candidates.push(view);
}

export function stopGrapesjsRichTextEditing(editor: unknown): boolean {
  let stopped = false;
  const candidates: GrapesjsTextViewLike[] = [];
  addTextViewCandidate(candidates, textViewFromComponent(readGrapesjsEditingModel(editor)));
  try {
    addTextViewCandidate(candidates, textViewFromComponent((editor as { getSelected?: () => unknown }).getSelected?.()));
  } catch {
    // ignore
  }
  try {
    const doc = (editor as GrapesjsEditorInstance | null)?.Canvas?.getDocument?.();
    const active = doc?.activeElement as HTMLElement | null | undefined;
    if (active?.isContentEditable) {
      addTextViewCandidate(candidates, textViewFromComponent(getComponentFromElement(active)));
    }
  } catch {
    // ignore
  }

  candidates.forEach((view) => {
    try {
      view.disableEditing?.({ event: 'od-stop-text-editing' });
      stopped = true;
    } catch {
      // ignore
    }
  });

  try {
    const rte = (editor as { RichTextEditor?: { disable?: unknown } } | null)?.RichTextEditor;
    const disable = rte?.disable;
    if (typeof disable === 'function') {
      candidates.forEach((view) => {
        try {
          disable.call(rte, view, view.activeRte, { event: 'od-stop-text-editing' });
          stopped = true;
        } catch {
          // ignore
        }
      });
    }
  } catch {
    // ignore
  }

  try {
    const doc = (editor as GrapesjsEditorInstance | null)?.Canvas?.getDocument?.();
    const active = doc?.activeElement as HTMLElement | null | undefined;
    if (active?.isContentEditable) {
      active.blur();
      stopped = true;
    }
    doc?.defaultView?.getSelection?.()?.removeAllRanges?.();
  } catch {
    // ignore
  }
  return stopped;
}

export function stopGrapesjsTextEditingForPointerTarget(
  editor: unknown,
  target: EventTarget | null,
): boolean {
  if (isTextInputTarget(target)) return false;
  return stopGrapesjsRichTextEditing(editor);
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
  componentType?: string;
  canvasTool?: string;
  styles: Record<string, string>;
  selectedColors: string[];
}

export interface CanvasSnapshot {
  styles: Record<string, string>;
  size: { width: number; height: number } | null;
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
  /** Read canvas-level styles plus the current frame size. */
  getCanvasState(): CanvasSnapshot;
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
  /** Read the latest selection snapshot synchronously for host-side panel recovery. */
  getSelectionSnapshot(): SelectionSnapshot;
  /** Toggle canvas 裁剪 mode: when on, dragging the selected element pans its
   *  background-position and the wheel scales its background-size. */
  setCropMode(on: boolean): void;
  /** Replace any color in the selection's subtree that matches a target (by
   *  normalized hex) with `replacement`. Returns the count of edits applied. */
  replaceColors(targets: string[], replacement: string): number;
  /** Wrap the current selection in a flex auto-layout container. */
  arrangeSelectionAsFlex(axis?: 'row' | 'column'): boolean;
  /** Dissolve the selected flex auto-layout container back into positioned children when possible. */
  dissolveSelectedFlex(): boolean;
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
  /** Cmd/Ctrl+R handler — refreshes the host preview without reloading the app. */
  onReload?: () => void;
  /** Optional className for the root container. */
  className?: string;
  /** Host-controlled selection color: default editor blue or element-picker green. */
  selectionTone?: GrapesjsSelectionTone;
  /** Host-controlled selection chrome: full edit handles or selection-only picker. */
  selectionChrome?: GrapesjsSelectionChrome;
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
  /** Fired for Escape before GrapesJS clears selection, allowing host modes to close. */
  onEscapeKey?: () => void;
  /** Fires when the canvas zoom changes so the host can update its zoom % display. */
  onZoomChange?: (zoom: number) => void;
  /** Fires when the user changes the canvas frame size so the host can persist it. */
  onViewportSizeChange?: (width: number, height: number) => void;
  /**
   * Initial canvas frame size applied BEFORE first paint. Without this the
   * editor boots at GrapesJS's built-in default device (~1280px) and the host's
   * apply-viewport effect only corrects it after mount — causing a visible
   * "snap" from screen-size to the saved viewport (e.g. mobile 390×844). When
   * provided, the frame is sized right after grapesjs.init() returns, before
   * the first frame draws.
   */
  initialViewport?: { width: number; height: number };
  /**
   * Fires when the user double-clicks an <img> component. The host owns the
   * upload UI (the fill panel's image tab) so we suppress GrapesJS's native
   * asset-manager modal and hand control to the parent instead.
   */
  onImageEditRequest?: () => void;
  /** Host-selected bottom-toolbar tool. Non-cursor tools are placed on the next canvas click. */
  activeCanvasTool?: GrapesjsCanvasTool;
  /** Allows the editor to return the toolbar to cursor mode after placing an element. */
  onCanvasToolChange?: (tool: GrapesjsCanvasTool) => void;
  /** Fires in host comment mode when the user clicks a free point on the GrapesJS canvas. */
  onCanvasCommentPin?: (point: GrapesjsCanvasPoint) => void;
  /** Fires when the canvas frame position, zoom, or pan changes and host overlays should re-align. */
  onCanvasViewportChange?: () => void;
  /** Figma-style board label shown above the default GrapesJS frame. */
  artboardName?: string;
  /** Updates only the local board label; this intentionally does not rename the backing HTML file. */
  onArtboardNameChange?: (name: string) => void;
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
      onReload,
      className,
      selectionTone = 'default',
      selectionChrome = 'edit',
      onSelectTargets,
      onHoverTarget,
      onStyleUpdate,
      onTweaksAvailable,
      onSelectionChange,
      onEscapeKey,
      onZoomChange,
      onViewportSizeChange,
      initialViewport,
      onImageEditRequest,
      activeCanvasTool = 'cursor',
      onCanvasToolChange,
      onCanvasCommentPin,
      onCanvasViewportChange,
      artboardName = '画板1',
      onArtboardNameChange,
      layersPanelRef,
      stylePanelRef,
    } = props;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<GrapesjsEditorInstance | null>(null);
    const artboardLabelRef = useRef<HTMLDivElement | null>(null);
    const parsedRef = useRef<ParsedDocument | null>(null);
    const baseHrefRef = useRef<string | undefined>(baseHref);
    const lastExternalHtmlRef = useRef<string>(html);
    const lastEmittedRef = useRef<string>('');
    const readOnlyRef = useRef<boolean>(readOnly);
    const onChangeRef = useRef(onChange);
    const onDirtyChangeRef = useRef(onDirtyChange);
    const onSaveRef = useRef(onSave);
    const onReloadRef = useRef(onReload);
    const onSelectTargetsRef = useRef(onSelectTargets);
    const onHoverTargetRef = useRef(onHoverTarget);
    const onStyleUpdateRef = useRef(onStyleUpdate);
    const onTweaksAvailableRef = useRef(onTweaksAvailable);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onEscapeKeyRef = useRef(onEscapeKey);
    const onZoomChangeRef = useRef(onZoomChange);
    const onViewportSizeChangeRef = useRef(onViewportSizeChange);
    const onImageEditRequestRef = useRef(onImageEditRequest);
    const activeCanvasToolRef = useRef<GrapesjsCanvasTool>(activeCanvasTool);
    const onCanvasToolChangeRef = useRef(onCanvasToolChange);
    const onCanvasCommentPinRef = useRef(onCanvasCommentPin);
    const onCanvasViewportChangeRef = useRef(onCanvasViewportChange);
    const onArtboardNameChangeRef = useRef(onArtboardNameChange);
    activeCanvasToolRef.current = activeCanvasTool;
    onCanvasToolChangeRef.current = onCanvasToolChange;
    onCanvasCommentPinRef.current = onCanvasCommentPin;
    onCanvasViewportChangeRef.current = onCanvasViewportChange;
    onArtboardNameChangeRef.current = onArtboardNameChange;
    const selectionToneRef = useRef<GrapesjsSelectionTone>(selectionTone);
    const selectionChromeRef = useRef<GrapesjsSelectionChrome>(selectionChrome);
    const userCanvasSizeEditVersionRef = useRef(0);
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
    const readSelectionSnapshotRef = useRef<(() => SelectionSnapshot) | null>(null);
    const refreshSelectionSnapshotRef = useRef<(() => void) | null>(null);
    const syncZoomAttrRef = useRef<(() => void) | null>(null);
    const syncCoordsAttrRef = useRef<(() => void) | null>(null);
    const syncArtboardLabelPositionRef = useRef<(() => void) | null>(null);
    const syncCropOverlayRef = useRef<(() => void) | null>(null);
    const selectionColorCollectorRef = useRef(createSelectionColorCollector());
    const currentCanvasSizeRef = useRef<{ width: number; height: number } | null>(
      initialViewport ? { width: initialViewport.width, height: initialViewport.height } : null,
    );
    const currentCanvasStylesRef = useRef<Record<string, string>>({});
    const lastTweaksAvailableRef = useRef<boolean | null>(null);
    // Cmd+right-click layer-stack menu. The boot effect writes through
    // setCtxMenuRef (so the canvas-doc contextmenu handler can open it without
    // a React re-render of the editor), and ctxMenu drives the rendered
    // CanvasContextMenu below.
    const [ctxMenu, setCtxMenu] = useState<CanvasCtxMenuState | null>(null);
    const setCtxMenuRef = useRef<((menu: CanvasCtxMenuState | null) => void) | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [artboardLabelEditing, setArtboardLabelEditing] = useState(false);
    const [artboardLabelDraft, setArtboardLabelDraft] = useState(artboardName);

    useEffect(() => {
      if (!artboardLabelEditing) setArtboardLabelDraft(artboardName);
    }, [artboardLabelEditing, artboardName]);

    const syncArtboardLabelPosition = useCallback(() => {
      const editor = editorRef.current;
      const root = rootRef.current;
      const label = artboardLabelRef.current;
      if (!editor || !root || !label || loading || loadError) return;
      try {
        const frame = editor.Canvas.getFrameEl?.();
        const frameRect = frame?.getBoundingClientRect?.();
        const rootRect = root.getBoundingClientRect();
        if (!frameRect) {
          label.style.opacity = '0';
          onCanvasViewportChangeRef.current?.();
          return;
        }
        const labelTop = Math.round(frameRect.top - rootRect.top - 24);
        const labelLeft = Math.round(frameRect.left - rootRect.left);
        const isFrameVisible = frameRect.bottom > rootRect.top && frameRect.top < rootRect.bottom;
        const isLabelVisible = isFrameVisible && labelTop >= 0 && labelLeft < rootRect.width && labelLeft > -label.offsetWidth;
        label.style.left = `${labelLeft}px`;
        label.style.top = `${labelTop}px`;
        label.style.opacity = isLabelVisible ? '1' : '0';
        onCanvasViewportChangeRef.current?.();
      } catch {
        label.style.opacity = '0';
        onCanvasViewportChangeRef.current?.();
      }
    }, [loadError, loading]);

    syncArtboardLabelPositionRef.current = syncArtboardLabelPosition;

    useEffect(() => {
      const frame = window.requestAnimationFrame(syncArtboardLabelPosition);
      window.addEventListener('resize', syncArtboardLabelPosition);
      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener('resize', syncArtboardLabelPosition);
      };
    }, [syncArtboardLabelPosition, artboardName]);

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
      onReloadRef.current = onReload;
    }, [onReload]);
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
      onEscapeKeyRef.current = onEscapeKey;
    }, [onEscapeKey]);
    useEffect(() => {
      onZoomChangeRef.current = onZoomChange;
    }, [onZoomChange]);
    useEffect(() => {
      onViewportSizeChangeRef.current = onViewportSizeChange;
    }, [onViewportSizeChange]);
    useEffect(() => {
      onImageEditRequestRef.current = onImageEditRequest;
    }, [onImageEditRequest]);
    useEffect(() => {
      activeCanvasToolRef.current = activeCanvasTool;
      const cursor = isGrapesjsPlaceableCanvasTool(activeCanvasTool) ? 'crosshair' : '';
      try {
        const canvasEl = editorRef.current?.Canvas.getElement?.() as HTMLElement | null | undefined;
        if (canvasEl) canvasEl.style.cursor = cursor;
        const doc = editorRef.current?.Canvas.getDocument?.();
        if (doc?.body) doc.body.style.cursor = cursor;
      } catch {
        // ignore — cursor feedback is best-effort
      }
    }, [activeCanvasTool]);
    useEffect(() => {
      onCanvasToolChangeRef.current = onCanvasToolChange;
    }, [onCanvasToolChange]);
    useEffect(() => {
      onCanvasViewportChangeRef.current = onCanvasViewportChange;
    }, [onCanvasViewportChange]);
    useEffect(() => {
      selectionToneRef.current = selectionTone;
      const editor = editorRef.current;
      if (!editor) return;
      try {
        const doc = editor.Canvas.getDocument?.();
        if (doc) upsertGrapesjsIframeSelectionStyle(doc, FLEX_CHILD_HOVER_CLASS, selectionTone);
      } catch {
        // ignore
      }
    }, [selectionTone]);
    useEffect(() => {
      selectionChromeRef.current = selectionChrome;
      if (selectionChrome !== 'element-selection') return;
      const hostDoc = rootRef.current?.ownerDocument ?? document;
      rootRef.current
        ?.querySelectorAll<HTMLElement>('.od-dimension-badge, .od-selection-stroke, [data-od-spacing-kind], [data-od-spacing-band]')
        .forEach((el) => { el.style.display = 'none'; });
      hostDoc
        .querySelectorAll<HTMLElement>('[data-od-spacing-tip]')
        .forEach((el) => { el.style.display = 'none'; });
    }, [selectionChrome]);

    const applyLogicalCanvasSize = useCallback((width: number, height: number) => {
      const editor = editorRef.current;
      if (!editor || width <= 0 || height <= 0) return false;
      currentCanvasSizeRef.current = { width, height };
      try {
        applyCanvasFrameSize(editor, width, height);
        fitCanvasFrameToViewport(editor);
        syncZoomAttrRef.current?.();
        syncCoordsAttrRef.current?.();
        return true;
      } catch {
        return false;
      }
    }, []);

    useEffect(() => {
      if (!initialViewport) return undefined;
      const width = initialViewport.width;
      const height = initialViewport.height;
      currentCanvasSizeRef.current = { width, height };
      let raf = 0;
      let timeoutShort = 0;
      let timeoutLong = 0;
      const editVersion = userCanvasSizeEditVersionRef.current;
      const apply = () => {
        if (userCanvasSizeEditVersionRef.current !== editVersion) return;
        applyLogicalCanvasSize(width, height);
      };
      apply();
      raf = window.requestAnimationFrame(apply);
      timeoutShort = window.setTimeout(apply, 50);
      timeoutLong = window.setTimeout(apply, 250);
      return () => {
        if (raf) window.cancelAnimationFrame(raf);
        if (timeoutShort) window.clearTimeout(timeoutShort);
        if (timeoutLong) window.clearTimeout(timeoutLong);
      };
    }, [applyLogicalCanvasSize, initialViewport?.height, initialViewport?.width]);

    // Bridge the imperative setCtxMenuRef (written by the canvas-doc
    // contextmenu handler inside the boot effect) to React state so the
    // CanvasContextMenu portal renders.
    useEffect(() => {
      setCtxMenuRef.current = (menu) => setCtxMenu(menu);
      return () => { setCtxMenuRef.current = null; };
    }, []);
    useEffect(() => {
      baseHrefRef.current = baseHref;
      const doc = editorRef.current?.Canvas.getDocument() ?? null;
      applyCanvasHeadAssets(doc, parsedRef.current, baseHref);
      applyCanvasBodyAttributes(doc, parsedRef.current);
      const editor = editorRef.current;
      if (editor) applyCanvasBodyStyleOverrides(editor, currentCanvasStylesRef.current);
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
      const full = buildEditorDocument(editor, parsed, baseHrefRef.current, currentCanvasStylesRef.current);
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
          currentCanvasStylesRef.current = readCanvasBodyStyleOverrides(parsed);
          lastExternalHtmlRef.current = html;

          const editor = grapesjs.init({
            container: containerRef.current,
            // We feed GrapesJS just the body so <head>/<script>/external
            // CSS survive round-trips. The full document is reassembled
            // in emitChange().
            components: canvasComponentHtml(parsed, baseHrefRef.current),
            style: extractSavedEditorCss(parsed.head),
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
          // Apply the target canvas size BEFORE first paint. The frame element
          // exists immediately after init() returns, so sizing it here (before
          // 'load' fires and before React commits) avoids the visible "snap"
          // from the default device (~1280px) to the saved viewport. Without
          // this the host's apply-viewport effect only corrects the size after
          // mount, producing the flash the user reported.
          if (initialViewport) {
            try {
              currentCanvasSizeRef.current = { width: initialViewport.width, height: initialViewport.height };
              applyCanvasFrameSize(editor, initialViewport.width, initialViewport.height);
              fitCanvasFrameToViewport(editor);
            } catch { /* ignore — fall back to host apply-viewport effect */ }
          }
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
              .gjs-selected, .gjs-hovered {
                outline-color: var(--accent, #c96442) !important;
                outline-width: var(--od-gjs-screen-hairline, 1px) !important;
                outline-offset: calc(-1 * var(--od-gjs-screen-hairline, 1px)) !important;
              }
              .gjs-cv-canvas .gjs-highlighter {
                outline: var(--od-gjs-screen-hairline, 1px) solid var(--gjs-color-blue) !important;
                outline-offset: calc(-1 * var(--od-gjs-screen-hairline, 1px)) !important;
              }
              .gjs-cv-canvas .gjs-highlighter-sel {
                display: none !important;
                outline: 0 !important;
                box-shadow: none !important;
                border: 0 !important;
              }
              .gjs-cv-canvas__tools {
                display: block !important;
              }
              .gjs-cv-canvas__frame, .gjs-clm-tags { border-color: var(--accent, #c96442) !important; }
              .gjs-resizer {
                border: 0 !important;
                outline: 0 !important;
                box-shadow: none !important;
                pointer-events: none !important;
              }
              .gjs-resizer-h {
                background: transparent !important;
                border: 0 !important;
                box-sizing: border-box !important;
                opacity: 1 !important;
                pointer-events: auto !important;
              }
              .gjs-resizer-h-tl,
              .gjs-resizer-h-tr,
              .gjs-resizer-h-bl,
              .gjs-resizer-h-br {
                width: 10px !important;
                height: 10px !important;
                margin: -5px !important;
                background: #fff !important;
                border: var(--od-gjs-screen-hairline, 1px) solid var(--gjs-color-blue) !important;
                border-radius: 2px !important;
                z-index: 2;
              }
              .gjs-resizer-h-tc,
              .gjs-resizer-h-bc {
                left: 0 !important;
                right: 0 !important;
                width: 100% !important;
                height: 12px !important;
                margin: -6px 0 !important;
                z-index: 1;
              }
              .gjs-resizer-h-cl,
              .gjs-resizer-h-cr {
                top: 0 !important;
                bottom: 0 !important;
                width: 12px !important;
                height: 100% !important;
                margin: 0 -6px !important;
                z-index: 1;
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
              .od-selection-stroke {
                position: absolute;
                inset: 0;
                box-sizing: border-box;
                border: var(--od-gjs-screen-hairline, 1px) solid var(--gjs-color-blue);
                pointer-events: none;
                z-index: 10;
                display: none;
              }
              .od-radius-handle {
                position: absolute;
                width: 16px;
                height: 16px;
                margin: -8px 0 0 -8px;
                border: 0;
                border-radius: 50%;
                background: transparent;
                box-shadow: none;
                cursor: default;
                pointer-events: auto;
                touch-action: none;
                z-index: 24;
                display: none;
              }
              .od-radius-handle::after {
                content: "";
                position: absolute;
                left: 50%;
                top: 50%;
                width: 7px;
                height: 7px;
                border: 2px solid #1595ff;
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 1px 3px rgba(15,23,42,.22);
                opacity: .86;
                transform: translate(-50%, -50%);
                transition: width 120ms cubic-bezier(0.23, 1, 0.32, 1), height 120ms cubic-bezier(0.23, 1, 0.32, 1), opacity 120ms cubic-bezier(0.23, 1, 0.32, 1);
              }
              .od-radius-handle.is-active {
                cursor: default;
              }
              .od-radius-handle.is-active::after {
                width: 10px;
                height: 10px;
                border-width: 2px;
                opacity: 1;
              }
              .od-radius-badge {
                position: absolute;
                left: 50%;
                top: -8px;
                transform: translate(-50%, -100%);
                padding: 2px 7px;
                border-radius: 4px;
                background: #1595ff;
                color: #fff;
                font: 700 12px/1.35 system-ui, sans-serif;
                white-space: nowrap;
                pointer-events: none;
                z-index: 25;
                display: none;
              }
              .od-gjs-element-selection-mode .gjs-resizer,
              .od-gjs-element-selection-mode .gjs-resizer-h,
              .od-gjs-element-selection-mode .od-dimension-badge,
              .od-gjs-element-selection-mode .od-selection-stroke,
              .od-gjs-element-selection-mode .od-radius-handle,
              .od-gjs-element-selection-mode .od-radius-badge,
              .od-gjs-element-selection-mode [data-od-spacing-kind],
              .od-gjs-element-selection-mode [data-od-spacing-band] {
                display: none !important;
                pointer-events: none !important;
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
            const doc = editor.Canvas.getDocument();
            applyCanvasHeadAssets(doc, parsedRef.current, baseHrefRef.current);
            applyCanvasBodyAttributes(doc, parsedRef.current);
            applyCanvasBodyStyleOverrides(editor, currentCanvasStylesRef.current);
          };

          // Selection dimension badge — a small "W x H" label pinned to the
          // bottom-center of the selected element's tool box (Figma-style).
          // `canvas:tools:update` fires on every selection change, hover,
          // resize tick, scroll, and container resize; its `width`/`height`
          // are zoom-scaled screen px, so we divide by the zoom decimal to
          // show the element's real CSS dimensions. We only act on the
          // `global` type (the actual selection); `local` is hover.
          let selectionStroke: HTMLDivElement | null = null;
          let dimensionBadge: HTMLDivElement | null = null;
          const ensureSelectionStroke = () => {
            if (selectionStroke) return selectionStroke;
            try {
              const toolsEl = (editor.Canvas as unknown as {
                getToolsEl?: (view?: unknown) => HTMLElement | null;
              }).getToolsEl?.();
              if (!toolsEl) return null;
              const hostDoc = toolsEl.ownerDocument;
              const stroke = hostDoc.createElement('div');
              stroke.className = 'od-selection-stroke';
              stroke.setAttribute('aria-hidden', 'true');
              toolsEl.appendChild(stroke);
              selectionStroke = stroke;
              return stroke;
            } catch {
              return null;
            }
          };
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
            try {
              const doc = editor.Canvas.getDocument?.();
              if (doc) upsertGrapesjsIframeSelectionStyle(doc, FLEX_CHILD_HOVER_CLASS, selectionToneRef.current);
            } catch { /* ignore */ }
            if (selectionChromeRef.current === 'element-selection') {
              hideDimensionBadge();
              return;
            }
            const stroke = ensureSelectionStroke();
            if (stroke) stroke.style.display = 'block';
            const badge = ensureDimensionBadge();
            if (!badge) return;
            const w = typeof opts.width === 'number' ? opts.width : 0;
            const h = typeof opts.height === 'number' ? opts.height : 0;
            if (w <= 1 || h <= 1) {
              hideDimensionBadge();
              positionRadiusHandles();
              return;
            }
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
            positionRadiusHandles();
          };
          const hideDimensionBadge = () => {
            if (dimensionBadge) dimensionBadge.style.display = 'none';
            if (selectionStroke) selectionStroke.style.display = 'none';
          };
          editor.on('canvas:tools:update', onToolsUpdate);
          editor.on('component:deselected', hideDimensionBadge);
          editor.on('component:selected', () => {
            // Ensure the badge shows even when tools:update fires before the
            // badge element existed (first selection right after load).
            if (selectionChromeRef.current === 'element-selection') {
              hideDimensionBadge();
              return;
            }
            ensureDimensionBadge();
            ensureSelectionStroke();
            positionRadiusHandles();
            try {
              const doc = editor.Canvas.getDocument?.();
              if (doc) upsertGrapesjsIframeSelectionStyle(doc, FLEX_CHILD_HOVER_CLASS, selectionToneRef.current);
            } catch { /* ignore */ }
          });
          type RadiusCorner = GrapesjsRadiusCorner;
          type RadiusHandle = { corner: RadiusCorner; node: HTMLDivElement };
          type RadiusDragState = {
            target: Component;
            corner: RadiusCorner;
            lastValue: number;
            rect: DOMRect;
            startClientX: number;
            startClientY: number;
            axis: 'x' | 'y' | null;
            handleNode: HTMLElement;
            pointerId: number;
            restoreCanvasPointerEvents: (() => void) | null;
          };
          let radiusHandles: RadiusHandle[] = [];
          let radiusBadge: HTMLDivElement | null = null;
          let radiusAttached = false;
          let radiusDrag: RadiusDragState | null = null;
          let radiusDragRaf = 0;
          let pendingRadiusMove: { clientX: number; clientY: number } | null = null;
          let detachRadiusHandles: (() => void) | null = null;
          const radiusHandleMinInset = 28;
          const radiusHandleMinTargetSize = 80;
          const radiusCssPx = (value: string | undefined): number => {
            const match = String(value ?? '').match(/-?[\d.]+/);
            const parsed = match?.[0] ? Number.parseFloat(match[0]) : 0;
            return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
          };
          const selectedRadiusTarget = (): Component | null => {
            const sel = editor.getSelected?.() as Component | undefined;
            if (!sel) return null;
            const attrs = getComponentAttributes(sel);
            return attrs['data-od-canvas-tool'] === 'rectangle' ? sel : null;
          };
          const hideRadiusHandles = () => {
            for (const handle of radiusHandles) {
              handle.node.classList.remove('is-active');
              handle.node.style.display = 'none';
            }
            if (radiusBadge) radiusBadge.style.display = 'none';
          };
          const clearActiveRadiusHandle = () => {
            for (const handle of radiusHandles) handle.node.classList.remove('is-active');
          };
          const beginRadiusInputShield = (): (() => void) | null => {
            const canvasEl = editor.Canvas.getElement?.() as HTMLElement | null | undefined;
            if (!canvasEl) return null;
            const previous = canvasEl.style.pointerEvents;
            canvasEl.style.pointerEvents = 'none';
            return () => {
              canvasEl.style.pointerEvents = previous;
            };
          };
          const ensureRadiusHandles = () => {
            if (radiusAttached) return;
            const toolsEl = (editor.Canvas as unknown as { getToolsEl?: () => HTMLElement | null }).getToolsEl?.();
            if (!toolsEl) return;
            const hostDoc = toolsEl.ownerDocument;
            radiusHandles = (['tl', 'tr', 'bl', 'br'] as RadiusCorner[]).map((corner) => {
              const node = hostDoc.createElement('div');
              node.className = 'od-radius-handle';
              node.setAttribute('data-od-radius-corner', corner);
              node.setAttribute('aria-hidden', 'true');
              toolsEl.appendChild(node);
              return { corner, node };
            });
            radiusBadge = hostDoc.createElement('div');
            radiusBadge.className = 'od-radius-badge';
            radiusBadge.setAttribute('aria-hidden', 'true');
            toolsEl.appendChild(radiusBadge);
            const onHostPointerDown = (ev: PointerEvent) => {
              const node = (ev.target as Element | null)?.closest?.('[data-od-radius-corner]') as HTMLElement | null;
              const corner = node?.getAttribute('data-od-radius-corner') as RadiusCorner | null;
              const target = selectedRadiusTarget();
              if (!node || !corner || !target) return;
              const dragRect = toolsEl.getBoundingClientRect();
              if (dragRect.width <= 1 || dragRect.height <= 1) return;
              if (dragRect.width < radiusHandleMinTargetSize || dragRect.height < radiusHandleMinTargetSize) return;
              ev.preventDefault();
              ev.stopPropagation();
              ev.stopImmediatePropagation();
              const startRadius = radiusCssPx(getComponentStyleRecord(target)['border-radius']);
              const hostWindow = hostDoc.defaultView;
              if (!hostWindow) return;
              try { node.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
              clearActiveRadiusHandle();
              node.classList.add('is-active');
              radiusDrag = {
                target,
                corner,
                lastValue: startRadius,
                rect: dragRect,
                startClientX: ev.clientX,
                startClientY: ev.clientY,
                axis: null,
                handleNode: node,
                pointerId: ev.pointerId,
                restoreCanvasPointerEvents: beginRadiusInputShield(),
              };
              positionRadiusHandles();
              const applyPendingRadiusMove = () => {
                radiusDragRaf = 0;
                const drag = radiusDrag;
                const point = pendingRadiusMove;
                pendingRadiusMove = null;
                if (!drag || !point) return;
                const zoom = (() => {
                  const z = (editor.Canvas as unknown as { getZoomDecimal?: () => number }).getZoomDecimal?.();
                  return typeof z === 'number' && z > 0 ? z : (editor.Canvas.getZoom?.() ?? 100) / 100;
                })();
                const deltaX = point.clientX - drag.startClientX;
                const deltaY = point.clientY - drag.startClientY;
                if (!drag.axis) {
                  const inwardX = drag.corner.endsWith('r') ? -deltaX : deltaX;
                  const inwardY = drag.corner.startsWith('b') ? -deltaY : deltaY;
                  const absX = Math.abs(inwardX);
                  const absY = Math.abs(inwardY);
                  if (Math.max(absX, absY) >= 3) {
                    const bothInward = inwardX > 0 && inwardY > 0;
                    const minAbs = Math.min(absX, absY);
                    const maxAbs = Math.max(absX, absY);
                    if (!bothInward || minAbs <= 3 || maxAbs / Math.max(1, minAbs) >= 4) {
                      drag.axis = absX >= absY ? 'x' : 'y';
                    }
                  }
                }
                const next = calculateGrapesjsCornerRadiusFromPointer({
                  corner: drag.corner,
                  localX: point.clientX - drag.rect.left,
                  localY: point.clientY - drag.rect.top,
                  width: drag.rect.width,
                  height: drag.rect.height,
                  zoom,
                  handleInset: radiusHandleMinInset,
                  axis: drag.axis,
                });
                if (next === drag.lastValue) {
                  positionRadiusHandles();
                  return;
                }
                drag.lastValue = next;
                try {
                  drag.target.setStyle?.({
                    ...getComponentStyleRecord(drag.target),
                    'border-radius': `${next}px`,
                  } as Parameters<typeof drag.target.setStyle>[0]);
                  positionRadiusHandles();
                } catch { /* ignore */ }
              };
              const move = (me: PointerEvent) => {
                if (!radiusDrag) return;
                me.preventDefault();
                me.stopPropagation();
                pendingRadiusMove = { clientX: me.clientX, clientY: me.clientY };
                if (!radiusDragRaf) {
                  radiusDragRaf = hostWindow.requestAnimationFrame(applyPendingRadiusMove);
                }
              };
              const up = () => {
                const drag = radiusDrag;
                if (radiusDragRaf) {
                  hostWindow.cancelAnimationFrame(radiusDragRaf);
                  radiusDragRaf = 0;
                  applyPendingRadiusMove();
                }
                try {
                  if (drag) drag.handleNode.releasePointerCapture?.(drag.pointerId);
                } catch { /* ignore */ }
                drag?.restoreCanvasPointerEvents?.();
                clearActiveRadiusHandle();
                radiusDrag = null;
                pendingRadiusMove = null;
                hostWindow.removeEventListener('pointermove', move, true);
                hostWindow.removeEventListener('pointerup', up, true);
                hostWindow.removeEventListener('pointercancel', up, true);
                refreshSelectionSnapshotRef.current?.();
                positionRadiusHandles();
                scheduleEmitRef.current?.();
              };
              hostWindow.addEventListener('pointermove', move, true);
              hostWindow.addEventListener('pointerup', up, true);
              hostWindow.addEventListener('pointercancel', up, true);
            };
            hostDoc.addEventListener('pointerdown', onHostPointerDown, true);
            detachRadiusHandles = () => {
              hostDoc.removeEventListener('pointerdown', onHostPointerDown, true);
              if (radiusDragRaf) {
                hostDoc.defaultView?.cancelAnimationFrame(radiusDragRaf);
                radiusDragRaf = 0;
              }
              radiusDrag?.restoreCanvasPointerEvents?.();
              radiusDrag = null;
              pendingRadiusMove = null;
              for (const handle of radiusHandles) handle.node.remove();
              radiusHandles = [];
              radiusBadge?.remove();
              radiusBadge = null;
              radiusAttached = false;
            };
            radiusAttached = true;
          };
          function positionRadiusHandles() {
            if (selectionChromeRef.current === 'element-selection') {
              hideRadiusHandles();
              return;
            }
            const target = selectedRadiusTarget();
            if (!target) {
              hideRadiusHandles();
              return;
            }
            ensureRadiusHandles();
            const toolsEl = (editor.Canvas as unknown as { getToolsEl?: () => HTMLElement | null }).getToolsEl?.();
            const el = getElementFromComponent(target) as HTMLElement | null;
            const win = el?.ownerDocument.defaultView ?? null;
            if (!toolsEl || !el || !win || toolsEl.clientWidth <= 1 || toolsEl.clientHeight <= 1) {
              hideRadiusHandles();
              return;
            }
            if (toolsEl.clientWidth < radiusHandleMinTargetSize || toolsEl.clientHeight < radiusHandleMinTargetSize) {
              hideRadiusHandles();
              return;
            }
            const zoom = (() => {
              const z = (editor.Canvas as unknown as { getZoomDecimal?: () => number }).getZoomDecimal?.();
              return typeof z === 'number' && z > 0 ? z : (editor.Canvas.getZoom?.() ?? 100) / 100;
            })();
            let radius = 0;
            try { radius = radiusCssPx(win.getComputedStyle(el).getPropertyValue('border-radius')); } catch { radius = 0; }
            const handleInset = calculateGrapesjsRadiusHandleInset({
              radius,
              zoom,
              width: toolsEl.clientWidth,
              height: toolsEl.clientHeight,
              minInset: radiusHandleMinInset,
            });
            const positions: Record<RadiusCorner, { x: number; y: number }> = {
              tl: { x: handleInset, y: handleInset },
              tr: { x: toolsEl.clientWidth - handleInset, y: handleInset },
              bl: { x: handleInset, y: toolsEl.clientHeight - handleInset },
              br: { x: toolsEl.clientWidth - handleInset, y: toolsEl.clientHeight - handleInset },
            };
            for (const handle of radiusHandles) {
              const pos = positions[handle.corner];
              if (!pos) continue;
              handle.node.style.left = `${pos.x}px`;
              handle.node.style.top = `${pos.y}px`;
              handle.node.style.display = 'block';
            }
            if (radiusBadge) {
              radiusBadge.textContent = `Radius ${Math.round(radius)}`;
              radiusBadge.style.display = radiusDrag ? 'block' : 'none';
            }
          }
          editor.on('component:deselected', hideRadiusHandles);
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
          const SPACING_GUIDE_LENGTH = 16;
          const SPACING_HIT_THICKNESS = 10;
          const SPACING_GUIDE_THICKNESS = 2;
          const SPACING_GUIDE_OUTLINE = '0 0 0 1px rgba(255,255,255,0.96), 0 1px 2px rgba(15,23,42,0.22)';
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
            item.line.style.background = SOLID[item.kind];
            item.line.style.borderRadius = '999px';
            item.line.style.boxShadow = SPACING_GUIDE_OUTLINE;
            item.line.style.left = isHorizontal ? '0' : '50%';
            item.line.style.top = isHorizontal ? '50%' : '0';
            item.line.style.width = isHorizontal ? '100%' : `${SPACING_GUIDE_THICKNESS}px`;
            item.line.style.height = isHorizontal ? `${SPACING_GUIDE_THICKNESS}px` : '100%';
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
            if (selectionChromeRef.current === 'element-selection') {
              hideSpacingHandles();
              return;
            }
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
            if (isGrapesjsCanvasToolComponent(sel)) return;
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
                guideX - (isHorizontal ? SPACING_GUIDE_LENGTH / 2 : SPACING_HIT_THICKNESS / 2),
                guideY - (isHorizontal ? SPACING_HIT_THICKNESS / 2 : SPACING_GUIDE_LENGTH / 2),
                isHorizontal ? SPACING_GUIDE_LENGTH : SPACING_HIT_THICKNESS,
                isHorizontal ? SPACING_HIT_THICKNESS : SPACING_GUIDE_LENGTH,
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
                if (it.side === 'top' && pTCss > 0) layoutSide(it, pTCss, 0, 0, boxW, pT, boxW / 2, pT);
                else if (it.side === 'bottom' && pBCss > 0) layoutSide(it, pBCss, 0, boxH - pB, boxW, pB, boxW / 2, boxH - pB);
                else if (it.side === 'left' && pLCss > 0) layoutSide(it, pLCss, 0, 0, pL, boxH, pL, boxH / 2);
                else if (it.side === 'right' && pRCss > 0) layoutSide(it, pRCss, boxW - pR, 0, pR, boxH, boxW - pR, boxH / 2);
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
                setSpacingRect(
                  item.handle,
                  guideX - SPACING_GUIDE_LENGTH / 2,
                  guideY - SPACING_HIT_THICKNESS / 2,
                  SPACING_GUIDE_LENGTH,
                  SPACING_HIT_THICKNESS,
                );
              } else {
                const gapStart = (first.right - containerRect.left) * zoom;
                const gapEnd = (second.left - containerRect.left) * zoom;
                const crossStart = (Math.max(first.top, second.top) - containerRect.top) * zoom;
                const crossEnd = (Math.min(first.bottom, second.bottom) - containerRect.top) * zoom;
                const guideX = (gapStart + gapEnd) / 2;
                const guideY = (crossStart + crossEnd) / 2;
                setSpacingRect(item.band, gapStart, crossStart, Math.max(0, gapEnd - gapStart), Math.max(0, crossEnd - crossStart));
                setSpacingRect(
                  item.handle,
                  guideX - SPACING_HIT_THICKNESS / 2,
                  guideY - SPACING_GUIDE_LENGTH / 2,
                  SPACING_HIT_THICKNESS,
                  SPACING_GUIDE_LENGTH,
                );
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
          let toolsRefreshRaf = 0;
          let toolsRefreshNeedsCanvasRefresh = false;
          let selectionSnapshotRefreshRaf = 0;
          const forceToolsWrapperVisible = () => {
            try {
              const canvasEl = editor.Canvas.getElement?.() as HTMLElement | null | undefined;
              canvasEl
                ?.querySelectorAll<HTMLElement>('.gjs-cv-canvas__tools')
                .forEach((el) => { el.style.display = ''; });
              const canvasView = (editor.Canvas as unknown as {
                getCanvasView?: () => { toolsWrapper?: HTMLElement | null } | null;
              }).getCanvasView?.();
              if (canvasView?.toolsWrapper) canvasView.toolsWrapper.style.display = '';
            } catch {
              // ignore — refresh below still lets GrapesJS recover
            }
          };
          const requestVisibleToolsRefresh = (opts: { refreshCanvas?: boolean } = {}) => {
            forceToolsWrapperVisible();
            if (opts.refreshCanvas) toolsRefreshNeedsCanvasRefresh = true;
            if (toolsRefreshRaf) return;
            toolsRefreshRaf = window.requestAnimationFrame(() => {
              toolsRefreshRaf = 0;
              forceToolsWrapperVisible();
              const refreshCanvas = toolsRefreshNeedsCanvasRefresh;
              toolsRefreshNeedsCanvasRefresh = false;
              if (refreshCanvas) {
                try {
                  (editor.Canvas as unknown as { refresh?: () => void }).refresh?.();
                } catch { /* ignore */ }
              }
              try {
                editor.trigger('canvas:updateTools');
              } catch { /* ignore */ }
              positionRadiusHandles();
              positionSpacingHandles();
            });
          };
          const requestSelectionSnapshotRefresh = (opts: { emit?: boolean } = {}) => {
            if (selectionSnapshotRefreshRaf) return;
            selectionSnapshotRefreshRaf = window.requestAnimationFrame(() => {
              selectionSnapshotRefreshRaf = 0;
              refreshSelectionSnapshotRef.current?.();
              if (opts.emit) scheduleEmitRef.current?.();
            });
          };
          const onLiveToolsGeometryChange = () => {
            requestVisibleToolsRefresh();
            syncArtboardLabelPositionRef.current?.();
          };
          const detachCanvasViewportSync = attachGrapesjsCanvasViewportSync(
            editor,
            [rootRef.current, containerRef.current],
            () => {
              requestVisibleToolsRefresh({ refreshCanvas: true });
              syncArtboardLabelPositionRef.current?.();
            },
          );
          const observeToolsLayoutResize = () => {
            const ResizeObserverCtor =
              rootRef.current?.ownerDocument.defaultView?.ResizeObserver ??
              (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null);
            if (!ResizeObserverCtor) return null;
            const observer = new ResizeObserverCtor(() => {
              requestVisibleToolsRefresh({ refreshCanvas: true });
              syncArtboardLabelPositionRef.current?.();
            });
            const observed = new Set<Element>();
            const observe = (el: Element | null | undefined) => {
              if (!el || observed.has(el)) return;
              observed.add(el);
              observer.observe(el);
            };
            observe(rootRef.current);
            observe(containerRef.current);
            try { observe(editor.Canvas.getElement?.() as Element | null | undefined); } catch { /* ignore */ }
            try { observe(editor.Canvas.getFrameEl?.() as Element | null | undefined); } catch { /* ignore */ }
            return () => observer.disconnect();
          };
          const detachToolsLayoutResize = observeToolsLayoutResize();
          editor.on('canvas:zoom', onLiveToolsGeometryChange);
          editor.on('canvas:coords', onLiveToolsGeometryChange);
          editor.on('component:drag', onLiveToolsGeometryChange);
          const addInlineCleanupCandidate = (candidates: Set<Component>, candidate: unknown) => {
            if (!candidate || typeof candidate !== 'object') return;
            const maybe = candidate as Component;
            const maybeView = (candidate as { view?: unknown }).view;
            if (
              typeof maybe.getStyle === 'function' ||
              typeof maybe.getEl === 'function' ||
              typeof maybe.setStyle === 'function' ||
              (maybeView && typeof maybeView === 'object')
            ) {
              candidates.add(maybe);
            }
          };
          const cleanupInteractionInlineStyle = (payload?: unknown) => {
            const candidates = new Set<Component>();
            const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
            addInlineCleanupCandidate(candidates, payload);
            addInlineCleanupCandidate(candidates, record?.target);
            addInlineCleanupCandidate(candidates, record?.component);
            addInlineCleanupCandidate(candidates, record?.model);
            try { addInlineCleanupCandidate(candidates, editor.getSelected?.()); } catch { /* ignore */ }
            for (const candidate of candidates) {
              clearGrapesjsManagedInlineStyle(candidate);
            }
          };
          const detachResizePersistence = attachGrapesjsResizePersistence(editor, {
            refreshGeometry: onLiveToolsGeometryChange,
            cleanupInlineStyle: cleanupInteractionInlineStyle,
            commitChange: () => {
              requestSelectionSnapshotRefresh({ emit: true });
            },
          });
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
            input.style.cssText = 'width:80px;padding:2px 4px;border-radius:4px;background:#000;color:#fff;font:600 12px/1.4 system-ui;text-align:center;outline:none;-moz-appearance:textfield;box-shadow:0 2px 8px rgba(0,0,0,.28);outline:none;border:none;';
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
            if (selectionChromeRef.current === 'element-selection') {
              hideSpacingHandles();
              return;
            }
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
            const width = savedW ? Number.parseInt(savedW, 10) : 0;
            const height = savedH ? Number.parseInt(savedH, 10) : 0;
            if (width > 0 && height > 0) {
              currentCanvasSizeRef.current = { width, height };
              applyCanvasFrameSize(editor, width, height);
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
          const applyZoomStyleVars = (zoom: number) => {
            const { zoomDecimal, canvasHairline, screenHairline } = getGrapesjsZoomStyleVars(zoom);
            try {
              rootRef.current?.style.setProperty('--od-gjs-zoom-decimal', String(zoomDecimal));
              rootRef.current?.style.setProperty('--od-gjs-hairline', canvasHairline);
              rootRef.current?.style.setProperty('--od-gjs-screen-hairline', screenHairline);
              canvasEl?.style.setProperty('--od-gjs-zoom-decimal', String(zoomDecimal));
              canvasEl?.style.setProperty('--od-gjs-hairline', canvasHairline);
              canvasEl?.style.setProperty('--od-gjs-screen-hairline', screenHairline);
              const doc = editor.Canvas.getDocument?.();
              doc?.documentElement?.style.setProperty('--od-gjs-zoom-decimal', String(zoomDecimal));
              doc?.documentElement?.style.setProperty('--od-gjs-hairline', canvasHairline);
              doc?.documentElement?.style.setProperty('--od-gjs-screen-hairline', screenHairline);
              if (doc) upsertGrapesjsIframeSelectionStyle(doc, FLEX_CHILD_HOVER_CLASS, selectionToneRef.current);
            } catch {
              // ignore
            }
          };
          // Mirror the live canvas zoom onto the container as a data attribute.
          // This is a cheap observability hook (no DOM layout, no React state):
          // tests can assert the user-visible zoom without reaching into
          // GrapesJS internals, and a future status bar can read it directly.
          const syncZoomAttr = () => {
            try {
              const z = editor.Canvas.getZoom?.();
              if (typeof z === 'number' && Number.isFinite(z)) {
                if (z < 25) {
                  editor.Canvas.setZoom?.(100);
                  applyZoomStyleVars(100);
                  if (rootRef.current) rootRef.current.dataset.odCanvasZoom = '100';
                  onZoomChangeRef.current?.(100);
                  syncArtboardLabelPositionRef.current?.();
                  return;
                }
                applyZoomStyleVars(z);
                if (rootRef.current) {
                  rootRef.current.dataset.odCanvasZoom = String(Number(z.toFixed(3)));
                }
                onZoomChangeRef.current?.(z);
              } else {
                editor.Canvas.setZoom?.(100);
                applyZoomStyleVars(100);
                if (rootRef.current) rootRef.current.dataset.odCanvasZoom = '100';
                onZoomChangeRef.current?.(100);
              }
            } catch {
              // ignore
            }
            syncArtboardLabelPositionRef.current?.();
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
            syncArtboardLabelPositionRef.current?.();
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
          editor.on('canvas:frame:load:body', syncZoomAttr);
          syncZoomAttrRef.current = syncZoomAttr;
          syncCoordsAttrRef.current = syncCoordsAttr;
          const onKeyDownCanvas = (ev: KeyboardEvent) => {
            // Never hijack keys while the user is typing in an input / the
            // GrapesJS text-edit overlay (contenteditable) — those own the
            // keystroke for editing.
            if (isTextInputTarget(ev.target)) {
              if (ev.key === 'Escape') {
                ev.preventDefault();
                stopGrapesjsRichTextEditing(editor);
              }
              return;
            }
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
              if (selectionChromeRef.current === 'element-selection' && onEscapeKeyRef.current) {
                ev.preventDefault();
                onEscapeKeyRef.current();
                return;
              }
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
            // navigation) or Cmd+Delete. Also skip when the user is
            // editing text inside a component (double-click → contenteditable).
            if (
              !readOnlyRef.current &&
              !ev.metaKey &&
              !ev.ctrlKey &&
              !ev.altKey &&
              (ev.key === 'Delete' || ev.key === 'Backspace') &&
              !isGrapesjsEditorEditing(editor)
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
                fitCanvasFrameToViewport(editor);
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
              if (isTextInputTarget(ev.target)) {
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  stopGrapesjsRichTextEditing(editor);
                }
                return;
              }
              if (ev.code === 'Space') {
                onKeyDownCanvas(ev);
                consumeCanvasEvent(ev);
                return;
              }
              // Undo/Redo inside the canvas iframe (focus is here after a
              // canvas click, so the host-window handler won't fire).
              if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && (ev.key === 'r' || ev.key === 'R')) {
                ev.preventDefault();
                onReloadRef.current?.();
                return;
              }
              const key = ev.key.toLowerCase();
              const primary = ev.metaKey || ev.ctrlKey;
              const noCommandModifier = !primary && !ev.altKey;
              let canvasTool: GrapesjsCanvasTool | null = null;
              if (primary && ev.shiftKey && !ev.altKey && key === 'k') {
                canvasTool = 'image';
              } else if (noCommandModifier && key === 'v') {
                canvasTool = 'cursor';
              } else if (noCommandModifier && key === 'r') {
                canvasTool = 'rectangle';
              } else if (noCommandModifier && key === 'l') {
                canvasTool = 'line';
              } else if (noCommandModifier && key === 'o') {
                canvasTool = 'circle';
              } else if (noCommandModifier && key === 't') {
                canvasTool = 'text';
              }
              if (canvasTool && !readOnlyRef.current && !cropModeRef.current) {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                activeCanvasToolRef.current = canvasTool;
                onCanvasToolChangeRef.current?.(canvasTool);
                try {
                  doc.body.style.cursor = isGrapesjsPlaceableCanvasTool(canvasTool) ? 'crosshair' : '';
                } catch { /* ignore */ }
                return;
              }
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
              if (!readOnlyRef.current && !ev.metaKey && !ev.ctrlKey && !ev.altKey && (ev.key === 'Delete' || ev.key === 'Backspace') && !isGrapesjsEditorEditing(editor)) {
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
                  ev.preventDefault();
                  if (arrangeGrapesjsSelectionAsFlex(editor, selectionOrderRef.current)) {
                    refreshSelectionSnapshotRef.current?.();
                    scheduleEmitRef.current?.();
                  }
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
                  ev.preventDefault();
                  if (dissolveGrapesjsFlexSelection(editor)) {
                    refreshSelectionSnapshotRef.current?.();
                    scheduleEmitRef.current?.();
                  }
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
            // ── 裁剪 mode: drag the selected element to pan its image fill.
            //    Background-image fills use background-position/size; <img>
            //    fills use object-position so the visible element box acts as
            //    the crop viewport. During interaction we mutate only the
            //    canvas DOM for immediate feedback, then commit once on
            //    pointerup to avoid GrapesJS re-rendering the target mid-drag.
            type CropTarget = { el: HTMLElement; kind: 'background' | 'image' };
            type CropHandle = 'nw' | 'ne' | 'se' | 'sw';
            type CropPatch = {
              position?: string;
              size?: string;
              objectPosition?: string;
            };
            type CropInteraction = {
              type: 'pan' | 'resize';
              handle?: CropHandle;
              startX: number;
              startY: number;
              posX: number;
              posY: number;
              sizeW: number;
              sizeH: number;
              ratio: number;
              zoom: number;
              pending: CropPatch;
            };
            const cropOverlayState = {
              root: null as HTMLDivElement | null,
            };
            const cropNaturalSizeCache = new Map<string, { w: number; h: number }>();
            const cropSelectedEl = (): HTMLElement | null => {
              try {
                const sel = editor.getSelected?.() as Component | undefined;
                if (!sel) return null;
                return getElementFromComponent(sel) as HTMLElement | null;
              } catch { return null; }
            };
            const readComputedStyleValue = (el: HTMLElement, property: string): string => {
              try {
                return el.ownerDocument.defaultView?.getComputedStyle(el).getPropertyValue(property) ?? '';
              } catch {
                return '';
              }
            };
            const readBackgroundImage = (el: HTMLElement): string => {
              return String(el.style.backgroundImage || el.style.getPropertyValue('background-image') || readComputedStyleValue(el, 'background-image') || '');
            };
            const readCssUrl = (value: string): string => {
              const match = value.trim().match(/^url\((['"]?)(.*)\1\)$/);
              return match?.[2] ?? '';
            };
            const readCropImageUrl = (target: CropTarget): string => {
              if (target.kind === 'image') {
                const img = target.el as HTMLImageElement;
                return img.getAttribute('src') || img.currentSrc || img.src || '';
              }
              return readCssUrl(readBackgroundImage(target.el));
            };
            const cropSelectedTarget = (): CropTarget | null => {
              const el = cropSelectedEl();
              if (!el) return null;
              if (el.tagName === 'IMG') {
                const img = el as HTMLImageElement;
                const src = img.getAttribute('src') || img.currentSrc || img.src || '';
                return src ? { el, kind: 'image' } : null;
              }
              const bg = readBackgroundImage(el);
              return bg && bg !== 'none' ? { el, kind: 'background' } : null;
            };
            const pointInElementRect = (el: HTMLElement, ev: PointerEvent | WheelEvent | MouseEvent): boolean => {
              const rect = el.getBoundingClientRect();
              return ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
            };
            const eventTargetInCropOverlay = (ev: Event): boolean => {
              const node = ev.target as Element | null;
              return !!node?.closest?.('[data-od-crop-overlay]');
            };
            const cropEventInInteractionArea = (ev: PointerEvent | WheelEvent | MouseEvent): boolean => {
              if (eventTargetInCropOverlay(ev)) return true;
              const target = cropSelectedTarget();
              return target ? pointInElementRect(target.el, ev) : false;
            };
            const clearGrapesjsHoverForCrop = () => {
              try {
                (editor as unknown as { setHovered?: (cmp: Component | null) => void }).setHovered?.(null);
              } catch { /* ignore */ }
              onHoverTargetRef.current?.(null);
            };
            const readCropPos = (target: CropTarget): { x: number; y: number } => {
              const st = target.el.style;
              const property = target.kind === 'image' ? 'object-position' : 'background-position';
              // Position is stored as e.g. "12px -30px"; keywords fall back to
              // 0,0 so the first drag converts them into explicit pixel values.
              const v = String(st.getPropertyValue(property) || readComputedStyleValue(target.el, property) || '0px 0px');
              const parts = v.split(/\s+/);
              const num = (s: string): number => {
                const mm = /^(-?[\d.]+)/.exec(s);
                return mm && mm[1] ? parseFloat(mm[1]) : 0;
              };
              return { x: parts[0] ? num(parts[0]) : 0, y: parts[1] ? num(parts[1]) : 0 };
            };
            const ensureCropNaturalSize = (url: string, doc: Document) => {
              if (!url || cropNaturalSizeCache.has(url)) return;
              const img = doc.createElement('img');
              img.onload = () => {
                cropNaturalSizeCache.set(url, {
                  w: img.naturalWidth || 1,
                  h: img.naturalHeight || 1,
                });
                syncCropOverlayRef.current?.();
              };
              img.src = url;
            };
            const readCropSize = (target: CropTarget): { w: number; h: number } => {
              if (target.kind === 'image') {
                const img = target.el as HTMLImageElement;
                return {
                  w: img.naturalWidth || target.el.clientWidth || 1,
                  h: img.naturalHeight || target.el.clientHeight || 1,
                };
              }
              const st = target.el.style;
              const v = String(st.backgroundSize || st.getPropertyValue('background-size') || readComputedStyleValue(target.el, 'background-size') || 'cover');
              // px form: "640px 480px"; keywords fall back to the element box.
              const m = /^([\d.]+)px\s+([\d.]+)px$/.exec(v);
              if (m && m[1] && m[2]) return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
              if (v === 'auto') {
                const url = readCropImageUrl(target);
                ensureCropNaturalSize(url, target.el.ownerDocument);
                const natural = cropNaturalSizeCache.get(url);
                if (natural) return natural;
              }
              const w = target.el.clientWidth || 1;
              const h = target.el.clientHeight || 1;
              return { w, h };
            };
            const removeCropOverlay = () => {
              cropOverlayState.root?.remove();
              cropOverlayState.root = null;
            };
            const styleCropHandle = (handle: HTMLElement, position: CropHandle) => {
              handle.setAttribute('data-od-crop-handle', position);
              handle.setAttribute('aria-hidden', 'true');
              handle.style.position = 'absolute';
              handle.style.width = '10px';
              handle.style.height = '10px';
              handle.style.border = '1px solid #0d99ff';
              handle.style.borderRadius = '2px';
              handle.style.background = '#ffffff';
              handle.style.boxShadow = '0 1px 4px rgba(0,0,0,0.22)';
              handle.style.pointerEvents = 'auto';
              if (position.includes('n')) handle.style.top = '-5px';
              if (position.includes('s')) handle.style.bottom = '-5px';
              if (position.includes('w')) handle.style.left = '-5px';
              if (position.includes('e')) handle.style.right = '-5px';
              handle.style.cursor = position === 'nw' || position === 'se' ? 'nwse-resize' : 'nesw-resize';
            };
            const syncCropOverlay = () => {
              const target = cropModeRef.current ? cropSelectedTarget() : null;
              if (!target) {
                removeCropOverlay();
                return;
              }
              const url = readCropImageUrl(target);
              if (!url) {
                removeCropOverlay();
                return;
              }
              const doc = target.el.ownerDocument;
              const rect = target.el.getBoundingClientRect();
              const pos = readCropPos(target);
              const size = readCropSize(target);
              const overlay = cropOverlayState.root ?? doc.createElement('div');
              if (!cropOverlayState.root) {
                cropOverlayState.root = overlay;
                overlay.setAttribute('data-od-crop-overlay', 'true');
                overlay.style.position = 'fixed';
                overlay.style.pointerEvents = 'auto';
                overlay.style.zIndex = '2147483000';
                overlay.style.border = '1px dashed rgba(13, 153, 255, 0.95)';
                overlay.style.boxShadow = '0 0 0 1px rgba(13, 153, 255, 0.22)';
                overlay.style.backgroundRepeat = 'no-repeat';
                overlay.style.backgroundSize = '100% 100%';
                overlay.style.opacity = '0.42';
                overlay.style.boxSizing = 'border-box';
                overlay.style.cursor = 'move';
                overlay.style.touchAction = 'none';
                overlay.style.userSelect = 'none';
                doc.body.appendChild(overlay);
              }
              overlay.style.left = `${Math.round(rect.left + pos.x)}px`;
              overlay.style.top = `${Math.round(rect.top + pos.y)}px`;
              overlay.style.width = `${Math.max(1, Math.round(size.w))}px`;
              overlay.style.height = `${Math.max(1, Math.round(size.h))}px`;
              overlay.style.backgroundImage = `url("${url}")`;
              overlay.replaceChildren();
              if (target.kind === 'background') {
                for (const position of ['nw', 'ne', 'se', 'sw'] as CropHandle[]) {
                  const handle = doc.createElement('span');
                  styleCropHandle(handle, position);
                  overlay.appendChild(handle);
                }
              }
            };
            syncCropOverlayRef.current = syncCropOverlay;
            let cropInteraction: CropInteraction | null = null;
            const previewCropPatch = (target: CropTarget, patch: CropPatch) => {
              if (patch.position) target.el.style.setProperty('background-position', patch.position);
              if (patch.size) target.el.style.setProperty('background-size', patch.size);
              if (patch.objectPosition) {
                target.el.style.setProperty('object-fit', 'none');
                target.el.style.setProperty('object-position', patch.objectPosition);
              }
              syncCropOverlay();
            };
            const commitCropPatch = (target: CropTarget, patch: CropPatch) => {
              const stylePatch: Record<string, string> = {};
              if (patch.position) stylePatch['background-position'] = patch.position;
              if (patch.size) stylePatch['background-size'] = patch.size;
              if (patch.objectPosition) {
                stylePatch['object-fit'] = 'none';
                stylePatch['object-position'] = patch.objectPosition;
              }
              if (Object.keys(stylePatch).length === 0) return;
              try {
                const sel = editor.getSelected?.() as Component | undefined;
                if (sel) {
                  const merged = { ...(sel.getStyle?.() ?? {}) } as Record<string, string>;
                  sel.setStyle?.({ ...merged, ...stylePatch });
                }
              } catch { /* ignore */ }
              refreshSelectionSnapshotRef.current?.();
              scheduleEmitRef.current?.();
              syncCropOverlay();
            };
            const handleFromEvent = (ev: PointerEvent): CropHandle | null => {
              const target = ev.target as Element | null;
              const handle = target?.closest?.('[data-od-crop-handle]');
              const value = handle?.getAttribute('data-od-crop-handle');
              return value === 'nw' || value === 'ne' || value === 'se' || value === 'sw' ? value : null;
            };
            const onCropPointerDown = (ev: PointerEvent) => {
              if (readOnlyRef.current || !cropModeRef.current) return;
              if (ev.button !== 0) return;
              const target = cropSelectedTarget();
              if (!target) return;
              const { el } = target;
              const handle = handleFromEvent(ev);
              if (!handle && !eventTargetInCropOverlay(ev) && !pointInElementRect(el, ev)) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              clearGrapesjsHoverForCrop();
              const zoom = (editor.Canvas.getZoom?.() ?? 100) / 100;
              const pos = readCropPos(target);
              const size = readCropSize(target);
              cropInteraction = {
                type: handle ? 'resize' : 'pan',
                handle: handle ?? undefined,
                startX: ev.clientX,
                startY: ev.clientY,
                posX: pos.x,
                posY: pos.y,
                sizeW: size.w,
                sizeH: size.h,
                ratio: size.h > 0 && size.w > 0 ? size.h / size.w : 1,
                zoom,
                pending: {},
              };
              el.style.cursor = 'grabbing';
              syncCropOverlay();
            };
            const onCropPointerMove = (ev: PointerEvent) => {
              if (!cropInteraction) {
                if (cropModeRef.current && cropEventInInteractionArea(ev)) {
                  ev.preventDefault();
                  ev.stopImmediatePropagation();
                  clearGrapesjsHoverForCrop();
                }
                return;
              }
              const target = cropSelectedTarget();
              if (!target) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              clearGrapesjsHoverForCrop();
              const dx = (ev.clientX - cropInteraction.startX) / cropInteraction.zoom;
              const dy = (ev.clientY - cropInteraction.startY) / cropInteraction.zoom;
              if (cropInteraction.type === 'resize' && target.kind === 'background') {
                const handle = cropInteraction.handle ?? 'se';
                const horizontalDelta = handle.includes('e') ? dx : -dx;
                const verticalDelta = handle.includes('s') ? dy : -dy;
                const dominantDelta = Math.abs(horizontalDelta) >= Math.abs(verticalDelta)
                  ? horizontalDelta
                  : verticalDelta / cropInteraction.ratio;
                const nextW = Math.max(8, Math.round(cropInteraction.sizeW + dominantDelta));
                const nextH = Math.max(8, Math.round(nextW * cropInteraction.ratio));
                const nextX = handle.includes('w')
                  ? Math.round(cropInteraction.posX + cropInteraction.sizeW - nextW)
                  : cropInteraction.posX;
                const nextY = handle.includes('n')
                  ? Math.round(cropInteraction.posY + cropInteraction.sizeH - nextH)
                  : cropInteraction.posY;
                cropInteraction.pending = {
                  size: `${nextW}px ${nextH}px`,
                  position: `${nextX}px ${nextY}px`,
                };
                previewCropPatch(target, cropInteraction.pending);
                return;
              }
              const nx = Math.round(cropInteraction.posX + dx);
              const ny = Math.round(cropInteraction.posY + dy);
              cropInteraction.pending = target.kind === 'image'
                ? { objectPosition: `${nx}px ${ny}px` }
                : { position: `${nx}px ${ny}px` };
              previewCropPatch(target, cropInteraction.pending);
            };
            const finishCropDrag = (el: HTMLElement | null) => {
              if (!cropInteraction) return;
              const pending = cropInteraction.pending;
              cropInteraction = null;
              if (el) el.style.cursor = '';
              const target = cropSelectedTarget();
              if (target) commitCropPatch(target, pending);
            };
            const onCropPointerUp = (ev: PointerEvent) => {
              if (!cropInteraction) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              finishCropDrag(cropSelectedEl());
            };
            const onCropWheel = (ev: WheelEvent) => {
              if (readOnlyRef.current || !cropModeRef.current) return;
              const target = cropSelectedTarget();
              if (!target || (!eventTargetInCropOverlay(ev) && !pointInElementRect(target.el, ev))) return;
              if (target.kind === 'image') return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              clearGrapesjsHoverForCrop();
              const size = readCropSize(target);
              // Scale around the cursor: keep the image point under the
              // pointer stationary. delta < 0 (wheel up) = zoom in.
              const factor = ev.deltaY < 0 ? 1.05 : 1 / 1.05;
              const newW = Math.max(8, Math.round(size.w * factor));
              const newH = Math.max(8, Math.round(size.h * factor));
              const patch = { size: `${newW}px ${newH}px` };
              previewCropPatch(target, patch);
              commitCropPatch(target, patch);
            };
            const onCropMouseOver = (ev: MouseEvent) => {
              if (readOnlyRef.current || !cropModeRef.current) return;
              if (!cropEventInInteractionArea(ev)) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              clearGrapesjsHoverForCrop();
            };
            doc.addEventListener('pointerdown', onCropPointerDown, true);
            doc.addEventListener('pointermove', onCropPointerMove, true);
            doc.addEventListener('pointerup', onCropPointerUp, true);
            doc.addEventListener('wheel', onCropWheel, { capture: true, passive: false });
            doc.addEventListener('mouseover', onCropMouseOver, true);
            doc.addEventListener('keydown', onDocKey, true);
            doc.addEventListener('keyup', onDocKeyUp, true);
            doc.addEventListener('keypress', onDocKeyPress, true);
            detachCanvasDocKeys = () => {
              try {
                doc.removeEventListener('pointerdown', onCropPointerDown, true);
                doc.removeEventListener('pointermove', onCropPointerMove, true);
                doc.removeEventListener('pointerup', onCropPointerUp, true);
                doc.removeEventListener('wheel', onCropWheel, { capture: true } as EventListenerOptions);
                doc.removeEventListener('mouseover', onCropMouseOver, true);
                doc.removeEventListener('keydown', onDocKey, true);
                doc.removeEventListener('keyup', onDocKeyUp, true);
                doc.removeEventListener('keypress', onDocKeyPress, true);
                removeCropOverlay();
                if (syncCropOverlayRef.current === syncCropOverlay) syncCropOverlayRef.current = null;
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
          //   • Shift+click → toggle the INNERMOST component into selection,
          //     bypassing GrapesJS's Shift = sibling range selection.
          //   • Cmd/Ctrl+click → select the INNERMOST component (deep select),
          //     bypassing GrapesJS's Cmd/Ctrl = container-level multi-select
          //     toggle branch.
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
            try {
              upsertGrapesjsIframeSelectionStyle(doc, FLEX_CHILD_HOVER_CLASS, selectionToneRef.current);
            } catch { /* ignore */ }
            if ((doc as unknown as { __odNestedSelect?: true }).__odNestedSelect) return;
            (doc as unknown as { __odNestedSelect?: true }).__odNestedSelect = true;
            // The React host document (outside the canvas iframe) — used so the
            // clipboard paste listener works even when focus is on a host UI
            // control rather than inside the canvas frame.
            const hostDocument = containerRef.current?.ownerDocument ?? document;
            try {
              const cursor = isGrapesjsPlaceableCanvasTool(activeCanvasToolRef.current) ? 'crosshair' : '';
              doc.body.style.cursor = cursor;
            } catch { /* ignore */ }

            const writeElementStyle = (comp: Component, patch: Record<string, string>) => {
              const el = getElementFromComponent(comp) as HTMLElement | null;
              if (el) {
                for (const [key, value] of Object.entries(patch)) {
                  try { el.style.setProperty(key, value); } catch { /* ignore */ }
                }
              }
            };
            const previewComponentStyle = (comp: Component, patch: Record<string, string>) => {
              writeElementStyle(comp, patch);
            };
            const commitComponentStyle = (comp: Component, patch: Record<string, string>) => {
              let mergedStyleKeys: string[] = Object.keys(patch);
              try {
                const merged = { ...(comp.getStyle?.() ?? {}), ...patch } as Parameters<typeof comp.setStyle>[0];
                mergedStyleKeys = Object.keys(merged as Record<string, unknown>);
                comp.setStyle?.(merged);
              } catch { /* ignore */ }
              clearGrapesjsManagedInlineStyle(comp, mergedStyleKeys);
            };
            const undoManager = () => (
              editor as unknown as {
                UndoManager?: {
                  stop?: () => unknown;
                  start?: () => unknown;
                  getInstance?: () => { isTracking?: () => boolean } | null;
                };
              }
            ).UndoManager;
            const stopUndoTrackingForDrag = (): boolean => {
              const manager = undoManager();
              if (!manager?.stop) return false;
              let wasTracking = true;
              try {
                const instance = manager.getInstance?.();
                if (typeof instance?.isTracking === 'function') {
                  wasTracking = Boolean(instance.isTracking());
                }
              } catch {
                wasTracking = true;
              }
              if (wasTracking) {
                try { manager.stop(); } catch { /* ignore */ }
              }
              return wasTracking;
            };
            const restoreUndoTrackingAfterDrag = (wasTracking: boolean) => {
              if (!wasTracking) return;
              try { undoManager()?.start?.(); } catch { /* ignore */ }
            };
            const componentAttrs = (comp: Component | null | undefined): Record<string, unknown> => {
              try { return comp?.getAttributes?.() ?? {}; } catch { return {}; }
            };
            const insertPlacedCanvasTool = (
              tool: GrapesjsPlaceableCanvasTool,
              point: GrapesjsCanvasPoint,
              options: GrapesjsCanvasToolComponentOptions & { parent?: Component | null } = {},
            ): Component | null => {
              try {
                const node = appendGrapesjsCanvasToolComponent(editor, tool, point, options);
                if (!node) return null;
                editor.select(node);
                try { editor.runCommand(`${odResizablePluginKey}:refresh`); } catch { /* ignore */ }
                clearGrapesjsManagedInlineStyle(node);
                refreshSelectionSnapshotRef.current?.();
                scheduleGrapesjsPlacementChange('insert', scheduleEmitRef.current);
                return node;
              } catch {
                return null;
              }
            };

            const canvasPointFromDocPointer = (ev: PointerEvent): GrapesjsCanvasPoint => {
              const win = doc.defaultView;
              return {
                x: ev.clientX + (win?.scrollX ?? 0),
                y: ev.clientY + (win?.scrollY ?? 0),
              };
            };

            const canvasPointFromHostPointer = (ev: PointerEvent): GrapesjsCanvasPoint | null => {
              try {
                const frame = editor.Canvas.getFrameEl?.();
                const rect = frame?.getBoundingClientRect();
                if (!rect) return null;
                const zoom = canvasZoomDecimal();
                const x = (ev.clientX - rect.left) / zoom;
                const y = (ev.clientY - rect.top) / zoom;
                if (x < 0 || y < 0 || x > rect.width / zoom || y > rect.height / zoom) return null;
                const win = doc.defaultView;
                return {
                  x: x + (win?.scrollX ?? 0),
                  y: y + (win?.scrollY ?? 0),
                };
              } catch {
                return null;
              }
            };

            type PointerSource = 'doc' | 'host';
            type PlacementInteraction = {
              tool: GrapesjsPlaceableCanvasTool;
              component: Component;
              start: GrapesjsCanvasPoint;
              source: PointerSource;
              mode: GrapesjsCanvasPlacementMode;
              moved: boolean;
              pendingStyle: Record<string, string> | null;
              undoWasTracking: boolean;
            };
            let placementInteraction: PlacementInteraction | null = null;

            type PositionedToolDrag = {
              component: Component;
              source: PointerSource;
              start: GrapesjsCanvasPoint;
              startLeft: number;
              startTop: number;
              moved: boolean;
              pendingStyle: Record<string, string> | null;
            };
            let positionedToolDrag: PositionedToolDrag | null = null;

            const pointForSource = (ev: PointerEvent, source: PointerSource): GrapesjsCanvasPoint | null => (
              source === 'host' ? canvasPointFromHostPointer(ev) : canvasPointFromDocPointer(ev)
            );

            const hostPointHitsCanvasChrome = (ev: PointerEvent): boolean => {
              try {
                const canvasRoot = editor.Canvas.getElement?.() as HTMLElement | null | undefined;
                const hostDoc = canvasRoot?.ownerDocument;
                if (!hostDoc?.elementsFromPoint) return false;
                return hostDoc.elementsFromPoint(ev.clientX, ev.clientY).some((el) => (
                  Boolean(canvasRoot?.contains(el)) && isGrapesjsCanvasChromeTarget(el)
                ));
              } catch {
                return false;
              }
            };

            const isCanvasChromePointerTarget = (ev: PointerEvent, source: PointerSource): boolean => (
              isGrapesjsCanvasChromeTarget(ev.target) ||
              (source === 'host' && hostPointHitsCanvasChrome(ev))
            );

            const activatePlacedTextEditing = (component: Component) => {
              let attempts = 0;
              const activateAndSelect = () => {
                const el = getElementFromComponent(component) as HTMLElement | null;
                const win = el?.ownerDocument.defaultView;
                if (!el || !win) return;
                try {
                  const view = textViewFromComponent(component);
                  void view?.onActive?.({ stopPropagation() {}, stopImmediatePropagation() {} });
                } catch { /* ignore */ }
                if (!el.isContentEditable && attempts < 6) {
                  attempts += 1;
                  win.requestAnimationFrame(activateAndSelect);
                  return;
                }
                try { el.focus(); } catch { /* ignore */ }
                try {
                  const range = el.ownerDocument.createRange();
                  range.selectNodeContents(el);
                  const selection = win.getSelection?.();
                  selection?.removeAllRanges();
                  selection?.addRange(range);
                } catch { /* ignore */ }
              };
              requestAnimationFrame(activateAndSelect);
            };

            const finishPlacedCanvasTool = (inserted: Component | null) => {
              if (!inserted) return;
              const isTextTool = componentAttrs(inserted)['data-od-canvas-tool'] === 'text';
              try {
                editor.select(inserted, isTextTool ? { activate: true } : undefined);
              } catch {
                try { editor.select(inserted); } catch { /* ignore */ }
              }
              if (isTextTool) {
                activatePlacedTextEditing(inserted);
              }
              activeCanvasToolRef.current = 'cursor';
              onCanvasToolChangeRef.current?.('cursor');
              try {
                const canvasEl = editor.Canvas.getElement?.() as HTMLElement | null | undefined;
                if (canvasEl) canvasEl.style.cursor = '';
                doc.body.style.cursor = '';
              } catch { /* ignore */ }
              requestVisibleToolsRefresh();
            };

            const updatePlacementInteraction = (ev: PointerEvent) => {
              const state = placementInteraction;
              if (!state) return;
              const point = pointForSource(ev, state.source);
              if (!point) return;
              const distance = Math.hypot(point.x - state.start.x, point.y - state.start.y);
              if (!state.moved && distance < 3) return;
              state.moved = true;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              state.pendingStyle = getGrapesjsCanvasToolDragStyle(
                state.tool,
                state.start,
                point,
                state.mode,
                { lockAspect: ev.shiftKey },
              );
              previewComponentStyle(state.component, state.pendingStyle);
              requestVisibleToolsRefresh();
            };

            const finishPlacementInteraction = (ev: PointerEvent) => {
              const state = placementInteraction;
              if (!state) return;
              updatePlacementInteraction(ev);
              ev.preventDefault();
              ev.stopImmediatePropagation();
              const component = state.component;
              placementInteraction = null;
              if (state.pendingStyle) commitComponentStyle(component, state.pendingStyle);
              clearGrapesjsManagedInlineStyle(component);
              restoreUndoTrackingAfterDrag(state.undoWasTracking);
              refreshSelectionSnapshotRef.current?.();
              scheduleGrapesjsPlacementChange('finish', scheduleEmitRef.current);
              finishPlacedCanvasTool(component);
            };

            const cancelPlacementInteraction = () => {
              const state = placementInteraction;
              if (!state) return;
              placementInteraction = null;
              if (state.pendingStyle) commitComponentStyle(state.component, state.pendingStyle);
              clearGrapesjsManagedInlineStyle(state.component);
              restoreUndoTrackingAfterDrag(state.undoWasTracking);
              refreshSelectionSnapshotRef.current?.();
              scheduleGrapesjsPlacementChange('cancel', scheduleEmitRef.current);
            };

            const startPlacementInteraction = (
              ev: PointerEvent,
              point: GrapesjsCanvasPoint,
              source: PointerSource,
              targetComp: Component | null,
            ) => {
              const tool = activeCanvasToolRef.current;
              if (!isGrapesjsPlaceableCanvasTool(tool)) return;
              const flexParent = findFlexPlacementParent(targetComp);
              const mode: GrapesjsCanvasPlacementMode = flexParent ? 'flow' : 'absolute';
              const inserted = insertPlacedCanvasTool(tool, point, { mode, parent: flexParent });
              if (!inserted) return;
              const undoWasTracking = stopUndoTrackingForDrag();
              placementInteraction = {
                tool,
                component: inserted,
                start: point,
                source,
                mode,
                moved: false,
                pendingStyle: null,
                undoWasTracking,
              };
              ev.preventDefault();
              ev.stopImmediatePropagation();
            };

            const onPlacementPointerDown = (ev: PointerEvent) => {
              if (readOnlyRef.current || cropModeRef.current) return;
              if (ev.button !== 0) return;
              if (isTextInputTarget(ev.target)) return;
              if (isCanvasChromePointerTarget(ev, 'doc')) return;
              stopGrapesjsTextEditingForPointerTarget(editor, ev.target);
              if (!isGrapesjsPlaceableCanvasTool(activeCanvasToolRef.current)) return;
              startPlacementInteraction(
                ev,
                canvasPointFromDocPointer(ev),
                'doc',
                getComponentFromElement(ev.target as Element | null),
              );
            };

            const onPlacementHostPointerDown = (ev: PointerEvent) => {
              if (readOnlyRef.current || cropModeRef.current) return;
              if (ev.button !== 0) return;
              if (isTextInputTarget(ev.target)) return;
              if (isCanvasChromePointerTarget(ev, 'host')) return;
              stopGrapesjsTextEditingForPointerTarget(editor, ev.target);
              if (!isGrapesjsPlaceableCanvasTool(activeCanvasToolRef.current)) return;
              const point = canvasPointFromHostPointer(ev);
              if (!point) return;
              startPlacementInteraction(ev, point, 'host', componentFromHostPoint(ev.clientX, ev.clientY));
            };

            const triggerCanvasCommentPin = (ev: PointerEvent, source: PointerSource): boolean => {
              const onPin = onCanvasCommentPinRef.current;
              if (!onPin || readOnlyRef.current || cropModeRef.current) return false;
              if (ev.button !== 0) return false;
              if (isTextInputTarget(ev.target)) return false;
              if (isCanvasChromePointerTarget(ev, source)) return false;
              stopGrapesjsTextEditingForPointerTarget(editor, ev.target);
              if (isGrapesjsPlaceableCanvasTool(activeCanvasToolRef.current)) return false;
              const point = pointForSource(ev, source);
              if (!point) return false;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              onPin(point);
              return true;
            };

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
            const findFlexPlacementParent = (comp: Component | null): Component | null => {
              if (comp && comp.parent?.() && isFlexDisplay(componentDisplay(comp))) return comp;
              return findNearestFlexAncestor(comp);
            };
            const selectedComponents = (): Component[] => {
              try { return (editor.getSelectedAll?.() ?? []) as Component[]; } catch { return []; }
            };
            const componentParents = (comp: Component): Component[] => {
              try { return comp.parents?.() ?? []; } catch { return []; }
            };
            const componentDepth = (comp: Component): number => componentParents(comp).length;
            const componentChildren = (comp: Component): Component[] => {
              try {
                const children = comp.components?.();
                const out: Component[] = [];
                const length = typeof children?.length === 'number' ? children.length : 0;
                for (let i = 0; i < length; i += 1) {
                  const child = children.get(i) as Component | undefined;
                  if (child) out.push(child);
                }
                return out;
              } catch {
                return [];
              }
            };
            const rootComponents = (): Component[] => {
              try {
                const roots = editor.Components.getComponents();
                const out: Component[] = [];
                for (let i = 0; i < roots.length; i += 1) {
                  const root = roots.get(i) as Component | undefined;
                  if (root) out.push(root);
                }
                return out;
              } catch {
                return [];
              }
            };
            const componentContainsCanvasPoint = (comp: Component, clientX: number, clientY: number): boolean => {
              const el = getElementFromComponent(comp) as HTMLElement | null;
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                clientX >= rect.left &&
                clientX <= rect.right &&
                clientY >= rect.top &&
                clientY <= rect.bottom
              );
            };
            const deepestComponentAtCanvasPoint = (clientX: number, clientY: number): Component | null => {
              let best: Component | null = null;
              let bestDepth = -1;
              const visit = (comp: Component) => {
                if (!componentContainsCanvasPoint(comp, clientX, clientY)) return;
                if (comp.parent?.()) {
                  const depth = componentDepth(comp);
                  if (depth >= bestDepth) {
                    best = comp;
                    bestDepth = depth;
                  }
                }
                for (const child of componentChildren(comp)) visit(child);
              };
              for (const root of rootComponents()) visit(root);
              return best;
            };
            function canvasZoomDecimal(): number {
              try {
                const z = (editor.Canvas as unknown as { getZoomDecimal?: () => number }).getZoomDecimal?.();
                if (typeof z === 'number' && z > 0) return z;
                const zoom = editor.Canvas.getZoom?.();
                return typeof zoom === 'number' && zoom > 0 ? zoom / 100 : 1;
              } catch {
                return 1;
              }
            }
            const componentFromHostPoint = (clientX: number, clientY: number): Component | null => {
              try {
                const frame = editor.Canvas.getFrameEl?.();
                if (!frame) return null;
                const rect = frame.getBoundingClientRect();
                const zoom = canvasZoomDecimal();
                const x = (clientX - rect.left) / zoom;
                const y = (clientY - rect.top) / zoom;
                if (x < 0 || y < 0 || x > rect.width / zoom || y > rect.height / zoom) return null;
                return deepestComponentAtCanvasPoint(x, y) ?? getComponentFromElement(doc.elementFromPoint(x, y));
              } catch {
                return null;
              }
            };
            const selectDeepComponent = (comp: Component, additive: boolean) => {
              if (!additive) {
                editor.select(comp);
                return;
              }
              const selected = selectedComponents();
              if (selected.includes(comp)) {
                editor.selectRemove(comp);
                return;
              }
              const parents = componentParents(comp);
              selected.forEach((sel) => {
                const selectedParents = componentParents(sel);
                if (parents.includes(sel) || selectedParents.includes(comp)) {
                  editor.selectRemove(sel);
                }
              });
              editor.selectAdd(comp);
            };

            const startPositionedToolDrag = (ev: PointerEvent, source: PointerSource): boolean => {
              if (readOnlyRef.current || cropModeRef.current || placementInteraction) return false;
              if (ev.button !== 0) return false;
              if (isGrapesjsPlaceableCanvasTool(activeCanvasToolRef.current)) return false;
              if (ev.shiftKey || ev.metaKey || ev.ctrlKey) return false;
              if (isTextInputTarget(ev.target)) return false;
              if (isCanvasChromePointerTarget(ev, source)) return false;
              stopGrapesjsTextEditingForPointerTarget(editor, ev.target);
              const targetEl = ev.target as Element | null;
              const compAtPoint = source === 'host'
                ? componentFromHostPoint(ev.clientX, ev.clientY)
                : getComponentFromElement(targetEl);
              const comp = findGrapesjsPositionedDragComponent(compAtPoint);
              if (!comp) return false;
              const point = pointForSource(ev, source);
              if (!point) return false;
              const style = comp.getStyle?.() ?? {};
              const el = getElementFromComponent(comp) as HTMLElement | null;
              const readLeft = style.left ?? el?.style.getPropertyValue('left');
              const readTop = style.top ?? el?.style.getPropertyValue('top');
              const origin = resolveGrapesjsPositionedToolDragOrigin({
                styleLeft: readLeft,
                styleTop: readTop,
                elementRect: el?.getBoundingClientRect?.() ?? null,
                rootRect: canvasDocumentRootRect(editor),
              });
              positionedToolDrag = {
                component: comp,
                source,
                start: point,
                startLeft: origin.left,
                startTop: origin.top,
                moved: false,
                pendingStyle: null,
              };
              ev.preventDefault();
              ev.stopImmediatePropagation();
              try { editor.select(comp); } catch { /* ignore */ }
              return true;
            };

            const updatePositionedToolDrag = (ev: PointerEvent) => {
              const state = positionedToolDrag;
              if (!state) return;
              const point = pointForSource(ev, state.source);
              if (!point) return;
              const distance = Math.hypot(point.x - state.start.x, point.y - state.start.y);
              if (!state.moved && distance < 3) return;
              state.moved = true;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              state.pendingStyle = {
                left: `${Math.max(0, Math.round(state.startLeft + point.x - state.start.x))}px`,
                top: `${Math.max(0, Math.round(state.startTop + point.y - state.start.y))}px`,
              };
              previewComponentStyle(state.component, state.pendingStyle);
              requestVisibleToolsRefresh();
            };

            const finishPositionedToolDrag = (ev: PointerEvent) => {
              if (!positionedToolDrag) return;
              updatePositionedToolDrag(ev);
              const component = positionedToolDrag.component;
              const pendingStyle = positionedToolDrag.pendingStyle;
              positionedToolDrag = null;
              if (pendingStyle) commitComponentStyle(component, pendingStyle);
              try { editor.select(component); } catch { /* ignore */ }
              refreshSelectionSnapshotRef.current?.();
              scheduleEmitRef.current?.();
              requestVisibleToolsRefresh();
            };

            const cancelPositionedToolDrag = () => {
              const state = positionedToolDrag;
              if (!state) return;
              positionedToolDrag = null;
              if (state.pendingStyle) {
                commitComponentStyle(state.component, state.pendingStyle);
                refreshSelectionSnapshotRef.current?.();
                scheduleEmitRef.current?.();
                requestVisibleToolsRefresh();
              }
            };
            let suppressClickAfterMarquee = false;

            const onClick = (ev: MouseEvent) => {
              if (readOnlyRef.current) return;
              const isDeepPick = ev.shiftKey || ev.metaKey || ev.ctrlKey;
              if (!isDeepPick && isTextInputTarget(ev.target)) return;
              stopGrapesjsTextEditingForPointerTarget(editor, ev.target);
              if (suppressClickAfterMarquee) {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                return;
              }
              // Shift+click is OD's deep multi-select gesture. GrapesJS's
              // native Shift behaviour selects a sibling range, which fights
              // the flex-frame selection model and blocks picking inner nodes.
              if (ev.shiftKey) {
                const inner = deepestComponentAtCanvasPoint(ev.clientX, ev.clientY)
                  ?? getComponentFromElement(ev.target as Element | null);
                if (!inner) return;
                ev.preventDefault();
                ev.stopImmediatePropagation();
                selectDeepComponent(inner, true);
                return;
              }
              // Cmd/Ctrl+click = deep select (innermost), replacing the
              // current selection. Shift+click above owns additive deep-select.
              // Stop propagation so GrapesJS's own click→select (which treats
              // Cmd as a container-level multi-select toggle) doesn't run.
              if (ev.metaKey || ev.ctrlKey) {
                const inner = deepestComponentAtCanvasPoint(ev.clientX, ev.clientY)
                  ?? getComponentFromElement(ev.target as Element | null);
                if (!inner) return;
                ev.preventDefault();
                ev.stopImmediatePropagation();
                selectDeepComponent(inner, false);
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
            const onHostChromeClick = (ev: MouseEvent) => {
              if (readOnlyRef.current || cropModeRef.current) return;
              if (!(ev.metaKey || ev.ctrlKey)) return;
              if (isTextInputTarget(ev.target)) return;
              stopGrapesjsTextEditingForPointerTarget(editor, ev.target);
              const canvasRoot = (() => {
                try { return editor.Canvas.getElement?.() ?? containerRef.current; } catch { return containerRef.current; }
              })();
              const target = ev.target as Node | null;
              if (!canvasRoot || !target || !canvasRoot.contains(target)) return;
              const inner = componentFromHostPoint(ev.clientX, ev.clientY);
              if (!inner) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              selectDeepComponent(inner, ev.shiftKey);
            };

            // Flex-aware hover: when the pointer is over an element that lives
            // INSIDE a flex container, redirect the GrapesJS hover highlight to
            // that container (so the hover box matches the "click selects the
            // container" behaviour) and add a dashed blue outline to the actual
            // child under the cursor. This removes the jarring mismatch where
            // hovering a flex child drew the hover outline on the child but
            // clicking selected the container.
            // The iframe style is refreshed at the top of attachNestedSelect,
            // before the duplicate-listener guard, so HMR/stale frames pick up
            // outline fixes without needing a full frame reload.
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
              //
              // Exception: when the text element lives inside a flex container
              // and that container is currently selected (the user is drilling
              // in), go straight to RTE. Without this, the click handler's
              // flex-ancestor selection creates a loop: click→flex, dblclick
              // →text (blocks RTE), click→flex, … and the user never reaches
              // the editor.
              if (isText) {
                const current = editor.getSelected?.();
                if (current === comp) return; // already selected → let RTE engage
                const flexAncestor = findNearestFlexAncestor(comp);
                if (current && flexAncestor && current === flexAncestor) {
                  // Drilling in from flex container → enter edit mode
                  ev.preventDefault();
                  editor.select(comp);
                  return; // don't stopPropagation → GrapesJS RTE fires
                }
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

            type MarqueeState = {
              startX: number;
              startY: number;
              currentX: number;
              currentY: number;
              additive: boolean;
              deep: boolean;
              moved: boolean;
              box: HTMLDivElement | null;
              pointerId: number;
            };
            let marqueeState: MarqueeState | null = null;
            const MARQUEE_THRESHOLD = 4;
            const ensureMarqueeStyle = () => {
              try {
                const head = doc.head;
                if (!head || head.querySelector('style[data-od-marquee-style]')) return;
                const styleEl = doc.createElement('style');
                styleEl.setAttribute('data-od-marquee-style', 'true');
                styleEl.textContent = `
                  [data-od-marquee] {
                    position: fixed;
                    z-index: 2147483647;
                    pointer-events: none;
                    box-sizing: border-box;
                    border: var(--od-gjs-hairline, 1px) solid #3b82f6;
                    background: rgba(59, 130, 246, 0.14);
                  }
                `;
                head.appendChild(styleEl);
              } catch { /* ignore */ }
            };
            const marqueeRect = (state: MarqueeState) => {
              const left = Math.min(state.startX, state.currentX);
              const top = Math.min(state.startY, state.currentY);
              const right = Math.max(state.startX, state.currentX);
              const bottom = Math.max(state.startY, state.currentY);
              return { left, top, right, bottom, width: right - left, height: bottom - top };
            };
            const updateMarqueeBox = (state: MarqueeState) => {
              ensureMarqueeStyle();
              if (!state.box) {
                const box = doc.createElement('div');
                box.setAttribute('data-od-marquee', 'true');
                doc.body.appendChild(box);
                state.box = box;
              }
              const rect = marqueeRect(state);
              state.box.style.left = `${rect.left}px`;
              state.box.style.top = `${rect.top}px`;
              state.box.style.width = `${rect.width}px`;
              state.box.style.height = `${rect.height}px`;
            };
            const removeMarqueeBox = () => {
              marqueeState?.box?.remove();
              if (marqueeState) marqueeState.box = null;
            };
            const rectsIntersect = (
              a: { left: number; top: number; right: number; bottom: number },
              b: DOMRect,
            ): boolean => (
              a.left <= b.right &&
              a.right >= b.left &&
              a.top <= b.bottom &&
              a.bottom >= b.top
            );
            const uniqueComponents = (items: Component[]): Component[] => {
              const out: Component[] = [];
              for (const item of items) {
                if (!out.includes(item)) out.push(item);
              }
              return out;
            };
            const removeNestedRedundancy = (items: Component[], preferDeep: boolean): Component[] => {
              const ordered = [...uniqueComponents(items)].sort((a, b) => (
                preferDeep ? componentDepth(b) - componentDepth(a) : componentDepth(a) - componentDepth(b)
              ));
              const out: Component[] = [];
              for (const item of ordered) {
                const parents = componentParents(item);
                const conflicts = out.some((chosen) => parents.includes(chosen) || componentParents(chosen).includes(item));
                if (!conflicts) out.push(item);
              }
              return out.sort((a, b) => componentDepth(a) - componentDepth(b));
            };
            const collectMarqueeComponents = (rect: ReturnType<typeof marqueeRect>, deep: boolean): Component[] => {
              const hits: Component[] = [];
              const seen = new Set<Component>();
              const elements = Array.from(doc.body.querySelectorAll('*'));
              for (const el of elements) {
                const comp = getComponentFromElement(el as Element | null);
                if (!comp || seen.has(comp)) continue;
                seen.add(comp);
                if (!comp.parent?.()) continue;
                const domEl = getElementFromComponent(comp) as HTMLElement | null;
                if (!domEl) continue;
                const r = domEl.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) continue;
                if (!rectsIntersect(rect, r)) continue;
                hits.push(deep ? comp : (findNearestFlexAncestor(comp) ?? comp));
              }
              return removeNestedRedundancy(hits, deep);
            };
            const applyMarqueeSelection = (picked: Component[], additive: boolean, deep: boolean) => {
              const nextPicked = removeNestedRedundancy(picked, deep);
              if (!additive) {
                editor.select(nextPicked.length > 0 ? nextPicked : undefined);
                return;
              }
              const selected = selectedComponents().filter((sel) => (
                !nextPicked.some((pick) => {
                  const pickParents = componentParents(pick);
                  const selParents = componentParents(sel);
                  return pickParents.includes(sel) || selParents.includes(pick);
                })
              ));
              editor.select(uniqueComponents([...selected, ...nextPicked]));
            };
            const startMarquee = (ev: PointerEvent) => {
              if (readOnlyRef.current || cropModeRef.current) return;
              const isDeepPointer = ev.shiftKey || ev.metaKey || ev.ctrlKey;
              if (ev.button !== 0 || (!isDeepPointer && isTextInputTarget(ev.target))) return;
              const startComp = getComponentFromElement(ev.target as Element | null);
              const startsOnCanvas = !startComp || !startComp.parent?.();
              const deep = ev.metaKey || ev.ctrlKey;
              if (!deep && !startsOnCanvas) return;
              marqueeState = {
                startX: ev.clientX,
                startY: ev.clientY,
                currentX: ev.clientX,
                currentY: ev.clientY,
                additive: ev.shiftKey,
                deep,
                moved: false,
                box: null,
                pointerId: ev.pointerId,
              };
              ev.preventDefault();
              ev.stopImmediatePropagation();
              try { doc.documentElement.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
            };
            const moveMarquee = (ev: PointerEvent) => {
              const state = marqueeState;
              if (!state) return;
              state.currentX = ev.clientX;
              state.currentY = ev.clientY;
              const dx = state.currentX - state.startX;
              const dy = state.currentY - state.startY;
              if (!state.moved && Math.hypot(dx, dy) < MARQUEE_THRESHOLD) return;
              state.moved = true;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              updateMarqueeBox(state);
            };
            const finishMarquee = (ev: PointerEvent) => {
              const state = marqueeState;
              if (!state) return;
              try { doc.documentElement.releasePointerCapture?.(state.pointerId); } catch { /* ignore */ }
              if (state.moved) {
                state.currentX = ev.clientX;
                state.currentY = ev.clientY;
                const rect = marqueeRect(state);
                const picked = collectMarqueeComponents(rect, state.deep);
                applyMarqueeSelection(picked, state.additive, state.deep);
                suppressClickAfterMarquee = true;
                setTimeout(() => { suppressClickAfterMarquee = false; }, 0);
                ev.preventDefault();
                ev.stopImmediatePropagation();
              } else if (state.deep) {
                const picked = deepestComponentAtCanvasPoint(state.startX, state.startY)
                  ?? getComponentFromElement(doc.elementFromPoint(state.startX, state.startY));
                if (picked) selectDeepComponent(picked, state.additive);
                suppressClickAfterMarquee = true;
                setTimeout(() => { suppressClickAfterMarquee = false; }, 0);
                ev.preventDefault();
                ev.stopImmediatePropagation();
              }
              removeMarqueeBox();
              marqueeState = null;
            };
            const cancelMarquee = () => {
              removeMarqueeBox();
              marqueeState = null;
            };

            const hostCanvasEl = (() => {
              try { return editor.Canvas.getElement?.() as HTMLElement | null | undefined; } catch { return null; }
            })();
            const onDocPositionedPointerDown = (ev: PointerEvent) => {
              startPositionedToolDrag(ev, 'doc');
            };
            const onHostPositionedPointerDown = (ev: PointerEvent) => {
              startPositionedToolDrag(ev, 'host');
            };
            const onDocCommentPointerDown = (ev: PointerEvent) => {
              triggerCanvasCommentPin(ev, 'doc');
            };
            const onHostCommentPointerDown = (ev: PointerEvent) => {
              triggerCanvasCommentPin(ev, 'host');
            };
            doc.addEventListener('pointerdown', onDocCommentPointerDown, true);
            hostCanvasEl?.addEventListener('pointerdown', onHostCommentPointerDown, true);
            doc.addEventListener('pointerdown', onPlacementPointerDown, true);
            hostCanvasEl?.addEventListener('pointerdown', onPlacementHostPointerDown, true);
            doc.addEventListener('pointerdown', onDocPositionedPointerDown, true);
            hostCanvasEl?.addEventListener('pointerdown', onHostPositionedPointerDown, true);
            doc.addEventListener('click', onClick, true);
            hostDocument.addEventListener('click', onHostChromeClick, true);
            doc.addEventListener('dblclick', onDblClick, true);
            doc.addEventListener('contextmenu', onCtxMenu, true);
            doc.addEventListener('mouseover', onMouseOver, true);
            doc.addEventListener('mouseout', onMouseOut, true);
            doc.addEventListener('pointerdown', startMarquee, true);
            doc.addEventListener('pointermove', updatePlacementInteraction, true);
            hostDocument.addEventListener('pointermove', updatePlacementInteraction, true);
            doc.addEventListener('pointerup', finishPlacementInteraction, true);
            hostDocument.addEventListener('pointerup', finishPlacementInteraction, true);
            doc.addEventListener('pointercancel', cancelPlacementInteraction, true);
            hostDocument.addEventListener('pointercancel', cancelPlacementInteraction, true);
            doc.addEventListener('pointermove', updatePositionedToolDrag, true);
            hostDocument.addEventListener('pointermove', updatePositionedToolDrag, true);
            doc.addEventListener('pointerup', finishPositionedToolDrag, true);
            hostDocument.addEventListener('pointerup', finishPositionedToolDrag, true);
            doc.addEventListener('pointercancel', cancelPositionedToolDrag, true);
            hostDocument.addEventListener('pointercancel', cancelPositionedToolDrag, true);
            doc.addEventListener('pointermove', moveMarquee, true);
            doc.addEventListener('pointerup', finishMarquee, true);
            doc.addEventListener('pointercancel', cancelMarquee, true);
            detachNestedSelect = () => {
              try {
                doc.removeEventListener('pointerdown', onDocCommentPointerDown, true);
                hostCanvasEl?.removeEventListener('pointerdown', onHostCommentPointerDown, true);
                doc.removeEventListener('pointerdown', onPlacementPointerDown, true);
                hostCanvasEl?.removeEventListener('pointerdown', onPlacementHostPointerDown, true);
                doc.removeEventListener('pointerdown', onDocPositionedPointerDown, true);
                hostCanvasEl?.removeEventListener('pointerdown', onHostPositionedPointerDown, true);
                doc.removeEventListener('click', onClick, true);
                hostDocument.removeEventListener('click', onHostChromeClick, true);
                doc.removeEventListener('dblclick', onDblClick, true);
                doc.removeEventListener('contextmenu', onCtxMenu, true);
                doc.removeEventListener('mouseover', onMouseOver, true);
                doc.removeEventListener('mouseout', onMouseOut, true);
                doc.removeEventListener('pointerdown', startMarquee, true);
                doc.removeEventListener('pointermove', updatePlacementInteraction, true);
                hostDocument.removeEventListener('pointermove', updatePlacementInteraction, true);
                doc.removeEventListener('pointerup', finishPlacementInteraction, true);
                hostDocument.removeEventListener('pointerup', finishPlacementInteraction, true);
                doc.removeEventListener('pointercancel', cancelPlacementInteraction, true);
                hostDocument.removeEventListener('pointercancel', cancelPlacementInteraction, true);
                doc.removeEventListener('pointermove', updatePositionedToolDrag, true);
                hostDocument.removeEventListener('pointermove', updatePositionedToolDrag, true);
                doc.removeEventListener('pointerup', finishPositionedToolDrag, true);
                hostDocument.removeEventListener('pointerup', finishPositionedToolDrag, true);
                doc.removeEventListener('pointercancel', cancelPositionedToolDrag, true);
                hostDocument.removeEventListener('pointercancel', cancelPositionedToolDrag, true);
                doc.removeEventListener('pointermove', moveMarquee, true);
                doc.removeEventListener('pointerup', finishMarquee, true);
                doc.removeEventListener('pointercancel', cancelMarquee, true);
                cancelPlacementInteraction();
                cancelPositionedToolDrag();
                cancelMarquee();
                clearChildHover();
                delete (doc as unknown as { __odNestedSelect?: true }).__odNestedSelect;
              } catch { /* ignore */ }
            };

            // Clipboard image paste: when the user pastes a screenshot (e.g.
            // Ctrl/Cmd+V after a screenshot tool) while the canvas has focus,
            // insert it as an <img> — or, if an <img> is selected, replace
            // its src. We attach to BOTH the canvas doc and the host window so
            // the paste works whether focus is inside the iframe or outside.
            let lastInternalPasteAt = 0;
            const markInternalPaste = () => {
              lastInternalPasteAt = Date.now();
            };
            editor.on('keymap:emit:core:paste', markInternalPaste);
            editor.on('component:paste', markInternalPaste);
            const handleImagePaste = async (ev: ClipboardEvent) => {
              if (readOnlyRef.current) return;
              if (!shouldHandleGrapesjsImagePaste({
                clipboardData: ev.clipboardData,
                lastInternalPasteAt,
              })) {
                return;
              }
              const file = firstGrapesjsClipboardImageFile(ev.clipboardData);
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
              try { editor.off('keymap:emit:core:paste', markInternalPaste); } catch { /* ignore */ }
              try { editor.off('component:paste', markInternalPaste); } catch { /* ignore */ }
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
            try { editor.off('component:deselected', hideRadiusHandles); } catch { /* ignore */ }
            try { editor.off('canvas:zoom', onLiveToolsGeometryChange); } catch { /* ignore */ }
            try { editor.off('canvas:coords', onLiveToolsGeometryChange); } catch { /* ignore */ }
            try { editor.off('component:drag', onLiveToolsGeometryChange); } catch { /* ignore */ }
            try { detachResizePersistence(); } catch { /* ignore */ }
            try { detachCanvasViewportSync(); } catch { /* ignore */ }
            try { detachToolsLayoutResize?.(); } catch { /* ignore */ }
            if (toolsRefreshRaf) window.cancelAnimationFrame(toolsRefreshRaf);
            if (selectionSnapshotRefreshRaf) window.cancelAnimationFrame(selectionSnapshotRefreshRaf);
            try { selectionStroke?.remove(); } catch { /* ignore */ }
            selectionStroke = null;
            try { dimensionBadge?.remove(); } catch { /* ignore */ }
            dimensionBadge = null;
            detachRadiusHandles?.();
            detachRadiusHandles = null;
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
          const buildSelectionSnapshot = (): SelectionSnapshot => {
            const all = editor.getSelectedAll?.() ?? [];
            const first = all[0];
            if (!first) {
              return { hasSelection: false, tagName: '', selector: '', styles: {}, selectedColors: [] };
            }
            const comp = first as Component;
            const el = getElementFromComponent(comp);
            const styles = mergeSelectionSnapshotStyles(
              readElementStyles(el),
              getComponentStyleRecord(comp),
            );
            let tagName = 'div';
            try { tagName = (comp.get('tagName') as string) ?? 'div'; } catch { /* ignore */ }
            let componentType = '';
            try { componentType = String(comp.get('type') ?? ''); } catch { /* ignore */ }
            let selector = tagName;
            let canvasTool = '';
            try {
              const attrs = comp.getAttributes() as Record<string, unknown>;
              const id = typeof attrs['id'] === 'string' ? attrs['id'] : '';
              const cls = typeof attrs['class'] === 'string' ? attrs['class'] : '';
              canvasTool = typeof attrs['data-od-canvas-tool'] === 'string' ? attrs['data-od-canvas-tool'] : '';
              selector = `${tagName}${id ? `#${id}` : ''}${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`;
            } catch { /* ignore */ }
            return {
              hasSelection: true,
              tagName,
              selector,
              componentType,
              canvasTool,
              styles,
              selectedColors: selectionColorCollectorRef.current.collect(editor),
            };
          };
          // Expose a way to re-emit the selection snapshot after a style write
          // so the StylePanel shows updated values. We defer 1 rAF so the
          // computed style has time to reflow.
          refreshSelectionSnapshotRef.current = () => {
            window.requestAnimationFrame(() => {
              const cb = onSelectionChangeRef.current;
              if (!cb) return;
              try {
                cb(buildSelectionSnapshot());
              } catch { /* ignore */ }
            });
          };
          readSelectionSnapshotRef.current = buildSelectionSnapshot;

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
            selectionColorCollectorRef.current.invalidate();
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
                cb2(buildSelectionSnapshot());
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
            selectionColorCollectorRef.current.invalidate();
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
            if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && (ev.key === 'r' || ev.key === 'R')) {
              ev.preventDefault();
              onReloadRef.current?.();
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
      currentCanvasStylesRef.current = readCanvasBodyStyleOverrides(parsed);
      selectionColorCollectorRef.current.invalidate();
      lastExternalHtmlRef.current = html;
      lastEmittedRef.current = '';
      // Reset components — od-stable-id-plugin will re-tag path-based ids
      // but preserve explicit data-od-id from the AI.
      try {
        editor.setComponents(canvasComponentHtml(parsed, baseHrefRef.current));
        setEditorManagedCss(editor, extractSavedEditorCss(parsed.head));
        const doc = editor.Canvas.getDocument();
        applyCanvasHeadAssets(doc, parsed, baseHrefRef.current);
        applyCanvasBodyAttributes(doc, parsed);
        applyCanvasBodyStyleOverrides(editor, currentCanvasStylesRef.current);
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
          return buildEditorDocument(editor, parsed, baseHrefRef.current, currentCanvasStylesRef.current);
        },
        setHtml: (next: string) => {
          const editor = editorRef.current;
          if (!editor) return;
          const parsed = parseHtmlDocument(next);
          parsedRef.current = parsed;
          currentCanvasStylesRef.current = readCanvasBodyStyleOverrides(parsed);
          selectionColorCollectorRef.current.invalidate();
          lastExternalHtmlRef.current = next;
          lastEmittedRef.current = '';
          try {
            editor.setComponents(canvasComponentHtml(parsed, baseHrefRef.current));
            setEditorManagedCss(editor, extractSavedEditorCss(parsed.head));
            const doc = editor.Canvas.getDocument();
            applyCanvasHeadAssets(doc, parsed, baseHrefRef.current);
            applyCanvasBodyAttributes(doc, parsed);
            applyCanvasBodyStyleOverrides(editor, currentCanvasStylesRef.current);
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
            selectionColorCollectorRef.current.invalidate();
            // Re-emit the selection snapshot so the StylePanel's NumberScrub /
            // color inputs reflect the just-written values (computed style
            // reads fresh after setStyle).
            refreshSelectionSnapshotRef.current?.();
            // setStyle() doesn't reliably trigger GrapesJS's styleUpdate event
            // for host-driven panel edits, so explicitly emit a document change
            // to keep the auto-save path from dropping spacing/style updates.
            scheduleEmitRef.current?.();
          } catch { /* ignore */ }
        },
        getCanvasStyles: () => {
          const editor = editorRef.current;
          const body = editor ? readElementStyles(getCanvasBodyElFromEditor(editor)) : {};
          return mergeCanvasStyleSnapshot(body, currentCanvasStylesRef.current);
        },
        getCanvasState: () => {
          const editor = editorRef.current;
          if (!editor) return { styles: {}, size: null };
          return {
            styles: mergeCanvasStyleSnapshot(
              readElementStyles(getCanvasBodyElFromEditor(editor)),
              currentCanvasStylesRef.current,
            ),
            size: currentCanvasSizeRef.current ?? readCanvasFrameSize(editor),
          };
        },
        setCanvasStyles: (styles: Record<string, string>) => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            const nextCanvasStyles = toCssStyleProps(styles);
            currentCanvasStylesRef.current = {
              ...currentCanvasStylesRef.current,
              ...nextCanvasStyles,
            };
            const body = getCanvasBodyElFromEditor(editor);
            if (body) applyCanvasBodyStyleOverrides(editor, nextCanvasStyles);
            scheduleEmitRef.current?.();
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
                dm.add?.({ id: 'od-custom', name: 'Custom', width: `${width}px`, height: `${height}px` });
                dm.select?.('od-custom');
              } catch { /* fall through */ }
            }
            currentCanvasSizeRef.current = { width, height };
            applyCanvasFrameSize(editor, width, height);
            // Recenter the frame in the viewport so the user isn't left
            // looking at a panned/zoomed corner after switching device. The
            // fit clamps to <=100%, so small devices don't enlarge past their
            // real size when there is already enough room.
            try {
              fitCanvasFrameToViewport(editor);
            } catch { /* ignore — fitViewport best-effort */ }
            syncZoomAttrRef.current?.();
            syncCoordsAttrRef.current?.();
          } catch { /* ignore */ }
        },
        setCanvasSize: (width?: number, height?: number) => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            userCanvasSizeEditVersionRef.current += 1;
            const currentSize = readCanvasFrameSize(editor) ?? { width: 0, height: 0 };
            const nextWidth = typeof width === 'number' && width > 0 ? width : currentSize.width;
            const nextHeight = typeof height === 'number' && height > 0 ? height : currentSize.height;
            if (nextWidth > 0 && nextHeight > 0) {
              currentCanvasSizeRef.current = { width: nextWidth, height: nextHeight };
              applyCanvasFrameSize(editor, nextWidth, nextHeight);
            }
            // Persist into the document <html> so getDocument() round-trips
            // the size through auto-save (the canvas frame DOM is transient —
            // it isn't part of the artifact HTML). On reload, the boot effect
            // reads these attrs and re-applies them to the frame.
            const doc = editor.Canvas.getDocument?.();
            const root = doc?.documentElement;
            if (root) {
              if (nextWidth > 0) root.setAttribute('data-od-canvas-width', String(nextWidth));
              if (nextHeight > 0) root.setAttribute('data-od-canvas-height', String(nextHeight));
            }
            if (nextWidth > 0 && nextHeight > 0) {
              onViewportSizeChangeRef.current?.(nextWidth, nextHeight);
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
        getSelectionSnapshot: () => (
          readSelectionSnapshotRef.current?.() ??
          { hasSelection: false, tagName: '', selector: '', styles: {}, selectedColors: [] }
        ),
        setCropMode: (on: boolean) => {
          cropModeRef.current = on;
          syncCropOverlayRef.current?.();
        },
        replaceColors: (targets: string[], replacement: string) => {
          const count = replaceColorsInSelection(editorRef.current, targets, replacement);
          if (count > 0) {
            selectionColorCollectorRef.current.invalidate();
            refreshSelectionSnapshotRef.current?.();
            scheduleEmitRef.current?.();
          }
          return count;
        },
        arrangeSelectionAsFlex: (axis?: 'row' | 'column') => {
          const editor = editorRef.current;
          if (!editor) return false;
          const ok = arrangeGrapesjsSelectionAsFlex(editor, selectionOrderRef.current, axis);
          if (ok) {
            selectionColorCollectorRef.current.invalidate();
            refreshSelectionSnapshotRef.current?.();
            scheduleEmitRef.current?.();
          }
          return ok;
        },
        dissolveSelectedFlex: () => {
          const editor = editorRef.current;
          if (!editor) return false;
          const ok = dissolveGrapesjsFlexSelection(editor);
          if (ok) {
            selectionColorCollectorRef.current.invalidate();
            refreshSelectionSnapshotRef.current?.();
            scheduleEmitRef.current?.();
          }
          return ok;
        },
        getEditor: () => editorRef.current ?? null,
      }),
      [html, layersPanelRef, stylePanelRef],
    );

    const rootClass = useMemo(() => {
      const parts = [styles.root];
      if (className) parts.push(className);
      if (selectionChrome === 'element-selection') parts.push('od-gjs-element-selection-mode');
      return parts.filter(Boolean).join(' ');
    }, [className, selectionChrome]);

    const commitArtboardLabel = useCallback(() => {
      const next = artboardLabelDraft.trim() || artboardName;
      setArtboardLabelEditing(false);
      setArtboardLabelDraft(next);
      onArtboardNameChangeRef.current?.(next);
    }, [artboardLabelDraft, artboardName]);

    const beginArtboardLabelEdit = useCallback(() => {
      setArtboardLabelDraft(artboardName);
      setArtboardLabelEditing(true);
    }, [artboardName]);

    const onArtboardLabelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitArtboardLabel();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setArtboardLabelDraft(artboardName);
        setArtboardLabelEditing(false);
      }
    }, [artboardName, commitArtboardLabel]);

    const onArtboardLabelPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
      if (artboardLabelEditing || event.button !== 0) return;
      const editor = editorRef.current;
      if (!editor) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      let originX = 0;
      let originY = 0;
      try {
        const coords = editor.Canvas.getCoords?.() ?? { x: 0, y: 0 };
        originX = typeof coords.x === 'number' ? coords.x : 0;
        originY = typeof coords.y === 'number' ? coords.y : 0;
      } catch {
        originX = 0;
        originY = 0;
      }
      const doc = event.currentTarget.ownerDocument;
      const win = doc.defaultView ?? window;
      const move = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        try {
          editor.Canvas.setCoords(originX + moveEvent.clientX - startX, originY + moveEvent.clientY - startY);
          syncCoordsAttrRef.current?.();
          syncArtboardLabelPositionRef.current?.();
        } catch { /* ignore */ }
      };
      const up = (_upEvent: PointerEvent) => {
        win.removeEventListener('pointermove', move, true);
        win.removeEventListener('pointerup', up, true);
        syncCoordsAttrRef.current?.();
        syncArtboardLabelPositionRef.current?.();
      };
      win.addEventListener('pointermove', move, true);
      win.addEventListener('pointerup', up, true);
    }, [artboardLabelEditing]);

    const artboardLabelNode = (
      <div
        ref={artboardLabelRef}
        className={styles.artboardLabel}
        style={{ display: loading || loadError ? 'none' : undefined }}
        onPointerDown={onArtboardLabelPointerDown}
        onDoubleClick={beginArtboardLabelEdit}
        title={artboardName}
      >
        {artboardLabelEditing ? (
          <input
            className={styles.artboardLabelInput}
            value={artboardLabelDraft}
            autoFocus
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setArtboardLabelDraft(event.currentTarget.value)}
            onBlur={commitArtboardLabel}
            onKeyDown={onArtboardLabelKeyDown}
          />
        ) : (
          <span className={styles.artboardLabelText}>{artboardName}</span>
        )}
      </div>
    );

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
        {artboardLabelNode}
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
