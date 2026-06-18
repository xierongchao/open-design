import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Image } from 'lucide-react';

import { readImageFileToDataUrl } from './image-upload';
import styles from './StylePanel.module.css';

// Translate the fill-panel size option into the CSS background-size value
// written to the element. "裁剪" (od-crop) shows the image at its natural size
// (the container clips the overflow); other options map 1:1 to CSS keywords.
export function bgSizeFromOption(size: string): string {
  if (size === 'od-crop') return 'auto';
  return size;
}

// Inverse of bgSizeFromOption: map the element's CSS background-size back to
// the option shown in the <select>. CSS 'auto' (natural size, clipped) is the
// 裁剪 option.
export function optionFromBgSize(css: string): string {
  if (css === 'auto' || /^\s*[\d.]+px\s+[\d.]+px\s*$/.test(css)) return 'od-crop';
  return css;
}

const CROP_VIEWPORT_W = 220;
const CROP_VIEWPORT_H = 150;

/**
 * Simplified crop editor: the viewport stands in for the element box. The user
 * drags the image to pan and uses the zoom slider to enlarge/shrink the
 * displayed area. The result maps directly to CSS background-size +
 * background-position; the selected element's own box clips the image.
 */
function CropEditor({
  url,
  bgSize,
  bgPosition,
  onChange,
}: {
  url: string;
  bgSize: string;
  bgPosition: string;
  onChange: (cssSize: string, cssPosition: string) => void;
}) {
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const ownerDocument = viewportRef.current?.ownerDocument ?? document;

  const emit = useCallback(
    (z: number, p: { x: number; y: number }) => {
      if (!natural.w) return;
      const sizeW = Math.round(natural.w * z);
      const sizeH = Math.round(natural.h * z);
      onChange(`${sizeW}px ${sizeH}px`, `${Math.round(p.x)}px ${Math.round(p.y)}px`);
    },
    [natural.w, natural.h, onChange],
  );

  const readInitialCrop = useCallback(
    (naturalSize: { w: number; h: number }) => {
      const sizeMatch = bgSize.match(/^\s*([\d.]+)px\s+([\d.]+)px\s*$/);
      const positionMatch = bgPosition.match(/^\s*(-?[\d.]+)px\s+(-?[\d.]+)px\s*$/);
      if (!sizeMatch || !positionMatch || naturalSize.w <= 0 || naturalSize.h <= 0) return null;
      const width = Number(sizeMatch[1]);
      const height = Number(sizeMatch[2]);
      const x = Number(positionMatch[1]);
      const y = Number(positionMatch[2]);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        zoom: Math.max(0.1, Math.min(8, Math.min(width / naturalSize.w, height / naturalSize.h))),
        pan: { x, y },
      };
    },
    [bgPosition, bgSize],
  );

  useEffect(() => {
    if (!url) return;
    const img = ownerDocument.createElement('img');
    img.onload = () => {
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      setNatural({ w: nw, h: nh });
      const restored = readInitialCrop({ w: nw, h: nh });
      if (restored) {
        setZoom(restored.zoom);
        setPan(restored.pan);
        return;
      }
      const coverZoom = Math.max(CROP_VIEWPORT_W / nw, CROP_VIEWPORT_H / nh);
      setZoom(coverZoom);
      const dw = nw * coverZoom;
      const dh = nh * coverZoom;
      const initPan = { x: (CROP_VIEWPORT_W - dw) / 2, y: (CROP_VIEWPORT_H - dh) / 2 };
      setPan(initPan);
      emit(coverZoom, initPan);
    };
    img.src = url;
  }, [emit, ownerDocument, readInitialCrop, url]);

  const onViewportPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      const move = (me: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const next = { x: drag.panX + (me.clientX - drag.startX), y: drag.panY + (me.clientY - drag.startY) };
        setPan(next);
        emit(zoom, next);
      };
      const up = () => {
        dragRef.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [emit, pan.x, pan.y, zoom],
  );

  const onZoom = (nextZoom: number) => {
    const z = Math.max(0.1, Math.min(8, nextZoom));
    const cx = CROP_VIEWPORT_W / 2;
    const cy = CROP_VIEWPORT_H / 2;
    const ix = (cx - pan.x) / zoom;
    const iy = (cy - pan.y) / zoom;
    const next = { x: cx - ix * z, y: cy - iy * z };
    setZoom(z);
    setPan(next);
    emit(z, next);
  };

  const imgLayerStyle = {
    width: natural.w ? natural.w * zoom : 0,
    height: natural.h ? natural.h * zoom : 0,
    transform: `translate(${pan.x}px, ${pan.y}px)`,
    backgroundImage: `url("${url}")`,
    backgroundSize: '100% 100%',
  } as CSSProperties;

  return (
    <div className={styles.cropEditor}>
      <div
        ref={viewportRef}
        className={styles.cropViewport}
        style={{ width: CROP_VIEWPORT_W, height: CROP_VIEWPORT_H }}
        onPointerDown={onViewportPointerDown}
      >
        <div className={styles.cropImageLayer} style={imgLayerStyle} />
      </div>
      <div className={styles.cropZoomRow}>
        <span className={styles.imageOptionLabel}>缩放</span>
        <input
          type="range"
          min={10}
          max={800}
          value={Math.round(zoom * 100)}
          onChange={(e) => onZoom(Number(e.target.value) / 100)}
          aria-label="图片缩放"
        />
        <span className={styles.cropZoomValue}>{Math.round(zoom * 100)}%</span>
      </div>
      <p className={styles.cropHint}>拖动图片改变显示区域，滑动缩放调整大小</p>
    </div>
  );
}

