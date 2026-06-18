import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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

export function imageUrlFromCssUrl(value: string | undefined): string {
  if (!value || value === 'none') return '';
  const match = value.trim().match(/^url\((['"]?)(.*)\1\)$/);
  return match?.[2] ?? '';
}

export function objectFitToFillSize(value: string | undefined): string {
  if (value === 'contain' || value === 'cover') return value;
  if (value === 'fill') return '100% 100%';
  if (value === 'none') return 'od-crop';
  return 'cover';
}

export function fillSizeToObjectFit(size: string): string {
  if (size === 'contain' || size === 'cover') return size;
  if (size === '100% 100%') return 'fill';
  if (size === 'auto' || size === 'od-crop' || /^\s*[\d.]+px\s+[\d.]+px\s*$/.test(size)) return 'none';
  return 'cover';
}

export function ImageFillSummary({
  url,
  onOpen,
}: {
  url: string;
  onOpen: (anchor: HTMLElement) => void;
}) {
  const previewStyle = url
    ? ({
        backgroundImage: `url("${url}")`,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
      } as CSSProperties)
    : undefined;

  return (
    <button
      type="button"
      className={styles.imageFillSummary}
      aria-label="打开图片填充"
      title="打开图片填充"
      data-tooltip="打开图片填充"
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <span className={styles.imageFillSummaryPreview} style={previewStyle}>
        {!url ? <Image size={14} aria-hidden="true" /> : null}
      </span>
      <span className={styles.imageFillSummaryText}>图片</span>
    </button>
  );
}

export function ImageFillControl({
  url,
  size,
  repeat,
  onUrlChange,
  onSizeChange,
  onRepeatChange,
  onCropModeChange,
}: {
  url: string;
  size: string;
  repeat: string;
  onUrlChange: (url: string) => void;
  onSizeChange: (size: string) => void;
  onRepeatChange: (repeat: string) => void;
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
