/**
 * Pure functions, types, and constants extracted from FileViewer.tsx.
 *
 * This module has NO React component or hook dependencies — only types and
 * side-effect-free helpers shared across the viewer family.
 */

import type { CSSProperties } from 'react';

import { APP_CHROME_FILE_ACTIONS_ID, APP_CHROME_FILE_ACTIONS_SELECTOR } from './AppChromeHeader';
import {
  CLOUDFLARE_PAGES_PROVIDER_ID,
  DEFAULT_DEPLOY_PROVIDER_ID,
  type WebDeployProviderId,
  type WebDeploymentInfo,
} from '../providers/registry';
import type { ImageExportFormat } from '../runtime/exports';
import type { Dict } from '../i18n/types';
import { MANUAL_EDIT_STYLE_PROPS, type ManualEditStyles } from '../edit-mode/types';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function resolveChromeActionsHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>(APP_CHROME_FILE_ACTIONS_SELECTOR)
    ?? document.getElementById(APP_CHROME_FILE_ACTIONS_ID);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;
export type SlideState = { active: number; count: number };
export type BoardTool = 'inspect' | 'pod';
export type StrokePoint = { x: number; y: number };
export type ManualEditPendingStyleSave = {
  id: string;
  styles: Partial<ManualEditStyles>;
  label: string;
  version: number;
};
export type ManualEditViewportTransform = {
  x: number;
  y: number;
};
export type PreviewViewportId = 'desktop' | 'tablet' | 'mobile';
export type PreviewCanvasSize = {
  width: number;
  height: number;
  scrollLeft?: number;
  scrollTop?: number;
};
export type CommentPreviewCanvasOptions = {
  boardMode: boolean;
  sidePanelCollapsed: boolean;
  viewport?: PreviewViewportId;
};
export type PreviewScaleOptions = {
  canvasPadding?: number;
};
export type PreviewViewportPreset = {
  id: PreviewViewportId;
  width: number | null;
  height: number | null;
  labelKey: keyof Dict;
  titleKey: keyof Dict;
};
export type DeployProviderOption = {
  id: WebDeployProviderId;
  labelKey: 'fileViewer.vercelProvider' | 'fileViewer.cloudflarePagesProvider';
  tokenLink: string;
  tokenLinkKey: 'fileViewer.vercelTokenGetLink' | 'fileViewer.cloudflareApiTokenGetLink';
  tokenPlaceholderKey:
    | 'fileViewer.vercelTokenPlaceholder'
    | 'fileViewer.cloudflareApiTokenPlaceholder';
  tokenReuseHintKey: 'fileViewer.vercelTokenReuseHint' | 'fileViewer.cloudflareApiTokenReuseHint';
  tokenRequiredKey: 'fileViewer.vercelTokenRequired' | 'fileViewer.cloudflareApiTokenRequired';
  tokenLabelKey:
    | 'fileViewer.vercelToken'
    | 'fileViewer.cloudflareApiToken';
  accountIdLabelKey?: 'fileViewer.cloudflareAccountId';
  accountIdHintKey?: 'fileViewer.cloudflareAccountIdHint';
};
export type CloudflarePagesZoneOption = {
  id: string;
  name: string;
  status?: string;
  type?: string;
};
export type DeployResultCard = {
  id: string;
  label: string;
  url: string;
  status: string;
  message?: string;
};
export type InspectStyleSnapshot = {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontWeight?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  borderRadius?: string;
  textAlign?: string;
  fontFamily?: string;
  lineHeight?: string;
};
export type InspectClickedDescendant = {
  label: string;
  text: string;
};
export type InspectTarget = {
  elementId: string;
  selector: string;
  label: string;
  text: string;
  style: InspectStyleSnapshot;
  clickedDescendant?: InspectClickedDescendant;
};
export type PreviewOverlayTransform = { scale: number; offsetX: number; offsetY: number };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const IMAGE_EXPORT_FORMAT_OPTIONS: Array<{
  value: ImageExportFormat;
  label: string;
  extension: string;
}> = [
  { value: 'png', label: 'PNG', extension: '.png' },
  { value: 'jpeg', label: 'JPEG', extension: '.jpg' },
  { value: 'webp', label: 'WebP', extension: '.webp' },
];