export function ImageFillControl({
  url,
  size,
  repeat,
  onUrlChange,
  onSizeChange,
  onRepeatChange,
  position,
  cropSize,
  onCrop,
  onCropModeChange,
}: {
  url: string;
  size: string;
  repeat: string;
  onUrlChange: (url: string) => void;
  onSizeChange: (size: string) => void;
  onRepeatChange: (repeat: string) => void;
  position?: string;
  cropSize?: string;
  onCrop?: (cssSize: string, cssPosition: string) => void;
  onCropModeChange?: (on: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewStyle = url
    ? ({
        backgroundImage: `url("${url}")`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      } as CSSProperties)
    : undefined;

  const onPickFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const { dataUrl } = await readImageFileToDataUrl(file);
      onUrlChange(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取图片失败');
    }
  }, [onUrlChange]);

  const showCrop = size === 'od-crop' && !!url;

  useEffect(() => {
    onCropModeChange?.(showCrop);
    return () => onCropModeChange?.(false);
  }, [showCrop, onCropModeChange]);

  return (
    <div className={styles.imageFillSection}>
      <button
        type="button"
        className={styles.imagePreviewArea}
        style={previewStyle}
        aria-label={url ? '点击替换图片' : '点击上传图片'}
        title={url ? '点击替换图片' : '点击上传图片'}
        data-tooltip={url ? '点击替换图片' : '点击上传图片'}
        onClick={() => inputRef.current?.click()}
      >
        {!url ? (
          <span className={styles.imagePreviewPlaceholder}>
            <Image size={18} aria-hidden="true" />
            <span>点击上传图片</span>
          </span>
        ) : null}
        <span className={styles.imagePreviewHover} aria-hidden="true">
          {url ? '点击替换图片' : '点击上传图片'}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className={styles.hiddenFileInput}
          aria-label="选择图片文件"
          onChange={(event) => {
            void onPickFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </button>
      {showCrop && onCrop ? (
        <CropEditor
          url={url}
          bgSize={cropSize ?? bgSizeFromOption(size)}
          bgPosition={position ?? 'center'}
          onChange={onCrop}
        />
      ) : null}
      {error ? <p className={styles.imageUploadError}>{error}</p> : null}
      <label className={styles.imageOptionRow}>
        <span className={styles.imageOptionLabel}>尺寸</span>
        <span className={styles.selectField}>
          <select
            className={styles.select}
            value={size}
            onChange={(e) => onSizeChange(e.target.value)}
          >
            <option value="cover">充满</option>
            <option value="contain">适应</option>
            <option value="100% 100%">拉伸</option>
            <option value="od-crop">裁剪</option>
          </select>
        </span>
      </label>
      {!showCrop ? (
        <label className={styles.imageOptionRow}>
          <span className={styles.imageOptionLabel}>重复</span>
          <span className={styles.selectField}>
            <select
              className={styles.select}
              value={repeat}
              onChange={(e) => onRepeatChange(e.target.value)}
            >
              <option value="no-repeat">不重复</option>
              <option value="repeat">重复</option>
              <option value="repeat-x">水平重复</option>
              <option value="repeat-y">垂直重复</option>
            </select>
          </span>
        </label>
      ) : null}
    </div>
  );
}
