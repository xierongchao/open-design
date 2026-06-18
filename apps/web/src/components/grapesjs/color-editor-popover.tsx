import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Grid3X3,
  Image,
  Pipette,
  Square,
} from 'lucide-react';

import {
  GradientEditor,
  type GradientValue,
} from '../GradientEditor';
import {
  ImageFillControl,
  bgSizeFromOption,
} from './image-fill-control';
import {
  colorValueToCss,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  isEyeDropperSupported,
  parseCssColor,
  parseCssToColorValue,
  pickColorWithEyedropper,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  type ColorValue,
  type RGBA,
} from './color-utils';
import styles from './StylePanel.module.css';

export type FillMode = 'solid' | 'gradient' | 'image';

export interface ImageFillState {
  url: string;
  size: string;
  repeat: string;
  position: string;
  cropSize?: string;
}

export interface ColorEditorFillContext {
  mode: FillMode;
  onModeChange: (mode: FillMode) => void;
  gradient: GradientValue;
  onGradientChange: (g: GradientValue) => void;
  imageState: ImageFillState;
  onImageChange: (patch: Partial<ImageFillState>) => void;
}

export interface ColorEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode?: FillMode;
  onModeChange?: (mode: FillMode) => void;
  supportsFillModes?: boolean;
  gradient?: GradientValue;
  onGradientChange?: (g: GradientValue) => void;
  imageState?: ImageFillState;
  onImageChange?: (patch: Partial<ImageFillState>) => void;
  onCropModeToggle?: (on: boolean) => void;
}

const PAGE_COLOR_SWATCHES = [
  '#D9D9D9', '#059669', '#646464', '#334155', '#FFFFFF', '#F5F5F4', '#343434', '#E7E5E4', '#9ACA65',
  '#FFD400', '#F3F4F6', '#F59E0B', '#EF4444', '#D97706', '#FFF7ED', '#2398B5', '#1F2937', '#D1D5DB',
  '#E5E7EB', '#FFFFFF', '#3C7029', '#F8DCD1', '#1C1917', '#FEF3C7', '#476E75', '#005E46', '#111827',
];

export function cssColorToFormatInput(value: ColorValue, format: 'hex' | 'rgb' | 'hsl'): string {
  const rgb = hsvToRgb(value.hsv);
  if (format === 'rgb') return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  if (format === 'hsl') {
    const hsl = rgbToHsl(rgb);
    return `${hsl.h}, ${hsl.s}%, ${hsl.l}%`;
  }
  return rgbToHex(rgb).replace('#', '').toUpperCase();
}

export function parseFormattedColorInput(raw: string, format: 'hex' | 'rgb' | 'hsl', alpha: number): ColorValue | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: RGBA | null = null;
  if (format === 'hex') {
    if (/^#?[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(trimmed)) {
      parsed = parseCssColor(trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
    }
  } else if (format === 'rgb') {
    const parts = trimmed.split(',').map((p) => Number.parseFloat(p.trim()));
    if (parts.length === 3 && parts.every((p) => Number.isFinite(p))) {
      parsed = { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: 1 };
    }
  } else {
    const parts = trimmed.split(',').map((p) => Number.parseFloat(p.trim().replace('%', '')));
    if (parts.length === 3 && parts.every((p) => Number.isFinite(p))) {
      parsed = { ...hslToRgb(parts[0]!, parts[1]!, parts[2]!), a: 1 };
    }
  }
  if (!parsed) return null;
  return {
    hsv: rgbToHsv({ r: parsed.r, g: parsed.g, b: parsed.b }),
    a: parsed.a < 1 ? parsed.a : alpha,
  };
}

/**
 * HSV color editor used by the floating style popover. Fill properties can opt
 * into solid/gradient/image modes; text, stroke, shadow, and batch replacement
 * use the same picker with `supportsFillModes=false`.
 */