export const MAX_BRIDGE_COORDINATE = 1_000_000;

export const PREVIEW_VIEWPORT_PRESETS: PreviewViewportPreset[] = [
  {
    id: 'desktop',
    width: 1920,
    height: 1080,
    labelKey: 'fileViewer.viewportDesktop',
    titleKey: 'fileViewer.viewportDesktopTitle',
  },
  {
    id: 'tablet',
    width: 820,
    height: 1180,
    labelKey: 'fileViewer.viewportTablet',
    titleKey: 'fileViewer.viewportTabletTitle',
  },
  {
    id: 'mobile',
    width: 390,
    height: 844,
    labelKey: 'fileViewer.viewportMobile',
    titleKey: 'fileViewer.viewportMobileTitle',
  },
];

export const EXPORT_READY_NUDGE_STORAGE_PREFIX = 'open-design:export-ready-nudge:';
export const COMMENT_SIDE_DOCK_WIDTH = 320;
export const COMMENT_SIDE_DOCK_RAIL_WIDTH = 42;
export const COMMENT_SIDE_DOCK_GAP = 12;
export const COMMENT_SIDE_DOCK_PADDING = 8;
export const COMMENT_SIDE_DOCK_NON_DESKTOP_PADDING = 24;
export const COMMENT_SIDE_DOCK_MIN_CANVAS_WIDTH = 280;
export const COMMENT_SIDE_DOCK_STACKED_PANEL_HEIGHT = 220;
export const COMMENT_SIDE_DOCK_STACKED_RAIL_HEIGHT = 48;
export const COMMENT_SIDE_DOCK_STACKED_HEIGHT_DEDUCTION =
  (COMMENT_SIDE_DOCK_PADDING * 2) + COMMENT_SIDE_DOCK_GAP + COMMENT_SIDE_DOCK_STACKED_PANEL_HEIGHT;
export const COMMENT_SIDE_DOCK_STACKED_COLLAPSED_HEIGHT_DEDUCTION =
  (COMMENT_SIDE_DOCK_PADDING * 2) + COMMENT_SIDE_DOCK_GAP + COMMENT_SIDE_DOCK_STACKED_RAIL_HEIGHT;

const MAX_CACHED_SLIDE_STATES = 64;
export const htmlPreviewSlideState = new Map<string, SlideState>();
const MAX_CACHED_PREVIEW_VIEWPORTS = 128;

// Grace window before the inspect hover card is torn down. Long enough to absorb
// the async iframe mouseout (od:comment-leave) that fires when the pointer slides
// onto the card or hops back onto the element under it, short enough to read as
// an immediate dismiss when the pointer really leaves.
export const HOVER_CARD_DISMISS_DELAY_MS = 80;

export const htmlPreviewViewportState = new Map<string, PreviewViewportId>();
export const MARKDOWN_CODE_BLOCK_ATTR = 'data-markdown-code-block';
export const MARKDOWN_COPY_BLOCK_ATTR = 'data-copy-code-block';
export const MARKDOWN_COPY_BUTTON_CLASS = 'markdown-code-copy';
export const MARKDOWN_COPY_TOAST_CLASS = 'markdown-code-toast';

