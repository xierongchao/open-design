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
  pruneOrphanCssRules,
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
import { renderGrapesjsIconSvg, type GrapesjsIconInsertInput } from './icon-library';
import {
  exposeOpenDesignEditorDiagnosticsToWindow,
  recordOpenDesignEditorDiagnostic,
} from '../../diagnostics/editor-diagnostics';
import styles from './GrapesjsEditor.module.css';

function readOdIdFromComponent(comp: unknown): string | null {
  return getOdIdFromComponent(comp as Component);
}

function recordGrapesjsEditorDiagnostic(name: string, detail?: unknown): void {
  recordOpenDesignEditorDiagnostic(`grapesjs:${name}`, detail);
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

function requestEditorAnimationFrame(callback: FrameRequestCallback): number {
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf === 'function') return raf.call(globalThis, callback);
  return Number(setTimeout(() => callback(Date.now()), 16));
}

function cancelEditorAnimationFrame(id: number): void {
  const cancel = globalThis.cancelAnimationFrame;
  if (typeof cancel === 'function') {
    cancel.call(globalThis, id);
    return;
  }
  clearTimeout(id);
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

export function grapesjsShortcutLetterFromEvent(event: Pick<KeyboardEvent, 'code' | 'key'>): string {
  const codeMatch = /^Key([A-Z])$/.exec(event.code ?? '');
  if (codeMatch?.[1]) return codeMatch[1].toLowerCase();
  return String(event.key ?? '').toLowerCase();
}

export function runGrapesjsHistoryShortcut(
  editor: { runCommand?: (command: string) => unknown },
  event: KeyboardEvent,
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  const key = String(event.key ?? '').toLowerCase();
  const command = key === 'z'
    ? (event.shiftKey ? 'core:redo' : 'core:undo')
    : key === 'y'
      ? 'core:redo'
      : null;
  if (!command) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  try { editor.runCommand?.(command); } catch { /* ignore */ }
  return true;
}

export function scheduleGrapesjsPlacementChange(
  phase: GrapesjsPlacementChangePhase,
  scheduleEmit: (() => void) | null | undefined,
): void {
  if (phase === 'insert') return;
  scheduleEmit?.();
}

export const GRAPESJS_CUT_EMIT_DELAY_MS = 650;
const GRAPESJS_CLIPBOARD_IMAGE_PASTE_SUPPRESSION_MS = 1_200;

export function scheduleGrapesjsDeferredCutEmit(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  scheduleEmit: () => void,
  delayMs = GRAPESJS_CUT_EMIT_DELAY_MS,
): void {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    scheduleEmit();
  }, delayMs);
}

export function cancelGrapesjsDeferredCutEmit(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
): boolean {
  if (!timerRef.current) return false;
  clearTimeout(timerRef.current);
  timerRef.current = null;
  return true;
}

export function scheduleGrapesjsCutAwareEmit(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  cutPendingRef: { current: boolean },
  scheduleEmit: () => void,
  delayMs = GRAPESJS_CUT_EMIT_DELAY_MS,
): void {
  if (!cutPendingRef.current) {
    scheduleEmit();
    return;
  }
  scheduleGrapesjsDeferredCutEmit(timerRef, () => {
    cutPendingRef.current = false;
    scheduleEmit();
  }, delayMs);
}

export function cancelGrapesjsPendingCutEmit(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  cutPendingRef: { current: boolean },
): boolean {
  const hadPendingCut = cutPendingRef.current;
  cutPendingRef.current = false;
  return cancelGrapesjsDeferredCutEmit(timerRef) || hadPendingCut;
}

export function scheduleGrapesjsClipboardCutRemovalEmit(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  cutPendingRef: { current: boolean },
  scheduleEmit: () => void,
  delayMs = GRAPESJS_CUT_EMIT_DELAY_MS,
): void {
  cutPendingRef.current = true;
  scheduleGrapesjsCutAwareEmit(timerRef, cutPendingRef, scheduleEmit, delayMs);
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
  suppressImagePasteUntil = 0,
  now = Date.now(),
}: {
  clipboardData: DataTransfer | null | undefined;
  lastInternalPasteAt: number;
  suppressImagePasteUntil?: number;
  now?: number;
}): boolean {
  if (!clipboardHasImageFile(clipboardData)) return false;
  if (now < suppressImagePasteUntil) return false;
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
  ['textDecoration', 'text-decoration'],
  ['textTransform', 'text-transform'],
  ['color', 'color'],
  ['boxShadow', 'box-shadow'],
  ['textShadow', 'text-shadow'],
];

function px(value: number): string {
  return `${Math.max(GRAPESJS_CANVAS_TOOL_MIN_SIZE, Math.round(value))}px`;
}