export function ColorEditor({
  label,
  value,
  onChange,
  mode = 'solid',
  onModeChange,
  supportsFillModes = false,
  gradient,
  onGradientChange,
  imageState,
  onImageChange,
  onCropModeToggle,
}: ColorEditorProps) {
  const [colorValue, setColorValue] = useState<ColorValue>(() => parseCssToColorValue(value));
  const [format, setFormat] = useState<'hex' | 'rgb' | 'hsl'>('hex');
  const [formatDraft, setFormatDraft] = useState<string | null>(null);

  useEffect(() => {
    setColorValue(parseCssToColorValue(value));
    setFormatDraft(null);
  }, [value]);

  const commit = useCallback(
    (cv: ColorValue) => {
      setColorValue(cv);
      onChange(colorValueToCss(cv));
    },
    [onChange],
  );

  const { hsv, a } = colorValue;
  const rgb = hsvToRgb(hsv);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const drawCanvas = useCallback((h: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const hh = canvas.height;
    const hueRgb = hsvToRgb({ h, s: 100, v: 100 });
    ctx.fillStyle = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;
    ctx.fillRect(0, 0, w, hh);
    const whiteGradient = ctx.createLinearGradient(0, 0, w, 0);
    whiteGradient.addColorStop(0, 'rgba(255,255,255,1)');
    whiteGradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGradient;
    ctx.fillRect(0, 0, w, hh);
    const blackGradient = ctx.createLinearGradient(0, 0, 0, hh);
    blackGradient.addColorStop(0, 'rgba(0,0,0,0)');
    blackGradient.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = blackGradient;
    ctx.fillRect(0, 0, w, hh);
  }, []);

  useEffect(() => { drawCanvas(hsv.h); }, [hsv.h, drawCanvas]);

  useEffect(() => {
    if (markerRef.current && canvasRef.current) {
      markerRef.current.style.left = `${hsv.s}%`;
      markerRef.current.style.top = `${100 - hsv.v}%`;
    }
  }, [hsv.s, hsv.v]);

  const pickFromCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const s = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      const v = Math.max(0, Math.min(100, 100 - ((clientY - rect.top) / rect.height) * 100));
      commit({ hsv: { ...hsv, s: Math.round(s), v: Math.round(v) }, a });
    },
    [a, commit, hsv],
  );

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      pickFromCanvas(e.clientX, e.clientY);
      const move = (moveEvent: PointerEvent) => {
        if (draggingRef.current) pickFromCanvas(moveEvent.clientX, moveEvent.clientY);
      };
      const up = () => {
        draggingRef.current = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [pickFromCanvas],
  );

  const onEyedropper = useCallback(async () => {
    const hex = await pickColorWithEyedropper();
    if (hex) {
      const cv = parseCssToColorValue(hex);
      commit({ ...cv, a });
    }
  }, [a, commit]);

  const inputValue = useMemo(() => {
    return formatDraft ?? cssColorToFormatInput(colorValue, format);
  }, [colorValue, format, formatDraft]);

  const commitFormatDraft = useCallback(
    (raw: string) => {
      const parsed = parseFormattedColorInput(raw, format, a);
      if (parsed) commit(parsed);
      setFormatDraft(null);
    },
    [a, commit, format],
  );

  const hexDisplay = rgbToHex(rgb);

  return (
    <div className={styles.colorEditor}>
      {supportsFillModes ? (
        <div className={styles.colorEditorModes} role="group" aria-label="颜色类型">
          <button
            type="button"
            className={`${styles.colorModeButton}${mode === 'solid' ? ` ${styles.colorModeButtonActive}` : ''}`}
            aria-label="纯色填充"
            aria-pressed={mode === 'solid'}
            title="纯色填充"
            data-tooltip="纯色填充"
            onClick={() => onModeChange?.('solid')}
          >
            <Square size={15} />
          </button>
          <button
            type="button"
            className={`${styles.colorModeButton}${mode === 'gradient' ? ` ${styles.colorModeButtonActive}` : ''}`}
            aria-label="渐变填充"
            aria-pressed={mode === 'gradient'}
            title="渐变填充"
            data-tooltip="渐变填充"
            disabled={!supportsFillModes}
            onClick={() => onModeChange?.('gradient')}
          >
            <Grid3X3 size={15} />
          </button>
          <button
            type="button"
            className={`${styles.colorModeButton}${mode === 'image' ? ` ${styles.colorModeButtonActive}` : ''}`}
            aria-label="图片填充"
            aria-pressed={mode === 'image'}
            title="图片填充"
            data-tooltip="图片填充"
            disabled={!supportsFillModes}
            onClick={() => onModeChange?.('image')}
          >
            <Image size={15} />
          </button>
        </div>
      ) : null}

      {supportsFillModes && mode === 'gradient' && onGradientChange && gradient ? (
        <div className={styles.gradientWrap}>
          <GradientEditor value={gradient} onChange={onGradientChange} />
        </div>
      ) : supportsFillModes && mode === 'image' && onImageChange ? (
        <ImageFillControl
          url={imageState?.url ?? ''}
          size={imageState?.size ?? 'cover'}
          repeat={imageState?.repeat ?? 'no-repeat'}
          onUrlChange={(url) => onImageChange({ url })}
          onSizeChange={(size) => onImageChange({ size: bgSizeFromOption(size) })}
          onRepeatChange={(repeat) => onImageChange({ repeat })}
          onCropModeChange={(on) => onCropModeToggle?.(on)}
        />
      ) : (
        <>
          <div className={styles.colorCanvasWrap}>
            <canvas
              ref={canvasRef}
              className={styles.colorCanvas}
              width={240}
              height={140}
              onPointerDown={onCanvasPointerDown}
              style={{ touchAction: 'none' }}
              aria-label={`${label}色域`}
              title="拖拽选择饱和度和明度"
            />
            <div
              ref={markerRef}
              className={styles.colorCanvasMarkerOverlay}
              style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, borderColor: hsv.v > 50 && hsv.s < 80 ? '#000' : '#fff' }}
            />
          </div>

          <input
            className={`${styles.hueSlider} ${styles.fullWidthSlider}`}
            aria-label="色相"
            type="range"
            min={0}
            max={360}
            value={hsv.h}
            onChange={(e) => commit({ hsv: { ...hsv, h: Number(e.target.value) }, a })}
          />

          <input
            className={`${styles.alphaSlider} ${styles.fullWidthSlider}`}
            aria-label="透明度"
            type="range"
            min={0}
            max={100}
            value={Math.round(a * 100)}
            onChange={(e) => commit({ hsv, a: Number(e.target.value) / 100 })}
            style={{ background: `linear-gradient(to right, transparent, ${hexDisplay})` }}
          />

          <div className={styles.colorEditorValues}>
            <select
              aria-label="颜色格式"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as 'hex' | 'rgb' | 'hsl');
                setFormatDraft(null);
              }}
            >
              <option value="hex">HEX</option>
              <option value="rgb">RGB</option>
              <option value="hsl">HSL</option>
            </select>
            <input
              aria-label={`${label}颜色值`}
              value={inputValue}
              onChange={(e) => {
                const raw = e.target.value;
                setFormatDraft(raw);
                const parsed = parseFormattedColorInput(raw, format, a);
                if (parsed) commit(parsed);
              }}
              onBlur={(e) => commitFormatDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitFormatDraft(e.currentTarget.value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setFormatDraft(null);
                  e.currentTarget.blur();
                }
              }}
            />
            <input
              aria-label={`${label}透明度`}
              type="number"
              min={0}
              max={100}
              value={Math.round(a * 100)}
              onChange={(e) => commit({ hsv, a: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })}
            />
            <span>%</span>
          </div>

          <div className={styles.colorEditorActions}>
            <button
              type="button"
              className={styles.colorActionBtn}
              onClick={onEyedropper}
              disabled={!isEyeDropperSupported()}
              title={isEyeDropperSupported() ? '吸管取色' : '当前浏览器不支持吸管取色（需 Chrome/Edge）'}
              aria-label="吸管取色"
            >
              <Pipette size={14} />
              {isEyeDropperSupported() ? '吸管取色' : '不支持'}
            </button>
          </div>

          <div className={styles.paletteHeader}>
            <select aria-label="颜色集合" defaultValue="page">
              <option value="page">当前页面</option>
              <option value="document">当前文件</option>
              <option value="library">组件库</option>
            </select>
            <span>{PAGE_COLOR_SWATCHES.length} 色</span>
          </div>
          <div className={styles.paletteGrid}>
            {PAGE_COLOR_SWATCHES.map((color, index) => (
              <button
                key={`${color}-${index}`}
                type="button"
                className={styles.paletteSwatch}
                style={{ '--swatch-color': color } as CSSProperties}
                aria-label={`选择颜色 ${color}`}
                onClick={() => commit({ hsv: rgbToHsv(hexToRgb(color)), a })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