export const DEPLOY_PROVIDER_OPTIONS: DeployProviderOption[] = [
  {
    id: DEFAULT_DEPLOY_PROVIDER_ID,
    labelKey: 'fileViewer.vercelProvider',
    tokenLink: 'https://vercel.com/account/settings/tokens',
    tokenLinkKey: 'fileViewer.vercelTokenGetLink',
    tokenPlaceholderKey: 'fileViewer.vercelTokenPlaceholder',
    tokenReuseHintKey: 'fileViewer.vercelTokenReuseHint',
    tokenRequiredKey: 'fileViewer.vercelTokenRequired',
    tokenLabelKey: 'fileViewer.vercelToken',
  },
  {
    id: CLOUDFLARE_PAGES_PROVIDER_ID,
    labelKey: 'fileViewer.cloudflarePagesProvider',
    tokenLink: 'https://dash.cloudflare.com/profile/api-tokens',
    tokenLinkKey: 'fileViewer.cloudflareApiTokenGetLink',
    tokenPlaceholderKey: 'fileViewer.cloudflareApiTokenPlaceholder',
    tokenReuseHintKey: 'fileViewer.cloudflareApiTokenReuseHint',
    tokenRequiredKey: 'fileViewer.cloudflareApiTokenRequired',
    tokenLabelKey: 'fileViewer.cloudflareApiToken',
    accountIdLabelKey: 'fileViewer.cloudflareAccountId',
    accountIdHintKey: 'fileViewer.cloudflareAccountIdHint',
  },
];

// ---------------------------------------------------------------------------
// Manual-edit style helpers
// ---------------------------------------------------------------------------

export function mergeManualEditInspectorStyles(
  sourceStyles: ManualEditStyles,
  previewStyles: ManualEditStyles,
): ManualEditStyles {
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    const sourceValue = sourceStyles[key]?.trim();
    const previewValue = previewStyles[key]?.trim();
    const value = sourceValue || previewValue || '';
    acc[key] = manualEditInspectorStyleValue(key, value);
    return acc;
  }, {} as ManualEditStyles);
}

export function manualEditInspectorStyleValue(key: keyof ManualEditStyles, value: string): string {
  if (!value) return '';
  if (key === 'color' || key === 'backgroundColor' || key === 'borderColor') {
    return normalizeManualEditInspectorColor(value);
  }
  return value;
}

export function normalizeManualEditInspectorColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgba = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!rgba) return trimmed;
  if (rgba[4] !== undefined && Number(rgba[4]) === 0) return '';
  const toHex = (raw: string) => Math.max(0, Math.min(255, Math.round(Number(raw))))
    .toString(16)
    .padStart(2, '0');
  return `#${toHex(rgba[1]!)}${toHex(rgba[2]!)}${toHex(rgba[3]!)}`;
}

export function manualEditPersistedValueMatchesSavedSnapshot(
  key: keyof ManualEditStyles,
  persistedValue: string,
  savedValue: string,
): boolean {
  return canonicalManualEditStyleValue(key, persistedValue) === canonicalManualEditStyleValue(key, savedValue);
}

export function canonicalManualEditStyleValue(key: keyof ManualEditStyles, value: string): string {
  const normalized = manualEditInspectorStyleValue(key, value).trim();
  if (!normalized) return '';
  return normalized.toLowerCase();
}

// ---------------------------------------------------------------------------
// Deploy helpers
// ---------------------------------------------------------------------------

export function getDeployProviderOption(providerId: WebDeployProviderId): DeployProviderOption {
  return DEPLOY_PROVIDER_OPTIONS.find((option) => option.id === providerId) ?? DEPLOY_PROVIDER_OPTIONS[0]!;
}