export function buildGrapesjsCssStyleClipboard(style: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [camelKey, cssKey] of GRAPESJS_STYLE_CLIPBOARD_PROPS) {
    const value = (style[cssKey] ?? style[camelKey])?.trim();
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

/**
 * Default size (px) for a placeable canvas tool, used when the user clicks
 * without dragging (a tap creates a default-sized element rather than the
 * 0×0 the drag-draw insertion starts at). Mirrors the per-tool defaults in
 * `appendGrapesjsCanvasToolComponent`.
 */
export function getGrapesjsCanvasToolDefaultSize(tool: GrapesjsPlaceableCanvasTool): { width: number; height: number } {
  switch (tool) {
    case 'circle': return { width: 112, height: 112 };
    case 'line': return { width: 180, height: 2 };
    case 'rectangle': return { width: 160, height: 96 };
    default: return { width: 160, height: 96 };
  }
}

/** Style patch giving a placeable tool its default size at `start`. */
export function getGrapesjsCanvasToolDefaultStyle(
  tool: GrapesjsPlaceableCanvasTool,
  start: GrapesjsCanvasPoint,
  mode: GrapesjsCanvasPlacementMode = 'absolute',
): Record<string, string> {
  const { width, height } = getGrapesjsCanvasToolDefaultSize(tool);
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

function componentDiagnosticId(comp: Component | null | undefined): string | null {
  if (!comp) return null;
  const attrs = getComponentAttributes(comp);
  const idAttr = typeof attrs['id'] === 'string' ? attrs['id'] : null;
  const odIdAttr = typeof attrs['data-od-id'] === 'string' ? attrs['data-od-id'] : null;
  return getOdIdFromComponent(comp) ?? idAttr ?? odIdAttr ?? '<no-od-id>';
}

/**
 * Resolve the canvas root wrapper component (the single component under the
 * GrapesJS body). Used as the attachment point for cross-parent operations
 * like wrapping scattered absolute elements into one new flex container.
 */
function getRootWrapperComponent(editor: GrapesjsEditorInstance): Component | null {
  try {
    return (
      editor.getWrapper?.() ??
      editor.Components?.getWrapper?.() ??
      editor.Components?.getComponents?.().get?.(0) ??
      null
    ) as Component | null;
  } catch {
    return null;
  }
}

function setComponentAttributes(comp: Component, patch: Record<string, string>): void {
  try {
    comp.setAttributes?.({ ...getComponentAttributes(comp), ...patch });
  } catch { /* ignore */ }
}

function getComponentStyleRecord(comp: Component | null | undefined): Record<string, string> {
  try { return { ...(comp?.getStyle?.() ?? {}) } as Record<string, string>; } catch { return {}; }
}

function writeGrapesjsElementStyle(comp: Component | null | undefined, patch: Record<string, string>): void {
  const el = getElementFromComponent(comp) as HTMLElement | null;
  if (!el?.style) return;
  for (const [key, value] of Object.entries(patch)) {
    try { el.style.setProperty(key, value); } catch { /* ignore */ }
  }
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

export function applyGrapesjsCssStyleClipboardToComponents(
  targets: Component[],
  styles: Record<string, string>,
): boolean {
  const clipboardStyles = buildGrapesjsCssStyleClipboard(styles);
  if (Object.keys(clipboardStyles).length === 0 || targets.length === 0) return false;
  let applied = false;
  for (const comp of targets) {
    try {
      // Merge the pasted props onto the component's existing style record so
      // the paste persists (comp.setStyle updates the model; the live DOM
      // element is mirrored too). Do NOT schedule clearGrapesjsManagedInlineStyle
      // here — that helper strips the very props we just wrote, so a paste
      // applied, then vanished on the next animation frame ("没有效果").
      comp.setStyle?.({
        ...getComponentStyleRecord(comp),
        ...clipboardStyles,
      } as Parameters<typeof comp.setStyle>[0]);
      writeGrapesjsElementStyle(comp, clipboardStyles);
      applied = true;
    } catch { /* ignore */ }
  }
  return applied;
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
  if (attrs['data-od-position-mode'] === 'absolute') return true;
  const style = getComponentStyleRecord(comp);
  return style.position === 'absolute';
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

/**
 * True when `comp` is a direct child of a flex/inline-flex container.
 * Uses `readParentFlexInfo` so an external-CSS flex parent (Tailwind `.flex`,
 * artifact `<style>`, etc.) is detected, not just inline-style flex.
 */
export function isGrapesjsFlexChildComponent(comp: Component | null | undefined): boolean {
  const parent = comp?.parent?.();
  if (!parent || parent === comp) return false;
  const { display } = readParentFlexInfo(parent);
  return display === 'flex' || display === 'inline-flex';
}

/**
 * Resolve the flex container that owns `comp`, or null if `comp` is not a
 * flex child. Mirrors `findGrapesjsPositionedDragComponent` but climbs to the
 * flex parent rather than to an absolute ancestor.
 */
export function findGrapesjsFlexParentComponent(comp: Component | null | undefined): Component | null {
  let node: Component | null | undefined = comp;
  while (node) {
    const parent = node.parent?.();
    if (!parent || parent === node) return null;
    const { display } = readParentFlexInfo(parent);
    if (display === 'flex' || display === 'inline-flex') return parent;
    node = parent;
  }
  return null;
}

function isGrapesjsAutoLayoutWrapper(comp: Component | null | undefined): boolean {
  return getComponentAttributes(comp)['data-od-auto-layout-wrapper'] === 'true';
}

function findGrapesjsAutoLayoutWrapperForDissolve(comp: Component | null | undefined): Component | null {
  let node: Component | null | undefined = comp;
  while (node) {
    if (isGrapesjsAutoLayoutWrapper(node)) return node;
    const parent = node.parent?.();
    if (!parent || parent === node) break;
    node = parent;
  }
  return null;
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

type GrapesjsClientRectLike =
  Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>
  & Partial<Pick<DOMRect, 'width' | 'height'>>;

type GrapesjsFlexInsertChildEntry = {
  comp: Component;
  el: HTMLElement;
};

export function isPointInsideGrapesjsClientRect(
  clientX: number,
  clientY: number,
  rect: GrapesjsClientRectLike,
  tolerance = 4,
): boolean {
  return (
    clientX >= rect.left - tolerance && clientX <= rect.right + tolerance
    && clientY >= rect.top - tolerance && clientY <= rect.bottom + tolerance
  );
}

export function resolveGrapesjsFlexInsertTarget<T>({
  sourceParent,
  sourceParentRect,
  fallbackTarget,
  clientX,
  clientY,
  tolerance = 4,
}: {
  sourceParent: T | null;
  sourceParentRect: GrapesjsClientRectLike | null;
  fallbackTarget: T | null;
  clientX: number;
  clientY: number;
  tolerance?: number;
}): T | null {
  if (sourceParent && sourceParentRect && isPointInsideGrapesjsClientRect(clientX, clientY, sourceParentRect, tolerance)) {
    return sourceParent;
  }
  return fallbackTarget;
}

function grapesjsRectAxisSize(rect: GrapesjsClientRectLike, axis: GrapesjsLayoutAxis): number {
  const explicit = axis === 'row' ? rect.width : rect.height;
  if (typeof explicit === 'number') return explicit;
  return axis === 'row' ? rect.right - rect.left : rect.bottom - rect.top;
}

function grapesjsRectAxisCenter(rect: GrapesjsClientRectLike, axis: GrapesjsLayoutAxis): number {
  return axis === 'row'
    ? rect.left + grapesjsRectAxisSize(rect, axis) / 2
    : rect.top + grapesjsRectAxisSize(rect, axis) / 2;
}

export function resolveGrapesjsFlexInsertIndexFromRects({
  axis,
  clientX,
  clientY,
  draggedRect,
  childRects,
}: {
  axis: GrapesjsLayoutAxis;
  clientX: number;
  clientY: number;
  draggedRect: GrapesjsClientRectLike | null;
  childRects: GrapesjsClientRectLike[];
}): number {
  const measure = draggedRect && grapesjsRectAxisSize(draggedRect, axis) > 0
    ? grapesjsRectAxisCenter(draggedRect, axis)
    : (axis === 'row' ? clientX : clientY);
  for (let i = 0; i < childRects.length; i += 1) {
    const rect = childRects[i];
    if (!rect || grapesjsRectAxisSize(rect, axis) <= 0) continue;
    if (measure < grapesjsRectAxisCenter(rect, axis)) return i;
  }
  return childRects.length;
}

export function resolveGrapesjsPreviewRectFromDragItem({
  item,
  fallbackRect,
  deltaLeft,
  deltaTop,
}: {
  item: {
    startLeft: number;
    startTop: number;
    pendingStyle: Record<string, string> | null;
  } | null | undefined;
  fallbackRect: GrapesjsClientRectLike | null;
  deltaLeft?: number;
  deltaTop?: number;
}): GrapesjsClientRectLike | null {
  if (!item || !fallbackRect) return fallbackRect;
  const width = grapesjsRectAxisSize(fallbackRect, 'row');
  const height = grapesjsRectAxisSize(fallbackRect, 'column');
  if (width <= 0 || height <= 0) return fallbackRect;
  const nextLeft = Number.parseFloat(item.pendingStyle?.left ?? '');
  const nextTop = Number.parseFloat(item.pendingStyle?.top ?? '');
  const resolvedDeltaLeft = typeof deltaLeft === 'number' && Number.isFinite(deltaLeft)
    ? deltaLeft
    : (Number.isFinite(nextLeft) ? nextLeft : item.startLeft) - item.startLeft;
  const resolvedDeltaTop = typeof deltaTop === 'number' && Number.isFinite(deltaTop)
    ? deltaTop
    : (Number.isFinite(nextTop) ? nextTop : item.startTop) - item.startTop;
  const left = fallbackRect.left + resolvedDeltaLeft;
  const top = fallbackRect.top + resolvedDeltaTop;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

export function resolveGrapesjsFlexInsertChildEntries({
  target,
  targetEl,
  dragged,
}: {
  target: Component;
  targetEl: HTMLElement;
  dragged: Component | null;
}): {
  entries: GrapesjsFlexInsertChildEntry[];
  source: 'model' | 'dom';
  modelChildCount: number;
  modelElementCount: number;
  domChildCount: number;
} {
  const modelChildren = directComponentChildren(target).filter((c) => c !== dragged);
  const modelEntries = modelChildren
    .map((comp) => ({ comp, el: getElementFromComponent(comp) as HTMLElement | null }))
    .filter((entry): entry is GrapesjsFlexInsertChildEntry => Boolean(entry.el));
  const targetDomChildren = Array.from(targetEl.children ?? [])
    .filter((el): el is HTMLElement => (el as { nodeType?: number }).nodeType === 1);
  if (modelEntries.length > 0 || targetDomChildren.length === 0) {
    return {
      entries: modelEntries,
      source: 'model',
      modelChildCount: modelChildren.length,
      modelElementCount: modelEntries.length,
      domChildCount: targetDomChildren.length,
    };
  }
  const draggedEl = dragged ? getElementFromComponent(dragged) : null;
  const domEntries: GrapesjsFlexInsertChildEntry[] = [];
  for (const el of targetDomChildren) {
    if (draggedEl && el === draggedEl) continue;
    const comp = getComponentFromElement(el);
    if (!comp || comp === dragged || comp.parent?.() !== target) continue;
    domEntries.push({ comp, el });
  }
  return {
    entries: domEntries,
    source: 'dom',
    modelChildCount: modelChildren.length,
    modelElementCount: modelEntries.length,
    domChildCount: targetDomChildren.length,
  };
}

export type GrapesjsSelectionBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
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

export type GrapesjsPositionAlignMode =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-y';

function selectedEditableComponentsFromEditor(editor: unknown): Component[] {
  try {
    return ((editor as GrapesjsEditorInstance | null)?.getSelectedAll?.() ?? [] as Component[])
      .filter((comp): comp is Component => Boolean(comp?.parent?.()));
  } catch {
    return [];
  }
}

function positionedSelectionComponents(editor: unknown): Component[] {
  const seen = new Set<Component>();
  const out: Component[] = [];
  for (const selected of selectedEditableComponentsFromEditor(editor)) {
    const positioned = findGrapesjsPositionedDragComponent(selected);
    if (!positioned || seen.has(positioned) || !positioned.parent?.()) continue;
    seen.add(positioned);
    out.push(positioned);
  }
  return out;
}

function setGrapesjsComponentPosition(
  comp: Component,
  next: { left?: number; top?: number },
): void {
  const style = getComponentStyleRecord(comp);
  const patch: Record<string, string> = { position: style.position || 'absolute' };
  if (next.left !== undefined) patch.left = `${Math.max(0, Math.round(next.left))}px`;
  if (next.top !== undefined) patch.top = `${Math.max(0, Math.round(next.top))}px`;
  try {
    comp.setStyle?.({
      ...style,
      ...patch,
    } as Parameters<typeof comp.setStyle>[0]);
  } catch { /* ignore */ }
}

function positionedComponentBox(
  comp: Component,
  rootRect: DOMRect | null,
): (GrapesjsComponentBox & { comp: Component; styleLeft: number; styleTop: number }) | null {
  const box = componentBox(comp, rootRect);
  if (!box) return null;
  const style = getComponentStyleRecord(comp);
  return {
    ...box,
    comp,
    styleLeft: parseCssPxStrict(style.left) ?? box.left,
    styleTop: parseCssPxStrict(style.top) ?? box.top,
  };
}

function positionedBounds(boxes: GrapesjsComponentBox[]): GrapesjsComponentBox | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
    left,
    top,
    right,
    bottom,
  };
}

type PositionedSelectionBox = GrapesjsComponentBox & {
  comp: Component;
  styleLeft: number;
  styleTop: number;
};

function setGrapesjsComponentBounds(
  box: PositionedSelectionBox,
  next: { left: number; top: number; width: number; height: number },
): void {
  const style = getComponentStyleRecord(box.comp);
  try {
    box.comp.setStyle?.({
      ...style,
      ...positionedBoundsStylePatch(style.position, next),
    } as Parameters<typeof box.comp.setStyle>[0]);
  } catch { /* ignore */ }
}

function positionedBoundsStylePatch(
  currentPosition: string | undefined,
  next: { left: number; top: number; width: number; height: number },
): Record<string, string> {
  return {
    position: currentPosition || 'absolute',
    left: `${Math.max(0, Math.round(next.left))}px`,
    top: `${Math.max(0, Math.round(next.top))}px`,
    width: `${Math.max(1, Math.round(next.width))}px`,
    height: `${Math.max(1, Math.round(next.height))}px`,
  };
}

function resizedPositionedBoxStylePatch(
  box: PositionedSelectionBox,
  sourceBounds: GrapesjsComponentBox,
  nextBounds: GrapesjsSelectionBounds,
): Record<string, string> {
  const targetWidth = Math.max(1, nextBounds.width);
  const targetHeight = Math.max(1, nextBounds.height);
  const scaleX = targetWidth / Math.max(1, sourceBounds.w);
  const scaleY = targetHeight / Math.max(1, sourceBounds.h);
  const nextLeft = nextBounds.left + (box.left - sourceBounds.left) * scaleX;
  const nextTop = nextBounds.top + (box.top - sourceBounds.top) * scaleY;
  const style = getComponentStyleRecord(box.comp);
  return positionedBoundsStylePatch(style.position, {
    left: box.styleLeft + nextLeft - box.left,
    top: box.styleTop + nextTop - box.top,
    width: box.w * scaleX,
    height: box.h * scaleY,
  });
}

/**
 * Flex-child analogue of `resizedPositionedBoxStylePatch`: scales every
 * selected flex child proportionally to the group's new bounds (same scaleX/
 * scaleY math), but writes flex-appropriate properties instead of left/top.
 *
 *   • main axis (row → x / column → y) → `flex-basis` so the child keeps
 *     participating in the flex layout at the new size rather than being
 *     yanked out by an absolute `left`/`top`.
 *   • cross axis → `width`/`height` so the child's cross dimension tracks the
 *     proportional scale too (visual parity with the absolute path).
 *
 * `left`/`top` are intentionally NOT written — moving a flex child with
 * coordinates would break its layout flow.
 */
function resizedFlexChildBoxStylePatch(
  box: PositionedSelectionBox,
  sourceBounds: GrapesjsComponentBox,
  nextBounds: GrapesjsSelectionBounds,
  parentAxis: GrapesjsLayoutAxis,
): Record<string, string> {
  const targetWidth = Math.max(1, nextBounds.width);
  const targetHeight = Math.max(1, nextBounds.height);
  const scaleX = targetWidth / Math.max(1, sourceBounds.w);
  const scaleY = targetHeight / Math.max(1, sourceBounds.h);
  const nextMain = parentAxis === 'row' ? box.w * scaleX : box.h * scaleY;
  const nextCross = parentAxis === 'row' ? box.h * scaleY : box.w * scaleX;
  return {
    'flex-basis': `${Math.max(1, Math.round(nextMain))}px`,
    ...(parentAxis === 'row'
      ? { height: `${Math.max(1, Math.round(nextCross))}px` }
      : { width: `${Math.max(1, Math.round(nextCross))}px` }),
  };
}

function resizePositionedBoxesToBounds(
  boxes: PositionedSelectionBox[],
  nextBounds: GrapesjsSelectionBounds,
  sourceBounds = positionedBounds(boxes),
): boolean {
  if (boxes.length < 2 || !sourceBounds) return false;
  for (const box of boxes) {
    const patch = resizedPositionedBoxStylePatch(box, sourceBounds, nextBounds);
    setGrapesjsComponentBounds(box, {
      left: parseCssPxStrict(patch.left) ?? box.styleLeft,
      top: parseCssPxStrict(patch.top) ?? box.styleTop,
      width: parseCssPxStrict(patch.width) ?? box.w,
      height: parseCssPxStrict(patch.height) ?? box.h,
    });
  }
  return true;
}

export function resizeGrapesjsPositionedSelectionToBounds(
  editor: unknown,
  nextBounds: GrapesjsSelectionBounds,
): boolean {
  const components = positionedSelectionComponents(editor);
  if (components.length < 2) return false;
  const rootRect = canvasDocumentRootRect(editor as GrapesjsEditorInstance);
  const boxes = components
    .map((comp) => positionedComponentBox(comp, rootRect))
    .filter((box): box is PositionedSelectionBox => Boolean(box));
  return resizePositionedBoxesToBounds(boxes, nextBounds);
}

export function alignGrapesjsPositionedSelection(
  editor: unknown,
  mode: GrapesjsPositionAlignMode,
): boolean {
  const components = positionedSelectionComponents(editor);
  const needsMultiple = mode === 'distribute-x' || mode === 'distribute-y';
  if (components.length < (needsMultiple ? 3 : 1)) return false;
  const rootRect = canvasDocumentRootRect(editor as GrapesjsEditorInstance);
  const boxes = components
    .map((comp) => positionedComponentBox(comp, rootRect))
    .filter((box): box is NonNullable<typeof box> => Boolean(box));
  if (boxes.length < (needsMultiple ? 3 : 1)) return false;
  const bounds = positionedBounds(boxes);
  if (!bounds) return false;
  if (mode === 'left') {
    for (const box of boxes) setGrapesjsComponentPosition(box.comp, { left: box.styleLeft + bounds.left - box.left });
    return true;
  }
  if (mode === 'center-x') {
    const center = bounds.left + bounds.w / 2;
    for (const box of boxes) setGrapesjsComponentPosition(box.comp, { left: box.styleLeft + center - (box.left + box.w / 2) });
    return true;
  }
  if (mode === 'right') {
    for (const box of boxes) setGrapesjsComponentPosition(box.comp, { left: box.styleLeft + bounds.right - box.right });
    return true;
  }
  if (mode === 'top') {
    for (const box of boxes) setGrapesjsComponentPosition(box.comp, { top: box.styleTop + bounds.top - box.top });
    return true;
  }
  if (mode === 'center-y') {
    const center = bounds.top + bounds.h / 2;
    for (const box of boxes) setGrapesjsComponentPosition(box.comp, { top: box.styleTop + center - (box.top + box.h / 2) });
    return true;
  }
  if (mode === 'bottom') {
    for (const box of boxes) setGrapesjsComponentPosition(box.comp, { top: box.styleTop + bounds.bottom - box.bottom });
    return true;
  }
  if (mode === 'distribute-x') {
    const sorted = [...boxes].sort((a, b) => a.left - b.left);
    const totalWidth = sorted.reduce((sum, box) => sum + box.w, 0);
    const gap = (bounds.w - totalWidth) / (sorted.length - 1);
    let cursor = bounds.left;
    for (const box of sorted) {
      setGrapesjsComponentPosition(box.comp, { left: box.styleLeft + cursor - box.left });
      cursor += box.w + gap;
    }
    return true;
  }
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  const totalHeight = sorted.reduce((sum, box) => sum + box.h, 0);
  const gap = (bounds.h - totalHeight) / (sorted.length - 1);
  let cursor = bounds.top;
  for (const box of sorted) {
    setGrapesjsComponentPosition(box.comp, { top: box.styleTop + cursor - box.top });
    cursor += box.h + gap;
  }
  return true;
}

function imageFillStyle(dataUrl: string): Record<string, string> {
  return {
    'background-image': `url("${dataUrl}")`,
    'background-size': 'cover',
    'background-position': 'center',
    'background-repeat': 'no-repeat',
  };
}

function pastedImageSize(width?: number, height?: number): { width: number; height: number } {
  return {
    width: Number.isFinite(width) && Number(width) > 0 ? Math.round(Number(width)) : 320,
    height: Number.isFinite(height) && Number(height) > 0 ? Math.round(Number(height)) : 240,
  };
}

function defaultImagePastePoint(
  editor: unknown,
  width: number,
  height: number,
): GrapesjsCanvasPoint {
  const size = readCanvasFrameSize(editor as GrapesjsEditorInstance);
  if (!size) return { x: 0, y: 0 };
  return {
    x: Math.max(0, Math.round((size.width - width) / 2)),
    y: Math.max(0, Math.round((size.height - height) / 2)),
  };
}

function isImageLikeComponent(comp: Component | null | undefined): boolean {
  if (!comp) return false;
  try {
    if (String(comp.get?.('type') ?? '').toLowerCase() === 'image') return true;
  } catch { /* ignore */ }
  const el = getElementFromComponent(comp) as HTMLElement | null;
  return el?.tagName === 'IMG';
}

export function pasteGrapesjsImageToSelection(
  editor: unknown,
  input: { dataUrl: string; width?: number; height?: number; point?: GrapesjsCanvasPoint },
): Component | null {
  const selected = (() => {
    try { return (editor as GrapesjsEditorInstance | null)?.getSelected?.() as Component | undefined; } catch { return undefined; }
  })();
  if (isImageLikeComponent(selected)) {
    try { selected?.addAttributes?.({ src: input.dataUrl }); } catch { /* ignore */ }
    try { (editor as GrapesjsEditorInstance | null)?.select?.(selected); } catch { /* ignore */ }
    return selected ?? null;
  }
  if (selected?.parent?.()) {
    try {
      selected.setStyle?.({
        ...getComponentStyleRecord(selected),
        ...imageFillStyle(input.dataUrl),
      } as Parameters<typeof selected.setStyle>[0]);
      (editor as GrapesjsEditorInstance | null)?.select?.(selected);
      return selected;
    } catch {
      return null;
    }
  }
  const size = pastedImageSize(input.width, input.height);
  const point = input.point ?? defaultImagePastePoint(editor, size.width, size.height);
  const created = appendGrapesjsCanvasToolComponent(editor, 'image', point, size);
  if (!created) return null;
  try {
    created.setStyle?.({
      ...getComponentStyleRecord(created),
      ...imageFillStyle(input.dataUrl),
      width: `${size.width}px`,
      height: `${size.height}px`,
    } as Parameters<typeof created.setStyle>[0]);
  } catch { /* ignore */ }
  try { (editor as GrapesjsEditorInstance | null)?.select?.(created); } catch { /* ignore */ }
  return created;
}

export function insertGrapesjsIconComponent(
  editor: unknown,
  input: GrapesjsIconInsertInput,
): Component | null {
  const size = Math.max(8, Math.round(input.size));
  const point = defaultImagePastePoint(editor, size, size);
  const component = {
    tagName: 'div',
    attributes: {
      'data-od-canvas-tool': 'icon',
      'data-od-position-mode': 'absolute',
      'data-od-icon-label': input.label,
      ...(input.library ? { 'data-od-icon-library': input.library } : {}),
      ...(input.remoteIcon ? { 'data-od-iconify-icon': input.remoteIcon } : {}),
    },
    droppable: false,
    editable: false,
    content: renderGrapesjsIconSvg(input),
    style: {
      position: 'absolute',
      left: `${Math.max(0, Math.round(point.x))}px`,
      top: `${Math.max(0, Math.round(point.y))}px`,
      width: `${size}px`,
      height: `${size}px`,
      color: input.color,
      display: 'inline-flex',
      'align-items': 'center',
      'justify-content': 'center',
      'line-height': '0',
      'box-sizing': 'border-box',
    },
  };
  const editorLike = editor as {
    addComponents?: (components: unknown) => unknown;
    getWrapper?: () => { append?: (components: unknown) => unknown } | null;
    Components?: {
      getWrapper?: () => { append?: (components: unknown) => unknown } | null;
      getComponents?: () => { get?: (index: number) => { append?: (components: unknown) => unknown } | null };
    };
    select?: (component: Component | null | undefined) => void;
  } | null;
  let created: Component | null = null;
  try {
    created = firstGrapesjsComponent(editorLike?.addComponents?.(component));
  } catch { /* fall through */ }
  if (!created) {
    try {
      const wrapper =
        editorLike?.getWrapper?.() ??
        editorLike?.Components?.getWrapper?.() ??
        editorLike?.Components?.getComponents?.()?.get?.(0);
      created = firstGrapesjsComponent(wrapper?.append?.(component));
    } catch { /* ignore */ }
  }
  if (!created) return null;
  try {
    created.setStyle?.({
      ...getComponentStyleRecord(created),
      ...(component.style as Record<string, string>),
    } as Parameters<typeof created.setStyle>[0]);
  } catch { /* ignore */ }
  try { editorLike?.select?.(created); } catch { /* ignore */ }
  return created;
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

export type GrapesjsComponentClipboardState = {
  components: Component[];
  cut: boolean;
  pasteCount: number;
};

export function stripGrapesjsClipboardStableIds(comp: Component): void {
  const stableKeys = ['data-od-id', 'data-od-source-path', 'data-od-runtime-id'];
  try {
    const attrs = { ...(comp.getAttributes?.() ?? {}) } as Record<string, unknown>;
    for (const key of stableKeys) delete attrs[key];
    try {
      (comp as Component & { removeAttributes?: (keys: string | string[]) => void }).removeAttributes?.(stableKeys);
    } catch { /* ignore */ }
    comp.setAttributes?.(attrs);
  } catch { /* ignore */ }
  for (const child of directComponentChildren(comp)) {
    stripGrapesjsClipboardStableIds(child);
  }
}

export function cloneGrapesjsClipboardComponent(comp: Component): Component | null {
  try {
    const clone = (comp as Component & { clone?: () => Component }).clone?.();
    if (!clone) return null;
    stripGrapesjsClipboardStableIds(clone);
    return clone;
  } catch {
    return null;
  }
}

export function createGrapesjsComponentClipboardState(
  components: Component[],
  cut: boolean,
): GrapesjsComponentClipboardState | null {
  const snapshots = components
    .map(cloneGrapesjsClipboardComponent)
    .filter((comp): comp is Component => Boolean(comp));
  if (snapshots.length === 0) return null;
  return { components: snapshots, cut, pasteCount: 0 };
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
  if (parents.size !== 1) {
    // Cross-parent wrap: the picked elements live under different parents
    // (e.g. two scattered absolute flex containers). Group them into a NEW
    // absolute-positioned flex container at the canvas root, positioned over
    // the bounding box of all picked elements. Coordinates are resolved
    // against the canvas body root so they stay comparable across parents.
    return wrapScatteredSelectionAsFlex(editor, picked, preferredAxis);
  }
  const parent = picked[0]?.parent?.();
  if (!parent) return false;
  const parentRect = componentCoordinateRootRect(editor, parent);
  const items = picked
    .map((comp) => ({ comp, box: componentBox(comp, parentRect) }))
    .filter((item): item is { comp: Component; box: GrapesjsComponentBox } => Boolean(item.box));
  if (items.length === 0) return false;
  // Treat the selection as absolute when every picked element is itself
  // absolute-positioned — not just canvas-tool primitives. A previously
  // Shift+A-wrapped flex container is `position: absolute` too and must be
  // re-wrapped into another absolute container with its own absolute
  // placement cleared, otherwise the new parent comes out as flow and the
  // children keep their absolute positioning and scatter.
  const absoluteItems = items.every(({ comp }) => isGrapesjsPositionedDragComponent(comp));
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
        // `fit-content` so the wrapper adapts to its children (适应 mode).
        width: 'fit-content',
        height: 'fit-content',
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

/**
 * Wrap a set of picked components that live under DIFFERENT parents into one
 * new absolute-positioned flex container at the canvas root.
 *
 * Unlike `arrangeGrapesjsSelectionAsFlex` (which requires a single shared
 * parent), this path exists for the common case of selecting two or more
 * scattered absolute elements (e.g. flex containers dropped anywhere on the
 * canvas) and grouping them. Each element's own absolute placement is cleared
 * because the new wrapper now owns the group's position; the children flow
 * inside it.
 *
 * Coordinates are resolved against the canvas body root so boxes stay
 * comparable regardless of which parent each element came from.
 */
function wrapScatteredSelectionAsFlex(
  editor: GrapesjsEditorInstance,
  picked: Component[],
  preferredAxis?: GrapesjsLayoutAxis,
): boolean {
  const rootWrapper = getRootWrapperComponent(editor);
  if (!rootWrapper) return false;
  // The new wrapper is appended to `rootWrapper` and positioned absolute, so
  // its positioning context IS the root wrapper. Resolve every picked
  // element's box against the root wrapper's own rect (not the canvas body)
  // so the new wrapper lands where the selection actually is, instead of
  // jumping toward the canvas top-left.
  const rootRect = componentCoordinateRootRect(editor, rootWrapper);
  const items = picked
    .map((comp) => ({ comp, box: componentBox(comp, rootRect) }))
    .filter((item): item is { comp: Component; box: GrapesjsComponentBox } => Boolean(item.box));
  if (items.length === 0) return false;
  const axis = preferredAxis ?? inferLayoutAxis(items.map((item) => item.box));
  items.sort((a, b) => axis === 'row'
    ? (a.box.left - b.box.left) || (a.box.top - b.box.top)
    : (a.box.top - b.box.top) || (a.box.left - b.box.left));
  const boxes = items.map((item) => item.box);
  const minX = Math.min(...boxes.map((box) => box.left));
  const minY = Math.min(...boxes.map((box) => box.top));
  const gap = averageMainAxisGap(boxes, axis);
  // Size the wrapper to the children's natural flex layout, NOT the original
  // scattered bounding box (measured while the children were positioned).
  // Row: width = sum of child widths + gaps, height = max child height.
  // Column: the inverse.
  const gapTotal = gap * Math.max(0, boxes.length - 1);
  const wrapW = axis === 'row'
    ? Math.round(boxes.reduce((acc, box) => acc + box.w, 0) + gapTotal)
    : Math.round(Math.max(0, ...boxes.map((box) => box.w)));
  const wrapH = axis === 'row'
    ? Math.round(Math.max(0, ...boxes.map((box) => box.h)))
    : Math.round(boxes.reduce((acc, box) => acc + box.h, 0) + gapTotal);
  const created = rootWrapper.append(
    {
      tagName: 'div',
      attributes: {
        'data-od-auto-layout-wrapper': 'true',
        'data-od-position-mode': 'absolute',
      },
      style: {
        display: 'flex',
        'flex-direction': axis,
        gap: `${gap}px`,
        // `fit-content` so the wrapper adapts to its children's size (the
        // "适应" mode in the dimension panel). A fixed px size would freeze
        // the wrapper and clip children when they resize.
        width: 'fit-content',
        height: 'fit-content',
        'box-sizing': 'border-box',
        position: 'absolute',
        left: `${Math.round(minX)}px`,
        top: `${Math.round(minY)}px`,
      },
    } as never,
    { at: rootWrapper.components().length } as never,
  );
  const wrapper = (Array.isArray(created) ? created[0] : created) as Component | null;
  if (!wrapper) return false;
  items.forEach(({ comp }, index) => {
    try {
      clearComponentAbsolutePlacement(comp);
      setComponentAttributes(comp, { 'data-od-position-mode': 'flow' });
      comp.move(wrapper, { at: index });
    } catch { /* ignore */ }
  });
  try { editor.select(wrapper); } catch { /* ignore */ }
  return true;
}

export function dissolveGrapesjsFlexSelection(editor: GrapesjsEditorInstance): boolean {
  const current = (() => {
    try { return editor.getSelected?.() as Component | undefined; } catch { return undefined; }
  })();
  const selected = findGrapesjsAutoLayoutWrapperForDissolve(current);
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
  const containerIndex = directComponentIndex(parent, selected);
  const children = directComponentChildren(selected);
  const childBoxes = new Map<Component, GrapesjsComponentBox>();
  for (const child of children) {
    const box = componentBox(child, parentRect);
    if (box) childBoxes.set(child, box);
  }
  let insertAt = containerIndex >= 0 ? containerIndex : parent.components().length;
  for (const child of children.slice()) {
    try {
      child.move(parent, { at: insertAt });
      insertAt += 1;
      const box = childBoxes.get(child);
      if (!box) continue;
      child.setStyle?.({
        ...getComponentStyleRecord(child),
        position: 'absolute',
        left: `${Math.round(box.left)}px`,
        top: `${Math.round(box.top)}px`,
        width: `${Math.round(box.w)}px`,
        height: `${Math.round(box.h)}px`,
      } as Parameters<typeof child.setStyle>[0]);
      setComponentAttributes(child, { 'data-od-position-mode': 'absolute' });
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
  let liveRefreshFrame = 0;
  const flushLiveResize = () => {
    if (liveRefreshFrame) {
      cancelEditorAnimationFrame(liveRefreshFrame);
      liveRefreshFrame = 0;
    }
    handlers.refreshGeometry();
  };
  const onLiveResize = () => {
    if (liveRefreshFrame) return;
    liveRefreshFrame = requestEditorAnimationFrame(() => {
      liveRefreshFrame = 0;
      handlers.refreshGeometry();
    });
  };
  const onInteractionCommit = (payload?: unknown) => {
    flushLiveResize();
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
    if (liveRefreshFrame) {
      cancelEditorAnimationFrame(liveRefreshFrame);
      liveRefreshFrame = 0;
    }
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
  // Drop CSS rules whose target element was deleted (GrapesJS leaves `#id`
  // and `[data-od-id]` rules orphaned in its CssComposer). Pruning here covers
  // every save path — getDocument (Cmd+S / source view / inspect save) and
  // emitChange (autosave) — so dead selectors never round-trip into the file.
  const css = pruneOrphanCssRules(editor.getCss() ?? '', bodyHtml);
  return reassembleDocument(
    parsed,
    bodyHtml,
    css,
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

type GrapesjsSelectionStrokeRectSource = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function calculateGrapesjsSelectionStrokeRect(input: {
  elementRect: GrapesjsSelectionStrokeRectSource | null | undefined;
  frameRect: Pick<GrapesjsSelectionStrokeRectSource, 'left' | 'top'> | null | undefined;
  toolsRect: Pick<GrapesjsSelectionStrokeRectSource, 'left' | 'top'> | null | undefined;
  zoom: number;
}): GrapesjsSelectionStrokeRectSource | null {
  const { elementRect, frameRect, toolsRect } = input;
  if (!elementRect || !frameRect || !toolsRect) return null;
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;
  const width = elementRect.width * zoom;
  const height = elementRect.height * zoom;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    left: frameRect.left + elementRect.left * zoom - toolsRect.left,
    top: frameRect.top + elementRect.top * zoom - toolsRect.top,
    width,
    height,
  };
}

export function getGrapesjsIframeSelectionOutlineCss(tone: GrapesjsSelectionTone = 'default'): string {
  const selectionColor = grapesjsSelectionColor(tone);
  return `
                  html body .gjs-selected,
                  .gjs-selected {
                    outline: 0 !important;
                    outline-offset: 0 !important;
                  }
                  html body .gjs-hovered,
                  .gjs-hovered {
                    outline: var(--od-gjs-hairline, 1px) solid ${selectionColor} !important;
                    outline-offset: calc(-1 * var(--od-gjs-hairline, 1px)) !important;
                  }
                  .gjs-com-dashed * {
                    outline-width: var(--od-gjs-hairline, 1px) !important;
                  }
                  .od-gjs-multi-selection-active .gjs-selected {
                    outline: 0 !important;
                  }
                  .od-gjs-multi-selection-active .gjs-resizer,
                  .od-gjs-multi-selection-active .gjs-resizer-h,
                  .od-gjs-multi-selection-active .od-radius-handle,
                  .od-gjs-multi-selection-active .od-radius-badge,
                  .od-gjs-multi-selection-active .od-selection-stroke,
                  .od-gjs-multi-selection-active .od-dimension-badge,
                  .od-gjs-multi-selection-active [data-od-spacing-kind],
                  .od-gjs-multi-selection-active [data-od-spacing-band] {
                    display: none !important;
                  }
                  html body .od-multi-selection-member,
                  .od-multi-selection-member {
                    outline: var(--od-gjs-hairline, 1px) dashed var(--gjs-color-blue, #4f83ff) !important;
                    outline-offset: calc(-1 * var(--od-gjs-hairline, 1px)) !important;
                  }
                  html body .od-flex-container-outline,
                  .od-flex-container-outline {
                    outline: var(--od-gjs-hairline, 1px) dashed var(--gjs-color-blue, #4f83ff) !important;
                    outline-offset: calc(-1 * var(--od-gjs-hairline, 1px)) !important;
                  }
                  /* Default canvas cursor — custom pointer SVG. The
                     od-canvas-cursor-clone class on html swaps in the clone
                     cursor during an Alt+drag copy. */
                  html.od-canvas-cursor, html.od-canvas-cursor body {
                    cursor: url('/cursor-default.svg') 8 5, default;
                  }
                  html.od-canvas-cursor-clone, html.od-canvas-cursor-clone body {
                    cursor: url('/cursor-clone.svg') 8 5, copy !important;
                  }
                  [data-od-multi-selection-box] {
                    position: absolute;
                    box-sizing: border-box;
                    z-index: 2147483645;
                    display: none;
                    border: var(--od-gjs-hairline, 1px) solid var(--gjs-color-blue, #4f83ff);
                    pointer-events: auto;
                    touch-action: none;
                    cursor: move;
                  }
                  [data-od-multi-selection-handle] {
                    position: absolute;
                    width: 10px;
                    height: 10px;
                    padding: 0;
                    border: var(--od-gjs-hairline, 1px) solid var(--gjs-color-blue, #4f83ff);
                    border-radius: 2px;
                    background: #fff;
                    box-sizing: border-box;
                  }
                  [data-od-multi-selection-handle='nw'] { left: 0; top: 0; transform: translate(-50%, -50%); cursor: nwse-resize; }
                  [data-od-multi-selection-handle='n'] { left: 50%; top: 0; transform: translate(-50%, -50%); cursor: ns-resize; }
                  [data-od-multi-selection-handle='ne'] { right: 0; top: 0; transform: translate(50%, -50%); cursor: nesw-resize; }
                  [data-od-multi-selection-handle='e'] { right: 0; top: 50%; transform: translate(50%, -50%); cursor: ew-resize; }
                  [data-od-multi-selection-handle='se'] { right: 0; bottom: 0; transform: translate(50%, 50%); cursor: nwse-resize; }
                  [data-od-multi-selection-handle='s'] { left: 50%; bottom: 0; transform: translate(-50%, 50%); cursor: ns-resize; }
                  [data-od-multi-selection-handle='sw'] { left: 0; bottom: 0; transform: translate(-50%, 50%); cursor: nesw-resize; }
                  [data-od-multi-selection-handle='w'] { left: 0; top: 50%; transform: translate(-50%, -50%); cursor: ew-resize; }
                  [data-od-multi-selection-badge] {
                    position: absolute;
                    left: 50%;
                    bottom: -27px;
                    transform: translateX(-50%);
                    padding: 2px 6px;
                    border-radius: 3px;
                    background: var(--gjs-color-blue, #4f83ff);
                    color: #fff;
                    font: 600 12px/1.2 -apple-system, system-ui, sans-serif;
                    white-space: nowrap;
                    pointer-events: none;
                    font-variant-numeric: tabular-nums;
                  }
  `;
}

export function getGrapesjsSelectionStrokeCss(): string {
  return `
              .od-selection-stroke {
                position: absolute;
                inset: 0;
                box-sizing: border-box;
                border: 0;
                box-shadow: inset 0 0 0 var(--od-gjs-screen-hairline, 1px) var(--gjs-color-blue);
                pointer-events: none;
                z-index: 10;
                display: none;
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
  // Ensure the custom default-cursor class is on the iframe root so the
  // cursor: url('/cursor-default.svg') rule applies. Refreshed alongside the
  // selection style so HMR / stale frames pick it up too.
  try { doc.documentElement.classList.add('od-canvas-cursor'); } catch { /* ignore */ }
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
  const frame = editor.Canvas?.getFrameEl?.();
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

/**
 * Read a flex parent's current gap as a pixel number. For a row the relevant
 * gap is `column-gap` (flex lays children out along the inline axis); for a
 * column it is `row-gap`. Used by the flex multi-selection resize so the gap
 * can be scaled together with the children, keeping the resized group flush
 * with the drag box.
 */
function readFlexParentGapPx(parent: Component, axis: GrapesjsLayoutAxis): number {
  const el = getElementFromComponent(parent);
  const win = el?.ownerDocument?.defaultView ?? null;
  if (!el || !win) return 0;
  try {
    const cs = win.getComputedStyle(el);
    const raw = cs.getPropertyValue(axis === 'row' ? 'column-gap' : 'row-gap') || '';
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
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
  '[data-od-multi-selection-box]',
  '[data-od-multi-selection-handle]',
  '[data-od-multi-selection-badge]',
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
  /** Align or distribute selected absolutely positioned components geometrically. */
  alignPositionedSelection(mode: GrapesjsPositionAlignMode): boolean;
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
  /** Insert a configured SVG icon component into the canvas and select it. */
  insertIconComponent(input: GrapesjsIconInsertInput): void;
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
    const componentClipboardRef = useRef<{ components: Component[]; cut: boolean; pasteCount: number } | null>(null);
    const clipboardImagePasteSuppressedUntilRef = useRef(0);
    const cutEmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cutEmitPendingRef = useRef(false);
    const cssStyleClipboardRef = useRef<Record<string, string> | null>(null);
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
              ${getGrapesjsSelectionStrokeCss()}
              .od-gjs-multi-selection-active .gjs-resizer,
              .od-gjs-multi-selection-active .gjs-resizer-h,
              .od-gjs-multi-selection-active .od-radius-handle,
              .od-gjs-multi-selection-active .od-radius-badge,
              .od-gjs-multi-selection-active .od-selection-stroke,
              .od-gjs-multi-selection-active .od-dimension-badge {
                display: none !important;
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
                cursor: url('/cursor-corner.png') 10 6, default !important;
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
                cursor: inherit;
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
          const readCanvasZoomDecimal = () => {
            try {
              const z = (editor.Canvas as unknown as { getZoomDecimal?: () => number }).getZoomDecimal?.();
              return typeof z === 'number' && z > 0 ? z : (editor.Canvas.getZoom?.() ?? 100) / 100;
            } catch {
              return 1;
            }
          };
          const resetSelectionStrokePlacement = (stroke: HTMLElement) => {
            stroke.style.inset = '0';
            stroke.style.left = '';
            stroke.style.top = '';
            stroke.style.width = '';
            stroke.style.height = '';
          };
          const syncSelectionStrokePlacement = (stroke: HTMLElement) => {
            try {
              const selected = editor.getSelected?.() as Component | undefined;
              const el = getElementFromComponent(selected) as HTMLElement | null;
              const frameEl = editor.Canvas.getFrameEl?.() as HTMLElement | null | undefined;
              const toolsEl = (editor.Canvas as unknown as {
                getToolsEl?: (view?: unknown) => HTMLElement | null;
              }).getToolsEl?.();
              const rect = calculateGrapesjsSelectionStrokeRect({
                elementRect: el?.getBoundingClientRect?.(),
                frameRect: frameEl?.getBoundingClientRect?.(),
                toolsRect: toolsEl?.getBoundingClientRect?.(),
                zoom: readCanvasZoomDecimal(),
              });
              if (!rect) {
                resetSelectionStrokePlacement(stroke);
                return;
              }
              stroke.style.inset = 'auto';
              stroke.style.left = `${rect.left}px`;
              stroke.style.top = `${rect.top}px`;
              stroke.style.width = `${rect.width}px`;
              stroke.style.height = `${rect.height}px`;
            } catch {
              resetSelectionStrokePlacement(stroke);
            }
          };
          type ToolsUpdatePayload = { type?: string; width?: number; height?: number };
          const onToolsUpdate = (opts: ToolsUpdatePayload) => {
            if (!opts || opts.type !== 'global') return;
            try {
              const doc = editor.Canvas.getDocument?.();
              if (doc) upsertGrapesjsIframeSelectionStyle(doc, FLEX_CHILD_HOVER_CLASS, selectionToneRef.current);
            } catch { /* ignore */ }
            const selectedCount = (() => {
              try { return editor.getSelectedAll?.().length ?? 0; } catch { return 0; }
            })();
            if (selectedCount > 1) {
              hideDimensionBadge();
              return;
            }
            if (selectionChromeRef.current === 'element-selection') {
              hideDimensionBadge();
              return;
            }
            const stroke = ensureSelectionStroke();
            if (stroke) {
              syncSelectionStrokePlacement(stroke);
              stroke.style.display = 'block';
            }
            const badge = ensureDimensionBadge();
            if (!badge) return;
            const w = typeof opts.width === 'number' ? opts.width : 0;
            const h = typeof opts.height === 'number' ? opts.height : 0;
            if (w <= 1 || h <= 1) {
              hideDimensionBadge();
              positionRadiusHandles();
              return;
            }
            const zoom = readCanvasZoomDecimal();
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
            const stroke = ensureSelectionStroke();
            if (stroke) syncSelectionStrokePlacement(stroke);
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
            const sel = editor.getSelected?.() as Component | undefined;
            const selectedCount = (() => {
              try {
                const selected = editor.getSelectedAll?.();
                if (Array.isArray(selected)) return selected.length;
              } catch { /* ignore */ }
              return sel ? 1 : 0;
            })();
            if (selectedCount !== 1) {
              hideSpacingHandles();
              return;
            }
            ensureSpacingHandles();
            if (!spacingAttached) return;
            const toolsEl = (editor.Canvas as unknown as { getToolsEl?: () => HTMLElement | null }).getToolsEl?.();
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
          const ZOOM_MAX = 1000;
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
          // True while an Alt+clone drag is actively using the clone cursor,
          // so the Alt keyup handler does NOT clear it (the drag end/cancel
          // owns that). Set by the deferred-clone drag, cleared on finish.
          const cloneCursorActiveRef = { current: false };
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
          const preventCanvasShortcut = (ev: KeyboardEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
          };
          const suppressClipboardImagePaste = () => {
            clipboardImagePasteSuppressedUntilRef.current = Date.now() + GRAPESJS_CLIPBOARD_IMAGE_PASTE_SUPPRESSION_MS;
          };
          const selectedEditableComponents = (): Component[] => {
            try {
              return ((editor.getSelectedAll?.() ?? []) as Component[])
                .filter((comp) => comp?.parent?.());
            } catch {
              return [];
            }
          };
          const selectedStyleComponents = (): Component[] => {
            const seen = new Set<Component>();
            const out: Component[] = [];
            const append = (comp: Component | null | undefined) => {
              if (!comp) return;
              const hostComp = resolveComponentForHostSelection(comp) ?? comp;
              if (!hostComp?.parent?.() || seen.has(hostComp)) return;
              seen.add(hostComp);
              out.push(hostComp);
            };
            for (const comp of selectedEditableComponents()) append(comp);
            if (out.length === 0) {
              try { append(editor.getSelected?.() as Component | undefined); } catch { /* ignore */ }
            }
            return out;
          };
          const getWrapperComponent = (): Component | null => {
            try {
              return editor.Components.getComponents().get(0) as Component | null;
            } catch {
              return null;
            }
          };
          const normalizeAddedComponents = (added: unknown): Component[] => {
            if (!added) return [];
            if (Array.isArray(added)) return added.filter(Boolean) as Component[];
            const models = (added as { models?: unknown }).models;
            if (Array.isArray(models)) return models.filter(Boolean) as Component[];
            return [added as Component];
          };
          const copySelectedComponentsToClipboard = (cut: boolean): boolean => {
            const components = selectedEditableComponents();
            if (components.length === 0) return false;
            const clipboard = createGrapesjsComponentClipboardState(components, cut);
            if (!clipboard) return false;
            componentClipboardRef.current = clipboard;
            suppressClipboardImagePaste();
            try { editor.runCommand('core:copy'); } catch { /* keep OD clipboard as source of truth */ }
            if (!cut) {
              cancelGrapesjsPendingCutEmit(cutEmitTimerRef, cutEmitPendingRef);
              return true;
            }
            for (const comp of components) {
              try { comp.remove?.(); } catch { /* ignore */ }
            }
            try { editor.select(undefined); } catch { /* ignore */ }
            refreshSelectionSnapshotRef.current?.();
            const emit = scheduleEmitRef.current;
            if (emit) scheduleGrapesjsClipboardCutRemovalEmit(cutEmitTimerRef, cutEmitPendingRef, emit);
            return true;
          };
          const pasteComponentClipboard = (): boolean => {
            const clipboard = componentClipboardRef.current;
            if (!clipboard?.components.length) return false;
            suppressClipboardImagePaste();
            cancelGrapesjsPendingCutEmit(cutEmitTimerRef, cutEmitPendingRef);
            const selected = (() => {
              try { return editor.getSelected?.() as Component | undefined; } catch { return undefined; }
            })();
            const parent = selected?.parent?.() ?? getWrapperComponent();
            if (!parent) return false;
            const collection = parent.components?.();
            if (!collection?.add) return false;
            const clones = clipboard.components
              .map(cloneGrapesjsClipboardComponent)
              .filter((comp): comp is Component => Boolean(comp));
            if (clones.length === 0) return false;
            const pasteOrdinal = clipboard.pasteCount;
            clipboard.pasteCount += 1;
            const isInitialCutPaste = clipboard.cut && pasteOrdinal === 0;
            if (isInitialCutPaste) clipboard.cut = false;
            const offset = isInitialCutPaste ? 0 : 16 * (pasteOrdinal + 1);
            if (offset !== 0) {
              for (const clone of clones) {
                try {
                  const nextStyle = offsetGrapesjsAbsolutePositionStyle(getComponentStyleRecord(clone), {
                    x: offset,
                    y: offset,
                  });
                  clone.setStyle?.(nextStyle as Parameters<typeof clone.setStyle>[0]);
                } catch { /* ignore */ }
              }
            }
            const at = (() => {
              if (!selected) return collection.length ?? 0;
              const index = directComponentIndex(parent, selected);
              return index >= 0 ? index + 1 : collection.length ?? 0;
            })();
            let added: Component[] = [];
            try {
              added = normalizeAddedComponents(collection.add(clones, { at, action: 'paste-component' } as never));
            } catch {
              return false;
            }
            if (added.length === 0) return false;
            try { editor.select(added.length === 1 ? added[0] : added); } catch { /* ignore */ }
            for (const comp of added) {
              try { editor.trigger('component:paste', comp); } catch { /* ignore */ }
            }
            try { editor.runCommand(`${odStableIdPluginKey}:refresh`); } catch { /* ignore */ }
            refreshSelectionSnapshotRef.current?.();
            scheduleEmitRef.current?.();
            return true;
          };
          const copySelectedCssStyleToClipboard = (): boolean => {
            const selected = selectedStyleComponents()[0];
            if (!selected) {
              recordGrapesjsEditorDiagnostic('css-copy', { result: 'no-source' });
              return false;
            }
            const odId = componentDiagnosticId(selected);
            const computed = readElementStyles(getElementFromComponent(selected));
            const authored = getComponentStyleRecord(selected);
            const styles = buildGrapesjsCssStyleClipboard({ ...computed, ...authored });
            if (Object.keys(styles).length === 0) {
              recordGrapesjsEditorDiagnostic('css-copy', {
                result: 'empty',
                source: odId,
                computedKeys: Object.keys(computed),
                authoredKeys: Object.keys(authored),
              });
              return false;
            }
            cssStyleClipboardRef.current = styles;
            recordGrapesjsEditorDiagnostic('css-copy', {
              result: 'stored',
              source: odId,
              computedKeyCount: Object.keys(computed).length,
              authoredKeyCount: Object.keys(authored).length,
              pickedKeys: Object.keys(styles),
              pickedStyles: styles,
            });
            return true;
          };
          const pasteCssStyleClipboard = (): boolean => {
            const styles = cssStyleClipboardRef.current;
            if (!styles || Object.keys(styles).length === 0) {
              recordGrapesjsEditorDiagnostic('css-paste', { result: 'empty-clipboard' });
              return false;
            }
            const targets = selectedStyleComponents();
            const targetIds = targets.map(componentDiagnosticId);
            if (targets.length === 0) {
              recordGrapesjsEditorDiagnostic('css-paste', {
                result: 'no-target',
                pickedKeys: Object.keys(styles),
              });
              return false;
            }
            const applied = applyGrapesjsCssStyleClipboardToComponents(targets, styles);
            recordGrapesjsEditorDiagnostic('css-paste', {
              result: applied ? 'applied' : 'apply-failed',
              targets: targetIds,
              pickedKeys: Object.keys(styles),
              pickedStyles: styles,
            });
            selectionColorCollectorRef.current.invalidate();
            refreshSelectionSnapshotRef.current?.();
            scheduleEmitRef.current?.();
            return true;
          };
          const runPositionedAlignment = (mode: GrapesjsPositionAlignMode): boolean => {
            const changed = alignGrapesjsPositionedSelection(editor, mode);
            if (!changed) return false;
            selectionColorCollectorRef.current.invalidate();
            refreshSelectionSnapshotRef.current?.();
            scheduleEmitRef.current?.();
            return true;
          };
          const handleCanvasArrangeShortcut = (ev: KeyboardEvent): boolean => {
            if (readOnlyRef.current || isTextInputTarget(ev.target)) return false;
            if (ev.metaKey || ev.ctrlKey) return false;
            const key = grapesjsShortcutLetterFromEvent(ev);
            if (ev.shiftKey && !ev.altKey && key === 'a') {
              preventCanvasShortcut(ev);
              try {
                if (arrangeGrapesjsSelectionAsFlex(editor, selectionOrderRef.current)) {
                  refreshSelectionSnapshotRef.current?.();
                  scheduleEmitRef.current?.();
                }
              } catch { /* ignore */ }
              return true;
            }
            if (ev.shiftKey && ev.altKey && key === 'a') {
              preventCanvasShortcut(ev);
              try {
                if (dissolveGrapesjsFlexSelection(editor)) {
                  refreshSelectionSnapshotRef.current?.();
                  scheduleEmitRef.current?.();
                }
              } catch { /* ignore */ }
              return true;
            }
            if (!ev.altKey) return false;
            const mode = (() => {
              if (ev.shiftKey && key === 'h') return 'distribute-x';
              if (ev.shiftKey && key === 'v') return 'distribute-y';
              if (ev.shiftKey) return null;
              if (key === 'a') return 'left';
              if (key === 'h') return 'center-x';
              if (key === 'd') return 'right';
              if (key === 'w') return 'top';
              if (key === 'v') return 'center-y';
              if (key === 's') return 'bottom';
              return null;
            })() as GrapesjsPositionAlignMode | null;
            if (!mode || !runPositionedAlignment(mode)) return false;
            preventCanvasShortcut(ev);
            return true;
          };
          const handleCanvasClipboardShortcut = (ev: KeyboardEvent): boolean => {
            if (readOnlyRef.current || isTextInputTarget(ev.target)) return false;
            const primary = ev.metaKey || ev.ctrlKey;
            if (!primary) return false;
            const key = grapesjsShortcutLetterFromEvent(ev);
            if (ev.altKey && key === 'c') {
              recordGrapesjsEditorDiagnostic('css-copy-shortcut', {
                key: ev.key,
                code: ev.code,
                modifiers: { meta: ev.metaKey, ctrl: ev.ctrlKey, alt: ev.altKey, shift: ev.shiftKey },
              });
              if (!copySelectedCssStyleToClipboard()) return false;
              preventCanvasShortcut(ev);
              return true;
            }
            if (ev.altKey && key === 'v') {
              recordGrapesjsEditorDiagnostic('css-paste-shortcut', {
                key: ev.key,
                code: ev.code,
                modifiers: { meta: ev.metaKey, ctrl: ev.ctrlKey, alt: ev.altKey, shift: ev.shiftKey },
              });
              if (!pasteCssStyleClipboard()) return false;
              preventCanvasShortcut(ev);
              return true;
            }
            if (ev.altKey) return false;
            if (key === 'c') {
              if (!copySelectedComponentsToClipboard(false)) return false;
              preventCanvasShortcut(ev);
              return true;
            }
            if (key === 'x') {
              if (!copySelectedComponentsToClipboard(true)) return false;
              preventCanvasShortcut(ev);
              return true;
            }
            if (key === 'v') {
              if (!pasteComponentClipboard()) return false;
              preventCanvasShortcut(ev);
              return true;
            }
            return false;
          };
          const handleCanvasArrowKey = (ev: KeyboardEvent): boolean => {
            if (
              readOnlyRef.current ||
              isTextInputTarget(ev.target) ||
              (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown' && ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')
            ) return false;
            try {
              const sel = editor.getSelected?.() as Component | undefined;
              if (!sel) return false;
              ev.preventDefault();
              const step = ev.shiftKey ? 10 : 1;
              const parent = sel.parent?.();
              let { display, direction } = readParentFlexInfo(parent);
              // When the parent's display couldn't be resolved (cold iframe /
              // not materialized), probe its live DOM element so an external-CSS
              // flex parent is still recognised.
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
              const reorderSibling = (container: Component, forward: boolean): boolean => {
                // Move the SELECTED component to the slot adjacent to its
                // current neighbour. GrapesJS Component.move() applies
                // `sameParent && at > index ? at-1`, so we pass a pre-shift
                // index that the adjustment maps to the real target:
                //   forward  -> target idx+1 -> pass idx+2 (at-1 -> idx+1)
                //   backward -> target idx-1 -> pass idx-1 (no adjustment)
                const comps = container.components();
                const idx = (() => {
                  for (let i = 0; i < comps.length; i += 1) { if (comps.at(i) === sel) return i; }
                  return -1;
                })();
                if (idx >= 0) {
                  const target = forward ? idx + 1 : idx - 1;
                  if (target < 0 || target >= comps.length) {
                    recordGrapesjsEditorDiagnostic('flex-arrow-reorder', {
                      result: 'boundary',
                      selected: componentDiagnosticId(sel),
                      container: componentDiagnosticId(container),
                      forward,
                      beforeIndex: idx,
                      siblingCount: comps.length,
                    });
                    return false;
                  }
                  const passAt = forward ? idx + 2 : idx - 1;
                  try { sel.move(container, { at: passAt }); } catch { /* ignore */ }
                  editor.select(sel);
                  const afterIndex = (() => {
                    for (let i = 0; i < comps.length; i += 1) { if (comps.at(i) === sel) return i; }
                    return -1;
                  })();
                  recordGrapesjsEditorDiagnostic('flex-arrow-reorder', {
                    result: afterIndex === target ? 'moved' : 'move-mismatch',
                    selected: componentDiagnosticId(sel),
                    container: componentDiagnosticId(container),
                    forward,
                    beforeIndex: idx,
                    targetIndex: target,
                    afterIndex,
                    siblingCount: comps.length,
                  });
                  return afterIndex === target;
                }
                // Fallback: resolve via the live DOM and move the selected
                // element relative to its neighbour.
                const selEl = getElementFromComponent(sel);
                if (!selEl) return false;
                const sibEl = forward ? selEl.nextElementSibling : selEl.previousElementSibling;
                if (!sibEl) {
                  recordGrapesjsEditorDiagnostic('flex-arrow-reorder', {
                    result: 'dom-boundary',
                    selected: componentDiagnosticId(sel),
                    container: componentDiagnosticId(container),
                    forward,
                  });
                  return false;
                }
                const sibComp = getComponentFromElement(sibEl as Element | null);
                if (!sibComp) return false;
                const sibParent = sibComp.parent?.() ?? container;
                const sibComps = sibParent.components?.();
                const sibIdx = (() => {
                  if (!sibComps) return -1;
                  for (let i = 0; i < sibComps.length; i += 1) { if (sibComps.at(i) === sibComp) return i; }
                  return -1;
                })();
                if (!sibComps || sibIdx < 0) return false;
                try { sel.move(sibParent, { at: forward ? sibIdx + 1 : sibIdx }); } catch { /* ignore */ }
                editor.select(sel);
                const afterIndex = (() => {
                  for (let i = 0; i < sibComps.length; i += 1) { if (sibComps.at(i) === sel) return i; }
                  return -1;
                })();
                recordGrapesjsEditorDiagnostic('flex-arrow-reorder', {
                  result: afterIndex >= 0 ? 'moved-dom-fallback' : 'move-dom-fallback-mismatch',
                  selected: componentDiagnosticId(sel),
                  container: componentDiagnosticId(sibParent),
                  forward,
                  siblingIndex: sibIdx,
                  afterIndex,
                  siblingCount: sibComps.length,
                });
                return afterIndex >= 0;
              };
              if (isFlexOrGrid && parent) {
                const isColumn = String(direction).startsWith('column');
                const isMainAxis = isColumn
                  ? (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')
                  : (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight');
                recordGrapesjsEditorDiagnostic('flex-arrow-key', {
                  selected: componentDiagnosticId(sel),
                  parent: componentDiagnosticId(parent),
                  parentDisplay: display,
                  direction,
                  isMainAxis,
                  key: ev.key,
                  targetTag: (ev.target as HTMLElement | null)?.tagName?.toLowerCase?.() ?? null,
                  modifiers: { alt: ev.altKey, shift: ev.shiftKey, meta: ev.metaKey, ctrl: ev.ctrlKey },
                });
                if (!isMainAxis) {
                  recordGrapesjsEditorDiagnostic('flex-arrow-key-result', {
                    result: 'ignored-cross-axis',
                    selected: componentDiagnosticId(sel),
                    parent: componentDiagnosticId(parent),
                    key: ev.key,
                    direction,
                  });
                  return true;
                }
                const moved = reorderSibling(parent, ev.key === 'ArrowDown' || ev.key === 'ArrowRight');
                recordGrapesjsEditorDiagnostic('flex-arrow-key-result', {
                  result: moved ? 'reordered' : 'not-reordered',
                  selected: componentDiagnosticId(sel),
                  parent: componentDiagnosticId(parent),
                  key: ev.key,
                  direction,
                });
                return true;
              }
              if (ev.altKey && parent) {
                const moved = reorderSibling(parent, ev.key === 'ArrowDown' || ev.key === 'ArrowRight');
                recordGrapesjsEditorDiagnostic('arrow-key-alt-reorder', {
                  result: moved ? 'reordered' : 'not-reordered',
                  selected: componentDiagnosticId(sel),
                  parent: componentDiagnosticId(parent),
                  key: ev.key,
                  parentDisplay: display,
                });
                return true;
              }
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
              return true;
            } catch {
              return false;
            }
          };
          const onKeyDownCanvas = (ev: KeyboardEvent) => {
            // Show the clone cursor as soon as Alt is pressed (before any drag),
            // matching Figma's "hold Alt → copy cursor" affordance.
            if (ev.key === 'Alt' && !ev.repeat) {
              try {
                const cdoc = editor.Canvas.getDocument?.();
                cdoc?.documentElement.classList.add('od-canvas-cursor-clone');
              } catch { /* ignore */ }
            }
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
            if (handleCanvasClipboardShortcut(ev)) return;
            if (handleCanvasArrangeShortcut(ev)) return;
            if (handleCanvasArrowKey(ev)) return;
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
            if (runGrapesjsHistoryShortcut(editor, ev)) return;
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
            if (ev.key === 'Alt') {
              // Only clear the clone cursor if no drag is actively using it
              // (the drag end / cancel clears it separately).
              if (!cloneCursorActiveRef.current) {
                try {
                  const cdoc = editor.Canvas.getDocument?.();
                  cdoc?.documentElement.classList.remove('od-canvas-cursor-clone');
                } catch { /* ignore */ }
              }
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
              if (handleCanvasClipboardShortcut(ev)) return;
              if (handleCanvasArrangeShortcut(ev)) return;
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
              if (runGrapesjsHistoryShortcut(editor, ev)) return;
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
              if (handleCanvasArrowKey(ev)) return;
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
          const exposeDiagnosticsToCanvasWindow = () => {
            try {
              exposeOpenDesignEditorDiagnosticsToWindow(editor.Canvas.getDocument()?.defaultView ?? null);
            } catch {
              // ignore torn-down frames
            }
          };
          editor.on('load', exposeDiagnosticsToCanvasWindow);
          editor.on('canvas:frame:load:body', exposeDiagnosticsToCanvasWindow);
          exposeDiagnosticsToCanvasWindow();

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
              writeGrapesjsElementStyle(comp, patch);
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

            type PositionedToolDragItem = {
              component: Component;
              startLeft: number;
              startTop: number;
              pendingStyle: Record<string, string> | null;
            };
            type PositionedToolDrag = {
              component: Component;
              items: PositionedToolDragItem[];
              source: PointerSource;
              start: GrapesjsCanvasPoint;
              startLeft: number;
              startTop: number;
              moved: boolean;
              cloneDrag: boolean;
              guideEl: HTMLDivElement | null;
              /**
               * Flex-child drag mode. When set, the dragged element started as a
               * flex child; the drag either reorders it within its flex parent
               * (pointer inside the parent bounds) or detaches it into an
               * absolute-positioned standalone element (pointer outside).
               * `flexDetached` flips true once the element has been re-parented
               * to the root wrapper so updatePositionedToolDrag can switch from
               * reorder semantics to left/top tracking.
               */
              flexChild: Component | null;
              flexParent: Component | null;
              flexAxis: GrapesjsLayoutAxis;
              flexDetached: boolean;
              flexOriginBox: { left: number; top: number; width: number; height: number } | null;
              flexDetachedLeft: number;
              flexDetachedTop: number;
              /**
               * Deferred Alt+clone: pointerdown records the intent, but the
               * clone is only created in updatePositionedToolDrag once the
               * pointer crosses the drag threshold (so a tap-and-release with
               * Alt does NOT clone). When true, the drag is a no-op until the
               * clone materializes.
               */
              pendingAltClone: boolean;
              altCloneSource: Component | null;
              /** Blue insertion-line overlay shown over a flex container. */
              insertLineEl: HTMLDivElement | null;
              /** Flex container currently previewed as the drop target. */
              insertTarget: Component | null;
              /** Insertion index within insertTarget (or -1 = append). */
              insertIndex: number;
              /** Avoid logging one missing-preview record per pointermove. */
              insertMissLogged: boolean;
            };
            let positionedToolDrag: PositionedToolDrag | null = null;

            const pointForSource = (ev: PointerEvent, source: PointerSource): GrapesjsCanvasPoint | null => (
              source === 'host' ? canvasPointFromHostPointer(ev) : canvasPointFromDocPointer(ev)
            );
            const clientPointForSource = (ev: PointerEvent, source: PointerSource): GrapesjsCanvasPoint => {
              if (source !== 'host') return { x: ev.clientX, y: ev.clientY };
              try {
                const frame = editor.Canvas.getFrameEl?.();
                const rect = frame?.getBoundingClientRect?.();
                if (!rect) return { x: ev.clientX, y: ev.clientY };
                const zoom = canvasZoomDecimal();
                return {
                  x: (ev.clientX - rect.left) / zoom,
                  y: (ev.clientY - rect.top) / zoom,
                };
              } catch {
                return { x: ev.clientX, y: ev.clientY };
              }
            };

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
              if (state.moved && state.pendingStyle) {
                commitComponentStyle(component, state.pendingStyle);
              } else {
                // Click without drag → apply the tool's default size so a tap
                // still creates a usable element (the drag started at 0×0).
                const defaultStyle = getGrapesjsCanvasToolDefaultStyle(state.tool, state.start, state.mode);
                commitComponentStyle(component, defaultStyle);
              }
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
              // Insert at 0×0 so the rectangle is invisible until the user
              // actually drags (draw-to-size). If the user only clicks without
              // dragging, finishPlacementInteraction applies the tool's default
              // size. This matches Figma: click = default size, drag = custom.
              const inserted = insertPlacedCanvasTool(tool, point, { mode, parent: flexParent, width: 0, height: 0 });
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
            const removePositionedDragGuide = (state: PositionedToolDrag | null) => {
              try { state?.guideEl?.remove(); } catch { /* ignore */ }
              if (state) state.guideEl = null;
            };
            const selectedPositionedDragComponents = (): Component[] => {
              const seen = new Set<Component>();
              const out: Component[] = [];
              for (const selected of selectedEditableComponents()) {
                const positioned = findGrapesjsPositionedDragComponent(selected);
                if (!positioned || seen.has(positioned) || !positioned.parent?.()) continue;
                seen.add(positioned);
                out.push(positioned);
              }
              return out;
            };
            type MultiSelectionHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
            type MultiSelectionItem = PositionedSelectionBox & {
              pendingStyle: Record<string, string> | null;
            };
            type MultiSelectionInteraction = {
              mode: 'move' | 'resize';
              handle: MultiSelectionHandle | null;
              source: PointerSource;
              start: GrapesjsCanvasPoint;
              startBounds: GrapesjsSelectionBounds;
              sourceBounds: GrapesjsComponentBox;
              items: MultiSelectionItem[];
              moved: boolean;
              cloneDrag: boolean;
              /** How the bounding-box drag maps to element styles. */
              layout: 'positioned' | 'flex';
              /** Flex parent's main axis — only meaningful when layout === 'flex'. */
              parentAxis: GrapesjsLayoutAxis;
              /** Flex parent being resized (gap scaling) — layout === 'flex' only. */
              flexParent: Component | null;
              /** Source gap (px) along the parent's main axis — layout === 'flex' only. */
              sourceGap: number;
              /** Pending gap patch for flexParent — committed on drag end. */
              pendingGap: Record<string, string> | null;
            };
            const multiSelectionHandles: MultiSelectionHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
            let multiSelectionOverlay: HTMLDivElement | null = null;
            let multiSelectionSyncRaf = 0;
            let multiSelectionInteraction: MultiSelectionInteraction | null = null;
            // The flex container that currently wears the dashed outline, so
            // syncMultiSelectionOverlay can clear it before re-painting.
            let outlinedFlexContainer: HTMLElement | null = null;

            const selectedPositionedSelectionBoxes = (): PositionedSelectionBox[] => {
              const rootRect = canvasDocumentRootRect(editor);
              return selectedPositionedDragComponents()
                .map((component) => positionedComponentBox(component, rootRect))
                .filter((box): box is PositionedSelectionBox => Boolean(box));
            };

            /**
             * Flex-child analogue of `selectedPositionedSelectionBoxes`.
             * Returns the selected components that are direct children of a
             * COMMON flex parent, plus that parent and its axis — so the
             * bounding-box overlay can render and the drag can map deltas to
             * `flex-basis`. Mixed-parent selections are rejected (no single
             * flex context to resize within).
             */
            const selectedFlexChildBoxes = (): {
              boxes: PositionedSelectionBox[];
              parent: Component | null;
              axis: GrapesjsLayoutAxis;
              gap: number;
            } => {
              const rootRect = canvasDocumentRootRect(editor);
              const components = selectedEditableComponents().filter(isGrapesjsFlexChildComponent);
              if (components.length < 2) return { boxes: [], parent: null, axis: 'row', gap: 0 };
              const parents = new Set(components.map((c) => c.parent?.() ?? null));
              if (parents.size !== 1) return { boxes: [], parent: null, axis: 'row', gap: 0 };
              const parent = components[0]?.parent?.() ?? null;
              if (!parent) return { boxes: [], parent: null, axis: 'row', gap: 0 };
              const { direction } = readParentFlexInfo(parent);
              const axis: GrapesjsLayoutAxis = String(direction).startsWith('column') ? 'column' : 'row';
              // Measure the flex parent's current gap (px) so a group resize can
              // scale the gap in lock-step with the children — otherwise the
              // union of the resized children leaves a fixed gap that the drag
              // box does not reflect, and the trailing child no longer fills it.
              const gap = readFlexParentGapPx(parent, axis);
              const boxes = components
                .map((component) => positionedComponentBox(component, rootRect))
                .filter((box): box is PositionedSelectionBox => Boolean(box));
              return { boxes, parent, axis, gap };
            };
            const clearMultiSelectionMemberOutlines = () => {
              try {
                for (const node of Array.from(doc.querySelectorAll<HTMLElement>('.od-multi-selection-member'))) {
                  node.classList.remove('od-multi-selection-member');
                }
              } catch { /* ignore */ }
            };
            const clearFlexContainerOutline = () => {
              if (outlinedFlexContainer) {
                outlinedFlexContainer.classList.remove('od-flex-container-outline');
                outlinedFlexContainer = null;
              }
            };

            const setMultiSelectionHostChromeActive = (active: boolean) => {
              try {
                const toolsEl = (editor.Canvas as unknown as {
                  getToolsEl?: (view?: unknown) => HTMLElement | null;
                }).getToolsEl?.();
                toolsEl?.classList.toggle('od-gjs-multi-selection-active', active);
                const canvasRoot = editor.Canvas.getElement?.() as HTMLElement | null | undefined;
                canvasRoot?.classList.toggle('od-gjs-multi-selection-active', active);
              } catch { /* ignore */ }
            };
            const ensureMultiSelectionOverlay = (): HTMLDivElement | null => {
              if (multiSelectionOverlay?.isConnected) return multiSelectionOverlay;
              try {
                const overlay = doc.createElement('div');
                overlay.setAttribute('data-od-multi-selection-box', 'true');
                overlay.setAttribute('aria-hidden', 'true');
                for (const handle of multiSelectionHandles) {
                  const handleNode = doc.createElement('button');
                  handleNode.type = 'button';
                  handleNode.tabIndex = -1;
                  handleNode.setAttribute('data-od-multi-selection-handle', handle);
                  overlay.appendChild(handleNode);
                }
                const badge = doc.createElement('div');
                badge.setAttribute('data-od-multi-selection-badge', 'true');
                overlay.appendChild(badge);
                doc.body.appendChild(overlay);
                multiSelectionOverlay = overlay;
                return overlay;
              } catch {
                return null;
              }
            };
            const hideMultiSelectionOverlay = () => {
              if (multiSelectionOverlay) multiSelectionOverlay.style.display = 'none';
              try { doc.body.classList.remove('od-gjs-multi-selection-active'); } catch { /* ignore */ }
              setMultiSelectionHostChromeActive(false);
              // NOTE: deliberately does NOT clear member outlines here. The
              // dashed per-member outline is owned by syncMultiSelectionOverlay
              // and stays up across the < 2 positioned-box case so grouped
              // (flow) multi-selections keep their outline. syncMultiSelectionOverlay
              // calls clearMultiSelectionMemberOutlines() itself at the top of
              // every pass, and the single-select / deselect paths clear it via
              // their own teardown.
            };
            const renderMultiSelectionOverlay = (bounds: GrapesjsSelectionBounds) => {
              const overlay = ensureMultiSelectionOverlay();
              if (!overlay) return;
              overlay.style.display = 'block';
              overlay.style.left = `${Math.round(bounds.left)}px`;
              overlay.style.top = `${Math.round(bounds.top)}px`;
              overlay.style.width = `${Math.max(1, Math.round(bounds.width))}px`;
              overlay.style.height = `${Math.max(1, Math.round(bounds.height))}px`;
              const badge = overlay.querySelector<HTMLElement>('[data-od-multi-selection-badge]');
              if (badge) badge.textContent = `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`;
              try { doc.body.classList.add('od-gjs-multi-selection-active'); } catch { /* ignore */ }
              setMultiSelectionHostChromeActive(true);
            };
            const syncMultiSelectionOverlay = () => {
              if (multiSelectionInteraction || readOnlyRef.current || cropModeRef.current) return;
              // The dashed per-member outline applies to EVERY selected
              // element (including non-positioned ones like grouped flex
              // containers), not just the positioned boxes that own the
              // draggable bounding box.
              const allSelected = selectedEditableComponents();
              clearMultiSelectionMemberOutlines();
              clearFlexContainerOutline();
              if (allSelected.length >= 2) {
                for (const comp of allSelected) {
                  try {
                    (getElementFromComponent(comp) as HTMLElement | null)?.classList.add('od-multi-selection-member');
                  } catch { /* ignore */ }
                }
              }
              // Absolute-positioned selections own the draggable bounding box.
              const positionedBoxes = selectedPositionedSelectionBoxes();
              if (positionedBoxes.length >= 2) {
                const bounds = positionedBounds(positionedBoxes);
                if (bounds) {
                  renderMultiSelectionOverlay({
                    left: bounds.left,
                    top: bounds.top,
                    width: bounds.w,
                    height: bounds.h,
                  });
                  return;
                }
              }
              // Flex-child selections (common flex parent, non-positioned):
              // render the SAME bounding-box overlay (so the user gets the
              // solid frame + handles) AND outline the flex container itself
              // with a dashed frame to convey the flex context.
              const flex = selectedFlexChildBoxes();
              if (flex.boxes.length >= 2 && flex.parent) {
                const bounds = positionedBounds(flex.boxes);
                if (bounds) {
                  renderMultiSelectionOverlay({
                    left: bounds.left,
                    top: bounds.top,
                    width: bounds.w,
                    height: bounds.h,
                  });
                  const parentEl = getElementFromComponent(flex.parent) as HTMLElement | null;
                  if (parentEl) {
                    parentEl.classList.add('od-flex-container-outline');
                    outlinedFlexContainer = parentEl;
                  }
                  return;
                }
              }
              hideMultiSelectionOverlay();
            };
            const requestMultiSelectionOverlaySync = () => {
              if (multiSelectionSyncRaf) return;
              multiSelectionSyncRaf = window.requestAnimationFrame(() => {
                multiSelectionSyncRaf = 0;
                syncMultiSelectionOverlay();
              });
            };
            const nextMultiSelectionBounds = (
              state: MultiSelectionInteraction,
              point: GrapesjsCanvasPoint,
            ): GrapesjsSelectionBounds => {
              const dx = point.x - state.start.x;
              const dy = point.y - state.start.y;
              if (state.mode === 'move') {
                return {
                  ...state.startBounds,
                  left: Math.max(0, state.startBounds.left + dx),
                  top: Math.max(0, state.startBounds.top + dy),
                };
              }
              const handle = state.handle ?? 'se';
              let left = state.startBounds.left;
              let top = state.startBounds.top;
              let right = state.startBounds.left + state.startBounds.width;
              let bottom = state.startBounds.top + state.startBounds.height;
              if (handle.includes('w')) left = Math.min(right - 1, state.startBounds.left + dx);
              if (handle.includes('e')) right = Math.max(left + 1, state.startBounds.left + state.startBounds.width + dx);
              if (handle.includes('n')) top = Math.min(bottom - 1, state.startBounds.top + dy);
              if (handle.includes('s')) bottom = Math.max(top + 1, state.startBounds.top + state.startBounds.height + dy);
              left = Math.max(0, left);
              top = Math.max(0, top);
              return {
                left,
                top,
                width: Math.max(1, right - left),
                height: Math.max(1, bottom - top),
              };
            };
            const applyMultiSelectionBounds = (
              state: MultiSelectionInteraction,
              nextBounds: GrapesjsSelectionBounds,
            ) => {
              // Move has no equivalent for flex children (left/top breaks the
              // flex flow). Skip style patches on a flex move but still let the
              // bounding box follow the cursor so the interaction feels live.
              const skipPatch = state.layout === 'flex' && state.mode === 'move';
              if (!skipPatch) {
                for (const item of state.items) {
                  const patch = state.layout === 'flex'
                    ? resizedFlexChildBoxStylePatch(item, state.sourceBounds, nextBounds, state.parentAxis)
                    : resizedPositionedBoxStylePatch(item, state.sourceBounds, nextBounds);
                  item.pendingStyle = patch;
                  previewComponentStyle(item.comp, patch);
                }
                // On the flex path the gap is part of the union width, so it
                // must scale by the same factor as the children — otherwise the
                // trailing child no longer reaches the drag-box edge. Patch the
                // parent's `gap` live; finishMultiSelectionOverlayInteraction
                // commits it via the same pendingStyle mechanism.
                if (state.layout === 'flex' && state.flexParent) {
                  const scale = state.parentAxis === 'row'
                    ? Math.max(1, nextBounds.width) / Math.max(1, state.sourceBounds.w)
                    : Math.max(1, nextBounds.height) / Math.max(1, state.sourceBounds.h);
                  const nextGap = Math.max(0, Math.round(state.sourceGap * scale));
                  const gapPatch: Record<string, string> = { gap: `${nextGap}px` };
                  previewComponentStyle(state.flexParent, gapPatch);
                  state.pendingGap = gapPatch;
                }
              }
              renderMultiSelectionOverlay(nextBounds);
              requestVisibleToolsRefresh();
            };
            const startMultiSelectionOverlayInteraction = (ev: PointerEvent): boolean => {
              if (readOnlyRef.current || cropModeRef.current || placementInteraction || positionedToolDrag) return false;
              if (ev.button !== 0) return false;
              const target = ev.target as Element | null;
              const overlay = target?.closest?.('[data-od-multi-selection-box]');
              if (!overlay || !multiSelectionOverlay?.contains(overlay)) return false;
              // Prefer positioned selections; fall back to flex children of a
              // common flex parent so the overlay's drag dispatches to the
              // flex-aware resize patch instead of writing left/top.
              let positionedBoxes = selectedPositionedSelectionBoxes();
              let flexBoxes: PositionedSelectionBox[] = [];
              let flexAxis: GrapesjsLayoutAxis = 'row';
              let flexParent: Component | null = null;
              let sourceGap = 0;
              if (positionedBoxes.length < 2) {
                const flex = selectedFlexChildBoxes();
                flexBoxes = flex.boxes;
                flexAxis = flex.axis;
                flexParent = flex.parent;
                sourceGap = flex.gap;
              }
              let boxes = positionedBoxes.length >= 2 ? positionedBoxes : flexBoxes;
              const layout: 'positioned' | 'flex' = positionedBoxes.length >= 2 ? 'positioned' : 'flex';
              let cloneDrag = false;
              if (ev.altKey) {
                // Clone currently only supports positioned elements (clone
                // + flex-basis semantics are undefined). Skip cloning on the
                // flex path so the drag still works as a plain resize.
                if (layout === 'positioned') {
                  const clones = clonePositionedDragComponents(boxes.map((box) => box.comp));
                  if (!clones?.length) return false;
                  cloneDrag = true;
                  try { editor.select(clones.length === 1 ? clones[0] : clones); } catch { /* ignore */ }
                  const rootRect = canvasDocumentRootRect(editor);
                  boxes = clones
                    .map((component) => positionedComponentBox(component, rootRect))
                    .filter((box): box is PositionedSelectionBox => Boolean(box));
                }
              }
              const sourceBounds = positionedBounds(boxes);
              if (boxes.length < 2 || !sourceBounds) return false;
              const point = pointForSource(ev, 'doc');
              if (!point) return false;
              const handle = target?.closest?.('[data-od-multi-selection-handle]')?.getAttribute('data-od-multi-selection-handle') as MultiSelectionHandle | null;
              multiSelectionInteraction = {
                mode: handle ? 'resize' : 'move',
                handle,
                source: 'doc',
                start: point,
                startBounds: {
                  left: sourceBounds.left,
                  top: sourceBounds.top,
                  width: sourceBounds.w,
                  height: sourceBounds.h,
                },
                sourceBounds,
                items: boxes.map((box) => ({ ...box, pendingStyle: null })),
                moved: false,
                cloneDrag,
                layout,
                parentAxis: flexAxis,
                flexParent,
                sourceGap,
                pendingGap: null,
              };
              // Move has no meaning for flex children (left/top breaks layout);
              // only handle-driven resize is supported on the flex path. If the
              // user grabbed the box body in a flex selection, still allow the
              // drag to start but apply no style patches (the box will follow
              // the cursor visually via renderMultiSelectionOverlay but leave
              // the elements untouched).
              ev.preventDefault();
              ev.stopImmediatePropagation();
              return true;
            };
            const updateMultiSelectionOverlayInteraction = (ev: PointerEvent) => {
              const state = multiSelectionInteraction;
              if (!state) return;
              const point = pointForSource(ev, state.source);
              if (!point) return;
              const distance = Math.hypot(point.x - state.start.x, point.y - state.start.y);
              if (!state.moved && distance < 2) return;
              state.moved = true;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              applyMultiSelectionBounds(state, nextMultiSelectionBounds(state, point));
            };
            const finishMultiSelectionOverlayInteraction = (ev: PointerEvent) => {
              const state = multiSelectionInteraction;
              if (!state) return;
              updateMultiSelectionOverlayInteraction(ev);
              multiSelectionInteraction = null;
              for (const item of state.items) {
                if (item.pendingStyle) commitComponentStyle(item.comp, item.pendingStyle);
              }
              if (state.pendingGap && state.flexParent) commitComponentStyle(state.flexParent, state.pendingGap);
              try { editor.select(state.items.map((item) => item.comp)); } catch { /* ignore */ }
              // See finishPositionedToolDrag: suppress the trailing click so the
              // Alt+drag clones stay selected instead of being replaced by the
              // original element the drag started on.
              if (state.cloneDrag && state.moved) suppressNextClick();
              refreshSelectionSnapshotRef.current?.();
              scheduleEmitRef.current?.();
              requestVisibleToolsRefresh();
              requestMultiSelectionOverlaySync();
            };
            const cancelMultiSelectionOverlayInteraction = () => {
              const state = multiSelectionInteraction;
              if (!state) return;
              multiSelectionInteraction = null;
              for (const item of state.items) {
                if (item.pendingStyle) commitComponentStyle(item.comp, item.pendingStyle);
              }
              if (state.pendingGap && state.flexParent) commitComponentStyle(state.flexParent, state.pendingGap);
              refreshSelectionSnapshotRef.current?.();
              scheduleEmitRef.current?.();
              requestVisibleToolsRefresh();
              requestMultiSelectionOverlaySync();
            };
            function clonePositionedDragComponents(components: Component[]): Component[] | null {
              const clones: Component[] = [];
              for (const component of components) {
                const parent = component.parent?.();
                const collection = parent?.components?.();
                const clone = cloneGrapesjsClipboardComponent(component);
                if (!parent || !collection?.add || !clone) return null;
                const index = directComponentIndex(parent, component);
                try {
                  const added = normalizeAddedComponents(collection.add(clone, {
                    at: index >= 0 ? index + 1 : collection.length ?? 0,
                    action: 'clone-component',
                  } as never));
                  clones.push(added[0] ?? clone);
                } catch {
                  return null;
                }
              }
              return clones;
            }
            const positionedDragItem = (
              component: Component,
              rootRect: DOMRect | null,
            ): PositionedToolDragItem => {
              const style = component.getStyle?.() ?? {};
              const el = getElementFromComponent(component) as HTMLElement | null;
              const readLeft = style.left ?? el?.style.getPropertyValue('left');
              const readTop = style.top ?? el?.style.getPropertyValue('top');
              const origin = resolveGrapesjsPositionedToolDragOrigin({
                styleLeft: readLeft,
                styleTop: readTop,
                elementRect: el?.getBoundingClientRect?.() ?? null,
                rootRect,
              });
              return {
                component,
                startLeft: origin.left,
                startTop: origin.top,
                pendingStyle: null,
              };
            };
            /**
             * Re-parent a flex child to the canvas root wrapper and convert it
             * to an absolutely-positioned standalone element at the given box
             * (canvas-document coordinates). Clears `flex-basis` so the explicit
             * width/height drive the size, mirroring `dissolveGrapesjsFlexSelection`.
             * Returns the element's new left/top origin so the drag can track it.
             */
            const detachFlexChildToAbsolute = (
              child: Component,
              box: { left: number; top: number; width: number; height: number },
            ): { left: number; top: number } => {
              const rootWrapper = getRootWrapperComponent(editor);
              if (rootWrapper) {
                try {
                  child.move(rootWrapper, { at: rootWrapper.components().length });
                } catch { /* keep current parent on failure */ }
              }
              const style = getComponentStyleRecord(child);
              delete style['flex-basis'];
              delete style.flexBasis;
              child.setStyle?.({
                ...style,
                position: 'absolute',
                left: `${Math.max(0, Math.round(box.left))}px`,
                top: `${Math.max(0, Math.round(box.top))}px`,
                width: `${Math.max(1, Math.round(box.width))}px`,
                height: `${Math.max(1, Math.round(box.height))}px`,
              } as Parameters<typeof child.setStyle>[0]);
              setComponentAttributes(child, { 'data-od-position-mode': 'absolute' });
              return { left: Math.max(0, Math.round(box.left)), top: Math.max(0, Math.round(box.top)) };
            };
            /**
             * Find the sibling insertion index within `parent` for the cursor
             * position, so a flex child being dragged inside its container
             * reorders to follow the pointer (Figma-style). Returns the index
             * to pass to `child.move(parent, { at })`, or null when no reorder
             * is warranted (e.g. pointer outside the parent).
             */
            const flexReorderIndexAtPoint = (
              parent: Component,
              child: Component,
              clientX: number,
              clientY: number,
              axis: GrapesjsLayoutAxis,
            ): number | null => {
              const parentEl = getElementFromComponent(parent) as HTMLElement | null;
              if (!parentEl) return null;
              const pRect = parentEl.getBoundingClientRect();
              if (
                clientX < pRect.left - 4 || clientX > pRect.right + 4
                || clientY < pRect.top - 4 || clientY > pRect.bottom + 4
              ) return null;
              const siblings = directComponentChildren(parent).filter((sib) => sib !== child);
              for (let i = 0; i < siblings.length; i += 1) {
                const sibEl = getElementFromComponent(siblings[i]) as HTMLElement | null;
                if (!sibEl) continue;
                const sRect = sibEl.getBoundingClientRect();
                if (sRect.width <= 0 || sRect.height <= 0) continue;
                const midpoint = axis === 'row'
                  ? sRect.left + sRect.width / 2
                  : sRect.top + sRect.height / 2;
                const cursor = axis === 'row' ? clientX : clientY;
                if (cursor < midpoint) {
                  const sib = siblings[i];
                  if (sib) return directComponentIndex(parent, sib);
                }
              }
              // Past the last sibling's midpoint → append after the last one.
              const last = siblings[siblings.length - 1];
              const lastIdx = last ? directComponentIndex(parent, last) : -1;
              return lastIdx >= 0 ? lastIdx + 1 : parent.components().length;
            };
            const pointerInsideRect = (clientX: number, clientY: number, rect: DOMRect, tolerance = 4): boolean => (
              isPointInsideGrapesjsClientRect(clientX, clientY, rect, tolerance)
            );
            /**
             * Resolve the flex container under the cursor (excluding the
             * element being dragged), so a deferred Alt+clone can preview the
             * insertion point. Uses elementsFromPoint to skip the dragged
             * clone's own element and find the first flex container beneath.
             * Prefers the DEEPEST flex container that actually has GrapesJS
             * child components (so the insertion index/line is meaningful).
             */
            const flexContainerAtPoint = (
              clientX: number,
              clientY: number,
              excludeComp: Component | null,
            ): Component | null => {
              const cdoc = editor.Canvas.getDocument?.();
              const win = cdoc?.defaultView ?? null;
              if (!cdoc || !win) return null;
              const excludeEl = excludeComp ? getElementFromComponent(excludeComp) : null;
              const stack = (cdoc as unknown as { elementsFromPoint?: (x: number, y: number) => Element[] })
                .elementsFromPoint?.(clientX, clientY) ?? [];
              // Collect all flex ancestors in the hit stack (excluding the
              // dragged element). Pick the deepest one that has real child
              // components — a wrapper flex with 0 GrapesJS children (common
              // for canvas-tool frames whose content is unregistered) gives a
              // useless insertion index of 0 and a line at the container edge.
              let best: Component | null = null;
              let bestDepth = -1;
              for (const el of stack) {
                if (excludeEl && (el === excludeEl || excludeEl.contains(el) || el.contains(excludeEl))) continue;
                const comp = getComponentFromElement(el);
                if (!comp) continue;
                if (!isFlexDisplay(componentDisplay(comp))) continue;
                const kids = directComponentChildren(comp).filter((c) => c !== excludeComp);
                if (kids.length === 0) continue;
                const depth = componentDepth(comp);
                if (depth > bestDepth) {
                  bestDepth = depth;
                  best = comp;
                }
              }
              return best;
            };
            /** Ensure the insertion-line overlay element exists and return it. */
            const ensureInsertLineEl = (): HTMLDivElement | null => {
              const cdoc = editor.Canvas.getDocument?.();
              if (!cdoc) return null;
              let el = cdoc.querySelector<HTMLDivElement>('[data-od-insert-line]');
              if (!el) {
                el = cdoc.createElement('div');
                el.setAttribute('data-od-insert-line', 'true');
                el.setAttribute('aria-hidden', 'true');
                el.style.cssText = 'position:absolute;z-index:2147483646;background:#4f83ff;pointer-events:none;display:none;box-shadow:0 0 0 1px rgba(255,255,255,0.9);';
                cdoc.body.appendChild(el);
              }
              return el;
            };
            /**
             * Show/move/hide the blue insertion line for a deferred-clone drag.
             * Computes the gap between the two siblings the cursor falls
             * between and draws a line there; when over a flex container with
             * no siblings, draws a line at the start. Clears the preview when
             * the cursor is not over a flex container.
             */
            const updateFlexInsertLinePreview = (
              state: PositionedToolDrag,
              clientX: number,
              clientY: number,
            ) => {
              const dragged = state.items[0]?.component ?? null;
              const hitTarget = flexContainerAtPoint(clientX, clientY, dragged);
              const sourceParentEl = state.flexParent ? getElementFromComponent(state.flexParent) as HTMLElement | null : null;
              const target = resolveGrapesjsFlexInsertTarget({
                sourceParent: state.flexParent,
                sourceParentRect: sourceParentEl?.getBoundingClientRect?.() ?? null,
                fallbackTarget: hitTarget,
                clientX,
                clientY,
              });
              const lineEl = ensureInsertLineEl();
              if (!target || !lineEl) {
                if (state.insertTarget || !state.insertMissLogged) {
                  recordGrapesjsEditorDiagnostic('flex-insert-preview', {
                    result: target ? 'missing-line' : 'missing-target',
                    fallbackTarget: componentDiagnosticId(hitTarget),
                    sourceParent: componentDiagnosticId(state.flexParent),
                    sourceParentContainsPointer: sourceParentEl
                      ? isPointInsideGrapesjsClientRect(clientX, clientY, sourceParentEl.getBoundingClientRect())
                      : false,
                    previousTarget: componentDiagnosticId(state.insertTarget),
                    previousIndex: state.insertIndex,
                    dragged: componentDiagnosticId(dragged),
                    cursor: { x: Math.round(clientX), y: Math.round(clientY) },
                  });
                }
                state.insertMissLogged = true;
                hideFlexInsertLine(state);
                return;
              }
              const targetEl = getElementFromComponent(target) as HTMLElement | null;
              if (!targetEl) { hideFlexInsertLine(state); return; }
              const { direction } = readParentFlexInfo(target);
              const axis: GrapesjsLayoutAxis = String(direction).startsWith('column') ? 'column' : 'row';
              const tRect = targetEl.getBoundingClientRect();
              const childEntries = resolveGrapesjsFlexInsertChildEntries({ target, targetEl, dragged });
              const childEls = childEntries.entries;
              const rootRect = canvasDocumentRootRect(editor);
              const draggedRect = dragged ? (getElementFromComponent(dragged) as HTMLElement | null)?.getBoundingClientRect?.() ?? null : null;
              const previewDraggedRect = resolveGrapesjsPreviewRectFromDragItem({
                item: state.items[0] ?? null,
                fallbackRect: draggedRect,
              });
              const childRects = childEls.map((entry) => entry.el.getBoundingClientRect());
              const insertAt = resolveGrapesjsFlexInsertIndexFromRects({
                axis,
                clientX,
                clientY,
                draggedRect: previewDraggedRect,
                childRects,
              });
              const previousTarget = state.insertTarget;
              const previousIndex = state.insertIndex;
              state.insertTarget = target;
              state.insertIndex = insertAt;
              // Compute the line geometry (between sibling[i-1] and sibling[i]).
              let lineLeft: number;
              let lineTop: number;
              let lineW: number;
              let lineH: number;
              const prevEl = insertAt > 0 ? childEls[insertAt - 1]?.el : null;
              const nextEl = insertAt < childEls.length ? childEls[insertAt]?.el : null;
              if (axis === 'row') {
                lineH = tRect.height;
                const y0 = tRect.top - (rootRect?.top ?? 0);
                lineTop = y0;
                let xCenter: number;
                if (prevEl && nextEl) {
                  // Gap midpoint = right edge of previous sibling to left edge of next.
                  const a = prevEl.getBoundingClientRect();
                  const b = nextEl.getBoundingClientRect();
                  xCenter = (a.right + b.left) / 2;
                } else if (prevEl) {
                  xCenter = prevEl.getBoundingClientRect().right + 2;
                } else if (nextEl) {
                  xCenter = nextEl.getBoundingClientRect().left - 2;
                } else {
                  xCenter = tRect.left + 2;
                  lineH = Math.max(lineH, 1);
                }
                lineLeft = xCenter - 1 - (rootRect?.left ?? 0);
                lineW = 2;
              } else {
                lineW = tRect.width;
                const x0 = tRect.left - (rootRect?.left ?? 0);
                lineLeft = x0;
                let yCenter: number;
                if (prevEl && nextEl) {
                  // Gap midpoint = bottom edge of previous sibling to top edge of next.
                  const a = prevEl.getBoundingClientRect();
                  const b = nextEl.getBoundingClientRect();
                  yCenter = (a.bottom + b.top) / 2;
                } else if (prevEl) {
                  yCenter = prevEl.getBoundingClientRect().bottom + 2;
                } else if (nextEl) {
                  yCenter = nextEl.getBoundingClientRect().top - 2;
                } else {
                  yCenter = tRect.top + 2;
                  lineW = Math.max(lineW, 1);
                }
                lineTop = yCenter - 1 - (rootRect?.top ?? 0);
                lineH = 2;
              }
              lineEl.style.display = 'block';
              lineEl.style.left = `${Math.round(lineLeft)}px`;
              lineEl.style.top = `${Math.round(lineTop)}px`;
              lineEl.style.width = `${Math.max(1, Math.round(lineW))}px`;
              lineEl.style.height = `${Math.max(1, Math.round(lineH))}px`;
              if (state.insertLineEl !== lineEl) state.insertLineEl = lineEl;
              if (previousTarget !== target || previousIndex !== insertAt) {
                state.insertMissLogged = false;
                recordGrapesjsEditorDiagnostic('flex-insert-preview', {
                  result: 'shown',
                  previewKind: 'drop-onto-flex',
                  dragged: componentDiagnosticId(dragged),
                  target: componentDiagnosticId(target),
                  axis,
                  childCount: childEls.length,
                  childSource: childEntries.source,
                  modelChildCount: childEntries.modelChildCount,
                  modelElementCount: childEntries.modelElementCount,
                  domChildCount: childEntries.domChildCount,
                  insertAt,
                  cursor: { x: Math.round(clientX), y: Math.round(clientY) },
                  dragCenter: previewDraggedRect
                    ? {
                        x: Math.round(previewDraggedRect.left + (previewDraggedRect.width ?? previewDraggedRect.right - previewDraggedRect.left) / 2),
                        y: Math.round(previewDraggedRect.top + (previewDraggedRect.height ?? previewDraggedRect.bottom - previewDraggedRect.top) / 2),
                      }
                    : null,
                  line: {
                    left: Math.round(lineLeft),
                    top: Math.round(lineTop),
                    width: Math.max(1, Math.round(lineW)),
                    height: Math.max(1, Math.round(lineH)),
                  },
                });
              }
            };
            const hideFlexInsertLine = (state: PositionedToolDrag) => {
              if (state.insertLineEl) {
                state.insertLineEl.style.display = 'none';
              }
              state.insertTarget = null;
              state.insertIndex = -1;
            };
            /**
             * Preview the insertion index + blue line for a NON-detached flex
             * child being dragged inside its own parent (reorder). Computes the
             * gap between siblings under the cursor and draws the line there,
             * without moving the element (the move happens on release). This is
             * the in-flex analogue of updateFlexInsertLinePreview (which is for
             * a detached standalone element dropped onto an arbitrary flex).
             */
            const previewFlexInsertIndex = (
              state: PositionedToolDrag,
              parent: Component,
              clientX: number,
              clientY: number,
              axis: GrapesjsLayoutAxis,
              draggedPreviewRect: GrapesjsClientRectLike | null = null,
            ) => {
              const parentEl = getElementFromComponent(parent) as HTMLElement | null;
              const lineEl = state.insertLineEl;
              if (!parentEl || !lineEl) {
                if (!state.insertMissLogged) {
                  recordGrapesjsEditorDiagnostic('flex-insert-preview', {
                    result: parentEl ? 'missing-line' : 'missing-parent-element',
                    previewKind: 'reorder-within-parent',
                    dragged: componentDiagnosticId(state.flexChild),
                    target: componentDiagnosticId(parent),
                    cursor: { x: Math.round(clientX), y: Math.round(clientY) },
                  });
                }
                state.insertMissLogged = true;
                hideFlexInsertLine(state);
                return;
              }
              const tRect = parentEl.getBoundingClientRect();
              const dragged = state.flexChild;
              const childEntries = resolveGrapesjsFlexInsertChildEntries({ target: parent, targetEl: parentEl, dragged });
              const childEls = childEntries.entries;
              const childRects = childEls.map((entry) => entry.el.getBoundingClientRect());
              const insertAt = resolveGrapesjsFlexInsertIndexFromRects({
                axis,
                clientX,
                clientY,
                draggedRect: draggedPreviewRect,
                childRects,
              });
              const previousTarget = state.insertTarget;
              const previousIndex = state.insertIndex;
              state.insertTarget = parent;
              state.insertIndex = insertAt;
              const rootRect = canvasDocumentRootRect(editor);
              const prevEl = insertAt > 0 ? childEls[insertAt - 1]?.el ?? null : null;
              const nextEl = insertAt < childEls.length ? childEls[insertAt]?.el ?? null : null;
              let lineLeft: number;
              let lineTop: number;
              let lineW: number;
              let lineH: number;
              if (axis === 'row') {
                lineH = tRect.height;
                lineTop = tRect.top - (rootRect?.top ?? 0);
                let xCenter: number;
                if (prevEl && nextEl) {
                  const a = prevEl.getBoundingClientRect();
                  const b = nextEl.getBoundingClientRect();
                  xCenter = (a.right + b.left) / 2;
                } else if (prevEl) {
                  xCenter = prevEl.getBoundingClientRect().right + 2;
                } else if (nextEl) {
                  xCenter = nextEl.getBoundingClientRect().left - 2;
                } else {
                  xCenter = tRect.left + 2;
                }
                lineLeft = xCenter - 1 - (rootRect?.left ?? 0);
                lineW = 2;
              } else {
                lineW = tRect.width;
                lineLeft = tRect.left - (rootRect?.left ?? 0);
                let yCenter: number;
                if (prevEl && nextEl) {
                  const a = prevEl.getBoundingClientRect();
                  const b = nextEl.getBoundingClientRect();
                  yCenter = (a.bottom + b.top) / 2;
                } else if (prevEl) {
                  yCenter = prevEl.getBoundingClientRect().bottom + 2;
                } else if (nextEl) {
                  yCenter = nextEl.getBoundingClientRect().top - 2;
                } else {
                  yCenter = tRect.top + 2;
                }
                lineTop = yCenter - 1 - (rootRect?.top ?? 0);
                lineH = 2;
              }
              lineEl.style.display = 'block';
              lineEl.style.left = `${Math.round(lineLeft)}px`;
              lineEl.style.top = `${Math.round(lineTop)}px`;
              lineEl.style.width = `${Math.max(1, Math.round(lineW))}px`;
              lineEl.style.height = `${Math.max(1, Math.round(lineH))}px`;
              if (previousTarget !== parent || previousIndex !== insertAt) {
                state.insertMissLogged = false;
                recordGrapesjsEditorDiagnostic('flex-insert-preview', {
                  result: 'shown',
                  previewKind: 'reorder-within-parent',
                  dragged: componentDiagnosticId(state.flexChild),
                  target: componentDiagnosticId(parent),
                  axis,
                  childCount: childEls.length,
                  childSource: childEntries.source,
                  modelChildCount: childEntries.modelChildCount,
                  modelElementCount: childEntries.modelElementCount,
                  domChildCount: childEntries.domChildCount,
                  insertAt,
                  cursor: { x: Math.round(clientX), y: Math.round(clientY) },
                  dragCenter: draggedPreviewRect
                    ? {
                        x: Math.round(draggedPreviewRect.left + (draggedPreviewRect.width ?? draggedPreviewRect.right - draggedPreviewRect.left) / 2),
                        y: Math.round(draggedPreviewRect.top + (draggedPreviewRect.height ?? draggedPreviewRect.bottom - draggedPreviewRect.top) / 2),
                      }
                    : null,
                  line: {
                    left: Math.round(lineLeft),
                    top: Math.round(lineTop),
                    width: Math.max(1, Math.round(lineW)),
                    height: Math.max(1, Math.round(lineH)),
                  },
                });
              }
            };
            /** Remove the clone cursor class from the iframe root. */
            const clearCloneCursor = () => {
              cloneCursorActiveRef.current = false;
              try {
                const cdoc = editor.Canvas.getDocument?.();
                cdoc?.documentElement.classList.remove('od-canvas-cursor-clone');
              } catch { /* ignore */ }
            };
            const updatePositionedDragGuide = (state: PositionedToolDrag, nextLeft: number, nextTop: number) => {
              if (!state.cloneDrag) return;
              const dx = Math.round(nextLeft - state.startLeft);
              const dy = Math.round(nextTop - state.startTop);
              if (!state.guideEl) {
                const guide = doc.createElement('div');
                guide.setAttribute('data-od-option-drag-guide', 'true');
                guide.style.cssText = [
                  'position:absolute',
                  'left:0',
                  'top:0',
                  'z-index:2147483646',
                  'pointer-events:none',
                  'font:600 11px/1 -apple-system, system-ui, sans-serif',
                  'color:#ff5a3d',
                ].join(';');
                doc.body.appendChild(guide);
                state.guideEl = guide;
              }
              const guide = state.guideEl;
              if (!guide) return;
              const x1 = Math.round(state.startLeft);
              const y1 = Math.round(state.startTop);
              const x2 = Math.round(nextLeft);
              const y2 = Math.round(nextTop);
              const hLeft = Math.min(x1, x2);
              const hWidth = Math.abs(x2 - x1);
              const vTop = Math.min(y1, y2);
              const vHeight = Math.abs(y2 - y1);
              const hLabelLeft = hLeft + Math.max(0, hWidth / 2 - 12);
              const vLabelTop = vTop + Math.max(0, vHeight / 2 - 7);
              guide.innerHTML = `
                ${hWidth > 0 ? `<div style="position:absolute;left:${hLeft}px;top:${y2 - 10}px;width:${hWidth}px;border-top:1px dashed #ff5a3d"></div>` : ''}
                ${vHeight > 0 ? `<div style="position:absolute;left:${x2 - 10}px;top:${vTop}px;height:${vHeight}px;border-left:1px dashed #ff5a3d"></div>` : ''}
                ${hWidth > 0 ? `<div style="position:absolute;left:${hLabelLeft}px;top:${y2 - 24}px;padding:2px 5px;border-radius:3px;background:#ff5a3d;color:#fff">${Math.abs(dx)}</div>` : ''}
                ${vHeight > 0 ? `<div style="position:absolute;left:${x2 + 4}px;top:${vLabelTop}px;padding:2px 5px;border-radius:3px;background:#ff5a3d;color:#fff">${Math.abs(dy)}</div>` : ''}
              `;
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
              const point = pointForSource(ev, source);
              if (!point) return false;
              // Flex-child drag: when the user selected (or clicked) a single
              // flex child, drag THAT child rather than its positioned ancestor.
              // Release inside the parent reorders; release outside detaches it
              // into an absolute-positioned standalone element. Multi-selection
              // still goes through the multi-selection overlay path instead.
              // Alt+drag clones the child into its flex parent FIRST (so the
              // clone inherits the same flex sizing) and then drags the clone —
              // no immediate detach, so dropping back inside the container
              // leaves it as a flex child.
              const isSingleSelection = selectedEditableComponents().length <= 1;
              const flexChildCandidate = compAtPoint && isGrapesjsFlexChildComponent(compAtPoint) ? compAtPoint : null;
              if (flexChildCandidate && isSingleSelection) {
                const flexParent = flexChildCandidate.parent?.() ?? null;
                if (flexParent) {
                  const { direction } = readParentFlexInfo(flexParent);
                  const flexAxis: GrapesjsLayoutAxis = String(direction).startsWith('column') ? 'column' : 'row';
                  // For Alt+drag, clone the child as a sibling within the same
                  // flex parent so its size is driven by flex layout (matching
                  // the source) instead of being detached with a measured box.
                  let dragTarget = flexChildCandidate;
                  let cloneDrag = false;
                  // Alt+clone is DEFERRED: pointerdown records the intent, the
                  // clone is only created once the pointer moves past the
                  // drag threshold (updatePositionedToolDrag). Until then the
                  // source element stays put — no premature copy.
                  const deferAltClone = !!ev.altKey;
                  if (!deferAltClone) {
                    // (non-alt flex drag — cloneDrag stays false, reorder/detach)
                  }
                  const rootRect = canvasDocumentRootRect(editor);
                  const originBox = componentBox(dragTarget, rootRect);
                  positionedToolDrag = {
                    component: dragTarget,
                    items: [{
                      component: dragTarget,
                      startLeft: originBox?.left ?? 0,
                      startTop: originBox?.top ?? 0,
                      pendingStyle: null,
                    }],
                    source,
                    start: point,
                    startLeft: originBox?.left ?? 0,
                    startTop: originBox?.top ?? 0,
                    moved: false,
                    cloneDrag,
                    guideEl: null,
                    flexChild: dragTarget,
                    flexParent,
                    flexAxis,
                    flexDetached: false,
                    flexOriginBox: originBox ? {
                      left: originBox.left, top: originBox.top, width: originBox.w, height: originBox.h,
                    } : null,
                    flexDetachedLeft: 0,
                    flexDetachedTop: 0,
                    // Deferred Alt+clone: created in update once threshold passes.
                    pendingAltClone: deferAltClone,
                    altCloneSource: deferAltClone ? flexChildCandidate : null,
                    insertLineEl: null,
                    insertTarget: null,
                    insertIndex: -1,
                    insertMissLogged: false,
                  };
                  recordGrapesjsEditorDiagnostic('flex-drag-start', {
                    child: componentDiagnosticId(dragTarget),
                    parent: componentDiagnosticId(flexParent),
                    axis: flexAxis,
                    source,
                    altKey: ev.altKey,
                    pendingAltClone: deferAltClone,
                    point: { x: Math.round(point.x), y: Math.round(point.y) },
                    originBox: originBox ? {
                      left: Math.round(originBox.left),
                      top: Math.round(originBox.top),
                      width: Math.round(originBox.w),
                      height: Math.round(originBox.h),
                    } : null,
                  });
                  // On pointerdown select the source (the clone, once created,
                  // gets selected when it materializes).
                  ev.preventDefault();
                  ev.stopImmediatePropagation();
                  if (!deferAltClone) {
                    try { editor.select(dragTarget); } catch { /* ignore */ }
                  }
                  return true;
                }
              }
              const comp = findGrapesjsPositionedDragComponent(compAtPoint);
              if (!comp) return false;
              const selectedPositioned = selectedPositionedDragComponents();
              let dragComponents = selectedPositioned.includes(comp) ? selectedPositioned : [comp];
              let cloneDrag = false;
              if (ev.altKey) {
                // Alt+drag clones whatever the user ACTUALLY selected — not
                // the positioned ancestor `findGrapesjsPositionedDragComponent`
                // resolves for coordinate math. (Flex-child Alt+clone is handled
                // by the flex-child branch above, which keeps the clone in the
                // flex parent. This path only runs for absolute elements.)
                const concreteSelection = selectedEditableComponents();
                const cloneTargets = concreteSelection.length > 0 ? concreteSelection : dragComponents;
                const clones = clonePositionedDragComponents(cloneTargets);
                if (!clones?.length) return false;
                const primaryIndex = compAtPoint ? Math.max(0, cloneTargets.indexOf(compAtPoint)) : 0;
                dragComponents = clones;
                cloneDrag = true;
                const primaryClone = clones[primaryIndex] ?? clones[0];
                if (primaryClone) dragComponents = [
                  primaryClone,
                  ...clones.filter((clone) => clone !== primaryClone),
                ];
                try { editor.select(clones.length === 1 ? clones[0] : clones); } catch { /* ignore */ }
              }
              const rootRect = canvasDocumentRootRect(editor);
              const items = dragComponents.map((component) => positionedDragItem(component, rootRect));
              const primaryItem = items.find((item) => item.component === comp) ?? items[0];
              if (!primaryItem) return false;
              positionedToolDrag = {
                component: primaryItem.component,
                items,
                source,
                start: point,
                startLeft: primaryItem.startLeft,
                startTop: primaryItem.startTop,
                moved: false,
                cloneDrag,
                guideEl: null,
                flexChild: null,
                flexParent: null,
                flexAxis: 'row',
                flexDetached: false,
                flexOriginBox: null,
                flexDetachedLeft: 0,
                flexDetachedTop: 0,
                pendingAltClone: false,
                altCloneSource: null,
                insertLineEl: null,
                insertTarget: null,
                insertIndex: -1,
                insertMissLogged: false,
              };
              ev.preventDefault();
              ev.stopImmediatePropagation();
              try { editor.select(items.length === 1 ? items[0]?.component : items.map((item) => item.component)); } catch { /* ignore */ }
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
              const previewClient = clientPointForSource(ev, state.source);
              // Deferred Alt+clone: the pointer crossed the threshold, so NOW
              // create the clone as a standalone absolute element that tracks
              // the cursor. Dropping over a flex container later re-parents it
              // into that container at the insertion line.
              if (state.pendingAltClone && state.altCloneSource) {
                const source = state.altCloneSource;
                // Measure the SOURCE BEFORE cloning. Once the clone is inserted
                // as a flex sibling, the source's rendered width shrinks (the
                // two now share the flex space), which produced mismatched
                // clone sizes. The pre-clone box is the size the copy should be.
                const rr = canvasDocumentRootRect(editor);
                const ob = componentBox(source, rr);
                const clones = clonePositionedDragComponents([source]);
                const clone = clones?.[0] ?? null;
                state.pendingAltClone = false;
                state.altCloneSource = null;
                if (clone) {
                  const box = ob
                    ? { left: ob.left + (point.x - state.start.x), top: ob.top + (point.y - state.start.y), width: ob.w, height: ob.h }
                    : state.flexOriginBox
                      ? { left: state.flexOriginBox.left + (point.x - state.start.x), top: state.flexOriginBox.top + (point.y - state.start.y), width: state.flexOriginBox.width, height: state.flexOriginBox.height }
                      : null;
                  if (box) {
                    const detached = detachFlexChildToAbsolute(clone, box);
                    state.flexChild = clone;
                    // Keep the source flex parent as a preferred drop target.
                    // The clone is temporarily detached for drag tracking, but
                    // if the pointer remains inside this parent it should still
                    // preview and commit as an in-flex insertion.
                    state.flexParent = source.parent?.() ?? null;
                    state.flexDetached = true;
                    state.flexDetachedLeft = detached.left;
                    state.flexDetachedTop = detached.top;
                    state.component = clone;
                    state.items = [{
                      component: clone,
                      startLeft: detached.left,
                      startTop: detached.top,
                      pendingStyle: null,
                    }];
                    state.start = point;
                    state.startLeft = detached.left;
                    state.startTop = detached.top;
                    try { editor.select(clone); } catch { /* ignore */ }
                    recordGrapesjsEditorDiagnostic('flex-drag-alt-clone-materialized', {
                      source: componentDiagnosticId(source),
                      clone: componentDiagnosticId(clone),
                    detached: true,
                    sourceParent: componentDiagnosticId(state.flexParent),
                      box: {
                        left: Math.round(box.left),
                        top: Math.round(box.top),
                        width: Math.round(box.width),
                        height: Math.round(box.height),
                      },
                      start: { x: Math.round(state.start.x), y: Math.round(state.start.y) },
                    });
                  }
                }
                // Show the clone cursor while an Alt-clone drag is live.
                cloneCursorActiveRef.current = true;
                try {
                  const cdoc = editor.Canvas.getDocument?.();
                  cdoc?.documentElement.classList.add('od-canvas-cursor-clone');
                } catch { /* ignore */ }
              }
              const dx = point.x - state.start.x;
              const dy = point.y - state.start.y;
              let primaryLeft = state.startLeft;
              let primaryTop = state.startTop;
              // Flex-child drag: reorder inside the parent, or detach to absolute
              // when the pointer leaves the parent bounds.
              if (state.flexChild && state.flexParent && state.flexOriginBox) {
                const parentEl = getElementFromComponent(state.flexParent) as HTMLElement | null;
                if (parentEl) {
                  const pRect = parentEl.getBoundingClientRect();
                  const inside = pointerInsideRect(previewClient.x, previewClient.y, pRect);
                  if (!state.flexDetached && !inside) {
                    // Detach: re-parent to root wrapper + absolute placement.
                    // Re-measure the live box NOW (not the pointerdown snapshot)
                    // so width/height match the element's current flex-rendered
                    // size — the snapshot can drift if the layout changed during
                    // the drag, and a stale size was producing wrong-sized clones.
                    const rr = canvasDocumentRootRect(editor);
                    const liveBox = componentBox(state.flexChild, rr);
                    const box = liveBox
                      ? { left: liveBox.left + dx, top: liveBox.top + dy, width: liveBox.w, height: liveBox.h }
                      : state.flexOriginBox
                        ? { left: state.flexOriginBox.left + dx, top: state.flexOriginBox.top + dy, width: state.flexOriginBox.width, height: state.flexOriginBox.height }
                        : null;
                    if (!box) return;
                    const detached = detachFlexChildToAbsolute(state.flexChild, box);
                    state.flexDetached = true;
                    state.flexDetachedLeft = detached.left;
                    state.flexDetachedTop = detached.top;
                    // Rebase the drag so subsequent left/top math is relative to
                    // the detached origin, not the old flex box.
                    state.start = point;
                    state.startLeft = detached.left;
                    state.startTop = detached.top;
                    const item = state.items[0];
                    if (item) {
                      item.startLeft = detached.left;
                      item.startTop = detached.top;
                      item.pendingStyle = {
                        left: `${detached.left}px`,
                        top: `${detached.top}px`,
                      };
                      previewComponentStyle(item.component, item.pendingStyle);
                      primaryLeft = detached.left;
                      primaryTop = detached.top;
                    }
                    recordGrapesjsEditorDiagnostic('flex-drag-detach', {
                      child: componentDiagnosticId(state.flexChild),
                      previousParent: componentDiagnosticId(state.flexParent),
                      box: {
                        left: Math.round(box.left),
                        top: Math.round(box.top),
                        width: Math.round(box.width),
                        height: Math.round(box.height),
                      },
                      detachedOrigin: detached,
                      cursor: { x: Math.round(ev.clientX), y: Math.round(ev.clientY) },
                      previewCursor: { x: Math.round(previewClient.x), y: Math.round(previewClient.y) },
                    });
                    updatePositionedDragGuide(state, primaryLeft, primaryTop);
                    requestVisibleToolsRefresh();
                    return;
                  }
                  if (!state.flexDetached && inside) {
                    // Still inside the flex parent: show the insertion line at
                    // the cursor position (preview only — do NOT live-reorder
                    // every move, which was jittery and swapped siblings on a
                    // tiny nudge). The actual move happens on release.
                    const lineEl = ensureInsertLineEl();
                    if (lineEl) state.insertLineEl = lineEl;
                    const draggedRect = (getElementFromComponent(state.flexChild) as HTMLElement | null)?.getBoundingClientRect?.() ?? null;
                    const previewDraggedRect = resolveGrapesjsPreviewRectFromDragItem({
                      item: state.items[0] ?? null,
                      fallbackRect: draggedRect,
                      deltaLeft: dx,
                      deltaTop: dy,
                    });
                    previewFlexInsertIndex(
                      state,
                      state.flexParent,
                      previewClient.x,
                      previewClient.y,
                      state.flexAxis,
                      previewDraggedRect,
                    );
                    requestVisibleToolsRefresh();
                    return;
                  }
                }
              }
              for (const item of state.items) {
                const nextLeft = Math.max(0, Math.round(item.startLeft + dx));
                const nextTop = Math.max(0, Math.round(item.startTop + dy));
                item.pendingStyle = {
                  left: `${nextLeft}px`,
                  top: `${nextTop}px`,
                };
                if (item.component === state.component) {
                  primaryLeft = nextLeft;
                  primaryTop = nextTop;
                }
                previewComponentStyle(item.component, item.pendingStyle);
              }
              // Insertion-line preview: when dragging a standalone (detached)
              // element, detect the flex container under the cursor and show a
              // blue line where the element would be inserted on release.
              if (state.flexDetached && state.items[0]) {
                updateFlexInsertLinePreview(state, previewClient.x, previewClient.y);
              }
              updatePositionedDragGuide(state, primaryLeft, primaryTop);
              requestVisibleToolsRefresh();
            };

            const finishPositionedToolDrag = (ev: PointerEvent) => {
              if (!positionedToolDrag) return;
              updatePositionedToolDrag(ev);
              const state = positionedToolDrag;
              const wasCloneDrag = state.cloneDrag;
              const didMove = state.moved;
              removePositionedDragGuide(state);
              recordGrapesjsEditorDiagnostic('positioned-drag-finish', {
                pendingAltClone: state.pendingAltClone,
                flexDetached: state.flexDetached,
                flexChild: componentDiagnosticId(state.flexChild),
                flexParent: componentDiagnosticId(state.flexParent),
                insertTarget: componentDiagnosticId(state.insertTarget),
                insertIndex: state.insertIndex,
                cloneDrag: state.cloneDrag,
                moved: didMove,
                itemCount: state.items.length,
              });
              // If the pointer never crossed the threshold (a tap, not a drag)
              // AND this was a deferred Alt+clone that never materialized, there
              // is nothing to commit — a plain Alt+click must NOT clone.
              if (state.pendingAltClone && !state.flexDetached) {
                recordGrapesjsEditorDiagnostic('positioned-drag-commit', {
                  result: 'ignored-pending-alt-click',
                  flexChild: componentDiagnosticId(state.flexChild),
                  flexParent: componentDiagnosticId(state.flexParent),
                });
                positionedToolDrag = null;
                hideFlexInsertLine(state);
                clearCloneCursor();
                return;
              }
              // Non-detached flex reorder: the child stayed in its parent
              // during the drag (pointer never left). Move it to the previewed
              // insertion index. GrapesJS handles the same-parent index shift.
              if (!state.flexDetached && state.flexChild && state.insertTarget && state.insertIndex >= 0) {
                try {
                  state.flexChild.move(state.insertTarget, { at: Math.max(0, state.insertIndex) });
                } catch { /* ignore */ }
                recordGrapesjsEditorDiagnostic('positioned-drag-commit', {
                  result: 'reordered-within-flex',
                  child: componentDiagnosticId(state.flexChild),
                  target: componentDiagnosticId(state.insertTarget),
                  requestedIndex: Math.max(0, state.insertIndex),
                  afterIndex: directComponentIndex(state.insertTarget, state.flexChild),
                  flexDetached: state.flexDetached,
                });
                refreshSelectionSnapshotRef.current?.();
                scheduleEmitRef.current?.();
                requestVisibleToolsRefresh();
              } else if (state.insertTarget && state.flexDetached) {
                const dragged = state.items[0]?.component ?? null;
                if (dragged) {
                  const { direction } = readParentFlexInfo(state.insertTarget);
                  const dropAxis: GrapesjsLayoutAxis = String(direction).startsWith('column') ? 'column' : 'row';
                  const style = getComponentStyleRecord(dragged);
                  delete style.position;
                  delete style.left;
                  delete style.top;
                  // Preserve the element's size in flex-appropriate terms:
                  // main axis → flex-basis (so it keeps its size in the flow),
                  // cross axis → keep width/height.
                  if (dropAxis === 'row') {
                    if (style.width) style['flex-basis'] = style.width;
                  } else if (style.height) {
                    style['flex-basis'] = style.height;
                  }
                  try {
                    dragged.setStyle?.(style as Parameters<typeof dragged.setStyle>[0]);
                  } catch { /* ignore */ }
                  setComponentAttributes(dragged, { 'data-od-position-mode': 'flow' });
                  try {
                    dragged.move(state.insertTarget, { at: Math.max(0, state.insertIndex) });
                  } catch { /* ignore */ }
                  recordGrapesjsEditorDiagnostic('positioned-drag-commit', {
                    result: 'inserted-into-flex',
                    child: componentDiagnosticId(dragged),
                    target: componentDiagnosticId(state.insertTarget),
                    requestedIndex: Math.max(0, state.insertIndex),
                    afterIndex: directComponentIndex(state.insertTarget, dragged),
                    dropAxis,
                  });
                }
              } else {
                for (const item of state.items) {
                  if (item.pendingStyle) commitComponentStyle(item.component, item.pendingStyle);
                }
                recordGrapesjsEditorDiagnostic('positioned-drag-commit', {
                  result: 'absolute-position',
                  items: state.items.map((item) => ({
                    component: componentDiagnosticId(item.component),
                    pendingStyle: item.pendingStyle,
                  })),
                  flexDetached: state.flexDetached,
                  insertTarget: componentDiagnosticId(state.insertTarget),
                });
              }
              hideFlexInsertLine(state);
              clearCloneCursor();
              positionedToolDrag = null;
              try {
                editor.select(state.items.length === 1
                  ? state.items[0]?.component
                  : state.items.map((item) => item.component));
              } catch { /* ignore */ }
              // A clone-drag (Alt+drag copy) leaves the clone selected, but the
              // browser follows the pointerup with a click on the ORIGINAL
              // element — which would re-select it and drop the clone. Suppress
              // that trailing click whenever we moved the pointer (a zero-move
              // clone drag shouldn't swallow a legit tap-to-select). Also
              // suppress for flex-child drags so the trailing click doesn't
              // re-select the flex parent (plain click selects the container).
              if ((wasCloneDrag || !!state.flexChild) && didMove) suppressNextClick();
              refreshSelectionSnapshotRef.current?.();
              scheduleEmitRef.current?.();
              requestVisibleToolsRefresh();
            };

            const cancelPositionedToolDrag = () => {
              const state = positionedToolDrag;
              if (!state) return;
              positionedToolDrag = null;
              removePositionedDragGuide(state);
              hideFlexInsertLine(state);
              clearCloneCursor();
              if (state.items.some((item) => item.pendingStyle)) {
                for (const item of state.items) {
                  if (item.pendingStyle) commitComponentStyle(item.component, item.pendingStyle);
                }
                refreshSelectionSnapshotRef.current?.();
                scheduleEmitRef.current?.();
                requestVisibleToolsRefresh();
              }
            };
            let suppressClickAfterMarquee = false;
            // Suppress the synthetic click the browser fires after a pointer
            // drag (clone-drag, positioned-drag, multi-select resize). Without
            // this the trailing click re-selects the original element the drag
            // started on and clobbers the selection the drag end just committed
            // (e.g. the clone after an Alt+drag copy).
            const suppressNextClick = () => {
              suppressClickAfterMarquee = true;
              setTimeout(() => { suppressClickAfterMarquee = false; }, 0);
            };

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
              const targetEl = ev.target as Element | null;
              const canvasBodyEl = getCanvasBodyElFromEditor(editor);
              // True "blank canvas": the click landed on the iframe <body>
              // itself (no component under the cursor) OR resolved to the root
              // wrapper component (no parent). Only then deselect — a normal
              // non-flex element (rectangle, text) must NOT be deselected here.
              const clickedCanvasBody = !comp || (canvasBodyEl && targetEl === canvasBodyEl);
              const clickedRootWrapper = !!comp && !comp.parent?.();
              if (clickedCanvasBody || clickedRootWrapper) {
                try {
                  if (editor.getSelected?.()) {
                    ev.preventDefault();
                    ev.stopImmediatePropagation();
                    editor.select(undefined);
                  }
                } catch { /* ignore */ }
                return;
              }
              // Plain click selects the component actually under the cursor.
              // If the pointer is on a flex child (content), that child is
              // selected; if it lands on the flex container's own gap/padding
              // area, the container is selected (because that's the element
              // the pointer is on). Drilling into nested flex is via
              // double-click. This matches the new flex-child drag model.
              if (!comp) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
              // No event arg → avoids GrapesJS's Cmd/Shift multi-select branch.
              editor.select(comp);
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
              // The hover now tracks the actual child under the cursor (matching
              // the click-selects-child model). The dashed outline that used to
              // mark the child is redundant with the native hover box, so we no
              // longer tag a separate `od-flex-child-hover` element — let
              // GrapesJS's `.gjs-hovered` fall on the child directly.
              clearChildHover();
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
              // Single-click already selects the actual component under the
              // cursor (including flex children). Double-click now drills UP:
              // it selects the nearest flex ancestor, so nested flex containers
              // are reached by repeated double-clicks (child → parent flex →
              // grandparent flex …). This is the inverse of the old behavior
              // (where single-click selected the ancestor and dblclick entered).
              {
                const current = editor.getSelected?.();
                const flexAncestor = findNearestFlexAncestor(comp);
                if (flexAncestor && current !== flexAncestor) {
                  ev.preventDefault();
                  ev.stopImmediatePropagation();
                  editor.select(flexAncestor);
                  return;
                }
              }
              // No flex ancestor to drill up to: keep the current selection.
              ev.preventDefault();
              ev.stopImmediatePropagation();
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
            editor.on('component:selected', requestMultiSelectionOverlaySync);
            editor.on('component:deselected', requestMultiSelectionOverlaySync);
            editor.on('component:update', requestMultiSelectionOverlaySync);
            editor.on('styleUpdate', requestMultiSelectionOverlaySync);
            editor.on('canvas:tools:update', requestMultiSelectionOverlaySync);
            editor.on('canvas:zoom', requestMultiSelectionOverlaySync);
            editor.on('canvas:coords', requestMultiSelectionOverlaySync);
            requestMultiSelectionOverlaySync();
            doc.addEventListener('pointerdown', startMultiSelectionOverlayInteraction, true);
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
            doc.addEventListener('pointermove', updateMultiSelectionOverlayInteraction, true);
            hostDocument.addEventListener('pointermove', updateMultiSelectionOverlayInteraction, true);
            doc.addEventListener('pointerup', finishMultiSelectionOverlayInteraction, true);
            hostDocument.addEventListener('pointerup', finishMultiSelectionOverlayInteraction, true);
            doc.addEventListener('pointercancel', cancelMultiSelectionOverlayInteraction, true);
            hostDocument.addEventListener('pointercancel', cancelMultiSelectionOverlayInteraction, true);
            doc.addEventListener('pointermove', moveMarquee, true);
            doc.addEventListener('pointerup', finishMarquee, true);
            doc.addEventListener('pointercancel', cancelMarquee, true);
            detachNestedSelect = () => {
              try {
                editor.off('component:selected', requestMultiSelectionOverlaySync);
                editor.off('component:deselected', requestMultiSelectionOverlaySync);
                editor.off('component:update', requestMultiSelectionOverlaySync);
                editor.off('styleUpdate', requestMultiSelectionOverlaySync);
                editor.off('canvas:tools:update', requestMultiSelectionOverlaySync);
                editor.off('canvas:zoom', requestMultiSelectionOverlaySync);
                editor.off('canvas:coords', requestMultiSelectionOverlaySync);
                doc.removeEventListener('pointerdown', startMultiSelectionOverlayInteraction, true);
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
                doc.removeEventListener('pointermove', updateMultiSelectionOverlayInteraction, true);
                hostDocument.removeEventListener('pointermove', updateMultiSelectionOverlayInteraction, true);
                doc.removeEventListener('pointerup', finishMultiSelectionOverlayInteraction, true);
                hostDocument.removeEventListener('pointerup', finishMultiSelectionOverlayInteraction, true);
                doc.removeEventListener('pointercancel', cancelMultiSelectionOverlayInteraction, true);
                hostDocument.removeEventListener('pointercancel', cancelMultiSelectionOverlayInteraction, true);
                doc.removeEventListener('pointermove', moveMarquee, true);
                doc.removeEventListener('pointerup', finishMarquee, true);
                doc.removeEventListener('pointercancel', cancelMarquee, true);
                cancelPlacementInteraction();
                cancelMultiSelectionOverlayInteraction();
                cancelPositionedToolDrag();
                cancelMarquee();
                if (multiSelectionSyncRaf) {
                  window.cancelAnimationFrame(multiSelectionSyncRaf);
                  multiSelectionSyncRaf = 0;
                }
                try { multiSelectionOverlay?.remove(); } catch { /* ignore */ }
                multiSelectionOverlay = null;
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
            editor.on('component:paste', markInternalPaste);
            const handleImagePaste = async (ev: ClipboardEvent) => {
              if (readOnlyRef.current) return;
              if (!shouldHandleGrapesjsImagePaste({
                clipboardData: ev.clipboardData,
                lastInternalPasteAt,
                suppressImagePasteUntil: clipboardImagePasteSuppressedUntilRef.current,
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
                const node = pasteGrapesjsImageToSelection(editor, { dataUrl, width, height });
                if (node) refreshSelectionSnapshotRef.current?.();
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
            try { editor.off('load', exposeDiagnosticsToCanvasWindow); } catch { /* ignore */ }
            try { editor.off('canvas:frame:load:body', exposeDiagnosticsToCanvasWindow); } catch { /* ignore */ }
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
          const scheduleImmediateEmit = () => {
            if (emitTimer) clearTimeout(emitTimer);
            emitTimer = setTimeout(() => {
              emitTimer = null;
              emitChange();
            }, 150);
          };
          const scheduleEmit = () => {
            scheduleGrapesjsCutAwareEmit(cutEmitTimerRef, cutEmitPendingRef, scheduleImmediateEmit);
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
            const computedStyles = readElementStyles(el);
            const styles = mergeSelectionSnapshotStyles(
              computedStyles,
              getComponentStyleRecord(comp),
            );
            if (computedStyles.width) styles.__odComputedWidth = computedStyles.width;
            if (computedStyles.height) styles.__odComputedHeight = computedStyles.height;
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
            if (handleCanvasClipboardShortcut(ev)) return;
            if (handleCanvasArrangeShortcut(ev)) return;
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
        alignPositionedSelection: (mode: GrapesjsPositionAlignMode) => {
          const editor = editorRef.current;
          if (!editor) return false;
          const changed = alignGrapesjsPositionedSelection(editor, mode);
          if (!changed) return false;
          selectionColorCollectorRef.current.invalidate();
          refreshSelectionSnapshotRef.current?.();
          scheduleEmitRef.current?.();
          return true;
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
            pasteGrapesjsImageToSelection(editor, { dataUrl: src });
            refreshSelectionSnapshotRef.current?.();
            scheduleEmitRef.current?.();
          } catch { /* ignore */ }
        },
        insertIconComponent: (input: GrapesjsIconInsertInput) => {
          const editor = editorRef.current;
          if (!editor) return;
          try {
            insertGrapesjsIconComponent(editor, input);
            refreshSelectionSnapshotRef.current?.();
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
