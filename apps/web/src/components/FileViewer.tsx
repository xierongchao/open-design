import { Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent as ReactUIEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input, Select } from '@open-design/components';
import { detectOpenDesignHostClientType } from '@open-design/host';
import { EditableCodeViewer } from './EditableCodeViewer';
import { EditorDiagnosticsRecorderButton } from './EditorDiagnosticsRecorderButton';
import {
  emptyManualEditSourceRoundTrip,
  enterManualEditSourceRoundTrip,
  markManualEditLocalSave,
  reconcileManualEditSourceRoundTrip,
} from './html-editor-source-roundtrip';
import { createHtmlFileSaveController, type HtmlFileSaveReason } from './html-file-save-controller';
import type { GrapesjsCanvasTool, GrapesjsEditorHandle, SelectionSnapshot } from './grapesjs';
import { StylePanel } from './grapesjs';
import { GRAPESJS_SHORTCUT_GROUPS, type GrapesjsShortcutGroupId } from './grapesjs/shortcuts';
import {
  GRAPESJS_ICON_LIBRARIES,
  GRAPESJS_ICON_PAGE_SIZE,
  GRAPESJS_REMOTE_ICON_PAGE_SIZE,
  buildIconifySearchUrl,
  iconifySearchResultsToIcons,
  visibleGrapesjsIconPage,
  type GrapesjsIconDefinition,
  type GrapesjsIconLibraryId,
  type GrapesjsIconVariant,
} from './grapesjs/icon-library';
import {
  applyPreviewStyle,
  persistStyleOverride,
} from './grapesjs/grapesjs-bridge-adapter';
import { createGrapesjsSelectionStore } from './grapesjs/grapesjs-selection-store';
import {
  buildSocialSharePayload,
  OPEN_DESIGN_GITHUB_REPO_URL,
  type SocialShareRequest,
  type SocialShareResponse,
} from '@open-design/contracts';
import {
  anonymizeArtifactId,
  artifactKindToTracking,
  type TrackingProjectKind,
} from '@open-design/contracts/analytics';
import { useAnalytics } from '../analytics/provider';
import { trackIframeLoad } from '../observability/iframe-error';
import {
  trackArtifactExportResult,
  trackArtifactHeaderClick,
  trackArtifactToolbarClick,
  trackCommentPopoverClick,
  trackPageView,
  trackPresentPopoverClick,
  trackShareOptionPopoverClick,
} from '../analytics/events';
import { MarkdownRenderer, artifactRendererRegistry } from '../artifacts/renderer-registry';
import { renderMarkdownToSafeHtml } from '../artifacts/markdown';
import { useT, useI18n } from '../i18n';
import type { Dict, Locale } from '../i18n/types';
import {
  fetchLiveArtifact,
  fetchLiveArtifactCode,
  fetchLiveArtifactRefreshes,
  checkDeploymentLink,
  CLOUDFLARE_PAGES_PROVIDER_ID,
  createSocialSharePayload,
  DEFAULT_DEPLOY_PROVIDER_ID,
  deployProjectFile,
  fetchCloudflarePagesZones,
  fetchDeployConfig,
  fetchProjectDeployments,
  fetchProjectFilePreview,
  fetchProjectFiles,
  fetchProjectFileText,
  uploadProjectFiles,
  liveArtifactPreviewUrl,
  projectFileUrl,
  projectRawUrl,
  LiveArtifactRefreshError,
  refreshLiveArtifact,
  updateDeployConfig,
  type WebDeployConfigResponse,
  type WebCloudflarePagesDeploySelection,
  type WebDeploymentInfo,
  type WebDeployProjectFileResponse,
  type WebDeployProviderId,
  type WebUpdateDeployConfigRequest,
} from '../providers/registry';
import type { ProjectFilePreview } from '../providers/registry';
import {
  downloadImageDataUrl,
  exportAsHtml,
  exportAsJsx,
  exportAsMd,
  exportAsPdf,
  exportProjectAsPdf,
  exportProjectAsZip,
  copyImageDataUrlToClipboard,
  exportReactComponentAsHtml,
  exportReactComponentAsZip,
  captureHostIframeSnapshot,
  captureHostRegionSnapshot,
  imageDataUrlToBlob,
  openSandboxedPreviewInNewTab,
  prepareImageExportTarget,
  requestPreviewSnapshot,
  type ImageExportFormat,
} from '../runtime/exports';
import { copyToClipboard } from '../lib/copy-to-clipboard';
import { buildReactComponentSrcdoc } from '../runtime/react-component';
import { shouldConsumeSlideNav } from '../runtime/slide-nav';
import { findHtmlEntriesReferencing } from '../runtime/jsx-module-refs';
import { buildLazySrcdocTransport, buildSrcdoc, canActivateSrcDocTransport } from '../runtime/srcdoc';
import { isMacPlatform } from '../utils/platform';
import {
  hasTweaksTemplate,
  hasUrlModeBridge,
  htmlHasRuntimeScript,
  htmlNeedsFocusGuard,
  htmlNeedsSandboxShim,
  parseForceInline,
  shouldUrlLoadHtmlPreview,
  shouldUseGrapesjs,
} from './file-viewer-render-mode';
import { saveTemplate } from '../state/projects';
import type {
  LiveArtifactEventItem,
  LiveArtifact,
  LiveArtifactRefreshLogEntry,
  LiveArtifactViewerTab,
  LiveArtifactWorkspaceEntry,
  ProjectFile,
} from '../types';
import { Icon } from './Icon';
import { RemixIcon } from './RemixIcon';
import { SocialShareGrid } from './SocialShareGrid';
import { Toast } from './Toast';
import { PreviewDrawOverlay } from './PreviewDrawOverlay';
import {
  buildBoardCommentAttachments,
  commentSnapshotEqual,
  commentTargetDisplayName,
  commentVisibleOnDeckSlide,
  commentsToAttachments,
  isValidCommentOverlayPosition,
  liveCommentTargetMapsEqual,
  liveSnapshotForComment,
  overlayBoundsFromSnapshot,
  selectionKindLabel,
  targetFromSnapshot,
  type PreviewCommentSnapshot,
} from '../comments';
import { applyPodMemberRemoval } from '../lib/pod-members';
import { AnnotationHoverPopover, BoardComposerPopover } from './BoardComposerPopover';
import {
  OD_PREVIEW_KEEP_ALIVE,
  PooledIframe,
  previewIframeKeepAliveKey,
} from './IframeKeepAlivePool';
import type {
  ChatCommentAttachment,
  PreviewComment,
  PreviewCommentAttachment,
  PreviewCommentMember,
  PreviewCommentTarget,
} from '../types';
import { ManualEditPanel, emptyManualEditDraft, type ManualEditDraft } from './ManualEditPanel';
import {
  applyManualEditPatch,
  isManualEditFullHtmlDocument,
  readManualEditAttributes,
  readManualEditFields,
  readManualEditOuterHtml,
  readManualEditStyles,
} from '../edit-mode/source-patches';
import { MANUAL_EDIT_STYLE_PROPS, type ManualEditBridgeMessage, type ManualEditHistoryEntry, type ManualEditPatch, type ManualEditStyles, type ManualEditTarget } from '../edit-mode/types';
import { isRenderableSketchJson, SketchPreview } from './SketchPreview';
import {
  type BoardTool,
  type CommentPreviewCanvasOptions,
  type DeployProviderOption,
  type DeployResultCard,
  type CloudflarePagesZoneOption,
  type InspectClickedDescendant,
  type InspectStyleSnapshot,
  type InspectTarget,
  type ManualEditPendingStyleSave,
  type ManualEditViewportTransform,
  type PreviewCanvasSize,
  type PreviewOverlayTransform,
  type PreviewScaleOptions,
  type PreviewViewportId,
  type PreviewViewportPreset,
  type SlideState,
  type StrokePoint,
  type TranslateFn,
  COMMENT_SIDE_DOCK_GAP,
  COMMENT_SIDE_DOCK_MIN_CANVAS_WIDTH,
  COMMENT_SIDE_DOCK_NON_DESKTOP_PADDING,
  COMMENT_SIDE_DOCK_PADDING,
  COMMENT_SIDE_DOCK_RAIL_WIDTH,
  COMMENT_SIDE_DOCK_STACKED_COLLAPSED_HEIGHT_DEDUCTION,
  COMMENT_SIDE_DOCK_STACKED_HEIGHT_DEDUCTION,
  COMMENT_SIDE_DOCK_WIDTH,
  DEPLOY_PROVIDER_OPTIONS,
  EXPORT_READY_NUDGE_STORAGE_PREFIX,
  HOVER_CARD_DISMISS_DELAY_MS,
  IMAGE_EXPORT_FORMAT_OPTIONS,
  MARKDOWN_CODE_BLOCK_ATTR,
  MARKDOWN_COPY_BLOCK_ATTR,
  MARKDOWN_COPY_BUTTON_CLASS,
  MARKDOWN_COPY_TOAST_CLASS,
  MAX_BRIDGE_COORDINATE,
  PREVIEW_VIEWPORT_PRESETS,
  cancelManualEditPendingStyleSnapshot,
  canonicalManualEditStyleValue,
  commentPreviewCanvasSize,
  compareDeploymentsByNewest,
  copyTextToClipboard,
  decorateMarkdownCodeBlocks,
  deployResultState,
  desktopEditAutoFitTransform,
  effectivePreviewScale,
  ensureMarkdownCodeBlockControls,
  getDeployProviderOption,
  htmlPreviewSlideState,
  htmlPreviewViewportState,
  isValidCloudflareDomainPrefixInput,
  manualEditFloatingPanelStyle,
  manualEditHoverIconStyle,
  manualEditInspectorStyleValue,
  manualEditAutoFitTransform,
  manualEditPanFromPointer,
  manualEditPersistedValueMatchesSavedSnapshot,
  manualEditPreviewShellStyle,
  manualEditZoomPanAtPoint,
  mergeManualEditInspectorStyles,
  normalizeCloudflareDomainPrefixInput,
  pickLatestShareDeployment,
  previewOverlayTransform,
  publicShareUrlForDeployment,
  previewScaleShellStyle,
  previewViewportStateKey,
  previewViewportStyle,
  resolveChromeActionsHost,
  resolveShareUrl,
  setMarkdownCodeBlockCopiedState,
  setPreviewViewportCached,
  readArtboardNameFromSource,
  readCanvasSizeFromSource,
  readViewportPresetFromSource,
  writeArtboardNameToSource,
  writeCanvasSizeToSource,
  setSlideStateCached,
  shareUrlForDeployment,
  deploymentTimestamp,
  usesStackedCommentSideDock,
  waitForIframeLoadOrTimeout,
} from './viewer-utils';

const GrapesjsEditor = lazy(() => import('./grapesjs/GrapesjsEditor').then((m) => ({ default: m.default })));
const GRAPESJS_SOURCE_STATE_SYNC_DELAY_MS = 500;
const GRAPESJS_DEFAULT_ICON_COLOR = '#000000';

function GrapesjsIconLibraryPreview({
  icon,
  size = 24,
  color,
  strokeWidth,
  variant,
}: {
  icon: GrapesjsIconDefinition;
  size?: number;
  color: string;
  strokeWidth: number;
  variant: GrapesjsIconVariant;
}) {
  if (icon.remoteSvgUrl) {
    return (
      <span
        aria-hidden="true"
        className="grapesjs-icon-library-remote-preview"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          WebkitMaskImage: `url("${icon.remoteSvgUrl}")`,
          maskImage: `url("${icon.remoteSvgUrl}")`,
        }}
      />
    );
  }
  const fill = variant === 'fill' ? color : 'none';
  const stroke = variant === 'fill' ? 'none' : color;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={icon.path} />
    </svg>
  );
}

function previewViewportIcon(viewport: PreviewViewportId): string {
  if (viewport === 'tablet') return 'tablet-line';
  if (viewport === 'mobile') return 'smartphone-line';
  return 'computer-line';
}

function htmlEditModeLabel(previewLabel: string): string {
  if (previewLabel === '预览' || previewLabel === '預覽') return '编辑模式';
  if (previewLabel === 'Preview') return 'Edit mode';
  return previewLabel;
}

type ViewportSizeMap = Partial<Record<PreviewViewportId, { width: number; height: number }>>;

function presetViewportSize(viewport: PreviewViewportId): { width: number; height: number } {
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport);
  if (preset?.width && preset.height) return { width: preset.width, height: preset.height };
  return { width: 1920, height: 1080 };
}

function sanitizeSavedViewportSize(
  viewport: PreviewViewportId,
  size: { width: number; height: number },
): { width: number; height: number } {
  const preset = presetViewportSize(viewport);
  if (viewport === 'mobile' && (size.width < 240 || size.width > 600)) {
    return { ...size, width: preset.width };
  }
  if (viewport === 'tablet' && (size.width < 600 || size.width > 1200)) {
    return { ...size, width: preset.width };
  }
  return size;
}

function canvasViewportStateFromSource(
  source: string | null | undefined,
  fallbackViewport: PreviewViewportId = 'desktop',
): { viewport: PreviewViewportId | null; sizes: ViewportSizeMap } {
  if (!source) return { viewport: null, sizes: {} };
  const size = readCanvasSizeFromSource(source);
  if (!size) return { viewport: null, sizes: {} };
  const viewport = readViewportPresetFromSource(source) ?? fallbackViewport;
  return { viewport, sizes: { [viewport]: sanitizeSavedViewportSize(viewport, size) } };
}

function resolvePreviewViewportPreset(
  source: string | null | undefined,
  stateKey: string,
  aliasViewport?: PreviewViewportId,
): PreviewViewportId {
  return htmlPreviewViewportState.get(stateKey)
    ?? aliasViewport
    ?? readViewportPresetFromSource(source ?? '')
    ?? 'desktop';
}

const PREVIEW_IFRAME_SANDBOX = 'allow-scripts allow-downloads';
const PREVIEW_IFRAME_POPUP_SANDBOX = 'allow-scripts allow-popups allow-downloads';

type DesktopPreviewWindow = Window & typeof globalThis & {
  openDesignDesktop?: unknown;
};

function isDesktopPreviewHost(): boolean {
  if (typeof window === 'undefined') return false;
  const hostWindow = window as DesktopPreviewWindow;
  return detectOpenDesignHostClientType() === 'desktop' || hostWindow.openDesignDesktop != null;
}

const EXPORT_CAPTURE_ROOT_CLASS = 'od-export-capture-active';

async function withExportCaptureIsolation<T>(capture: () => Promise<T>): Promise<T> {
  if (typeof document === 'undefined') return capture();
  const root = document.documentElement;
  const hadClass = root.classList.contains(EXPORT_CAPTURE_ROOT_CLASS);
  root.classList.add(EXPORT_CAPTURE_ROOT_CLASS);
  try {
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    return await capture();
  } finally {
    if (!hadClass) root.classList.remove(EXPORT_CAPTURE_ROOT_CLASS);
  }
}

function previewIframeSandbox(base = PREVIEW_IFRAME_SANDBOX): string {
  // Electron fails to paint opaque-origin sandbox iframes in some preview
  // paths. Keep the tighter web sandbox, and only add same-origin access for
  // the desktop host where the compositor regression appears.
  return isDesktopPreviewHost() ? `${base} allow-same-origin` : base;
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

function createBlankPreviewSnapshot(rect: { width: number; height: number } | null): { dataUrl: string; w: number; h: number } | null {
  const width = Math.max(1, Math.round(rect?.width ?? 1));
  const height = Math.max(1, Math.round(rect?.height ?? 1));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/png'), w: width, h: height };
  } catch {
    return null;
  }
}

function temporarilyExposeIframeForSnapshot(iframe: HTMLIFrameElement): () => void {
  const previousVisibility = iframe.style.visibility;
  const previousOpacity = iframe.style.opacity;
  const previousPointerEvents = iframe.style.pointerEvents;
  iframe.style.visibility = 'visible';
  iframe.style.opacity = '0.001';
  iframe.style.pointerEvents = 'none';
  return () => {
    iframe.style.visibility = previousVisibility;
    iframe.style.opacity = previousOpacity;
    iframe.style.pointerEvents = previousPointerEvents;
  };
}

async function requestPreviewSnapshotWithRetry(iframe: HTMLIFrameElement): Promise<Awaited<ReturnType<typeof requestPreviewSnapshot>>> {
  const timeouts = [1500, 3000, 6000];
  for (const timeout of timeouts) {
    const snapshot = await requestPreviewSnapshot(iframe, timeout);
    if (snapshot) return snapshot;
    await waitForAnimationFrame();
  }
  return null;
}

function PreviewViewportControls({
  viewport,
  onViewport,
  t,
  tabIndex,
}: {
  viewport: PreviewViewportId;
  onViewport: (viewport: PreviewViewportId) => void;
  t: TranslateFn;
  tabIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const activePreset =
    PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === viewport) ?? PREVIEW_VIEWPORT_PRESETS[0]!;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="viewer-viewport-switcher" ref={menuRef}>
      <button
        type="button"
        className={`viewer-action viewer-viewport-trigger${open ? '' : ' od-tooltip'}`}
        aria-label={t('fileViewer.viewportAria')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={t(activePreset.titleKey)}
        data-tooltip={open ? undefined : t(activePreset.titleKey)}
        data-tooltip-placement="bottom"
        tabIndex={tabIndex}
        onClick={() => setOpen((value) => !value)}
      >
        <RemixIcon
          name={previewViewportIcon(activePreset.id)}
          size={14}
          className="viewer-viewport-icon"
        />
        <span>{t(activePreset.labelKey)}</span>
        <RemixIcon name="arrow-down-s-line" size={14} />
      </button>
      {open ? (
        <div className="viewer-viewport-menu" id={listboxId} role="listbox" aria-label={t('fileViewer.viewportAria')}>
          {PREVIEW_VIEWPORT_PRESETS.map((preset) => {
            const selected = viewport === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`viewer-viewport-menu-item${selected ? ' active' : ''}`}
                role="option"
                aria-selected={selected}
                title={t(preset.titleKey)}
                onClick={() => {
                  onViewport(preset.id);
                  setOpen(false);
                }}
              >
                <span className="viewer-viewport-menu-label">
                  <RemixIcon name={previewViewportIcon(preset.id)} size={14} />
                  <span>{t(preset.labelKey)}</span>
                </span>
                {selected ? <Icon name="check" size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function usePreviewCanvasSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<PreviewCanvasSize | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        width: rect.width,
        height: rect.height,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      });
    };
    measure();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);

  return [ref, size] as const;
}

interface Props {
  projectId: string;
  projectKind: TrackingProjectKind;
  file: ProjectFile;
  liveHtml?: string;
  filesRefreshKey?: number;
  isDeck?: boolean;
  onExportAsPptx?: ((fileName: string) => void) | undefined;
  streaming?: boolean;
  commentQueueOnSend?: boolean;
  commentSendDisabled?: boolean;
  previewComments?: PreviewComment[];
  onSavePreviewComment?: (target: PreviewCommentTarget, note: string, attachAfterSave: boolean, images?: File[]) => Promise<PreviewComment | null>;
  onRemovePreviewComment?: (commentId: string) => Promise<void>;
  onStageBoardCommentAttachments?: (attachments: ChatCommentAttachment[]) => Promise<boolean | void> | boolean | void;
  onSendBoardCommentAttachments?: (attachments: ChatCommentAttachment[], images?: File[]) => Promise<boolean | void> | boolean | void;
  onFileSaved?: (event: { fileName: string; reason: HtmlFileSaveReason }) => Promise<void> | void;
  // Open `openName` as a tab (focusing it) and close `closeName` in one
  // atomic tab-state update. The React module pointer uses this to jump to the
  // HTML entry that renders a module and drop the dead-end module tab.
  onOpenFileReplacing?: (openName: string, closeName: string) => void;
  commentPortalId?: string;
  onCommentModeChange?: (active: boolean) => void;
  editPortalId?: string;
  onEditSelectionChange?: (active: boolean) => void;
  // Bumped nonce asking this viewer to open its Share/Export menu (chat-side
  // "Share" next-step action). Only HTML artifacts expose a Share menu.
  shareRequest?: { nonce: number } | null;
  // Bumped nonce asking a deck preview to flip to `slideIndex` (a queued chat
  // send for this file just started processing).
  slideNavRequest?: { slideIndex: number; nonce: number } | null;
  onEditModeChange?: (active: boolean) => void;
  // Legacy iframe fallback entry. GrapesJS edit-panel availability is derived
  // from the editor path, not this fallback flag.
  initialFallbackManualEditMode?: boolean;
  fileViewportPreset?: 'desktop' | 'tablet' | 'mobile';
  onViewportPresetChange?: (preset: 'desktop' | 'tablet' | 'mobile') => void;
}

export function FileViewer({
  projectId,
  projectKind,
  file,
  liveHtml,
  filesRefreshKey = 0,
  isDeck,
  onExportAsPptx,
  streaming,
  commentQueueOnSend = false,
  commentSendDisabled = false,
  previewComments = [],
  onSavePreviewComment,
  onRemovePreviewComment,
  onStageBoardCommentAttachments,
  onSendBoardCommentAttachments,
  onFileSaved,
  onOpenFileReplacing,
  commentPortalId,
  onCommentModeChange,
  editPortalId,
  onEditSelectionChange,
  shareRequest,
  slideNavRequest,
  onEditModeChange,
  initialFallbackManualEditMode = false,
  fileViewportPreset,
  onViewportPresetChange,
}: Props) {
  const rendererMatch = artifactRendererRegistry.resolve({
    file,
    isDeckHint: Boolean(isDeck),
  });

  // studio_view artifact — fire once per (project, file) pair so the
  // activation funnel can attribute "user opened the produced artifact"
  // even when the sub-viewer below is HtmlViewer / MarkdownViewer / etc.
  // artifact_id is anonymized to satisfy the CSV's no-filename rule.
  const analytics = useAnalytics();
  const studioViewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${projectId}::${file.name}`;
    if (studioViewKeyRef.current === key) return;
    studioViewKeyRef.current = key;
    trackPageView(analytics.track, {
      page_name: 'artifact',
    });
  }, [projectId, projectKind, file.name, file.kind, rendererMatch?.renderer.id, analytics.track]);

  if (rendererMatch?.renderer.id === 'html' || rendererMatch?.renderer.id === 'deck-html') {
    return (
      <HtmlViewer
        projectId={projectId}
        projectKind={projectKind}
        file={file}
        liveHtml={liveHtml}
        filesRefreshKey={filesRefreshKey}
        isDeck={rendererMatch.renderer.id === 'deck-html'}
        onExportAsPptx={onExportAsPptx}
        streaming={Boolean(streaming)}
        commentQueueOnSend={commentQueueOnSend}
        commentSendDisabled={commentSendDisabled}
        previewComments={previewComments}
        onSavePreviewComment={onSavePreviewComment}
        onRemovePreviewComment={onRemovePreviewComment}
        onStageBoardCommentAttachments={onStageBoardCommentAttachments}
        onSendBoardCommentAttachments={onSendBoardCommentAttachments}
        onFileSaved={onFileSaved}
        commentPortalId={commentPortalId}
        onCommentModeChange={onCommentModeChange}
        editPortalId={editPortalId}
        onEditSelectionChange={onEditSelectionChange}
        shareRequest={shareRequest}
        slideNavRequest={slideNavRequest}
        onEditModeChange={onEditModeChange}
        initialFallbackManualEditMode={initialFallbackManualEditMode}
        fileViewportPreset={fileViewportPreset}
        onViewportPresetChange={onViewportPresetChange}
      />
    );
  }
  if (rendererMatch?.renderer.id === 'react-component') {
    return (
      <ReactComponentViewer
        projectId={projectId}
        file={file}
        onOpenFileReplacing={onOpenFileReplacing}
      />
    );
  }
  if (rendererMatch?.renderer.id === 'markdown') {
    return <MarkdownViewer projectId={projectId} file={file} />;
  }
  if (rendererMatch?.renderer.id === 'svg') {
    return <SvgViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'image') {
    return <ImageViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'video') {
    return <VideoViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'audio') {
    return <AudioViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'sketch') {
    if (isRenderableSketchJson(file)) {
      return <SketchViewer projectId={projectId} file={file} />;
    }
    return <ImageViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'text' || file.kind === 'code') {
    return <TextViewer projectId={projectId} file={file} />;
  }
  if (
    file.kind === 'pdf' ||
    file.kind === 'document' ||
    file.kind === 'presentation' ||
    file.kind === 'spreadsheet'
  ) {
    return <DocumentPreviewViewer projectId={projectId} file={file} />;
  }
  return <BinaryViewer projectId={projectId} file={file} />;
}

export function LiveArtifactViewer({
  projectId,
  liveArtifact,
  liveArtifactEvents = [],
  onRefreshArtifacts,
}: {
  projectId: string;
  liveArtifact: LiveArtifactWorkspaceEntry;
  liveArtifactEvents?: LiveArtifactEventItem[];
  onRefreshArtifacts?: () => Promise<void> | void;
}) {
  const t = useT();
  const tabs = useMemo(() => liveArtifactViewerTabs(t), [t]);
  const [mode, setMode] = useState<LiveArtifactViewerTab>('preview');
  const [detail, setDetail] = useState<LiveArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [zoom, setZoom] = useState(100);
  const liveArtifactViewportKey = `${projectId}:live-artifact:${liveArtifact.artifactId}`;
  const [previewViewport, setPreviewViewportState] = useState<PreviewViewportId>(
    () => htmlPreviewViewportState.get(liveArtifactViewportKey) ?? 'desktop',
  );
  const setPreviewViewport = useCallback((viewport: PreviewViewportId) => {
    setPreviewViewportCached(liveArtifactViewportKey, viewport);
    setPreviewViewportState(viewport);
  }, [liveArtifactViewportKey]);
  const [previewBodyRef, previewBodySize] = usePreviewCanvasSize<HTMLDivElement>();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshSuccess, setRefreshSuccess] = useState<string | null>(null);
  const [refreshEvents, setRefreshEvents] = useState<LiveArtifactRefreshEvent[]>([]);
  const [refreshHistory, setRefreshHistory] = useState<LiveArtifactRefreshLogEntry[]>([]);
  const [presentMenuOpen, setPresentMenuOpen] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const [inTabPresent, setInTabPresent] = useState(false);
  const presentWrapRef = useRef<HTMLDivElement | null>(null);
  const [chromeActionsHost, setChromeActionsHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setChromeActionsHost(resolveChromeActionsHost());
  }, []);
  useEffect(() => {
    if (!presentMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.present-wrap')) return;
      setPresentMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresentMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [presentMenuOpen]);

  useEffect(() => {
    setRefreshError(null);
    setRefreshSuccess(null);
    setRefreshEvents([]);
  }, [projectId, liveArtifact.artifactId]);

  useEffect(() => {
    setPreviewViewportState(htmlPreviewViewportState.get(liveArtifactViewportKey) ?? 'desktop');
  }, [liveArtifactViewportKey]);

  useEffect(() => {
    if (!refreshSuccess) return;
    const timeout = window.setTimeout(() => setRefreshSuccess(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [refreshSuccess]);

  const processedLiveArtifactEventIdRef = useRef(0);

  useEffect(() => {
    const pendingEvents = liveArtifactEvents.filter((item) => item.id > processedLiveArtifactEventIdRef.current);
    if (pendingEvents.length === 0) return;
    processedLiveArtifactEventIdRef.current = pendingEvents[pendingEvents.length - 1]?.id ?? processedLiveArtifactEventIdRef.current;

    for (const { event: liveArtifactEvent } of pendingEvents) {
    if (
      (liveArtifactEvent.kind !== 'live_artifact' && liveArtifactEvent.kind !== 'live_artifact_refresh') ||
      liveArtifactEvent.projectId !== projectId ||
      liveArtifactEvent.artifactId !== liveArtifact.artifactId
    ) {
      continue;
    }

    if (liveArtifactEvent.kind === 'live_artifact') {
      setRefreshError(null);
      if (liveArtifactEvent.action === 'deleted') {
        setRefreshSuccess(`Live artifact deleted: ${liveArtifactEvent.title}`);
        continue;
      }
      setRefreshSuccess(
        liveArtifactEvent.action === 'created'
          ? `Live artifact created: ${liveArtifactEvent.title}`
          : `Live artifact updated: ${liveArtifactEvent.title}`,
      );
      void fetchLiveArtifact(projectId, liveArtifact.artifactId).then((next) => {
        if (next) setDetail(next);
      });
      void fetchLiveArtifactRefreshes(projectId, liveArtifact.artifactId).then(setRefreshHistory);
      setReloadKey((n) => n + 1);
      continue;
    }

    if (liveArtifactEvent.phase === 'started') {
      setRefreshing(true);
      setRefreshError(null);
      setRefreshSuccess(null);
      setRefreshEvents((prev) => appendRefreshEvent(prev, { phase: 'started' }));
      continue;
    }

    if (liveArtifactEvent.phase === 'failed') {
      setRefreshing(false);
      setRefreshError(liveArtifactEvent.error ?? t('liveArtifact.refresh.genericFailure'));
      setRefreshEvents((prev) =>
        appendRefreshEvent(prev, {
          phase: 'failed',
          error: liveArtifactEvent.error ?? undefined,
        }),
      );
      void fetchLiveArtifact(projectId, liveArtifact.artifactId).then((next) => {
        if (next) setDetail(next);
      });
      void fetchLiveArtifactRefreshes(projectId, liveArtifact.artifactId).then(setRefreshHistory);
      continue;
    }

    setRefreshing(false);
    setRefreshError(null);
    setRefreshEvents((prev) =>
      appendRefreshEvent(prev, {
        phase: 'succeeded',
        refreshedSourceCount: liveArtifactEvent.refreshedSourceCount ?? 0,
      }),
    );
    if ((liveArtifactEvent.refreshedSourceCount ?? 0) > 0) {
      setRefreshSuccess(t('liveArtifact.refresh.successOne'));
    } else {
      setRefreshError(t('liveArtifact.refresh.noSourceTitle'));
    }
    void fetchLiveArtifact(projectId, liveArtifact.artifactId).then((next) => {
      if (next) setDetail(next);
    });
    void fetchLiveArtifactRefreshes(projectId, liveArtifact.artifactId).then(setRefreshHistory);
    setReloadKey((n) => n + 1);
    }
  }, [liveArtifactEvents, liveArtifact.artifactId, projectId, t]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    void fetchLiveArtifact(projectId, liveArtifact.artifactId).then((next) => {
      if (cancelled) return;
      setDetail(next);
      setLoading(false);
    });
    void fetchLiveArtifactRefreshes(projectId, liveArtifact.artifactId).then((next) => {
      if (!cancelled) setRefreshHistory(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, liveArtifact.artifactId, liveArtifact.updatedAt]);

  const previewUrl = useMemo(
    () => `${liveArtifactPreviewUrl(projectId, liveArtifact.artifactId)}&v=${reloadKey}`,
    [projectId, liveArtifact.artifactId, reloadKey],
  );
  const previewScale = zoom / 100;

  // Instrument the live-artifact iframe so failed loads — usually a
  // missing artifact file or a stuck `od://` resolver — surface in
  // PostHog. iframe load errors don't propagate to window.error, so
  // observability/install.ts cannot catch them globally.
  useEffect(() => {
    if (mode !== 'preview') return undefined;
    const node = iframeRef.current;
    if (!node) return undefined;
    return trackIframeLoad({
      iframe: node,
      surface: 'live_artifact_preview',
      artifactId: liveArtifact.artifactId,
      projectId,
    });
  }, [mode, previewUrl, liveArtifact.artifactId, projectId]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    setRefreshSuccess(null);
    setRefreshEvents((prev) => appendRefreshEvent(prev, { phase: 'started' }));
    try {
      const result = await refreshLiveArtifact(projectId, liveArtifact.artifactId);
      setDetail(result.artifact);
      void fetchLiveArtifactRefreshes(projectId, liveArtifact.artifactId).then(setRefreshHistory);
      setReloadKey((n) => n + 1);
      setRefreshEvents((prev) =>
        appendRefreshEvent(prev, {
          phase: 'succeeded',
          refreshedSourceCount: result.refresh.refreshedSourceCount,
        }),
      );
      if (result.refresh.refreshedSourceCount > 0) {
        setRefreshSuccess(t('liveArtifact.refresh.successOne'));
      } else {
        setRefreshError(t('liveArtifact.refresh.noSourceTitle'));
      }
      await onRefreshArtifacts?.();
    } catch (error) {
      const message = refreshErrorMessage(error, t);
      setRefreshError(message);
      setRefreshEvents((prev) => appendRefreshEvent(prev, { phase: 'failed', error: message }));
    } finally {
      setRefreshing(false);
    }
  }

  const dataPayload = detail?.document?.dataJson ?? null;
  const currentRefreshStatus = detail?.refreshStatus ?? liveArtifact.refreshStatus;
  const isRunning = refreshing || currentRefreshStatus === 'running';

  const presentInThisTab = () => {
    setPresentMenuOpen(false);
    setMode('preview');
    setInTabPresent(true);
  };
  const presentFullscreen = () => {
    setPresentMenuOpen(false);
    setMode('preview');
    const target = previewBodyRef.current ?? iframeRef.current;
    if (target?.requestFullscreen) {
      void target.requestFullscreen().catch(() => {});
    }
  };
  const presentNewTab = () => {
    setPresentMenuOpen(false);
    if (typeof window === 'undefined') return;
    window.open(liveArtifactPreviewUrl(projectId, liveArtifact.artifactId), '_blank', 'noopener,noreferrer');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          const target = previewBodyRef.current ?? iframeRef.current;
          if (target?.requestFullscreen) {
            target.requestFullscreen().catch(() => {});
          }
        }
        return;
      }
      if (inTabPresent && e.key === 'Escape') setInTabPresent(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inTabPresent]);

  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!zoomMenuRef.current) return;
      if (!zoomMenuRef.current.contains(e.target as Node)) setZoomMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [zoomMenuOpen]);

  return (
    <div className={`viewer html-viewer live-artifact-viewer${inTabPresent ? ' is-tab-present' : ''}`}>
      {((node: ReactNode) => (
        chromeActionsHost ? createPortal(node, chromeActionsHost) : node
      ))(
        <>
          <button
            type="button"
            className="chrome-action chrome-action-secondary chrome-action-icon od-tooltip"
            aria-label={t('fileViewer.presentInTab')}
            data-tooltip={t('fileViewer.presentInTab')}
            data-tooltip-placement="bottom"
            title={t('fileViewer.presentInTab')}
            onClick={presentInThisTab}
          >
            <RemixIcon name="fullscreen-line" size={15} />
          </button>
          <div className="present-wrap chrome-present-wrap" ref={presentWrapRef}>
            <button
              className="chrome-action chrome-action-secondary chrome-action-icon present-trigger od-tooltip"
              aria-haspopup="menu"
              aria-expanded={presentMenuOpen}
              aria-label={t('fileViewer.present')}
              data-tooltip={t('fileViewer.present')}
              data-tooltip-placement="bottom"
              title={t('fileViewer.present')}
              onClick={() => setPresentMenuOpen((v) => !v)}
            >
              <RemixIcon name="slideshow-3-line" size={15} />
            </button>
            {presentMenuOpen ? (
              <div className="present-menu" role="menu">
                <button role="menuitem" onClick={presentInThisTab}>
                  <span className="present-icon"><RemixIcon name="eye-line" size={14} /></span>{' '}
                  {t('fileViewer.presentInTab')}
                </button>
                <button role="menuitem" onClick={presentFullscreen}>
                  <span className="present-icon"><RemixIcon name="play-line" size={14} /></span>{' '}
                  {t('fileViewer.presentFullscreen')}
                </button>
                <button role="menuitem" onClick={presentNewTab}>
                  <span className="present-icon"><RemixIcon name="share-forward-line" size={14} /></span>{' '}
                  {t('fileViewer.presentNewTab')}
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
            <button
              type="button"
              className="icon-only od-tooltip"
              onClick={() => setReloadKey((n) => n + 1)}
              title={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
              data-tooltip={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
              data-tooltip-placement="bottom"
              aria-label={`${t('fileViewer.reloadAria')} ${t('fileViewer.preview')}`}
            >
            <Icon name="reload" size={14} />
          </button>
        </div>
        <div className="viewer-toolbar-actions">
          <div className="viewer-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`viewer-tab ${mode === tab.id ? 'active' : ''}`}
                onClick={() => setMode(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            className="viewer-preview-controls"
            data-active={mode === 'preview' ? 'true' : 'false'}
            aria-hidden={mode === 'preview' ? undefined : true}
          >
            <span className="viewer-divider" aria-hidden />
            <PreviewViewportControls
              viewport={previewViewport}
              onViewport={setPreviewViewport}
              t={t}
              tabIndex={mode === 'preview' ? 0 : -1}
            />
            <span className="viewer-divider" aria-hidden />
            <EditorDiagnosticsRecorderButton fileName={liveArtifact.title || liveArtifact.artifactId} />
            <div className="zoom-menu viewer-toolbar-zoom" ref={zoomMenuRef}>
              <button
                type="button"
                className="viewer-action zoom-trigger od-tooltip"
                aria-haspopup="menu"
                aria-expanded={zoomMenuOpen}
                title={t('fileViewer.resetZoom')}
                data-tooltip={t('fileViewer.resetZoom')}
                data-tooltip-placement="bottom"
                tabIndex={mode === 'preview' ? 0 : -1}
                onClick={() => setZoomMenuOpen((v) => !v)}
              >
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoom)}%</span>
              </button>
              {zoomMenuOpen && mode === 'preview' ? (
                <div className="zoom-menu-popover" role="menu">
                  {[50, 75, 100, 125, 150, 200, 300, 400, 500, 750, 1000].map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={`zoom-menu-item${Math.round(zoom) === level ? ' active' : ''}`}
                      role="menuitem"
                      onClick={() => {
                        setZoom(level);
                        setZoomMenuOpen(false);
                      }}
                    >
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{level}%</span>
                      {Math.round(zoom) === level ? (
                        <Icon name="check" size={13} />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="viewer-divider" aria-hidden />
            <a
              className="ghost-link"
              href={liveArtifactPreviewUrl(projectId, liveArtifact.artifactId)}
              target="_blank"
              rel="noreferrer noopener"
              tabIndex={mode === 'preview' ? 0 : -1}
            >
              {t('fileViewer.open')}
            </a>
          </div>
          <span className="viewer-divider" aria-hidden />
          <button
            type="button"
            className="viewer-action primary"
            data-running={isRunning ? 'true' : 'false'}
            onClick={() => void handleRefresh()}
            disabled={isRunning}
            aria-busy={isRunning}
            aria-label={isRunning ? t('liveArtifact.refresh.running') : t('liveArtifact.refresh.button')}
            title={
              isRunning
                ? t('liveArtifact.refresh.running')
                : t('liveArtifact.refresh.buttonTitle')
            }
          >
            <Icon name={isRunning ? 'spinner' : 'reload'} size={13} />
            <span>{isRunning ? t('liveArtifact.refresh.running') : t('liveArtifact.refresh.button')}</span>
          </button>
        </div>
      </div>
      <div className="viewer-body" ref={previewBodyRef}>
        {refreshError ? (
          <LiveArtifactRefreshNotice
            tone="error"
            message={refreshError}
            action={t('liveArtifact.refresh.failureAction')}
          />
        ) : refreshSuccess ? (
          <LiveArtifactRefreshNotice
            tone="success"
            message={refreshSuccess}
            action={t('liveArtifact.refresh.successAction')}
            onDismiss={() => setRefreshSuccess(null)}
            dismissLabel={t('common.close')}
          />
        ) : isRunning ? (
          <LiveArtifactRefreshNotice
            tone="running"
            message={t('liveArtifact.refresh.runningMessage')}
            action={t('liveArtifact.refresh.runningAction')}
          />
        ) : currentRefreshStatus === 'failed' ? (
          <LiveArtifactRefreshNotice
            tone="error"
            message={t('liveArtifact.refresh.previousFailure', { message: t('liveArtifact.refresh.genericFailure') })}
            action={t('liveArtifact.refresh.failureAction')}
          />
        ) : null}
        <div
          className={`live-artifact-preview-layer preview-viewport preview-viewport-${previewViewport}`}
          data-active={mode === 'preview' ? 'true' : 'false'}
          aria-hidden={mode === 'preview' ? undefined : true}
          style={previewViewportStyle(previewViewport, previewScale, previewBodySize)}
        >
          <div className="preview-frame-clip">
            <div style={previewScaleShellStyle(previewViewport, previewScale)}>
              <PreviewDrawOverlay>
                <iframe
                  ref={iframeRef}
                  data-testid="live-artifact-preview-frame"
                  title={liveArtifact.title}
                  sandbox={previewIframeSandbox(PREVIEW_IFRAME_POPUP_SANDBOX)}
                  src={previewUrl}
                />
              </PreviewDrawOverlay>
            </div>
          </div>
        </div>
        {mode !== 'preview' && loading ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : mode === 'code' ? (
          <LiveArtifactCodePanel
            projectId={projectId}
            artifactId={liveArtifact.artifactId}
            reloadKey={reloadKey}
          />
        ) : mode === 'data' ? (
          <JsonPanel value={dataPayload} emptyLabel={t('liveArtifact.viewer.dataEmpty')} />
        ) : (
          <LiveArtifactRefreshHistoryPanel
            liveArtifact={detail}
            fallbackRefreshStatus={liveArtifact.refreshStatus}
            fallbackLastRefreshedAt={liveArtifact.lastRefreshedAt}
            isRunning={isRunning}
            sessionEvents={refreshEvents}
            persistedEvents={refreshHistory}
          />
        )}
      </div>
    </div>
  );
}

function LiveArtifactRefreshNotice({
  tone,
  message,
  action,
  onDismiss,
  dismissLabel,
}: {
  tone: 'running' | 'success' | 'error';
  message: string;
  action: string;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    <div
      className={`live-artifact-refresh-notice ${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-label={`${message} ${action}`}
    >
      <span className="live-artifact-refresh-notice-copy">
        <strong>{message}</strong>
        <span>{action}</span>
      </span>
      {onDismiss ? (
        <button type="button" className="icon-only" onClick={onDismiss} aria-label={dismissLabel}>
          ×
        </button>
      ) : null}
    </div>
  );
}

function refreshErrorMessage(error: unknown, t: TranslateFn): string {
  if (error instanceof LiveArtifactRefreshError && error.status === 0) {
    return t('liveArtifact.refresh.networkFailure');
  }
  if (error instanceof LiveArtifactRefreshError && error.code === 'LIVE_ARTIFACT_REFRESH_UNAVAILABLE') {
    return t('liveArtifact.refresh.noSourceTitle');
  }
  if (error instanceof Error && error.message.length > 0) return error.message;
  return t('liveArtifact.refresh.genericFailure');
}

function liveArtifactViewerTabs(t: TranslateFn): Array<{ id: LiveArtifactViewerTab; label: string }> {
  return [
    { id: 'preview', label: t('liveArtifact.viewer.tabPreview') },
    { id: 'code', label: t('liveArtifact.viewer.tabCode') },
    { id: 'data', label: t('liveArtifact.viewer.tabData') },
    { id: 'refresh-history', label: t('liveArtifact.viewer.tabRefreshHistory') },
  ];
}

type LiveArtifactCodeVariant = 'template' | 'rendered-source';

function LiveArtifactCodePanel({
  projectId,
  artifactId,
  reloadKey,
}: {
  projectId: string;
  artifactId: string;
  reloadKey: number;
}) {
  const t = useT();
  const [variant, setVariant] = useState<LiveArtifactCodeVariant>('template');
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setCode(null);
    void fetchLiveArtifactCode(projectId, artifactId, variant).then((next) => {
      if (cancelled) return;
      setCode(next);
      setFailed(next == null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [artifactId, projectId, reloadKey, variant]);

  return (
    <div className="live-artifact-code-panel">
      <div className="live-artifact-code-header">
        <div className="live-artifact-code-copy">
          <strong>
            {variant === 'template'
              ? t('liveArtifact.viewer.code.templateHeading')
              : t('liveArtifact.viewer.code.renderedHeading')}
          </strong>
          <span>
            {variant === 'template'
              ? t('liveArtifact.viewer.code.templateHelp')
              : t('liveArtifact.viewer.code.renderedHelp')}
          </span>
        </div>
        <div
          className="viewer-tabs live-artifact-code-tabs"
          aria-label={t('liveArtifact.viewer.code.variantAria')}
        >
          <button
            type="button"
            className={`viewer-tab ${variant === 'template' ? 'active' : ''}`}
            onClick={() => setVariant('template')}
          >
            {t('liveArtifact.viewer.code.variantTemplate')}
          </button>
          <button
            type="button"
            className={`viewer-tab ${variant === 'rendered-source' ? 'active' : ''}`}
            onClick={() => setVariant('rendered-source')}
          >
            {t('liveArtifact.viewer.code.variantRendered')}
          </button>
        </div>
      </div>
      {loading ? (
        <div className="viewer-empty">{t('liveArtifact.viewer.code.loading')}</div>
      ) : failed ? (
        <div className="viewer-empty">{t('liveArtifact.viewer.code.unavailable')}</div>
      ) : code && code.trim().length > 0 ? (
        <pre className="viewer-source">{code}</pre>
      ) : (
        <div className="viewer-empty">{t('liveArtifact.viewer.code.empty')}</div>
      )}
    </div>
  );
}

function JsonPanel({ value, emptyLabel }: { value: unknown; emptyLabel: string }) {
  if (value == null) return <div className="viewer-empty">{emptyLabel}</div>;
  return <pre className="viewer-source">{JSON.stringify(value, null, 2)}</pre>;
}

function liveArtifactMetadataPayload(liveArtifact: LiveArtifact): unknown {
  return {
    artifact: {
      id: liveArtifact.id,
      title: liveArtifact.title,
      slug: liveArtifact.slug,
      status: liveArtifact.status,
      pinned: liveArtifact.pinned,
      preview: liveArtifact.preview,
      refreshStatus: liveArtifact.refreshStatus,
      createdAt: liveArtifact.createdAt,
      updatedAt: liveArtifact.updatedAt,
      lastRefreshedAt: liveArtifact.lastRefreshedAt,
    },
    document: liveArtifact.document
      ? {
          format: liveArtifact.document.format,
          templatePath: liveArtifact.document.templatePath,
          generatedPreviewPath: liveArtifact.document.generatedPreviewPath,
          dataPath: liveArtifact.document.dataPath,
          dataSchemaJson: liveArtifact.document.dataSchemaJson,
          sourceJson: liveArtifact.document.sourceJson,
        }
      : null,
  };
}

function liveArtifactProvenancePayload(liveArtifact: LiveArtifact): unknown {
  return {
    documentSource: liveArtifact.document?.sourceJson ?? null,
  };
}

function liveArtifactRefreshPayload(liveArtifact: LiveArtifact): unknown {
  return {
    refreshStatus: liveArtifact.refreshStatus,
    lastRefreshedAt: liveArtifact.lastRefreshedAt ?? null,
  };
}

type LiveArtifactRefreshStatus = LiveArtifact['refreshStatus'];

interface LiveArtifactRefreshEvent {
  id: number;
  phase: 'started' | 'succeeded' | 'failed';
  at: number;
  durationMs?: number;
  refreshedSourceCount?: number;
  error?: string;
}

let refreshEventSequence = 0;

function appendRefreshEvent(
  prev: LiveArtifactRefreshEvent[],
  next: Omit<LiveArtifactRefreshEvent, 'id' | 'at' | 'durationMs'>,
): LiveArtifactRefreshEvent[] {
  const at = Date.now();
  refreshEventSequence += 1;
  const event: LiveArtifactRefreshEvent = { ...next, id: refreshEventSequence, at };
  if (next.phase !== 'started') {
    // Pair with the most recent 'started' to compute duration.
    for (let i = prev.length - 1; i >= 0; i -= 1) {
      const candidate = prev[i];
      if (candidate && candidate.phase === 'started') {
        event.durationMs = Math.max(0, at - candidate.at);
        break;
      }
    }
  }
  // Cap at 25 entries to keep the panel lightweight.
  const MAX = 25;
  const combined = [...prev, event];
  return combined.length > MAX ? combined.slice(combined.length - MAX) : combined;
}

function formatAbsoluteDateTime(iso: string | number | undefined): string | null {
  if (iso === undefined || iso === null) return null;
  const date = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

function formatRelativeTime(
  iso: string | number | undefined,
  now = Date.now(),
  locale: Locale = 'en',
  t?: TranslateFn,
): string | null {
  if (iso === undefined || iso === null) return null;
  const ms = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const deltaSec = Math.round((ms - now) / 1000);
  const abs = Math.abs(deltaSec);
  if (abs < 5) {
    // "just now" lives in the i18n dict because Intl.RelativeTimeFormat's
    // "0 seconds ago" reads awkwardly in narrow style and we want a
    // single canonical translation per locale. Fall back to the English
    // literal only when called without t (background utilities, tests).
    return t ? t('liveArtifact.refresh.justNow') : 'just now';
  }
  // Intl.RelativeTimeFormat handles tense (past / future), pluralisation,
  // and word-order per locale so the panel matches the rest of the
  // localised UI instead of mixing in English units like `5s ago`.
  // `style: 'narrow'` keeps the English output close to the historical
  // `5s ago` shape; `numeric: 'always'` forces numeric output so we
  // don't get "yesterday" / "now" mixed in unexpectedly with the
  // bucketing above.
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { style: 'narrow', numeric: 'always' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { style: 'narrow', numeric: 'always' });
  }
  const value = deltaSec; // negative = past, positive = future
  if (abs < 60) return rtf.format(value, 'second');
  if (abs < 3600) return rtf.format(Math.round(value / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(value / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(value / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(value / (86400 * 30)), 'month');
  return rtf.format(Math.round(value / (86400 * 365)), 'year');
}

function formatDurationMs(ms: number | undefined): string | null {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return null;
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function exportReadyNudgeKey(projectId: string, fileName: string): string {
  return `${EXPORT_READY_NUDGE_STORAGE_PREFIX}${projectId}:${fileName}`;
}

function hasSeenExportReadyNudge(projectId: string, fileName: string): boolean {
  try {
    return window.sessionStorage.getItem(exportReadyNudgeKey(projectId, fileName)) === '1';
  } catch {
    return false;
  }
}

function markExportReadyNudgeSeen(projectId: string, fileName: string) {
  try {
    window.sessionStorage.setItem(exportReadyNudgeKey(projectId, fileName), '1');
  } catch {
    // Ignore storage-denied contexts; the in-memory state still prevents loops.
  }
}

interface RefreshStatusDescriptor {
  label: string;
  tone: 'neutral' | 'running' | 'success' | 'warning' | 'error';
  description: string;
}

function describeRefreshStatus(
  status: LiveArtifactRefreshStatus,
  t: TranslateFn,
): RefreshStatusDescriptor {
  switch (status) {
    case 'running':
      return {
        label: t('liveArtifact.refresh.statusRunning'),
        tone: 'running',
        description: t('liveArtifact.refresh.statusRunningDescription'),
      };
    case 'succeeded':
      return {
        label: t('liveArtifact.refresh.statusSucceeded'),
        tone: 'success',
        description: t('liveArtifact.refresh.statusSucceededDescription'),
      };
    case 'failed':
      return {
        label: t('liveArtifact.refresh.statusFailed'),
        tone: 'error',
        description: t('liveArtifact.refresh.statusFailedDescription'),
      };
    case 'idle':
      return {
        label: t('liveArtifact.refresh.statusReady'),
        tone: 'neutral',
        description: t('liveArtifact.refresh.statusReadyDescription'),
      };
    case 'never':
    default:
      return {
        label: t('liveArtifact.refresh.statusNever'),
        tone: 'warning',
        description: t('liveArtifact.refresh.statusNeverDescription'),
      };
  }
}

function describeEventPhase(
  event: LiveArtifactRefreshEvent,
  t: TranslateFn,
): { label: string; tone: 'running' | 'success' | 'error' } {
  if (event.phase === 'started')
    return { label: t('liveArtifact.refresh.eventStarted'), tone: 'running' };
  if (event.phase === 'succeeded')
    return { label: t('liveArtifact.refresh.eventSucceeded'), tone: 'success' };
  return { label: t('liveArtifact.refresh.eventFailed'), tone: 'error' };
}

function describePersistedStatus(
  status: LiveArtifactRefreshLogEntry['status'],
  t: TranslateFn,
): string {
  switch (status) {
    case 'succeeded':
      return t('liveArtifact.refresh.persistedStatusSucceeded');
    case 'running':
      return t('liveArtifact.refresh.persistedStatusRunning');
    case 'failed':
      return t('liveArtifact.refresh.persistedStatusFailed');
    case 'cancelled':
      return t('liveArtifact.refresh.persistedStatusCancelled');
    case 'skipped':
      return t('liveArtifact.refresh.persistedStatusSkipped');
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function LiveArtifactRefreshHistoryPanel({
  liveArtifact,
  fallbackRefreshStatus,
  fallbackLastRefreshedAt,
  isRunning,
  sessionEvents,
  persistedEvents = [],
}: {
  liveArtifact: LiveArtifact | null;
  fallbackRefreshStatus: LiveArtifactRefreshStatus;
  fallbackLastRefreshedAt?: string;
  isRunning: boolean;
  sessionEvents: LiveArtifactRefreshEvent[];
  persistedEvents?: LiveArtifactRefreshLogEntry[];
}) {
  const t = useT();
  const { locale } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Keep relative timestamps fresh; 30s cadence is enough for "x minutes ago" feel.
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const status: LiveArtifactRefreshStatus = isRunning
    ? 'running'
    : liveArtifact?.refreshStatus ?? fallbackRefreshStatus;
  const descriptor = describeRefreshStatus(status, t);
  const lastRefreshedAt = liveArtifact?.lastRefreshedAt ?? fallbackLastRefreshedAt;
  const createdAt = liveArtifact?.createdAt;
  const updatedAt = liveArtifact?.updatedAt;
  const documentSource = liveArtifact?.document?.sourceJson ?? null;
  const reversedEvents = [...sessionEvents].reverse();
  const reversedPersistedEvents = [...persistedEvents].reverse().slice(0, 25);
  const rawDebugPayload = liveArtifact
    ? {
        refresh: liveArtifactRefreshPayload(liveArtifact),
        metadata: liveArtifactMetadataPayload(liveArtifact),
        provenance: liveArtifactProvenancePayload(liveArtifact),
      }
    : null;

  return (
    <div className="live-artifact-refresh-panel">
      <section className="live-artifact-refresh-hero">
        <div className="live-artifact-refresh-hero-main">
          <span
            className={`live-artifact-badge refresh-status tone-${descriptor.tone}`}
            data-testid="live-artifact-refresh-status-badge"
          >
            {descriptor.label}
          </span>
          <p className="live-artifact-refresh-hero-desc">{descriptor.description}</p>
        </div>
        <div className="live-artifact-refresh-hero-meta">
          <div className="live-artifact-refresh-hero-metric">
            <span className="live-artifact-refresh-label">
              {t('liveArtifact.refresh.heroLastRefreshedLabel')}
            </span>
            {lastRefreshedAt ? (
              <>
                <span className="live-artifact-refresh-value">
                  {formatRelativeTime(lastRefreshedAt, now, locale, t) ?? '—'}
                </span>
                <span
                  className="live-artifact-refresh-sub"
                  title={formatAbsoluteDateTime(lastRefreshedAt) ?? undefined}
                >
                  {formatAbsoluteDateTime(lastRefreshedAt) ?? ''}
                </span>
              </>
            ) : (
              <span className="live-artifact-refresh-value muted">
                {t('liveArtifact.refresh.heroLastRefreshedNever')}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="live-artifact-refresh-facts">
        <LiveArtifactRefreshFact
          label={t('liveArtifact.refresh.factCreated')}
          iso={createdAt}
          emptyLabel={t('liveArtifact.refresh.factUnknown')}
          now={now}
          locale={locale}
          t={t}
        />
        <LiveArtifactRefreshFact
          label={t('liveArtifact.refresh.factLastUpdated')}
          iso={updatedAt}
          emptyLabel={t('liveArtifact.refresh.factUnknown')}
          now={now}
          locale={locale}
          t={t}
        />
      </section>

      <section className="live-artifact-refresh-section">
        <header className="live-artifact-refresh-section-header">
          <h4>{t('liveArtifact.refresh.persistedTitle')}</h4>
          <span className="live-artifact-refresh-hint">
            {t('liveArtifact.refresh.persistedHint')}
          </span>
        </header>
        {reversedPersistedEvents.length === 0 ? (
          <div className="live-artifact-refresh-empty">
            {t('liveArtifact.refresh.persistedEmpty')}
          </div>
        ) : (
          <ol className="live-artifact-refresh-timeline">
            {reversedPersistedEvents.map((event) => {
              const tone = event.status === 'succeeded'
                ? 'success'
                : event.status === 'running'
                  ? 'running'
                  : event.status === 'failed' || event.status === 'cancelled'
                    ? 'error'
                    : 'running';
              const duration = formatDurationMs(event.durationMs);
              return (
                <li key={`${event.refreshId}:${event.sequence}`} className={`live-artifact-refresh-event tone-${tone}`}>
                  <span className="live-artifact-refresh-event-dot" aria-hidden />
                  <div className="live-artifact-refresh-event-body">
                    <div className="live-artifact-refresh-event-row">
                      <span className={`live-artifact-badge refresh-status tone-${tone}`}>
                        {describePersistedStatus(event.status, t)}
                      </span>
                      <strong>{event.step}</strong>
                      <span className="live-artifact-refresh-event-time">
                        {formatRelativeTime(event.startedAt, now, locale, t)
                          ?? t('liveArtifact.refresh.justNow')}
                      </span>
                    </div>
                    <div className="live-artifact-refresh-event-meta">
                      <span>{event.refreshId}</span>
                      {duration ? <span>{duration}</span> : null}
                      {event.error?.message ? <span>{event.error.message}</span> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="live-artifact-refresh-section">
        <header className="live-artifact-refresh-section-header">
          <h4>{t('liveArtifact.refresh.sessionTitle')}</h4>
          <span className="live-artifact-refresh-hint">
            {t('liveArtifact.refresh.sessionHint')}
          </span>
        </header>
        {reversedEvents.length === 0 ? (
          <div className="live-artifact-refresh-empty">
            {t('liveArtifact.refresh.timelineEmpty')}
          </div>
        ) : (
          <ol className="live-artifact-refresh-timeline">
            {reversedEvents.map((event) => {
              const phase = describeEventPhase(event, t);
              const duration = formatDurationMs(event.durationMs);
              const refreshedCount = event.refreshedSourceCount ?? 0;
              return (
                <li key={event.id} className={`live-artifact-refresh-event tone-${phase.tone}`}>
                  <span className="live-artifact-refresh-event-dot" aria-hidden />
                  <div className="live-artifact-refresh-event-body">
                    <div className="live-artifact-refresh-event-row">
                      <span
                        className={`live-artifact-badge refresh-status tone-${phase.tone}`}
                      >
                        {phase.label}
                      </span>
                      <span
                        className="live-artifact-refresh-event-time"
                        title={formatAbsoluteDateTime(event.at) ?? undefined}
                      >
                        {formatRelativeTime(event.at, now, locale, t) ?? ''}
                      </span>
                    </div>
                    <div className="live-artifact-refresh-event-detail">
                      {event.phase === 'succeeded' ? (
                        <span>
                          {t(
                            refreshedCount === 1
                              ? 'liveArtifact.refresh.sourcesUpdatedOne'
                              : 'liveArtifact.refresh.sourcesUpdatedMany',
                            { n: refreshedCount },
                          )}
                          {duration ? ` · ${duration}` : ''}
                        </span>
                      ) : event.phase === 'failed' ? (
                        <span>
                          {event.error ?? t('liveArtifact.refresh.genericFailure')}
                          {duration ? ` · ${duration}` : ''}
                        </span>
                      ) : (
                        <span>{t('liveArtifact.refresh.eventStartedDetail')}</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {documentSource ? (
        <section className="live-artifact-refresh-section">
          <header className="live-artifact-refresh-section-header">
            <h4>{t('liveArtifact.refresh.docSourceTitle')}</h4>
            <span className="live-artifact-refresh-hint">
              {t('liveArtifact.refresh.docSourceHint')}
            </span>
          </header>
          <dl className="live-artifact-refresh-kv">
            <div>
              <dt>{t('liveArtifact.refresh.docSourceType')}</dt>
              <dd>{documentSource.type}</dd>
            </div>
            {documentSource.toolName ? (
              <div>
                <dt>{t('liveArtifact.refresh.docSourceTool')}</dt>
                <dd>
                  <code>{documentSource.toolName}</code>
                </dd>
              </div>
            ) : null}
            {documentSource.connector ? (
              <div>
                <dt>{t('liveArtifact.refresh.docSourceConnector')}</dt>
                <dd>
                  {documentSource.connector.accountLabel ??
                    documentSource.connector.connectorId}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {rawDebugPayload != null ? (
        <details className="live-artifact-refresh-raw">
          <summary>{t('liveArtifact.refresh.debugSummary')}</summary>
          <p className="live-artifact-refresh-raw-note">
            {t('liveArtifact.refresh.debugNote')}
          </p>
          <pre className="viewer-source">{JSON.stringify(rawDebugPayload, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}

function LiveArtifactRefreshFact({
  label,
  iso,
  value,
  helper,
  emptyLabel,
  now,
  locale,
  t,
}: {
  label: string;
  iso?: string;
  value?: string;
  helper?: string;
  emptyLabel?: string;
  now?: number;
  locale?: Locale;
  t?: TranslateFn;
}) {
  const relative = iso !== undefined ? formatRelativeTime(iso, now, locale, t) : null;
  const absolute = iso !== undefined ? formatAbsoluteDateTime(iso) : null;
  const resolved = value ?? relative ?? emptyLabel ?? '—';
  const sub = helper ?? (iso !== undefined ? absolute ?? '' : '');
  return (
    <div className="live-artifact-refresh-fact">
      <span className="live-artifact-refresh-label">{label}</span>
      <span className="live-artifact-refresh-value" title={absolute ?? undefined}>
        {resolved}
      </span>
      {sub ? <span className="live-artifact-refresh-sub">{sub}</span> : null}
    </div>
  );
}

function FileActions({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  return (
    <div className="viewer-toolbar-actions">
      <a
        className="ghost-link"
        href={projectFileUrl(projectId, file.name)}
        download={file.name}
      >
        {t('fileViewer.download')}
      </a>
      <a
        className="ghost-link"
        href={projectFileUrl(projectId, file.name)}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('fileViewer.open')}
      </a>
    </div>
  );
}

function formatCommentTime(ts: number, t: TranslateFn): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('common.justNow');
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return t('common.minutesAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('common.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('common.daysAgo', { n: days });
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return t('common.weeksAgo', { n: weeks });
  return new Date(ts).toLocaleDateString();
}

function commentActivityAt(comment: PreviewComment): number {
  return Math.max(
    Number.isFinite(comment.updatedAt) ? comment.updatedAt : 0,
    Number.isFinite(comment.createdAt) ? comment.createdAt : 0,
  );
}

function commentCreatedAt(comment: PreviewComment): number {
  return Number.isFinite(comment.createdAt) ? comment.createdAt : commentActivityAt(comment);
}

function commentTargetIntersectsPreview(
  target: PreviewCommentSnapshot | null,
  scale: number,
  offset: { x: number; y: number },
  bounds?: PreviewCanvasSize,
): boolean {
  if (!target || !bounds?.width || !bounds.height) return true;
  const rect = overlayBoundsFromSnapshot(target, scale, offset);
  const margin = 8;
  return (
    rect.left + rect.width > margin &&
    rect.top + rect.height > margin &&
    rect.left < bounds.width - margin &&
    rect.top < bounds.height - margin
  );
}

function commentDisplayLabel(comment: PreviewComment, t: TranslateFn): string {
  if (comment.elementId.startsWith('pin-')) return t('chat.comments.comment');
  const label = String(comment.label || '').trim().toLowerCase();
  const htmlHint = String(comment.htmlHint || '').trim().toLowerCase();
  const elementId = String(comment.elementId || '').trim().toLowerCase();
  const source = `${label} ${htmlHint} ${elementId}`;
  if (/\b(?:img|picture|video|canvas|svg)\b/.test(source)) return t('chat.comments.targetImage');
  if (/\b(?:button|input|textarea|select|label)\b/.test(source)) return t('chat.comments.targetControl');
  if (/^<a\b/.test(htmlHint)) return t('chat.comments.targetLink');
  if (/\b(?:h1|h2|h3|h4|h5|h6|p|span|strong|em|small|li|dt|dd)\b/.test(source)) return t('chat.comments.targetText');
  if (/\b(?:section|main|header|footer|nav|article|aside)\b/.test(source)) return t('chat.comments.targetSection');
  if (label.endsWith('.html') || elementId.startsWith('file-comment-')) return t('chat.comments.targetPage');
  if (comment.text.trim()) return t('chat.comments.targetText');
  return t('chat.comments.targetArea');
}

export function CommentSidePanel({
  comments,
  projectId,
  selectedIds,
  activeCommentId,
  collapsed,
  onCollapsedChange,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onReorder,
  onReply,
  onSendSelected,
  onCreateComment,
  sending,
  queueOnSend = false,
  sendDisabled = false,
  renderCreateForm = true,
  t,
  composer,
}: {
  comments: PreviewComment[];
  projectId?: string;
  selectedIds: Set<string>;
  activeCommentId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onToggleSelect: (commentId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onReorder?: (orderedIds: string[]) => void;
  onReply: (comment: PreviewComment) => void;
  onSendSelected: () => void | Promise<void>;
  onCreateComment?: (note: string) => boolean | Promise<boolean>;
  sending: boolean;
  queueOnSend?: boolean;
  sendDisabled?: boolean;
  renderCreateForm?: boolean;
  t: TranslateFn;
  composer?: ReactNode;
}) {
  const [newCommentDraft, setNewCommentDraft] = useState('');
  const [dragState, setDragState] = useState<CommentSideDragState | null>(null);
  const sorted = comments;
  const visibleSelectedIds = new Set(comments.filter((comment) => selectedIds.has(comment.id)).map((comment) => comment.id));
  const selectedCount = visibleSelectedIds.size;
  const allSelected = comments.length > 0 && selectedCount === comments.length;
  const commentsLabel = t('chat.tabComments');
  const canCreateComment = Boolean(onCreateComment) && newCommentDraft.trim().length > 0 && !sending && !sendDisabled;
  const canReorder = Boolean(onReorder && sorted.length > 1);
  const collapsedRailRef = useRef<HTMLButtonElement | null>(null);
  const expandedToggleRef = useRef<HTMLButtonElement | null>(null);
  const pendingToggleFocusRef = useRef<'collapsed' | 'expanded' | null>(null);
  const panelId = useId();
  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, comment: PreviewComment) => {
    if (!canReorder) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(COMMENT_SIDE_DRAG_MIME, comment.id);
    event.dataTransfer.setData('text/plain', comment.id);
    setDragState({ draggingId: comment.id, overId: comment.id, edge: null });
  };
  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>, targetId: string) => {
    if (!canReorder) return;
    const draggingId = dragState?.draggingId || event.dataTransfer.getData(COMMENT_SIDE_DRAG_MIME);
    if (!draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (draggingId === targetId) {
      if (dragState?.overId !== targetId || dragState.edge !== null) {
        setDragState({ draggingId, overId: targetId, edge: null });
      }
      return;
    }
    const edge = commentSideDropEdgeForEvent(event);
    if (
      dragState?.draggingId !== draggingId ||
      dragState.overId !== targetId ||
      dragState.edge !== edge
    ) {
      setDragState({ draggingId, overId: targetId, edge });
    }
  };
  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, targetId: string) => {
    if (!canReorder) return;
    event.preventDefault();
    const draggingId =
      dragState?.draggingId ||
      event.dataTransfer.getData(COMMENT_SIDE_DRAG_MIME) ||
      event.dataTransfer.getData('text/plain');
    if (!draggingId || draggingId === targetId) {
      setDragState(null);
      return;
    }
    const edge = dragState?.overId === targetId && dragState.edge
      ? dragState.edge
      : commentSideDropEdgeForEvent(event);
    const nextIds = reorderPreviewCommentIds(sorted, draggingId, targetId, edge);
    if (nextIds.join('\0') !== sorted.map((comment) => comment.id).join('\0')) {
      onReorder?.(nextIds);
    }
    setDragState(null);
  };
  const submitNewComment = async () => {
    if (!onCreateComment || !newCommentDraft.trim()) return;
    const saved = await onCreateComment(newCommentDraft.trim());
    if (saved) setNewCommentDraft('');
  };

  useEffect(() => {
    const target =
      pendingToggleFocusRef.current === 'collapsed'
        ? collapsedRailRef.current
        : pendingToggleFocusRef.current === 'expanded'
          ? expandedToggleRef.current
          : null;
    if (!target) return;
    pendingToggleFocusRef.current = null;
    target.focus();
  }, [collapsed]);

  const handleCollapsedChange = (
    nextCollapsed: boolean,
    nextFocusTarget: 'collapsed' | 'expanded',
  ) => {
    pendingToggleFocusRef.current = nextFocusTarget;
    onCollapsedChange(nextCollapsed);
  };

  if (collapsed) {
    return (
      <button
        ref={collapsedRailRef}
        type="button"
        className="comment-side-rail"
        data-testid="comment-side-collapsed-rail"
        aria-label={t('preview.showSidebar', { label: commentsLabel })}
        aria-expanded={false}
        title={t('preview.showSidebar', { label: commentsLabel })}
        onClick={() => handleCollapsedChange(false, 'expanded')}
      >
        <RemixIcon name="message-3-line" size={15} />
        <span>{commentsLabel}</span>
        {comments.length > 0 ? <strong>{comments.length}</strong> : null}
      </button>
    );
  }

  return (
    <aside id={panelId} className="comment-side-panel" data-testid="comment-side-panel" aria-label={commentsLabel}>
      <div className="comment-side-header">
        <div className="comment-side-title">
          <RemixIcon name="message-3-line" size={15} />
          <span>{commentsLabel}</span>
        </div>
        <div className="comment-side-header-actions">
          {comments.length > 0 ? (
            <button
              type="button"
              className="comment-side-select-all"
              disabled={allSelected}
              onClick={onSelectAll}
            >
              {t('chat.comments.selectAll')}
            </button>
          ) : null}
          <button
            ref={expandedToggleRef}
            type="button"
            className="comment-side-collapse"
            aria-label={t('preview.hideSidebar', { label: commentsLabel })}
            aria-controls={panelId}
            aria-expanded={true}
            title={t('preview.hideSidebar', { label: commentsLabel })}
            onClick={() => handleCollapsedChange(true, 'collapsed')}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
      </div>
      <div
        className="comment-side-list"
        onDragLeave={(event) => {
          const related = event.relatedTarget;
          if (related instanceof Node && event.currentTarget.contains(related)) return;
          setDragState(null);
        }}
      >
        {sorted.length === 0 ? (
          <div className="comment-side-empty">
            {t('chat.comments.emptySaved')}
          </div>
        ) : sorted.map((comment, index) => {
          const selected = visibleSelectedIds.has(comment.id);
          const active = comment.id === activeCommentId;
          const isDragging = dragState?.draggingId === comment.id;
          const dropClass = dragState?.overId === comment.id &&
            dragState.draggingId !== comment.id &&
            dragState.edge
            ? ` comment-side-item-drop-${dragState.edge}`
            : '';
          return (
            <div
              key={comment.id}
              className={`comment-side-item${selected ? ' selected' : ''}${active ? ' active' : ''}${isDragging ? ' dragging' : ''}${dropClass}`}
              data-testid="comment-side-item"
              data-comment-id={comment.id}
              aria-current={active ? 'true' : undefined}
              role="button"
              tabIndex={0}
              onDragOver={(event) => handleDragOver(event, comment.id)}
              onDrop={(event) => handleDrop(event, comment.id)}
              onClick={() => onReply(comment)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onReply(comment);
              }}
            >
              <div className="comment-side-item-head">
                <button
                  type="button"
                  className="comment-side-drag-handle"
                  title={t('chat.queuedReorder')}
                  aria-label={t('chat.queuedReorder')}
                  draggable={canReorder}
                  disabled={!canReorder}
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => handleDragStart(event, comment)}
                  onDragEnd={() => setDragState(null)}
                >
                  <Icon name="grip-vertical" size={13} />
                </button>
                <span className="comment-side-author">
                  <strong>{`${index + 1}. ${commentDisplayLabel(comment, t)}`}</strong>
                </span>
                <span className="comment-side-time">{formatCommentTime(commentActivityAt(comment), t)}</span>
                <button
                  type="button"
                  className={`comment-side-check${selected ? ' checked' : ''}`}
                  aria-label={selected ? t('chat.comments.deselect') : t('chat.comments.select')}
                  aria-pressed={selected}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSelect(comment.id);
                  }}
                >
                  {selected ? <Icon name="check" size={11} /> : null}
                </button>
              </div>
              <div className="comment-side-body">{comment.note}</div>
              {projectId && comment.attachments && comment.attachments.length > 0 ? (
                <div className="comment-side-attachments">
                  {comment.attachments.map((attachment) => {
                    const url = projectRawUrl(projectId, attachment.path);
                    return (
                      <a
                        key={attachment.path}
                        className="comment-side-attachment"
                        data-testid="comment-side-attachment"
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={attachment.name}
                        title={attachment.name}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <img src={url} alt={attachment.name} />
                      </a>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {selectedCount > 0 ? (
        <div className="comment-side-selectbar" data-testid="comment-side-selectbar">
          <span className="comment-side-selectcount">{t('chat.comments.nSelected', { n: selectedCount })}</span>
          <Button variant="ghost" onClick={onClearSelection}>
            {t('chat.comments.clear')}
          </Button>
          <Button
            variant="primary"
            data-testid="comment-side-send-claude"
            disabled={sending || sendDisabled}
            onClick={() => void onSendSelected()}
          >
            {sending
              ? t('chat.comments.sending')
              : queueOnSend
                ? t('chat.annotationQueue')
                : t('chat.comments.sendToChat')}
          </Button>
        </div>
      ) : null}
      {composer ? <div className="comment-side-composer">{composer}</div> : null}
      {renderCreateForm && onCreateComment ? (
        <form
          className="comment-side-new-comment composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitNewComment();
          }}
        >
          <div className="composer-shell comment-side-new-comment-shell">
            <div className="composer-input-wrap">
              <div className="composer-textarea-layer">
                <textarea
                  value={newCommentDraft}
                  placeholder={t('chat.comments.placeholder')}
                  aria-label={t('chat.comments.placeholder')}
                  onChange={(event) => setNewCommentDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void submitNewComment();
                    }
                  }}
                />
              </div>
            </div>
            <div className="composer-row comment-side-new-comment-actions">
              <button
                type="button"
                className="icon-btn"
                title={t('chat.cliSettingsTitle')}
                aria-label={t('chat.cliSettingsAria')}
                disabled
              >
                <span className="composer-tools-at" aria-hidden>
                  @
                </span>
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('chat.attachTitle')}
                aria-label={t('chat.attachAria')}
                disabled
              >
                <Icon name="attach" size={15} />
              </button>
              <span className="composer-spacer" />
              <button
                type="submit"
                className={`composer-send${sending ? ' is-sending' : ''}`}
                disabled={!canCreateComment}
              >
                <Icon name="send" size={13} />
                <span>{sending ? t('chat.comments.sending') : t('chat.send')}</span>
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </aside>
  );
}

const COMMENT_SIDE_DRAG_MIME = 'application/x-open-design-preview-comment';

type CommentSideDropEdge = 'before' | 'after';

interface CommentSideDragState {
  draggingId: string;
  overId: string | null;
  edge: CommentSideDropEdge | null;
}

function commentSideDropEdgeForEvent(event: ReactDragEvent<HTMLElement>): CommentSideDropEdge {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function reorderPreviewCommentIds(
  comments: PreviewComment[],
  draggingId: string,
  targetId: string,
  edge: CommentSideDropEdge,
): string[] {
  const ids = comments.map((comment) => comment.id);
  const from = ids.indexOf(draggingId);
  if (from < 0) return ids;
  const [draggedId] = ids.splice(from, 1);
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex < 0 || !draggedId) return comments.map((comment) => comment.id);
  ids.splice(edge === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
  return ids;
}

export function appendSavedPreviewCommentOrder(
  currentOrderIds: string[],
  visibleComments: Array<Pick<PreviewComment, 'id'>>,
  savedId: string,
): string[] {
  if (!savedId) return currentOrderIds;
  const visibleIds = visibleComments.map((comment) => comment.id);
  if (currentOrderIds.includes(savedId) || visibleIds.includes(savedId)) {
    return currentOrderIds;
  }
  const visibleIdSet = new Set(visibleIds);
  const kept = currentOrderIds.filter((id) => visibleIdSet.has(id));
  const missingVisibleIds = visibleIds.filter((id) => !kept.includes(id));
  const base = currentOrderIds.length > 0 ? [...kept, ...missingVisibleIds] : visibleIds;
  const next = [...base, savedId];
  return next.join('\0') === currentOrderIds.join('\0') ? currentOrderIds : next;
}

function CommentSideDock({
  comments,
  projectId,
  selectedIds,
  activeCommentId,
  collapsed,
  onCollapsedChange,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onReorder,
  onReply,
  onSendSelected,
  onCreateComment,
  sending,
  queueOnSend = false,
  sendDisabled = false,
  renderCreateForm = true,
  t,
  composer,
}: {
  comments: PreviewComment[];
  projectId?: string;
  selectedIds: Set<string>;
  activeCommentId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onToggleSelect: (commentId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onReorder?: (orderedIds: string[]) => void;
  onReply: (comment: PreviewComment) => void;
  onSendSelected: () => void | Promise<void>;
  onCreateComment?: (note: string) => boolean | Promise<boolean>;
  sending: boolean;
  queueOnSend?: boolean;
  sendDisabled?: boolean;
  renderCreateForm?: boolean;
  t: TranslateFn;
  composer?: ReactNode;
}) {
  return (
    <div
      className={`comment-side-dock${collapsed ? ' collapsed' : ''}`}
      data-testid="comment-side-dock"
    >
      <CommentSidePanel
        comments={comments}
        projectId={projectId}
        selectedIds={selectedIds}
        activeCommentId={activeCommentId}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        onToggleSelect={onToggleSelect}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
        onReorder={onReorder}
        onReply={onReply}
        onSendSelected={onSendSelected}
        onCreateComment={onCreateComment}
        sending={sending}
        queueOnSend={queueOnSend}
        sendDisabled={sendDisabled}
        renderCreateForm={renderCreateForm}
        t={t}
        composer={composer}
      />
    </div>
  );
}

// Maps a CSS computed value (e.g. "rgb(40, 50, 60)" or "16px") to a form
// input value. Browsers return colors as rgb()/rgba(); HTML <input type=color>
// only accepts "#rrggbb". Lengths come back as "12px" or "0px"; we strip
// units for slider binding and re-append on emit.
//
// Note: <input type=color> has no alpha channel, so an rgba() with alpha < 1
// is collapsed to its opaque RGB equivalent here. Most agent-generated HTML
// uses opaque colors, so this is a known cosmetic limitation — a
// semi-transparent source value will display in the panel as fully opaque.
function rgbToHex(value: string | undefined): string {
  if (!value) return '#000000';
  const v = value.trim();
  if (v.startsWith('#') && (v.length === 7 || v.length === 4)) {
    if (v.length === 4) {
      return '#' + [1, 2, 3].map((i) => {
        const c = v.charAt(i);
        return c + c;
      }).join('');
    }
    return v;
  }
  const m = v.match(/rgba?\(\s*([0-9.]+)[ ,]+([0-9.]+)[ ,]+([0-9.]+)/i);
  if (!m) return '#000000';
  const toHex = (n: string) => {
    const x = Math.max(0, Math.min(255, Math.round(Number(n))));
    return x.toString(16).padStart(2, '0');
  };
  return '#' + toHex(m[1] ?? '0') + toHex(m[2] ?? '0') + toHex(m[3] ?? '0');
}

// Parse a CSS length to a number. Inspect's current sliders all clamp to a
// non-negative range (padding, font-size, border-radius), so we reject
// negatives at parse time too — otherwise a `-12px` source value would be
// silently floored to 0 by the slider clamp without the regex agreeing.
// If a future control needs negative values (e.g. margin), thread an
// explicit `allowNegative` flag rather than reintroducing `-?` here.
function pxToNumber(value: string | undefined): number {
  if (!value) return 0;
  const m = value.trim().match(/^(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clampManualEditZoom(value: number): number {
  return clamp(value, 25, 1000);
}

const MANUAL_EDIT_WHEEL_ZOOM_SENSITIVITY = 0.0012;

function nextManualEditWheelZoom(currentZoom: number, deltaY: number): number {
  const factor = Math.exp(-deltaY * MANUAL_EDIT_WHEEL_ZOOM_SENSITIVITY);
  return clampManualEditZoom(Number((currentZoom * factor).toFixed(3)));
}

function InspectPanel({
  target,
  onApply,
  onResetElement,
  onSaveToSource,
  onClose,
  saving,
  savedAt,
  error,
}: {
  target: InspectTarget;
  onApply: (prop: string, value: string) => void;
  onResetElement: (elementId: string) => void;
  onSaveToSource: () => void;
  onClose: () => void;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
}) {
  // Local "draft" mirror of the most recent value the user picked, so
  // sliders/colors keep responding even before the iframe echoes back the
  // computed result. Reset whenever the selected element changes.
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setDraft({});
  }, [target.elementId]);

  const value = (prop: string, fallback: string): string =>
    draft[prop] ?? fallback;

  function setVal(prop: string, raw: string) {
    setDraft((d) => ({ ...d, [prop]: raw }));
    onApply(prop, raw);
  }

  // Padding is exposed as a single shared slider that emits the `padding`
  // shorthand; the browser fans the value out to all four sides internally.
  // When per-side control becomes useful, switch to emitting explicit
  // padding-top / padding-right / padding-bottom / padding-left props
  // (the bridge already allow-lists those long-hand names).
  const initialPadding = pxToNumber(target.style.paddingTop);
  const initialFontSize = pxToNumber(target.style.fontSize);
  const initialRadius = pxToNumber(target.style.borderRadius);

  // Color / length controls all read through `draft` first so the input
  // tracks the most recent user pick even before getComputedStyle catches
  // up. Without this the picker would snap back to the initial computed
  // snapshot on every change and feel non-editable.
  const colorHex = value('color', rgbToHex(target.style.color));
  const bgHex = value('background-color', rgbToHex(target.style.backgroundColor));
  const padding = value('padding', String(initialPadding));
  const fontSize = value('font-size', String(initialFontSize));
  const radius = value('border-radius', String(initialRadius));
  const textAlign = value('text-align', target.style.textAlign || 'left');
  const fontWeight = value('font-weight', target.style.fontWeight || '400');
  // Parse once: `pxToNumber(...) || initial...` would treat a legitimate
  // `0px` draft as missing and snap the slider back to the original
  // computed value, making it impossible to remove padding/radius from an
  // element whose initial value is nonzero. `pxToNumber` already returns
  // 0 for unparseable input, so its result is safe to consume directly
  // and zero is preserved.
  const paddingNum = pxToNumber(padding);
  const fontSizeNum = pxToNumber(fontSize);
  const radiusNum = pxToNumber(radius);

  const justSaved = savedAt && Date.now() - savedAt < 4000;

  return (
    <aside className="inspect-panel" data-testid="inspect-panel">
      <header className="inspect-panel-head">
        <div className="inspect-panel-title">
          <strong title={target.label || target.elementId}>{target.label || target.elementId}</strong>
          <code title={target.selector}>{target.elementId}</code>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close inspect">
          ×
        </Button>
      </header>

      {target.clickedDescendant ? (
        <div className="inspect-ancestor-notice" data-testid="inspect-ancestor-notice">
          <div className="inspect-ancestor-notice-icon" aria-hidden>
            i
          </div>
          <div className="inspect-ancestor-notice-text">
            You clicked <strong>{target.clickedDescendant.label}</strong>
            {target.clickedDescendant.text
              ? ` ("${target.clickedDescendant.text.slice(0, 40)}${target.clickedDescendant.text.length > 40 ? '...' : ''}")`
              : ''}
            , but it has no <code>data-od-id</code> annotation. Editing{' '}
            <strong>{target.label || target.elementId}</strong> instead, the nearest annotated ancestor.
          </div>
        </div>
      ) : null}

      <section className="inspect-section">
        <div className="inspect-section-label">Colors</div>
        <div className="inspect-row">
          <label htmlFor="ip-color">Text</label>
          <Input
            id="ip-color"
            data-testid="inspect-color"
            type="color"
            value={colorHex}
            onChange={(e) => setVal('color', e.target.value)}
          />
          <Input
            type="text"
            value={colorHex}
            onChange={(e) => setVal('color', e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="inspect-row">
          <label htmlFor="ip-bg">Background</label>
          <Input
            id="ip-bg"
            data-testid="inspect-bg"
            type="color"
            value={bgHex}
            onChange={(e) => setVal('background-color', e.target.value)}
          />
          <Input
            type="text"
            value={bgHex}
            onChange={(e) => setVal('background-color', e.target.value)}
            spellCheck={false}
          />
        </div>
      </section>

      <section className="inspect-section">
        <div className="inspect-section-label">Typography</div>
        <div className="inspect-row">
          <label htmlFor="ip-fs">Size</label>
          <input
            id="ip-fs"
            data-testid="inspect-font-size"
            type="range"
            min={8}
            max={160}
            step={1}
            value={clamp(fontSizeNum, 8, 160)}
            onChange={(e) => setVal('font-size', `${e.target.value}px`)}
          />
          <span className="inspect-row-value">{Math.round(fontSizeNum)}px</span>
        </div>
        <div className="inspect-row">
          <label htmlFor="ip-fw">Weight</label>
          <Select
            id="ip-fw"
            value={fontWeight}
            onChange={(e) => setVal('font-weight', e.target.value)}
          >
            {['100', '300', '400', '500', '600', '700', '800', '900'].map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </Select>
        </div>
        <div className="inspect-row">
          <label htmlFor="ip-ta">Align</label>
          <Select
            id="ip-ta"
            value={textAlign}
            onChange={(e) => setVal('text-align', e.target.value)}
          >
            {['left', 'center', 'right', 'justify'].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
        </div>
      </section>

      <section className="inspect-section">
        <div className="inspect-section-label">Spacing &amp; Shape</div>
        <div className="inspect-row">
          <label htmlFor="ip-pad">Padding</label>
          <input
            id="ip-pad"
            data-testid="inspect-padding"
            type="range"
            min={0}
            max={120}
            step={1}
            value={clamp(paddingNum, 0, 120)}
            onChange={(e) => setVal('padding', `${e.target.value}px`)}
          />
          <span className="inspect-row-value">{Math.round(paddingNum)}px</span>
        </div>
        <div className="inspect-row">
          <label htmlFor="ip-rad">Radius</label>
          <input
            id="ip-rad"
            data-testid="inspect-radius"
            type="range"
            min={0}
            max={120}
            step={1}
            value={clamp(radiusNum, 0, 120)}
            onChange={(e) => setVal('border-radius', `${e.target.value}px`)}
          />
          <span className="inspect-row-value">{Math.round(radiusNum)}px</span>
        </div>
      </section>

      <footer className="inspect-panel-footer">
        <Button
          variant="ghost"
          onClick={() => {
            setDraft({});
            onResetElement(target.elementId);
          }}
        >
          Reset element
        </Button>
        <Button
          variant="primary"
          data-testid="inspect-save"
          disabled={saving}
          onClick={onSaveToSource}
        >
          {saving ? 'Saving…' : justSaved ? 'Saved ✓' : 'Save to source'}
        </Button>
      </footer>
      {error ? <div className="inspect-panel-error">{error}</div> : null}
    </aside>
  );
}

// Inspect-mode override entry as held in the host's authoritative map and as
// it travels in od:inspect-overrides messages. The host's persisted map is
// owned and mutated only by host-driven onApply / reset actions plus the
// initial parse of the source's <style data-od-inspect-overrides> block;
// inbound iframe messages are treated as preview acknowledgements, never as
// save input. Artifact code rendered with scripts enabled can call
// window.parent.postMessage with a forged payload — ev.source still points
// at iframe.contentWindow — so any field arriving from the iframe is
// untrusted. Even the structured `overrides` field could be tampered with
// to flip allow-listed properties on elements the user never edited, which
// is why we no longer ingest it on save.
type InspectOverridePayload = {
  selector?: unknown;
  props?: unknown;
};

// Authoritative host-side override map: elementId → { selector, props }.
// Mirrors the in-iframe shape so serializeInspectOverrides can consume it.
export type InspectOverrideEntry = {
  selector: string;
  props: Record<string, string>;
};
export type InspectOverrideMap = Record<string, InspectOverrideEntry>;

// Allow-list of CSS properties the host will persist on Save. Mirrors the
// in-iframe ALLOWED_PROPS list so the host doesn't accept properties that
// the bridge itself would reject.
const HOST_ALLOWED_INSPECT_PROPS = new Set([
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'text-align',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-radius',
]);

// Reject values that could break out of `prop: value` and into the
// surrounding <style> block — semicolons, braces, angle brackets, and
// newlines. Mirrors the bridge's UNSAFE_VALUE regex.
const HOST_UNSAFE_INSPECT_VALUE = /[;{}<>\n\r]/;

// Reject elementIds whose characters could break out of `[attr="..."]`
// inside a <style> block. Forbidden:
//   - `"` and `\` would close the attribute string or smuggle CSS
//     escapes the host didn't pre-process;
//   - `<` and `>` would close the surrounding <style> tag;
//   - C0/C1 controls (newline, etc.) end the CSS rule under string
//     tokenization — kept in as defense-in-depth against parser quirks.
// Everything else — including ASCII whitespace and leading digits — is
// allowed, so deck labels like `01 Cover` survive instead of being
// dropped on the way to the persisted overrides block.
const HOST_UNSAFE_INSPECT_ID = /["\\<>\u0000-\u001f\u007f]/;

// Build the inspect overrides CSS body the host will persist, from the
// structured `overrides` field of an od:inspect-overrides message. The host
// MUST NOT trust the sibling `css` string — it is attacker-controlled when
// artifact JS forges the message. The selector is re-derived from each
// elementId; only allow-listed properties with safe values survive.
//
// Exported so unit tests can exercise the validator with hostile payloads.
export function serializeInspectOverrides(overrides: unknown): string {
  if (!overrides || typeof overrides !== 'object') return '';
  const map = overrides as Record<string, unknown>;
  const lines: string[] = [];
  for (const elementId of Object.keys(map)) {
    if (!elementId || HOST_UNSAFE_INSPECT_ID.test(elementId)) continue;
    const entry = map[elementId] as InspectOverridePayload | null | undefined;
    if (!entry || typeof entry !== 'object') continue;
    const props = entry.props;
    if (!props || typeof props !== 'object') continue;
    // Trust only the *kind* of selector the bridge built, not the value
    // it carried. The bridge runs CSS.escape over the elementId, so a raw
    // equality check against `[data-screen-label="${elementId}"]` would
    // miss legitimate deck labels like `01 Cover` (whitespace, leading
    // digit) and silently downgrade them to `[data-od-id="..."]`. The
    // elementId itself was sanitized above, so embedding it verbatim into
    // the re-derived selector is safe inside an attribute value string.
    const inboundSelector = typeof entry.selector === 'string' ? entry.selector : '';
    const attr = inboundSelector.startsWith('[data-screen-label="')
      ? 'data-screen-label'
      : 'data-od-id';
    const safeSelector = `[${attr}="${elementId}"]`;
    const decls: string[] = [];
    for (const [rawName, rawValue] of Object.entries(props as Record<string, unknown>)) {
      if (typeof rawName !== 'string' || typeof rawValue !== 'string') continue;
      const name = rawName.toLowerCase();
      if (!HOST_ALLOWED_INSPECT_PROPS.has(name)) continue;
      const value = rawValue.trim();
      if (!value || HOST_UNSAFE_INSPECT_VALUE.test(value)) continue;
      decls.push(`${name}: ${value} !important`);
    }
    if (!decls.length) continue;
    lines.push(`${safeSelector} { ${decls.join('; ')} }`);
  }
  return lines.join('\n');
}

// Apply a single host-driven prop change to the authoritative override map.
// Returns a new map (or the same reference if no-op so React skips renders).
// Empty value clears the prop; clearing the last prop drops the elementId.
// Mirrors the iframe bridge's applyOverride sanitization so the host map and
// the live preview stay in lock-step under the same rules.
export function updateInspectOverride(
  map: InspectOverrideMap,
  elementId: string,
  selector: string,
  prop: string,
  value: string,
): InspectOverrideMap {
  if (!elementId || HOST_UNSAFE_INSPECT_ID.test(elementId)) return map;
  const propName = String(prop || '').toLowerCase();
  if (!HOST_ALLOWED_INSPECT_PROPS.has(propName)) return map;
  const trimmed = String(value ?? '').trim();
  if (trimmed && HOST_UNSAFE_INSPECT_VALUE.test(trimmed)) return map;
  const existing = map[elementId];
  const nextProps: Record<string, string> = { ...(existing?.props ?? {}) };
  if (!trimmed) {
    if (!(propName in nextProps)) return map;
    delete nextProps[propName];
  } else if (nextProps[propName] === trimmed && existing?.selector === selector) {
    return map;
  } else {
    nextProps[propName] = trimmed;
  }
  const nextMap: InspectOverrideMap = { ...map };
  if (Object.keys(nextProps).length === 0) {
    delete nextMap[elementId];
  } else {
    nextMap[elementId] = { selector: selector || existing?.selector || '', props: nextProps };
  }
  return nextMap;
}

// Parse any persisted <style data-od-inspect-overrides> blocks in the
// artifact source into the host's authoritative override map. The host owns
// this map and only mutates it from onApply / reset actions plus this
// initial hydration step — inbound iframe od:inspect-overrides messages are
// not ingested. Without this step, opening a file that already carries an
// override block would leave the host map empty, so a Save-to-source after
// any subsequent edit could splice a CSS body that drops every previously
// saved rule for elements the user did not touch in this session.
//
// Mirrors the iframe bridge's hydrateOverridesFromDom: same allow-list,
// same value sanitizer, same selector kinds, so what the iframe applies and
// what the host persists stay in lock-step. Pure string transform; no DOM.
//
// HTML-aware: enumerates `<style data-od-inspect-overrides>` elements via
// the same walker used by the splicer, so a `<style data-od-inspect-overrides>`
// literal living inside a `<script>`, `<style>` (e.g. CSS comment), `<textarea>`,
// `<title>`, or HTML comment is not mistaken for a real override block. Without
// that exclusion, useEffect would seed the host map from forged/quoted text and
// a later Save-to-source would persist phantom CSS the user never created.
export function parseInspectOverridesFromSource(source: string): InspectOverrideMap {
  const map: InspectOverrideMap = {};
  if (!source) return map;
  for (const body of stripInspectOverridesAndIndex(source).bodies) {
    const ruleRe = /(\[data-(?:od-id|screen-label)="([^"]*)"\])\s*\{\s*([^}]*)\}/g;
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = ruleRe.exec(body)) !== null) {
      const selector = ruleMatch[1] ?? '';
      const elementId = ruleMatch[2] ?? '';
      const declBody = ruleMatch[3] ?? '';
      if (!selector || !elementId || HOST_UNSAFE_INSPECT_ID.test(elementId)) continue;
      const props: Record<string, string> = {};
      for (const raw of declBody.split(';')) {
        if (!raw) continue;
        const colon = raw.indexOf(':');
        if (colon <= 0) continue;
        const name = raw.slice(0, colon).trim().toLowerCase();
        if (!HOST_ALLOWED_INSPECT_PROPS.has(name)) continue;
        const value = raw.slice(colon + 1).replace(/!important/gi, '').trim();
        if (!value || HOST_UNSAFE_INSPECT_VALUE.test(value)) continue;
        props[name] = value;
      }
      if (Object.keys(props).length) {
        map[elementId] = { selector, props };
      }
    }
  }
  return map;
}

// HTML5 raw-text and escapable-raw-text elements: the parser does not
// interpret markup inside their contents, so a literal `</head>` or
// `<style data-od-inspect-overrides>` written as text inside one of them
// must NOT be treated as a real tag. Without this exclusion, a regex-only
// splicer can match `</head>` inside an inline <script> string literal or
// a CSS comment and inject the override block into the middle of
// JavaScript/CSS instead of the actual document head, corrupting the
// artifact on Save to source.
const RAW_TEXT_INSPECT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

// Decide whether a `<style ...>` opening tag actually carries a real
// `data-od-inspect-overrides` attribute, as opposed to merely mentioning
// the marker text inside another attribute name or value. The naive
// `\bdata-od-inspect-overrides\b` test against the whole tag text is
// over-broad in two cases:
//
//   1. A longer attribute name that has the marker as a prefix, e.g.
//      `<style data-od-inspect-overrides-note="docs">`. The `-` after
//      `overrides` is a non-word character, so `\b` matches and the tag
//      gets mis-stripped on save / mis-parsed on hydration.
//   2. The marker spelled inside an attribute value, e.g.
//      `<style title="data-od-inspect-overrides">`. The whole tag text
//      contains the literal, so the regex matches even though the actual
//      attribute names are `title` only.
//
// Both shapes occur in real artifacts (notes, documentation, fixtures)
// and would either silently drop the user's CSS on save or seed phantom
// overrides into the host map even though the artifact has no real
// override block. So we walk attributes proper, lower-casing each name
// and skipping any quoted value, and report a hit only when one of those
// names is exactly `data-od-inspect-overrides` (boolean attribute or
// assigned value, both legal HTML for our marker).
function styleTagIsInspectOverrideBlock(tagText: string): boolean {
  const start = /^<style/i.exec(tagText);
  if (!start) return false;
  let i = start[0].length;
  const end = tagText.length;
  while (i < end) {
    const ch = tagText.charAt(i);
    if (ch === '>') return false;
    if (ch === '/' || /\s/.test(ch)) {
      i++;
      continue;
    }
    const nameStart = i;
    while (i < end) {
      const c = tagText.charAt(i);
      if (c === '=' || c === '/' || c === '>' || /\s/.test(c)) break;
      i++;
    }
    const name = tagText.slice(nameStart, i).toLowerCase();
    while (i < end && /\s/.test(tagText.charAt(i))) i++;
    if (i < end && tagText.charAt(i) === '=') {
      i++;
      while (i < end && /\s/.test(tagText.charAt(i))) i++;
      const quote = tagText.charAt(i);
      if (quote === '"' || quote === "'") {
        i++;
        const close = tagText.indexOf(quote, i);
        i = close < 0 ? end : close + 1;
      } else {
        while (i < end) {
          const c = tagText.charAt(i);
          if (c === '>' || /\s/.test(c)) break;
          i++;
        }
      }
    }
    if (name === 'data-od-inspect-overrides') return true;
  }
  return false;
}

// Find the start (`<` position) of the matching close tag for a raw-text
// element, scanning case-insensitively. The close tag must be followed by
// a tag-name boundary (whitespace, `/`, or `>`) so a longer name like
// `</scripted>` doesn't accidentally close a `<script>`.
function findInspectRawTextEnd(source: string, start: number, name: string): number {
  const lower = source.toLowerCase();
  const needle = '</' + name.toLowerCase();
  let p = start;
  while (p < source.length) {
    const idx = lower.indexOf(needle, p);
    if (idx < 0) return -1;
    const after = source.charAt(idx + needle.length);
    if (after === '' || after === '>' || after === '/' || /\s/.test(after)) return idx;
    p = idx + needle.length;
  }
  return -1;
}

type InspectSpliceScan = {
  out: string;
  // Position in `out` immediately after the first top-level `<head ...>`
  // open tag, or -1 if no head was found outside raw-text content.
  headOpenEnd: number;
  // Position in `out` at the first top-level `</head>` close tag, or -1.
  headCloseStart: number;
  // Raw inner-text of every real `<style data-od-inspect-overrides>` element
  // discovered during the walk, in source order. Excludes occurrences inside
  // raw-text element contents and HTML comments. Hydration parses these
  // bodies for the host map; the splicer ignores them.
  bodies: string[];
};

// Walk `source` and produce a copy with every existing
// `<style data-od-inspect-overrides>...</style>` block removed, while
// remembering where the real (non-raw-text) `<head>` boundaries land in
// the output. The walker honours HTML comment, doctype/processing
// instruction, and raw-text element boundaries so the splicer can ignore
// tag-shaped literals inside scripts/styles/textareas/titles. Pure string
// transform — no DOM dependency, safe to run during SSR/tests.
function stripInspectOverridesAndIndex(source: string): InspectSpliceScan {
  const parts: string[] = [];
  const bodies: string[] = [];
  let outLen = 0;
  let headOpenEnd = -1;
  let headCloseStart = -1;
  let i = 0;
  function emit(text: string): void {
    if (!text) return;
    parts.push(text);
    outLen += text.length;
  }
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      emit(source.slice(i));
      break;
    }
    if (lt > i) emit(source.slice(i, lt));
    i = lt;
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      const stop = end < 0 ? source.length : end + 3;
      emit(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (source.startsWith('<!', i) || source.startsWith('<?', i)) {
      const end = source.indexOf('>', i + 2);
      const stop = end < 0 ? source.length : end + 1;
      emit(source.slice(i, stop));
      i = stop;
      continue;
    }
    const tagEnd = source.indexOf('>', i + 1);
    if (tagEnd < 0) {
      emit(source.slice(i));
      break;
    }
    const tagText = source.slice(i, tagEnd + 1);
    const closeMatch = /^<\/([a-zA-Z][a-zA-Z0-9-]*)/.exec(tagText);
    if (closeMatch) {
      const name = closeMatch[1]!.toLowerCase();
      if (name === 'head' && headCloseStart < 0) headCloseStart = outLen;
      emit(tagText);
      i = tagEnd + 1;
      continue;
    }
    const openMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(tagText);
    if (!openMatch) {
      emit(tagText);
      i = tagEnd + 1;
      continue;
    }
    const name = openMatch[1]!.toLowerCase();
    const isSelfClose = /\/\s*>$/.test(tagText);
    if (name === 'head' && headOpenEnd < 0) headOpenEnd = outLen + tagText.length;
    if (name === 'style' && styleTagIsInspectOverrideBlock(tagText)) {
      // Strip the entire override block. A self-closing <style /> is a
      // degenerate authoring case; treat it as nothing to skip past.
      if (isSelfClose) {
        i = tagEnd + 1;
        continue;
      }
      const closeStart = findInspectRawTextEnd(source, tagEnd + 1, 'style');
      if (closeStart < 0) {
        // Unterminated override block — drop the rest of the document
        // rather than silently reflowing later content into a dangling
        // <style>. Matches the "stop" behaviour of the previous regex.
        i = source.length;
        continue;
      }
      bodies.push(source.slice(tagEnd + 1, closeStart));
      const closeEnd = source.indexOf('>', closeStart);
      let stop = closeEnd < 0 ? source.length : closeEnd + 1;
      while (stop < source.length && /\s/.test(source.charAt(stop))) stop++;
      i = stop;
      continue;
    }
    if (!isSelfClose && RAW_TEXT_INSPECT_ELEMENTS.has(name)) {
      const closeStart = findInspectRawTextEnd(source, tagEnd + 1, name);
      if (closeStart < 0) {
        emit(source.slice(i));
        i = source.length;
        continue;
      }
      const closeEnd = source.indexOf('>', closeStart);
      const stop = closeEnd < 0 ? source.length : closeEnd + 1;
      // Copy the entire raw-text element (open tag, body, close tag) to
      // the output verbatim so its contents pass through unmodified.
      emit(source.slice(i, stop));
      i = stop;
      continue;
    }
    emit(tagText);
    i = tagEnd + 1;
  }
  return { out: parts.join(''), headOpenEnd, headCloseStart, bodies };
}

// Splice (or remove) the inspect overrides <style> block in an HTML
// document. Idempotent: calling with the same css produces the same
// document. Empty css strips the block entirely.
//
// HTML-aware: the underlying scan ignores comments and raw-text element
// contents (script / style / textarea / title), so a literal `</head>` or
// `<style data-od-inspect-overrides>` written inside an inline script or
// style block does not trick the splicer into stripping user code or
// inserting the override block in the middle of JavaScript/CSS.
//
// Exported (via the module) so a unit test can drive it without a live
// browser. Pure string transform — no DOM, no parser dependency.
export function applyInspectOverridesToSource(source: string, css: string): string {
  const trimmed = css.trim();
  const { out, headOpenEnd, headCloseStart } = stripInspectOverridesAndIndex(source);
  if (!trimmed) return out;
  const block = `<style data-od-inspect-overrides>\n${trimmed}\n</style>\n`;
  if (headCloseStart >= 0) {
    return out.slice(0, headCloseStart) + block + out.slice(headCloseStart);
  }
  if (headOpenEnd >= 0) {
    return out.slice(0, headOpenEnd) + block + out.slice(headOpenEnd);
  }
  return block + out;
}

function CommentPreviewOverlays({
  comments,
  liveTargets,
  hoveredTarget,
  hoveredPodMemberId,
  activeTarget,
  activeExistingCommentId = null,
  boardTool,
  showActivePin = false,
  targetTone = 'comment',
  scale,
  offsetX,
  offsetY,
  strokePoints,
  activeSlideIndex = null,
  onOpenComment,
}: {
  comments: PreviewComment[];
  liveTargets: Map<string, PreviewCommentSnapshot>;
  hoveredTarget: PreviewCommentSnapshot | null;
  hoveredPodMemberId: string | null;
  activeTarget: PreviewCommentSnapshot | null;
  activeExistingCommentId?: string | null;
  boardTool: BoardTool;
  showActivePin?: boolean;
  targetTone?: 'comment' | 'element-selection';
  scale: number;
  offsetX: number;
  offsetY: number;
  strokePoints: StrokePoint[];
  activeSlideIndex?: number | null;
  onOpenComment: (comment: PreviewComment, snapshot: PreviewCommentSnapshot) => void;
}) {
  const overlayOffset = useMemo(() => ({ x: offsetX, y: offsetY }), [offsetX, offsetY]);
  const visibleComments = useMemo(
    () =>
      comments
        .map((comment, globalIndex) => ({
          comment,
          markerNumber: globalIndex + 1,
          snapshot: liveSnapshotForComment(comment, liveTargets),
        }))
        .filter((item): item is { comment: PreviewComment; markerNumber: number; snapshot: PreviewCommentSnapshot } =>
          Boolean(item.snapshot),
        )
        .filter(({ comment }) => commentVisibleOnDeckSlide(comment, activeSlideIndex)),
    [comments, liveTargets, activeSlideIndex],
  );
  // `onOpenComment` is an inline arrow from the parent (new identity every
  // render), so read it through a ref to keep the saved-marker memo below from
  // busting. The closure only calls stable state setters, so a current ref read
  // is always correct.
  const onOpenCommentRef = useRef(onOpenComment);
  onOpenCommentRef.current = onOpenComment;
  // Memoize the saved-marker subtree. While the user draws a pod lasso,
  // `strokePoints` updates on every pointermove and re-renders this overlay;
  // without this, every saved marker (bounds + JSX) was rebuilt each frame.
  // Keyed only on the marker inputs (NOT strokePoints), so a steady set of
  // comments reuses the whole subtree and React skips reconciling it.
  const savedMarkers = useMemo(
    () =>
      visibleComments.map(({ comment, markerNumber, snapshot }) => {
        const bounds = overlayBoundsFromSnapshot(snapshot, scale, overlayOffset);
        const label = commentTargetDisplayName(comment);
        return (
          <div
            key={comment.id}
            className="comment-saved-marker"
            style={{
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
            }}
            data-testid={`comment-saved-marker-${comment.elementId}`}
            onClick={() => onOpenCommentRef.current(comment, snapshot)}
          >
            <div className="comment-saved-outline" />
            <button
              type="button"
              className="comment-saved-pin"
              onClick={(event) => {
                event.stopPropagation();
                onOpenCommentRef.current(comment, snapshot);
              }}
              title={`${markerNumber}. ${label}: ${comment.note}`}
              aria-label={`Open comment for ${label}`}
            >
              <span aria-hidden="true" className="comment-saved-pin-dot" />
            </button>
            <div className="comment-saved-bubble" role="tooltip">
              <span className="comment-saved-bubble-label">{label}</span>
              <span className="comment-saved-bubble-note">{comment.note}</span>
            </div>
          </div>
        );
      }),
    [visibleComments, scale, overlayOffset],
  );
  const targetOverlay = activeTarget ?? hoveredTarget;
  return (
    <div className="comment-overlay-layer" aria-hidden={false}>
      {savedMarkers}
      {targetOverlay ? (
        <CommentTargetOverlay
          snapshot={targetOverlay}
          scale={scale}
          offset={overlayOffset}
          selected={Boolean(activeTarget)}
          hoveredMemberId={hoveredPodMemberId}
          tone={targetTone}
        />
      ) : null}
      {showActivePin && activeTarget ? (
        <div
          className="comment-active-pin"
          style={activeCommentPinStyle(activeTarget, scale, overlayOffset)}
          data-testid="comment-active-pin"
          aria-hidden="true"
        >
          <span className="comment-saved-pin-dot" />
        </div>
      ) : null}
      {boardTool === 'pod' && strokePoints.length > 1 ? (
        <svg className="board-pod-stroke">
          <polyline
            points={strokePoints.map((point) => `${offsetX + point.x * scale},${offsetY + point.y * scale}`).join(' ')}
          />
        </svg>
      ) : null}
    </div>
  );
}

export function shouldShowElementSelectionAction({
  boardMode,
  commentCreateMode,
  activeTarget,
}: {
  boardMode: boolean;
  commentCreateMode: boolean;
  activeTarget: PreviewCommentSnapshot | null;
}): boolean {
  return Boolean(boardMode && !commentCreateMode && activeTarget);
}

function activeCommentPinStyle(
  target: PreviewCommentSnapshot,
  scale: number,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): CSSProperties {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const anchor = target.hoverPoint ?? {
    x: target.position.x,
    y: target.position.y,
  };
  return {
    left: Math.round(offset.x + anchor.x * safeScale),
    top: Math.round(offset.y + anchor.y * safeScale),
  };
}

export function CommentTargetOverlay({
  snapshot,
  scale,
  offset,
  selected,
  hoveredMemberId,
  tone = 'comment',
}: {
  snapshot: PreviewCommentSnapshot;
  scale: number;
  offset?: { x: number; y: number };
  selected: boolean;
  hoveredMemberId?: string | null;
  tone?: 'comment' | 'element-selection';
}) {
  const overlayOffset = offset ?? { x: 0, y: 0 };
  const toneClass = tone === 'element-selection' ? ' element-selection' : '';
  const displayMembers = podDisplayMembers(snapshot);
  if (displayMembers.length > 0) {
    const overlayWeights = podOverlayWeights(displayMembers);
    const overlayRgb = tone === 'element-selection' ? '16, 185, 129' : '22, 119, 255';
    return (
      <>
        {displayMembers.map((member, index) => {
          const bounds = overlayBoundsFromSnapshot(member, scale, overlayOffset);
          const width = Math.round(member.position.width);
          const height = Math.round(member.position.height);
          const overlayWeight = overlayWeights[index] ?? {
            backgroundOpacity: 0.24,
            outlineOpacity: 0.72,
            ringOpacity: 0.18,
          };
          const overlayStyle: CSSProperties & Record<string, string | number> = {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            '--comment-overlay-bg': `rgba(${overlayRgb}, ${overlayWeight.backgroundOpacity})`,
            '--comment-overlay-ring': `rgba(${overlayRgb}, ${overlayWeight.ringOpacity})`,
            '--comment-overlay-border': `rgba(${overlayRgb}, ${overlayWeight.outlineOpacity})`,
          };
          const isHoverFocused = hoveredMemberId === member.elementId;
          return (
            <div
              key={`${member.elementId}-${index}`}
              className={`comment-target-overlay comment-target-overlay--member${toneClass}${selected ? ' selected' : ''}${isHoverFocused ? ' is-hover-focused' : ''}`}
              style={overlayStyle}
              data-testid="comment-target-overlay"
            >
              <span className="comment-target-overlay-label">{snapshot.elementId}</span>
            </div>
          );
        })}
      </>
    );
  }
  // Non-member fallback: single-element snapshots have no per-member chips,
  // so the hover-focus channel never reaches this branch — no is-hover-focused
  // class needed here.
  const bounds = overlayBoundsFromSnapshot(snapshot, scale, overlayOffset);
  return (
    <div
      className={`comment-target-overlay${toneClass}${selected ? ' selected' : ''}`}
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      }}
      data-testid="comment-target-overlay"
    >
      <span className="comment-target-overlay-label">{snapshot.elementId}</span>
    </div>
  );
}

export function ElementSelectionAddButton({
  target,
  busy,
  disabled = false,
  placement = 'floating',
  onAdd,
  t,
}: {
  target: PreviewCommentSnapshot;
  busy: boolean;
  disabled?: boolean;
  placement?: 'floating' | 'toolbar';
  onAdd: () => void | Promise<void>;
  t: TranslateFn;
}) {
  const targetName = commentTargetDisplayName(target, t('chat.comments.targetArea'));
  return (
    <div
      className={`element-selection-action${placement === 'toolbar' ? ' element-selection-action-toolbar' : ''}`}
      data-testid="element-selection-action"
    >
      <span className="element-selection-target-chip" title={targetName}>
        <RemixIcon name="cursor-line" size={13} />
        <span>{targetName}</span>
      </span>
      <Button
        type="button"
        variant="primary"
        disabled={disabled || busy}
        data-testid="element-selection-add-to-chat"
        onClick={() => { void onAdd(); }}
      >
        <RemixIcon name="sparkling-2-line" size={14} />
        <span>{busy ? t('chat.annotationAddingToInput') : t('chat.annotationAddToInput')}</span>
      </Button>
    </div>
  );
}

function podDisplayMembers(snapshot: PreviewCommentSnapshot): PreviewCommentSnapshot[] {
  if (snapshot.selectionKind !== 'pod' || !Array.isArray(snapshot.podMembers)) return [];
  const memberSnapshots = snapshot.podMembers.map((member) => ({
    filePath: snapshot.filePath,
    elementId: member.elementId,
    selector: member.selector,
    label: member.label,
    text: member.text,
    position: member.position,
    htmlHint: member.htmlHint,
    selectionKind: 'element' as const,
  }));
  const refined = pruneContainerSelections(memberSnapshots);
  return refined.length > 0 ? refined : memberSnapshots;
}

function podOverlayWeights(
  members: PreviewCommentSnapshot[],
): Array<{ backgroundOpacity: number; outlineOpacity: number; ringOpacity: number }> {
  const areas = members.map((member) =>
    Math.max(1, member.position.width * member.position.height),
  );
  const maxArea = Math.max(...areas);
  const minArea = Math.min(...areas);
  return areas.map((area) => {
    const normalized =
      maxArea === minArea ? 1 : 1 - (area - minArea) / (maxArea - minArea);
    const emphasis = Math.pow(normalized, 0.9);
    return {
      backgroundOpacity: roundOverlayOpacity(0.1 + emphasis * 0.6),
      outlineOpacity: roundOverlayOpacity(0.34 + emphasis * 0.36),
      ringOpacity: roundOverlayOpacity(0.08 + emphasis * 0.18),
    };
  });
}

function roundOverlayOpacity(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildPodSnapshot(input: {
  filePath: string;
  strokePoints: StrokePoint[];
  liveTargets: Map<string, PreviewCommentSnapshot>;
}): PreviewCommentSnapshot | null {
  if (input.strokePoints.length < 2) return null;
  const closedLoop = isClosedLoop(input.strokePoints);
  const intersected = Array.from(input.liveTargets.values()).filter((snapshot) =>
    selectionHitsSnapshot({
      points: input.strokePoints,
      snapshot,
      closedLoop,
    }),
  );
  const refined = pruneContainerSelections(intersected);
  const selected = refined.length > 0 ? refined : intersected;
  return buildPodSnapshotFromSnapshots({
    filePath: input.filePath,
    snapshots: selected,
    idPrefix: 'pod',
  });
}

function buildPodSnapshotFromSnapshots(input: {
  filePath: string;
  snapshots: PreviewCommentSnapshot[];
  idPrefix?: string;
}): PreviewCommentSnapshot | null {
  const refined = pruneContainerSelections(input.snapshots);
  const selected = refined.length > 0 ? refined : input.snapshots;
  if (selected.length === 0) return null;
  const bounds = selected.reduce(
    (acc, snapshot) => {
      const rect = snapshot.position;
      return {
        left: Math.min(acc.left, rect.x),
        top: Math.min(acc.top, rect.y),
        right: Math.max(acc.right, rect.x + rect.width),
        bottom: Math.max(acc.bottom, rect.y + rect.height),
      };
    },
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );
  const podMembers: PreviewCommentMember[] = selected.map((snapshot) => ({
    elementId: snapshot.elementId,
    selector: snapshot.selector,
    label: snapshot.label,
    text: snapshot.text,
    position: snapshot.position,
    htmlHint: snapshot.htmlHint,
    style: snapshot.style,
  }));
  const summary = selected
    .slice(0, 3)
    .map((snapshot) => summarizeSnapshot(snapshot))
    .join(' · ');
  const htmlHint = selected
    .slice(0, 4)
    .map((snapshot) => snapshot.htmlHint)
    .filter(Boolean)
    .join(' ');
  const combinedSelector = selected
    .slice(0, 8)
    .map((snapshot) => snapshot.selector)
    .filter(Boolean)
    .join(', ');
  return {
    filePath: input.filePath,
    elementId: `${input.idPrefix ?? 'pod'}-${Date.now()}`,
    selector: combinedSelector || 'body *',
    label: summary || `Pod of ${selected.length} items`,
    text: selected
      .slice(0, 4)
      .map((snapshot) => snapshot.text)
      .filter(Boolean)
      .join(' · '),
    position: {
      x: Math.round(bounds.left),
      y: Math.round(bounds.top),
      width: Math.max(1, Math.round(bounds.right - bounds.left)),
      height: Math.max(1, Math.round(bounds.bottom - bounds.top)),
    },
    htmlHint: htmlHint.slice(0, 180),
    selectionKind: 'pod',
    memberCount: selected.length,
    podMembers,
  };
}

function pruneContainerSelections(
  snapshots: PreviewCommentSnapshot[],
): PreviewCommentSnapshot[] {
  if (snapshots.length < 2) return snapshots;
  return snapshots.filter((candidate) => {
    const candidateArea = Math.max(1, candidate.position.width * candidate.position.height);
    const contained = snapshots.filter(
      (other) =>
        other.elementId !== candidate.elementId &&
        rectContains(candidate.position, other.position),
    );
    if (contained.length === 0) return true;
    const union = contained.reduce(
      (acc, other) => ({
        left: Math.min(acc.left, other.position.x),
        top: Math.min(acc.top, other.position.y),
        right: Math.max(acc.right, other.position.x + other.position.width),
        bottom: Math.max(acc.bottom, other.position.y + other.position.height),
      }),
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      },
    );
    const unionArea = Math.max(1, (union.right - union.left) * (union.bottom - union.top));
    return !(contained.length >= 2 && candidateArea > unionArea * 2.4);
  });
}

function summarizeSnapshot(snapshot: PreviewCommentSnapshot): string {
  const text = snapshot.text.trim();
  if (text) {
    const trimmed = text.length > 28 ? `${text.slice(0, 25)}...` : text;
    return `${snapshot.label || snapshot.elementId} · ${trimmed}`;
  }
  return snapshot.label || snapshot.elementId;
}

function selectionHitsSnapshot(input: {
  points: StrokePoint[];
  snapshot: PreviewCommentSnapshot;
  closedLoop: boolean;
}): boolean {
  const bounds = {
    left: input.snapshot.position.x,
    top: input.snapshot.position.y,
    width: input.snapshot.position.width,
    height: input.snapshot.position.height,
  };
  if (pathIntersectsRect(input.points, bounds)) return true;
  if (!input.closedLoop) return false;
  const center = {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  };
  if (pointInPolygon(center, input.points)) return true;
  const corners = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.left + bounds.width, y: bounds.top },
    { x: bounds.left + bounds.width, y: bounds.top + bounds.height },
    { x: bounds.left, y: bounds.top + bounds.height },
  ];
  return corners.some((corner) => pointInPolygon(corner, input.points));
}

function isClosedLoop(points: StrokePoint[]): boolean {
  if (points.length < 4) return false;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return Math.hypot(first.x - last.x, first.y - last.y) <= 28;
}

function rectContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

function pathIntersectsRect(
  points: StrokePoint[],
  rect: { left: number; top: number; width: number; height: number },
): boolean {
  if (points.length === 0) return false;
  const x1 = rect.left;
  const y1 = rect.top;
  const x2 = rect.left + rect.width;
  const y2 = rect.top + rect.height;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    if (point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2) {
      return true;
    }
    const next = points[index + 1];
    if (!next) continue;
    if (
      lineIntersectsLine(point, next, { x: x1, y: y1 }, { x: x2, y: y1 }) ||
      lineIntersectsLine(point, next, { x: x2, y: y1 }, { x: x2, y: y2 }) ||
      lineIntersectsLine(point, next, { x: x2, y: y2 }, { x: x1, y: y2 }) ||
      lineIntersectsLine(point, next, { x: x1, y: y2 }, { x: x1, y: y1 })
    ) {
      return true;
    }
  }
  return false;
}

function pointInPolygon(point: StrokePoint, polygon: StrokePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x <
        ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || Number.EPSILON) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function lineIntersectsLine(a1: StrokePoint, a2: StrokePoint, b1: StrokePoint, b2: StrokePoint): boolean {
  const denominator =
    (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (denominator === 0) return false;
  const ua =
    ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / denominator;
  const ub =
    ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / denominator;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

function finiteBridgeInteger(value: unknown): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return clampBridgeCoordinate(value);
}

function normalizeAnnotationStyle(input: unknown): PreviewCommentSnapshot['style'] {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const style: NonNullable<PreviewCommentSnapshot['style']> = {};
  for (const key of ANNOTATION_STYLE_KEYS) {
    const value = raw[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed) style[key] = trimmed.slice(0, 120);
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

const ANNOTATION_STYLE_KEYS = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'fontFamily',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderRadius',
] as const;

function clampBridgeCoordinate(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-MAX_BRIDGE_COORDINATE, Math.min(MAX_BRIDGE_COORDINATE, Math.round(numeric)));
}

// Shown instead of the React runtime when a .jsx/.tsx is a module loaded by a
// sibling HTML entry (issue #2744): such a file has no standalone component to
// render, so point the user at the page(s) that do. Clicking an entry opens
// (or focuses) that page and closes the now-useless module tab.
function ReactModulePointer({
  entries,
  onOpenEntry,
}: {
  entries: string[];
  onOpenEntry?: (name: string) => void;
}) {
  const t = useT();
  return (
    <div className="viewer-module-pointer" role="note">
      <Icon name="info" size={20} />
      <h2 className="viewer-module-pointer__title">{t('fileViewer.jsxModuleTitle')}</h2>
      <p className="viewer-module-pointer__body">{t('fileViewer.jsxModuleBody')}</p>
      <p className="viewer-module-pointer__cta">{t('fileViewer.jsxModuleCta')}</p>
      <ul className="viewer-module-pointer__entries">
        {entries.map((name) => (
          <li key={name}>
            <button
              type="button"
              className="viewer-module-pointer__link"
              onClick={() => onOpenEntry?.(name)}
              disabled={!onOpenEntry}
            >
              <Icon name="external-link" size={14} />
              <span>{name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReactComponentViewer({
  projectId,
  file,
  onOpenFileReplacing,
}: {
  projectId: string;
  file: ProjectFile;
  onOpenFileReplacing?: (openName: string, closeName: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [source, setSource] = useState<string | null>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const shareRef = useRef<HTMLDivElement | null>(null);
  // HTML entries that load this file as a Babel module. `null` = still
  // checking; `[]` = standalone artifact; non-empty = a module of a
  // multi-file React prototype, which has no standalone preview. Issue #2744.
  const [moduleEntries, setModuleEntries] = useState<string[] | null>(null);
  const isModule = (moduleEntries?.length ?? 0) > 0;

  useEffect(() => {
    setSource(null);
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name).then((text) => {
      if (!cancelled) setSource(text ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey]);

  // Detect whether this .jsx/.tsx is a module loaded by a sibling HTML entry.
  // Runs before any srcdoc is built so a module never flashes the raw
  // "No React component export found" error from the React runtime.
  useEffect(() => {
    setModuleEntries(null);
    let cancelled = false;
    void (async () => {
      try {
        const files = await fetchProjectFiles(projectId);
        const htmlNames = files
          .filter((entry) => /\.html?$/i.test(entry.name))
          .map((entry) => entry.name);
        const htmlSources = new Map<string, string>();
        await Promise.all(
          htmlNames.map(async (name) => {
            const text = await fetchProjectFileText(projectId, name).catch(() => null);
            if (text != null) htmlSources.set(name, text);
          }),
        );
        if (cancelled) return;
        setModuleEntries(findHtmlEntriesReferencing(file.name, htmlSources));
      } catch {
        if (!cancelled) setModuleEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey]);

  useEffect(() => {
    if (!shareMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!shareRef.current) return;
      if (!shareRef.current.contains(e.target as Node)) setShareMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShareMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [shareMenuOpen]);

  const exportTitle = file.name.replace(/\.(jsx|tsx)$/i, '') || file.name;
  const sourceExtension = file.name.toLowerCase().endsWith('.tsx') ? '.tsx' : '.jsx';

  useEffect(() => {
    if (source === null || moduleEntries === null || isModule) {
      // No source yet, still checking module status, or this file is a module
      // with no standalone preview — never build the React runtime srcdoc.
      setSrcDoc('');
      return;
    }

    let cancelled = false;
    const buildSrcDoc = () => {
      const nextSrcDoc = buildReactComponentSrcdoc(source, { title: exportTitle });
      if (!cancelled) setSrcDoc(nextSrcDoc);
    };

    if (source.length > 100_000) {
      setSrcDoc('');
      const timeout = window.setTimeout(buildSrcDoc, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(timeout);
      };
    }

    buildSrcDoc();
    return () => {
      cancelled = true;
    };
  }, [source, exportTitle, moduleEntries, isModule]);

  return (
    <div className="viewer react-component-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <button
            type="button"
            className="icon-only od-tooltip"
            onClick={() => setReloadKey((n) => n + 1)}
            title={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip-placement="bottom"
            aria-label={`${t('fileViewer.reloadAria')} ${t('fileViewer.preview')}`}
          >
            <Icon name="reload" size={14} />
          </button>
          <span className="viewer-meta">
            {t('fileViewer.reactMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <div className="viewer-tabs">
            <button
              type="button"
              className={`viewer-tab ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => setMode('preview')}
            >
              {t('fileViewer.preview')}
            </button>
            <button
              type="button"
              className={`viewer-tab ${mode === 'source' ? 'active' : ''}`}
              onClick={() => setMode('source')}
            >
              {t('fileViewer.source')}
            </button>
          </div>
          {source !== null ? (
            <>
              <span className="viewer-divider" aria-hidden />
              <div className="share-menu" ref={shareRef}>
                <button
                  type="button"
                  className="viewer-action primary viewer-action-export od-tooltip"
                  aria-haspopup="menu"
                  aria-expanded={shareMenuOpen}
                  title={t('fileViewer.shareLabel')}
                  data-tooltip={t('fileViewer.shareLabel')}
                  data-tooltip-placement="bottom"
                  onClick={() => setShareMenuOpen((v) => !v)}
                >
                  <span className="export-action-spacer" aria-hidden />
                  <span>{t('fileViewer.shareLabel')}</span>
                  <RemixIcon name="arrow-down-s-line" size={14} />
                </button>
                {shareMenuOpen ? (
                  <div className="share-menu-popover" role="menu">
                    <div className="share-menu-section-label" role="presentation">
                      {t('common.share')}
                    </div>
                    <button
                      type="button"
                      className="share-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setShareMenuOpen(false);
                        exportAsJsx(source, exportTitle, sourceExtension);
                      }}
                    >
                      <span className="share-menu-icon"><RemixIcon name="file-code-line" size={15} /></span>
                      <span>{t('fileViewer.exportJsx')}</span>
                    </button>
                    <button
                      type="button"
                      className="share-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setShareMenuOpen(false);
                        exportReactComponentAsHtml(source, exportTitle);
                      }}
                    >
                      <span className="share-menu-icon"><RemixIcon name="file-line" size={15} /></span>
                      <span>{t('fileViewer.exportReactHtml')}</span>
                    </button>
                    <div className="share-menu-divider" />
                    <button
                      type="button"
                      className="share-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setShareMenuOpen(false);
                        exportReactComponentAsZip(source, exportTitle, sourceExtension);
                      }}
                    >
                      <span className="share-menu-icon"><RemixIcon name="file-zip-line" size={15} /></span>
                      <span>{t('fileViewer.exportZip')}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="viewer-body">
        {isModule && mode === 'preview' ? (
          // Module of a multi-file prototype: no standalone preview, so the
          // Preview tab shows a pointer to the HTML entry. The Source tab still
          // renders the raw code below. Issue #2744.
          <ReactModulePointer
            entries={moduleEntries ?? []}
            onOpenEntry={(htmlName) => onOpenFileReplacing?.(htmlName, file.name)}
          />
        ) : source === null || (mode === 'preview' && !srcDoc) ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : mode === 'preview' ? (
          <PreviewDrawOverlay>
            <iframe
              data-testid="react-component-preview-frame"
              title={file.name}
              sandbox={previewIframeSandbox()}
              srcDoc={srcDoc}
              style={{ width: '100%', height: '100%', border: 0 }}
            />
          </PreviewDrawOverlay>
        ) : source !== null ? (
          <EditableCodeViewer text={source} readOnly />
        ) : null}
      </div>
    </div>
  );
}

function BinaryViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  return (
    <div className="viewer binary-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.binaryMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body">
        <div className="viewer-empty">
          {t('fileViewer.binaryNote', { size: file.size })}
        </div>
      </div>
    </div>
  );
}

function DocumentPreviewViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    void fetchProjectFilePreview(projectId, file.name).then((next) => {
      if (!cancelled) {
        setPreview(next);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime]);

  return (
    <div className="viewer document-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {documentMetaLabel(file, t)} · {humanSize(file.size)}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body">
        {loading ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : preview ? (
          <div className="document-preview">
            <h2>{preview.title}</h2>
            {preview.sections.map((section, idx) => (
              <section key={`${section.title}-${idx}`}>
                <h3>{section.title}</h3>
                {section.lines.map((line, lineIdx) => (
                  <p key={`${lineIdx}-${line}`}>{line}</p>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        )}
      </div>
    </div>
  );
}

function HtmlViewer({
  projectId,
  projectKind,
  file,
  liveHtml,
  filesRefreshKey = 0,
  isDeck,
  onExportAsPptx,
  streaming,
  commentQueueOnSend = false,
  commentSendDisabled = false,
  previewComments = [],
  onSavePreviewComment,
  onRemovePreviewComment,
  onStageBoardCommentAttachments,
  onSendBoardCommentAttachments,
  onFileSaved,
  commentPortalId,
  onCommentModeChange,
  editPortalId,
  onEditSelectionChange,
  shareRequest,
  slideNavRequest,
  onEditModeChange,
  initialFallbackManualEditMode = false,
  fileViewportPreset,
  onViewportPresetChange,
}: {
  projectId: string;
  projectKind: TrackingProjectKind;
  file: ProjectFile;
  liveHtml?: string;
  filesRefreshKey?: number;
  isDeck: boolean;
  onExportAsPptx?: ((fileName: string) => void) | undefined;
  streaming: boolean;
  commentQueueOnSend?: boolean;
  commentSendDisabled?: boolean;
  previewComments?: PreviewComment[];
  onSavePreviewComment?: (target: PreviewCommentTarget, note: string, attachAfterSave: boolean, images?: File[]) => Promise<PreviewComment | null>;
  onRemovePreviewComment?: (commentId: string) => Promise<void>;
  onStageBoardCommentAttachments?: (attachments: ChatCommentAttachment[]) => Promise<boolean | void> | boolean | void;
  onSendBoardCommentAttachments?: (attachments: ChatCommentAttachment[], images?: File[]) => Promise<boolean | void> | boolean | void;
  onFileSaved?: (event: { fileName: string; reason: HtmlFileSaveReason }) => Promise<void> | void;
  commentPortalId?: string;
  onCommentModeChange?: (active: boolean) => void;
  editPortalId?: string;
  onEditSelectionChange?: (active: boolean) => void;
  shareRequest?: { nonce: number } | null;
  slideNavRequest?: { slideIndex: number; nonce: number } | null;
  onEditModeChange?: (active: boolean) => void;
  // Legacy iframe fallback entry. GrapesJS edit-panel availability is derived
  // from the editor path, not this fallback flag.
  initialFallbackManualEditMode?: boolean;
  fileViewportPreset?: 'desktop' | 'tablet' | 'mobile';
  onViewportPresetChange?: (preset: 'desktop' | 'tablet' | 'mobile') => void;
}) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();
  const htmlFileSaveController = useMemo(() => createHtmlFileSaveController({
    projectId,
    fileName: file.name,
    artifactManifest: file.artifactManifest,
    onSaved: (event) => onFileSaved?.({ fileName: event.file.name, reason: event.reason }),
  }), [projectId, file.name, file.artifactManifest, onFileSaved]);
  // Shared helper for the share menu: emit studio_click share_option on
  // entry and artifact_export_result on resolution. Sync exports report
  // success immediately after the call returns; async exports get .then
  // / .catch. The same request_id threads both events so PostHog can
  // stitch click → result via $insert_id correlation.
  const fireShareExport = (
    format:
      | 'pdf'
      | 'pptx'
      | 'zip'
      | 'html'
      | 'image'
      | 'markdown'
      | 'template'
      | 'share_link'
      | 'share_page'
      | 'vercel'
      | 'cloudflare_pages',
    fn: () => Promise<unknown> | unknown,
  ) => {
    const requestId = analytics.newRequestId();
    const artifactId = anonymizeArtifactId({ projectId, fileName: file.name });
    const artifactKind = artifactKindToTracking({ fileKind: file.kind ?? null });
    // Deploy targets (vercel / cloudflare_pages) are not first-class analytics
    // export formats upstream; collapse them to 'html' for tracking so the
    // share-option funnel stays on the canonical export format axis. 'image'
    // is excluded to match the original tracking surface.
    const deployFormatAlias = 'html' as const;
    const trackingFormat = (
      format === 'vercel' || format === 'cloudflare_pages' || format === 'image'
        ? deployFormatAlias
        : format
    ) as 'pdf' | 'pptx' | 'zip' | 'html' | 'markdown' | 'template' | 'share_link' | 'share_page';
    trackShareOptionPopoverClick(
      analytics.track,
      {
        page_name: 'artifact',
        area: 'share_option_popover',
        artifact_id: artifactId,
        artifact_kind: artifactKind,
        element: trackingFormat,
        project_id: projectId,
        project_kind: projectKind,
      },
      { requestId },
    );
    const started = performance.now();
    const finish = (result: 'success' | 'failed' | 'cancelled', errorCode?: string) => {
      trackArtifactExportResult(
        analytics.track,
        {
          page_name: 'artifact',
          area: 'share_option_popover',
          artifact_id: artifactId,
          artifact_kind: artifactKind,
          project_id: projectId,
          project_kind: projectKind,
          export_format: trackingFormat,
          result,
          ...(errorCode ? { error_code: errorCode } : {}),
          export_duration_ms: Math.round(performance.now() - started),
        },
        { requestId },
      );
    };
    const toastFormats = new Set(['pdf', 'pptx', 'zip', 'html', 'image', 'markdown']);
    try {
      const out = fn();
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        (out as Promise<unknown>).then(
          () => { finish('success'); if (toastFormats.has(format)) setExportToast({ message: t('fileViewer.exportStarted'), tone: 'default' }); },
          (err) => finish('failed', err instanceof Error ? err.name : 'UNKNOWN'),
        );
      } else {
        finish('success');
        if (toastFormats.has(format)) setExportToast({ message: t('fileViewer.exportStarted'), tone: 'default' });
      }
    } catch (err) {
      finish('failed', err instanceof Error ? err.name : 'UNKNOWN');
    }
  };
  // P0 helpers — keep the artifact_id + artifact_kind derivation in one place
  // so each per-button onClick stays a one-liner. We compute lazily inside the
  // closure because `file.kind` / `file.name` can change as the user navigates
  // tabs without remounting HtmlViewer.
  const fireArtifactToolbarClick = (
    element:
      | 'reload'
      | 'preview'
      | 'source'
      | 'tweaks'
      | 'mark'
      | 'comment'
      | 'pods'
      | 'inspect'
      | 'edit'
      | 'zoom_out'
      | 'zoom_level_dropdown'
      | 'zoom_in',
  ) => {
    trackArtifactToolbarClick(analytics.track, {
      page_name: 'artifact',
      area: 'artifact_toolbar',
      element,
      artifact_id: anonymizeArtifactId({ projectId, fileName: file.name }),
      artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
    });
  };
  const fireArtifactHeaderClick = (
    element: 'back' | 'edit' | 'present_dropdown' | 'share_dropdown' | 'settings',
  ) => {
    trackArtifactHeaderClick(analytics.track, {
      page_name: 'artifact',
      area: 'artifact_header',
      element,
      artifact_id: anonymizeArtifactId({ projectId, fileName: file.name }),
      artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
    });
  };
  const firePresentPopoverClick = (
    element: 'in_this_tab' | 'fullscreen' | 'new_tab',
  ) => {
    trackPresentPopoverClick(analytics.track, {
      page_name: 'artifact',
      area: 'present_popover',
      element,
      artifact_id: anonymizeArtifactId({ projectId, fileName: file.name }),
      artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
    });
  };
  const fireCommentPopoverClick = (
    element: 'save_comment' | 'send_to_chat' | 'add_note',
  ) => {
    trackCommentPopoverClick(analytics.track, {
      page_name: 'artifact',
      area: 'comment_popover',
      element,
      artifact_id: anonymizeArtifactId({ projectId, fileName: file.name }),
      artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
    });
  };
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [source, setSource] = useState<string | null>(liveHtml ?? null);
  const [inlinedSource, setInlinedSource] = useState<string | null>(null);
  const [codeDirty, setCodeDirty] = useState(false);
  const codeSavedSourceRef = useRef<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(100);
  const fileViewportKey = previewViewportStateKey(projectId, file);
  const [previewViewport, setPreviewViewportState] = useState<PreviewViewportId>(
    () => resolvePreviewViewportPreset(liveHtml, fileViewportKey, fileViewportPreset),
  );
  const setPreviewViewport = useCallback((viewport: PreviewViewportId) => {
    setPreviewViewportCached(fileViewportKey, viewport);
    setPreviewViewportState(viewport);
  }, [fileViewportKey]);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const [presentMenuOpen, setPresentMenuOpen] = useState(false);
  const [deployMenuOpen, setDeployMenuOpen] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [exportReadyNudge, setExportReadyNudge] = useState(false);
  const exportReadyNudgeSeenRef = useRef<Set<string>>(new Set());
  // Template save UX. We surface a transient "Saved" pill in the share
  // menu so the user gets feedback without a noisy toast layer.
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    const cached = htmlPreviewViewportState.get(fileViewportKey);
    if (cached) {
      setPreviewViewportState(cached);
      return;
    }
    if (fileViewportPreset) {
      setPreviewViewportState(fileViewportPreset);
      return;
    }
    setPreviewViewportState(readViewportPresetFromSource(liveHtml ?? '') ?? 'desktop');
  }, [fileViewportKey, fileViewportPreset, liveHtml]);
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<WebDeploymentInfo | null>(null);
  const [deploymentsByProvider, setDeploymentsByProvider] = useState<Partial<Record<WebDeployProviderId, WebDeploymentInfo>>>({});
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const closeDeployModal = useCallback(() => {
    setDeployModalOpen(false);
  }, []);
  const [deployConfig, setDeployConfig] = useState<WebDeployConfigResponse | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployPhase, setDeployPhase] = useState<'idle' | 'deploying' | 'preparing-link'>('idle');
  const [savingDeployConfig, setSavingDeployConfig] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<WebDeployProjectFileResponse | null>(null);
  const [copiedDeployLink, setCopiedDeployLink] = useState<string | null>(null);
  const [deployProviderId, setDeployProviderId] = useState<WebDeployProviderId>(DEFAULT_DEPLOY_PROVIDER_ID);
  const [projectSocialShare, setProjectSocialShare] = useState<SocialShareResponse | null>(null);
  const [deployToken, setDeployToken] = useState('');
  const [teamId, setTeamId] = useState('');
  const [teamSlug, setTeamSlug] = useState('');
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [cloudflareZones, setCloudflareZones] = useState<CloudflarePagesZoneOption[]>([]);
  const [cloudflareZonesLoading, setCloudflareZonesLoading] = useState(false);
  const [cloudflareZonesError, setCloudflareZonesError] = useState<string | null>(null);
  const [cloudflareZoneId, setCloudflareZoneId] = useState('');
  const [cloudflareDomainPrefix, setCloudflareDomainPrefix] = useState('');
  const deployProviderLoadSeqRef = useRef(0);
  const deployTokenInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!deployModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDeployModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDeployModal, deployModalOpen]);
  const [inTabPresent, setInTabPresent] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [boardMode, setBoardMode] = useState(false);
  const [commentPanelOpen, setCommentPanelOpen] = useState(false);
  const [commentCreateMode, setCommentCreateMode] = useState(false);
  const [boardTool, setBoardTool] = useState<BoardTool>('inspect');
  const [inspectMode, setInspectMode] = useState(false);
  const [agentToolsOpen, setAgentToolsOpen] = useState(false);
  const [drawOverlayOpen, setDrawOverlayOpen] = useState(false);
  // PR2: tweaks availability signal from GrapesjsEditor (replaces the iframe
  // `od:tweaks-available` postMessage). Currently informational — no toolbar
  // toggle ships in this branch — but kept here so a future toggle can read
  // it directly without re-wiring the editor callback.
  const [tweaksAvailable, setTweaksAvailable] = useState(false);
  // PR3: GrapesJS sidebar tab — 'inspect' shows our computed-style snapshot,
  // 'style' shows GrapesJS's explicit-style editor, and 'layers' shows the
  // LayerManager tree. Default to Inspect because generated HTML usually
  // gets its initial values from <style>/<link> rules; native StyleManager
  // only shows explicit declarations and can look empty on first selection.
  const [grapesjsSidebarTab, setGrapesjsSidebarTab] = useState<'layers' | 'style' | 'inspect'>('inspect');
  const grapesjsLayersPanelRef = useRef<HTMLDivElement | null>(null);
  const grapesjsStylePanelRef = useRef<HTMLDivElement | null>(null);
  const [grapesjsSelectionActive, setGrapesjsSelectionActive] = useState(false);
  // Computed-style snapshot of the currently selected element, fed by
  // GrapesjsEditor.onSelectionChange. Drives the Figma-style StylePanel.
  const [grapesjsSelection, setGrapesjsSelection] = useState<SelectionSnapshot | null>(null);
  // Incremented each time the user double-clicks an <img> in the canvas; the
  // StylePanel watches this counter and opens the fill panel's image tab to
  // replace the selected image's src.
  const [imageEditSignal, setImageEditSignal] = useState(0);
  const [grapesjsCanvasTool, setGrapesjsCanvasTool] = useState<GrapesjsCanvasTool>('cursor');
  const [grapesjsShapeMenuOpen, setGrapesjsShapeMenuOpen] = useState(false);
  const [grapesjsShortcutHelpOpen, setGrapesjsShortcutHelpOpen] = useState(false);
  const [grapesjsShortcutGroup, setGrapesjsShortcutGroup] = useState<GrapesjsShortcutGroupId>('arrange');
  const [grapesjsIconLibraryOpen, setGrapesjsIconLibraryOpen] = useState(false);
  const [grapesjsIconLibrary, setGrapesjsIconLibrary] = useState<GrapesjsIconLibraryId | 'all'>('all');
  const [grapesjsIconQuery, setGrapesjsIconQuery] = useState('');
  const [grapesjsIconVariant, setGrapesjsIconVariant] = useState<GrapesjsIconVariant>('linear');
  const [grapesjsIconSize, setGrapesjsIconSize] = useState(24);
  const [grapesjsIconStrokeWidth, setGrapesjsIconStrokeWidth] = useState(2);
  const [grapesjsIconColor, setGrapesjsIconColor] = useState(GRAPESJS_DEFAULT_ICON_COLOR);
  const [grapesjsIconLimit, setGrapesjsIconLimit] = useState(GRAPESJS_ICON_PAGE_SIZE);
  const [grapesjsRemoteIcons, setGrapesjsRemoteIcons] = useState<GrapesjsIconDefinition[]>([]);
  const [grapesjsRemoteIconsLoading, setGrapesjsRemoteIconsLoading] = useState(false);
  const [grapesjsRemoteIconsError, setGrapesjsRemoteIconsError] = useState<string | null>(null);
  const [grapesjsOverlayVersion, setGrapesjsOverlayVersion] = useState(0);
  const grapesjsOverlaySyncRafRef = useRef<number | null>(null);
  const grapesjsBottomToolbarRef = useRef<HTMLDivElement | null>(null);
  const MAX_MANUAL_EDIT_HISTORY = 500;
  // for hint managing hint box state
  const [openHintBox, setOpenHintBox] = useState(true);
  const [manualEditMode, setManualEditModeRaw] = useState(initialFallbackManualEditMode);
  const [manualEditSrcDocActive, setManualEditSrcDocActive] = useState(initialFallbackManualEditMode);
  const [manualEditFrozenSource, setManualEditFrozenSource] = useState<string | null>(null);
  // When a move-element patch saves, the bridge already applied the change
  // optimistically in the iframe DOM. This flag tells the external-change
  // effect to skip the srcDoc rebuild (which would flash and lose selection).
  // Cleared after one suppression so genuine external changes are still handled.
  const skipSrcDocRebuildForMoveRef = useRef(false);
  const [commentPortalHost, setCommentPortalHost] = useState<HTMLElement | null>(null);
  const [manualEditPortalHost, setManualEditPortalHost] = useState<HTMLElement | null>(null);
  // PR3: GrapesJS inspect portal host. When the user activates inspect mode
  // on the GrapesJS path, we portal the sidebar (tabs + Inspect/Style/Layers
  // body) into the same right-panel Edit tab that the iframe manual-edit
  // path uses. This way the "编辑" tab in ProjectView shows the GrapesJS
  // InspectPanel instead of being empty (manualEditMode never becomes true
  // on the GrapesJS path).
  const [grapesjsInspectPortalHost, setGrapesjsInspectPortalHost] = useState<HTMLElement | null>(null);
  const [previewBodyRef, previewBodySize] = usePreviewCanvasSize<HTMLDivElement>();
  const manualEditCanvasRef = useRef<HTMLDivElement | null>(null);
  const manualEditShellRef = useRef<HTMLDivElement | null>(null);
  const [manualEditViewportTransform, setManualEditViewportTransform] = useState<ManualEditViewportTransform>({ x: 0, y: 0 });
  const manualEditViewportTransformRef = useRef<ManualEditViewportTransform>({ x: 0, y: 0 });
  const manualEditViewportCommitTimerRef = useRef<number | null>(null);
  const manualEditPanRef = useRef<{
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [manualEditPanning, setManualEditPanning] = useState(false);
  // Spacebar held → treat left-button drag as pan (Figma-style)
  const manualEditSpaceHeldRef = useRef(false);
  const [manualEditSpaceHeld, setManualEditSpaceHeld] = useState(false);
  useEffect(() => {
    if (!manualEditMode) {
      manualEditSpaceHeldRef.current = false;
      setManualEditSpaceHeld(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && !e.repeat) {
        // Don't capture space when typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        manualEditSpaceHeldRef.current = true;
        setManualEditSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        manualEditSpaceHeldRef.current = false;
        setManualEditSpaceHeld(false);
        // If currently panning via space+drag, finish the pan when space released
        if (manualEditPanRef.current) {
          finishManualEditViewportPan();
        }
      }
    };
    const onBlur = () => {
      manualEditSpaceHeldRef.current = false;
      setManualEditSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [manualEditMode]);
  // Custom viewport dimensions set through the page/canvas size controls.
  // They are scoped by viewport preset so a mobile custom height (e.g. 1344)
  // doesn't accidentally become the desktop canvas size on the next switch.
  const [customViewportSizes, setCustomViewportSizes] = useState<ViewportSizeMap>(
    () => canvasViewportStateFromSource(
      liveHtml ?? '',
      readViewportPresetFromSource(liveHtml ?? '') ?? fileViewportPreset ?? 'desktop',
    ).sizes,
  );
  const activeCustomViewportSize = customViewportSizes[previewViewport] ?? null;
  const activeViewportSize = activeCustomViewportSize ?? presetViewportSize(previewViewport);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const urlPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const srcDocPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const activatedSrcDocTransportHtmlRef = useRef<string | null>(null);
  // Tracks the iframe DOM node whose dedupe ref was last reset by the
  // srcDoc onLoad handler. We reset the dedupe exactly once per freshly
  // mounted iframe (the first load is the shell HTML), and skip every
  // subsequent load on the same node (those are our own
  // document.open/write/close inside the shell). See onLoad below for
  // the infinite-loop story (issue #2361).
  const srcDocFrameDedupeResetForRef = useRef<HTMLIFrameElement | null>(null);
  const isActivePreviewIframeSource = useCallback((source: MessageEventSource | null) => {
    return !!source && source === iframeRef.current?.contentWindow;
  }, []);
  const isOurPreviewIframeSource = useCallback((source: MessageEventSource | null) => {
    if (!source) return false;
    return (
      source === iframeRef.current?.contentWindow ||
      source === urlPreviewIframeRef.current?.contentWindow ||
      source === srcDocPreviewIframeRef.current?.contentWindow
    );
  }, []);
  useEffect(() => {
    const resetTransform = { x: 0, y: 0 };
    if (manualEditViewportCommitTimerRef.current !== null) {
      window.clearTimeout(manualEditViewportCommitTimerRef.current);
      manualEditViewportCommitTimerRef.current = null;
    }
    manualEditViewportTransformRef.current = resetTransform;
    manualEditPanRef.current = null;
    setManualEditViewportTransform(resetTransform);
    setManualEditPanning(false);
  }, [file.name, manualEditMode, previewViewport]);
  useEffect(() => () => {
    if (manualEditViewportCommitTimerRef.current !== null) {
      window.clearTimeout(manualEditViewportCommitTimerRef.current);
    }
  }, []);
  const previewScrollRestoreRef = useRef<{
    hostLeft: number;
    hostTop: number;
    frameLeft: number;
    frameTop: number;
    canvasLeft: number;
    canvasTop: number;
    expiresAt: number;
  } | null>(null);
  const previewScrollPositionRef = useRef({
    frameLeft: 0,
    frameTop: 0,
    canvasLeft: 0,
    canvasTop: 0,
  });
  const previewScrollRequestAtRef = useRef(0);
  const dcViewportRef = useRef({
    x: 0,
    y: 0,
    scale: 1,
  });
  const dcViewportRestoreAtRef = useRef(0);
  const setManualEditMode = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setManualEditModeRaw((prev) => {
      const value = typeof next === 'function' ? (next as (p: boolean) => boolean)(prev) : next;
      return value;
    });
  }, []);
  // Keep manualEditSrcDocActive in sync with manualEditMode so the edit bridge
  // script is injected/removed from the srcDoc when the user toggles via the toolbar.
  useEffect(() => {
    setManualEditSrcDocActive(manualEditMode);
  }, [manualEditMode]);
  useEffect(() => {
    setManualEditSrcDocActive(initialFallbackManualEditMode);
    setManualEditFrozenSource(null);
  }, [initialFallbackManualEditMode, projectId, file.name]);
  useEffect(() => {
    onCommentModeChange?.(commentPanelOpen);
  }, [commentPanelOpen, onCommentModeChange]);
  useEffect(() => () => {
    onCommentModeChange?.(false);
  }, [onCommentModeChange]);
  useEffect(() => {
    onEditModeChange?.(manualEditMode);
  }, [manualEditMode, onEditModeChange]);
  useEffect(() => () => {
    onEditModeChange?.(false);
  }, [onEditModeChange]);
  useEffect(() => {
    if (!manualEditMode || !editPortalId) {
      setManualEditPortalHost(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    const findHost = () => {
      if (cancelled) return;
      const host = document.getElementById(editPortalId);
      setManualEditPortalHost(host);
      if (!host) raf = window.requestAnimationFrame(findHost);
    };
    findHost();
    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
      setManualEditPortalHost(null);
    };
  }, [editPortalId, manualEditMode]);
  useEffect(() => {
    if (!commentPanelOpen || !commentPortalId) {
      setCommentPortalHost(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    const findHost = () => {
      if (cancelled) return;
      const host = document.getElementById(commentPortalId);
      setCommentPortalHost(host);
      if (!host) raf = window.requestAnimationFrame(findHost);
    };
    findHost();
    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
      setCommentPortalHost(null);
    };
  }, [commentPanelOpen, commentPortalId]);
  const capturePreviewScrollPosition = useCallback(() => {
    const host = previewBodyRef.current;
    let frameLeft = 0;
    let frameTop = 0;
    let canvasLeft = 0;
    let canvasTop = 0;
    try {
      const frameDocument = iframeRef.current?.contentWindow?.document;
      const frameScroll = frameDocument?.scrollingElement;
      const canvasScroll = frameDocument?.querySelector<HTMLElement>('.design-canvas');
      frameLeft = frameScroll?.scrollLeft ?? 0;
      frameTop = frameScroll?.scrollTop ?? 0;
      canvasLeft = canvasScroll?.scrollLeft ?? 0;
      canvasTop = canvasScroll?.scrollTop ?? 0;
    } catch {
      frameLeft = 0;
      frameTop = 0;
      canvasLeft = 0;
      canvasTop = 0;
    }
    previewScrollRestoreRef.current = {
      hostLeft: host?.scrollLeft ?? 0,
      hostTop: host?.scrollTop ?? 0,
      frameLeft: frameLeft || previewScrollPositionRef.current.frameLeft,
      frameTop: frameTop || previewScrollPositionRef.current.frameTop,
      canvasLeft: canvasLeft || previewScrollPositionRef.current.canvasLeft,
      canvasTop: canvasTop || previewScrollPositionRef.current.canvasTop,
      expiresAt: Date.now() + 5000,
    };
  }, []);
  const restorePreviewScrollPosition = useCallback(() => {
    const snapshot = previewScrollRestoreRef.current;
    if (!snapshot) return;
    if (Date.now() > snapshot.expiresAt) {
      previewScrollRestoreRef.current = null;
      return;
    }
    const apply = () => {
      const previewBody = previewBodyRef.current;
      if (typeof previewBody?.scrollTo === 'function') {
        previewBody.scrollTo(snapshot.hostLeft, snapshot.hostTop);
      }
      try {
        const frameDocument = iframeRef.current?.contentWindow?.document;
        frameDocument?.scrollingElement?.scrollTo(snapshot.frameLeft, snapshot.frameTop);
        frameDocument?.querySelector<HTMLElement>('.design-canvas')?.scrollTo(snapshot.canvasLeft, snapshot.canvasTop);
        iframeRef.current?.contentWindow?.postMessage({
          type: 'od:preview-scroll-restore',
          frameLeft: snapshot.frameLeft,
          frameTop: snapshot.frameTop,
          canvasLeft: snapshot.canvasLeft,
          canvasTop: snapshot.canvasTop,
        }, '*');
      } catch {}
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        apply();
        window.setTimeout(apply, 80);
        window.setTimeout(() => {
          if (previewScrollRestoreRef.current === snapshot) {
            apply();
          }
        }, 260);
      });
    });
  }, []);
  const [manualEditTargets, setManualEditTargets] = useState<ManualEditTarget[]>([]);
  const [selectedManualEditTarget, setSelectedManualEditTarget] = useState<ManualEditTarget | null>(null);
  const [selectedManualEditTargets, setSelectedManualEditTargets] = useState<ManualEditTarget[]>([]);
  const selectedManualEditTargetId = selectedManualEditTarget?.id ?? null;
  useEffect(() => {
    onEditSelectionChange?.(manualEditMode && selectedManualEditTargetId !== null);
  }, [manualEditMode, onEditSelectionChange, selectedManualEditTargetId]);
  useEffect(() => () => {
    onEditSelectionChange?.(false);
  }, [onEditSelectionChange]);
  const [manualEditHoverTarget, setManualEditHoverTarget] = useState<ManualEditTarget | null>(null);
  const [manualEditPageStylesOpen, setManualEditPageStylesOpen] = useState(false);
  // Auto-open page styles when entering edit mode so the inspector panel
  // always shows useful content (background, font, canvas dimensions) even
  // before the user selects an element.
  useEffect(() => {
    if (manualEditMode) setManualEditPageStylesOpen(true);
  }, [manualEditMode]);
  const [manualEditPanelPosition, setManualEditPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const selectedManualEditTargetIdRef = useRef<string | null>(null);
  const [manualEditDraft, setManualEditDraft] = useState<ManualEditDraft>(() => emptyManualEditDraft());
  const [manualEditHistory, setManualEditHistory] = useState<ManualEditHistoryEntry[]>([]);
  const [manualEditUndone, setManualEditUndone] = useState<ManualEditHistoryEntry[]>([]);
  const [manualEditError, setManualEditError] = useState<string | null>(null);
  const [manualEditSaving, setManualEditSaving] = useState(false);
  const [manualEditUndoLimitToast, setManualEditUndoLimitToast] = useState(false);
  const selectedManualEditTargetsRef = useRef<ManualEditTarget[]>([]);
  const manualEditSavingRef = useRef(false);
  const manualEditHistoryRef = useRef(manualEditHistory);
  const manualEditUndoneRef = useRef(manualEditUndone);
  manualEditHistoryRef.current = manualEditHistory;
  manualEditUndoneRef.current = manualEditUndone;
  const manualEditHistoryCacheRef = useRef<Map<string, { history: ManualEditHistoryEntry[]; undone: ManualEditHistoryEntry[] }>>(new Map());
  const manualEditFlushAfterSaveRef = useRef(false);
  const manualEditPendingStyleRef = useRef<ManualEditPendingStyleSave | null>(null);
  const manualEditStyleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualEditPreviewVersionRef = useRef(0);
  const sourceRef = useRef<string | null>(source);
  const manualEditSourceRoundTripRef = useRef(emptyManualEditSourceRoundTrip());
  const sourceFileKeyRef = useRef<string | null>(null);
  const manualEditResetFileKeyRef = useRef(`${projectId}\0${file.name}`);
  useEffect(() => {
    manualEditSourceRoundTripRef.current = emptyManualEditSourceRoundTrip();
  }, [initialFallbackManualEditMode, projectId, file.name]);
  const templateNameId = useId();
  const templateDescriptionId = useId();
  const imageExportTitleId = useId();
  // Opt back into the legacy inline-asset srcDoc path via `?forceInline=1`
  // on the host page. Lets users escape-hatch around the URL-load default
  // for non-deck HTML that depends on the in-iframe localStorage shim.
  const forceInline = useMemo(
    () => (typeof window === 'undefined' ? false : parseForceInline(window.location.search)),
    [],
  );
  const [activeCommentTarget, setActiveCommentTarget] = useState<PreviewCommentSnapshot | null>(null);
  const [hoveredCommentTarget, setHoveredCommentTarget] = useState<PreviewCommentSnapshot | null>(null);
  // True while the pointer is physically over the floating hover card. The card
  // sits on top of the preview iframe, so reaching it makes the iframe fire a
  // mouseout -> od:comment-leave. We ignore that leave while pinned so the card
  // (and its selectable values) stays put instead of unmounting and flickering.
  // The pointer cannot be over the iframe and the host card at once, so a fresh
  // od:comment-hover never races this; only the card's own leave clears it.
  const hoverCardPinnedRef = useRef(false);
  // Tearing the card down is always deferred by a beat rather than done
  // synchronously. The iframe's mouseout (od:comment-leave) arrives async via
  // postMessage; the card's own mouseenter and the next od:comment-hover are the
  // signals that the pointer actually landed on the card or back on the element
  // it overlaps. Deferring lets those cancel the dismiss before it lands.
  // Synchronous teardown raced ahead of them: the card flickered on the way in
  // and vanished the moment you moved off it back onto the element it described.
  const hoverCardDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHoverCardDismiss = useCallback(() => {
    if (hoverCardDismissTimerRef.current !== null) {
      clearTimeout(hoverCardDismissTimerRef.current);
      hoverCardDismissTimerRef.current = null;
    }
  }, []);
  const scheduleHoverCardDismiss = useCallback(() => {
    if (hoverCardDismissTimerRef.current !== null) clearTimeout(hoverCardDismissTimerRef.current);
    hoverCardDismissTimerRef.current = setTimeout(() => {
      hoverCardDismissTimerRef.current = null;
      // hoverCardPinnedRef tracks "pointer is physically over the card". If it
      // got (re-)pinned while we waited, this now-stale dismiss must not fire.
      if (!hoverCardPinnedRef.current) setHoveredCommentTarget(null);
    }, HOVER_CARD_DISMISS_DELAY_MS);
  }, []);
  const [hoveredPodMemberId, setHoveredPodMemberId] = useState<string | null>(null);
  // If the card unmounts for any other reason while the pointer is still over
  // it (its onMouseLeave never fires), drop the pin so later leaves dismiss
  // normally instead of being swallowed forever.
  useEffect(() => {
    if (!hoveredCommentTarget) hoverCardPinnedRef.current = false;
  }, [hoveredCommentTarget]);
  // Don't let a pending dismiss outlive the component.
  useEffect(() => cancelHoverCardDismiss, [cancelHoverCardDismiss]);
  const [activePreviewCommentId, setActivePreviewCommentId] = useState<string | null>(null);
  const [liveCommentTargets, setLiveCommentTargets] = useState<Map<string, PreviewCommentSnapshot>>(() => new Map());
  const liveCommentTargetsRef = useRef(liveCommentTargets);
  const [commentOrderIds, setCommentOrderIds] = useState<string[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  // Inspect mode shares the iframe selection bridge with comment mode but
  // routes the picked element to a side panel that mutates per-element CSS
  // overrides via postMessage. The host owns the authoritative override map:
  // it is hydrated from the artifact's persisted <style> block on load and
  // mutated only by host-driven onApply / reset actions. Save-to-source
  // serializes that host map directly — iframe od:inspect-overrides messages
  // are preview acknowledgements and never feed save input, so artifact JS
  // forging a postMessage cannot tamper with what gets persisted.
  const [activeInspectTarget, setActiveInspectTarget] = useState<InspectTarget | null>(null);
  const [inspectOverrides, setInspectOverrides] = useState<InspectOverrideMap>(() =>
    typeof source === 'string' ? parseInspectOverridesFromSource(source) : {},
  );
  // Track which `source` value the host map was last hydrated from so the
  // setState-during-render hydration below only fires when the artifact
  // text actually changes (file switch, save round-trip, live edits). The
  // ref is initialised to `source` so the matching useState initialiser
  // above counts as the first hydration.
  const inspectHydratedSourceRef = useRef<string | null | undefined>(source);
  const [savingInspect, setSavingInspect] = useState(false);
  const [inspectSavedAt, setInspectSavedAt] = useState<number | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [queuedBoardNotes, setQueuedBoardNotes] = useState<string[]>([]);
  // Images attached to an element comment ("评论此元素"). Kept as raw Files
  // (uploaded on send) with object-URL thumbnails for preview/remove, mirroring
  // the markup overlay's image tray.
  const [boardImages, setBoardImages] = useState<File[]>([]);
  const [activeCommentExistingAttachments, setActiveCommentExistingAttachments] =
    useState<PreviewCommentAttachment[]>([]);
  const [boardImagePreviews, setBoardImagePreviews] = useState<{ file: File; url: string }[]>([]);
  const [boardPreviewIndex, setBoardPreviewIndex] = useState<number | null>(null);
  const [sendingBoardBatch, setSendingBoardBatch] = useState(false);
  useEffect(() => {
    const next = boardImages.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setBoardImagePreviews(next);
    return () => {
      next.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [boardImages]);
  const [commentSavedToast, setCommentSavedToast] = useState<string | null>(null);
  const [templateSavedToast, setTemplateSavedToast] = useState<string | null>(null);
  const [deploySavedToast, setDeploySavedToast] = useState<{ message: string; details: string } | null>(null);
  const [deployActionToast, setDeployActionToast] = useState<string | null>(null);
  const [imageExportModalOpen, setImageExportModalOpen] = useState(false);
  const [imageExportFormat, setImageExportFormat] = useState<ImageExportFormat>('png');
  const [imageExportBusy, setImageExportBusy] = useState(false);
  const [imageExportPreparing, setImageExportPreparing] = useState(false);
  const [imageExportError, setImageExportError] = useState<string | null>(null);
  const [imageExportSavedToast, setImageExportSavedToast] = useState<{ message: string; details: string } | null>(null);
  const [imageExportPreparedBlob, setImageExportPreparedBlob] = useState<{ format: ImageExportFormat; blob: Blob } | null>(null);
  const imageExportSnapshotDataUrlRef = useRef<string | null>(null);
  const imageExportPrepareIdRef = useRef(0);
  const screenshotInFlightRef = useRef(false);
  const [exportToast, setExportToast] = useState<
    { message: string; tone: 'default' | 'success' | 'error' | 'loading' } | null
  >(null);
  const [shareLinkFeedback, setShareLinkFeedback] = useState<'copied' | 'failed' | null>(null);
  const [shareGuideToast, setShareGuideToast] = useState<string | null>(null);
  const [selectedSideCommentIds, setSelectedSideCommentIds] = useState<Set<string>>(() => new Set());
  const [commentSidePanelCollapsed, setCommentSidePanelCollapsed] = useState(false);
  const [strokePoints, setStrokePoints] = useState<StrokePoint[]>([]);
  const previewStateKey = `${projectId}:${file.name}`;
  const previewScale = zoom / 100;

  const localCommentSideDockActive = commentPanelOpen && !commentPortalHost;
  const boardPreviewCanvasSize = commentPreviewCanvasSize(previewBodySize, {
    boardMode: localCommentSideDockActive,
    sidePanelCollapsed: commentSidePanelCollapsed,
    viewport: previewViewport,
  });
  const boardSideDockStacked = usesStackedCommentSideDock(previewBodySize, {
    boardMode: localCommentSideDockActive,
    sidePanelCollapsed: commentSidePanelCollapsed,
    viewport: previewViewport,
  });

  function deploymentMapForCurrentFile(items: WebDeploymentInfo[]) {
    const next: Partial<Record<WebDeployProviderId, WebDeploymentInfo>> = {};
    for (const option of DEPLOY_PROVIDER_OPTIONS) {
      const deploymentForProvider = items
        .filter((item) => item.fileName === file.name && item.providerId === option.id && item.url?.trim())
        .sort(compareDeploymentsByNewest)[0];
      if (deploymentForProvider) next[option.id] = deploymentForProvider;
    }
    return next;
  }

  function syncDeployFormFromConfig(
    providerId: WebDeployProviderId,
    config: WebDeployConfigResponse | null,
  ) {
    const matchingConfig = config?.providerId === providerId ? config : null;
    setDeployProviderId(providerId);
    setDeployConfig(matchingConfig);
    setDeployToken(matchingConfig?.tokenMask || '');
    setTeamId(matchingConfig?.teamId || '');
    setTeamSlug(matchingConfig?.teamSlug || '');
    setCloudflareAccountId(matchingConfig?.accountId || '');
    setCloudflareZoneId(matchingConfig?.cloudflarePages?.lastZoneId || '');
    setCloudflareDomainPrefix(matchingConfig?.cloudflarePages?.lastDomainPrefix || '');
  }

  function cloudflareConfigHintsFromForm() {
    const zone = cloudflareZones.find((item) => item.id === cloudflareZoneId);
    const hints = {
      ...(cloudflareZoneId.trim() ? { lastZoneId: cloudflareZoneId.trim() } : {}),
      ...((zone?.name || deployConfig?.cloudflarePages?.lastZoneName)
        ? { lastZoneName: zone?.name || deployConfig?.cloudflarePages?.lastZoneName }
        : {}),
      ...(cloudflareDomainPrefix.trim()
        ? { lastDomainPrefix: normalizeCloudflareDomainPrefixInput(cloudflareDomainPrefix) }
        : {}),
    };
    return Object.keys(hints).length > 0 ? hints : undefined;
  }

  function buildDeployConfigRequest(providerId: WebDeployProviderId): WebUpdateDeployConfigRequest {
    const token = deployToken.trim();
    if (providerId === CLOUDFLARE_PAGES_PROVIDER_ID) {
      return {
        providerId,
        token,
        accountId: cloudflareAccountId.trim(),
        cloudflarePages: cloudflareConfigHintsFromForm(),
      };
    }
    return {
      providerId,
      token,
      teamId: teamId.trim(),
      teamSlug: teamSlug.trim(),
    };
  }

  async function loadDeployProvider(
    providerId: WebDeployProviderId,
    options?: { fallbackToExisting?: boolean },
  ) {
    const requestSeq = ++deployProviderLoadSeqRef.current;
    setDeployProviderId(providerId);
    const deployments = await fetchProjectDeployments(projectId);
    const nextDeploymentsByProvider = deploymentMapForCurrentFile(deployments);
    const exactDeployment = nextDeploymentsByProvider[providerId] ?? null;
    const fallbackDeployment = options?.fallbackToExisting
      ? Object.values(nextDeploymentsByProvider)[0] ?? null
      : null;
    const currentDeployment = exactDeployment ?? fallbackDeployment;
    // Use the explicit providerId for config/form so a fallback deployment from
    // another provider only fills the existing-URL display, never the form/credentials.
    const config = await fetchDeployConfig(providerId);
    if (requestSeq !== deployProviderLoadSeqRef.current) {
      return { config: null, currentDeployment: null };
    }
    syncDeployFormFromConfig(providerId, config);
    setDeploymentsByProvider(nextDeploymentsByProvider);
    setDeployment(currentDeployment ?? null);
    setDeployResult(currentDeployment ?? null);
    if (providerId === CLOUDFLARE_PAGES_PROVIDER_ID && config?.configured) {
      void loadCloudflareZones(config, { requestSeq });
    }
    return { config, currentDeployment };
  }

  async function loadCloudflareZones(
    config: WebDeployConfigResponse | null = deployConfig,
    options?: { requestSeq?: number },
  ) {
    if (!config?.configured || config.providerId !== CLOUDFLARE_PAGES_PROVIDER_ID) return;
    const requestSeq = options?.requestSeq ?? deployProviderLoadSeqRef.current;
    setCloudflareZonesLoading(true);
    setCloudflareZonesError(null);
    try {
      const response = await fetchCloudflarePagesZones();
      if (requestSeq !== deployProviderLoadSeqRef.current) return;
      const zones = response?.zones ?? [];
      setCloudflareZones(zones);
      const hintedZoneId = response?.cloudflarePages?.lastZoneId || config.cloudflarePages?.lastZoneId || '';
      const nextZoneId = hintedZoneId && zones.some((zone) => zone.id === hintedZoneId)
        ? hintedZoneId
        : zones[0]?.id || '';
      setCloudflareZoneId(nextZoneId);
      const hintedPrefix = response?.cloudflarePages?.lastDomainPrefix || config.cloudflarePages?.lastDomainPrefix || '';
      if (hintedPrefix) setCloudflareDomainPrefix(hintedPrefix);
    } catch (err) {
      if (requestSeq !== deployProviderLoadSeqRef.current) return;
      setCloudflareZones([]);
      setCloudflareZonesError(err instanceof Error ? err.message : t('fileViewer.cloudflareZonesLoadFailed'));
    } finally {
      if (requestSeq === deployProviderLoadSeqRef.current) setCloudflareZonesLoading(false);
    }
  }

  // Slide deck nav state: the iframe posts the active index + total count
  // back to the host every time a slide settles. Host renders prev/next
  // controls in the toolbar and reflects the count beside them.
  const [slideState, setSlideState] = useState<SlideState | null>(
    () => htmlPreviewSlideState.get(previewStateKey) ?? null,
  );
  const boardPreviewScaleOptions = localCommentSideDockActive ? { canvasPadding: 0 } : undefined;
  const overlayPreviewScale = effectivePreviewScale(
    previewViewport,
    previewScale,
    boardPreviewCanvasSize,
    boardPreviewScaleOptions,
  );
  const overlayPreviewTransform: PreviewOverlayTransform = {
    scale: overlayPreviewScale,
    offsetX: 0,
    offsetY: 0,
  };
  const shareRef = useRef<HTMLDivElement | null>(null);
  const [chromeActionsHost, setChromeActionsHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setChromeActionsHost(resolveChromeActionsHost());
  }, []);

  useEffect(() => {
    liveCommentTargetsRef.current = liveCommentTargets;
  }, [liveCommentTargets]);

  useEffect(() => {
    const sourceFileKey = `${projectId}\0${file.name}\0${liveHtml === undefined ? 'raw' : 'live'}`;
    if (liveHtml !== undefined) {
      sourceFileKeyRef.current = sourceFileKey;
      setSource(liveHtml);
      sourceRef.current = liveHtml;
      const savedPreset = readViewportPresetFromSource(liveHtml);
      const resolvedViewport = resolvePreviewViewportPreset(liveHtml, fileViewportKey, fileViewportPreset);
      const canvasState = canvasViewportStateFromSource(liveHtml, savedPreset ?? resolvedViewport);
      setCustomViewportSizes(canvasState.sizes);
      setPreviewViewportState(resolvedViewport);
      return;
    }
    const fileChanged = sourceFileKeyRef.current !== sourceFileKey;
    sourceFileKeyRef.current = sourceFileKey;
    if (fileChanged) {
      setSource(null);
      sourceRef.current = null;
      setCustomViewportSizes({});
    }
    let cancelled = false;
    // Cache-bust the fetch on every mtime / reload / files-refresh bump.
    // Without this, an agent edit during Comment mode (srcDoc path) gets
    // stale HTML from the browser HTTP cache — the source state ends up
    // identical to the previous value, srcDoc is byte-equal to the last
    // activated HTML, canActivateSrcDocTransport bails on the dedupe
    // check, and the preview only refreshes when Comment closes and the
    // url-load iframe takes over with its own ?v=mtime cache-bust.
    void fetchProjectFileText(projectId, file.name, {
      cacheBustKey: `${file.mtime}-${reloadKey}-${filesRefreshKey}`,
    }).then((text) => {
      if (cancelled) return;
      // Chokidar emits agent rewrites as unlink+add+change bursts; a
      // transient null mid-burst would blank source → srcDoc empty →
      // shell stays on prior frame. Keep the last good text instead.
      if (text == null) return;
      setSource(text);
      sourceRef.current = text;
      const savedPreset = readViewportPresetFromSource(text);
      const resolvedViewport = resolvePreviewViewportPreset(text, fileViewportKey, fileViewportPreset);
      const canvasState = canvasViewportStateFromSource(text, savedPreset ?? resolvedViewport);
      setCustomViewportSizes(canvasState.sizes);
      setPreviewViewportState(resolvedViewport);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, liveHtml, reloadKey, filesRefreshKey, fileViewportKey, fileViewportPreset]);

  useEffect(() => {
    let cancelled = false;
    setDeployResult(null);
    setDeployError(null);
    setCopiedDeployLink(null);
    setDeployPhase('idle');
    void fetchProjectDeployments(projectId).then((items) => {
      if (cancelled) return;
      const nextDeploymentsByProvider = deploymentMapForCurrentFile(items);
      const current = nextDeploymentsByProvider[deployProviderId] ?? null;
      setDeploymentsByProvider(nextDeploymentsByProvider);
      setDeployment(current ?? null);
      setDeployResult(current ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, deployProviderId]);

  const effectiveDeck = isDeck;
  const livePreviewSource = inlinedSource ?? source;
  const reloadHtmlPreviewRef = useRef<() => void>(() => undefined);
  // Freeze the iframe input on the snapshot taken at Edit-mode entry. Any
  // debounced source rewrites during edit stay
  // invisible to the iframe — live updates flow through od-edit-preview-style
  // postMessage instead, so the canvas never has to reload.
  useEffect(() => {
    if (manualEditMode && manualEditFrozenSource === null && livePreviewSource != null) {
      manualEditSourceRoundTripRef.current = enterManualEditSourceRoundTrip(sourceRef.current);
      setManualEditFrozenSource(livePreviewSource);
    }
  }, [manualEditMode, manualEditFrozenSource, livePreviewSource]);
  // Local edits update the iframe optimistically and save in the background.
  // Keep their source-state and mtime round trips away from srcDoc so the
  // active document, selection, and scroll position survive. Only a source
  // value that differs from the latest locally saved snapshot is treated as
  // an external rewrite and allowed to advance the frozen document.
  useEffect(() => {
    if (!manualEditMode || manualEditFrozenSource == null || livePreviewSource == null) return;
    if (livePreviewSource === manualEditFrozenSource) return;
    const reconcile = reconcileManualEditSourceRoundTrip(
      manualEditSourceRoundTripRef.current,
      sourceRef.current,
    );
    manualEditSourceRoundTripRef.current = reconcile.next;
    if (!reconcile.shouldAdvanceFrozenSource) return;
    if (reconcile.externalRewrite) {
      skipSrcDocRebuildForMoveRef.current = false;
    }
    setManualEditFrozenSource(livePreviewSource);
  }, [manualEditMode, manualEditFrozenSource, livePreviewSource]);
  const previewSource = (manualEditMode && manualEditFrozenSource !== null)
    ? manualEditFrozenSource
    : livePreviewSource;
  const manualEditPageStylesEnabled = typeof source === 'string' && isManualEditFullHtmlDocument(source);
  const urlModeBridge = hasUrlModeBridge(source);
  const manualEditRequiresSrcDoc = manualEditSrcDocActive && !urlModeBridge;
  // When we URL-load the iframe directly, skip every in-host inlining /
  // srcDoc-rebuilding step. The browser does the asset resolution itself,
  // which is the whole point of the URL-load path.
  // Auto-fall back to the srcDoc path when the artifact will crash under
  // the URL-load iframe's bare `sandbox="allow-scripts"` — Babel-standalone
  // React prototypes and any HTML that reads Web Storage at mount throw
  // SecurityError without `allow-same-origin`. The srcDoc path runs
  // `injectSandboxShim` before any user script, so those artifacts render.
  // Memoized on `source` so HtmlViewer's frequent re-renders (board/inspect/
  // edit mode toggles, slide nav) don't re-scan the HTML each time.
  const needsSandboxShim = useMemo(
    () => source != null && htmlNeedsSandboxShim(source),
    [source],
  );
  const needsFocusGuard = useMemo(
    () => source != null && htmlNeedsFocusGuard(source),
    [source],
  );
  const tweaksBridge = useMemo(
    () => hasTweaksTemplate(source),
    [source],
  );
  const runtimeScript = useMemo(
    () => htmlHasRuntimeScript(source),
    [source],
  );
  const [urlSelectionBridgeReady, setUrlSelectionBridgeReady] = useState(false);
  // The preview tree stays mounted while the source editor is visible. Keep
  // its transport decision stable too, otherwise switching tabs would still
  // blank the URL iframe and rebuild the srcDoc iframe behind the hidden UI.
  const useUrlLoadPreview = shouldUrlLoadHtmlPreview({
    mode: 'preview',
    isDeck: effectiveDeck,
    commentMode: boardMode,
    urlCommentBridge: urlSelectionBridgeReady,
    editMode: manualEditMode,
    urlModeBridge,
    inspectMode,
    drawMode: drawOverlayOpen,
    tweaksBridge,
    forceInline: forceInline || needsSandboxShim,
    needsFocusGuard,
  }) && !manualEditRequiresSrcDoc;
  // PR3: route HTML previews through the GrapesJS canvas by default. Only
  // load-bearing cases GrapesJS cannot represent yet (deck, multi-file
  // modules, React-component renderer, forceInline, Babel/focus guard)
  // stay on the iframe path.
  const useGrapesjs = shouldUseGrapesjs({
    mode,
    isDeck: effectiveDeck,
    isModule: false,
    commentMode: boardMode,
    inspectMode,
    drawMode: drawOverlayOpen,
    paletteActive: false,
    tweaksBridge,
    isReactComponent: false,
    runtimeScript,
    forceInline,
    needsSandboxShim,
    needsFocusGuard,
  });
  const fallbackManualEditMode = manualEditMode && !useGrapesjs;
  // PR3: while the GrapesJS canvas owns the HTML preview, mark the Edit tab
  // as available up front. The actual auto-switch still happens on element
  // selection via onEditSelectionChange, but pre-mounting the host avoids a
  // race where StyleManager/Layers render before the portal container exists.
  useEffect(() => {
    if (!useGrapesjs || mode !== 'preview') return;
    onEditModeChange?.(true);
    return () => {
      onEditModeChange?.(false);
    };
  }, [mode, onEditModeChange, useGrapesjs]);
  // PR3: on the GrapesJS path, treat an active GrapesJS selection as the
  // equivalent of a manual-edit selection so ProjectView auto-switches
  // to the right-panel Edit tab and shows the portalled sidebar.
  useEffect(() => {
    if (!useGrapesjs) return;
    if (boardMode || drawOverlayOpen) {
      onEditSelectionChange?.(false);
      return;
    }
    onEditSelectionChange?.(grapesjsSelectionActive);
  }, [boardMode, drawOverlayOpen, grapesjsSelectionActive, onEditSelectionChange, useGrapesjs]);
  useEffect(() => {
    if (useGrapesjs) return;
    setGrapesjsSelectionActive(false);
    setGrapesjsCanvasTool('cursor');
    setGrapesjsShapeMenuOpen(false);
  }, [useGrapesjs]);
  const scheduleGrapesjsOverlaySync = useCallback(() => {
    if (typeof window === 'undefined') {
      setGrapesjsOverlayVersion((current) => (current + 1) % 1_000_000);
      return;
    }
    if (grapesjsOverlaySyncRafRef.current !== null) return;
    grapesjsOverlaySyncRafRef.current = window.requestAnimationFrame(() => {
      grapesjsOverlaySyncRafRef.current = null;
      setGrapesjsOverlayVersion((current) => (current + 1) % 1_000_000);
    });
  }, []);
  useEffect(() => () => {
    if (grapesjsOverlaySyncRafRef.current !== null) {
      window.cancelAnimationFrame(grapesjsOverlaySyncRafRef.current);
      grapesjsOverlaySyncRafRef.current = null;
    }
  }, []);
  // PR3: locate the edit portal host for GrapesJS. Same DOM lookup pattern
  // as the manualEdit branch, but active for the whole GrapesJS preview path
  // so the right-panel Edit tab is ready before the first element click.
  useEffect(() => {
    if (!useGrapesjs || mode !== 'preview' || !editPortalId) {
      setGrapesjsInspectPortalHost(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    const findHost = () => {
      if (cancelled) return;
      const host = document.getElementById(editPortalId);
      setGrapesjsInspectPortalHost(host);
      if (!host) raf = window.requestAnimationFrame(findHost);
    };
    findHost();
    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
      setGrapesjsInspectPortalHost(null);
    };
  }, [editPortalId, mode, useGrapesjs]);
  // Drive the GrapesJS canvas frame when the viewport switch changes (desktop/
  // tablet/mobile). On the non-GrapesJS path the legacy previewViewportStyle
  // handles the frame; on the GrapesJS path we set the editor device size.
  // Custom viewport sizes (set via PageInspector) override preset dimensions.
  useEffect(() => {
    if (!useGrapesjs || mode !== 'preview') return;
    grapesjsSelectionStoreRef.current.invalidate();
    grapesjsEditorRef.current?.setViewport(activeViewportSize.width, activeViewportSize.height);
  }, [previewViewport, activeViewportSize.width, activeViewportSize.height, mode, useGrapesjs]);

  // Remember the selected viewport preset through the file alias layer. The
  // HTML <meta name="od-canvas"> is reserved for user-edited canvas sizes;
  // changing a preset should not rewrite source or force GrapesJS to reload.
  useEffect(() => {
    if (mode !== 'preview') return;
    onViewportPresetChange?.(previewViewport);
  }, [previewViewport, mode, onViewportPresetChange]);
  const grapesjsFrameOverlayTransform = useCallback(
    (editor: NonNullable<ReturnType<GrapesjsEditorHandle['getEditor']>> | null | undefined) => {
      const frame = (() => {
        try { return editor?.Canvas.getFrameEl?.() ?? null; } catch { return null; }
      })();
      const frameRect = frame?.getBoundingClientRect();
      const bodyRect = previewBodyRef.current?.getBoundingClientRect();
      if (!frameRect || !bodyRect) return { scale: 1, offsetX: 0, offsetY: 0 };
      const rawZoom = (() => {
        try { return editor?.Canvas.getZoom?.(); } catch { return null; }
      })();
      const scale = typeof rawZoom === 'number' && Number.isFinite(rawZoom) && rawZoom > 0
        ? rawZoom / 100
        : 1;
      const doc = (() => {
        try { return editor?.Canvas.getDocument?.() ?? null; } catch { return null; }
      })();
      const win = doc?.defaultView ?? null;
      const scrollX = (typeof win?.scrollX === 'number' ? win.scrollX : undefined)
        ?? doc?.documentElement?.scrollLeft
        ?? doc?.body?.scrollLeft
        ?? 0;
      const scrollY = (typeof win?.scrollY === 'number' ? win.scrollY : undefined)
        ?? doc?.documentElement?.scrollTop
        ?? doc?.body?.scrollTop
        ?? 0;
      return {
        scale,
        offsetX: frameRect.left - bodyRect.left - scrollX * scale,
        offsetY: frameRect.top - bodyRect.top - scrollY * scale,
      };
    },
    [],
  );
  // PR2: build a PreviewCommentSnapshot from a GrapesJS Component so the
  // comment overlay can render markers / hover cards without the iframe
  // postMessage bridge. Position is pixel-perfect in the canvas iframe
  // coordinate space (scale=1 under devicePreviewMode); the overlay layer
  // multiplies by overlayPreviewScale when drawing.
  const buildGrapesjsCommentSnapshot = useCallback(
    (
      editor: NonNullable<ReturnType<GrapesjsEditorHandle['getEditor']>>,
      odId: string,
      filePath: string,
      options?: { preferCurrentSelection?: boolean },
    ): PreviewCommentSnapshot | null => {
      const selection = grapesjsSelectionStoreRef.current.readSnapshot(editor, odId, {
        preferCurrentSelection: options?.preferCurrentSelection ?? true,
      });
      if (!selection?.box) return null;
      const inspect = selection.inspectTarget;
      return {
        filePath,
        elementId: selection.odId,
        selector: inspect?.selector ?? '',
        label: inspect?.label ?? '',
        text: inspect?.text ?? '',
        position: {
          x: selection.box.x,
          y: selection.box.y,
          width: selection.box.width,
          height: selection.box.height,
        },
        htmlHint: selection.htmlHint,
        style: inspect?.style,
        selectionKind: 'element',
      };
    },
    [],
  );
  const handleGrapesjsCanvasCommentPin = useCallback((point: { x: number; y: number }) => {
    const x = Math.max(0, Math.round(point.x));
    const y = Math.max(0, Math.round(point.y));
    const idSeed = Date.now().toString(36);
    const snapshot: PreviewCommentSnapshot = {
      filePath: file.name,
      elementId: `pin-${idSeed}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      selector: 'html',
      label: t('chat.comments.comment'),
      text: '',
      position: {
        x,
        y,
        width: 1,
        height: 1,
      },
      hoverPoint: {
        x,
        y,
      },
      htmlHint: '',
      selectionKind: 'element',
    };
    setCommentPanelOpen(true);
    setCommentSidePanelCollapsed(false);
    setBoardMode(true);
    setCommentCreateMode(true);
    setActiveCommentTarget(snapshot);
    setHoveredCommentTarget(snapshot);
    setActivePreviewCommentId(null);
    setCommentDraft('');
    setQueuedBoardNotes([]);
    setActiveCommentExistingAttachments([]);
    setLiveCommentTargets((current) => new Map(current).set(snapshot.elementId, snapshot));
  }, [file.name, t]);
  const grapesjsEditorRef = useRef<GrapesjsEditorHandle | null>(null);
  const grapesjsSelectionStoreRef = useRef(createGrapesjsSelectionStore());
  // Debounce the expensive computed-style snapshot read that runs on every
  // GrapesJS selection. extractInspectTarget() walks the component tree and
  // calls getComputedStyle for ~12 properties; doing that synchronously inside
  // the component:selected callback blocked the main thread on each click and
  // was a major source of jank. The structural UI activation
  // (setInspectMode / onEditModeChange / sidebar tab) still runs synchronously
  // so the click→edit affordance feels instant; only the computed snapshot is
  // deferred to the next idle frame with a trailing debounce so rapid clicks
  // collapse to a single read.
  const grapesjsInspectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    grapesjsSelectionStoreRef.current.invalidate();
  }, [file.name, source]);
  const htmlFileSaveControllerRef = useRef(htmlFileSaveController);
  useEffect(() => {
    htmlFileSaveControllerRef.current = htmlFileSaveController;
  }, [htmlFileSaveController]);
  const grapesjsSourceStateSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const grapesjsPendingSourceStateRef = useRef<string | null>(null);
  function clearGrapesjsSourceStateSyncTimer() {
    if (grapesjsSourceStateSyncTimerRef.current) {
      clearTimeout(grapesjsSourceStateSyncTimerRef.current);
      grapesjsSourceStateSyncTimerRef.current = null;
    }
  }
  function cancelGrapesjsSourceStateSync() {
    clearGrapesjsSourceStateSyncTimer();
    grapesjsPendingSourceStateRef.current = null;
  }
  function flushGrapesjsSourceState(next?: string) {
    clearGrapesjsSourceStateSyncTimer();
    const pending = next ?? grapesjsPendingSourceStateRef.current;
    grapesjsPendingSourceStateRef.current = null;
    if (pending == null) return;
    setSource((current) => (current === pending ? current : pending));
  }
  function queueGrapesjsSourceStateSync(next: string) {
    grapesjsPendingSourceStateRef.current = next;
    clearGrapesjsSourceStateSyncTimer();
    grapesjsSourceStateSyncTimerRef.current = setTimeout(() => {
      flushGrapesjsSourceState();
    }, GRAPESJS_SOURCE_STATE_SYNC_DELAY_MS);
  }
  const grapesjsLiveSource = previewSource ?? source ?? '';
  const grapesjsArtboardKey = `${projectId}\0${file.name}`;
  const [grapesjsArtboardNames, setGrapesjsArtboardNames] = useState<Record<string, string>>({});
  const persistedGrapesjsArtboardName =
    grapesjsArtboardNames[grapesjsArtboardKey]
    ?? readArtboardNameFromSource(grapesjsLiveSource);
  const grapesjsArtboardName =
    persistedGrapesjsArtboardName
    ?? defaultGrapesjsArtboardName(file.name);
  const grapesjsArtboardNameRef = useRef<string | null>(persistedGrapesjsArtboardName);
  grapesjsArtboardNameRef.current = persistedGrapesjsArtboardName;
  const withGrapesjsArtboardNameMeta = useCallback((next: string): string => {
    const currentName = grapesjsArtboardNameRef.current ?? readArtboardNameFromSource(sourceRef.current ?? '');
    return currentName ? writeArtboardNameToSource(next, currentName) : next;
  }, []);
  const setGrapesjsArtboardName = useCallback((name: string) => {
    const cleanName = name.trim() || defaultGrapesjsArtboardName(file.name);
    grapesjsArtboardNameRef.current = cleanName;
    setGrapesjsArtboardNames((current) => ({
      ...current,
      [grapesjsArtboardKey]: cleanName,
    }));
    const current = sourceRef.current;
    if (current == null) return;
    const updated = writeArtboardNameToSource(current, cleanName);
    if (updated === current) return;
    sourceRef.current = updated;
    queueGrapesjsSourceStateSync(updated);
    setCodeDirty(true);
    htmlFileSaveController.scheduleSave(updated, 'grapesjs-artboard-name');
  }, [file.name, grapesjsArtboardKey, htmlFileSaveController]);
  // Flush pending edits when the file changes or the component unmounts.
  // Keyed on projectId + file.name so switching files in the tree triggers
  // the cleanup (and save) before the new file's content loads.
  // Do not key this on mtime: our own autosave changes mtime, and treating
  // that as a leave-file cleanup re-saves the GrapesJS document in a loop.
  useEffect(() => {
    return () => {
      const controller = htmlFileSaveControllerRef.current;
      cancelGrapesjsSourceStateSync();
      if (grapesjsInspectDebounceRef.current) {
        clearTimeout(grapesjsInspectDebounceRef.current);
      }
      try {
        const rawNext = grapesjsEditorRef.current?.getDocument();
        const next = rawNext ? withGrapesjsArtboardNameMeta(rawNext) : rawNext;
        if (next && next !== sourceRef.current) {
          sourceRef.current = next;
          controller.cancelScheduledSave();
          void controller.saveBestEffort(next, 'grapesjs-autosave-flush');
          return;
        }
      } catch {
        // ignore — best-effort flush below still preserves scheduled source
      }
      void controller.flushScheduledSave('grapesjs-autosave-flush');
    };
  }, [file.name, projectId]);
  const [grapesjsViewMode, setGrapesjsViewModeState] = useState(false);
  // Wrap setGrapesjsViewMode so that switching to interactive mode flushes any
  // pending canvas edits before the GrapesjsEditor unmounts. Without this, the
  // last <1500ms of edits (still in the debounce timer) are lost because the
  // editor is destroyed before the timer fires.
  const setGrapesjsViewMode = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setGrapesjsViewModeState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      // Only flush when transitioning FROM edit (false) TO interactive (true).
      if (value && !prev) {
        htmlFileSaveController.cancelScheduledSave();
        // Sync the latest editor document to source + immediately save.
        const rawDoc = grapesjsEditorRef.current?.getDocument();
        const doc = rawDoc ? withGrapesjsArtboardNameMeta(rawDoc) : rawDoc;
        if (doc && doc !== sourceRef.current) {
          sourceRef.current = doc;
          flushGrapesjsSourceState(doc);
          setCodeDirty(true);
          void htmlFileSaveController.saveBestEffort(doc, 'grapesjs-view-mode-flush');
        }
      }
      return value;
    });
  }, [htmlFileSaveController]);
  useEffect(() => {
    if (mode !== 'preview' || grapesjsViewMode) {
      setGrapesjsCanvasTool('cursor');
      setGrapesjsShapeMenuOpen(false);
    }
  }, [grapesjsViewMode, mode]);
  // Canvas zoom from GrapesJS (0-100), drives the toolbar zoom % display on
  // the GrapesJS preview path. The non-GrapesJS path uses the legacy `zoom` state.
  const [grapesjsCanvasZoom, setGrapesjsCanvasZoom] = useState(100);
  const displayedGrapesjsCanvasZoom = Number.isFinite(grapesjsCanvasZoom) ? grapesjsCanvasZoom : 100;
  const grapesjsOverlayTransform = useMemo<PreviewOverlayTransform>(() => {
    if (!useGrapesjs || mode !== 'preview' || grapesjsViewMode) {
      return overlayPreviewTransform;
    }
    return grapesjsFrameOverlayTransform(grapesjsEditorRef.current?.getEditor());
  }, [
    grapesjsFrameOverlayTransform,
    grapesjsCanvasZoom,
    grapesjsOverlayVersion,
    grapesjsViewMode,
    mode,
    overlayPreviewScale,
    previewBodySize?.height,
    previewBodySize?.width,
    useGrapesjs,
  ]);
  const activeCommentOverlayTransform =
    useGrapesjs && mode === 'preview' && !grapesjsViewMode
      ? grapesjsOverlayTransform
      : overlayPreviewTransform;
  // Inject <base href> into the interactive-mode iframe srcDoc so relative CSS
  // / asset links resolve against the project root (same as the GrapesJS
  // editor path which calls applyCanvasHeadAssets). Without this, files that
  // link a shared stylesheet (e.g. ../shared.css) render without styles in
  // the plain interactive iframe.
  const interactiveSrcDoc = useMemo(() => {
    const raw = grapesjsLiveSource;
    if (!raw) return raw;
    const base = projectRawUrl(projectId, baseDirFor(file.name));
    if (!base) return raw;
    const baseTag = `<base href="${base}" data-od-interactive-base="true">`;
    // Insert right after <head> (or at the start of <html> / document if none).
    if (/<head[^>]*>/i.test(raw)) return raw.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`);
    if (/<html[^>]*>/i.test(raw)) return raw.replace(/<html[^>]*>/i, (m) => `${m}<head>${baseTag}</head>`);
    return `${baseTag}${raw}`;
  }, [grapesjsLiveSource, projectId, file.name, file.mtime]);
  const basePreviewSrcUrl = useMemo(
    () => `${projectRawUrl(projectId, file.name)}?v=${Math.round(file.mtime)}&r=${reloadKey}&odPreviewBridge=scroll&odPreviewBridge=selection&odPreviewBridge=snapshot`,
    [projectId, file.name, file.mtime, reloadKey],
  );
  const [previewSrcUrl, setPreviewSrcUrl] = useState(basePreviewSrcUrl);
  const activePreviewSrcUrl = (
    previewSrcUrl === basePreviewSrcUrl ||
    previewSrcUrl.startsWith(`${basePreviewSrcUrl}&`)
  )
    ? previewSrcUrl
    : basePreviewSrcUrl;
  useEffect(() => {
    setPreviewSrcUrl(basePreviewSrcUrl);
    setUrlSelectionBridgeReady(false);
  }, [basePreviewSrcUrl]);
  useEffect(() => {
    iframeRef.current = useUrlLoadPreview ? urlPreviewIframeRef.current : srcDocPreviewIframeRef.current;
  }, [useUrlLoadPreview]);

  useEffect(() => {
    if (filesRefreshKey === 0) return;
    const nextSrc = `${basePreviewSrcUrl}&fr=${filesRefreshKey}`;
    const timeout = window.setTimeout(() => {
      if (useUrlLoadPreview && urlPreviewIframeRef.current?.contentWindow) {
        urlPreviewIframeRef.current.contentWindow.location.replace(nextSrc);
      } else {
        setPreviewSrcUrl(nextSrc);
      }
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [basePreviewSrcUrl, filesRefreshKey, useUrlLoadPreview]);

  useEffect(() => {
    setInlinedSource(null);
    if (useUrlLoadPreview) return;
    if (!source || effectiveDeck || !hasRelativeAssetRefs(source)) return;
    let cancelled = false;
    void inlineRelativeAssets(source, projectId, file.name).then((next) => {
      if (!cancelled) setInlinedSource(next);
    });
    return () => {
      cancelled = true;
    };
  }, [source, effectiveDeck, projectId, file.name, reloadKey, useUrlLoadPreview]);

  // During a move-element operation the bridge already applied the DOM swap
  // optimistically. Keep returning the last-good srcDoc so the iframe never
  // reloads mid-move, regardless of how source state changes arrive.
  const lastGoodSrcDocRef = useRef('');
  const srcDoc = useMemo(
    () => {
      if (!previewSource) return '';
      const next = buildSrcdoc(previewSource, {
        deck: effectiveDeck,
        baseHref: projectRawUrl(projectId, baseDirFor(file.name)),
        initialSlideIndex: htmlPreviewSlideState.get(previewStateKey)?.active ?? 0,
        selectionBridge: true,
        editBridge: manualEditRequiresSrcDoc,
        paletteBridge: false,
        previewFocusGuard: true,
      });
      if (skipSrcDocRebuildForMoveRef.current) return lastGoodSrcDocRef.current;
      lastGoodSrcDocRef.current = next;
      return next;
    },
    [previewSource, effectiveDeck, projectId, file.name, previewStateKey, manualEditRequiresSrcDoc],
  );
  const lazySrcDocTransport = useMemo(() => buildLazySrcdocTransport(), []);
  const [srcDocTransportResetKey, setSrcDocTransportResetKey] = useState(0);
  const [srcDocShellReady, setSrcDocShellReady] = useState(false);
  const wasUrlLoadPreviewRef = useRef(useUrlLoadPreview);
  const urlPreviewKeepAliveKey = previewIframeKeepAliveKey(projectId, file.name);
  // Reset the shell-ready latch whenever the srcDoc iframe re-mounts. The
  // next shell will post `od:srcdoc-transport-ready` (or fire onLoad) and
  // flip this back to true. See #2253.
  useEffect(() => {
    setSrcDocShellReady(false);
  }, [srcDocTransportResetKey]);
  // Listen for the shell's ready handshake. Gating activation on this is
  // what fixes the #2253 race: opening Tweaks right after a key-driven
  // re-mount used to post `activate` before the shell's listener was
  // installed, dropping the message and stranding the iframe on the empty
  // 536-byte body.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.source !== srcDocPreviewIframeRef.current?.contentWindow) return;
      const data = ev.data as { type?: string } | null;
      if (data?.type !== 'od:srcdoc-transport-ready') return;
      setSrcDocShellReady(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const frame = urlPreviewIframeRef.current;
      if (ev.source !== frame?.contentWindow) return;
      if (frame.getAttribute('src') === 'about:blank') return;
      const data = ev.data as { type?: string } | null;
      if (data?.type !== 'od:url-selection-bridge-ready') return;
      setUrlSelectionBridgeReady(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  // Lazy transport preloads an empty shell only while URL-load is the active
  // transport. Once srcdoc becomes active (sandbox shim, Draw, Screenshot,
  // Tweaks, etc.), mount the real artifact HTML directly so we do not depend on
  // a postMessage activation that can race (#2253) and strand the iframe blank
  // (#2361, #2791).
  const captureModeActive = drawOverlayOpen;
  const useLazySrcDocTransport = !manualEditRequiresSrcDoc && !captureModeActive && useUrlLoadPreview;
  const srcDocTransportContent = useLazySrcDocTransport ? lazySrcDocTransport : srcDoc;
  const urlTransportSrc = useUrlLoadPreview ? activePreviewSrcUrl : 'about:blank';
  const activateSrcDocTransport = useCallback((target: HTMLIFrameElement | null = srcDocPreviewIframeRef.current) => {
    if (!canActivateSrcDocTransport({
      srcDoc,
      useUrlLoadPreview,
      useLazySrcDocTransport,
      shellReady: srcDocShellReady,
      activatedHtml: activatedSrcDocTransportHtmlRef.current,
    })) return false;
    // A SECOND activation while Comment mode is on would document.open +
    // write over the iframe's existing document. The window-level message
    // listener survives, but iframe.onLoad does NOT refire for
    // document.write, so host-side re-init (slide nav sync, scroll
    // restore, bridge replay) is silently skipped — the visible page can
    // drift out of sync with the host's tracked state (e.g. the page
    // indicator shows 3 while the iframe rendered page 4 of the freshly
    // edited deck). Force a fresh shell mount under Comment so onLoad
    // fires and the full re-init pipeline runs against the new HTML.
    //
    // Skip the remount path in Manual Edit, where the postMessage
    // activate carries the patched HTML and host-side scroll/slide
    // state intentionally stays put across the patch.
    if (boardMode && activatedSrcDocTransportHtmlRef.current !== null) {
      activatedSrcDocTransportHtmlRef.current = null;
      setSrcDocTransportResetKey((key) => key + 1);
      return true;
    }
    const win = target?.contentWindow;
    if (!win) return false;
    win.postMessage({ type: 'od:srcdoc-transport-activate', html: srcDoc }, '*');
    activatedSrcDocTransportHtmlRef.current = srcDoc;
    return true;
  }, [srcDoc, useLazySrcDocTransport, useUrlLoadPreview, srcDocShellReady, boardMode]);
  const activateLoadedSrcDocTransport = useCallback((target: HTMLIFrameElement | null = srcDocPreviewIframeRef.current) => {
    if (!canActivateSrcDocTransport({
      srcDoc,
      useUrlLoadPreview,
      useLazySrcDocTransport,
      shellReady: true,
      activatedHtml: activatedSrcDocTransportHtmlRef.current,
    })) return false;
    const win = target?.contentWindow;
    if (!win) return false;
    win.postMessage({ type: 'od:srcdoc-transport-activate', html: srcDoc }, '*');
    activatedSrcDocTransportHtmlRef.current = srcDoc;
    return true;
  }, [srcDoc, useLazySrcDocTransport, useUrlLoadPreview]);
  const activateSrcDocSnapshotTransport = useCallback((target: HTMLIFrameElement | null = srcDocPreviewIframeRef.current) => {
    if (!srcDoc) return false;
    const win = target?.contentWindow;
    if (!win) return false;
    win.postMessage({ type: 'od:srcdoc-transport-activate', html: srcDoc }, '*');
    return true;
  }, [srcDoc]);
  useEffect(() => {
    if (useUrlLoadPreview) {
      activatedSrcDocTransportHtmlRef.current = null;
      if (!wasUrlLoadPreviewRef.current) {
        setSrcDocTransportResetKey((key) => key + 1);
      }
      wasUrlLoadPreviewRef.current = true;
      return;
    }
    if (wasUrlLoadPreviewRef.current) {
      setSrcDocTransportResetKey((key) => key + 1);
      activatedSrcDocTransportHtmlRef.current = null;
    }
    wasUrlLoadPreviewRef.current = false;
    activateSrcDocTransport();
  }, [activateSrcDocTransport, useUrlLoadPreview]);
  
  useEffect(() => {
    restorePreviewScrollPosition();
  }, [boardMode, drawOverlayOpen, manualEditMode, srcDoc, restorePreviewScrollPosition]);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      if (!isActivePreviewIframeSource(ev.source)) return;
      const data = ev.data as {
        type?: string;
        frameLeft?: number;
        frameTop?: number;
        canvasLeft?: number;
        canvasTop?: number;
      } | null;
      if (!data || data.type !== 'od:preview-scroll') return;
      if (previewScrollRestoreRef.current && Number(data.canvasLeft || 0) === 0 && Number(data.canvasTop || 0) === 0) return;
      if (
        previewScrollPositionRef.current.canvasLeft !== 0 ||
        previewScrollPositionRef.current.canvasTop !== 0
      ) {
        const isInitialZeroReport = Number(data.canvasLeft || 0) === 0 && Number(data.canvasTop || 0) === 0;
        if (isInitialZeroReport && Date.now() - previewScrollRequestAtRef.current < 1200) return;
      }
      previewScrollPositionRef.current = {
        frameLeft: Number(data.frameLeft || 0),
        frameTop: Number(data.frameTop || 0),
        canvasLeft: Number(data.canvasLeft || 0),
        canvasTop: Number(data.canvasTop || 0),
      };
    }
    function onRestoreRequest(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      if (!isActivePreviewIframeSource(ev.source)) return;
      const data = ev.data as { type?: string } | null;
      if (!data || data.type !== 'od:preview-scroll-request') return;
      previewScrollRequestAtRef.current = Date.now();
      const snapshot = previewScrollRestoreRef.current;
      const scroll = snapshot ?? {
        frameLeft: previewScrollPositionRef.current.frameLeft,
        frameTop: previewScrollPositionRef.current.frameTop,
        canvasLeft: previewScrollPositionRef.current.canvasLeft,
        canvasTop: previewScrollPositionRef.current.canvasTop,
      };
      iframeRef.current?.contentWindow?.postMessage({
        type: 'od:preview-scroll-restore',
        frameLeft: scroll.frameLeft,
        frameTop: scroll.frameTop,
        canvasLeft: scroll.canvasLeft,
        canvasTop: scroll.canvasTop,
      }, '*');
    }
    function onDcViewportMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      if (!isActivePreviewIframeSource(ev.source)) return;
      const data = ev.data as {
        type?: string;
        x?: number;
        y?: number;
        scale?: number;
      } | null;
      if (!data || !data.type) return;
      if (data.type === '__dc_viewport') {
        const x = Number(data.x || 0);
        const y = Number(data.y || 0);
        const scale = Number(data.scale || 1);
        const hasExistingPosition = dcViewportRef.current.x !== 0 || dcViewportRef.current.y !== 0;
        const isInitialZeroReport = x === 0 && y === 0 && scale === 1;
        if (hasExistingPosition && isInitialZeroReport && Date.now() - dcViewportRestoreAtRef.current < 1500) return;
        dcViewportRef.current = {
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
        };
        return;
      }
      if (data.type === '__dc_viewport_request') {
        dcViewportRestoreAtRef.current = Date.now();
        iframeRef.current?.contentWindow?.postMessage({
          type: '__dc_set_viewport',
          ...dcViewportRef.current,
        }, '*');
      }
    }
    window.addEventListener('message', onMessage);
    window.addEventListener('message', onRestoreRequest);
    window.addEventListener('message', onDcViewportMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('message', onRestoreRequest);
      window.removeEventListener('message', onDcViewportMessage);
    };
  }, [isActivePreviewIframeSource, isOurPreviewIframeSource]);

  useEffect(() => {
    if (!effectiveDeck) {
      setSlideState(null);
      return;
    }
    setSlideState(htmlPreviewSlideState.get(previewStateKey) ?? null);
    function onMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      if (!isActivePreviewIframeSource(ev.source)) return;
      const data = ev?.data as
        | { type?: string; active?: number; count?: number }
        | null;
      if (!data || data.type !== 'od:slide-state') return;
      if (typeof data.active !== 'number' || typeof data.count !== 'number') return;
      const next = { active: data.active, count: data.count };
      setSlideStateCached(previewStateKey, next);
      setSlideState(next);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [effectiveDeck, isActivePreviewIframeSource, isOurPreviewIframeSource, previewStateKey]);

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({
      type: 'od:comment-mode',
      enabled: boardMode,
      mode: boardTool,
    }, '*');
  }, [boardMode, boardTool, srcDoc, useUrlLoadPreview]);

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'od-edit-mode', enabled: manualEditMode }, '*');
    postSelectedManualEditTargetsToIframe(
      manualEditMode ? selectedManualEditTargets.map((target) => target.id) : [],
    );
  }, [manualEditMode, selectedManualEditTargets, srcDoc, useUrlLoadPreview]);

  const previewStyleToIframe = useCallback((id: string, styles: Partial<ManualEditStyles>, version: number) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return false;
    win.postMessage({ type: 'od-edit-preview-style', id, styles, version }, '*');
    return true;
  }, []);

  function postSelectedManualEditTargetToIframe(id: string | null, target: HTMLIFrameElement | null = iframeRef.current) {
    const win = target?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'od-edit-selected-target', id }, '*');
  }

  function postSelectedManualEditTargetsToIframe(ids: string[], target: HTMLIFrameElement | null = iframeRef.current) {
    const win = target?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'od-edit-selected-targets', ids }, '*');
    if (ids.length <= 1) win.postMessage({ type: 'od-edit-selected-target', id: ids[0] ?? null }, '*');
  }

  function removeManualEditElementFromIframe(id: string, target: HTMLIFrameElement | null = iframeRef.current) {
    target?.contentWindow?.postMessage({ type: 'od-edit-remove-element', id }, '*');
  }

  function applyManualEditFieldsToIframe(
    patch: Extract<ManualEditPatch, { kind: 'set-link' | 'set-image' | 'set-attributes' }>,
    target: HTMLIFrameElement | null = iframeRef.current,
  ) {
    const win = target?.contentWindow;
    if (!win) return;
    if (patch.kind === 'set-link') {
      win.postMessage({
        type: 'od-edit-apply-link',
        id: patch.id,
        text: patch.text,
        href: patch.href,
      }, '*');
    } else if (patch.kind === 'set-image') {
      win.postMessage({
        type: 'od-edit-apply-image',
        id: patch.id,
        src: patch.src,
        alt: patch.alt,
      }, '*');
    } else {
      win.postMessage({
        type: 'od-edit-apply-attributes',
        id: patch.id,
        attributes: patch.attributes,
      }, '*');
    }
  }

  function syncBridgeModes(target: HTMLIFrameElement | null = iframeRef.current) {
    const win = target?.contentWindow;
    if (!win) return;
    win.postMessage({
      type: 'od:comment-mode',
      enabled: boardMode,
      mode: boardTool,
    }, '*');
    win.postMessage({ type: 'od-edit-mode', enabled: manualEditMode }, '*');
    postSelectedManualEditTargetsToIframe(
      manualEditMode ? selectedManualEditTargetsRef.current.map((item) => item.id) : [],
      target,
    );
    win.postMessage({ type: 'od:inspect-mode', enabled: inspectMode }, '*');
  }

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'od:inspect-mode', enabled: inspectMode }, '*');
  }, [inspectMode, srcDoc, useUrlLoadPreview]);

  // Mirror the bridge's `od:comment-targets` broadcast into
  // `liveCommentTargets` whenever EITHER Inspect or Comments mode is
  // active. The boardMode-only useEffect below still handles its
  // own comment-specific events (hover / click target / pod), but
  // the targets list itself is mode-agnostic — it's just "which
  // elements on the page carry data-od-id / data-screen-label".
  // Without this listener Inspect mode never learns the artifact's
  // annotation count, and the empty-state hint added for #890 would
  // misfire (always firing in Inspect mode, even on annotated
  // artifacts) because the comment-mode listener short-circuits on
  // `!boardMode`. Issue #890.
  useEffect(() => {
    if (!inspectMode && !boardMode) {
      setLiveCommentTargets((current) => (current.size > 0 ? new Map() : current));
      return;
    }
    function onMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      const data = ev.data as
        | {
            type?: string;
            targets?: Array<Partial<PreviewCommentSnapshot>>;
          }
        | null;
      if (data?.type !== 'od:comment-targets' || !Array.isArray(data.targets)) return;
      const next = new Map<string, PreviewCommentSnapshot>();
      data.targets.forEach((item) => {
        const elementId = String(item?.elementId || '');
        if (!elementId) return;
        const position = {
          x: clampBridgeCoordinate(item?.position?.x),
          y: clampBridgeCoordinate(item?.position?.y),
          width: clampBridgeCoordinate(item?.position?.width),
          height: clampBridgeCoordinate(item?.position?.height),
        };
        if (!isValidCommentOverlayPosition(position)) return;
        next.set(elementId, {
          filePath: file.name,
          elementId,
          selector: String(item?.selector || ''),
          label: String(item?.label || ''),
          text: String(item?.text || ''),
          position,
          htmlHint: String(item?.htmlHint || ''),
          style: normalizeAnnotationStyle(item?.style),
          selectionKind: 'element',
          memberCount: undefined,
          ...(typeof item?.slideIndex === 'number' ? { slideIndex: item.slideIndex } : {}),
        });
      });
      setLiveCommentTargets((current) => (
        liveCommentTargetMapsEqual(current, next) ? current : next
      ));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [inspectMode, boardMode, file.name, isOurPreviewIframeSource]);

  useEffect(() => {
    const resetFileKey = `${projectId}\0${file.name}`;
    const fileChanged = manualEditResetFileKeyRef.current !== resetFileKey;
    manualEditResetFileKeyRef.current = resetFileKey;
    // Save current file's history to cache before switching
    const prevKey = sourceFileKeyRef.current;
    if (prevKey) {
      manualEditHistoryCacheRef.current.set(prevKey, {
        history: manualEditHistoryRef.current,
        undone: manualEditUndoneRef.current,
      });
    }
    setActiveCommentTarget(null);
    setHoveredCommentTarget(null);
    setLiveCommentTargets(new Map());
    setCommentDraft('');
    setActiveCommentExistingAttachments([]);
    setActiveInspectTarget(null);
    setInspectOverrides({});
    setInspectSavedAt(null);
    setInspectError(null);
    setQueuedBoardNotes([]);
    setStrokePoints([]);
    if (fileChanged) setManualEditFrozenSource(null);
    setManualEditTargets([]);
    setSelectedManualEditTarget(null);
    setManualEditPanelPosition(null);
    selectedManualEditTargetIdRef.current = null;
    setManualEditDraft(emptyManualEditDraft());
    // Restore cached history for the new file, or clear if none
    const newKey = `${projectId}\0${file.name}\0${liveHtml === undefined ? 'raw' : 'live'}`;
    const cached = manualEditHistoryCacheRef.current.get(newKey);
    setManualEditHistory(cached?.history ?? []);
    setManualEditUndone(cached?.undone ?? []);
    setManualEditError(null);
    manualEditFlushAfterSaveRef.current = false;
    manualEditPendingStyleRef.current = null;
    manualEditSourceRoundTripRef.current = emptyManualEditSourceRoundTrip();
    clearManualEditStyleTimer();
  }, [projectId, file.name]);

  // Selecting a new file or turning inspect/comment-inspect off resets the panel target.
  useEffect(() => {
    if (!inspectMode && !(boardMode && boardTool === 'inspect')) {
      setActiveInspectTarget(null);
      setInspectError(null);
    }
  }, [inspectMode, boardMode, boardTool]);

  // Hydrate the host-authoritative override map from the artifact source
  // synchronously, *before* React commits a render that carries a new
  // `srcDoc` to the iframe. A `useEffect([source])` would commit the new
  // source first and only re-render with the parsed map afterwards — if
  // the iframe finishes loading the new srcDoc in that window, its
  // `onLoad` handler captures the previous file's empty/stale map in its
  // closure and posts that map back over the bridge's freshly DOM-hydrated
  // overrides, leaving the preview without saved inspect styles until the
  // next reload or mode toggle. Setting state during render is React's
  // documented escape hatch for "store a value derived from props"
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes):
  // the in-flight render is discarded and React re-renders with the
  // updated state before commit, so the new `srcDoc` and the new
  // `inspectOverrides` always commit together. After hydration the map
  // only mutates from host-driven onApply / reset callbacks below, so
  // artifact JS forging an od:inspect-overrides message cannot tamper
  // with what saveInspectToSource will persist.
  if (inspectHydratedSourceRef.current !== source) {
    inspectHydratedSourceRef.current = source;
    setInspectOverrides(typeof source === 'string' ? parseInspectOverridesFromSource(source) : {});
  }

  // During move-element operations, sourceRef is managed exclusively by
  // applyManualEdit (which sets sourceRef.current = result.source directly).
  // A stale file-re-fetch from a previous move could arrive here and overwrite
  // sourceRef.current, losing later moves. Skip the overwrite during moves.
  useEffect(() => {
    if (skipSrcDocRebuildForMoveRef.current) return;
    sourceRef.current = source;
    if (source == null) return;
    setManualEditDraft((current) => (
      current.fullSource === source ? current : { ...current, fullSource: source }
    ));
  }, [source]);

  useEffect(() => {
    selectedManualEditTargetIdRef.current = selectedManualEditTarget?.id ?? null;
  }, [selectedManualEditTarget?.id]);

  useEffect(() => {
    selectedManualEditTargetsRef.current = selectedManualEditTargets;
  }, [selectedManualEditTargets]);

  useEffect(() => {
    if (!boardMode) {
      setCommentCreateMode(false);
      setActiveCommentTarget((current) => (current ? null : current));
      setHoveredCommentTarget((current) => (current ? null : current));
      setActivePreviewCommentId((current) => (current ? null : current));
      setLiveCommentTargets((current) => (current.size > 0 ? new Map() : current));
      setQueuedBoardNotes((current) => (current.length > 0 ? [] : current));
      setStrokePoints((current) => (current.length > 0 ? [] : current));
      return;
    }
    // PR2: GrapesJS path drives comment selection via GrapesjsEditor callbacks
    // (onSelectTargets / onHoverTarget) and the live-targets scan effect, so
    // skip the iframe postMessage listener entirely on that path.
    if (useGrapesjs) return;
    const snapshotFromData = (data: Partial<PreviewCommentSnapshot>): PreviewCommentSnapshot => ({
      filePath: file.name,
      elementId: String(data.elementId || ''),
      selector: String(data.selector || ''),
      label: String(data.label || ''),
      text: String(data.text || ''),
      position: {
        x: clampBridgeCoordinate(data.position?.x),
        y: clampBridgeCoordinate(data.position?.y),
        width: clampBridgeCoordinate(data.position?.width),
        height: clampBridgeCoordinate(data.position?.height),
      },
      hoverPoint: data.hoverPoint
        ? {
            x: clampBridgeCoordinate(data.hoverPoint.x),
            y: clampBridgeCoordinate(data.hoverPoint.y),
          }
        : undefined,
      htmlHint: String(data.htmlHint || ''),
      style: normalizeAnnotationStyle(data.style),
      selectionKind: data.selectionKind === 'pod' ? 'pod' : 'element',
      memberCount: finiteBridgeInteger(data.memberCount),
      podMembers: Array.isArray(data.podMembers) ? data.podMembers : undefined,
      ...(typeof data.slideIndex === 'number' ? { slideIndex: data.slideIndex } : {}),
    });
    function onMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      const data = ev.data as (Partial<PreviewCommentSnapshot> & {
        type?: string;
        targets?: Array<Partial<PreviewCommentSnapshot>>;
        points?: StrokePoint[];
      }) | null;
      if (!data?.type) return;
      if (data.type === 'od:selection-escape') {
        if (!commentCreateMode) deactivateElementSelectionMode();
        return;
      }
      if (data.type === 'od:comment-targets' && Array.isArray(data.targets)) {
        const next = new Map<string, PreviewCommentSnapshot>();
        data.targets.forEach((item) => {
          const snapshot = snapshotFromData(item);
          if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
          next.set(snapshot.elementId, snapshot);
        });
        setLiveCommentTargets((current) => (
          liveCommentTargetMapsEqual(current, next) ? current : next
        ));
        setActiveCommentTarget((current) => {
          if (!current) return null;
          if (current.selectionKind === 'pod') return current;
          const updated = next.get(current.elementId);
          if (!updated || !isValidCommentOverlayPosition(updated.position)) return null;
          return commentSnapshotEqual(current, updated) ? current : updated;
        });
        setHoveredCommentTarget((current) => {
          if (!current) return null;
          if (current.selectionKind === 'pod') return current;
          const updated = next.get(current.elementId);
          if (!updated || !isValidCommentOverlayPosition(updated.position)) return null;
          return commentSnapshotEqual(current, updated) ? current : updated;
        });
        return;
      }
      if (data.type === 'od:comment-active-target-update') {
        const snapshot = snapshotFromData(data);
        if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
        // Fires on every pointermove while a target is active — skip the Map
        // clone and the active/hovered state writes when nothing changed, so a
        // steady hover doesn't re-render the whole overlay each frame.
        setLiveCommentTargets((current) => {
          const existing = current.get(snapshot.elementId);
          if (existing && commentSnapshotEqual(existing, snapshot)) return current;
          return new Map(current).set(snapshot.elementId, snapshot);
        });
        setActiveCommentTarget((current) =>
          current && current.elementId === snapshot.elementId && !commentSnapshotEqual(current, snapshot)
            ? snapshot
            : current,
        );
        setHoveredCommentTarget((current) =>
          current && current.elementId === snapshot.elementId && !commentSnapshotEqual(current, snapshot)
            ? snapshot
            : current,
        );
        return;
      }
      if (data.type === 'od:comment-leave') {
        // Already firmly on the card — nothing to dismiss.
        if (hoverCardPinnedRef.current) return;
        // The pointer left the element. It may be sliding onto the floating card
        // (which overlaps the iframe) or hopping toward an adjacent element —
        // both should keep the card up. Defer the dismiss so the card's
        // mouseenter or the next comment-hover can cancel it; only a leave with
        // nothing following actually tears the card down.
        scheduleHoverCardDismiss();
        return;
      }
      if (data.type === 'od:comment-hover') {
        const snapshot = snapshotFromData(data);
        if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
        // Pointer landed on an element — cancel any deferred dismiss so moving
        // from the card back onto the element it describes keeps the card.
        cancelHoverCardDismiss();
        // Hover repeats the same snapshot per pointermove frame — keep the
        // existing state object (and skip the Map clone) when it is unchanged.
        setHoveredCommentTarget((current) =>
          current && current.elementId === snapshot.elementId && commentSnapshotEqual(current, snapshot)
            ? current
            : snapshot,
        );
        setLiveCommentTargets((current) => {
          const existing = current.get(snapshot.elementId);
          if (existing && commentSnapshotEqual(existing, snapshot)) return current;
          return new Map(current).set(snapshot.elementId, snapshot);
        });
        return;
      }
      if (data.type === 'od:comment-target') {
        const snapshot = snapshotFromData(data);
        if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
        const shouldOpenComposer = boardMode || commentCreateMode;
        cancelHoverCardDismiss();
        setActiveCommentTarget((current) => (shouldOpenComposer ? snapshot : current));
        setHoveredCommentTarget(snapshot);
        setLiveCommentTargets((current) => {
          const existing = current.get(snapshot.elementId);
          if (existing && commentSnapshotEqual(existing, snapshot)) return current;
          return new Map(current).set(snapshot.elementId, snapshot);
        });
        if (shouldOpenComposer) {
          setActivePreviewCommentId(null);
          setCommentDraft('');
          setQueuedBoardNotes([]);
          setActiveCommentExistingAttachments([]);
        }
        return;
      }
      if (data.type === 'od:pod-clear') {
        setStrokePoints([]);
        return;
      }
      if (data.type === 'od:pod-stroke' && Array.isArray(data.points)) {
        setStrokePoints(
          data.points.map((point) => ({
            x: clampBridgeCoordinate(point.x),
            y: clampBridgeCoordinate(point.y),
          })),
        );
        return;
      }
      if (data.type === 'od:pod-select' && Array.isArray(data.points)) {
        const points = data.points.map((point) => ({
          x: clampBridgeCoordinate(point.x),
          y: clampBridgeCoordinate(point.y),
        }));
        setStrokePoints(points);
        const nextTarget = buildPodSnapshot({
          filePath: file.name,
          strokePoints: points,
          liveTargets: liveCommentTargetsRef.current,
        });
        if (!nextTarget) {
          setStrokePoints([]);
          return;
        }
        setActiveCommentTarget(nextTarget);
        setHoveredCommentTarget(nextTarget);
        setActivePreviewCommentId(null);
        setQueuedBoardNotes([]);
        setCommentDraft('');
        setActiveCommentExistingAttachments([]);
        setStrokePoints([]);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [activeCommentTarget, boardMode, boardTool, cancelHoverCardDismiss, commentCreateMode, commentPortalHost, file.name, isOurPreviewIframeSource, previewComments, scheduleHoverCardDismiss, useGrapesjs]);

  useEffect(() => {
    if (!boardMode || !activeCommentTarget || activeCommentTarget.selectionKind === 'pod') return;
    iframeRef.current?.contentWindow?.postMessage({
      type: 'od:comment-active-target',
      elementId: activeCommentTarget.elementId,
      selector: activeCommentTarget.selector,
    }, '*');
  }, [activeCommentTarget?.elementId, activeCommentTarget?.selector, activeCommentTarget?.selectionKind, boardMode]);

  useEffect(() => {
    if (!manualEditMode) {
      setManualEditTargets([]);
      setSelectedManualEditTarget(null);
      setSelectedManualEditTargets([]);
      selectedManualEditTargetsRef.current = [];
      setManualEditHoverTarget(null);
      setManualEditPageStylesOpen(false);
      setManualEditPanelPosition(null);
      selectedManualEditTargetIdRef.current = null;
      setManualEditError(null);
      manualEditFlushAfterSaveRef.current = false;
      manualEditPendingStyleRef.current = null;
      manualEditSourceRoundTripRef.current = emptyManualEditSourceRoundTrip();
      if (manualEditStyleTimerRef.current) {
        clearTimeout(manualEditStyleTimerRef.current);
        manualEditStyleTimerRef.current = null;
      }
      return;
    }
    function onMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      const data = ev.data as ManualEditBridgeMessage | null;
      if (!data?.type) return;
      if (data.type === 'od-edit-targets' && Array.isArray(data.targets)) {
        setManualEditTargets(data.targets);
        // Target broadcasts can be briefly empty while the iframe/save path is
        // settling; keep the user's inspector selection unless a fresh copy is
        // available to update its metadata.
        setSelectedManualEditTarget((current) =>
          current ? data.targets.find((target) => target.id === current.id) ?? current : current,
        );
        setSelectedManualEditTargets((current) => {
          if (current.length === 0) return current;
          const next = current.map((selected) => data.targets.find((target) => target.id === selected.id) ?? selected);
          selectedManualEditTargetsRef.current = next;
          return next;
        });
        const selectedIds = selectedManualEditTargetsRef.current.map((target) => target.id);
        if (selectedIds.length > 0) setTimeout(() => postSelectedManualEditTargetsToIframe(selectedIds), 0);
        return;
      }
      if (data.type === 'od-edit-select') {
        setManualEditHoverTarget(null);
        void selectManualEditTarget(data.target, Boolean(data.append));
        return;
      }
      if (data.type === 'od-edit-deselect') {
        setManualEditHoverTarget(null);
        void (async () => {
          await flushManualEditStyleSave();
          await clearManualEditTargetSelection();
        })();
        return;
      }
      if (data.type === 'od-edit-resize-end') {
        if (data.id && data.styles) {
          const label = `Resize: ${selectedManualEditTargetIdRef.current ?? data.id}`;
          void handleManualEditStyleChange(data.id, data.styles, label);
        }
        return;
      }
      if (data.type === 'od-edit-drag-end') {
        if (data.id && data.styles) {
          const label = `Move: ${selectedManualEditTargetIdRef.current ?? data.id}`;
          void handleManualEditStyleChange(data.id, data.styles, label);
        }
        return;
      }
      if (data.type === 'od-edit-move-end') {
        if (data.id && data.targetId && data.position) {
          const label = `Move: ${selectedManualEditTargetIdRef.current ?? data.id}`;
          void applyManualEdit({
            id: data.id,
            kind: 'move-element',
            targetId: data.targetId,
            position: data.position,
          }, label);
        }
        return;
      }
      if (data.type === 'od-edit-hover') {
        // Hover only surfaces a lightweight "edit params" affordance; it must
        // NOT switch the pinned inspector. The panel changes only when the
        // user clicks that affordance (or a container/image body), so moving
        // the cursor across the canvas never yanks the panel away mid-edit.
        setManualEditHoverTarget(
          data.target.id === selectedManualEditTargetIdRef.current ? null : data.target,
        );
        return;
      }
      if (data.type === 'od-edit-background') {
        // Clicking empty canvas deselects and opens the compact page-styles
        // card — only meaningful for full HTML documents.
        setManualEditHoverTarget(null);
        if (typeof source === 'string' && isManualEditFullHtmlDocument(source)) {
          void (async () => {
            await flushManualEditStyleSave();
            await clearManualEditTargetSelection();
            setManualEditPageStylesOpen(true);
          })();
        }
        return;
      }
      if (data.type === 'od-edit-delete' && data.id) {
        if (!manualEditSavingRef.current) {
          void applyManualEdit(
            { id: String(data.id), kind: 'remove-element' },
            t('manualEdit.deleteElement'),
          );
        }
        return;
      }
      if (data.type === 'od-edit-text-commit') {
        void applyManualEdit({
          id: String(data.id),
          kind: 'set-text',
          value: String(data.value),
        }, 'Edit text');
        return;
      }
      if (data.type === 'od-edit-viewport-wheel') {
        handleManualEditViewportWheel(data);
        return;
      }
      if (data.type === 'od-edit-viewport-pan') {
        handleManualEditViewportPan(data);
        return;
      }
      if (data.type === 'od-edit-space-held') {
        manualEditSpaceHeldRef.current = true;
        setManualEditSpaceHeld(true);
        return;
      }
      if (data.type === 'od-edit-space-released') {
        manualEditSpaceHeldRef.current = false;
        setManualEditSpaceHeld(false);
        if (manualEditPanRef.current) finishManualEditViewportPan();
        return;
      }
      if (data.type === 'od-edit-undo') {
        if (manualEditHistoryRef.current.length > 0 && !manualEditSavingRef.current) {
          void undoManualEdit();
        }
        return;
      }
      if (data.type === 'od-edit-redo') {
        if (manualEditUndoneRef.current.length > 0 && !manualEditSavingRef.current) {
          void redoManualEdit();
        }
        return;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isOurPreviewIframeSource, manualEditMode, source]);

  function nextManualEditPreviewVersion(): number {
    manualEditPreviewVersionRef.current += 1;
    return manualEditPreviewVersionRef.current;
  }

  function inspectorManualEditStyles(target: ManualEditTarget, baseSource: string): ManualEditStyles {
    const inlineStyles = readManualEditStyles(baseSource, target.id);
    return mergeManualEditInspectorStyles(inlineStyles, target.styles);
  }

  function reconcileManualEditStyleSave(
    id: string,
    savedStyles: Partial<ManualEditStyles>,
    savedSource: string,
  ) {
    if (id !== '__body__' && !readManualEditOuterHtml(savedSource, id)) {
      setManualEditError('The selected target no longer exists in the saved source. Refreshing the preview.');
      setSelectedManualEditTarget(null);
      setManualEditFrozenSource(null);
      setReloadKey((key) => key + 1);
      return;
    }
    const sourceStyles = readManualEditStyles(savedSource, id);
    const supersededStyles = manualEditPendingStyleRef.current?.id === id
      ? manualEditPendingStyleRef.current.styles
      : {};
    const repairStyles: Partial<ManualEditStyles> = {};
    for (const key of Object.keys(savedStyles) as Array<keyof ManualEditStyles>) {
      if (Object.prototype.hasOwnProperty.call(supersededStyles, key)) continue;
      const sourceValue = manualEditInspectorStyleValue(key, sourceStyles[key] ?? '');
      const savedValue = savedStyles[key] ?? '';
      if (manualEditPersistedValueMatchesSavedSnapshot(key, sourceValue, savedValue)) continue;
      repairStyles[key] = sourceValue;
    }
    if (Object.keys(repairStyles).length === 0) return;
    previewStyleToIframe(id, repairStyles, nextManualEditPreviewVersion());
    setManualEditDraft((current) => ({
      ...current,
      styles: { ...current.styles, ...repairStyles },
    }));
    setManualEditError('Saved styles differed from the active preview. Reconciled the selected target from source.');
  }

  function clearManualEditStyleTimer() {
    if (!manualEditStyleTimerRef.current) return;
    clearTimeout(manualEditStyleTimerRef.current);
    manualEditStyleTimerRef.current = null;
  }

  function cancelManualEditPendingStyles(id: string, keys: Array<keyof ManualEditStyles>) {
    const nextPending = cancelManualEditPendingStyleSnapshot(manualEditPendingStyleRef.current, id, keys);
    if (!nextPending) {
      manualEditPendingStyleRef.current = null;
      clearManualEditStyleTimer();
      return;
    }
    manualEditPendingStyleRef.current = nextPending;
  }

  async function handleManualEditStyleChange(id: string, styles: Partial<ManualEditStyles>, label: string) {
    if (id === '__selection__') {
      const targets = selectedManualEditTargetsRef.current;
      if (targets.length === 0) return;
      const version = nextManualEditPreviewVersion();
      for (const target of targets) {
        previewStyleToIframe(target.id, styles, version);
      }
      setManualEditError(null);
      await applyManualEdit({
        kind: 'set-style-batch',
        items: targets.map((target) => ({ id: target.id, styles })),
      }, label);
      return;
    }
    const version = nextManualEditPreviewVersion();
    const currentPending = manualEditPendingStyleRef.current;
    const pendingStyles = currentPending?.id === id
      ? { ...currentPending.styles, ...styles }
      : styles;
    const pending: ManualEditPendingStyleSave = { id, styles: pendingStyles, label, version };
    manualEditPendingStyleRef.current = pending;
    setManualEditError(null);
    previewStyleToIframe(id, styles, version);
    // Auto-save: debounce 300ms, then flush the pending style to disk
    clearManualEditStyleTimer();
    manualEditStyleTimerRef.current = setTimeout(() => {
      manualEditStyleTimerRef.current = null;
      flushManualEditStyleSave();
    }, 300);
  }

  async function flushManualEditStyleSave(): Promise<boolean> {
    const pending = manualEditPendingStyleRef.current;
    if (!pending) return true;
    if (manualEditSavingRef.current) {
      manualEditFlushAfterSaveRef.current = true;
      return false;
    }
    manualEditPendingStyleRef.current = null;
    return applyManualEdit({ id: pending.id, kind: 'set-style', styles: pending.styles }, pending.label);
  }

  function cancelManualEditStyleDraft() {
    const pending = manualEditPendingStyleRef.current;
    if (!pending) return;
    clearManualEditStyleTimer();
    manualEditPendingStyleRef.current = null;
    const base = sourceRef.current ?? '';
    const target = pending.id === '__body__'
      ? null
      : selectedManualEditTarget?.id === pending.id
        ? selectedManualEditTarget
        : manualEditTargets.find((item) => item.id === pending.id) ?? null;
    const sourceStyles = target
      ? inspectorManualEditStyles(target, base)
      : readManualEditStyles(base, pending.id);
    const resetStyles = MANUAL_EDIT_STYLE_PROPS.reduce<Partial<ManualEditStyles>>((acc, key) => {
      acc[key] = sourceStyles[key] ?? '';
      return acc;
    }, {});
    previewStyleToIframe(pending.id, resetStyles, nextManualEditPreviewVersion());
    if (!target || target.id === selectedManualEditTarget?.id) {
      setManualEditDraft((current) => ({
        ...current,
        styles: target ? sourceStyles : current.styles,
        fullSource: base,
      }));
    }
    setManualEditError(null);
  }

  function revertManualEditStylePreview(
    id: string,
    styles: Partial<ManualEditStyles>,
    baseSource: string,
  ) {
    const supersededStyles = manualEditPendingStyleRef.current?.id === id
      ? manualEditPendingStyleRef.current.styles
      : {};
    const keys = (Object.keys(styles) as Array<keyof ManualEditStyles>)
      .filter((key) => !Object.prototype.hasOwnProperty.call(supersededStyles, key));
    if (keys.length === 0) return;
    const sourceStyles = readManualEditStyles(baseSource, id);
    const resetPreviewStyles = keys.reduce<Partial<ManualEditStyles>>((acc, key) => {
      acc[key] = sourceStyles[key] ?? '';
      return acc;
    }, {});
    previewStyleToIframe(id, resetPreviewStyles, nextManualEditPreviewVersion());

    const target = id === '__body__'
      ? null
      : selectedManualEditTarget?.id === id
        ? selectedManualEditTarget
        : manualEditTargets.find((item) => item.id === id) ?? null;
    const inspectorStyles = target
      ? inspectorManualEditStyles(target, baseSource)
      : sourceStyles;
    const resetDraftStyles = keys.reduce<Partial<ManualEditStyles>>((acc, key) => {
      acc[key] = inspectorStyles[key] ?? '';
      return acc;
    }, {});
    setManualEditDraft((current) => ({
      ...current,
      styles: { ...current.styles, ...resetDraftStyles },
      fullSource: baseSource,
    }));
  }

  async function exitManualEditModeAfterFlush(): Promise<boolean> {
    const ok = await flushManualEditStyleSave();
    if (!ok) return false;
    skipSrcDocRebuildForMoveRef.current = false;
    // Flush any pending source state from move-element patches that skipped
    // setSource to avoid an iframe flash. The iframe will reload anyway on
    // edit-mode exit, so this is the right place to sync.
    if (sourceRef.current !== source) {
      setSource(sourceRef.current);
      setInlinedSource(null);
    }
    setManualEditPanelPosition(null);
    setManualEditMode(false);
    setManualEditHistory([]);
    setManualEditUndone([]);
    refreshSrcDocPreviewAfterManualEditExit();
    return true;
  }

  // Clears the hover affordance and re-arms the iframe's per-element hover
  // dedupe so re-entering the same element re-announces it. Called from the
  // workspace's own mouseleave (host-side), NOT the iframe's mouseleave — the
  // affordance overlays the iframe, so reacting to the iframe leaving would
  // yank it out from under the cursor and strobe on/off.
  function clearManualEditHover() {
    setManualEditHoverTarget(null);
    const win = iframeRef.current?.contentWindow;
    if (win) win.postMessage({ type: 'od-edit-hover-reset' }, '*');
  }

  function refreshSrcDocPreviewAfterManualEditExit() {
    setManualEditFrozenSource(null);
    if (!useUrlLoadPreview) return;
    const nextSrc = `${basePreviewSrcUrl}&me=${Date.now()}`;
    setPreviewSrcUrl(nextSrc);
    const frame = urlPreviewIframeRef.current;
    try {
      frame?.contentWindow?.location.replace(nextSrc);
    } catch {
      // The iframe may be temporarily cross-origin/unavailable while toggling transports.
    }
  }

  function manualEditViewportContentSize() {
    const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === previewViewport);
    return {
      width: activeCustomViewportSize?.width ?? preset?.width ?? 1920,
      height: activeCustomViewportSize?.height ?? preset?.height ?? 1080,
    };
  }

  function applyManualEditViewportVisual(interacting = false) {
    const shell = manualEditShellRef.current;
    if (!shell) return;
    const nextScale = zoomRef.current / 100;
    const nextTransform = manualEditViewportTransformRef.current;
    // Changing CSS zoom on an iframe subtree can expose a blank raster frame
    // after window/fullscreen resize. Keep layout stable and release the
    // compositor hint after interaction so Chromium can refresh sharp tiles.
    const style = manualEditPreviewShellStyle(
      previewViewport,
      nextScale,
      nextTransform,
      previewBodySize,
      activeCustomViewportSize ?? undefined,
      interacting,
    );
    shell.style.removeProperty('zoom');
    if (typeof style.transform === 'string') shell.style.transform = style.transform;
    shell.style.willChange = String(style.willChange ?? 'auto');
    manualEditCanvasRef.current?.style.removeProperty('transform');
  }

  useLayoutEffect(() => {
    if (!manualEditMode) return;
    applyManualEditViewportVisual(
      manualEditViewportCommitTimerRef.current !== null || manualEditPanRef.current !== null,
    );
  }, [
    manualEditMode,
    previewViewport,
    previewBodySize?.width,
    previewBodySize?.height,
    activeCustomViewportSize?.width,
    activeCustomViewportSize?.height,
    zoom,
    manualEditViewportTransform.x,
    manualEditViewportTransform.y,
  ]);

  function commitManualEditViewportState() {
    if (manualEditViewportCommitTimerRef.current !== null) {
      window.clearTimeout(manualEditViewportCommitTimerRef.current);
      manualEditViewportCommitTimerRef.current = null;
    }
    const nextTransform = manualEditViewportTransformRef.current;
    setManualEditViewportTransform((current) => (
      current.x === nextTransform.x && current.y === nextTransform.y ? current : nextTransform
    ));
    const nextZoom = zoomRef.current;
    setZoom((current) => current === nextZoom ? current : nextZoom);
    applyManualEditViewportVisual(false);
  }

  function queueManualEditViewportCommit() {
    if (manualEditViewportCommitTimerRef.current !== null) {
      window.clearTimeout(manualEditViewportCommitTimerRef.current);
    }
    manualEditViewportCommitTimerRef.current = window.setTimeout(() => {
      manualEditViewportCommitTimerRef.current = null;
      commitManualEditViewportState();
    }, 80);
  }

  function setManualEditViewportTransformValue(
    next: ManualEditViewportTransform,
    commit: 'deferred' | 'immediate' = 'deferred',
  ) {
    manualEditViewportTransformRef.current = next;
    applyManualEditViewportVisual(true);
    if (commit === 'immediate') commitManualEditViewportState();
    else queueManualEditViewportCommit();
  }

  function normalizeManualEditViewportPoint(data: {
    clientX?: unknown;
    clientY?: unknown;
    coordinateSpace: 'canvas' | 'iframe';
  }, scale: number): { x: number; y: number } | null {
    const canvas = manualEditCanvasRef.current;
    const clientX = Number(data.clientX);
    const clientY = Number(data.clientY);
    if (!canvas || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const canvasRect = canvas.getBoundingClientRect();
    if (data.coordinateSpace === 'iframe') {
      const iframe = iframeRef.current;
      const iframeRect = iframe?.getBoundingClientRect();
      if (!iframeRect) return {
        x: clientX - canvasRect.left,
        y: clientY - canvasRect.top,
      };
      return {
        x: iframeRect.left - canvasRect.left + clientX * scale,
        y: iframeRect.top - canvasRect.top + clientY * scale,
      };
    }
    return {
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    };
  }

  function handleManualEditViewportZoom(data: {
    clientX?: unknown;
    clientY?: unknown;
    coordinateSpace: 'canvas' | 'iframe';
    deltaY?: unknown;
  }) {
    const deltaY = Number(data.deltaY);
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    const currentZoom = zoomRef.current;
    const nextZoom = nextManualEditWheelZoom(currentZoom, deltaY);
    if (nextZoom === currentZoom) return;

    const oldUserScale = currentZoom / 100;
    const nextUserScale = nextZoom / 100;
    const contentSize = manualEditViewportContentSize();
    const canvasPadding = previewViewport === 'desktop' ? 0 : 48;
    const currentLayout = previewBodySize?.width && previewBodySize.height
      ? manualEditAutoFitTransform(
          previewBodySize.width,
          previewBodySize.height,
          contentSize.width,
          contentSize.height,
          oldUserScale,
          manualEditViewportTransformRef.current,
          canvasPadding,
        )
      : null;
    const effectiveOldScale = currentLayout?.zoom ?? oldUserScale;
    const anchor = normalizeManualEditViewportPoint(data, effectiveOldScale);
    if (anchor) {
      const pan = manualEditViewportTransformRef.current;
      if (currentLayout && previewBodySize) {
        manualEditViewportTransformRef.current = manualEditZoomPanAtPoint({
          anchor,
          currentPan: pan,
          currentUserScale: oldUserScale,
          nextUserScale,
          container: {
            width: previewBodySize.width,
            height: previewBodySize.height,
          },
          content: contentSize,
          canvasPadding,
        });
      } else {
        const contentX = (anchor.x - pan.x) / oldUserScale;
        const contentY = (anchor.y - pan.y) / oldUserScale;
        manualEditViewportTransformRef.current = {
          x: anchor.x - contentX * nextUserScale,
          y: anchor.y - contentY * nextUserScale,
        };
      }
    }

    zoomRef.current = nextZoom;
    applyManualEditViewportVisual(true);
    if (zoomMenuOpen) {
      setZoomMenuOpen(false);
      commitManualEditViewportState();
    } else {
      queueManualEditViewportCommit();
    }
  }

  function manualEditPanPoint(
    data: { clientX?: unknown; clientY?: unknown; screenX?: unknown; screenY?: unknown },
    preferScreenCoordinates: boolean,
  ) {
    const screenX = Number(data.screenX);
    const screenY = Number(data.screenY);
    const clientX = Number(data.clientX);
    const clientY = Number(data.clientY);
    if (preferScreenCoordinates && Number.isFinite(screenX) && Number.isFinite(screenY)) {
      return { x: screenX, y: screenY };
    }
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) return { x: clientX, y: clientY };
    if (Number.isFinite(screenX) && Number.isFinite(screenY)) return { x: screenX, y: screenY };
    return null;
  }

  function startManualEditViewportPan(data: {
    clientX?: unknown;
    clientY?: unknown;
    screenX?: unknown;
    screenY?: unknown;
  }, pointerId: number | null = null, preferScreenCoordinates = false) {
    const point = manualEditPanPoint(data, preferScreenCoordinates);
    if (!point) return;
    const current = manualEditViewportTransformRef.current;
    commitManualEditViewportState();
    manualEditPanRef.current = {
      pointerId,
      startClientX: point.x,
      startClientY: point.y,
      startX: current.x,
      startY: current.y,
    };
    setManualEditHoverTarget(null);
    setManualEditPanning(true);
  }

  function moveManualEditViewportPan(data: {
    clientX?: unknown;
    clientY?: unknown;
    screenX?: unknown;
    screenY?: unknown;
  }, preferScreenCoordinates = false) {
    const pan = manualEditPanRef.current;
    if (!pan) return;
    const point = manualEditPanPoint(data, preferScreenCoordinates);
    if (!point) return;
    setManualEditViewportTransformValue(manualEditPanFromPointer(
      { x: pan.startX, y: pan.startY },
      { x: pan.startClientX, y: pan.startClientY },
      point,
    ));
  }

  function finishManualEditViewportPan() {
    if (!manualEditPanRef.current) return;
    manualEditPanRef.current = null;
    commitManualEditViewportState();
    setManualEditPanning(false);
  }

  function handleManualEditViewportWheel(data: { clientX?: unknown; clientY?: unknown; deltaY?: unknown }) {
    handleManualEditViewportZoom({ ...data, coordinateSpace: 'iframe' });
  }

  function handleManualEditViewportPan(data: {
    phase?: unknown;
    clientX?: unknown;
    clientY?: unknown;
    screenX?: unknown;
    screenY?: unknown;
  }) {
    if (data.phase === 'start') {
      startManualEditViewportPan(data, null, true);
      return;
    }
    if (data.phase === 'move') {
      moveManualEditViewportPan(data, true);
      return;
    }
    if (data.phase === 'end') {
      moveManualEditViewportPan(data, true);
      finishManualEditViewportPan();
    }
  }

  function handleManualEditCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!manualEditMode) return;
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    handleManualEditViewportZoom({
      clientX: event.clientX,
      clientY: event.clientY,
      coordinateSpace: 'canvas',
      deltaY: event.deltaY,
    });
  }

  function isManualEditPanPointerEvent(event: ReactPointerEvent<HTMLDivElement>) {
    // Middle mouse button OR (spacebar held + left mouse button)
    return event.button === 1 || (event.buttons & 4) === 4
      || (manualEditSpaceHeldRef.current && event.button === 0);
  }

  function handleManualEditCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!manualEditMode || !isManualEditPanPointerEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may be unavailable in jsdom or older browser contexts.
    }
    startManualEditViewportPan(event, event.pointerId);
  }

  function handleManualEditCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!manualEditMode || !manualEditPanRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    // Detect button release: middle button no longer held, or space+left no longer held
    const middleButtonHeld = (event.buttons & 4) === 4;
    const leftButtonHeld = (event.buttons & 1) === 1;
    if (!middleButtonHeld && !leftButtonHeld) {
      finishManualEditViewportPan();
      return;
    }
    // If left button drag but space no longer held → stop panning
    if (!middleButtonHeld && leftButtonHeld && !manualEditSpaceHeldRef.current) {
      finishManualEditViewportPan();
      return;
    }
    moveManualEditViewportPan(event);
  }

  function handleManualEditCanvasPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!manualEditPanRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    moveManualEditViewportPan(event);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may be unavailable in jsdom or older browser contexts.
    }
    finishManualEditViewportPan();
  }

  async function selectManualEditTarget(target: ManualEditTarget, append = false) {
    setManualEditPageStylesOpen(false);
    if (manualEditPendingStyleRef.current?.id !== target.id) await flushManualEditStyleSave();
    const currentTargets = selectedManualEditTargetsRef.current;
    let nextTargets: ManualEditTarget[];
    if (append) {
      const existing = currentTargets.find((item) => item.id === target.id);
      if (existing) {
        nextTargets = currentTargets.filter((item) => item.id !== target.id);
      } else {
        nextTargets = [...currentTargets, target];
      }
      if (nextTargets.length === 0) {
        await clearManualEditTargetSelection();
        return;
      }
    } else {
      nextTargets = [target];
    }
    selectedManualEditTargetsRef.current = nextTargets;
    setSelectedManualEditTargets(nextTargets);
    const primary = nextTargets[0] ?? null;
    selectedManualEditTargetIdRef.current = primary?.id ?? null;
    setSelectedManualEditTarget(primary);
    if (primary) setDraftForManualEditTarget(primary);
    setManualEditError(null);
  }

  function setDraftForManualEditTarget(target: ManualEditTarget) {
    const base = sourceRef.current ?? '';
    const fields = readManualEditFields(base, target.id);
    setManualEditDraft({
      text: fields.text ?? target.fields.text ?? target.text,
      href: fields.href ?? target.fields.href ?? '',
      src: fields.src ?? target.fields.src ?? '',
      alt: fields.alt ?? target.fields.alt ?? '',
      styles: inspectorManualEditStyles(target, base),
      attributesText: JSON.stringify(readManualEditAttributes(base, target.id), null, 2),
      outerHtml: readManualEditOuterHtml(base, target.id) || target.outerHtml,
      fullSource: base,
    });
  }

  async function clearManualEditTargetSelection() {
    cancelManualEditStyleDraft();
    selectedManualEditTargetIdRef.current = null;
    selectedManualEditTargetsRef.current = [];
    setSelectedManualEditTarget(null);
    setSelectedManualEditTargets([]);
    setManualEditPanelPosition(null);
    setManualEditDraft(emptyManualEditDraft(sourceRef.current ?? ''));
    setManualEditError(null);
    postSelectedManualEditTargetsToIframe([]);
    // Reopen page styles so the inspector shows global settings instead
    // of going blank when the user deselects (ESC or click empty canvas).
    setManualEditPageStylesOpen(true);
  }

  // The inspector is scoped to one element (or the page). Closing it should
  // only collapse the panel and keep the user in edit mode — exiting edit is
  // the toolbar toggle's job. Dismiss flushes any in-flight tweak first so
  // nothing is lost; cancel reverts the in-flight unsaved tweak instead.
  async function dismissManualEditPanel() {
    const ok = await flushManualEditStyleSave();
    if (!ok) return;
    if (selectedManualEditTarget) void clearManualEditTargetSelection();
    else setManualEditPageStylesOpen(false);
  }

  function cancelManualEditPanel() {
    if (selectedManualEditTarget) {
      void clearManualEditTargetSelection();
    } else {
      cancelManualEditStyleDraft();
      setManualEditPageStylesOpen(false);
    }
  }

  async function applyManualEdit(patch: ManualEditPatch, label: string): Promise<boolean> {
    if (manualEditSavingRef.current) return false;
    if (sourceRef.current == null) return false;
    manualEditSavingRef.current = true;
    setManualEditSaving(true);
    setManualEditError(null);
    try {
      const baseSource = sourceRef.current;
      const result = applyManualEditPatch(baseSource, patch);
      if (!result.ok) {
        setManualEditError(result.error ?? 'Could not apply edit.');
        return false;
      }
      if (!(await confirmManualEditHistorySource(
        baseSource,
        'The file changed outside manual edit mode. Refreshing before applying manual edits.',
      ))) return false;
      const saved = await htmlFileSaveController.save(result.source, 'manual-edit-patch');
      if (!saved.ok) {
        const status = 'status' in saved ? saved.status : undefined;
        const code = 'code' in saved ? saved.code : undefined;
        const message = 'message' in saved ? saved.message : 'Unknown save error';
        if (patch.kind === 'set-style') {
          revertManualEditStylePreview(patch.id, patch.styles, baseSource);
        } else if (patch.kind === 'set-style-batch') {
          for (const item of patch.items) revertManualEditStylePreview(item.id, item.styles, baseSource);
        }
        setManualEditError(
          `Could not save the edited file${status ? ` (${status}${code ? ` ${code}` : ''})` : ''}: ${message}`,
        );
        return false;
      }
      const entry: ManualEditHistoryEntry = {
        id: `${Date.now()}-${manualEditHistory.length}`,
        label,
        patch,
        beforeSource: baseSource,
        afterSource: result.source,
        createdAt: Date.now(),
      };
      manualEditSourceRoundTripRef.current = markManualEditLocalSave(
        manualEditSourceRoundTripRef.current,
        result.source,
      );
      const persistedDomPatchInPlace = manualEditRequiresSrcDoc && (
        patch.kind === 'remove-element'
        || patch.kind === 'set-link'
        || patch.kind === 'set-image'
        || patch.kind === 'set-attributes'
        || patch.kind === 'align-elements'
      );
      // For move-element, the bridge already applied the change optimistically
      // in the iframe DOM. Skip React state updates that would rebuild srcDoc
      // (which causes a flash and loses the bridge's selection state).
      // sourceRef is still updated so the next patch operates on the correct base.
      const skipSrcDocRebuild = patch.kind === 'move-element';
      if (skipSrcDocRebuild) {
        skipSrcDocRebuildForMoveRef.current = true;
      } else {
        // Non-move patches rebuild srcDoc normally; clear any lingering
        // move-element suppression so external changes are handled again.
        skipSrcDocRebuildForMoveRef.current = false;
        setSource(result.source);
        setInlinedSource(null);
        if (
          patch.kind !== 'set-style'
          && patch.kind !== 'set-style-batch'
          && patch.kind !== 'set-text'
          && !persistedDomPatchInPlace
        ) {
          setManualEditFrozenSource(result.source);
        }
      }
      sourceRef.current = result.source;
      if (persistedDomPatchInPlace) {
        if (patch.kind === 'remove-element') removeManualEditElementFromIframe(patch.id);
        else if (patch.kind === 'align-elements') {
          for (const id of patch.ids) {
            previewStyleToIframe(
              id,
              readManualEditStyles(result.source, id),
              ++manualEditPreviewVersionRef.current,
            );
          }
        } else if (
          patch.kind === 'set-link'
          || patch.kind === 'set-image'
          || patch.kind === 'set-attributes'
        ) {
          applyManualEditFieldsToIframe(patch);
        }
      }
      setManualEditHistory((current) => {
        const next = [entry, ...current];
        return next.length > MAX_MANUAL_EDIT_HISTORY ? next.slice(0, MAX_MANUAL_EDIT_HISTORY) : next;
      });
      setManualEditUndone([]);
      setManualEditDraft((current) => ({ ...current, fullSource: result.source }));
      if (patch.kind === 'set-text') {
        setSelectedManualEditTarget((current) => current?.id === patch.id
          ? { ...current, text: patch.value, fields: { ...current.fields, text: patch.value } }
          : current);
        setSelectedManualEditTargets((current) => {
          const next = current.map((target) => target.id === patch.id
            ? { ...target, text: patch.value, fields: { ...target.fields, text: patch.value } }
            : target);
          selectedManualEditTargetsRef.current = next;
          return next;
        });
      } else if (patch.kind === 'remove-element') {
        if (manualEditPendingStyleRef.current?.id === patch.id) {
          manualEditPendingStyleRef.current = null;
          clearManualEditStyleTimer();
        }
        const nextSelectedTargets = selectedManualEditTargetsRef.current.filter((target) => target.id !== patch.id);
        selectedManualEditTargetsRef.current = nextSelectedTargets;
        selectedManualEditTargetIdRef.current = nextSelectedTargets[0]?.id ?? null;
        setSelectedManualEditTarget(nextSelectedTargets[0] ?? null);
        setSelectedManualEditTargets(nextSelectedTargets);
        setManualEditTargets((current) => current.filter((target) => target.id !== patch.id));
        if (nextSelectedTargets[0]) setDraftForManualEditTarget(nextSelectedTargets[0]);
        else setManualEditDraft(emptyManualEditDraft(result.source));
        postSelectedManualEditTargetsToIframe(nextSelectedTargets.map((target) => target.id));
      } else if (patch.kind === 'move-element') {
        // srcDoc was not rebuilt (see skipSrcDocRebuild above), so the bridge's
        // optimistic DOM swap and selection are still intact. No re-post needed.
      } else {
        setManualEditDraft((current) => ({ ...current, fullSource: result.source }));
      }
      if (patch.kind === 'set-style') {
        reconcileManualEditStyleSave(patch.id, patch.styles, result.source);
      }
      setManualEditError(null);
      await onFileSaved?.({ fileName: file.name, reason: 'manual-edit-patch' });
      return true;
    } finally {
      manualEditSavingRef.current = false;
      setManualEditSaving(false);
      if (manualEditFlushAfterSaveRef.current && manualEditPendingStyleRef.current) {
        manualEditFlushAfterSaveRef.current = false;
        void flushManualEditStyleSave();
      }
    }
  }

  async function confirmManualEditHistorySource(expectedSource: string, message: string): Promise<boolean> {
    const persisted = await fetchProjectFileText(projectId, file.name, {
      cache: 'no-store',
      cacheBustKey: Date.now(),
    });
    if (persisted == null || persisted === expectedSource) return true;
    setSource(persisted);
    sourceRef.current = persisted;
    setInlinedSource(null);
    setManualEditHistory([]);
    setManualEditUndone([]);
    manualEditPendingStyleRef.current = null;
    setManualEditDraft((current) => ({ ...current, fullSource: persisted }));
    setManualEditError(message);
    return false;
  }

  async function undoManualEdit() {
    if (manualEditSavingRef.current) return;
    skipSrcDocRebuildForMoveRef.current = false;
    const [latest, ...rest] = manualEditHistory;
    if (!latest) return;
    manualEditSavingRef.current = true;
    setManualEditSaving(true);
    try {
      if (!(await confirmManualEditHistorySource(
        latest.afterSource,
        'The file changed outside manual edit mode. History was cleared to avoid overwriting newer content.',
      ))) return;
      const saved = await htmlFileSaveController.save(latest.beforeSource, 'manual-edit-undo');
      if (!saved.ok) {
        setManualEditError('Could not save the undo result.');
        return;
      }
      setSource(latest.beforeSource);
      sourceRef.current = latest.beforeSource;
      manualEditSourceRoundTripRef.current = markManualEditLocalSave(
        manualEditSourceRoundTripRef.current,
        latest.beforeSource,
      );
      setInlinedSource(null);
      setManualEditFrozenSource(latest.beforeSource);
      setManualEditHistory(rest);
      setManualEditUndone((current) => [latest, ...current]);
      setManualEditDraft((current) => ({ ...current, fullSource: latest.beforeSource }));
    } finally {
      manualEditSavingRef.current = false;
      setManualEditSaving(false);
    }
  }

  async function redoManualEdit() {
    if (manualEditSavingRef.current) return;
    skipSrcDocRebuildForMoveRef.current = false;
    const [latest, ...rest] = manualEditUndone;
    if (!latest) return;
    manualEditSavingRef.current = true;
    setManualEditSaving(true);
    try {
      if (!(await confirmManualEditHistorySource(
        latest.beforeSource,
        'The file changed outside manual edit mode. History was cleared to avoid overwriting newer content.',
      ))) return;
      const saved = await htmlFileSaveController.save(latest.afterSource, 'manual-edit-redo');
      if (!saved.ok) {
        setManualEditError('Could not save the redo result.');
        return;
      }
      setSource(latest.afterSource);
      sourceRef.current = latest.afterSource;
      manualEditSourceRoundTripRef.current = markManualEditLocalSave(
        manualEditSourceRoundTripRef.current,
        latest.afterSource,
      );
      setInlinedSource(null);
      setManualEditFrozenSource(latest.afterSource);
      setManualEditUndone(rest);
      setManualEditHistory((current) => [latest, ...current]);
      setManualEditDraft((current) => ({ ...current, fullSource: latest.afterSource }));
    } finally {
      manualEditSavingRef.current = false;
      setManualEditSaving(false);
    }
  }

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z = redo
  useEffect(() => {
    if (!manualEditMode) return;
    // GrapesJS owns the undo stack when its canvas is mounted.
    if (useGrapesjs) return;
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      // Delete/Backspace: remove selected elements (skip when typing in inputs)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
        const targets = selectedManualEditTargetsRef.current;
        if (targets.length > 0 && !manualEditSavingRef.current) {
          e.preventDefault();
          (async () => {
            for (const target of targets) {
              await applyManualEdit(
                { id: target.id, kind: 'remove-element' },
                t('manualEdit.deleteElement'),
              );
            }
          })();
        }
      }
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (manualEditHistory.length > 0 && !manualEditSavingRef.current) {
          void undoManualEdit();
        } else if (manualEditHistory.length === 0 && manualEditUndone.length > 0) {
          setManualEditUndoLimitToast(true);
        }
      }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        if (manualEditUndone.length > 0 && !manualEditSavingRef.current) {
          void redoManualEdit();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    // Also listen on the iframe window so Ctrl+Z works when the preview has focus
    const iframeWin = iframeRef.current?.contentWindow;
    try {
      iframeWin?.addEventListener('keydown', onKeyDown);
    } catch {
      // Ignore cross-origin iframe errors
    }
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      try {
        iframeWin?.removeEventListener('keydown', onKeyDown);
      } catch {
        // Ignore cross-origin iframe errors
      }
    };
  }, [manualEditMode, manualEditHistory, manualEditUndone]);

  // Inspect-mode picker: same `od:comment-target` payload, different sink.
  // The bridge tags the message with a computed-style snapshot so the panel
  // can show real starting values for color / typography / spacing / radius.
  useEffect(() => {
    if (!inspectMode) return;
    // PR2: GrapesJS path drives selection via GrapesjsEditor.onSelectTargets
    // and extractInspectTarget — no iframe message to listen for.
    if (useGrapesjs) return;
    function onMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      const data = ev.data as
        | {
            type?: string;
            elementId?: string;
            selector?: string;
            label?: string;
            text?: string;
            style?: InspectStyleSnapshot;
            clickedDescendant?: Partial<InspectClickedDescendant>;
          }
        | null;
      if (!data || data.type !== 'od:comment-target') return;
      if (!data.elementId || !data.selector) return;
      const clickedDescendant =
        data.clickedDescendant && typeof data.clickedDescendant === 'object'
          ? {
              label: String(data.clickedDescendant.label || ''),
              text: String(data.clickedDescendant.text || ''),
            }
          : null;
      setActiveInspectTarget({
        elementId: String(data.elementId),
        selector: String(data.selector),
        label: String(data.label || ''),
        text: String(data.text || ''),
        style: data.style && typeof data.style === 'object' ? data.style : {},
        ...(clickedDescendant ? { clickedDescendant } : {}),
      });
      setInspectError(null);
      setInspectSavedAt(null);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [inspectMode, isOurPreviewIframeSource, useGrapesjs]);

  function postSlide(action: 'next' | 'prev' | 'first' | 'last') {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'od:slide', action }, '*');
  }

  function syncCachedSlideStateToIframe(target: HTMLIFrameElement | null = iframeRef.current) {
    const active = htmlPreviewSlideState.get(previewStateKey)?.active;
    const win = target?.contentWindow;
    if (!win || typeof active !== 'number') return;
    win.postMessage({ type: 'od:slide', action: 'go', index: active }, '*');
  }

  function postInspectSet(elementId: string, selector: string, prop: string, value: string) {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      { type: 'od:inspect-set', elementId, selector, prop, value },
      '*',
    );
  }

  function postInspectReset(elementId?: string) {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'od:inspect-reset', elementId }, '*');
  }

  // Replay the host's authoritative override map into the freshly loaded
  // iframe. The bridge inside the iframe only sees rules persisted in the
  // artifact source via its own hydrateOverridesFromDom() — any unsaved
  // edit lives on the host side until Save-to-source. Without this replay,
  // toggling Inspect off/on, switching to Comment mode, or any other
  // srcdoc rebuild reloads the iframe from previewSource without the
  // unsaved style block, so the preview drops the live edits while
  // saveInspectToSource() can still persist them later from the stale
  // host map. The bridge re-validates each entry under its own allow-list,
  // so a parent that posted a hostile replay can only land overrides the
  // bridge would also have accepted via od:inspect-set.
  //
  // The render-time hydration above keeps `inspectOverrides` aligned with
  // the current `source` whenever React commits, but the iframe `onLoad`
  // callback fires from a separate event-loop turn after the new srcDoc
  // is parsed; if it ever races a stale closure (e.g. an interleaved
  // remount), reading React state would post the previous file's map over
  // the bridge's DOM-hydrated one and silently strip the persisted styles
  // from preview. Re-derive synchronously from `source` whenever the
  // hydration ref disagrees so onLoad never sends a stale snapshot.
  function replayInspectOverridesToIframe(target: HTMLIFrameElement | null = iframeRef.current) {
    const win = target?.contentWindow;
    if (!win) return;
    const overrides = inspectHydratedSourceRef.current === source
      ? inspectOverrides
      : (typeof source === 'string' ? parseInspectOverridesFromSource(source) : {});
    win.postMessage({ type: 'od:inspect-replay', overrides }, '*');
  }

  // Persist accumulated inspect overrides into the artifact source: replace
  // (or insert) a single <style data-od-inspect-overrides> block in <head>.
  // The CSS body is serialized from the host's own override map, hydrated
  // from source on load and updated only by host-driven onApply / reset
  // callbacks. We deliberately do NOT round-trip through the iframe at save
  // time: artifact JS rendered inside the preview shares the same
  // contentWindow as the bridge and could forge an od:inspect-overrides
  // reply that flips allow-listed properties on elements the user never
  // touched. POSTing to /api/projects/:id/files upserts the file via
  // writeProjectFile (multipart-or-JSON; we use JSON).
  async function saveInspectToSource() {
    if (!source) return;
    setSavingInspect(true);
    setInspectError(null);
    try {
      // PR2 GrapesJS path: persist each override via editor.Css.setRule so
      // the next getDocument() picks it up in the CSS block, then write
      // the full GrapesJS document back. The iframe path below stays
      // unchanged for deck / module / sandbox shim artifacts.
      if (useGrapesjs) {
        const editor = grapesjsEditorRef.current?.getEditor();
        if (!editor) {
          throw new Error('Canvas not ready');
        }
        for (const [elementId, decls] of Object.entries(inspectOverrides)) {
          if (decls && typeof decls === 'object') {
            const flat = Object.entries(decls).reduce<Record<string, string>>((acc, [k, v]) => {
              if (typeof v === 'string') acc[k] = v;
              return acc;
            }, {});
            persistStyleOverride(editor, elementId, flat);
          }
        }
        const next = withGrapesjsArtboardNameMeta(grapesjsEditorRef.current?.getDocument() ?? source);
        await htmlFileSaveController.saveOrThrow(next, 'inspect-save');
        setSource(next);
        setInspectSavedAt(Date.now());
        return;
      }
      const css = serializeInspectOverrides(inspectOverrides).trim();
      const next = applyInspectOverridesToSource(source, css);
      await htmlFileSaveController.saveOrThrow(next, 'inspect-save');
      setSource(next);
      setInspectSavedAt(Date.now());
      setReloadKey((k) => k + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setInspectError(msg);
      // The error banner inside the inspect panel is easy to miss when the
      // user is focused on the iframe preview — surface failures in the
      // console as well so quota/network errors aren't silently lost.
      console.error('[inspect] saveToSource failed:', err);
    } finally {
      setSavingInspect(false);
    }
  }

  // Keyboard nav on the host, so the user can press ←/→ even when focus
  // is on the chat composer or any other host control.
  useEffect(() => {
    if (!effectiveDeck || mode !== 'preview') return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        postSlide('next');
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        postSlide('prev');
      } else if (e.key === 'Home') {
        e.preventDefault();
        postSlide('first');
      } else if (e.key === 'End') {
        e.preventDefault();
        postSlide('last');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [effectiveDeck, mode]);

  useEffect(() => {
    if (!presentMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.present-wrap')) return;
      setPresentMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresentMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [presentMenuOpen]);

  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!zoomMenuRef.current) return;
      if (!zoomMenuRef.current.contains(e.target as Node)) setZoomMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [zoomMenuOpen]);

  useEffect(() => {
    if (!grapesjsShapeMenuOpen && !grapesjsShortcutHelpOpen && !grapesjsIconLibraryOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && grapesjsBottomToolbarRef.current?.contains(target)) return;
      setGrapesjsShapeMenuOpen(false);
      setGrapesjsShortcutHelpOpen(false);
      setGrapesjsIconLibraryOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGrapesjsShapeMenuOpen(false);
        setGrapesjsShortcutHelpOpen(false);
        setGrapesjsIconLibraryOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [grapesjsShapeMenuOpen, grapesjsShortcutHelpOpen, grapesjsIconLibraryOpen]);

  useEffect(() => {
    setGrapesjsIconLimit(GRAPESJS_ICON_PAGE_SIZE);
  }, [grapesjsIconLibrary, grapesjsIconQuery]);

  useEffect(() => {
    const query = grapesjsIconQuery.trim();
    if (!grapesjsIconLibraryOpen || !query) {
      setGrapesjsRemoteIcons([]);
      setGrapesjsRemoteIconsLoading(false);
      setGrapesjsRemoteIconsError(null);
      return;
    }
    const controller = new AbortController();
    setGrapesjsRemoteIconsLoading(true);
    setGrapesjsRemoteIconsError(null);
    const url = buildIconifySearchUrl({ query, limit: GRAPESJS_REMOTE_ICON_PAGE_SIZE });
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Icon search failed: ${response.status}`);
        return response.json() as Promise<{ icons?: string[] }>;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setGrapesjsRemoteIcons(iconifySearchResultsToIcons(payload));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setGrapesjsRemoteIcons([]);
        setGrapesjsRemoteIconsError(error instanceof Error ? error.message : '远程图标加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setGrapesjsRemoteIconsLoading(false);
      });
    return () => controller.abort();
  }, [grapesjsIconLibraryOpen, grapesjsIconQuery]);

  useEffect(() => {
    if (!agentToolsOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.artifact-tool-menu-anchor')) return;
      closeArtifactToolMenus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeArtifactToolMenus();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [agentToolsOpen]);

  useEffect(() => {
    if (!deployMenuOpen && !downloadMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!shareRef.current) return;
      if (shareRef.current.contains(e.target as Node)) return;
      setDeployMenuOpen(false);
      setDownloadMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setDeployMenuOpen(false);
      setDownloadMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [deployMenuOpen, downloadMenuOpen]);

  // Cmd+\ (macOS) / Ctrl+\ (Windows/Linux) toggles fullscreen.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          const el = previewBodyRef.current;
          if (el && typeof el.requestFullscreen === 'function') {
            el.requestFullscreen().catch(() => {});
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!inTabPresent) return;
    const bodyStyle = document.body.style;
    const previousChromeHeight = bodyStyle.getPropertyValue('--workspace-tabs-chrome-height');
    const updateChromeHeight = () => {
      const chrome = document.querySelector<HTMLElement>('.workspace-tabs-chrome.app-chrome-header');
      const height = chrome?.getBoundingClientRect().height ?? 0;
      if (height > 0) {
        bodyStyle.setProperty('--workspace-tabs-chrome-height', `${Math.round(height)}px`);
      } else {
        bodyStyle.removeProperty('--workspace-tabs-chrome-height');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (inTabPresent && e.key === 'Escape') setInTabPresent(false);
    };
    updateChromeHeight();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', updateChromeHeight);
    const chrome = document.querySelector<HTMLElement>('.workspace-tabs-chrome.app-chrome-header');
    const observer = chrome && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateChromeHeight) : null;
    if (observer && chrome) observer.observe(chrome);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updateChromeHeight);
      observer?.disconnect();
      if (previousChromeHeight) {
        bodyStyle.setProperty('--workspace-tabs-chrome-height', previousChromeHeight);
      } else {
        bodyStyle.removeProperty('--workspace-tabs-chrome-height');
      }
    };
  }, [inTabPresent]);

  function openInNewTab() {
    if (!source) return;
    openSandboxedPreviewInNewTab(source, exportTitle, {
      deck: effectiveDeck,
      baseHref: projectRawUrl(projectId, baseDirFor(file.name)),
      initialSlideIndex: htmlPreviewSlideState.get(previewStateKey)?.active ?? 0,
    });
  }

  // Snapshot this project as a reusable template. The daemon snapshots
  // EVERY html/text/code file in the project (not just the file open in
  // the viewer), so the template captures the whole design, not a single
  // page. Surfaced here in the Download menu because templates are saved
  // from the same artifact output surface as files.
  function openSaveAsTemplateModal() {
    setDownloadMenuOpen(false);
    const defaultName =
      file.name.replace(/\.html?$/i, '') || t('fileViewer.templateNameDefault');
    setTemplateName(defaultName);
    setTemplateDescription('');
    setTemplateSaveError(null);
    setTemplateModalOpen(true);
  }

  async function handleSaveAsTemplate() {
    const name = templateName.trim();
    if (!name) return;
    setSavingTemplate(true);
    setTemplateNote(null);
    setTemplateSaveError(null);
    let savedName: string | null = null;
    try {
      const tpl = await saveTemplate({
        name,
        description: templateDescription.trim() || undefined,
        sourceProjectId: projectId,
      });
      if (!tpl) {
        setTemplateSaveError(t('fileViewer.savedTemplateFail'));
        return;
      }
      savedName = tpl.name;
      setTemplateModalOpen(false);
      setTemplateName('');
      setTemplateDescription('');
      setTemplateNote(t('fileViewer.savedTemplate', { name: tpl.name }));
      // Show success toast
      setTemplateSavedToast(t('fileViewer.savedTemplate', { name: tpl.name }));
    } finally {
      setSavingTemplate(false);
      if (savedName) {
        // Auto-clear the note so the menu doesn't keep stale state next open.
        setTimeout(() => setTemplateNote(null), 4000);
      }
    }
  }

  async function openDeployModal(nextProviderId: WebDeployProviderId = deployProviderId) {
    setDeployMenuOpen(false);
    setDeployModalOpen(true);
    setDeployError(null);
    setDeployActionToast(null);
    setCopiedDeployLink(null);
    setDeployPhase('idle');
    await loadDeployProvider(nextProviderId, { fallbackToExisting: true });
  }

  async function openSocialShareFlow() {
    const providerWithDeployment = DEPLOY_PROVIDER_OPTIONS.find(
      (option) => deploymentsByProvider[option.id]?.url?.trim(),
    )?.id;
    await openDeployModal(providerWithDeployment ?? deployProviderId);
  }

  async function changeDeployProvider(nextProviderId: WebDeployProviderId) {
    if (nextProviderId === deployProviderId) return;
    setDeployError(null);
    setDeployPhase('idle');
    await loadDeployProvider(nextProviderId);
  }

  async function saveDeployConfig() {
    setSavingDeployConfig(true);
    setDeployError(null);
    setDeployActionToast(null);
    try {
      if (deployProviderId === CLOUDFLARE_PAGES_PROVIDER_ID) {
        if (!deployToken.trim()) {
          setDeployActionToast(t('fileViewer.cloudflareApiTokenRequired'));
          deployTokenInputRef.current?.focus();
          return null;
        }
        if (!cloudflareAccountId.trim()) {
          throw new Error(t('fileViewer.cloudflareAccountIdRequired'));
        }
      }
      const config = await updateDeployConfig(buildDeployConfigRequest(deployProviderId));
      if (!config || config.providerId !== deployProviderId) {
        throw new Error(t('fileViewer.deployProviderConfigSaveFailed', { provider: deployProviderLabel }));
      }
      syncDeployFormFromConfig(deployProviderId, config);
      if (deployProviderId === CLOUDFLARE_PAGES_PROVIDER_ID) {
        await loadCloudflareZones(config);
      }
      return config;
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : t('fileViewer.deployProviderConfigSaveFailed', { provider: deployProviderLabel }));
      return null;
    } finally {
      setSavingDeployConfig(false);
    }
  }

  function buildCloudflarePagesDeploySelection(): WebCloudflarePagesDeploySelection | undefined {
    if (deployProviderId !== CLOUDFLARE_PAGES_PROVIDER_ID) return undefined;
    const prefix = normalizeCloudflareDomainPrefixInput(cloudflareDomainPrefix);
    if (!prefix) return undefined;
    if (!isValidCloudflareDomainPrefixInput(prefix)) {
      throw new Error(t('fileViewer.cloudflareDomainPrefixInvalid'));
    }
    const zone = cloudflareZones.find((item) => item.id === cloudflareZoneId);
    if (!zone) {
      throw new Error(t('fileViewer.cloudflareZoneRequired'));
    }
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      domainPrefix: prefix,
    };
  }

  async function deployToSelectedProvider() {
    setDeploying(true);
    setDeployPhase('deploying');
    setDeployError(null);
    setDeployActionToast(null);
    setCopiedDeployLink(null);
    try {
      const cloudflarePagesSelection = buildCloudflarePagesDeploySelection();
      const typedToken = deployToken.trim();
      const hasNewToken = typedToken && typedToken !== deployConfig?.tokenMask;
      const cloudflareHints = cloudflareConfigHintsFromForm();
      const cloudflareHintsChanged = deployProviderId === CLOUDFLARE_PAGES_PROVIDER_ID && Boolean(
        cloudflareHints?.lastZoneId !== deployConfig?.cloudflarePages?.lastZoneId ||
        cloudflareHints?.lastZoneName !== deployConfig?.cloudflarePages?.lastZoneName ||
        cloudflareHints?.lastDomainPrefix !== deployConfig?.cloudflarePages?.lastDomainPrefix,
      );
      const needsConfigSave =
        hasNewToken ||
        teamId.trim() !== (deployConfig?.teamId || '') ||
        teamSlug.trim() !== (deployConfig?.teamSlug || '') ||
        cloudflareAccountId.trim() !== (deployConfig?.accountId || '') ||
        cloudflareHintsChanged ||
        !deployConfig?.configured;
      if (needsConfigSave) {
        const nextConfig = await saveDeployConfig();
        if (!nextConfig) return;
        if (!nextConfig?.configured) {
          const option = getDeployProviderOption(deployProviderId);
          throw new Error(t(option.tokenRequiredKey, { provider: t(option.labelKey) }));
        }
      }
      setDeployPhase('preparing-link');
      const next = await deployProjectFile(projectId, file.name, deployProviderId, cloudflarePagesSelection);
      setDeploymentsByProvider((current) => ({
        ...current,
        [next.providerId]: next,
      }));
      setDeployment(next);
      setDeployResult(next);
      if (deployResultState(next.status) !== 'failed') {
        setDeploySavedToast({
          message: t('fileViewer.deploySuccessToast'),
          details: t('fileViewer.deploySuccessToastDetails', {
            provider: deployProviderLabel,
            url: next.url,
          }),
        });
      }
    } catch (err) {
      const option = getDeployProviderOption(deployProviderId);
      const message = err instanceof Error
        ? err.message
        : t('fileViewer.deployProviderFailed', { provider: t(option.labelKey) });
      if (message === t(option.tokenRequiredKey, { provider: t(option.labelKey) })) {
        setDeployActionToast(message);
        deployTokenInputRef.current?.focus();
      } else {
        setDeployError(message);
      }
    } finally {
      setDeploying(false);
      setDeployPhase('idle');
    }
  }

  async function retryDeploymentLink() {
    const current = deployResult || deployment;
    if (!current?.id) return;
    setDeployError(null);
    setDeployPhase('preparing-link');
    try {
      const next = await checkDeploymentLink(projectId, current.id);
      setDeploymentsByProvider((items) => ({
        ...items,
        [next.providerId]: next,
      }));
      setDeployment(next);
      setDeployResult(next);
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : t('fileViewer.deployFailed'));
    } finally {
      setDeployPhase('idle');
    }
  }

  async function copyDeployLink(url: string) {
    const safeUrl = url.trim();
    if (!safeUrl) return;
    try {
      await navigator.clipboard.writeText(safeUrl);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = safeUrl;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedDeployLink(safeUrl);
    window.setTimeout(() => {
      setCopiedDeployLink((current) => (current === safeUrl ? null : current));
    }, 1800);
  }

  async function copyShareLink(url: string) {
    const safeUrl = url.trim();
    if (!safeUrl) {
      setShareLinkFeedback('failed');
      setExportToast({ message: t('useEverywhere.copyFailed'), tone: 'error' });
      return false;
    }
    const ok = await copyToClipboard(safeUrl);
    const feedback = ok ? 'copied' : 'failed';
    setShareLinkFeedback(feedback);
    if (!ok) setExportToast({ message: t('useEverywhere.copyFailed'), tone: 'error' });
    window.setTimeout(() => {
      setShareLinkFeedback((current) => (current === feedback ? null : current));
    }, 1800);
    return ok;
  }

  function presentInThisTab() {
    setPresentMenuOpen(false);
    setMode('preview');
    setInTabPresent(true);
  }

  function presentFullscreen() {
    setPresentMenuOpen(false);
    const el = previewBodyRef.current;
    if (el && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => setInTabPresent(true));
    } else {
      setInTabPresent(true);
    }
  }

  function presentNewTab() {
    setPresentMenuOpen(false);
    openInNewTab();
  }

  async function reloadHtmlPreview() {
    fireArtifactToolbarClick('reload');
    capturePreviewScrollPosition();
    imageExportSnapshotDataUrlRef.current = null;
    setInlinedSource(null);
    if (useGrapesjs) {
      const next = syncGrapesjsDocumentToSource() ?? sourceRef.current ?? source;
      if (next) {
        htmlFileSaveController.cancelScheduledSave();
        await htmlFileSaveController.saveBestEffort(next, 'grapesjs-autosave-flush');
        grapesjsSelectionStoreRef.current.invalidate();
        setGrapesjsSelectionActive(false);
        setGrapesjsSelection(null);
        setActiveInspectTarget(null);
        grapesjsEditorRef.current?.setHtml(next);
      }
      setReloadKey((key) => key + 1);
      return;
    }
    setReloadKey((key) => key + 1);
    if (!useUrlLoadPreview) {
      activatedSrcDocTransportHtmlRef.current = null;
      setSrcDocShellReady(false);
      setSrcDocTransportResetKey((key) => key + 1);
    }
  }

  useEffect(() => {
    reloadHtmlPreviewRef.current = () => {
      void reloadHtmlPreview();
    };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const primary = isMacPlatform()
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!primary || event.altKey || event.key.toLowerCase() !== 'r') return;
      if (event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      reloadHtmlPreviewRef.current();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  function syncGrapesjsDocumentToSource(): string | null {
    if (!useGrapesjs) return null;
    const rawNext = grapesjsEditorRef.current?.getDocument();
    if (!rawNext) return null;
    const next = withGrapesjsArtboardNameMeta(rawNext);
    const changed = next !== sourceRef.current || next !== source;
    sourceRef.current = next;
    flushGrapesjsSourceState(next);
    if (changed) setCodeDirty(true);
    return next;
  }

  function selectMode(nextMode: 'preview' | 'source'): boolean {
    if (nextMode === 'source') setDrawOverlayOpen(false);
    if (nextMode === 'source') syncGrapesjsDocumentToSource();
    if (nextMode !== mode && mode === 'source' && codeDirty) {
      const proceed = window.confirm(t('fileViewer.codeUnsavedConfirm'));
      if (!proceed) return false;
      setCodeDirty(false);
      codeSavedSourceRef.current = source;
    }
    setMode(nextMode);
    return true;
  }

  async function handleCodeSave() {
    const currentSource = sourceRef.current;
    if (currentSource == null) return;
    const saved = await htmlFileSaveController.save(currentSource, 'code-save');
    if (saved.ok) {
      codeSavedSourceRef.current = currentSource;
      setCodeDirty(false);
    }
  }

  function activateBoard(nextTool?: BoardTool) {
    setMode('preview');
    setBoardMode(true);
    if (nextTool) setBoardTool(nextTool);
  }

  function activateBoardPicker(nextTool: BoardTool) {
    clearBoardComposer();
    fireArtifactToolbarClick(nextTool === 'pod' ? 'pods' : 'comment');
    setCommentPanelOpen(false);
    setCommentCreateMode(false);
    activateBoard(nextTool);
    setAgentToolsOpen(false);
  }

  function clearBoardComposer() {
    setActiveCommentTarget(null);
    setHoveredCommentTarget(null);
    setHoveredPodMemberId(null);
    setActivePreviewCommentId(null);
    setCommentDraft('');
    setQueuedBoardNotes([]);
    setBoardImages([]);
    setActiveCommentExistingAttachments([]);
    setBoardPreviewIndex(null);
    setStrokePoints([]);
  }

  function addBoardImages(files: File[]) {
    const imgs = files.filter((file) => file.type.startsWith('image/'));
    if (imgs.length > 0) setBoardImages((current) => [...current, ...imgs]);
  }

  function removeBoardImage(index: number) {
    setBoardImages((current) => current.filter((_, i) => i !== index));
    setBoardPreviewIndex(null);
  }

  function closeArtifactToolMenus() {
    setAgentToolsOpen(false);
    setGrapesjsShapeMenuOpen(false);
  }

  function currentGrapesjsHasSelection(): boolean {
    if (!useGrapesjs) return false;
    const editor = grapesjsEditorRef.current?.getEditor();
    if (!editor) return grapesjsSelectionActive;
    try {
      const selectedAll = editor.getSelectedAll?.();
      if (Array.isArray(selectedAll)) return selectedAll.length > 0;
    } catch {
      // Fall through to getSelected.
    }
    try {
      return Boolean(editor.getSelected?.());
    } catch {
      return grapesjsSelectionActive;
    }
  }

  function restoreGrapesjsEditPanelState() {
    if (!useGrapesjs) {
      onEditModeChange?.(false);
      onEditSelectionChange?.(false);
      return;
    }
    const snapshot = grapesjsEditorRef.current?.getSelectionSnapshot?.() ?? null;
    const hasSelection = snapshot?.hasSelection ?? currentGrapesjsHasSelection();
    if (snapshot) setGrapesjsSelection(snapshot);
    setGrapesjsSelectionActive(hasSelection);
    setInspectMode(true);
    setGrapesjsSidebarTab('inspect');
    setDrawOverlayOpen(false);
    setMode('preview');
    onEditModeChange?.(true);
    onEditSelectionChange?.(hasSelection);
    grapesjsEditorRef.current?.reselectCurrent?.();
  }

  function activateDrawTool() {
    fireArtifactToolbarClick('mark');
    setGrapesjsCanvasTool('cursor');
    const next = !drawOverlayOpen;
    if (!next) {
      setDrawOverlayOpen(false);
      setAgentToolsOpen(false);
      return;
    }
    capturePreviewScrollPosition();
    const activateDraw = () => {
      setCommentPanelOpen(false);
      setCommentCreateMode(false);
      setBoardMode(false);
      clearBoardComposer();
      setInspectMode(false);
      setMode('preview');
      setDrawOverlayOpen(true);
      closeArtifactToolMenus();
    };
    if (fallbackManualEditMode) {
      void exitManualEditModeAfterFlush().then((ok) => {
        if (ok) activateDraw();
      });
      return;
    }
    activateDraw();
  }

  function deactivateElementSelectionMode() {
    setGrapesjsCanvasTool('cursor');
    setBoardMode(false);
    setCommentCreateMode(false);
    setCommentPanelOpen(false);
    clearBoardComposer();
    setAgentToolsOpen(false);
    restoreGrapesjsEditPanelState();
    closeArtifactToolMenus();
  }

  function activateCommentTool() {
    fireArtifactToolbarClick('comment');
    capturePreviewScrollPosition();
    setGrapesjsCanvasTool('cursor');
    if (boardMode && !commentCreateMode && boardTool === 'inspect') {
      deactivateElementSelectionMode();
      return;
    }
    const activateComment = () => {
      setCommentPanelOpen(false);
      setCommentCreateMode(false);
      clearBoardComposer();
      setInspectMode(false);
      setDrawOverlayOpen(false);
      setMode('preview');
      onEditModeChange?.(false);
      onEditSelectionChange?.(false);
      activateBoard('inspect');
      closeArtifactToolMenus();
    };
    if (fallbackManualEditMode) {
      void exitManualEditModeAfterFlush().then((ok) => {
        if (ok) activateComment();
      });
      return;
    }
    activateComment();
  }

  function activateGrapesjsCursorTool() {
    setGrapesjsCanvasTool('cursor');
    setGrapesjsShapeMenuOpen(false);
    setDrawOverlayOpen(false);
    if (boardMode && !commentCreateMode && boardTool === 'inspect') {
      deactivateElementSelectionMode();
      return;
    }
    setBoardMode(false);
    setCommentCreateMode(false);
    setCommentPanelOpen(false);
    clearBoardComposer();
    restoreGrapesjsEditPanelState();
    closeArtifactToolMenus();
  }

  function activateGrapesjsCanvasTool(tool: GrapesjsCanvasTool) {
    if (tool === 'cursor') {
      activateGrapesjsCursorTool();
      return;
    }
    setGrapesjsCanvasTool(tool);
    setGrapesjsShapeMenuOpen(false);
    setBoardMode(false);
    setCommentCreateMode(false);
    setCommentPanelOpen(false);
    clearBoardComposer();
    setInspectMode(false);
    setDrawOverlayOpen(false);
    setMode('preview');
    closeArtifactToolMenus();
  }

  function activateCommentCreateTool() {
    fireArtifactToolbarClick('comment');
    capturePreviewScrollPosition();
    setGrapesjsCanvasTool('cursor');
    if (boardMode && commentCreateMode) {
      setBoardMode(false);
      setCommentCreateMode(false);
      setCommentPanelOpen(false);
      clearBoardComposer();
      restoreGrapesjsEditPanelState();
      closeArtifactToolMenus();
      return;
    }
    const activateCommentCreate = () => {
      setCommentPanelOpen(true);
      setCommentSidePanelCollapsed(false);
      setCommentCreateMode(true);
      if (!activeCommentTarget) clearBoardComposer();
      setInspectMode(false);
      setDrawOverlayOpen(false);
      setMode('preview');
      activateBoard('inspect');
      closeArtifactToolMenus();
    };
    if (fallbackManualEditMode) {
      void exitManualEditModeAfterFlush().then((ok) => {
        if (ok) activateCommentCreate();
      });
      return;
    }
    activateCommentCreate();
  }

  useEffect(() => {
    if (!useGrapesjs || mode !== 'preview' || grapesjsViewMode || source === null) return;
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      const el = target as HTMLElement;
      return Boolean(el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const primary = event.metaKey || event.ctrlKey;
      const noCommandModifier = !primary && !event.altKey;
      let tool: GrapesjsCanvasTool | null = null;
      if (primary && event.shiftKey && !event.altKey && key === 'k') {
        tool = 'image';
      } else if (noCommandModifier && key === 'v') {
        tool = 'cursor';
      } else if (noCommandModifier && key === 'r') {
        tool = 'rectangle';
      } else if (noCommandModifier && key === 'l') {
        tool = 'line';
      } else if (noCommandModifier && key === 'o') {
        tool = 'circle';
      } else if (noCommandModifier && key === 't') {
        tool = 'text';
      }
      if (tool) {
        event.preventDefault();
        event.stopPropagation();
        activateGrapesjsCanvasTool(tool);
        return;
      }
      if (noCommandModifier && key === 'c') {
        event.preventDefault();
        event.stopPropagation();
        activateCommentTool();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  useEffect(() => {
    if (!boardMode || commentCreateMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      deactivateElementSelectionMode();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [boardMode, commentCreateMode]);

  function activateManualEditTool() {
    fireArtifactToolbarClick('edit');
    capturePreviewScrollPosition();
    if (useGrapesjs) {
      setCommentPanelOpen(false);
      setCommentCreateMode(false);
      setBoardMode(false);
      clearBoardComposer();
      setInspectMode(true);
      setGrapesjsSidebarTab('inspect');
      setDrawOverlayOpen(false);
      setMode('preview');
      onEditModeChange?.(true);
      onEditSelectionChange?.(grapesjsSelectionActive);
      closeArtifactToolMenus();
      return;
    }
    if (!manualEditMode) {
      setCommentPanelOpen(false);
      setCommentCreateMode(false);
      setBoardMode(false);
      clearBoardComposer();
      setInspectMode(false);
      setDrawOverlayOpen(false);
      setMode('preview');
      setManualEditSrcDocActive(true);
      setManualEditMode(true);
      closeArtifactToolMenus();
      return;
    }
    closeArtifactToolMenus();
    void exitManualEditModeAfterFlush();
  }

  // ESC deselects the current edit-mode target without exiting edit mode.
  // The primary ESC→deselect handler lives in the edit bridge (inside the
  // iframe) so it fires even when focus is inside the iframe. This host-side
  // handler covers the case where focus returned to the parent window (e.g.
  // after interacting with a docked inspector).
  useEffect(() => {
    if (!manualEditMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedManualEditTargetId) {
        void clearManualEditTargetSelection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [manualEditMode, selectedManualEditTargetId]);

  function queueCurrentDraft() {
    const note = commentDraft.trim();
    if (!note) return;
    setQueuedBoardNotes((current) => [...current, note]);
    setCommentDraft('');
  }

  function currentActiveComposerComment(): PreviewComment | null {
    if (!activePreviewCommentId) return null;
    return previewComments.find((comment) => (
      comment.id === activePreviewCommentId &&
      comment.filePath === file.name &&
      comment.status === 'open'
    )) ?? null;
  }

  function currentActiveComposerAttachments(): PreviewCommentAttachment[] {
    return currentActiveComposerComment()?.attachments ?? activeCommentExistingAttachments;
  }

  function withDeckSlideIndex(target: PreviewCommentTarget): PreviewCommentTarget {
    if (!effectiveDeck || typeof slideState?.active !== 'number') return target;
    if (typeof target.slideIndex === 'number') return target;
    return { ...target, slideIndex: slideState.active };
  }

  async function sendBoardBatch() {
    if (!activeCommentTarget || !onSendBoardCommentAttachments) return;
    const nextNotes = [...queuedBoardNotes];
    if (commentDraft.trim()) nextNotes.push(commentDraft.trim());
    if (nextNotes.length === 0 && boardImages.length === 0) {
      const existingComment = currentActiveComposerComment();
      if (existingComment) {
        setSendingBoardBatch(true);
        try {
          await onSendBoardCommentAttachments(commentsToAttachments([existingComment]));
          clearBoardComposer();
        } finally {
          setSendingBoardBatch(false);
        }
      }
      return;
    }
    setSendingBoardBatch(true);
    try {
      const existingAttachments = currentActiveComposerAttachments();
      const attachments = buildBoardCommentAttachments({
        target: withDeckSlideIndex(targetFromSnapshot(activeCommentTarget)),
        notes: nextNotes,
        includeImageOnly: boardImages.length > 0,
        imageAttachmentCount: boardImages.length,
      }).map((attachment) => (
        existingAttachments.length > 0
          ? { ...attachment, imageAttachments: existingAttachments }
          : attachment
      ));
      const accepted = await onSendBoardCommentAttachments(
        attachments,
        boardImages,
      );
      if (accepted === false) return;
      clearBoardComposer();
    } finally {
      setSendingBoardBatch(false);
    }
  }

  async function stageActiveElementSelection() {
    if (!activeCommentTarget || !onStageBoardCommentAttachments) return;
    setSendingBoardBatch(true);
    try {
      const target = withDeckSlideIndex(targetFromSnapshot(activeCommentTarget));
      const selectionKind = target.selectionKind === 'pod' ? 'pod' : 'element';
      const attachment: ChatCommentAttachment = {
        id: `${target.elementId}-board-1`,
        order: 1,
        filePath: target.filePath,
        elementId: target.elementId,
        selector: target.selector,
        label: target.label,
        comment: commentDraft.trim(),
        currentText: target.text,
        pagePosition: target.position,
        htmlHint: target.htmlHint,
        selectionKind,
        source: 'board-batch',
        commentContext: 'context',
      };
      if (target.style) attachment.style = target.style;
      if (selectionKind === 'pod') {
        const podMembers = target.podMembers ?? [];
        attachment.memberCount =
          podMembers.length > 0
            ? podMembers.length
            : typeof target.memberCount === 'number'
              ? Math.round(target.memberCount)
              : 0;
        if (podMembers.length > 0) attachment.podMembers = podMembers;
      }
      if (typeof target.slideIndex === 'number') attachment.slideIndex = target.slideIndex;
      const accepted = await onStageBoardCommentAttachments([attachment]);
      if (accepted === false) return;
      setCommentSavedToast(t('chat.comments.attached'));
    } finally {
      setSendingBoardBatch(false);
    }
  }

  async function savePersistentComment() {
    if (!activeCommentTarget || !onSavePreviewComment) return;
    // Allow saving when there is text OR an attached image (image-only notes).
    if (!commentDraft.trim() && boardImages.length === 0 && currentActiveComposerAttachments().length === 0) return;
    setSendingBoardBatch(true);
    try {
      const target = withDeckSlideIndex(targetFromSnapshot(activeCommentTarget));
      const saved = await onSavePreviewComment(
        target,
        commentDraft.trim(),
        false,
        boardImages,
      );
      if (saved) {
        rememberSavedPreviewCommentOrder(saved.id);
        clearBoardComposer();
        setActiveCommentExistingAttachments(saved.attachments ?? []);
        setBoardMode(true);
        setCommentCreateMode(true);
        setCommentPanelOpen(true);
        setCommentSidePanelCollapsed(false);
        setActivePreviewCommentId(saved.id);
        setCommentSavedToast(t('chat.comments.savedToast'));
      }
    } finally {
      setSendingBoardBatch(false);
    }
  }

  async function savePanelComment(note: string) {
    if (!onSavePreviewComment) return false;
    const cleanNote = note.trim();
    if (!cleanNote) return false;
    const idSeed = Date.now().toString(36);
    const target: PreviewCommentTarget = activeCommentTarget
      ? targetFromSnapshot(activeCommentTarget)
      : {
          filePath: file.name,
          elementId: `file-comment-${idSeed}-${Math.floor(Math.random() * 1e6).toString(36)}`,
          selector: 'html',
          label: file.name,
          text: '',
          position: { x: 0, y: 0, width: 0, height: 0 },
          htmlHint: '',
          selectionKind: 'element',
        };
    setSendingBoardBatch(true);
    try {
      const saved = await onSavePreviewComment(target, cleanNote, false);
      if (saved) {
        rememberSavedPreviewCommentOrder(saved.id);
        setCommentSavedToast(t('chat.comments.savedToast'));
        if (activeCommentTarget) clearBoardComposer();
      }
      return Boolean(saved);
    } finally {
      setSendingBoardBatch(false);
    }
  }

  const showPresent = source !== null;
  const exportTitle = file.name.replace(/\.html?$/i, '') || file.name;
  const artifactKind = file.artifactManifest?.kind ?? file.artifactKind ?? null;
  const rendererId = file.artifactManifest?.renderer ?? null;
  const isDeckArtifact = isDeck || artifactKind === 'deck' || rendererId === 'deck-html' || file.kind === 'presentation';
  const isMarkdownArtifact =
    artifactKind === 'markdown-document' ||
    rendererId === 'markdown' ||
    file.kind === 'text' && /\.mdx?$/i.test(file.name);
  const isShareableArtifact =
    file.kind === 'html' ||
    isDeckArtifact ||
    artifactKind === 'html' ||
    rendererId === 'html';
  const canShare = source !== null && isShareableArtifact;
  const canDownload = source !== null && (isShareableArtifact || isMarkdownArtifact);
  const canPptx = canShare && isDeckArtifact && Boolean(onExportAsPptx) && !streaming;
  const showPptxExport = canShare && isDeckArtifact;
  const showMarkdownExport = source !== null && isMarkdownArtifact;
  const showImageExport = canShare;

  useEffect(() => {
    const nudgeKey = `${projectId}\n${file.name}`;
    if (!canShare || exportReadyNudgeSeenRef.current.has(nudgeKey)) return;
    exportReadyNudgeSeenRef.current.add(nudgeKey);
    if (hasSeenExportReadyNudge(projectId, file.name)) return;
    markExportReadyNudgeSeen(projectId, file.name);
    setExportReadyNudge(true);
    const timeout = window.setTimeout(() => setExportReadyNudge(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [canShare, file.name, projectId]);

  // Chat-side "Share" next-step action: when a new share request arrives, open
  // the share menu (the toolbar's "Share" button → deploy menu, which holds the
  // share-link items AND the "publish online" providers). This is the right
  // surface for "share" — publishing is the prerequisite for a shareable link,
  // and that publish step lives here; the download menu is export-to-disk, a
  // different intent. The artifact source may still be loading when the request
  // lands (the file was just auto-opened), so we defer until `canShare` flips
  // true and only consume each nonce once.
  const consumedShareNonceRef = useRef<number | null>(null);
  useEffect(() => {
    const nonce = shareRequest?.nonce;
    if (nonce == null) return;
    if (consumedShareNonceRef.current === nonce) return;
    if (!canShare) return;
    consumedShareNonceRef.current = nonce;
    setExportReadyNudge(false);
    markExportReadyNudgeSeen(projectId, file.name);
    setDownloadMenuOpen(false);
    setDeployMenuOpen(true);
  }, [shareRequest?.nonce, canShare, projectId, file.name]);

  // A queued chat send for this deck just started: flip the preview to the
  // slide its marked element lives on. We write the cached slide state first so
  // a freshly-mounted iframe (the tab may have just been activated) restores to
  // the target on load via syncCachedSlideStateToIframe(), then post directly
  // to cover the already-loaded iframe. The consume-once guard lives in
  // `shouldConsumeSlideNav` (keyed by file outside this component) so it holds
  // across remounts — switching away from and back to the deck must not replay
  // the stale request and yank the preview off wherever the user navigated.
  useEffect(() => {
    const nonce = slideNavRequest?.nonce;
    if (nonce == null) return;
    if (!effectiveDeck) return;
    const requested = slideNavRequest?.slideIndex;
    if (typeof requested !== 'number' || !Number.isFinite(requested) || requested < 0) return;
    if (!shouldConsumeSlideNav(previewStateKey, nonce)) return;
    const target = Math.floor(requested);
    const cachedCount = htmlPreviewSlideState.get(previewStateKey)?.count;
    const count = slideState?.count ?? cachedCount ?? target + 1;
    setSlideStateCached(previewStateKey, { active: target, count });
    setSlideState({ active: target, count });
    syncCachedSlideStateToIframe();
  }, [slideNavRequest?.nonce, slideNavRequest?.slideIndex, effectiveDeck, previewStateKey, slideState?.count]);

  const openDownloadMenu = () => {
    fireArtifactHeaderClick('share_dropdown');
    setExportReadyNudge(false);
    markExportReadyNudgeSeen(projectId, file.name);
    setDeployMenuOpen(false);
    setDownloadMenuOpen((v) => !v);
  };
  const openDeployMenu = () => {
    fireArtifactHeaderClick('share_dropdown');
    setExportReadyNudge(false);
    markExportReadyNudgeSeen(projectId, file.name);
    setDownloadMenuOpen(false);
    setDeployMenuOpen((v) => !v);
  };
  const captureExportImageSnapshot = useCallback(async () => {
    // Prefer the desktop compositor screenshot of the visible preview region:
    // it returns the real rendered pixels (fonts, external CSS, gradients,
    // images) and is never tainted, so it cannot produce the black/blank frames
    // the in-iframe SVG-foreignObject bridge does. Works for both srcDoc and
    // URL-load previews. Falls through to the bridge on pure web (no host).
    const visibleIframe = (
      useUrlLoadPreview ? urlPreviewIframeRef.current : srcDocPreviewIframeRef.current
    ) ?? iframeRef.current;
    const hostSnapshot = await withExportCaptureIsolation(() => captureHostIframeSnapshot(visibleIframe));
    if (hostSnapshot) return hostSnapshot;

    if (!useUrlLoadPreview) {
      const activeIframe = srcDocPreviewIframeRef.current ?? iframeRef.current;
      if (!activeIframe) return null;
      await waitForIframeLoadOrTimeout(activeIframe, 250);
      await waitForAnimationFrame();
      return requestPreviewSnapshotWithRetry(activeIframe);
    }

    const urlIframe = iframeRef.current ?? urlPreviewIframeRef.current;
    if (urlIframe) {
      await waitForIframeLoadOrTimeout(urlIframe, 250);
      await waitForAnimationFrame();
      const urlSnapshot = await requestPreviewSnapshotWithRetry(urlIframe);
      if (urlSnapshot) return urlSnapshot;
    }

    const srcDocIframe = srcDocPreviewIframeRef.current;
    if (!srcDocIframe) {
      const activeIframe = iframeRef.current;
      if (!activeIframe) return null;
      return requestPreviewSnapshotWithRetry(activeIframe);
    }

    if (useLazySrcDocTransport && !srcDocShellReady) {
      await waitForIframeLoadOrTimeout(srcDocIframe, 500);
    }
    if (useLazySrcDocTransport && activateSrcDocSnapshotTransport(srcDocIframe)) {
      await waitForIframeLoadOrTimeout(srcDocIframe);
    }
    const restoreVisibility = temporarilyExposeIframeForSnapshot(srcDocIframe);
    try {
      await waitForAnimationFrame();
      return requestPreviewSnapshotWithRetry(srcDocIframe);
    } finally {
      restoreVisibility();
    }
  }, [
    activateSrcDocSnapshotTransport,
    srcDocShellReady,
    useLazySrcDocTransport,
    useUrlLoadPreview,
  ]);
  const captureGrapesjsDrawSnapshot = useCallback(async () => {
    const previewRect = previewBodyRef.current?.getBoundingClientRect() ?? null;
    const hostSnapshot = await withExportCaptureIsolation(() => captureHostRegionSnapshot(previewRect));
    if (hostSnapshot) return hostSnapshot;

    const editor = grapesjsEditorRef.current?.getEditor();
    const frame = (() => {
      try { return editor?.Canvas.getFrameEl?.() ?? null; } catch { return null; }
    })();
    if (frame) {
      await waitForIframeLoadOrTimeout(frame, 250);
      await waitForAnimationFrame();
      const frameSnapshot = await requestPreviewSnapshotWithRetry(frame);
      if (frameSnapshot) return frameSnapshot;
    }

    return createBlankPreviewSnapshot(previewRect);
  }, []);

  const handleCopyScreenshot = useCallback(async () => {
    if (screenshotInFlightRef.current) return;
    screenshotInFlightRef.current = true;
    setExportToast({ message: t('fileViewer.screenshotCopying'), tone: 'loading' });
    try {
      const snap = await captureExportImageSnapshot();
      if (!snap) {
        setExportToast({ message: t('fileViewer.screenshotPreviewLoading'), tone: 'error' });
        return;
      }
      const result = await copyImageDataUrlToClipboard(snap.dataUrl);
      setExportToast(
        result === 'copied'
          ? { message: t('fileViewer.screenshotCopied'), tone: 'success' }
          : {
              message: t(
                result === 'denied'
                  ? 'fileViewer.screenshotClipboardDenied'
                  : 'fileViewer.screenshotCaptureFailed',
              ),
              tone: 'error',
            },
      );
    } catch (err) {
      console.warn('[handleCopyScreenshot] failed:', err);
      setExportToast({ message: t('fileViewer.screenshotCaptureFailed'), tone: 'error' });
    } finally {
      screenshotInFlightRef.current = false;
    }
  }, [captureExportImageSnapshot, t]);

  const prepareImageExportBlob = useCallback(async (format: ImageExportFormat) => {
    const prepareId = imageExportPrepareIdRef.current + 1;
    imageExportPrepareIdRef.current = prepareId;
    setImageExportPreparing(true);
    setImageExportError(null);
    setImageExportPreparedBlob(null);
    try {
      let dataUrl = imageExportSnapshotDataUrlRef.current;
      if (!dataUrl) {
        await waitForAnimationFrame();
        const snap = await captureExportImageSnapshot();
        if (!snap) throw new Error('Snapshot capture returned null');
        dataUrl = snap.dataUrl;
        imageExportSnapshotDataUrlRef.current = dataUrl;
      }
      const blob = await imageDataUrlToBlob(dataUrl, format);
      if (blob.size <= 0) throw new Error('Snapshot capture produced an empty image');
      if (imageExportPrepareIdRef.current === prepareId) {
        setImageExportPreparedBlob({ format, blob });
      }
    } catch (err) {
      console.warn('[exportAsImage] failed to prepare snapshot:', err);
      if (imageExportPrepareIdRef.current === prepareId) {
        setImageExportError(t('fileViewer.exportImageFailed'));
      }
    } finally {
      if (imageExportPrepareIdRef.current === prepareId) {
        setImageExportPreparing(false);
      }
    }
  }, [captureExportImageSnapshot, t]);

  const openImageExportModal = () => {
    setDownloadMenuOpen(false);
    setImageExportError(null);
    setImageExportPreparedBlob(null);
    imageExportSnapshotDataUrlRef.current = null;
    setImageExportModalOpen(true);
    void prepareImageExportBlob(imageExportFormat);
  };

  const changeImageExportFormat = (format: ImageExportFormat) => {
    setImageExportFormat(format);
    void prepareImageExportBlob(format);
  };

  async function handleImageExportSave() {
    const prepared = imageExportPreparedBlob;
    if (!prepared || prepared.format !== imageExportFormat) {
      setImageExportError(t('fileViewer.exportImageFailed'));
      return;
    }
    setImageExportBusy(true);
    setImageExportError(null);
    try {
      const target = await prepareImageExportTarget(exportTitle, imageExportFormat, { useNativePicker: false });
      if (!target) return;
      const preparedDataUrl = imageExportSnapshotDataUrlRef.current;
      if (target.method === 'download' && imageExportFormat === 'png' && preparedDataUrl) {
        downloadImageDataUrl(preparedDataUrl, target.filename);
      } else {
        await target.save(prepared.blob);
      }
      setImageExportModalOpen(false);
      setImageExportSavedToast({
        message: target.method === 'picker'
          ? t('fileViewer.exportImageSaved')
          : t('fileViewer.exportImageDownloadStarted'),
        details: target.method === 'picker'
          ? target.filename
          : t('fileViewer.exportImageDownloadDetails', { filename: target.filename }),
      });
    } catch (err) {
      console.warn('[exportAsImage] failed to save snapshot:', err);
      setImageExportError(t('fileViewer.exportImageFailed'));
    } finally {
      setImageExportBusy(false);
    }
  }
  const creationSortedSideComments = useMemo(
    () => previewComments
      .filter((comment) => comment.filePath === file.name && comment.status === 'open')
      .sort((a, b) => commentCreatedAt(a) - commentCreatedAt(b)),
    [file.name, previewComments],
  );
  useEffect(() => {
    const creationIds = creationSortedSideComments.map((comment) => comment.id);
    setCommentOrderIds((current) => {
      const visible = new Set(creationIds);
      const kept = current.filter((id) => visible.has(id));
      const added = creationIds.filter((id) => !kept.includes(id));
      const next = [...kept, ...added];
      return next.join('\0') === current.join('\0') ? current : next;
    });
  }, [creationSortedSideComments]);
  const visibleSideComments = useMemo(() => {
    if (commentOrderIds.length === 0) return creationSortedSideComments;
    const byId = new Map(creationSortedSideComments.map((comment) => [comment.id, comment]));
    const ordered = commentOrderIds
      .map((id) => byId.get(id))
      .filter((comment): comment is PreviewComment => Boolean(comment));
    const orderedIds = new Set(ordered.map((comment) => comment.id));
    const missing = creationSortedSideComments.filter((comment) => !orderedIds.has(comment.id));
    return [...ordered, ...missing];
  }, [creationSortedSideComments, commentOrderIds]);
  function rememberSavedPreviewCommentOrder(savedId: string) {
    setCommentOrderIds((current) =>
      appendSavedPreviewCommentOrder(current, visibleSideComments, savedId),
    );
  }
  const activeSideCommentId = activePreviewCommentId;
  const activeCommentTargetVisible = commentTargetIntersectsPreview(
    activeCommentTarget,
    activeCommentOverlayTransform.scale,
    { x: activeCommentOverlayTransform.offsetX, y: activeCommentOverlayTransform.offsetY },
    previewBodySize,
  );
  useEffect(() => {
    if (!boardMode || !activePreviewCommentId) return;
    const stillOpen = visibleSideComments.some((comment) => comment.id === activePreviewCommentId);
    if (!stillOpen) clearBoardComposer();
  }, [activePreviewCommentId, boardMode, visibleSideComments]);
  useEffect(() => {
    if (!effectiveDeck || slideState == null || !boardMode) return;
    if (!activePreviewCommentId) return;
    const activeComment = visibleSideComments.find((comment) => comment.id === activePreviewCommentId);
    if (activeComment && !commentVisibleOnDeckSlide(activeComment, slideState.active)) {
      clearBoardComposer();
    }
  }, [activePreviewCommentId, boardMode, effectiveDeck, slideState?.active, visibleSideComments]);
  const activeDeployment = deployResult || deployment;
  const activeDeployedUrl = activeDeployment?.url?.trim() || '';
  const activeDeploymentDelayed = activeDeployment?.status === 'link-delayed';
  const activeDeploymentProtected = activeDeployment?.status === 'protected';
  const activeCloudflarePages = activeDeployment?.providerId === CLOUDFLARE_PAGES_PROVIDER_ID
    ? activeDeployment.cloudflarePages
    : undefined;
  const activeCloudflareCustomDomain = activeCloudflarePages?.customDomain;
  const deployProvider = getDeployProviderOption(deployProviderId);
  const deployProviderLabel = t(deployProvider.labelKey);
  const selectedCloudflareZone = cloudflareZones.find((zone) => zone.id === cloudflareZoneId) ?? null;
  const normalizedCloudflarePrefix = normalizeCloudflareDomainPrefixInput(cloudflareDomainPrefix);
  const cloudflareHostnamePreview =
    selectedCloudflareZone && normalizedCloudflarePrefix
      ? `${normalizedCloudflarePrefix}.${selectedCloudflareZone.name}`
      : '';
  const deployResultCards: DeployResultCard[] = activeCloudflarePages
    ? (() => {
        const cards: DeployResultCard[] = [];
        const pagesDevUrl = activeCloudflarePages.pagesDev?.url || activeDeployedUrl;
        if (pagesDevUrl) {
          cards.push({
            id: 'pages-dev',
            label: t('fileViewer.cloudflarePagesDevLinkLabel'),
            url: pagesDevUrl,
            status: activeCloudflarePages.pagesDev?.status || activeDeployment?.status || 'link-delayed',
            message: activeCloudflarePages.pagesDev?.statusMessage,
          });
        }
        if (activeCloudflareCustomDomain?.url) {
          cards.push({
            id: 'custom-domain',
            label: t('fileViewer.cloudflareCustomDomainLinkLabel'),
            url: activeCloudflareCustomDomain.url,
            status: activeCloudflareCustomDomain.status,
            message:
              activeCloudflareCustomDomain.errorMessage ||
              activeCloudflareCustomDomain.statusMessage,
          });
        }
        return cards;
      })()
    : activeDeployedUrl
      ? [{
          id: 'default',
          label: activeDeploymentProtected
            ? t('fileViewer.deployLinkProtectedLabel')
            : activeDeploymentDelayed
              ? t('fileViewer.deployLinkPreparingLabel')
              : t('fileViewer.deployResultLabel'),
          url: activeDeployedUrl,
          status: activeDeployment?.status || 'ready',
          message: activeDeploymentProtected
            ? t('fileViewer.deployLinkProtected')
            : activeDeploymentDelayed
              ? t('fileViewer.deployLinkDelayed')
              : activeDeployment?.statusMessage,
        }]
      : [];
  const deployActionLabelFor = (providerId: WebDeployProviderId) => {
    const option = getDeployProviderOption(providerId);
    const label = t(option.labelKey);
    const hasActiveDeploymentForProvider = Boolean(deploymentsByProvider[providerId]?.url?.trim());
    return hasActiveDeploymentForProvider
      ? t('fileViewer.redeployToProvider', { provider: label })
      : t('fileViewer.deployToProvider', { provider: label });
  };
  const deployedEntries = DEPLOY_PROVIDER_OPTIONS
    .map((option) => deploymentsByProvider[option.id])
    .filter((item): item is WebDeploymentInfo => Boolean(item?.url?.trim()));
  const shareableDeploymentUrl =
    DEPLOY_PROVIDER_OPTIONS.map((option) => deploymentsByProvider[option.id])
      .map((item) => publicShareUrlForDeployment(item))
      .find(Boolean) ?? '';
  const socialShareBlockedDeployment =
    shareableDeploymentUrl
      ? null
      : deployedEntries.find((item) => deployResultState(item.status) === 'protected' && !publicShareUrlForDeployment(item)) ??
        deployedEntries.find((item) => !publicShareUrlForDeployment(item)) ??
        null;
  const socialShareBlockedState = socialShareBlockedDeployment
    ? deployResultState(socialShareBlockedDeployment.status)
    : null;
  const socialShareDisplayUrl =
    shareableDeploymentUrl || socialShareBlockedDeployment?.url?.trim() || activeDeployedUrl;
  const socialShareUnavailableMessage =
    socialShareBlockedState === 'protected'
      ? t('fileViewer.deployLinkProtected')
      : socialShareBlockedState === 'delayed'
        ? t('fileViewer.deployLinkDelayed')
        : t('socialShare.deployFirst');
  const projectSocialShareRequest = useMemo<SocialShareRequest | null>(() => {
    if (!socialShareDisplayUrl) return null;
    const title = t('socialShare.projectTitle', { title: exportTitle });
    const text = t('socialShare.projectText', {
      title: exportTitle,
      repo: OPEN_DESIGN_GITHUB_REPO_URL,
    });
    return {
      kind: 'project-html',
      locale,
      url: socialShareDisplayUrl,
      title,
      text,
      copyText: t('socialShare.projectCopyText', {
        title: exportTitle,
        url: socialShareDisplayUrl,
        repo: OPEN_DESIGN_GITHUB_REPO_URL,
      }),
    };
  }, [exportTitle, locale, socialShareDisplayUrl, t]);
  const projectSocialShareFallback = useMemo(
    () => (projectSocialShareRequest ? buildSocialSharePayload(projectSocialShareRequest) : null),
    [projectSocialShareRequest],
  );
  // Gate the async payload load on a stable *content* key, not the memo's
  // object identity. The request object can take a fresh identity on renders
  // where its inputs are value-equal (e.g. while deployment polling re-sets
  // state with a new map reference), and keying the effect on that identity
  // made `setProjectSocialShare` re-fire every render — an infinite render
  // loop once a deployment URL is available (#regression: ready-deploy share).
  const projectSocialShareKey = projectSocialShareRequest
    ? JSON.stringify(projectSocialShareRequest)
    : '';
  useEffect(() => {
    setProjectSocialShare(null);
    if (!projectSocialShareRequest) return;
    let cancelled = false;
    void createSocialSharePayload(projectSocialShareRequest)
      .then((payload) => {
        if (!cancelled) setProjectSocialShare(payload);
      })
      .catch(() => {
        if (!cancelled) setProjectSocialShare(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSocialShareKey]);
  const activeProjectSocialShare = projectSocialShare ?? projectSocialShareFallback;
  const socialShareMenuLabel =
    activeProjectSocialShare
      ? t('socialShare.projectSection')
      : socialShareBlockedState === 'protected'
        ? t('fileViewer.deployLinkProtectedLabel')
        : socialShareBlockedState === 'delayed'
        ? t('fileViewer.deployLinkPreparingLabel')
          : t('socialShare.deployFirst');
  const deployActionIconFor = (providerId: WebDeployProviderId) => {
    if (providerId === 'cloudflare-pages') return 'pages-line';
    return 'upload-cloud-line';
  };
  const latestShareDeployment = useMemo(
    () => pickLatestShareDeployment(deploymentsByProvider),
    [deploymentsByProvider],
  );
  const latestDeployedShareUrl = latestShareDeployment
    ? shareUrlForDeployment(latestShareDeployment)
    : '';
  const latestShareState = latestShareDeployment
    ? deployResultState(latestShareDeployment.status)
    : null;
  const sharePageUrl = useMemo(
    () => resolveShareUrl(latestDeployedShareUrl),
    [latestDeployedShareUrl],
  );
  const canCopyShareLink = !streaming && Boolean(sharePageUrl);
  const canOpenSharePage = !streaming && Boolean(sharePageUrl) && latestShareState !== 'delayed';
  const shareLinkStatusHint =
    streaming
      ? t('fileViewer.shareAfterGenerationComplete')
      : latestShareState === 'delayed'
      ? t('fileViewer.deployLinkDelayed')
      : latestShareState === 'protected'
        ? t('fileViewer.deployLinkProtected')
        : '';
  const shareUnavailableHint = streaming
    ? t('fileViewer.shareAfterGenerationComplete')
    : t('fileViewer.shareLinkRequiresDeploy');
  const copyShareLinkLabel =
    shareLinkFeedback === 'copied'
      ? t('fileViewer.copied')
      : shareLinkFeedback === 'failed'
        ? t('useEverywhere.copyFailed')
        : t('fileViewer.copyShareLink');
  const shareMenuLabel = t('fileViewer.shareLabel');
  const deployMenuLabel = t('fileViewer.deployModalTitle') || 'Deploy';
  const deployButtonLabel =
    deployPhase === 'deploying'
      ? t('fileViewer.deployingToProvider', { provider: deployProviderLabel })
      : deployPhase === 'preparing-link'
        ? t('fileViewer.preparingPublicLink')
        : deployMenuLabel;
  const copyDeployLabel = (url: string) =>
    copiedDeployLink === url.trim()
      ? t('fileViewer.copied')
      : t('fileViewer.copyDeployLink');
  const statusLabelFor = (state: ReturnType<typeof deployResultState>) => {
    if (state === 'ready') return t('fileViewer.deployLinkReady');
    if (state === 'protected') return t('fileViewer.deployLinkProtectedLabel');
    if (state === 'failed') return t('fileViewer.deployLinkFailed');
    return t('fileViewer.deployLinkPreparingLabel');
  };
  const boardAvailable = mode === 'preview' && source !== null;
  const showPreviewToolbarControls = mode === 'preview';
  const useGrapesjsCanvasZoom = useGrapesjs && mode === 'preview' && !grapesjsViewMode;
  const displayedCanvasZoom = useGrapesjsCanvasZoom ? displayedGrapesjsCanvasZoom : zoom;
  const commentPreviewLayoutClass = [
    'comment-preview-layer',
    localCommentSideDockActive ? 'comment-preview-layer-with-side-dock' : '',
    localCommentSideDockActive && commentSidePanelCollapsed ? 'comment-preview-layer-dock-collapsed' : '',
    boardSideDockStacked ? 'comment-preview-layer-side-dock-stacked' : '',
  ].filter(Boolean).join(' ');
  // Edit mode opens clean: the inspector only appears once the user pins an
  // element (click its hover affordance / a container) or opens page styles by
  // clicking the empty canvas.
  const manualEditPageCardActive =
    mode === 'preview' && manualEditMode && !selectedManualEditTarget && manualEditPageStylesOpen;
  const manualEditPanelActive =
    mode === 'preview' && manualEditMode && (!!selectedManualEditTarget || manualEditPageCardActive);
  const activeViewportSizeOverride =
    activeCustomViewportSize ?? undefined;
  const activateGrapesjsEditMode = () => {
    fireArtifactToolbarClick('preview');
    if (selectMode('preview')) setGrapesjsViewMode(false);
  };
  const activateGrapesjsInteractiveMode = () => {
    fireArtifactToolbarClick('preview');
    if (selectMode('preview')) setGrapesjsViewMode(true);
  };
  // The effective viewport dimensions shown in the PageInspector canvas
  // size inputs. Derived from the current preset unless the user has set
  // a custom size, and initialized from the preset on first entry.
  const currentViewportPreset = PREVIEW_VIEWPORT_PRESETS.find((p) => p.id === previewViewport);
  const manualEditViewportSize = activeCustomViewportSize ?? (
    currentViewportPreset?.width && currentViewportPreset.height
      ? { width: currentViewportPreset.width, height: currentViewportPreset.height }
      : { width: 1920, height: 1080 }
  );
  const manualEditPanelNode = manualEditPanelActive ? (
    <ManualEditPanel
      targets={manualEditTargets}
      selectedTarget={selectedManualEditTarget}
      selectedTargets={selectedManualEditTargets}
      draft={manualEditDraft}
      history={manualEditHistory}
      error={manualEditError}
      canUndo={manualEditHistory.length > 0}
      canRedo={manualEditUndone.length > 0}
      busy={manualEditSaving}
      pageStylesEnabled={manualEditPageStylesEnabled}
      viewportSize={manualEditViewportSize}
      onViewportSizeChange={(size) => {
        setCustomViewportSizes((current) => ({
          ...current,
          ...(size ? { [previewViewport]: size } : {}),
        }));
        if (!size) return;
        const current = sourceRef.current;
        if (current == null) return;
        const updated = writeCanvasSizeToSource(current, size, previewViewport);
        if (updated !== current) {
          manualEditSourceRoundTripRef.current = markManualEditLocalSave(
            manualEditSourceRoundTripRef.current,
            updated,
          );
          void htmlFileSaveController.saveBestEffort(updated, 'manual-edit-viewport-size');
          setSource(updated);
          sourceRef.current = updated;
        }
      }}
      onSelectTarget={(target) => {
        void selectManualEditTarget(target);
      }}
      onDraftChange={setManualEditDraft}
      onStyleChange={(id, styles, label) => {
        void handleManualEditStyleChange(id, styles, label);
      }}
      onInvalidStyle={cancelManualEditPendingStyles}
      onApplyPatch={(patch, label) => {
        void applyManualEdit(patch, label);
      }}
      onError={setManualEditError}
      onClearSelection={() => {
        void (async () => {
          await flushManualEditStyleSave();
          await clearManualEditTargetSelection();
        })();
      }}
      onExit={() => {
        void dismissManualEditPanel();
      }}
      onCancelDraft={() => {
        cancelManualEditPanel();
      }}
      onSaveDraft={() => {
        void dismissManualEditPanel();
      }}
      onUndo={() => {
        void undoManualEdit();
      }}
      onRedo={() => {
        void redoManualEdit();
      }}
      floatingClassName={undefined}
      floatingStyle={undefined}
      onFloatingPositionChange={undefined}
      onPickImage={async (pickedFile) => {
        const result = await uploadProjectFiles(projectId, [pickedFile]);
        const uploaded = result.uploaded[0];
        if (!uploaded?.path) {
          setManualEditError(result.error ?? t('manualEdit.uploadImageFailed'));
          return null;
        }
        setManualEditError(null);
        return toOwnerRelativePath(file.name, uploaded.path);
      }}
    />
  ) : null;
  const manualEditPanel = manualEditPanelNode && manualEditPortalHost
    ? createPortal(manualEditPanelNode, manualEditPortalHost)
    : editPortalId
      ? null
      : manualEditPanelNode;
  const manualEditPanelDockedInCanvas = manualEditPanelActive && !editPortalId;
  const manualEditUndoLimitNotification = manualEditUndoLimitToast ? (
    <Toast
      message={t('manualEdit.undoLimitReached')}
      ttlMs={4000}
      onDismiss={() => setManualEditUndoLimitToast(false)}
    />
  ) : null;
  const manualEditHoverAffordance = null;
  const activeComposerComment = activePreviewCommentId
    ? visibleSideComments.find((comment) => comment.id === activePreviewCommentId) ?? null
    : null;
  const activeComposerAttachments =
    activeComposerComment?.attachments ?? activeCommentExistingAttachments;
  const commentComposer = boardMode && commentCreateMode && activeCommentTarget && activeCommentTargetVisible ? (
    <BoardComposerPopover
      target={activeCommentTarget}
      existing={activeComposerComment}
      draft={commentDraft}
      notes={queuedBoardNotes}
      onDraft={setCommentDraft}
      onAddDraft={queueCurrentDraft}
      onRemoveQueuedNote={(index) =>
        setQueuedBoardNotes((current) => current.filter((_, currentIndex) => currentIndex !== index))
      }
      onClose={clearBoardComposer}
      onSaveComment={() => { fireCommentPopoverClick('save_comment'); return savePersistentComment(); }}
      onSendBatch={() => { fireCommentPopoverClick('send_to_chat'); return sendBoardBatch(); }}
      images={boardImagePreviews}
      existingImages={
        activeComposerAttachments.map((attachment) => ({
          url: projectRawUrl(projectId, attachment.path),
          name: attachment.name,
        }))
      }
      onAttachImages={addBoardImages}
      onRemoveImage={removeBoardImage}
      onPreviewImage={setBoardPreviewIndex}
      onRemoveMember={(elementId) => {
        setActiveCommentTarget((current) => {
          const { next, shouldClose } = applyPodMemberRemoval(current, elementId);
          if (shouldClose) clearBoardComposer();
          return next;
        });
        setHoveredPodMemberId((current) => (current === elementId ? null : current));
      }}
      onHoverMember={setHoveredPodMemberId}
      onDeleteComment={onRemovePreviewComment ? async (commentId) => {
        await onRemovePreviewComment(commentId);
        clearBoardComposer();
        setSelectedSideCommentIds((current) => {
          if (!current.has(commentId)) return current;
          const next = new Set(current);
          next.delete(commentId);
          return next;
        });
        setActivePreviewCommentId((current) => (current === commentId ? null : current));
      } : undefined}
      sending={sendingBoardBatch}
      queueOnSend={commentQueueOnSend}
      sendDisabled={commentSendDisabled}
      t={t}
      scale={activeCommentOverlayTransform.scale}
      offset={{ x: activeCommentOverlayTransform.offsetX, y: activeCommentOverlayTransform.offsetY }}
      bounds={previewBodySize}
      docked={false}
      commenting
    />
  ) : null;
  const showGrapesjsBottomToolbar = useGrapesjs && mode === 'preview' && source !== null && !grapesjsViewMode;
  const elementSelectionAction = shouldShowElementSelectionAction({
    boardMode,
    commentCreateMode,
    activeTarget: activeCommentTarget,
  }) && activeCommentTarget ? (
    <ElementSelectionAddButton
      target={activeCommentTarget}
      busy={sendingBoardBatch}
      disabled={!onStageBoardCommentAttachments}
      placement={showGrapesjsBottomToolbar ? 'toolbar' : 'floating'}
      onAdd={stageActiveElementSelection}
      t={t}
    />
  ) : null;
  const grapesjsShapeToolDefs: Array<{ tool: GrapesjsCanvasTool; icon: string; label: string; shortcut: string; testId: string }> = [
    { tool: 'rectangle', icon: 'square-line', label: '矩形', shortcut: 'R', testId: 'grapesjs-tool-rectangle' },
    { tool: 'line', icon: 'subtract-line', label: '直线', shortcut: 'L', testId: 'grapesjs-tool-line' },
    { tool: 'circle', icon: 'circle-line', label: '圆形', shortcut: 'O', testId: 'grapesjs-tool-circle' },
    { tool: 'image', icon: 'image-line', label: '图片', shortcut: '⇧⌘K', testId: 'grapesjs-tool-image' },
  ];
  const activeShapeTool = grapesjsShapeToolDefs.find((item) => item.tool === grapesjsCanvasTool);
  const shapeTriggerLabel = activeShapeTool ? `${activeShapeTool.label} ${activeShapeTool.shortcut}` : '形状 R';
  const activeShortcutGroup = GRAPESJS_SHORTCUT_GROUPS.find((group) => group.id === grapesjsShortcutGroup)
    ?? GRAPESJS_SHORTCUT_GROUPS.find((group) => group.id === 'arrange')
    ?? GRAPESJS_SHORTCUT_GROUPS[0];
  const visibleGrapesjsIconPageResult = visibleGrapesjsIconPage({
    library: grapesjsIconLibrary,
    query: grapesjsIconQuery,
    limit: grapesjsIconLimit,
  });
  const visibleGrapesjsIcons = visibleGrapesjsIconPageResult.items;
  const displayedGrapesjsIcons = grapesjsIconQuery.trim()
    ? [...grapesjsRemoteIcons, ...visibleGrapesjsIcons]
    : visibleGrapesjsIcons;
  const grapesjsIconPreviewColor = grapesjsIconColor.trim().toLowerCase() === GRAPESJS_DEFAULT_ICON_COLOR
    ? 'currentColor'
    : grapesjsIconColor;
  const handleGrapesjsIconGridScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    if (!visibleGrapesjsIconPageResult.hasMore) return;
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom > 96) return;
    setGrapesjsIconLimit((limit) => limit + GRAPESJS_ICON_PAGE_SIZE);
  };
  const grapesjsBottomToolbar = showGrapesjsBottomToolbar ? (
    <div
      ref={grapesjsBottomToolbarRef}
      className="grapesjs-bottom-toolbar"
      role="toolbar"
      aria-label="画布工具"
      data-testid="grapesjs-bottom-toolbar"
      onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.grapesjs-icon-library-panel')) return;
        event.preventDefault();
      }}
    >
      <div className="grapesjs-bottom-toolbar-group">
        <button
          type="button"
          className={`grapesjs-bottom-tool grapesjs-bottom-tool-primary od-tooltip${grapesjsCanvasTool === 'cursor' && !boardMode && !drawOverlayOpen ? ' active' : ''}`}
          data-testid="grapesjs-tool-cursor"
          aria-label="光标 V"
          aria-pressed={grapesjsCanvasTool === 'cursor' && !boardMode && !drawOverlayOpen}
          title="光标 V"
          data-tooltip="光标 V"
          data-tooltip-placement="top"
          onClick={activateGrapesjsCursorTool}
        >
          <RemixIcon name="cursor-line" size={16} />
        </button>
        <div className="grapesjs-bottom-menu-anchor">
          <button
            type="button"
            className={`grapesjs-bottom-tool grapesjs-bottom-tool-menu od-tooltip${activeShapeTool ? ' active' : ''}`}
            data-testid="grapesjs-tool-shapes"
            aria-label={shapeTriggerLabel}
            aria-pressed={Boolean(activeShapeTool)}
            aria-haspopup="menu"
            aria-expanded={grapesjsShapeMenuOpen}
            title={shapeTriggerLabel}
            data-tooltip={shapeTriggerLabel}
            data-tooltip-placement="top"
            onClick={() => {
              setGrapesjsShortcutHelpOpen(false);
              setGrapesjsIconLibraryOpen(false);
              setGrapesjsShapeMenuOpen((open) => !open);
            }}
          >
            <RemixIcon name={activeShapeTool?.icon ?? 'square-line'} size={16} />
            <RemixIcon name="arrow-down-s-line" size={12} className="grapesjs-bottom-tool-caret" />
          </button>
          {grapesjsShapeMenuOpen ? (
            <div className="grapesjs-shape-menu" role="menu" data-testid="grapesjs-shape-menu">
              {grapesjsShapeToolDefs.map((item) => {
                const active = grapesjsCanvasTool === item.tool;
                return (
                  <button
                    key={item.tool}
                    type="button"
                    className={`grapesjs-shape-menu-item${active ? ' active' : ''}`}
                    role="menuitem"
                    data-testid={item.testId}
                    onClick={() => activateGrapesjsCanvasTool(item.tool)}
                  >
                    <span className="grapesjs-shape-menu-check" aria-hidden>
                      {active ? <RemixIcon name="check-line" size={14} /> : null}
                    </span>
                    <RemixIcon name={item.icon} size={15} className="grapesjs-shape-menu-icon" />
                    <span className="grapesjs-shape-menu-label">{item.label}</span>
                    <span className="grapesjs-shape-menu-shortcut">{item.shortcut}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={`grapesjs-bottom-tool od-tooltip${grapesjsCanvasTool === 'text' ? ' active' : ''}`}
          data-testid="grapesjs-tool-text"
          aria-label="文本 T"
          aria-pressed={grapesjsCanvasTool === 'text'}
          title="文本 T"
          data-tooltip="文本 T"
          data-tooltip-placement="top"
          onClick={() => activateGrapesjsCanvasTool('text')}
        >
          <RemixIcon name="font-size" size={16} />
        </button>
        <div className="grapesjs-bottom-menu-anchor">
          <button
            type="button"
            className={`grapesjs-bottom-tool od-tooltip${grapesjsIconLibraryOpen ? ' active' : ''}`}
            data-testid="grapesjs-tool-icons"
            aria-label="图标库"
            aria-pressed={grapesjsIconLibraryOpen}
            aria-haspopup="dialog"
            aria-expanded={grapesjsIconLibraryOpen}
            title="图标库"
            data-tooltip="图标库"
            data-tooltip-placement="top"
            onClick={() => {
              setGrapesjsShapeMenuOpen(false);
              setGrapesjsShortcutHelpOpen(false);
              setGrapesjsIconLibraryOpen((open) => !open);
            }}
          >
            <RemixIcon name="apps-2-line" size={16} />
          </button>
          {grapesjsIconLibraryOpen ? (
            <div
              className="grapesjs-icon-library-panel"
              role="dialog"
              aria-label="图标库"
              data-testid="grapesjs-icon-library-panel"
            >
              <div className="grapesjs-icon-library-main">
                <div className="grapesjs-icon-library-search-row">
                  <label className="grapesjs-icon-library-search">
                    <RemixIcon name="search-line" size={14} />
                    <input
                      type="search"
                      aria-label="搜索图标"
                      placeholder="请输入图标关键词"
                      value={grapesjsIconQuery}
                      onChange={(event) => setGrapesjsIconQuery(event.target.value)}
                    />
                  </label>
                </div>
                {grapesjsRemoteIconsLoading ? (
                  <div className="grapesjs-icon-library-loading">正在加载远程图标...</div>
                ) : null}
                {grapesjsRemoteIconsError ? (
                  <div className="grapesjs-icon-library-error">远程图标暂时不可用，已显示本地图标</div>
                ) : null}
                <div
                  className="grapesjs-icon-library-grid"
                  role="list"
                  aria-label="图标列表"
                  onScroll={handleGrapesjsIconGridScroll}
                >
                  {displayedGrapesjsIcons.map((icon) => {
                    const libraryLabel = icon.library === 'remote'
                      ? 'Iconify'
                      : GRAPESJS_ICON_LIBRARIES.find((item) => item.id === icon.library)?.label ?? icon.library;
                    return (
                      <button
                        key={icon.id}
                        type="button"
                        className="grapesjs-icon-library-item"
                        aria-label={`添加图标 ${icon.label} ${libraryLabel}`}
                        title={`${icon.label} · ${libraryLabel}`}
                        onClick={() => {
                          grapesjsEditorRef.current?.insertIconComponent({
                            label: icon.label,
                            path: icon.path,
                            library: icon.library,
                            size: grapesjsIconSize,
                            strokeWidth: grapesjsIconStrokeWidth,
                            color: grapesjsIconColor,
                            variant: grapesjsIconVariant,
                            remoteIcon: icon.remoteIcon,
                            remoteSvgUrl: icon.remoteSvgUrl,
                          });
                          setGrapesjsIconLibraryOpen(false);
                        }}
                      >
                        <GrapesjsIconLibraryPreview
                          icon={icon}
                          size={22}
                          color={grapesjsIconPreviewColor}
                          strokeWidth={grapesjsIconStrokeWidth}
                          variant={grapesjsIconVariant}
                        />
                        <span>{icon.label}</span>
                      </button>
                    );
                  })}
                  {displayedGrapesjsIcons.length === 0 && !grapesjsRemoteIconsLoading ? (
                    <div className="grapesjs-icon-library-empty">没有找到图标</div>
                  ) : null}
                </div>
              </div>
              <div className="grapesjs-icon-library-side">
                <label className="grapesjs-icon-library-field">
                  <span>类型</span>
                  <select
                    aria-label="图标库"
                    value={grapesjsIconLibrary}
                    onChange={(event) => setGrapesjsIconLibrary(event.target.value as GrapesjsIconLibraryId | 'all')}
                  >
                    <option value="all">全部</option>
                    {GRAPESJS_ICON_LIBRARIES.map((library) => (
                      <option key={library.id} value={library.id}>{library.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grapesjs-icon-library-field">
                  <span>风格</span>
                  <select
                    aria-label="图标样式"
                    value={grapesjsIconVariant}
                    onChange={(event) => setGrapesjsIconVariant(event.target.value as GrapesjsIconVariant)}
                  >
                    <option value="linear">线性</option>
                    <option value="fill">填充</option>
                  </select>
                </label>
                <label className="grapesjs-icon-library-field">
                  <span>大小</span>
                  <select
                    aria-label="图标大小"
                    value={String(grapesjsIconSize)}
                    onChange={(event) => setGrapesjsIconSize(Number(event.target.value))}
                  >
                    {[16, 20, 24, 32, 40, 48, 64].map((size) => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </label>
                <label className="grapesjs-icon-library-field">
                  <span>粗细</span>
                  <select
                    aria-label="图标粗细"
                    value={String(grapesjsIconStrokeWidth)}
                    onChange={(event) => setGrapesjsIconStrokeWidth(Number(event.target.value))}
                  >
                    {[1, 1.5, 2, 2.5, 3].map((width) => (
                      <option key={width} value={width}>{width}px</option>
                    ))}
                  </select>
                </label>
                <label className="grapesjs-icon-library-field">
                  <span>描边颜色</span>
                  <div className="grapesjs-icon-library-color-row">
                    <input
                      type="color"
                      aria-label="图标描边颜色"
                      value={grapesjsIconColor}
                      onChange={(event) => setGrapesjsIconColor(event.target.value)}
                    />
                    <input
                      type="text"
                      aria-label="图标颜色值"
                      value={grapesjsIconColor}
                      onChange={(event) => setGrapesjsIconColor(event.target.value)}
                    />
                  </div>
                </label>
                <button
                  type="button"
                  className="grapesjs-icon-library-clear"
                  onClick={() => {
                    setGrapesjsIconLibrary('all');
                    setGrapesjsIconQuery('');
                    setGrapesjsIconVariant('linear');
                    setGrapesjsIconSize(24);
                    setGrapesjsIconStrokeWidth(2);
                    setGrapesjsIconColor(GRAPESJS_DEFAULT_ICON_COLOR);
                  }}
                >
                  清空配置
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <span className="grapesjs-bottom-toolbar-divider" aria-hidden />
      <div className="grapesjs-bottom-toolbar-group">
        <button
          type="button"
          className={`grapesjs-bottom-tool od-tooltip${boardMode && !commentCreateMode && boardTool === 'inspect' ? ' active' : ''}`}
          data-testid="grapesjs-tool-annotation"
          aria-label="标注 C"
          aria-pressed={boardMode && !commentCreateMode && boardTool === 'inspect'}
          title="标注 C"
          data-tooltip="标注 C"
          data-tooltip-placement="top"
          onClick={activateCommentTool}
        >
          <RemixIcon name="focus-3-line" size={16} />
        </button>
        <button
          type="button"
          className={`grapesjs-bottom-tool od-tooltip${drawOverlayOpen ? ' active' : ''}`}
          data-testid="grapesjs-tool-mark"
          aria-label="手绘"
          aria-pressed={drawOverlayOpen}
          title="手绘"
          data-tooltip="手绘"
          data-tooltip-placement="top"
          onClick={activateDrawTool}
        >
          <RemixIcon name="mark-pen-line" size={16} />
        </button>
        <button
          type="button"
          className={`grapesjs-bottom-tool grapesjs-bottom-tool-count od-tooltip${boardMode && commentCreateMode ? ' active' : ''}`}
          data-testid="grapesjs-tool-comments"
          aria-label={`${t('chat.tabComments')} (${visibleSideComments.length})`}
          aria-pressed={boardMode && commentCreateMode}
          title={t('chat.tabComments')}
          data-tooltip={t('chat.tabComments')}
          data-tooltip-placement="top"
          onClick={activateCommentCreateTool}
        >
          <RemixIcon name="message-3-line" size={16} />
          <span aria-hidden>{visibleSideComments.length}</span>
        </button>
      </div>
      {elementSelectionAction ? (
        <>
          <span className="grapesjs-bottom-toolbar-divider" aria-hidden />
          {elementSelectionAction}
        </>
      ) : null}
      <span className="grapesjs-bottom-toolbar-divider" aria-hidden />
      <div className="grapesjs-bottom-menu-anchor">
        <button
          type="button"
          className={`grapesjs-bottom-tool od-tooltip${grapesjsShortcutHelpOpen ? ' active' : ''}`}
          data-testid="grapesjs-shortcut-help-trigger"
          aria-label="快捷键说明"
          aria-pressed={grapesjsShortcutHelpOpen}
          aria-haspopup="dialog"
          aria-expanded={grapesjsShortcutHelpOpen}
          title="快捷键说明"
          data-tooltip="快捷键说明"
          data-tooltip-placement="top"
          onClick={() => {
            setGrapesjsShapeMenuOpen(false);
            setGrapesjsIconLibraryOpen(false);
            setGrapesjsShortcutHelpOpen((open) => !open);
          }}
        >
          <Icon name="help-circle" size={16} />
        </button>
        {grapesjsShortcutHelpOpen && activeShortcutGroup ? (
          <div
            className="grapesjs-shortcut-help-panel"
            role="dialog"
            aria-label="快捷键说明"
            data-testid="grapesjs-shortcut-help-panel"
          >
            <div className="grapesjs-shortcut-help-tabs" role="tablist" aria-label="快捷键分类">
              {GRAPESJS_SHORTCUT_GROUPS.map((group) => {
                const active = group.id === activeShortcutGroup.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`grapesjs-shortcut-help-tab${active ? ' active' : ''}`}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setGrapesjsShortcutGroup(group.id)}
                  >
                    {group.title}
                  </button>
                );
              })}
            </div>
            <div className="grapesjs-shortcut-help-grid">
              {activeShortcutGroup.items.map((item) => (
                <div className="grapesjs-shortcut-help-item" key={`${activeShortcutGroup.id}-${item.label}`}>
                  <span className="grapesjs-shortcut-help-mark" aria-hidden>
                    <RemixIcon name={item.icon} size={14} />
                  </span>
                  <span className="grapesjs-shortcut-help-label">{item.label}</span>
                  <span className="grapesjs-shortcut-help-keys">{item.shortcut}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;
  const boardPreviewImage =
    boardPreviewIndex !== null ? boardImagePreviews[boardPreviewIndex] ?? null : null;
  const boardImagePreviewModal = mode === 'preview' && boardPreviewImage
    ? createPortal(
        <div
          className="staged-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label={boardPreviewImage.file.name}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBoardPreviewIndex(null);
          }}
        >
          <div className="staged-preview-card">
            <div className="staged-preview-head">
              <span title={boardPreviewImage.file.name}>{boardPreviewImage.file.name}</span>
              <button
                type="button"
                className="icon-only od-tooltip"
                onClick={() => setBoardPreviewIndex(null)}
                aria-label={t('common.close')}
                title={t('common.close')}
                data-tooltip={t('common.close')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <img src={boardPreviewImage.url} alt={boardPreviewImage.file.name} />
          </div>
        </div>,
        document.body,
      )
    : null;
  const commentSidePanel = mode === 'preview' && commentPanelOpen ? (
    <CommentSideDock
      comments={visibleSideComments}
      projectId={projectId}
      selectedIds={selectedSideCommentIds}
      activeCommentId={activeSideCommentId}
      collapsed={commentPortalHost ? false : commentSidePanelCollapsed}
      onCollapsedChange={setCommentSidePanelCollapsed}
      onToggleSelect={(commentId) => {
        setSelectedSideCommentIds((current) => {
          const next = new Set(current);
          if (next.has(commentId)) next.delete(commentId);
          else next.add(commentId);
          return next;
        });
      }}
      onSelectAll={() => setSelectedSideCommentIds(new Set(visibleSideComments.map((comment) => comment.id)))}
      onClearSelection={() => setSelectedSideCommentIds(new Set())}
      onReorder={(orderedIds) => setCommentOrderIds(orderedIds)}
      onReply={(comment) => {
        // Reply == edit on a flat-thread model: prefill the
        // popover with the existing note so the user sees and
        // mutates the current text. Save runs through the
        // same upsert path; matching project/conv/file/element
        // updates note in place rather than creating a new row.
        const snapshot = liveSnapshotForComment(comment, liveCommentTargets) ?? {
          filePath: comment.filePath,
          elementId: comment.elementId,
          selector: comment.selector,
          label: comment.label,
          text: comment.text,
          position: comment.position,
          htmlHint: comment.htmlHint,
          style: comment.style,
          selectionKind: comment.selectionKind ?? 'element',
          memberCount: comment.memberCount,
          podMembers: comment.podMembers,
          ...(typeof comment.slideIndex === 'number' ? { slideIndex: comment.slideIndex } : {}),
        };
        setActiveCommentTarget(snapshot);
        setHoveredCommentTarget(snapshot);
        setActivePreviewCommentId(comment.id);
        setCommentDraft(comment.note);
        setQueuedBoardNotes([]);
        setActiveCommentExistingAttachments(comment.attachments ?? []);
        setBoardMode(true);
        setCommentCreateMode(true);
        setCommentPanelOpen(true);
        setCommentSidePanelCollapsed(false);
      }}
      onSendSelected={async () => {
        if (!onSendBoardCommentAttachments) return;
        const selected = visibleSideComments.filter(
          (comment) => selectedSideCommentIds.has(comment.id),
        );
        if (selected.length === 0) return;
        fireCommentPopoverClick('send_to_chat');
        const sentIds = new Set(selected.map((comment) => comment.id));
        setSendingBoardBatch(true);
        try {
          const accepted = await onSendBoardCommentAttachments(commentsToAttachments(selected));
          if (accepted !== false) {
            setSelectedSideCommentIds(new Set());
            setCommentOrderIds((current) => current.filter((id) => !sentIds.has(id)));
            setActivePreviewCommentId((current) => current && sentIds.has(current) ? null : current);
          }
        } finally {
          setSendingBoardBatch(false);
        }
      }}
      onCreateComment={savePanelComment}
      sending={sendingBoardBatch}
      queueOnSend={commentQueueOnSend}
      sendDisabled={commentSendDisabled}
      renderCreateForm={!commentPortalHost}
      t={t}
      composer={null}
    />
  ) : null;

  return (
    <div className={`viewer html-viewer${inTabPresent ? ' is-tab-present' : ''}`}>
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <button
            type="button"
            className="icon-only od-tooltip"
            onClick={reloadHtmlPreview}
            title={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip-placement="bottom"
            aria-label={`${t('fileViewer.reloadAria')} ${t('fileViewer.preview')}`}
          >
            <Icon name="reload" size={14} />
          </button>
          <div className={`viewer-tabs${useGrapesjs ? ' viewer-tabs-switch' : ''}`} role="tablist" aria-label="View mode">
            {useGrapesjs ? (
              <>
                <button
                  type="button"
                  role="tab"
                  className={`viewer-tab ${mode === 'preview' && !grapesjsViewMode ? 'active' : ''}`}
                  aria-selected={mode === 'preview' && !grapesjsViewMode}
                  onClick={activateGrapesjsEditMode}
                >
                  {htmlEditModeLabel(t('fileViewer.preview'))}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`viewer-tab ${mode === 'preview' && grapesjsViewMode ? 'active' : ''}`}
                  aria-selected={mode === 'preview' && grapesjsViewMode}
                  onClick={activateGrapesjsInteractiveMode}
                  data-testid="grapesjs-interactive-toggle"
                  title={t('fileViewer.interactiveMode')}
                >
                  {t('fileViewer.interactiveMode')}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`viewer-tab ${mode === 'source' ? 'active' : ''}`}
                  aria-selected={mode === 'source'}
                  onClick={() => {
                    fireArtifactToolbarClick('source');
                    selectMode('source');
                  }}
                >
                  {t('fileViewer.source')}{codeDirty ? <span className="viewer-tab-dirty" /> : null}
                </button>
              </>
            ) : (
              ([
                ['preview', t('fileViewer.preview')],
                ['source', t('fileViewer.source')],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className={`viewer-tab ${mode === id ? 'active' : ''}`}
                  aria-selected={mode === id}
                  onClick={() => {
                    fireArtifactToolbarClick(id);
                    selectMode(id);
                  }}
                >
                  {label}{id === 'source' && codeDirty ? <span className="viewer-tab-dirty" /> : null}
                </button>
              ))
            )}
          </div>
          {showPreviewToolbarControls ? (
            <>
              <span className="viewer-divider" aria-hidden />
              <PreviewViewportControls
                viewport={previewViewport}
                onViewport={setPreviewViewport}
                t={t}
              />
            </>
          ) : null}
          {showPreviewToolbarControls && effectiveDeck ? (
            <span
              className="deck-nav"
              role="group"
              aria-label={t('fileViewer.slideNavAria')}
            >
              <button
                type="button"
                className="icon-only od-tooltip"
                onClick={() => postSlide('prev')}
                title={t('fileViewer.previousSlide')}
                data-tooltip={t('fileViewer.previousSlide')}
                data-tooltip-placement="bottom"
                aria-label={t('fileViewer.previousSlide')}
                disabled={slideState !== null && slideState.active <= 0}
              >
                <Icon name="chevron-right" size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <span className="deck-nav-counter">
                {slideState
                  ? `${slideState.active + 1} / ${slideState.count}`
                  : '— / —'}
              </span>
              <button
                type="button"
                className="icon-only od-tooltip"
                onClick={() => postSlide('next')}
                title={t('fileViewer.nextSlide')}
                data-tooltip={t('fileViewer.nextSlide')}
                data-tooltip-placement="bottom"
                aria-label={t('fileViewer.nextSlide')}
                disabled={
                  slideState !== null &&
                  slideState.active >= slideState.count - 1
                }
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </span>
          ) : null}
        </div>
        <div className="viewer-toolbar-actions">
          {showPreviewToolbarControls ? (
            <>
              {mode === 'preview' ? (
                <button
                  type="button"
                  className="viewer-action viewer-action-icon od-tooltip"
                  data-testid="screenshot-copy-button"
                  data-tooltip={t('fileViewer.screenshot')}
                  data-tooltip-placement="bottom"
                  title={t('fileViewer.screenshot')}
                  aria-label={t('fileViewer.screenshot')}
                  onClick={handleCopyScreenshot}
                >
                  <RemixIcon name="screenshot-2-line" size={15} />
                </button>
              ) : null}
              {!showGrapesjsBottomToolbar ? (
                <>
                  <div className="artifact-tool-menu-anchor">
                    <button
                      type="button"
                      className={`viewer-action viewer-action-icon viewer-comment-toggle od-tooltip${boardMode && !commentCreateMode && boardTool === 'inspect' ? ' active' : ''}`}
                      data-testid="board-mode-toggle"
                      data-tooltip={t('fileViewer.comment')}
                      data-tooltip-placement="bottom"
                      title={t('fileViewer.comment')}
                      aria-label={t('fileViewer.comment')}
                      aria-pressed={boardMode && !commentCreateMode && boardTool === 'inspect'}
                      onClick={activateCommentTool}
                    >
                      <RemixIcon name="cursor-line" size={15} />
                    </button>
                  </div>
                  <button
                    className={`viewer-action viewer-action-icon od-tooltip${drawOverlayOpen ? ' active' : ''}`}
                    type="button"
                    data-testid="draw-overlay-toggle"
                    data-tooltip={t('fileViewer.mark')}
                    data-tooltip-placement="bottom"
                    title={t('fileViewer.mark')}
                    aria-label={t('fileViewer.mark')}
                    aria-pressed={drawOverlayOpen}
                    onClick={activateDrawTool}
                  >
                    <RemixIcon name="mark-pen-line" size={15} />
                  </button>
                  <span className="viewer-toolbar-tool-divider" aria-hidden />
                  <button
                    type="button"
                    className={`viewer-action viewer-comment-count-trigger viewer-comment-toggle od-tooltip${boardMode && commentCreateMode ? ' active' : ''}`}
                    data-testid="comment-panel-toggle"
                    data-tooltip={t('chat.tabComments')}
                    data-tooltip-placement="bottom"
                    title={t('chat.tabComments')}
                    aria-label={`${t('chat.tabComments')} (${visibleSideComments.length})`}
                    aria-pressed={boardMode && commentCreateMode}
                    onClick={activateCommentCreateTool}
                  >
                    <RemixIcon name="message-3-line" size={15} />
                    <span className="viewer-comment-count" aria-hidden>{visibleSideComments.length}</span>
                  </button>
                </>
              ) : null}
              {source !== null && mode === 'preview' ? (
                <>
                  <EditorDiagnosticsRecorderButton fileName={file.name} />
                  <div className="zoom-menu viewer-toolbar-zoom" ref={zoomMenuRef}>
                    <button
                      type="button"
                      className="viewer-action zoom-trigger od-tooltip"
                      aria-haspopup="menu"
                      aria-expanded={zoomMenuOpen}
                      title={t('fileViewer.resetZoom')}
                      data-tooltip={t('fileViewer.resetZoom')}
                      data-tooltip-placement="bottom"
                      onClick={() => {
                        fireArtifactToolbarClick('zoom_level_dropdown');
                        setZoomMenuOpen((v) => !v);
                      }}
                    >
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(displayedCanvasZoom)}%</span>
                    </button>
                    {zoomMenuOpen ? (
                      <div className="zoom-menu-popover" role="menu">
                        {[50, 75, 100, 125, 150, 200, 300, 400, 500, 750, 1000].map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={`zoom-menu-item${Math.round(displayedCanvasZoom) === level ? ' active' : ''}`}
                            role="menuitem"
                            onClick={() => {
                              if (useGrapesjsCanvasZoom) {
                                grapesjsEditorRef.current?.getEditor()?.Canvas?.setZoom?.(level);
                                setGrapesjsCanvasZoom(level);
                              } else {
                                setZoom(level);
                              }
                              setZoomMenuOpen(false);
                            }}
                          >
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{level}%</span>
                            {Math.round(displayedCanvasZoom) === level ? (
                              <Icon name="check" size={13} />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {((filePrimaryActions: ReactNode) => (
        chromeActionsHost ? createPortal(filePrimaryActions, chromeActionsHost) : filePrimaryActions
      ))(<>
          {showPresent ? (
            <>
              <button
                type="button"
                className="chrome-action chrome-action-secondary chrome-action-icon od-tooltip"
                aria-label={t('fileViewer.presentInTab')}
                data-tooltip={t('fileViewer.presentInTab')}
                data-tooltip-placement="bottom"
                title={t('fileViewer.presentInTab')}
                onClick={() => {
                  firePresentPopoverClick('in_this_tab');
                  presentInThisTab();
                }}
              >
                <RemixIcon name="fullscreen-line" size={15} />
              </button>
            </>
          ) : null}
        </>)}
      <div className="viewer-body" ref={previewBodyRef}>
        {useGrapesjs && mode === 'preview' && source !== null ? (
          <>
          <PreviewDrawOverlay
            active={drawOverlayOpen}
            onActiveChange={setDrawOverlayOpen}
            captureViewport
            captureSnapshot={captureGrapesjsDrawSnapshot}
            captureTarget={null}
            filePath={file.name}
            sendDisabled={streaming}
            sendDisabledReason={t('chat.annotationSendDisabledReason')}
          >
            <Suspense fallback={<div className="viewer-empty">{t('fileViewer.loading')}</div>}>
              {grapesjsViewMode ? (
                <div
                  className={`grapesjs-interactive-preview comment-preview-layer preview-viewport preview-viewport-${previewViewport}${drawOverlayOpen ? ' preview-draw-active' : ''}`}
                  data-testid="grapesjs-interactive-viewport"
                  style={previewViewportStyle(
                    previewViewport,
                    previewScale,
                    previewBodySize,
                    boardPreviewScaleOptions,
                    activeViewportSizeOverride,
                  )}
                >
                  <div className="comment-preview-canvas" data-testid="grapesjs-interactive-canvas">
                    <div className="comment-frame-clip">
                      <div style={previewScaleShellStyle(previewViewport, previewScale)}>
                        <iframe
                          data-testid="grapesjs-interactive-frame"
                          title={file.name}
                          className="artifact-preview-grapesjs"
                          style={{ width: '100%', height: '100%', border: 0, background: '#fff', display: 'block', overflow: 'hidden' }}
                          srcDoc={interactiveSrcDoc}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <GrapesjsEditor
                ref={grapesjsEditorRef}
                html={grapesjsLiveSource}
                baseHref={projectRawUrl(projectId, baseDirFor(file.name))}
                selectionTone={boardMode && !commentCreateMode ? 'element-selection' : 'default'}
                selectionChrome={boardMode && !commentCreateMode ? 'element-selection' : 'edit'}
                activeCanvasTool={grapesjsCanvasTool}
                onCanvasToolChange={activateGrapesjsCanvasTool}
                onCanvasCommentPin={boardMode && commentCreateMode ? handleGrapesjsCanvasCommentPin : undefined}
                onCanvasViewportChange={scheduleGrapesjsOverlaySync}
                artboardName={grapesjsArtboardName}
                onArtboardNameChange={setGrapesjsArtboardName}
                {...(boardMode && !commentCreateMode ? { onEscapeKey: deactivateElementSelectionMode } : {})}
                onChange={(next) => {
                  grapesjsSelectionStoreRef.current.invalidate();
                  const nextWithArtboardMeta = withGrapesjsArtboardNameMeta(next);
                  sourceRef.current = nextWithArtboardMeta;
                  queueGrapesjsSourceStateSync(nextWithArtboardMeta);
                  setCodeDirty(true);
                  if (useGrapesjs && mode === 'preview') {
                    htmlFileSaveController.scheduleSave(nextWithArtboardMeta, 'grapesjs-autosave-flush');
                  }
                }}
                onSave={() => {
                  syncGrapesjsDocumentToSource();
                  void handleCodeSave();
                }}
                onReload={() => void reloadHtmlPreview()}
                onSelectTargets={(ids) => {
                  grapesjsSelectionStoreRef.current.invalidate();
                  const hasSelection = ids.length > 0;
                  setGrapesjsSelectionActive(hasSelection);
                  // PR3: a normal canvas click should feel like "click →
                  // edit". Drive ProjectView's right panel immediately
                  // instead of waiting for inspect state/effects to settle.
                  if (!boardMode && !drawOverlayOpen) {
                    onEditModeChange?.(true);
                    onEditSelectionChange?.(hasSelection);
                  }

                  const shouldDriveInspect =
                    !boardMode && !drawOverlayOpen && (inspectMode || hasSelection);
                  if (hasSelection && !inspectMode && !boardMode && !drawOverlayOpen) {
                    setInspectMode(true);
                    setGrapesjsSidebarTab('inspect');
                  }
                  // PR2/PR3: inspect + comment share the same selection
                  // stream. In inspect mode we materialise an InspectTarget
                  // for the legacy snapshot tab, while StyleManager updates
                  // directly from GrapesJS's selected Component. The
                  // computed-style read is deferred (debounced) so a click
                  // doesn't block the main thread — only the structural
                  // activation above is synchronous.
                  if (shouldDriveInspect) {
                    if (!hasSelection) {
                      setActiveInspectTarget(null);
                      return;
                    }
                    const selectedId = ids[0];
                    if (!selectedId) {
                      setActiveInspectTarget(null);
                      return;
                    }
                    if (grapesjsInspectDebounceRef.current) {
                      clearTimeout(grapesjsInspectDebounceRef.current);
                    }
                    grapesjsInspectDebounceRef.current = setTimeout(() => {
                      grapesjsInspectDebounceRef.current = null;
                      const editor = grapesjsEditorRef.current?.getEditor();
                      if (!editor) return;
                      const target = grapesjsSelectionStoreRef.current.readInspectTarget(editor, selectedId);
                      if (target) {
                        setActiveInspectTarget(target);
                        setInspectError(null);
                        setInspectSavedAt(null);
                      }
                    }, 80);
                    return;
                  }
                  // PR2 comment branch: build a PreviewCommentSnapshot from
                  // the selected component (position relative to canvas
                  // iframe, scale=1 in devicePreviewMode) and feed the
                  // comment overlay.
                  if (boardMode) {
                    const editor = grapesjsEditorRef.current?.getEditor();
                    if (!editor) return;
                    if (!hasSelection) {
                      if (commentCreateMode) return;
                      setActiveCommentTarget((current) => (current ? null : current));
                      return;
                    }
                    const snapshots = ids
                      .map((id) => buildGrapesjsCommentSnapshot(editor, id, file.name))
                      .filter((snapshot): snapshot is PreviewCommentSnapshot => Boolean(snapshot));
                    if (snapshots.length === 0) return;
                    const snapshot = snapshots.length > 1
                      ? buildPodSnapshotFromSnapshots({
                          filePath: file.name,
                          snapshots,
                          idPrefix: 'selected-pod',
                        }) ?? snapshots[0]
                      : snapshots[0];
                    if (!snapshot) return;
                    const shouldOpenComposer = boardMode || commentCreateMode;
                    setActiveCommentTarget((current) => (shouldOpenComposer ? snapshot : current));
                    setHoveredCommentTarget(snapshot);
                    setLiveCommentTargets((current) => {
                      let changed = false;
                      const next = new Map(current);
                      for (const item of [...snapshots, snapshot]) {
                        const existing = next.get(item.elementId);
                        if (existing && commentSnapshotEqual(existing, item)) continue;
                        next.set(item.elementId, item);
                        changed = true;
                      }
                      return changed ? next : current;
                    });
                    if (shouldOpenComposer) {
                      setActivePreviewCommentId(null);
                      setCommentDraft('');
                      setQueuedBoardNotes([]);
                      setActiveCommentExistingAttachments([]);
                    }
                  }
                }}
                onHoverTarget={(id) => {
                  // PR2: comment overlay hover. Build a snapshot and feed the
                  // hovered target state. Coordinate translation is identical
                  // to the select branch — scale=1 under devicePreviewMode.
                  if (!boardMode || !id) {
                    if (!id) setHoveredCommentTarget((current) => (current ? null : current));
                    return;
                  }
                  const editor = grapesjsEditorRef.current?.getEditor();
                  if (!editor) return;
                  const snapshot = buildGrapesjsCommentSnapshot(editor, id, file.name, {
                    preferCurrentSelection: false,
                  });
                  if (!snapshot) return;
                  setHoveredCommentTarget((current) =>
                    current && current.elementId === snapshot.elementId && commentSnapshotEqual(current, snapshot)
                      ? current
                      : snapshot,
                  );
                  setLiveCommentTargets((current) => {
                    const existing = current.get(snapshot.elementId);
                    if (existing && commentSnapshotEqual(existing, snapshot)) return current;
                    return new Map(current).set(snapshot.elementId, snapshot);
                  });
                }}
                onStyleUpdate={() => {
                  grapesjsSelectionStoreRef.current.invalidate();
                  // When the user edits a style via the inspect panel we
                  // don't need a separate signal — the panel calls adapter
                  // helpers directly. This hook refreshes the Inspect
                  // snapshot after direct canvas manipulation (drag / inline
                  // edit). It fires on every styleUpdate + component:update,
                  // which is many times per second during a drag, so we
                  // debounce the computed-style read to a trailing call
                  // instead of recomputing on every event.
                  if (!inspectMode || !activeInspectTarget) return;
                  const elementId = activeInspectTarget.elementId;
                  if (grapesjsInspectDebounceRef.current) {
                    clearTimeout(grapesjsInspectDebounceRef.current);
                  }
                  grapesjsInspectDebounceRef.current = setTimeout(() => {
                    grapesjsInspectDebounceRef.current = null;
                    const editor = grapesjsEditorRef.current?.getEditor();
                    if (!editor) return;
                    const refreshed = grapesjsSelectionStoreRef.current.readInspectTarget(editor, elementId);
                    if (refreshed) setActiveInspectTarget(refreshed);
                  }, 120);
                }}
                onTweaksAvailable={(available) => {
                  // PR2: scanTweaksAvailability in the adapter surfaces whether
                  // the canvas document currently contains a `.tw-panel` /
                  // `.tw-hidden` node. Mirrors the iframe `od:tweaks-available`
                  // signal; we record it for the future toolbar toggle.
                  setTweaksAvailable(available);
                }}
                onSelectionChange={(info) => {
                  grapesjsSelectionStoreRef.current.invalidate();
                  setGrapesjsSelection(info);
                }}
                onImageEditRequest={() => setImageEditSignal((n) => n + 1)}
                onZoomChange={(z) => {
                  grapesjsSelectionStoreRef.current.invalidate();
                  setGrapesjsCanvasZoom(Number.isFinite(z) ? z : 100);
                }}
                onViewportSizeChange={(width, height) => {
                  // Persist only user-edited canvas dimensions into the HTML
                  // file's <meta name="od-canvas"> so they survive reloads.
                  // Preset switches are stored in the file alias layer and do
                  // not rewrite the source or dirty the editor.
                  if (!useGrapesjs || mode !== 'preview') return;
                  grapesjsSelectionStoreRef.current.invalidate();
                  setCustomViewportSizes((currentSizes) => ({
                    ...currentSizes,
                    [previewViewport]: { width, height },
                  }));
                  const current = sourceRef.current;
                  if (current == null) return;
                  const updated = writeCanvasSizeToSource(
                    current,
                    { width, height },
                    previewViewport,
                  );
                  if (updated !== current) {
                    sourceRef.current = updated;
                    queueGrapesjsSourceStateSync(updated);
                    setCodeDirty(true);
                    htmlFileSaveController.scheduleSave(updated, 'grapesjs-autosave-flush');
                  }
                }}
                initialViewport={(() => {
                  // Seed the canvas size before first paint so the editor
                  // doesn't flash the default device (~1280px) before the
                  // apply-viewport effect corrects it. Active custom size is
                  // scoped to the selected viewport; otherwise use the preset.
                  return activeViewportSize;
                })()}
                className="artifact-preview-grapesjs"
              />
              )}
            </Suspense>
          </PreviewDrawOverlay>
          {boardMode ? (
            <CommentPreviewOverlays
              comments={commentCreateMode ? visibleSideComments : []}
              liveTargets={liveCommentTargets}
              hoveredTarget={hoveredCommentTarget}
              hoveredPodMemberId={hoveredPodMemberId}
              activeTarget={activeCommentTarget}
              activeExistingCommentId={activeComposerComment?.id ?? null}
              boardTool={boardTool}
              showActivePin={commentCreateMode}
              targetTone={commentCreateMode ? 'comment' : 'element-selection'}
              scale={activeCommentOverlayTransform.scale}
              offsetX={activeCommentOverlayTransform.offsetX}
              offsetY={activeCommentOverlayTransform.offsetY}
              strokePoints={strokePoints}
              activeSlideIndex={effectiveDeck ? slideState?.active ?? null : null}
              onOpenComment={(comment, snapshot) => {
                setCommentPanelOpen(true);
                setCommentSidePanelCollapsed(false);
                setCommentCreateMode(true);
                setBoardMode(true);
                setActiveCommentTarget(snapshot);
                setHoveredCommentTarget(snapshot);
                setActivePreviewCommentId(comment.id);
                setCommentDraft(comment.note);
                setQueuedBoardNotes([]);
                setActiveCommentExistingAttachments(comment.attachments ?? []);
              }}
            />
          ) : null}
          {commentComposer}
          {commentSavedToast ? (
            <div className="comment-toast-anchor">
              <Toast
                message={commentSavedToast}
                ttlMs={2200}
                onDismiss={() => setCommentSavedToast(null)}
              />
            </div>
          ) : null}
          {grapesjsBottomToolbar}
          {showGrapesjsBottomToolbar ? null : elementSelectionAction}
          {useGrapesjs && mode === 'preview' && !grapesjsViewMode ? (() => {
            const sidebar = (
              <aside className={`grapesjs-sidebar${grapesjsInspectPortalHost ? ' grapesjs-sidebar-portal' : ''}`} data-testid="grapesjs-sidebar">
                <StylePanel editorRef={grapesjsEditorRef} selection={grapesjsSelection} imageEditSignal={imageEditSignal} />
              </aside>
            );
            if (grapesjsInspectPortalHost) {
              return createPortal(sidebar, grapesjsInspectPortalHost);
            }
            if (editPortalId) return null;
            return sidebar;
          })() : null}
          </>
        ) : source === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : (
          <>
          <div
            className={`${manualEditMode ? `manual-edit-workspace${manualEditPanelDockedInCanvas ? ' pp-dock-active' : ''}` : commentPreviewLayoutClass} preview-viewport preview-viewport-${previewViewport}${drawOverlayOpen ? ' preview-draw-active' : ''}`}
            data-testid={manualEditMode ? undefined : 'comment-preview-layout'}
            aria-hidden={mode === 'preview' ? undefined : true}
            style={{
              ...previewViewportStyle(previewViewport, previewScale, boardPreviewCanvasSize, boardPreviewScaleOptions, activeViewportSizeOverride),
              ...(manualEditMode && manualEditSpaceHeld ? { cursor: manualEditPanning ? 'grabbing' : 'grab' } : {}),
              ...(mode === 'preview' ? {} : { display: 'none' }),
            }}
            onMouseLeave={manualEditMode ? clearManualEditHover : undefined}
            onWheel={manualEditMode ? handleManualEditCanvasWheel : undefined}
            onPointerDown={manualEditMode ? handleManualEditCanvasPointerDown : undefined}
            onPointerMove={manualEditMode ? handleManualEditCanvasPointerMove : undefined}
            onPointerUp={manualEditMode ? handleManualEditCanvasPointerUp : undefined}
            onPointerCancel={manualEditMode ? handleManualEditCanvasPointerUp : undefined}
          >
            {manualEditPanel}
            {manualEditUndoLimitNotification}
            {manualEditHoverAffordance}
            <div
              className={manualEditMode ? 'manual-edit-canvas' : 'comment-preview-canvas'}
              ref={manualEditMode ? manualEditCanvasRef : undefined}
              data-testid={manualEditMode ? 'manual-edit-canvas' : 'comment-preview-canvas'}
              data-pan-active={manualEditMode && manualEditPanning ? 'true' : undefined}
              style={manualEditMode ? {
                ...(manualEditSpaceHeld ? { cursor: manualEditPanning ? 'grabbing' : 'grab' } : {}),
              } : undefined}
              onWheel={manualEditMode ? handleManualEditCanvasWheel : undefined}
              onPointerDown={manualEditMode ? handleManualEditCanvasPointerDown : undefined}
              onPointerMove={manualEditMode ? handleManualEditCanvasPointerMove : undefined}
              onPointerUp={manualEditMode ? handleManualEditCanvasPointerUp : undefined}
              onPointerCancel={manualEditMode ? handleManualEditCanvasPointerUp : undefined}
            >
              {/* Transparent overlay that blocks pointer events from reaching the
                  iframe when the user is in space+drag pan mode. Without this, the
                  edit bridge inside the iframe would also start element drag. */}
              {manualEditMode && manualEditSpaceHeld ? (
                <div
                  style={{ position: 'absolute', inset: 0, zIndex: 10 }}
                  onPointerDown={handleManualEditCanvasPointerDown}
                  onPointerMove={handleManualEditCanvasPointerMove}
                  onPointerUp={handleManualEditCanvasPointerUp}
                  onPointerCancel={handleManualEditCanvasPointerUp}
                />
              ) : null}
              <div className={manualEditMode ? 'manual-edit-frame-stage' : 'comment-frame-clip'} style={manualEditMode ? { height: '100%' } : undefined}>
                <div
                  ref={manualEditMode ? manualEditShellRef : undefined}
                  className={manualEditMode ? 'manual-edit-frame-shell' : undefined}
                  style={
                    manualEditMode
                      ? manualEditPreviewShellStyle(previewViewport, previewScale, manualEditViewportTransform, previewBodySize, activeViewportSizeOverride)
                      : previewScaleShellStyle(previewViewport, previewScale)
                  }
                >
                  <PreviewDrawOverlay
                    active={drawOverlayOpen}
                    onActiveChange={setDrawOverlayOpen}
                    captureViewport
                    captureSnapshot={captureExportImageSnapshot}
                    captureTarget={null}
                    filePath={file.name}
                    sendDisabled={streaming}
                    sendDisabledReason={t('chat.annotationSendDisabledReason')}
                  >
                    <div className="artifact-preview-transport-stack">
                      {OD_PREVIEW_KEEP_ALIVE ? (
                        <PooledIframe
                          ref={urlPreviewIframeRef}
                          cacheKey={urlPreviewKeepAliveKey}
                          data-testid={useUrlLoadPreview ? 'artifact-preview-frame' : 'artifact-preview-frame-url-load'}
                          data-od-render-mode="url-load"
                          data-od-active={useUrlLoadPreview ? 'true' : 'false'}
                          aria-hidden={useUrlLoadPreview ? undefined : true}
                          tabIndex={useUrlLoadPreview ? 0 : -1}
                          title={file.name}
                          sandbox={previewIframeSandbox()}
                          src={urlTransportSrc}
                          onLoad={() => {
                            const frame = urlPreviewIframeRef.current;
                            if (useUrlLoadPreview) iframeRef.current = frame;
                            setUrlSelectionBridgeReady(false);
                            dcViewportRestoreAtRef.current = Date.now();
                            frame?.contentWindow?.postMessage({
                              type: '__dc_set_viewport',
                              ...dcViewportRef.current,
                            }, '*');
                            frame?.contentWindow?.postMessage({ type: 'od:url-selection-bridge-probe' }, '*');
                            syncBridgeModes(frame);
                            if (useUrlLoadPreview) restorePreviewScrollPosition();
                          }}
                        />
                      ) : (
                        <iframe
                          ref={urlPreviewIframeRef}
                          data-testid={useUrlLoadPreview ? 'artifact-preview-frame' : 'artifact-preview-frame-url-load'}
                          data-od-render-mode="url-load"
                          data-od-active={useUrlLoadPreview ? 'true' : 'false'}
                          aria-hidden={useUrlLoadPreview ? undefined : true}
                          tabIndex={useUrlLoadPreview ? 0 : -1}
                          title={file.name}
                          sandbox={previewIframeSandbox()}
                          src={urlTransportSrc}
                          onLoad={() => {
                            const frame = urlPreviewIframeRef.current;
                            if (useUrlLoadPreview) iframeRef.current = frame;
                            setUrlSelectionBridgeReady(false);
                            dcViewportRestoreAtRef.current = Date.now();
                            frame?.contentWindow?.postMessage({
                              type: '__dc_set_viewport',
                              ...dcViewportRef.current,
                            }, '*');
                            frame?.contentWindow?.postMessage({ type: 'od:url-selection-bridge-probe' }, '*');
                            syncBridgeModes(frame);
                            if (useUrlLoadPreview) restorePreviewScrollPosition();
                          }}
                        />
                      )}
                      <iframe
                        key={srcDocTransportResetKey}
                        ref={srcDocPreviewIframeRef}
                        data-testid={useUrlLoadPreview ? 'artifact-preview-frame-srcdoc' : 'artifact-preview-frame'}
                        data-od-render-mode="srcdoc"
                        data-od-active={useUrlLoadPreview ? 'false' : 'true'}
                        aria-hidden={useUrlLoadPreview ? true : undefined}
                        tabIndex={useUrlLoadPreview ? -1 : 0}
                        title={file.name}
                        sandbox={previewIframeSandbox()}
                        srcDoc={srcDocTransportContent}
                        onLoad={() => {
                          const frame = srcDocPreviewIframeRef.current;
                          if (!useUrlLoadPreview) iframeRef.current = frame;
                          // Reset the activation dedupe exactly ONCE per
                          // freshly mounted iframe DOM node, never on the
                          // subsequent load events that the same node
                          // emits during normal srcDoc rendering.
                          //
                          // The iframe's load event fires twice for one
                          // successful activation: once when the lazy
                          // transport shell HTML loads, and again when
                          // our own document.open/write/close inside the
                          // shell finishes. PR #2699 reset the dedupe on
                          // every load so that switching
                          // preview -> source -> preview (which remounts
                          // this iframe as a fresh DOM node) would
                          // re-activate the new shell. But resetting on
                          // every load also re-activated on the SECOND
                          // load of a non-remounted frame, which
                          // re-triggered document.open/write/close, which
                          // re-fired the load event, ad infinitum. The
                          // dedupe ref oscillated between null and the
                          // current srcDoc thousands of times per render
                          // and each iteration restarted every CSS
                          // animation from its `from` keyframe. Designs
                          // using `animation-fill-mode: both` with
                          // `from { opacity: 0 }` stayed at opacity 0
                          // forever and the preview read as blank.
                          // That is issue #2361.
                          //
                          // Tracking the last frame we reset for lets us
                          // keep PR #2699's "remount after Source toggle"
                          // fix while breaking the loop on plain renders.
                          if (frame && srcDocFrameDedupeResetForRef.current !== frame) {
                            srcDocFrameDedupeResetForRef.current = frame;
                            activatedSrcDocTransportHtmlRef.current = null;
                          }
                          if (useLazySrcDocTransport) setSrcDocShellReady(true);
                          activateLoadedSrcDocTransport(frame);
                          dcViewportRestoreAtRef.current = Date.now();
                          frame?.contentWindow?.postMessage({
                            type: '__dc_set_viewport',
                            ...dcViewportRef.current,
                          }, '*');
                          replayInspectOverridesToIframe(frame);
                          syncBridgeModes(frame);
                          syncCachedSlideStateToIframe(frame);
                          if (!useUrlLoadPreview) restorePreviewScrollPosition();
                        }}
                      />
                    </div>
                  </PreviewDrawOverlay>
                </div>
              </div>
              {boardMode ? (
                <CommentPreviewOverlays
                  comments={commentCreateMode ? visibleSideComments : []}
                  liveTargets={liveCommentTargets}
                  hoveredTarget={hoveredCommentTarget}
                  hoveredPodMemberId={hoveredPodMemberId}
                  activeTarget={activeCommentTarget}
                  activeExistingCommentId={activeComposerComment?.id ?? null}
                  boardTool={boardTool}
                  showActivePin={commentCreateMode}
                  targetTone={commentCreateMode ? 'comment' : 'element-selection'}
                  scale={activeCommentOverlayTransform.scale}
                  offsetX={activeCommentOverlayTransform.offsetX}
                  offsetY={activeCommentOverlayTransform.offsetY}
                  strokePoints={strokePoints}
                  activeSlideIndex={effectiveDeck ? slideState?.active ?? null : null}
                  onOpenComment={(comment, snapshot) => {
                    setCommentPanelOpen(true);
                    setCommentSidePanelCollapsed(false);
                    setCommentCreateMode(true);
                    setBoardMode(true);
                    setActiveCommentTarget(snapshot);
                    setHoveredCommentTarget(snapshot);
                    setActivePreviewCommentId(comment.id);
                    setCommentDraft(comment.note);
                    setQueuedBoardNotes([]);
                    setActiveCommentExistingAttachments(comment.attachments ?? []);
                  }}
                />
              ) : null}
              {/* Portaled to <body> so the screenshot/export toast escapes the
                  preview pane's transform + overflow:hidden. */}
              {mode === 'preview' && exportToast
                ? createPortal(
                    <Toast
                      message={exportToast.message}
                      tone={exportToast.tone}
                      role={exportToast.tone === 'error' ? 'alert' : 'status'}
                      ttlMs={exportToast.tone === 'loading' ? 8000 : 2200}
                      placement="top"
                      onDismiss={() => setExportToast(null)}
                    />,
                    document.body,
                  )
                : null}
              {commentSavedToast ? (
                <div className="comment-toast-anchor">
                  <Toast
                    message={commentSavedToast}
                    ttlMs={2200}
                    onDismiss={() => setCommentSavedToast(null)}
                  />
                </div>
              ) : null}
              {templateSavedToast ? (
                <div className="comment-toast-anchor">
                  <Toast
                    message={templateSavedToast}
                    ttlMs={2200}
                    onDismiss={() => setTemplateSavedToast(null)}
                  />
                </div>
              ) : null}
              {commentComposer}
              {elementSelectionAction}
              {boardMode && !commentCreateMode && hoveredCommentTarget && (!activeCommentTarget || commentPortalHost) ? (
                <AnnotationHoverPopover
                  target={hoveredCommentTarget}
                  scale={overlayPreviewScale}
                  onMouseEnter={() => {
                    hoverCardPinnedRef.current = true;
                    cancelHoverCardDismiss();
                  }}
                  onMouseLeave={() => {
                    hoverCardPinnedRef.current = false;
                    scheduleHoverCardDismiss();
                  }}
                />
              ) : null}
              {/*
                Hint banner for Inspect / Picker modes. The bridge in
                `apps/web/src/runtime/srcdoc.ts` posts `od:comment-targets`
                with every element annotated with `data-od-id` /
                `data-screen-label`, so `liveCommentTargets.size` is the
                authoritative annotation count for the current artifact.

                Two states:
                - "has targets": the existing copy ("Click any element with
                  `data-od-id` to tune its style.") for users who just don't
                  see the crosshair cursor.
                - "no targets" (issue #890): a freeform-generated artifact
                  (e.g. PRD → HTML through a Claude-Code-compatible CLI
                  without a skill) ships zero `data-od-id` annotations. The
                  bridge's click handler walks up to <html>, finds nothing,
                  and bails — clicks no-op silently. The static copy made
                  this look broken; the empty-state copy explains what's
                  missing and how to fix it. Mirrored across Inspect and
                  element-pick annotation mode because the failure surface is identical.
              */}
              {inspectMode
                && openHintBox
                && !activeInspectTarget
                && !activeCommentTarget ? (
                <div
                  className="inspect-empty-hint-container"
                  data-testid="inspect-empty-hint-container"
                >
                  {liveCommentTargets.size === 0 ? (
                    <div
                      className="inspect-empty-hint"
                      data-testid="inspect-empty-hint-no-targets"
                    >
                      {inspectMode
                        ? t('chat.inspect.noEditableTargets')
                        : t('chat.inspect.noCommentTargets')}
                    </div>
                  ) : (
                    <div
                      className="inspect-empty-hint"
                      data-testid="inspect-empty-hint"
                    >
                      {inspectMode ? t('chat.inspect.editHint') : t('chat.inspect.commentHint')}
                    </div>
                  )}
                  <button
                    type="button"
                    title="Close Inspect Hint"
                    aria-label="Close Inspect Hint"
                    onClick={() => setOpenHintBox(false)}
                    className="orbit-artifact-ghost"
                  >
                    <Icon className="" name="close" size={12} />
                  </button>
                </div>
              ) : null}
            </div>
            {boardImagePreviewModal}
            {commentPortalHost && commentSidePanel
              ? createPortal(commentSidePanel, commentPortalHost)
              : commentPortalId
                ? null
                : commentSidePanel}
            {inspectMode && activeInspectTarget ? (
              <InspectPanel
                target={activeInspectTarget}
                onApply={(prop, value) => {
                  const target = activeInspectTarget;
                  setInspectOverrides((current) =>
                    updateInspectOverride(current, target.elementId, target.selector, prop, value),
                  );
                  if (useGrapesjs) {
                    // PR2: skip the iframe postMessage hop and write the
                    // override straight onto the live GrapesJS Component.
                    const editor = grapesjsEditorRef.current?.getEditor();
                    if (editor) {
                      const camelKey = prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
                      applyPreviewStyle(editor, target.elementId, { [camelKey]: value } as Partial<Record<string, string>>);
                    }
                  } else {
                    postInspectSet(target.elementId, target.selector, prop, value);
                  }
                }}
                onResetElement={(elementId) => {
                  setInspectOverrides((current) => {
                    if (!(elementId in current)) return current;
                    const next = { ...current };
                    delete next[elementId];
                    return next;
                  });
                  if (useGrapesjs) {
                    // Best-effort: there is no per-prop reset without
                    // tracking the original values; we leave the
                    // Component alone and let the user re-apply.
                  } else {
                    postInspectReset(elementId);
                  }
                  setActiveInspectTarget((current) => current && current.elementId === elementId
                    ? current
                    : current);
                }}
                onSaveToSource={() => {
                  void saveInspectToSource();
                }}
                onClose={() => {
                  setActiveInspectTarget(null);
                  if (boardMode && boardTool === 'inspect') {
                    setActiveCommentTarget(null);
                    setHoveredCommentTarget(null);
                  }
                }}
                saving={savingInspect}
                savedAt={inspectSavedAt}
                error={inspectError}
              />
            ) : null}
          </div>
          {mode === 'source' ? (
            <EditableCodeViewer text={source} onChange={setSource} onSave={handleCodeSave} onDirtyChange={setCodeDirty} />
          ) : null}
          </>
        )}
      </div>
      {inTabPresent && source && typeof document !== 'undefined' ? createPortal(
        <div
          className="present-overlay"
          role="dialog"
          aria-label={t('fileViewer.present')}
        >
          {useUrlLoadPreview ? (
            <iframe
              title="present"
              sandbox={previewIframeSandbox()}
              data-od-render-mode="url-load"
              src={activePreviewSrcUrl}
            />
          ) : (
            <iframe
              title="present"
              sandbox={previewIframeSandbox()}
              data-od-render-mode="srcdoc"
              srcDoc={srcDoc}
            />
          )}
        </div>,
        document.body,
      ) : null}
      {imageExportModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal deploy-modal image-export-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={imageExportTitleId}
          >
            <div className="modal-head">
              <div className="kicker">IMAGE</div>
              <h2 id={imageExportTitleId}>{t('fileViewer.exportImage')}</h2>
              <p className="subtitle">{t('fileViewer.exportImageModalSubtitle')}</p>
            </div>
            <div className="deploy-form image-export-form">
              <fieldset className="image-export-format-field" disabled={imageExportBusy}>
                <legend>{t('fileViewer.exportImageFormatLabel')}</legend>
                <div className="image-export-format-options">
                  {IMAGE_EXPORT_FORMAT_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`image-export-format-option${imageExportFormat === option.value ? ' active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="image-export-format"
                        value={option.value}
                        aria-label={option.label}
                        checked={imageExportFormat === option.value}
                        onChange={() => changeImageExportFormat(option.value)}
                      />
                      <span className="image-export-format-text">
                        <strong>{option.label}</strong>
                        <span aria-hidden="true">{option.extension}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {imageExportError ? (
                <p className="deploy-error" role="alert">{imageExportError}</p>
              ) : null}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="ghost-link button-like"
                disabled={imageExportBusy}
                onClick={() => {
                  setImageExportModalOpen(false);
                  setImageExportError(null);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="viewer-action primary"
                disabled={imageExportBusy || imageExportPreparing || !imageExportPreparedBlob}
                onClick={() => {
                  void handleImageExportSave();
                }}
              >
                {imageExportBusy ? t('fileViewer.exportImageSaving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {templateModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal deploy-modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div className="kicker">TEMPLATE</div>
              <h2>{t('fileViewer.saveAsTemplate')}</h2>
              <p className="subtitle">{t('fileViewer.templateDescPrompt')}</p>
            </div>
            <div className="deploy-form">
              <label className="field" htmlFor={templateNameId}>
                <span className="field-label">{t('fileViewer.templateNamePrompt')}</span>
                <input
                  id={templateNameId}
                  type="text"
                  value={templateName}
                  placeholder={t('fileViewer.templateNameDefault')}
                  autoFocus
                  onChange={(e) => setTemplateName(e.target.value)}
                />
              </label>
              <label className="field" htmlFor={templateDescriptionId}>
                <span className="field-label">{t('fileViewer.templateDescPrompt')}</span>
                <textarea
                  id={templateDescriptionId}
                  rows={3}
                  value={templateDescription}
                  placeholder={t('fileViewer.optional')}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                />
              </label>
              {templateSaveError ? <p className="deploy-error">{templateSaveError}</p> : null}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="ghost-link button-like"
                disabled={savingTemplate}
                onClick={() => {
                  setTemplateModalOpen(false);
                  setTemplateSaveError(null);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="viewer-action primary"
                disabled={savingTemplate || !templateName.trim()}
                onClick={() => {
                  void handleSaveAsTemplate();
                }}
              >
                {savingTemplate ? t('fileViewer.savingTemplate') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deployModalOpen ? (
        <div
          className="modal-backdrop deploy-flow-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDeployModal();
          }}
        >
          <div className="modal deploy-modal deploy-flow-modal" role="dialog" aria-modal="true">
            <div className="deploy-flow-modal__scroll">
              <div className="modal-head">
                <div className="kicker">{deployProviderLabel}</div>
                <h2>{t('fileViewer.deployToProvider', { provider: deployProviderLabel })}</h2>
                <p className="subtitle">{t('fileViewer.deployModalSubtitle')}</p>
              </div>
              <div className="deploy-form">
                <div className={`deploy-social-share${activeProjectSocialShare ? '' : ' is-locked'}${socialShareBlockedState ? ` is-${socialShareBlockedState}` : ''}`}>
                  <div className="deploy-social-share__head">
                    <div className="deploy-social-share__label">
                      {t('socialShare.projectSection')}
                    </div>
                    {socialShareDisplayUrl ? (
                      <a
                        className="deploy-social-share__url"
                        href={socialShareDisplayUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {socialShareDisplayUrl}
                      </a>
                    ) : null}
                  </div>
                  {!activeProjectSocialShare || socialShareBlockedState ? (
                    <p className="hint">{socialShareUnavailableMessage}</p>
                  ) : null}
                  {activeProjectSocialShare ? (
                    <SocialShareGrid
                      share={activeProjectSocialShare}
                      onAfterShare={closeDeployModal}
                    />
                  ) : null}
                  {socialShareBlockedDeployment?.url ? (
                    <div className="deploy-social-share__actions">
                      <button
                        type="button"
                        className="viewer-action"
                        onClick={() => {
                          void copyDeployLink(socialShareBlockedDeployment.url);
                        }}
                      >
                        <Icon name="copy" size={14} />
                        <span>{copyDeployLabel(socialShareBlockedDeployment.url)}</span>
                      </button>
                      {activeDeployment?.id === socialShareBlockedDeployment.id ? (
                        <button
                          type="button"
                          className="viewer-action"
                          disabled={deployPhase === 'preparing-link'}
                          onClick={() => {
                            void retryDeploymentLink();
                          }}
                        >
                          {deployPhase === 'preparing-link'
                            ? t('fileViewer.preparingPublicLink')
                            : t('fileViewer.retryLink')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              <label className="deploy-provider-field">
                <span className="deploy-field-title">{t('fileViewer.deployProviderLabel')}</span>
                <select
                  value={deployProviderId}
                  onChange={(e) => {
                    void changeDeployProvider(e.target.value as WebDeployProviderId);
                  }}
                >
                  {DEPLOY_PROVIDER_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-label-row deploy-token-label-row">
                <label htmlFor="deploy-token" className="deploy-field-title required">{t(deployProvider.tokenLabelKey)}</label>
                <a
                  href={deployProvider.tokenLink}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t(deployProvider.tokenLinkKey)}
                </a>
              </div>
              <div className="deploy-token-input-row">
                <input
                  ref={deployTokenInputRef}
                  id="deploy-token"
                  type="password"
                  value={deployToken}
                  placeholder={t(deployProvider.tokenPlaceholderKey, { provider: deployProviderLabel })}
                  onChange={(e) => setDeployToken(e.target.value)}
                />
                <button
                  type="button"
                  className="ghost-link button-like"
                  disabled={savingDeployConfig}
                  onClick={() => {
                    void saveDeployConfig();
                  }}
                >
                  {savingDeployConfig ? t('fileViewer.savingConfig') : t('fileViewer.save')}
                </button>
              </div>
              {deployConfig?.configured || deployProviderId === CLOUDFLARE_PAGES_PROVIDER_ID ? (
                <div className="deploy-token-hints">
                  {deployConfig?.configured ? (
                    <p className="hint">{t(deployProvider.tokenReuseHintKey, { provider: deployProviderLabel })}</p>
                  ) : null}
                  {deployProviderId === CLOUDFLARE_PAGES_PROVIDER_ID ? (
                    <p className="hint">{t('fileViewer.cloudflareApiTokenScopeHint')}</p>
                  ) : null}
                </div>
              ) : null}
              {deployProviderId === CLOUDFLARE_PAGES_PROVIDER_ID ? (
                <>
                  <div className="deploy-field-grid single-field">
                    <label>
                      <span className="deploy-field-title required">{t('fileViewer.cloudflareAccountId')}</span>
                      <input
                        value={cloudflareAccountId}
                        onChange={(e) => setCloudflareAccountId(e.target.value)}
                      />
                      <span className="field-hint">{t('fileViewer.cloudflareAccountIdHint')}</span>
                    </label>
                  </div>
                  <div className="deploy-field-grid cloudflare-domain-grid">
                    <label>
                      <span className="deploy-field-title">{t('fileViewer.cloudflareDomainPrefixLabel')}</span>
                      <input
                        value={cloudflareDomainPrefix}
                        placeholder={t('fileViewer.cloudflareDomainPrefixPlaceholder')}
                        onChange={(e) => setCloudflareDomainPrefix(e.target.value)}
                      />
                    </label>
                    <div className="deploy-field-control">
                      <span className="deploy-field-title-row">
                        <label className="deploy-field-title" htmlFor="cloudflare-zone-select">
                          {t('fileViewer.cloudflareZoneLabel')}
                        </label>
                        <button
                          type="button"
                          className="ghost-link deploy-field-inline-action"
                          disabled={cloudflareZonesLoading || !deployConfig?.configured}
                          onClick={() => {
                            void loadCloudflareZones();
                          }}
                        >
                          <RemixIcon name="refresh-line" size={13} />
                          {cloudflareZonesLoading ? t('fileViewer.cloudflareZonesLoading') : t('fileViewer.cloudflareZonesRefresh')}
                        </button>
                      </span>
                      <select
                        id="cloudflare-zone-select"
                        value={cloudflareZoneId}
                        disabled={cloudflareZonesLoading || (!deployConfig?.configured && !cloudflareZones.length)}
                        onChange={(e) => setCloudflareZoneId(e.target.value)}
                      >
                        {cloudflareZones.length === 0 ? (
                          <option value="">{t('fileViewer.cloudflareZonePlaceholder')}</option>
                        ) : null}
                        {cloudflareZones.map((zone) => (
                          <option key={zone.id} value={zone.id}>
                            {zone.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {cloudflareZonesError ? (
                    <p className="deploy-error">{cloudflareZonesError}</p>
                  ) : cloudflareZonesLoading ? (
                    <p className="hint">{t('fileViewer.cloudflareZonesLoading')}</p>
                  ) : deployConfig?.configured && cloudflareZones.length === 0 ? (
                    <p className="hint">{t('fileViewer.cloudflareZonesEmpty')}</p>
                  ) : null}
                  {cloudflareDomainPrefix.trim() && !isValidCloudflareDomainPrefixInput(cloudflareDomainPrefix) ? (
                    <p className="deploy-error">{t('fileViewer.cloudflareDomainPrefixInvalid')}</p>
                  ) : cloudflareHostnamePreview ? (
                    <p className="hint">
                      {t('fileViewer.cloudflareHostnamePreview', { hostname: cloudflareHostnamePreview })}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="deploy-field-grid">
                  <label>
                    <span className="deploy-field-title">{t('fileViewer.vercelTeamId')}</span>
                    <input
                      value={teamId}
                      placeholder={t('fileViewer.optional')}
                      onChange={(e) => setTeamId(e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="deploy-field-title">{t('fileViewer.vercelTeamSlug')}</span>
                    <input
                      value={teamSlug}
                      placeholder={t('fileViewer.optional')}
                      onChange={(e) => setTeamSlug(e.target.value)}
                    />
                  </label>
                </div>
              )}
              {deployError ? <p className="deploy-error">{deployError}</p> : null}
              {!deployError
                && deployPhase === 'idle'
                && deployResultCards.length > 0
                && deployResultState(activeDeployment?.status) === 'ready' ? (
                <p className="hint" role="status">
                  {t('fileViewer.deployLinkReady')} · {t('fileViewer.deployResultLabel')}
                </p>
              ) : null}
              {deployResultCards.length > 0 ? (
                <div className={`deploy-result-block ${deployResultState(activeDeployment?.status)}`}>
                  <div className="deploy-result-summary">
                    <div className="deploy-result-summary-head">
                      <div className="deploy-result-label">{t('fileViewer.deployResultLabel')}</div>
                      <div className={`deploy-result-badge ${deployResultState(activeDeployment?.status)}`}>
                        {statusLabelFor(deployResultState(activeDeployment?.status))}
                      </div>
                    </div>
                    {activeDeployment?.statusMessage ? (
                      <p className="deploy-result-message">{activeDeployment.statusMessage}</p>
                    ) : null}
                    <div className="deploy-result-links">
                      {deployResultCards.map((card) => {
                        const state = deployResultState(card.status);
                        const canRetry = state === 'delayed' || state === 'protected';
                        const isDisabled = state === 'protected' || state === 'failed';
                        return (
                          <div key={card.id} className={`deploy-result-link ${state}`}>
                            <div className="deploy-result-link-main">
                              <div className="deploy-result-link-head">
                                <span className="deploy-result-link-label">{card.label}</span>
                                <span className={`deploy-result-link-state ${state}`}>{statusLabelFor(state)}</span>
                              </div>
                              {card.message ? (
                                <p className="deploy-result-link-message">{card.message}</p>
                              ) : null}
                              <a
                                className="deploy-result-url"
                                href={card.url}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {card.url}
                              </a>
                            </div>
                            <div className="deploy-result-actions">
                              {canRetry ? (
                                <button
                                  type="button"
                                  className="viewer-action"
                                  disabled={deployPhase === 'preparing-link'}
                                  onClick={() => {
                                    void retryDeploymentLink();
                                  }}
                                >
                                  {deployPhase === 'preparing-link'
                                    ? t('fileViewer.preparingPublicLink')
                                    : t('fileViewer.retryLink')}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="viewer-action"
                                onClick={() => {
                                  void copyDeployLink(card.url);
                                }}
                              >
                                <Icon name="copy" size={14} />
                                <span>{copyDeployLabel(card.url)}</span>
                              </button>
                              <a
                                className={`ghost-link ${isDisabled ? 'disabled' : ''}`}
                                href={isDisabled ? undefined : card.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                aria-disabled={isDisabled}
                              >
                                <Icon name="upload" size={14} />
                                {t('fileViewer.open')}
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
              </div>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="ghost-link button-like"
                onClick={closeDeployModal}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="viewer-action primary"
                disabled={deploying || savingDeployConfig || deployPhase !== 'idle'}
                onClick={() => {
                  void deployToSelectedProvider();
                }}
              >
                {deployButtonLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deploySavedToast ? (
        <Toast
          message={deploySavedToast.message}
          details={deploySavedToast.details}
          tone="success"
          placement="top"
          ttlMs={3600}
          onDismiss={() => setDeploySavedToast(null)}
        />
      ) : null}
      {deployActionToast && typeof document !== 'undefined' ? createPortal(
        <Toast
          message={deployActionToast}
          placement="top"
          ttlMs={2400}
          role="alert"
          onDismiss={() => setDeployActionToast(null)}
        />,
        document.body,
      ) : null}
      {imageExportSavedToast ? (
        <Toast
          message={imageExportSavedToast.message}
          details={imageExportSavedToast.details}
          tone="success"
          placement="top"
          ttlMs={3600}
          onDismiss={() => setImageExportSavedToast(null)}
        />
      ) : null}
      {shareGuideToast && typeof document !== 'undefined' ? createPortal(
        <Toast
          message={shareGuideToast}
          placement="top"
          ttlMs={2200}
          onDismiss={() => setShareGuideToast(null)}
        />,
        document.body,
      ) : null}
    </div>
  );
}

function baseDirFor(fileName: string): string {
  const idx = fileName.lastIndexOf('/');
  return idx >= 0 ? fileName.slice(0, idx + 1) : '';
}

function defaultGrapesjsArtboardName(fileName: string): string {
  const leaf = fileName.split('/').pop()?.trim() || fileName.trim();
  return leaf.replace(/\.html?$/i, '') || leaf || '画板1';
}

function toOwnerRelativePath(ownerFileName: string, targetPath: string): string {
  const normalize = (value: string) => decodeURIComponent(value).replace(/^\/+/, '');
  const squash = (parts: string[]) => {
    const out: string[] = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (out.length > 0) out.pop();
        continue;
      }
      out.push(part);
    }
    return out;
  };
  const ownerDirPath = normalize(baseDirFor(ownerFileName));
  const targetFilePath = normalize(targetPath);
  const ownerParts = squash(ownerDirPath.split('/'));
  const targetParts = squash(targetFilePath.split('/'));

  let common = 0;
  while (
    common < ownerParts.length &&
    common < targetParts.length &&
    ownerParts[common] === targetParts[common]
  ) {
    common += 1;
  }

  const up = new Array(ownerParts.length - common).fill('..');
  const down = targetParts.slice(common);
  const rel = [...up, ...down].join('/');
  return rel || '.';
}

function hasRelativeAssetRefs(html: string): boolean {
  const attr = /\s(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(html)) !== null) {
    const value = match[1]?.trim();
    if (!value) continue;
    if (/^(?:https?:|data:|blob:|mailto:|tel:|#|\/)/i.test(value)) continue;
    return true;
  }
  return false;
}

async function inlineRelativeAssets(
  html: string,
  projectId: string,
  fileName: string,
): Promise<string> {
  const replacements: Array<Promise<{ from: string; to: string } | null>> = [];
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of links) {
    const rel = readHtmlAttr(tag, 'rel');
    const href = readHtmlAttr(tag, 'href');
    if (!rel || !/\bstylesheet\b/i.test(rel) || !href) continue;
    replacements.push(
      fetchProjectRelativeText(projectId, fileName, href).then((css) =>
        css == null
          ? null
          : {
              from: tag,
              to:
                `<style data-od-inline-asset="${escapeHtmlAttr(href)}">\n` +
                `${css.replace(/<\/style/gi, '<\\/style')}\n</style>`,
            },
      ),
    );
  }

  const scripts = html.match(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi) ?? [];
  for (const tag of scripts) {
    const src = readHtmlAttr(tag, 'src');
    if (!src) continue;
    replacements.push(
      fetchProjectRelativeText(projectId, fileName, src).then((js) => {
        if (js == null) return null;
        const open = tag.match(/^<script\b[^>]*>/i)?.[0] ?? '<script>';
        const attrs = open
          .replace(/^<script/i, '')
          .replace(/>$/i, '')
          .replace(/\ssrc\s*=\s*(['"])[\s\S]*?\1/i, '');
        return {
          from: tag,
          to: `<script${attrs}>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`,
        };
      }),
    );
  }

  const resolved = (await Promise.all(replacements)).filter(
    (item): item is { from: string; to: string } => item !== null,
  );
  return resolved.reduce((next, { from, to }) => next.replace(from, () => to), html);
}

async function fetchProjectRelativeText(
  projectId: string,
  ownerFileName: string,
  assetRef: string,
): Promise<string | null> {
  const filePath = resolveProjectRelativePath(ownerFileName, assetRef);
  if (!filePath) return null;
  try {
    const resp = await fetch(projectRawUrl(projectId, filePath));
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function resolveProjectRelativePath(ownerFileName: string, assetRef: string): string | null {
  if (/^(?:https?:|data:|blob:|mailto:|tel:|#|\/)/i.test(assetRef)) return null;
  try {
    const url = new URL(assetRef, `https://od.local/${baseDirFor(ownerFileName)}`);
    if (url.origin !== 'https://od.local') return null;
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

function readHtmlAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ImageViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const url = `${projectFileUrl(projectId, file.name)}?v=${Math.round(file.mtime)}`;
  return (
    <div className="viewer image-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {file.kind === 'sketch'
              ? t('fileViewer.sketchMeta', { size: humanSize(file.size) })
              : t('fileViewer.imageMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            download={file.name}
          >
            {t('fileViewer.download')}
          </a>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('fileViewer.open')}
          </a>
        </div>
      </div>
      <div className="viewer-body image-body">
        <img alt={file.name} src={url} />
      </div>
    </div>
  );
}

function SketchViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  return (
    <div className="viewer image-viewer sketch-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.sketchMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body image-body">
        <SketchPreview projectId={projectId} file={file} className="viewer-sketch-preview" />
      </div>
    </div>
  );
}

function VideoViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const url = `${projectFileUrl(projectId, file.name)}?v=${Math.round(file.mtime)}`;
  return (
    <div className="viewer video-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.videoMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body video-body">
        <video src={url} controls playsInline preload="metadata" />
      </div>
    </div>
  );
}

function AudioViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const url = `${projectFileUrl(projectId, file.name)}?v=${Math.round(file.mtime)}`;
  return (
    <div className="viewer audio-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.audioMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body audio-body">
        <div className="audio-card">
          <Icon name="mic" size={28} />
          <div className="audio-card-name">{file.name}</div>
          <audio src={url} controls preload="metadata" />
        </div>
      </div>
    </div>
  );
}

type SvgViewerMode = 'preview' | 'source';

interface SvgViewerProps {
  projectId: string;
  file: ProjectFile;
  initialMode?: SvgViewerMode;
  initialSource?: string | null | undefined;
}

export function SvgViewer({
  projectId,
  file,
  initialMode = 'preview',
  initialSource,
}: SvgViewerProps) {
  const t = useT();
  const [mode, setMode] = useState<SvgViewerMode>(initialMode);
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const url = `${projectFileUrl(projectId, file.name)}?v=${Math.round(file.mtime)}&r=${reloadKey}`;

  useEffect(() => {
    if (mode !== 'source') return;
    if (initialSource !== undefined && reloadKey === 0) return;
    let cancelled = false;
    setLoadingSource(true);
    setSourceError(false);
    void fetchProjectFileText(projectId, file.name, {
      cache: 'no-store',
      cacheBustKey: `${Math.round(file.mtime)}-${reloadKey}`,
    }).then((next) => {
      if (cancelled) return;
      if (next === null) {
        setSource('');
        setSourceError(true);
      } else {
        setSource(next);
      }
      setLoadingSource(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, initialSource, mode, reloadKey]);

  return (
    <div className="viewer svg-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.imageMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <div className="viewer-tabs">
            <button
              type="button"
              className={`viewer-tab ${mode === 'preview' ? 'active' : ''}`}
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
            >
              {t('fileViewer.preview')}
            </button>
            <button
              type="button"
              className={`viewer-tab ${mode === 'source' ? 'active' : ''}`}
              aria-pressed={mode === 'source'}
              onClick={() => setMode('source')}
            >
              {t('fileViewer.source')}
            </button>
          </div>
          <span className="viewer-divider" aria-hidden />
          <button
            type="button"
            className="viewer-action"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </button>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            download={file.name}
          >
            {t('fileViewer.download')}
          </a>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('fileViewer.open')}
          </a>
        </div>
      </div>
      <div className={`viewer-body ${mode === 'preview' ? 'image-body' : ''}`}>
        {mode === 'preview' ? (
          <img alt={file.name} src={url} />
        ) : loadingSource ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : sourceError ? (
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        ) : (
          <EditableCodeViewer text={source ?? ''} readOnly />
        )}
      </div>
    </div>
  );
}

function TextViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setText(null);
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name).then((t) => {
      if (!cancelled) setText(t ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey]);

  async function copy() {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  const displayText = useMemo(
    () => (text == null ? null : formatJsonFileTextForDisplay(file, text)),
    [file.name, file.mime, text],
  );
  const lineCount = displayText ? displayText.split('\n').length : 0;

  return (
    <div className="viewer text-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left" />
        <div className="viewer-toolbar-actions">
          <button
            type="button"
            className="viewer-action"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </button>
          <button
            type="button"
            className="viewer-action"
            disabled
            title={t('fileViewer.saveDisabled')}
          >
            <Icon name="check" size={13} />
            <span>{t('fileViewer.save')}</span>
          </button>
          <button
            type="button"
            className="viewer-action"
            onClick={() => void copy()}
            title={t('fileViewer.copyTitle')}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </button>
        </div>
      </div>
      <div className="viewer-body">
        {text === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : displayText !== null && lineCount > 0 ? (
          <EditableCodeViewer text={displayText} readOnly />
        ) : (
          <pre className="viewer-source">{displayText}</pre>
        )}
      </div>
    </div>
  );
}

function formatJsonFileTextForDisplay(file: ProjectFile, text: string): string {
  if (!isJsonFile(file)) return text;
  try {
    if (hasPrecisionSensitiveJsonNumberText(text)) return text;
    const parsed = JSON.parse(text) as unknown;
    if (hasUnsafeJsonNumber(parsed)) return text;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function hasPrecisionSensitiveJsonNumberText(text: string): boolean {
  let inString = false;
  let escaped = false;
  const numberTokenPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      i += 1;
      continue;
    }

    numberTokenPattern.lastIndex = i;
    const match = numberTokenPattern.exec(text);
    if (!match) {
      i += 1;
      continue;
    }

    const token = match[0];
    if (isSignedNegativeZeroJsonNumberToken(token)) return true;
    if (/[.eE]/.test(token) && isPrecisionSensitiveJsonNumberToken(token)) return true;
    i = numberTokenPattern.lastIndex;
  }
  return false;
}

function isSignedNegativeZeroJsonNumberToken(token: string): boolean {
  return /^-0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(token);
}

function isPrecisionSensitiveJsonNumberToken(token: string): boolean {
  const parsed = Number(token);
  if (!Number.isFinite(parsed)) return true;
  const rendered = JSON.stringify(parsed);
  if (!rendered) return true;
  const originalValue = parseJsonNumberTokenAsDecimal(token);
  const renderedValue = parseJsonNumberTokenAsDecimal(rendered);
  return (
    !originalValue ||
    !renderedValue ||
    originalValue.coefficient !== renderedValue.coefficient ||
    originalValue.exponent !== renderedValue.exponent
  );
}

function parseJsonNumberTokenAsDecimal(token: string): { coefficient: bigint; exponent: number } | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return null;
  const [, sign, integerPart, fractionPart = '', exponentPart = '0'] = match;
  const coefficient = BigInt(`${sign ?? ''}${integerPart}${fractionPart}`);
  const exponent = Number(exponentPart) - fractionPart.length;
  return normalizeDecimalParts(coefficient, exponent);
}

function normalizeDecimalParts(coefficient: bigint, exponent: number): { coefficient: bigint; exponent: number } {
  if (coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  let normalizedCoefficient = coefficient;
  let normalizedExponent = exponent;
  while (normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedExponent += 1;
  }
  return { coefficient: normalizedCoefficient, exponent: normalizedExponent };
}

function hasUnsafeJsonNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.some(hasUnsafeJsonNumber);
  if (value && typeof value === 'object') return Object.values(value).some(hasUnsafeJsonNumber);
  return false;
}

function isJsonFile(file: ProjectFile): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.mime.toLowerCase().startsWith('application/json');
}

function MarkdownViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const markdownArticleRef = useRef<HTMLElement | null>(null);
  const copyBlockTimerRef = useRef<number | null>(null);
  const copiedMarkdownBlockRef = useRef<HTMLElement | null>(null);
  const status = file.artifactManifest?.status ?? 'complete';
  const isStreaming = status === 'streaming';
  const isError = status === 'error';
  const exportTitle = file.name.replace(/\.mdx?$/i, '') || file.name;

  useEffect(() => {
    setText(null);
    copiedMarkdownBlockRef.current = null;
    if (copyBlockTimerRef.current) {
      window.clearTimeout(copyBlockTimerRef.current);
      copyBlockTimerRef.current = null;
    }
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name).then((next) => {
      if (!cancelled) setText(next ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey]);

  useEffect(() => {
    return () => {
      copiedMarkdownBlockRef.current = null;
      if (copyBlockTimerRef.current) {
        window.clearTimeout(copyBlockTimerRef.current);
      }
    };
  }, []);

  async function copy() {
    if (text == null) return;
    const didCopy = await copyTextToClipboard(text);
    if (didCopy) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  const html = useMemo(() => {
    if (text === null) return null;
    const renderPartial = MarkdownRenderer.renderPartial ?? renderMarkdownToSafeHtml;
    return decorateMarkdownCodeBlocks(renderPartial(text));
  }, [text]);

  useEffect(() => {
    const article = markdownArticleRef.current;
    if (!article) return;
    ensureMarkdownCodeBlockControls(article, t);
    if (copiedMarkdownBlockRef.current?.isConnected) {
      setMarkdownCodeBlockCopiedState(copiedMarkdownBlockRef.current, true, t);
    }
  }, [html, t]);

  async function handleMarkdownBodyClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(`button[${MARKDOWN_COPY_BLOCK_ATTR}]`);
    if (!button) return;
    const block = button.closest('.markdown-code-block');
    if (!(block instanceof HTMLElement)) return;
    const pre = block.querySelector('pre');
    if (!pre) return;
    const didCopy = await copyTextToClipboard(pre.textContent ?? '');
    if (!didCopy) return;
    if (copiedMarkdownBlockRef.current && copiedMarkdownBlockRef.current !== block) {
      setMarkdownCodeBlockCopiedState(copiedMarkdownBlockRef.current, false, t);
    }
    copiedMarkdownBlockRef.current = block;
    setMarkdownCodeBlockCopiedState(block, true, t);
    if (copyBlockTimerRef.current) {
      window.clearTimeout(copyBlockTimerRef.current);
    }
    copyBlockTimerRef.current = window.setTimeout(() => {
      if (copiedMarkdownBlockRef.current) {
        setMarkdownCodeBlockCopiedState(copiedMarkdownBlockRef.current, false, t);
      }
      copiedMarkdownBlockRef.current = null;
      copyBlockTimerRef.current = null;
    }, 1800);
  }

  return (
    <div className="viewer text-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          {isStreaming ? <span className="viewer-meta">{t('fileViewer.markdownStreamingMeta')}</span> : null}
          {isError ? <span className="viewer-meta">{t('fileViewer.markdownErrorMeta')}</span> : null}
        </div>
        <div className="viewer-toolbar-actions">
          <button
            type="button"
            className="viewer-action"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </button>
          <button
            type="button"
            className="viewer-action"
            onClick={() => void copy()}
            title={t('fileViewer.copyTitle')}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </button>
          {text !== null ? (
            <div className="share-menu chrome-share-menu">
              <button
                type="button"
                className="viewer-action"
                aria-haspopup="menu"
                aria-expanded={downloadMenuOpen}
                onClick={() => setDownloadMenuOpen((v) => !v)}
              >
                <Icon name="download" size={13} />
                <span>{t('fileViewer.download')}</span>
              </button>
              {downloadMenuOpen ? (
                <div className="share-menu-popover" role="menu">
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setDownloadMenuOpen(false);
                      exportAsMd(text, exportTitle);
                    }}
                  >
                    <span className="share-menu-icon"><RemixIcon name="file-line" size={15} /></span>
                    <span>{t('fileViewer.exportMd')}</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="viewer-body">
        {html === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : (
          <>
            {isStreaming ? <div className="markdown-status">{t('fileViewer.markdownStreamingStatus')}</div> : null}
            {isError ? <div className="markdown-status markdown-status-error">{t('fileViewer.markdownErrorStatus')}</div> : null}
            {/* Safe by contract: renderMarkdownToSafeHtml escapes raw HTML and rejects unsafe link protocols. */}
            <article
              ref={markdownArticleRef}
              className="markdown-rendered"
              onClick={(event) => void handleMarkdownBodyClick(event)}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function CodeWithLines({ text }: { text: string }) {
  const lines = text.split('\n');
  // Trailing newline produces a phantom empty line — keep gutter aligned.
  const gutter = lines.map((_, i) => `${i + 1}`).join('\n');
  return (
    <pre className="code-viewer">
      <code className="gutter" aria-hidden>
        {gutter}
      </code>
      <code className="lines">{text}</code>
    </pre>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function documentMetaLabel(file: ProjectFile, t: TranslateFn): string {
  if (file.kind === 'pdf') return t('fileViewer.pdfMeta');
  if (file.kind === 'document') return t('fileViewer.documentMeta');
  if (file.kind === 'presentation') return t('fileViewer.presentationMeta');
  if (file.kind === 'spreadsheet') return t('fileViewer.spreadsheetMeta');
  return t('fileViewer.binaryMeta', { size: humanSize(file.size) });
}