export function normalizeCloudflareDomainPrefixInput(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidCloudflareDomainPrefixInput(raw: string): boolean {
  const prefix = normalizeCloudflareDomainPrefixInput(raw);
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(prefix);
}

export function deployResultState(status?: string): 'ready' | 'delayed' | 'protected' | 'failed' {
  if (status === 'protected') return 'protected';
  if (status === 'failed' || status === 'conflict') return 'failed';
  if (status === 'link-delayed' || status === 'pending') return 'delayed';
  return 'ready';
}

export function publicShareUrlForDeployment(deployment?: WebDeploymentInfo | null): string {
  if (!deployment) return '';
  const cloudflare = deployment.cloudflarePages;
  const customDomainUrl = cloudflare?.customDomain?.status === 'ready'
    ? cloudflare.customDomain.url?.trim()
    : '';
  if (customDomainUrl) return customDomainUrl;
  const pagesDevUrl = cloudflare?.pagesDev?.status === 'ready'
    ? cloudflare.pagesDev.url?.trim()
    : '';
  if (pagesDevUrl) return pagesDevUrl;
  return deployResultState(deployment.status) === 'ready'
    ? deployment.url?.trim() || ''
    : '';
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
      if (priorFocus?.isConnected) {
        try {
          priorFocus.focus({ preventScroll: true });
        } catch {
          priorFocus.focus();
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

export function decorateMarkdownCodeBlocks(html: string): string {
  let blockIndex = 0;
  return html.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/g, (_match, attrs: string, content: string) => {
    const blockId = String(blockIndex++);
    return `<div class="markdown-code-block" ${MARKDOWN_CODE_BLOCK_ATTR}="${blockId}"><pre${attrs}>${content}</pre></div>`;
  });
}

export function setMarkdownCodeBlockCopiedState(block: HTMLElement, copied: boolean, t: TranslateFn) {
  const button = block.querySelector<HTMLButtonElement>(`.${MARKDOWN_COPY_BUTTON_CLASS}`);
  if (!button) return;
  const label = copied ? t('fileViewer.copied') : t('fileViewer.copy');
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.title = t('fileViewer.copyTitle');

  const existingToast = block.querySelector(`.${MARKDOWN_COPY_TOAST_CLASS}`);
  if (copied) {
    if (existingToast instanceof HTMLElement) {
      existingToast.textContent = t('fileViewer.copied');
      return;
    }
    const toast = document.createElement('span');
    toast.className = MARKDOWN_COPY_TOAST_CLASS;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = t('fileViewer.copied');
    button.insertAdjacentElement('afterend', toast);
    return;
  }

  existingToast?.remove();
}

export function ensureMarkdownCodeBlockControls(root: HTMLElement, t: TranslateFn) {
  for (const block of root.querySelectorAll<HTMLElement>(`[${MARKDOWN_CODE_BLOCK_ATTR}]`)) {
    let button = block.querySelector<HTMLButtonElement>(`.${MARKDOWN_COPY_BUTTON_CLASS}`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = MARKDOWN_COPY_BUTTON_CLASS;
      const blockId = block.getAttribute(MARKDOWN_CODE_BLOCK_ATTR) ?? '';
      button.setAttribute(MARKDOWN_COPY_BLOCK_ATTR, blockId);
      block.prepend(button);
    }
    setMarkdownCodeBlockCopiedState(block, false, t);
  }
}

// ---------------------------------------------------------------------------
// Preview layout helpers
// ---------------------------------------------------------------------------

export function previewViewportStyle(
  viewport: PreviewViewportId,
  previewScale = 1,
  canvasSize?: PreviewCanvasSize,
  options?: PreviewScaleOptions,
  overrideSize?: { width: number; height: number },
): CSSProperties & Record<string, string | number> {
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport) ?? PREVIEW_VIEWPORT_PRESETS[0]!;
  if (!preset.width) return {};
  const effectiveScale = effectivePreviewScale(viewport, previewScale, canvasSize, options);
  const width = overrideSize?.width ?? preset.width;
  const height = overrideSize?.height ?? preset.height;
  return {
    '--preview-viewport-width': `${width}px`,
    '--preview-viewport-height': `${height}px`,
    '--preview-scale': effectiveScale,
    '--preview-user-scale': previewScale,
  };
}

export function commentPreviewCanvasSize(
  canvasSize: PreviewCanvasSize | undefined,
  options: CommentPreviewCanvasOptions,
): PreviewCanvasSize | undefined {
  if (!canvasSize || !options.boardMode) return canvasSize;
  const dockPadding = options.viewport && options.viewport !== 'desktop'
    ? COMMENT_SIDE_DOCK_NON_DESKTOP_PADDING
    : COMMENT_SIDE_DOCK_PADDING;
  const sideDockWidth = options.sidePanelCollapsed ? COMMENT_SIDE_DOCK_RAIL_WIDTH : COMMENT_SIDE_DOCK_WIDTH;
  const dockedWidth = canvasSize.width - (dockPadding * 2) - COMMENT_SIDE_DOCK_GAP - sideDockWidth;
  if (usesStackedCommentSideDock(canvasSize, options)) {
    const stackedHeightDeduction = options.sidePanelCollapsed
      ? COMMENT_SIDE_DOCK_STACKED_COLLAPSED_HEIGHT_DEDUCTION
      : COMMENT_SIDE_DOCK_STACKED_HEIGHT_DEDUCTION;
    return {
      width: Math.max(1, canvasSize.width - (COMMENT_SIDE_DOCK_PADDING * 2)),
      height: Math.max(1, canvasSize.height - stackedHeightDeduction),
    };
  }
  return {
    width: Math.max(1, dockedWidth),
    height: Math.max(1, canvasSize.height - (dockPadding * 2)),
  };
}

export function usesStackedCommentSideDock(
  canvasSize: PreviewCanvasSize | undefined,
  options: CommentPreviewCanvasOptions,
) {
  if (!canvasSize || !options.boardMode) return false;
  const dockPadding = options.viewport && options.viewport !== 'desktop'
    ? COMMENT_SIDE_DOCK_NON_DESKTOP_PADDING
    : COMMENT_SIDE_DOCK_PADDING;
  const sideDockWidth = options.sidePanelCollapsed ? COMMENT_SIDE_DOCK_RAIL_WIDTH : COMMENT_SIDE_DOCK_WIDTH;
  const dockedWidth = canvasSize.width - (dockPadding * 2) - COMMENT_SIDE_DOCK_GAP - sideDockWidth;
  return dockedWidth < COMMENT_SIDE_DOCK_MIN_CANVAS_WIDTH;
}

export function effectivePreviewScale(
  viewport: PreviewViewportId,
  previewScale: number,
  canvasSize?: PreviewCanvasSize,
  options?: PreviewScaleOptions,
) {
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport);
  if (!preset?.width || !preset.height || !canvasSize?.width || !canvasSize.height) return previewScale;
  const canvasPadding = viewport === 'desktop' ? 0 : (options?.canvasPadding ?? 48);
  const availableWidth = Math.max(1, canvasSize.width - canvasPadding);
  const availableHeight = Math.max(1, canvasSize.height - canvasPadding);
  const fitScale = Math.min(1, availableWidth / preset.width, availableHeight / preset.height);
  if (viewport === 'desktop') {
    // For desktop, auto-fit 1920x1080 into the container.
    // User zoom is applied relative to the fit scale.
    return fitScale * previewScale;
  }
  return Math.min(previewScale, fitScale);
}

export function previewOverlayTransform(
  viewport: PreviewViewportId,
  previewScale: number,
  canvasSize?: PreviewCanvasSize,
): PreviewOverlayTransform {
  const scale = effectivePreviewScale(viewport, previewScale, canvasSize);
  if (viewport === 'desktop') return { scale, offsetX: 0, offsetY: 0 };
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport);
  const pad = 24;
  if (!preset?.width || !preset.height) return { scale, offsetX: pad, offsetY: pad };
  const availableWidth = Math.max(1, (canvasSize?.width ?? preset.width * scale + pad * 2) - pad * 2);
  const scaledWidth = preset.width * scale;
  return {
    scale,
    offsetX: pad + Math.max(0, (availableWidth - scaledWidth) / 2),
    offsetY: pad,
  };
}

