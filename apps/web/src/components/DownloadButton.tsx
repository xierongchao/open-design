// Download split button in the project header. Opens a popover with the
// three artifact export actions: Export as PDF, Export as image, and
// Download as .zip. Reuses the client-side export helpers from
// runtime/exports.ts (the same ones the HTML viewer's Share menu uses),
// so the header surface and the viewer surface stay in lockstep.
//
// Image export is self-contained: it renders the artifact in a hidden
// off-screen iframe (captureHtmlSnapshot) instead of relying on the
// on-screen preview, so it works in every view — including the GrapesJS
// editor, whose canvas is not a normal preview iframe and has no
// snapshot bridge. The image modal then lets the user pick a format
// (PNG / JPG) and a scale (1x / 2x / 3x / 4x) before downloading.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchProjectFileText, projectRawUrl } from '../providers/registry';
import {
  captureHtmlSnapshot,
  captureHtmlSvg,
  exportAsPdf,
  exportAsZip,
  scaleAndEncodeSnapshot,
  type ImageExportFormat,
  type PreviewSnapshot,
} from '../runtime/exports';
import { useT } from '../i18n';
import { Icon } from './Icon';

// Directory portion of a file path (trailing slash kept) so relative asset
// references in the artifact (../../assets/x.svg) resolve against the file's
// own location — mirrors baseDirFor in FileViewer.
function baseDirFor(fileName: string): string {
  const idx = fileName.lastIndexOf('/');
  return idx >= 0 ? fileName.slice(0, idx + 1) : '';
}

function safeFilename(name: string): string {
  const slug = (name || 'artifact')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'artifact';
}

const FORMAT_OPTIONS: Array<{ value: ImageFormat; label: string; extension: string }> = [
  { value: 'png', label: 'PNG', extension: '.png' },
  { value: 'jpeg', label: 'JPG', extension: '.jpg' },
  { value: 'webp', label: 'WebP', extension: '.webp' },
  { value: 'svg', label: 'SVG', extension: '.svg' },
];

// ImageExportFormat covers the raster formats; SVG is a vector path handled
// separately (verbatim foreignObject SVG, no pixel scale).
type ImageFormat = ImageExportFormat | 'svg';

const SCALE_OPTIONS = [1, 2, 3, 4] as const;

interface Props {
  projectId: string;
  // The currently-active HTML file's name and kind. When undefined (no file
  // tab active, or the active tab is not an HTML artifact) the button
  // renders disabled so a header action never silently targets the wrong
  // file.
  fileName?: string;
  fileKind?: string;
}