export function previewScaleShellStyle(
  viewport: PreviewViewportId,
  previewScale: number,
): CSSProperties & Record<string, string | number> {
  // All viewports use the same CSS-variable approach so the iframe
  // always renders at its natural viewport size (e.g. 1920x1080 for
  // desktop) and the CSS transform scales it to fit.
  return {
    width: 'var(--preview-viewport-width)',
    height: 'var(--preview-viewport-height)',
    transform: 'scale(var(--preview-scale, 1))',
    transformOrigin: '0 0',
  };
}

/**
 * Computes the auto-fit zoom and centering translate for desktop edit mode.
 * The returned translate is measured in screen pixels and is applied before
 * compositor scale, so panning remains 1:1 at every zoom level.
 */
export function desktopEditAutoFitTransform(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
  userScale: number,
  panOffset: ManualEditViewportTransform,
): { zoom: number; translateX: number; translateY: number } {
  return manualEditAutoFitTransform(
    containerWidth,
    containerHeight,
    contentWidth,
    contentHeight,
    userScale,
    panOffset,
  );
}

export function manualEditAutoFitTransform(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
  userScale: number,
  panOffset: ManualEditViewportTransform,
  canvasPadding = 0,
): { zoom: number; translateX: number; translateY: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
    return { zoom: 1, translateX: 0, translateY: 0 };
  }
  const availableWidth = Math.max(1, containerWidth - canvasPadding);
  const availableHeight = Math.max(1, containerHeight - canvasPadding);
  const fitScale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);
  const effectiveZoom = fitScale * userScale;
  const scaledWidth = contentWidth * effectiveZoom;
  const scaledHeight = contentHeight * effectiveZoom;
  const centerX = Math.max(0, (containerWidth - scaledWidth) / 2);
  const centerY = Math.max(0, (containerHeight - scaledHeight) / 2);
  return {
    zoom: effectiveZoom,
    translateX: centerX + panOffset.x,
    translateY: centerY + panOffset.y,
  };
}

export function manualEditZoomPanAtPoint({
  anchor,
  currentPan,
  currentUserScale,
  nextUserScale,
  container,
  content,
  canvasPadding = 0,
}: {
  anchor: ManualEditViewportTransform;
  currentPan: ManualEditViewportTransform;
  currentUserScale: number;
  nextUserScale: number;
  container: { width: number; height: number };
  content: { width: number; height: number };
  canvasPadding?: number;
}): ManualEditViewportTransform {
  const current = manualEditAutoFitTransform(
    container.width,
    container.height,
    content.width,
    content.height,
    currentUserScale,
    currentPan,
    canvasPadding,
  );
  const nextBase = manualEditAutoFitTransform(
    container.width,
    container.height,
    content.width,
    content.height,
    nextUserScale,
    { x: 0, y: 0 },
    canvasPadding,
  );
  if (current.zoom <= 0 || nextBase.zoom <= 0) return currentPan;
  const contentX = (anchor.x - current.translateX) / current.zoom;
  const contentY = (anchor.y - current.translateY) / current.zoom;
  return {
    x: anchor.x - nextBase.translateX - contentX * nextBase.zoom,
    y: anchor.y - nextBase.translateY - contentY * nextBase.zoom,
  };
}

export function manualEditPanFromPointer(
  startPan: ManualEditViewportTransform,
  startPoint: ManualEditViewportTransform,
  currentPoint: ManualEditViewportTransform,
): ManualEditViewportTransform {
  return {
    x: startPan.x + currentPoint.x - startPoint.x,
    y: startPan.y + currentPoint.y - startPoint.y,
  };
}