export function DownloadButton({
  projectId,
  fileName,
  fileKind,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'image' | 'zip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Cache of the active HTML file's source for the duration the popover is
  // open; refetched on fileName changes.
  const [html, setHtml] = useState<string | null>(null);
  const [loadingHtml, setLoadingHtml] = useState(false);
  const htmlRef = useRef<string | null>(null);
  htmlRef.current = html;

  // Image export modal state.
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageFormat, setImageFormat] = useState<ImageFormat>('png');
  const [imageScale, setImageScale] = useState<number>(2);
  const [imageSnapshot, setImageSnapshot] = useState<PreviewSnapshot | null>(null);
  // SVG export is a separate capture (verbatim foreignObject SVG string),
  // kept distinct from the raster snapshot.
  const [imageSvg, setImageSvg] = useState<{ svg: string; w: number; h: number } | null>(null);
  const [imageSaving, setImageSaving] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  // SVG is resolution-independent: no scale picker applies.
  const isSvgFormat = imageFormat === 'svg';
  const effectiveScale = isSvgFormat ? 1 : imageScale;

  const isHtmlTarget = !!fileName && (fileKind === 'html' || /\.html?$/i.test(fileName));

  const ensureHtml = useCallback(async (): Promise<string | null> => {
    if (!fileName) return null;
    if (htmlRef.current != null) return htmlRef.current;
    setLoadingHtml(true);
    const text = await fetchProjectFileText(projectId, fileName);
    setLoadingHtml(false);
    if (text != null) {
      setHtml(text);
      htmlRef.current = text;
    }
    return text;
  }, [projectId, fileName]);

  useEffect(() => {
    setHtml(null);
    htmlRef.current = null;
    setError(null);
  }, [fileName]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const title = fileName ? safeFilename(fileName) : 'artifact';
  // base URL for resolving the artifact's relative asset references
  // (../../assets/x.svg → /api/projects/<id>/raw/<dir>/../../assets/x.svg).
  const baseHref = fileName ? projectRawUrl(projectId, baseDirFor(fileName)) : undefined;
  const triggerTitle = t('fileViewer.download');

  async function handlePdf() {
    if (!fileName) return;
    setError(null);
    setBusy('pdf');
    try {
      const text = await ensureHtml();
      if (text == null) {
        setError(t('fileViewer.exportImageFailed'));
        return;
      }
      await exportAsPdf(text, title, baseHref ? { baseHref } : undefined);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleZip() {
    if (!fileName) return;
    setError(null);
    setBusy('zip');
    try {
      const text = await ensureHtml();
      if (text == null) {
        setError(t('fileViewer.exportImageFailed'));
        return;
      }
      exportAsZip(text, title);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // Open the image export modal. The capture happens LAZILY on Save — opening
  // the modal only shows the format/scale options and preloads the HTML so the
  // capture on Save is fast. This keeps the Save button idle ("Save") until
  // the user actually clicks it, instead of showing a capturing state on open.
  async function openImageExport() {
    setError(null);
    setBusy('image');
    setImageError(null);
    setImageSnapshot(null);
    setImageSvg(null);
    setImageModalOpen(true);
    // Preload the HTML (no capture yet) so Save can capture immediately.
    try {
      const text = await ensureHtml();
      if (text == null) {
        setImageError(t('fileViewer.exportImageFailed'));
      }
    } catch (err) {
      setImageError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // Switch format in the modal. With lazy capture there is nothing to
  // re-capture on a format change — just update the selection.
  function changeFormat(next: ImageFormat) {
    setImageFormat(next);
    setImageError(null);
    // A previously-cached raster snapshot stays valid across raster formats;
    // only clear it when switching to/from SVG so the right path runs on Save.
    if (next === 'svg') {
      setImageSnapshot(null);
    } else if (isSvgFormat) {
      setImageSvg(null);
    }
  }

  async function handleImageSave() {
    setImageError(null);
    const text = htmlRef.current;
    if (text == null) {
      setImageError(t('fileViewer.exportImageFailed'));
      return;
    }
    setImageSaving(true);
    try {
      // SVG: true vector via dom-to-svg (no pixel scale).
      if (imageFormat === 'svg') {
        const svg = await captureHtmlSvg(text, baseHref ? { baseHref } : undefined);
        if (!svg) {
          setImageError(t('fileViewer.exportImageFailed'));
          return;
        }
        const blob = new Blob([svg.svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setImageModalOpen(false);
        setOpen(false);
        return;
      }
      // Raster: capture base PNG via modern-screenshot, then scale + encode.
      let snap = imageSnapshot;
      if (!snap) {
        snap = await captureHtmlSnapshot(text, baseHref ? { baseHref } : undefined);
        setImageSnapshot(snap);
      }
      if (!snap) {
        setImageError(t('fileViewer.exportImageFailed'));
        return;
      }
      const rasterFormat: ImageExportFormat = imageFormat === 'webp' ? 'webp' : imageFormat === 'jpeg' ? 'jpeg' : 'png';
      const blob = await scaleAndEncodeSnapshot(snap.dataUrl, {
        scale: effectiveScale,
        format: rasterFormat,
      });
      const ext = rasterFormat === 'jpeg' ? 'jpg' : rasterFormat === 'webp' ? 'webp' : 'png';
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `${title}${effectiveScale > 1 ? `@${effectiveScale}x` : ''}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setImageModalOpen(false);
      setOpen(false);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : String(err));
    } finally {
      setImageSaving(false);
    }
  }

  return (
    <div
      className={`handoff-wrap download-wrap${open ? ' open' : ''}`}
      ref={wrapRef}
      data-testid="download-wrap"
    >
      <button
        type="button"
        className="settings-icon-btn od-tooltip"
        data-testid="download-trigger"
        title={triggerTitle}
        data-tooltip={triggerTitle}
        data-tooltip-placement="bottom"
        aria-label={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!isHtmlTarget || busy !== null}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="download" size={17} />
      </button>
      {open ? (
        <div
          className="share-menu-popover download-menu"
          role="menu"
          aria-label={t('fileViewer.download')}
          data-testid="download-menu"
        >
          <button
            type="button"
            className="share-menu-item"
            role="menuitem"
            disabled={busy !== null || loadingHtml}
            onClick={() => void handlePdf()}
          >
            <span className="share-menu-icon" aria-hidden>
              <Icon name={busy === 'pdf' ? 'spinner' : 'file'} size={15} />
            </span>
            <span>{t('common.exportPdf')}</span>
          </button>
          <button
            type="button"
            className="share-menu-item"
            role="menuitem"
            disabled={busy !== null}
            onClick={() => void openImageExport()}
          >
            <span className="share-menu-icon" aria-hidden>
              <Icon name={busy === 'image' ? 'spinner' : 'image'} size={15} />
            </span>
            <span>{t('common.exportImage')}</span>
          </button>
          <button
            type="button"
            className="share-menu-item"
            role="menuitem"
            disabled={busy !== null || loadingHtml}
            onClick={() => void handleZip()}
          >
            <span className="share-menu-icon" aria-hidden>
              <Icon name={busy === 'zip' ? 'spinner' : 'download'} size={15} />
            </span>
            <span>{t('common.exportZip')}</span>
          </button>
          {error ? (
            <>
              <div className="share-menu-divider" aria-hidden />
              <div className="handoff-menu-error" role="alert">
                {error}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {imageModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal deploy-modal download-image-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('common.exportImage')}
          >
            <div className="modal-head">
              <h2>{t('common.exportImage')}</h2>
              <p className="subtitle">{t('fileViewer.exportImageModalSubtitle')}</p>
            </div>
            <div className="deploy-form download-image-form">
              <fieldset className="image-export-format-field" disabled={imageSaving}>
                <legend>{t('fileViewer.exportImageFormatLabel')}</legend>
                <div className="image-export-format-options">
                  {FORMAT_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`image-export-format-option${imageFormat === option.value ? ' active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="download-image-format"
                        value={option.value}
                        aria-label={option.label}
                        checked={imageFormat === option.value}
                        onChange={() => changeFormat(option.value)}
                      />
                      <span className="image-export-format-text">
                        <strong>{option.label}</strong>
                        <span aria-hidden="true">{option.extension}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="image-export-format-field" disabled={imageSaving || isSvgFormat}>
                <legend>{t('fileViewer.exportImageScaleLabel')}</legend>
                <div className="download-image-scale-options">
                  {SCALE_OPTIONS.map((scale) => (
                    <button
                      key={scale}
                      type="button"
                      className={`download-image-scale-chip${effectiveScale === scale ? ' active' : ''}`}
                      aria-pressed={effectiveScale === scale}
                      disabled={isSvgFormat}
                      onClick={() => setImageScale(scale)}
                    >
                      {scale}x
                    </button>
                  ))}
                </div>
              </fieldset>
              {imageError ? (
                <p className="deploy-error" role="alert">{imageError}</p>
              ) : null}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="ghost-link button-like"
                disabled={imageSaving}
                onClick={() => setImageModalOpen(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="viewer-action primary"
                disabled={imageSaving || !html}
                onClick={() => void handleImageSave()}
              >
                {imageSaving ? t('fileViewer.exportImageSaving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