export function manualEditPreviewShellStyle(
  viewport: PreviewViewportId,
  previewScale: number,
  viewportTransform: ManualEditViewportTransform = { x: 0, y: 0 },
  canvasSize?: PreviewCanvasSize,
  overrideSize?: { width: number; height: number },
  rasterScale = previewScale,
): CSSProperties & Record<string, string | number> {
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport);
  const contentWidth = viewport === 'desktop'
    ? overrideSize?.width ?? preset?.width ?? 1920
    : preset?.width ?? 390;
  const contentHeight = viewport === 'desktop'
    ? overrideSize?.height ?? preset?.height ?? 1080
    : preset?.height ?? 844;
  const canvasPadding = viewport === 'desktop' ? 0 : 48;
  const safeRasterScale =
    Number.isFinite(rasterScale) && rasterScale > 0
      ? rasterScale
      : previewScale;
  const liveLayout = canvasSize?.width && canvasSize.height
    ? manualEditAutoFitTransform(
        canvasSize.width,
        canvasSize.height,
        contentWidth,
        contentHeight,
        previewScale,
        viewportTransform,
        canvasPadding,
      )
    : null;
  const rasterLayout = canvasSize?.width && canvasSize.height
    ? manualEditAutoFitTransform(
        canvasSize.width,
        canvasSize.height,
        contentWidth,
        contentHeight,
        safeRasterScale,
        { x: 0, y: 0 },
        canvasPadding,
      )
    : null;
  if (liveLayout && rasterLayout) {
    const rasterZoom = rasterLayout.zoom > 0 ? rasterLayout.zoom : liveLayout.zoom;
    return {
      width: 'var(--preview-viewport-width)',
      height: 'var(--preview-viewport-height)',
      zoom: rasterZoom,
      transform: `translate(${liveLayout.translateX / rasterZoom}px, ${liveLayout.translateY / rasterZoom}px) scale(${liveLayout.zoom / rasterZoom})`,
      transformOrigin: '0 0',
      willChange: 'transform',
    };
  }
  const rasterZoom = safeRasterScale > 0 ? safeRasterScale : 1;
  return {
    width: 'var(--preview-viewport-width)',
    height: 'var(--preview-viewport-height)',
    zoom: rasterZoom,
    transform: `translate(${viewportTransform.x / rasterZoom}px, ${viewportTransform.y / rasterZoom}px) scale(${previewScale / rasterZoom})`,
    transformOrigin: '0 0',
    willChange: 'transform',
  };
}

export function manualEditFloatingPanelStyle(
  target: import('../edit-mode/types').ManualEditTarget,
  previewScale: number,
  canvasSize: PreviewCanvasSize | undefined,
): CSSProperties {
  const scale = Number.isFinite(previewScale) && previewScale > 0 ? previewScale : 1;
  const panelWidth = 320;
  const preferredPanelHeight = 380;
  const pad = 12;
  const canvasWidth = canvasSize?.width ?? 1200;
  const canvasHeight = canvasSize?.height ?? 800;
  const panelHeight = Math.min(preferredPanelHeight, Math.max(260, canvasHeight - pad * 2));
  const targetLeft = target.rect.x * scale;
  const targetTop = target.rect.y * scale;
  const targetRight = (target.rect.x + target.rect.width) * scale;
  let left = targetRight + pad;
  if (left + panelWidth > canvasWidth - pad) {
    left = Math.max(pad, targetLeft - panelWidth - pad);
  }
  const top = Math.max(
    pad,
    Math.min(targetTop, Math.max(pad, canvasHeight - panelHeight - pad)),
  );
  return {
    left,
    top,
    width: panelWidth,
    maxHeight: panelHeight,
  };
}

export function manualEditHoverIconStyle(
  target: import('../edit-mode/types').ManualEditTarget,
  previewScale: number,
  canvasSize: PreviewCanvasSize | undefined,
): CSSProperties {
  const scale = Number.isFinite(previewScale) && previewScale > 0 ? previewScale : 1;
  const iconSize = 26;
  const inset = 4;
  const canvasWidth = canvasSize?.width ?? 1200;
  const canvasHeight = canvasSize?.height ?? 800;
  const targetTop = target.rect.y * scale;
  const targetRight = (target.rect.x + target.rect.width) * scale;
  const left = Math.max(
    inset,
    Math.min(targetRight - iconSize - inset, canvasWidth - iconSize - inset),
  );
  const top = Math.max(
    inset,
    Math.min(targetTop + inset, canvasHeight - iconSize - inset),
  );
  return { left, top, width: iconSize, height: iconSize };
}

export function cancelManualEditPendingStyleSnapshot(
  pending: ManualEditPendingStyleSave | null,
  id: string,
  keys: Array<keyof ManualEditStyles>,
): ManualEditPendingStyleSave | null {
  if (!pending || pending.id !== id || keys.length === 0) return pending;
  const nextStyles = { ...pending.styles };
  for (const key of keys) delete nextStyles[key];
  if (Object.keys(nextStyles).length === 0) return null;
  return { ...pending, styles: nextStyles };
}

// ---------------------------------------------------------------------------
// Slide & viewport caching
// ---------------------------------------------------------------------------

export function setSlideStateCached(key: string, state: SlideState) {
  htmlPreviewSlideState.set(key, state);
  if (htmlPreviewSlideState.size > MAX_CACHED_SLIDE_STATES) {
    const oldest = htmlPreviewSlideState.keys().next().value;
    if (oldest != null) htmlPreviewSlideState.delete(oldest);
  }
}

export function previewViewportStateKey(projectId: string, file: { name: string; path?: string }): string {
  return `${projectId}:${file.path || file.name}`;
}

export function setPreviewViewportCached(key: string, viewport: PreviewViewportId) {
  htmlPreviewViewportState.set(key, viewport);
  if (htmlPreviewViewportState.size > MAX_CACHED_PREVIEW_VIEWPORTS) {
    const oldest = htmlPreviewViewportState.keys().next().value;
    if (oldest != null) htmlPreviewViewportState.delete(oldest);
  }
}

const OD_CANVAS_META_REGEX = /<meta\s+name=["']od-canvas["']\s+content=["']width=(\d+),height=(\d+)["']\s*\/?>/;

export function readCanvasSizeFromSource(source: string): { width: number; height: number } | null {
  const match = source.match(OD_CANVAS_META_REGEX);
  if (!match || !match[1] || !match[2]) return null;
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export function writeCanvasSizeToSource(source: string, size: { width: number; height: number }): string {
  const metaTag = `<meta name="od-canvas" content="width=${size.width},height=${size.height}">`;
  if (OD_CANVAS_META_REGEX.test(source)) {
    return source.replace(OD_CANVAS_META_REGEX, metaTag);
  }
  if (source.includes('</head>')) {
    return source.replace('</head>', `  ${metaTag}\n</head>`);
  }
  if (source.includes('<head>')) {
    return source.replace('<head>', `<head>\n  ${metaTag}`);
  }
  return `<head>${metaTag}</head>` + source;
}

// ---------------------------------------------------------------------------
// Deploy URL / metadata helpers
// ---------------------------------------------------------------------------

export function deploymentTimestamp(deployment: WebDeploymentInfo): number {
  const maybeDeployedAt = (deployment as WebDeploymentInfo & { deployedAt?: number | string }).deployedAt;
  const candidates = [maybeDeployedAt, deployment.updatedAt, deployment.createdAt];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string') {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

export function compareDeploymentsByNewest(a: WebDeploymentInfo, b: WebDeploymentInfo): number {
  return deploymentTimestamp(b) - deploymentTimestamp(a);
}

export function shareUrlForDeployment(deployment: WebDeploymentInfo): string {
  const customDomain = deployment.providerId === CLOUDFLARE_PAGES_PROVIDER_ID
    ? deployment.cloudflarePages?.customDomain
    : undefined;
  if (customDomain?.status === 'ready' && customDomain.url?.trim()) {
    return customDomain.url.trim();
  }
  return deployment.url?.trim() || '';
}

export function resolveShareUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (typeof window === 'undefined') return trimmed;
  return new URL(trimmed, window.location.origin).toString();
}

export function pickLatestShareDeployment(
  deploymentsByProvider: Partial<Record<WebDeployProviderId, WebDeploymentInfo>>,
): WebDeploymentInfo | null {
  return Object.values(deploymentsByProvider)
    .filter((deployment): deployment is WebDeploymentInfo =>
      Boolean(deployment && shareUrlForDeployment(deployment) && deployResultState(deployment.status) !== 'failed'))
    .sort(compareDeploymentsByNewest)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Iframe helpers
// ---------------------------------------------------------------------------

export function waitForIframeLoadOrTimeout(iframe: HTMLIFrameElement, timeout = 750): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      iframe.removeEventListener('load', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeout);
    iframe.addEventListener('load', finish, { once: true });
  });
}
