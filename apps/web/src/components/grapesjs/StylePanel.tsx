/**
 * Compact Figma-style property panel for the GrapesJS canvas.
 *
 * The panel reads a computed-style snapshot from GrapesjsEditor and writes
 * changes through the editor handle, keeping multi-selection behavior intact.
 */
import { Button } from '@open-design/components';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignHorizontalSpaceBetween,
  AlignVerticalSpaceBetween,
  AlignEndVertical,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  Columns2,
  Combine,
  ChevronDown,
  Droplet,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  Grid2X2,
  Grid3X3,
  Image,
  Layers,
  Link2,
  Minus,
  Move,
  Plus,
  Pipette,
  RotateCw,
  Rows2,
  Scan,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareDashed,
  Type,
  Undo2,
  Unlink2,
  WandSparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  GradientEditor,
  createDefaultGradient,
  gradientToCss,
  parseGradientCss,
  type GradientValue,
} from '../GradientEditor';
import type { GrapesjsEditorHandle, SelectionSnapshot } from './GrapesjsEditor';
import { readImageFileToDataUrl } from './image-upload';
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hsvToRgb,
  rgbToHsv,
  hslToRgb,
  parseCssColor,
  parseCssToColorValue,
  colorValueToCss,
  rgbaToCss,
  pickColorWithEyedropper,
  isEyeDropperSupported,
  type ColorValue,
  type RGBA,
} from './color-utils';
import styles from './StylePanel.module.css';

export interface StylePanelProps {
  editorRef: React.MutableRefObject<GrapesjsEditorHandle | null>;
  selection: SelectionSnapshot | null;
  /**
   * Incremented each time the user double-clicks an <img> in the canvas.
   * The panel watches this counter and, when the selected element is an
   * <img>, opens the fill panel's image tab so the uploaded image replaces
   * the <img>'s src (instead of a background-image fill).
   */
  imageEditSignal?: number;
}

type StyleMap = Record<string, string>;
type FlowValue = 'free' | 'column' | 'row' | 'wrap';
type DimensionMode = 'fixed' | 'hug' | 'fill';
type EffectType = 'none' | 'inner-shadow' | 'drop-shadow' | 'layer-blur' | 'background-blur' | 'noise' | 'texture' | 'glass';

interface FloatingPosition {
  top: number;
  left: number;
}

interface ColorEditorState {
  label: string;
  value: string;
  position: FloatingPosition;
  onChange: (value: string) => void;
  /** Fill-mode context. Only set when the editor is opened from the Fill
   *  section; absent for text color / border / shadow editors. */
  fill?: {
    mode: 'solid' | 'gradient' | 'image';
    onModeChange: (mode: 'solid' | 'gradient' | 'image') => void;
    gradient: GradientValue;
    onGradientChange: (g: GradientValue) => void;
    imageState: { url: string; size: string; repeat: string; position: string };
    onImageChange: (patch: Partial<{ url: string; size: string; repeat: string; position: string }>) => void;
  };
}

interface IconOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

const FLOW_OPTIONS: IconOption[] = [
  { value: 'free', label: '自由布局', icon: Move },
  { value: 'column', label: '垂直流', icon: Rows2 },
  { value: 'row', label: '水平流', icon: Columns2 },
  { value: 'wrap', label: '自动换行', icon: Grid2X2 },
];

const POSITION_ALIGN_OPTIONS: IconOption[] = [
  { value: 'start-horizontal', label: '水平左对齐', icon: AlignStartHorizontal },
  { value: 'center-horizontal', label: '水平居中', icon: AlignCenterHorizontal },
  { value: 'end-horizontal', label: '水平右对齐', icon: AlignEndHorizontal },
  { value: 'start-vertical', label: '垂直顶部对齐', icon: AlignStartVertical },
  { value: 'center-vertical', label: '垂直居中', icon: AlignCenterVertical },
  { value: 'end-vertical', label: '垂直底部对齐', icon: AlignEndVertical },
];

const TEXT_ALIGN_OPTIONS: IconOption[] = [
  { value: 'left', label: '左对齐', icon: AlignLeft },
  { value: 'center', label: '居中对齐', icon: AlignCenter },
  { value: 'right', label: '右对齐', icon: AlignRight },
  { value: 'justify', label: '两端对齐', icon: AlignJustify },
];

const FONT_FAMILY_OPTIONS = [
  { value: '', label: '继承' },
  { value: 'system-ui, sans-serif', label: '系统默认' },
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Helvetica, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Courier New", monospace', label: 'Courier New' },
];

const FONT_WEIGHT_OPTIONS = [
  { value: '100', label: '细体' },
  { value: '300', label: '轻体' },
  { value: '400', label: '常规' },
  { value: '500', label: '中等' },
  { value: '600', label: '半粗' },
  { value: '700', label: '粗体' },
  { value: '900', label: '特粗' },
];

const POSITION_OPTIONS = [
  { value: 'static', label: '静态' },
  { value: 'relative', label: '相对' },
  { value: 'absolute', label: '绝对' },
  { value: 'fixed', label: '固定' },
  { value: 'sticky', label: '粘性' },
];

const EFFECT_OPTIONS: Array<{ value: EffectType; label: string }> = [
  { value: 'inner-shadow', label: '内阴影' },
  { value: 'drop-shadow', label: '投影' },
  { value: 'layer-blur', label: '图层模糊' },
  { value: 'background-blur', label: '背景模糊' },
  { value: 'noise', label: 'Noise' },
  { value: 'texture', label: 'Texture' },
  { value: 'glass', label: 'Glass' },
  { value: 'none', label: '无' },
];

/**
 * Shadow layer definition. Each layer maps to one box-shadow entry.
 * inset=true produces an inner shadow.
 */
interface ShadowLayer {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string; // CSS color (hex or rgba)
}

/**
 * Parse a CSS box-shadow string (possibly multi-layer, comma-separated) into
 * an array of ShadowLayer. Returns [] for 'none' / empty.
 */
function parseShadowCss(css: string | undefined): ShadowLayer[] {
  if (!css || css === 'none') return [];
  const layers: ShadowLayer[] = [];
  // Split on commas that are NOT inside parentheses (rgba has commas).
  const parts = css.replace(/\s*,\s*(?![^()]*\))/g, '\x00').split('\x00');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === 'none') continue;
    const inset = /\binset\b/i.test(trimmed);
    const cleaned = trimmed.replace(/\binset\b/i, '').trim();
    const colorMatch = cleaned.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+)/i);
    const color = colorMatch?.[1] ?? '#000000';
    const nums = cleaned.replace(color, '').trim().split(/\s+/).map((n) => pxToNum(n, 0));
    layers.push({
      inset,
      x: nums[0] ?? 0,
      y: nums[1] ?? 0,
      blur: nums[2] ?? 0,
      spread: nums[3] ?? 0,
      color,
    });
  }
  return layers;
}

/**
 * Build a CSS box-shadow string from an array of shadow layers.
 */
function buildShadowCss(layers: ShadowLayer[]): string {
  if (layers.length === 0) return 'none';
  return layers
    .map((l) => `${l.inset ? 'inset ' : ''}${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${l.color}`)
    .join(', ');
}

/**
 * Build a single shadow layer CSS string from individual params (for the
 * floating panel draft state).
 */
function buildSingleShadow(params: {
  x: string; y: string; blur: string; spread: string;
  color: string; opacity: string; inset: boolean;
}): string {
  const alpha = Math.max(0, Math.min(1, pxToNum(params.opacity, 25) / 100));
  const rgb = parseCssColor(params.color);
  const colorCss = alpha < 1
    ? `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${Math.round(alpha * 100) / 100})`
    : params.color;
  return `${params.inset ? 'inset ' : ''}${pxToNum(params.x, 0)}px ${pxToNum(params.y, 4)}px ${pxToNum(params.blur, 4)}px ${pxToNum(params.spread, 0)}px ${colorCss}`;
}

// Multi-layer shadow state
const PAGE_COLOR_SWATCHES = [
  '#D9D9D9', '#059669', '#646464', '#334155', '#FFFFFF', '#F5F5F4', '#343434', '#E7E5E4', '#9ACA65',
  '#FFD400', '#F3F4F6', '#F59E0B', '#EF4444', '#D97706', '#FFF7ED', '#2398B5', '#1F2937', '#D1D5DB',
  '#E5E7EB', '#FFFFFF', '#3C7029', '#F8DCD1', '#1C1917', '#FEF3C7', '#476E75', '#005E46', '#111827',
];

const TEXT_TAGS = new Set([
  'a',
  'blockquote',
  'button',
  'caption',
  'code',
  'em',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'label',
  'li',
  'p',
  'pre',
  'small',
  'span',
  'strong',
  'td',
  'th',
]);

function pxToNum(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const match = String(value).match(/^(-?[\d.]+)/);
  return match?.[1] ? Number.parseFloat(match[1]) : fallback;
}

function cssColorToHex(value: string | undefined): string {
  if (!value) return '#000000';
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return value.startsWith('#') ? value.slice(0, 7).toUpperCase() : '#000000';
  const hex = (part: string) => Number.parseInt(part, 10).toString(16).padStart(2, '0');
  return `#${hex(match[1] ?? '0')}${hex(match[2] ?? '0')}${hex(match[3] ?? '0')}`.toUpperCase();
}

function normalizeTypedCssColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^(none|transparent)$/i.test(trimmed)) return 'transparent';
  if (/^#?[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(trimmed)) {
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    return rgbaToCss(parseCssColor(withHash));
  }
  if (/^(?:rgba?|hsla?)\(/i.test(trimmed)) {
    return rgbaToCss(parseCssColor(trimmed));
  }
  return null;
}

function cssColorToFormatInput(value: ColorValue, format: 'hex' | 'rgb' | 'hsl'): string {
  const rgb = hsvToRgb(value.hsv);
  if (format === 'rgb') return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  if (format === 'hsl') {
    const hsl = rgbToHsl(rgb);
    return `${hsl.h}, ${hsl.s}%, ${hsl.l}%`;
  }
  return rgbToHex(rgb);
}

function parseFormattedColorInput(raw: string, format: 'hex' | 'rgb' | 'hsl', alpha: number): ColorValue | null {
  const trimmed = raw.trim();
  let parsed: RGBA | null = null;
  if (format === 'hex') {
    if (/^#?[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(trimmed)) {
      parsed = parseCssColor(trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
    }
  } else if (format === 'rgb') {
    const parts = trimmed.split(',').map((s) => Number.parseFloat(s.trim()));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      parsed = { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: 1 };
    }
  } else if (format === 'hsl') {
    const parts = trimmed.split(',').map((s) => Number.parseFloat(s.trim().replace('%', '')));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      parsed = { ...hslToRgb(parts[0]!, parts[1]!, parts[2]!), a: 1 };
    }
  }
  if (!parsed) return null;
  return {
    hsv: rgbToHsv({ r: parsed.r, g: parsed.g, b: parsed.b }),
    a: parsed.a < 1 ? parsed.a : alpha,
  };
}

function isTransparent(value: string | undefined): boolean {
  return !value || value === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(value);
}

function isGradient(value: string | undefined): boolean {
  return !!value && /gradient\(/i.test(value);
}

function parseRotation(transform: string | undefined): number {
  if (!transform || transform === 'none') return 0;
  const direct = transform.match(/rotate\((-?[\d.]+)deg\)/);
  if (direct?.[1]) return Number.parseFloat(direct[1]);
  const matrix = transform.match(/^matrix\(([^,]+),\s*([^,]+)/);
  if (!matrix?.[1] || !matrix[2]) return 0;
  return Math.round(Math.atan2(Number(matrix[2]), Number(matrix[1])) * (180 / Math.PI));
}

function replaceRotation(transform: string | undefined, degrees: number): string {
  const base = !transform || transform === 'none'
    ? ''
    : transform.replace(/\s*rotate\((-?[\d.]+)deg\)/, '').trim();
  return `${base}${base ? ' ' : ''}rotate(${degrees}deg)`;
}

// Translate the fill-panel size option into the CSS background-size value
// written to the element. "裁剪" (od-crop) shows the image at its natural size
// (the container clips the overflow); other options map 1:1 to CSS keywords.
function bgSizeFromOption(size: string): string {
  if (size === 'od-crop') return 'auto';
  return size;
}

// Inverse of bgSizeFromOption: map the element's CSS background-size back to
// the option shown in the <select>. CSS 'auto' (natural size, clipped) is the
// 裁剪 option.
function optionFromBgSize(css: string): string {
  if (css === 'auto') return 'od-crop';
  return css;
}

function dimensionMode(value: string | undefined, tagName?: string): DimensionMode {
  // Replaced elements like <img> resolve fit-content/max-content to a pixel
  // length through getComputedStyle, so "auto" is the only hug value that
  // round-trips for them. Non-replaced elements keep fit-content.
  const isImg = (tagName ?? '').toLowerCase() === 'img';
  if (isImg) {
    if (!value || value === 'auto') return 'hug';
  } else {
    if (!value || value === 'auto' || value.includes('fit-content') || value.includes('max-content')) return 'hug';
  }
  if (value.includes('%') || value.includes('calc(')) return 'fill';
  return 'fixed';
}

function flowFromStyles(style: StyleMap): FlowValue {
  const display = (style.display ?? 'block').split('::')[0] ?? 'block';
  if (display !== 'flex' && display !== 'inline-flex') return 'free';
  if ((style.flexWrap ?? 'nowrap') !== 'nowrap') return 'wrap';
  return (style.flexDirection ?? 'row').startsWith('column') ? 'column' : 'row';
}

function axisAlignment(value: string | undefined): 0 | 1 | 2 {
  if (value === 'center') return 1;
  if (value === 'flex-end' || value === 'end') return 2;
  return 0;
}

function fieldDisplay(value: string, fallback = 0): string {
  const number = pxToNum(value, fallback);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

function popoverPosition(
  anchor: HTMLElement,
  width = 276,
  preferredTopOffset = 72,
  estimatedHeight = 420,
): FloatingPosition {
  const rect = anchor.getBoundingClientRect();
  return {
    top: Math.max(8, Math.min(window.innerHeight - estimatedHeight - 8, rect.top - preferredTopOffset)),
    left: Math.max(8, rect.left - width - 10),
  };
}

function FloatingPanel({
  title,
  position,
  wide = false,
  children,
  onClose,
}: {
  title: ReactNode;
  position: FloatingPosition;
  wide?: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // Click-outside-to-close: listen on pointerdown (not click) so the panel
    // closes before any underlying element processes the click. Use rAF to
    // defer attachment so the opening click doesn't immediately trigger close.
    const onClickOutside = (event: MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (panel.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const raf = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', onClickOutside, true);
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onClickOutside, true);
    };
  }, [onClose]);

  const panelStyle = {
    '--popover-top': `${position.top}px`,
    '--popover-left': `${position.left}px`,
  } as CSSProperties;

  return createPortal(
    <aside
      ref={panelRef}
      className={`${styles.floatingPanel}${wide ? ` ${styles.floatingPanelWide}` : ''}`}
      style={panelStyle}
      role="dialog"
      aria-modal="false"
    >
      <header className={styles.floatingPanelHeader}>
        <strong>{title}</strong>
        <Button
          type="button"
          size="icon"
          className={styles.floatingCloseButton}
          aria-label="关闭面板"
          title="关闭面板"
          data-tooltip="关闭面板"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </header>
      <div className={styles.floatingPanelBody}>{children}</div>
    </aside>,
    document.body,
  );
}

function IconButton({
  label,
  icon: Icon,
  active = false,
  disabled = false,
  onClick,
  placement,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  placement?: 'left';
}) {
  return (
    <Button
      type="button"
      size="icon"
      className={`${styles.iconButton}${active ? ` ${styles.iconButtonActive}` : ''}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      title={label}
      data-tooltip={label}
      data-tooltip-placement={placement}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
    </Button>
  );
}

function IconGroup({
  options,
  value,
  onChange,
  equal = true,
}: {
  options: IconOption[];
  value: string;
  onChange: (value: string) => void;
  equal?: boolean;
}) {
  return (
    <div className={`${styles.iconGroup}${equal ? ` ${styles.iconGroupEqual}` : ''}`}>
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <Button
            key={option.value}
            type="button"
            size="icon"
            className={`${styles.segmentButton}${active ? ` ${styles.segmentButtonActive}` : ''}`}
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
            data-tooltip={option.label}
            onClick={() => onChange(option.value)}
          >
            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}

/**
 * Real HSV color picker. The color canvas is an interactive saturation/value
 * square (horizontal = saturation, vertical = value) drawn on a <canvas> so
 * the user can click/drag to pick. A hue slider sets H, an alpha slider sets
 * transparency, and the hex/RGB/HSL input supports format switching.
 * EyeDropper API is used when available (Chrome/Edge).
 */
function ColorEditor({
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Fill mode for the property this editor is bound to (solid/gradient/image). */
  mode?: 'solid' | 'gradient' | 'image';
  /** Switch the fill mode (only meaningful when supportsFillModes). */
  onModeChange?: (mode: 'solid' | 'gradient' | 'image') => void;
  /** When false the editor is bound to a non-fill property (text color,
   *  border, shadow) — hide the mode buttons and only show solid. */
  supportsFillModes?: boolean;
  /** Gradient value for gradient mode. */
  gradient?: GradientValue;
  /** Apply a new gradient value. */
  onGradientChange?: (g: GradientValue) => void;
  /** Current image-fill state (url/size/repeat) for image mode. */
  imageState?: { url: string; size: string; repeat: string; position: string };
  /** Apply image-fill changes. */
  onImageChange?: (patch: Partial<{ url: string; size: string; repeat: string; position: string }>) => void;
  /** Forwarded to the inline ImageFillControl so 裁剪 mode can toggle the
   *  canvas drag/wheel handlers even from the floating editor. */
  onCropModeToggle?: (on: boolean) => void;
}) {
  // Parse the incoming CSS color into HSV + alpha state.
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

  // ── HSV canvas interaction ──
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // Draw the SV canvas: background is the pure hue color, overlaid with
  // white→transparent (left→right) and transparent→black (top→bottom).
  const drawCanvas = useCallback(
    (h: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const hh = canvas.height;
      // base hue
      const hueRgb = hsvToRgb({ h, s: 100, v: 100 });
      ctx.fillStyle = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;
      ctx.fillRect(0, 0, w, hh);
      // white gradient left→right (saturation)
      const wg = ctx.createLinearGradient(0, 0, w, 0);
      wg.addColorStop(0, 'rgba(255,255,255,1)');
      wg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = wg;
      ctx.fillRect(0, 0, w, hh);
      // black gradient top→bottom (value)
      const bg = ctx.createLinearGradient(0, 0, 0, hh);
      bg.addColorStop(0, 'rgba(0,0,0,0)');
      bg.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, hh);
    },
    [],
  );

  useEffect(() => { drawCanvas(hsv.h); }, [hsv.h, drawCanvas]);

  // Position the marker based on s,v.
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
    [hsv, a, commit],
  );

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      pickFromCanvas(e.clientX, e.clientY);
      const move = (me: PointerEvent) => { if (draggingRef.current) pickFromCanvas(me.clientX, me.clientY); };
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

  // ── EyeDropper ──
  const onEyedropper = useCallback(async () => {
    const hex = await pickColorWithEyedropper();
    if (hex) {
      const cv = parseCssToColorValue(hex);
      commit({ ...cv, a }); // keep current alpha
    }
  }, [commit, a]);

  // ── Format input value ──
  const inputValue = useMemo(() => {
    return formatDraft ?? cssColorToFormatInput(colorValue, format);
  }, [colorValue, format, formatDraft]);

  const commitFormatDraft = useCallback(
    (raw: string) => {
      const parsed = parseFormattedColorInput(raw, format, a);
      if (parsed) commit(parsed);
      setFormatDraft(null);
    },
    [format, commit, a],
  );

  const hexDisplay = rgbToHex(rgb);

  return (
    <div className={styles.colorEditor}>
      {/* Mode buttons — only shown when the bound property supports fill
          modes (i.e. the Fill section). Text color / border / shadow editors
          keep solid-only. */}
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
          onCrop={(cssSize, cssPosition) => onImageChange({ size: cssSize, position: cssPosition })}
          onCropModeChange={(on) => onCropModeToggle?.(on)}
        />
      ) : (
      <>
      {/* SV canvas — wrapped in a relative container so the marker overlay
          positions correctly AND the pointer drag is captured inside the
          canvas bounds (touch-action: none prevents scroll interference). */}
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
          className={styles.colorCanvasMarkerOverlay}
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, borderColor: hsv.v > 50 && hsv.s < 80 ? '#000' : '#fff' }}
        />
      </div>

      {/* Hue slider — full width */}
      <input
        className={`${styles.hueSlider} ${styles.fullWidthSlider}`}
        aria-label="色相"
        type="range"
        min={0}
        max={360}
        value={hsv.h}
        onChange={(e) => commit({ hsv: { ...hsv, h: Number(e.target.value) }, a })}
      />

      {/* Alpha slider — full width */}
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

      {/* Format + hex/rgb/hsl input + alpha % */}
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

      {/* Eyedropper */}
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

function NumberScrub({
  label,
  value,
  prefix,
  unit,
  step = 1,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  prefix?: ReactNode;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  onChange: (value: string) => void;
}) {
  const prefixRef = useRef<HTMLSpanElement | null>(null);
  const display = useMemo(() => fieldDisplay(value), [value]);

  const clamp = useCallback((number: number) => {
    if (min !== undefined && number < min) return min;
    if (max !== undefined && number > max) return max;
    return number;
  }, [max, min]);

  const commit = useCallback((number: number) => {
    const next = clamp(number);
    onChange(unit ? `${next}${unit}` : String(next));
  }, [clamp, onChange, unit]);

  const onPrefixPointerDown = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startValue = Number(display) || 0;
    const ownerDocument = prefixRef.current?.ownerDocument ?? document;
    const onMove = (moveEvent: PointerEvent) => {
      const raw = Math.round((moveEvent.clientX - startX) / 3);
      const multiplier = moveEvent.shiftKey ? 5 : 1;
      if (raw !== 0) commit(startValue + raw * step * multiplier);
    };
    const onUp = () => {
      ownerDocument.removeEventListener('pointermove', onMove);
      ownerDocument.removeEventListener('pointerup', onUp);
      ownerDocument.removeEventListener('pointercancel', onUp);
    };
    ownerDocument.addEventListener('pointermove', onMove);
    ownerDocument.addEventListener('pointerup', onUp);
    ownerDocument.addEventListener('pointercancel', onUp);
  }, [commit, display, step]);

  return (
    <label className={styles.numberField}>
      {prefix ? (
        <span
          ref={prefixRef}
          className={styles.fieldPrefix}
          title={`${label}，拖拽调整`}
          data-tooltip={`${label}，拖拽调整`}
          onPointerDown={onPrefixPointerDown}
        >
          {prefix}
        </span>
      ) : null}
      <input
        type="number"
        className={styles.numberInput}
        aria-label={label}
        value={display}
        step={step}
        min={min}
        max={max}
        onChange={(event) => {
          const number = Number(event.target.value);
          if (Number.isFinite(number)) commit(number);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const direction = event.key === 'ArrowUp' ? 1 : -1;
          commit((Number(display) || 0) + direction * step * (event.shiftKey ? 5 : 1));
        }}
      />
      {unit ? <span className={styles.fieldUnit}>{unit}</span> : null}
    </label>
  );
}

function CompactSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.selectField}>
      <span className={styles.visuallyHidden}>{label}</span>
      <select
        className={styles.select}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * Interactive crop editor for image fill (裁剪). Renders a fixed viewport
 * showing the image; the user drags the image to pan and resizes a crop box
 * (8 handles, Shift = lock aspect ratio) to choose which region is visible.
 * The crop is committed as real CSS: background-size = natural size scaled by
 * the chosen zoom, background-position = negative offset so the cropped region
 * pins to the element's top-left, with the element's own overflow:hidden doing
 * the clipping.
 *
 * Props:
 *  - url: image data URL
 *  - bgSize: current background-size CSS (px or keyword) for read-back
 *  - bgPosition: current background-position CSS
 *  - onChange(cssSize, cssPosition): commit the crop as CSS values
 */
const CROP_VIEWPORT_W = 220;
const CROP_VIEWPORT_H = 150;

/**
 * Simplified crop editor: the viewport stands in for the element box. The user
 * drags the image to pan (choose which region is visible) and uses the zoom
 * slider to enlarge/shrink the displayed area. The result maps directly to the
 * element's CSS background-size + background-position; the element's own box
 * (with overflow hidden) does the clipping.
 *
 * Mapping: the image is drawn at natural size * zoom. The drag sets the
 * top-left offset of the image relative to the viewport. We translate that into
 * background-position in PX (negative offset = image shifted so a later region
 * shows), and background-size = scaled natural size in PX. Because the element
 * keeps its own width/height + overflow hidden, only the visible region shows.
 */
function CropEditor({
  url,
  onChange,
}: {
  url: string;
  bgSize: string;
  bgPosition: string;
  onChange: (cssSize: string, cssPosition: string) => void;
}) {
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  // zoom = display px per source px
  const [zoom, setZoom] = useState(1);
  // pan = top-left offset of the image layer inside the viewport (px)
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

  // Load the image, fit it to cover the viewport, and center it as the start.
  useEffect(() => {
    if (!url) return;
    const img = ownerDocument.createElement('img');
    img.onload = () => {
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      setNatural({ w: nw, h: nh });
      // cover the viewport so there's something to pan into view
      const coverZoom = Math.max(CROP_VIEWPORT_W / nw, CROP_VIEWPORT_H / nh);
      setZoom(coverZoom);
      const dw = nw * coverZoom;
      const dh = nh * coverZoom;
      const initPan = { x: (CROP_VIEWPORT_W - dw) / 2, y: (CROP_VIEWPORT_H - dh) / 2 };
      setPan(initPan);
      emit(coverZoom, initPan);
    };
    img.src = url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const onViewportPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      const move = (me: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const next = { x: d.panX + (me.clientX - d.startX), y: d.panY + (me.clientY - d.startY) };
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
    [pan.x, pan.y, zoom, emit],
  );

  const onZoom = (nextZoom: number) => {
    // Zoom around the viewport centre so the visible region stays put.
    const z = Math.max(0.1, Math.min(8, nextZoom));
    const cx = CROP_VIEWPORT_W / 2;
    const cy = CROP_VIEWPORT_H / 2;
    // image point under centre before zoom
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
/**
 * Image fill control: a preview area (thumbnail when a URL is set, placeholder
 * otherwise) with a "点击上传图片" hover overlay. Clicking opens a hidden
 * file picker; selecting an image reads it into a data URL and calls
 * onUrlChange. Mirrors the editor panel's visual language (panel tokens,
 * 3px radius, 26px control height for the size/repeat selects below).
 */
function ImageFillControl({
  url,
  size,
  repeat,
  onUrlChange,
  onSizeChange,
  onRepeatChange,
  onCrop,
  onCropModeChange,
}: {
  url: string;
  size: string;
  repeat: string;
  onUrlChange: (url: string) => void;
  onSizeChange: (size: string) => void;
  onRepeatChange: (repeat: string) => void;
  /** Commit a crop as CSS background-size + background-position. */
  onCrop?: (cssSize: string, cssPosition: string) => void;
  /** Notify the host that 裁剪 mode turned on/off so it can toggle the
   *  canvas drag-to-pan / wheel-to-scale handlers. */
  onCropModeChange?: (on: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The preview tile shows the whole image (contain) regardless of the
  // element's chosen background-size, so the user always sees what they set.
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

  // Toggle canvas 裁剪 mode (drag-to-pan / wheel-to-scale on the selected
  // element) whenever the size option flips to/from 裁剪. The actual editing
  // happens on the canvas; the panel only shows a hint.
  useEffect(() => {
    onCropModeChange?.(showCrop);
    return () => onCropModeChange?.(false);
  }, [showCrop, onCropModeChange]);

  return (
    <div className={styles.imageFillSection}>
      {showCrop ? (
        <p className={styles.cropHint}>在画布上拖动选中元素可平移背景图，滚轮缩放背景图大小</p>
      ) : (
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
              // Reset so picking the same file twice still fires change.
              event.target.value = '';
            }}
          />
        </button>
      )}
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

function PropertySection({
  title,
  actions,
  children,
  collapsible = false,
  expanded = true,
  hasContent = true,
  onToggle,
  onAdd,
  onRemove,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  expanded?: boolean;
  hasContent?: boolean;
  onToggle?: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
}) {
  // When a collapsible section has no content it is force-collapsed: the body
  // is hidden, the chevron is suppressed (there's nothing to expand), and the
  // header click triggers onAdd so the user must add a value before the body
  // becomes available.
  const isEmpty = collapsible && !hasContent;
  const sectionClass = `${styles.section}${collapsible ? ` ${styles.sectionCollapsible}` : ''}${(collapsible && !expanded) || isEmpty ? ` ${styles.sectionCollapsed}` : ''}`;
  const headerClass = `${styles.sectionHeader}${collapsible ? ` ${styles.sectionHeaderToggle}` : ''}`;
  const showBody = collapsible ? (!isEmpty && expanded) : true;
  return (
    <section className={sectionClass} aria-labelledby={`style-panel-${title}`}>
      <header className={headerClass}>
        {collapsible ? (
          <button
            type="button"
            className={styles.sectionTitleButton}
            aria-expanded={!isEmpty && expanded}
            aria-controls={`style-panel-body-${title}`}
            onClick={() => (isEmpty ? onAdd?.() : onToggle?.())}
          >
            {!isEmpty ? (
              <ChevronDown
                size={14}
                strokeWidth={1.8}
                aria-hidden="true"
                className={`${styles.sectionChevron}${expanded ? ` ${styles.sectionChevronExpanded}` : ''}`}
              />
            ) : null}
            <span id={`style-panel-${title}`} className={styles.sectionTitle}>{title}</span>
          </button>
        ) : (
          <h3 id={`style-panel-${title}`} className={styles.sectionTitle}>{title}</h3>
        )}
        <div className={styles.sectionActions}>
          {actions}
          {isEmpty && onAdd ? (
            <IconButton
              label="添加属性"
              icon={Plus}
              placement="left"
              onClick={() => onAdd()}
            />
          ) : null}
          {!isEmpty && hasContent && onRemove ? (
            <IconButton
              label="移除属性"
              icon={Minus}
              placement="left"
              onClick={() => onRemove()}
            />
          ) : null}
        </div>
      </header>
      {showBody ? (
        <div id={`style-panel-body-${title}`} className={styles.sectionBody}>{children}</div>
      ) : null}
    </section>
  );
}

function LabeledControl({
  label,
  children,
  inline = false,
}: {
  label: string;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={inline ? styles.labeledControlInline : styles.labeledControl}>
      <span className={styles.controlLabel}>{label}</span>
      {children}
    </div>
  );
}

function DimensionControl({
  axis,
  value,
  tagName,
  modeOverride,
  onValueChange,
  onModeChange,
}: {
  axis: '宽' | '高';
  value: string;
  tagName?: string;
  modeOverride?: DimensionMode | null;
  onValueChange: (value: string) => void;
  onModeChange: (mode: DimensionMode) => void;
}) {
  // Prefer the explicit override (set when the user picks a mode) over the
  // computed-style derivation, which resolves hug/fill to px and would snap
  // the dropdown back to 固定.
  const effectiveMode = modeOverride ?? dimensionMode(value, tagName);
  return (
    <div className={styles.dimensionControl}>
      <NumberScrub label={axis} prefix={axis === '宽' ? 'W' : 'H'} value={value} unit="px" min={0} onChange={onValueChange} />
      <CompactSelect
        label={`${axis}调整模式`}
        value={effectiveMode}
        options={[
          { value: 'fixed', label: '固定' },
          { value: 'hug', label: '撑满' },
          { value: 'fill', label: '填充' },
        ]}
        onChange={(mode) => onModeChange(mode as DimensionMode)}
      />
    </div>
  );
}

function AlignmentGrid({
  flow,
  justifyContent,
  alignItems,
  onChange,
}: {
  flow: FlowValue;
  justifyContent: string;
  alignItems: string;
  onChange: (column: 0 | 1 | 2, row: 0 | 1 | 2) => void;
}) {
  const verticalFlow = flow === 'column';
  const activeColumn = verticalFlow ? axisAlignment(alignItems) : axisAlignment(justifyContent);
  const activeRow = verticalFlow ? axisAlignment(justifyContent) : axisAlignment(alignItems);

  return (
    <div className={styles.alignmentGrid} role="group" aria-label="自动布局对齐">
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((column) => {
          const label = `${['左', '中', '右'][column]}${['上', '中', '下'][row]}对齐`;
          const active = activeColumn === column && activeRow === row;
          return (
            <button
              key={`${column}-${row}`}
              type="button"
              className={`${styles.alignmentCell}${active ? ` ${styles.alignmentCellActive}` : ''}`}
              aria-label={label}
              aria-pressed={active}
              title={label}
              data-tooltip={label}
              onClick={() => onChange(column as 0 | 1 | 2, row as 0 | 1 | 2)}
            >
              <span />
            </button>
          );
        }),
      )}
    </div>
  );
}

/**
 * Editable colour text input that accepts hand-typed hex / rgb / rgba / hsl.
 * Maintains a local text buffer so the user can type intermediate (invalid)
 * states without each keystroke being rejected; only valid colour strings are
 * pushed to `onChange`. On blur the buffer is normalised back to the canonical
 * CSS form derived from the parsed value, so the field always lands on a
 * legal colour. Reused across every colour field (fill / text / stroke /
 * shadow / batch-replace) so manual typing works everywhere, not just in the
 * floating ColorEditor.
 */
function ColorTextInput({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (css: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  // Display the canonical hex (without leading #) when the external value is
  // the source of truth — i.e. on mount and after external updates the user
  // didn't just type. A non-empty local buffer takes precedence so the user's
  // in-progress typing isn't clobbered.
  const displayHex = cssColorToHex(value).replace('#', '');
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    // Reset the local buffer whenever the external value changes from outside
    // (picker drag, undo, selection switch) so the field resyncs.
    setLocal(null);
  }, [value]);

  const fieldValue = local ?? displayHex;

  return (
    <input
      type="text"
      className={className ?? styles.hexInput}
      aria-label={ariaLabel}
      value={fieldValue}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => {
        const raw = event.target.value;
        setLocal(raw);
        const normalised = normalizeTypedCssColor(raw);
        if (normalised) onChange(normalised);
      }}
      onBlur={() => {
        if (local == null) return;
        const normalised = normalizeTypedCssColor(local);
        if (normalised) onChange(normalised);
        setLocal(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          (event.currentTarget as HTMLInputElement).blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setLocal(null);
          (event.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function ColorProperty({
  label,
  value,
  visible,
  onChange,
  onVisibleChange,
  onOpenPicker,
}: {
  label: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onVisibleChange: (visible: boolean) => void;
  onOpenPicker?: (anchor: HTMLButtonElement) => void;
}) {
  const hex = cssColorToHex(value);
  return (
    <div className={styles.colorProperty}>
      <label className={styles.colorValue}>
        <span className={styles.visuallyHidden}>{label}</span>
        <button
          type="button"
          className={styles.colorPicker}
          aria-label={`${label}取色器`}
          title={`编辑${label}`}
          data-tooltip={`编辑${label}`}
          style={{ '--swatch-color': hex } as CSSProperties}
          onClick={(event) => onOpenPicker?.(event.currentTarget)}
        />
        <ColorTextInput
          value={value}
          onChange={onChange}
          ariaLabel={`${label}颜色值`}
        />
        <span className={styles.colorOpacity}>{Math.round(parseCssColor(value).a * 100)}</span>
        <span className={styles.percent}>%</span>
      </label>
      <IconButton
        label={visible ? `隐藏${label}` : `显示${label}`}
        icon={visible ? Eye : EyeOff}
        active={visible}
        placement="left"
        onClick={() => onVisibleChange(!visible)}
      />
    </div>
  );
}

function SelectedColor({
  color,
  batchMode,
  selected,
  onToggle,
  onOpenPicker,
  onColorChange,
}: {
  color: string;
  batchMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpenPicker: (anchor: HTMLButtonElement) => void;
  onColorChange?: (value: string) => void;
}) {
  return (
    <div className={`${styles.selectedColor}${batchMode ? ` ${styles.selectedColorBatch}` : ''}`}>
      {batchMode ? (
        <input type="checkbox" aria-label={`选择颜色 ${cssColorToHex(color)}`} checked={selected} onChange={onToggle} />
      ) : null}
      <button
        type="button"
        className={styles.selectedSwatch}
        style={{ '--swatch-color': color } as CSSProperties}
        aria-label={`编辑颜色 ${cssColorToHex(color)}`}
        title={`编辑颜色 ${cssColorToHex(color)}`}
        onClick={(event) => onOpenPicker(event.currentTarget)}
      />
      <ColorTextInput
        value={color}
        onChange={(value) => onColorChange?.(value)}
        className={styles.selectedHex}
        ariaLabel={`颜色值 ${cssColorToHex(color)}`}
      />
      <span className={styles.selectedOpacity}>{Math.round((parseCssColor(color).a) * 100)}</span>
      <span className={styles.percent}>%</span>
    </div>
  );
}

export function StylePanel({ editorRef, selection, imageEditSignal }: StylePanelProps) {
  const hasSelection = !!selection?.hasSelection;
  const selectedStyles = selection?.styles ?? {};
  const [canvasStyles, setCanvasStyles] = useState<StyleMap>({});
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [paddingLinked, setPaddingLinked] = useState(true);
  const [marginLinked, setMarginLinked] = useState(true);
  const [cornersExpanded, setCornersExpanded] = useState(false);
  const [strokeSidesExpanded, setStrokeSidesExpanded] = useState(true);
  // Collapsible section state. Each defaults to true (expanded); the section
  // body shows/hides based on these. hasContent drives the +/- disabled state
  // and is recomputed each render from the live styles.
  const [fillExpanded, setFillExpanded] = useState(true);
  const [strokeExpanded, setStrokeExpanded] = useState(true);
  const [effectExpanded, setEffectExpanded] = useState(true);
  // When the selection is an <img>, this holds its current src attribute so
  // the fill section's image tab can preview/replace it. Refreshed on every
  // selection change + after a paste/upload writes a new src.
  const [selectedImgSrc, setSelectedImgSrc] = useState<string>('');
  // Explicit width/height dimension mode so the dropdown keeps the user's
  // selection even though getComputedStyle resolves hug/fill values to px.
  // Root of the StylePanel DOM; used to anchor the floating fill editor
  // when the user double-clicks an <img> in the canvas.
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const [widthMode, setWidthMode] = useState<DimensionMode | null>(null);
  const [heightMode, setHeightMode] = useState<DimensionMode | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelection, setBatchSelection] = useState<string[]>([]);
  const [replacementColor, setReplacementColor] = useState('#0D66D0');
  // Tracks the current target colour during an "已选颜色" replace-drag. Each
  // SV/hue/alpha commit re-targets replaceColors at the colour the previous
  // tick just wrote, so a continuous drag keeps updating instead of stalling
  // after the first commit (which would otherwise keep matching the original
  // colour that no longer exists on the element).
  const replaceTargetRef = useRef<string | null>(null);
  const [effectType, setEffectType] = useState<EffectType>('drop-shadow');
  const [colorEditor, setColorEditor] = useState<ColorEditorState | null>(null);
  const [strokePanelPosition, setStrokePanelPosition] = useState<FloatingPosition | null>(null);
  const [effectPanelPosition, setEffectPanelPosition] = useState<FloatingPosition | null>(null);
  const [strokeSettingsTab, setStrokeSettingsTab] = useState<'basic' | 'dynamic' | 'brush'>('basic');
  const [strokePosition, setStrokePosition] = useState<'inside' | 'center' | 'outside'>('center');
  const [strokeLinecap, setStrokeLinecap] = useState<'butt' | 'round' | 'square'>('butt');
  const [strokeLinejoin, setStrokeLinejoin] = useState<'miter' | 'round' | 'bevel'>('miter');
  const [strokeDashLength, setStrokeDashLength] = useState('0px');
  const [strokeDashGap, setStrokeDashGap] = useState('0px');
  const [shadowDraft, setShadowDraft] = useState({
    x: '0px',
    y: '4px',
    blur: '4px',
    spread: '0px',
    color: '#000000',
    opacity: '25%',
    inset: false,
  });
  const previousFill = useRef('#FFFFFF');
  const previousCanvasBackground = useRef('#FFFFFF');
  const previousStroke = useRef('#000000');
  const previousShadow = useRef('0 4px 12px rgba(0, 0, 0, 0.18)');

  const refreshCanvas = useCallback(() => {
    const state = editorRef.current?.getCanvasState?.();
    const stylesSnapshot = state?.styles ?? editorRef.current?.getCanvasStyles() ?? {};
    setCanvasStyles(stylesSnapshot);
    const size = state?.size;
    if (size) {
      setCanvasSize(size);
      return size.width > 0 && size.height > 0;
    }
    return false;
  }, [editorRef]);

  useEffect(() => {
    if (hasSelection) return undefined;
    let cancelled = false;
    let timeout: number | null = null;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      const ready = refreshCanvas();
      attempts += 1;
      if (!ready && attempts < 100) {
        timeout = window.setTimeout(tick, 50);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timeout != null) window.clearTimeout(timeout);
    };
  }, [hasSelection, refreshCanvas]);

  useEffect(() => {
    const bg = canvasStyles.backgroundColor;
    if (bg && !isTransparent(bg)) previousCanvasBackground.current = cssColorToHex(bg);
  }, [canvasStyles.backgroundColor]);

  const apply = useCallback(
    (nextStyles: StyleMap) => {
      const kebab: StyleMap = {};
      for (const [key, value] of Object.entries(nextStyles)) {
        kebab[key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)] = value;
      }
      if (hasSelection) {
        editorRef.current?.applyStyle(kebab);
        return;
      }
      editorRef.current?.setCanvasStyles(kebab);
      window.setTimeout(refreshCanvas, 0);
    },
    [editorRef, hasSelection, refreshCanvas],
  );

  // Whenever shadowDraft changes, build the box-shadow CSS and apply it.
  const updateShadowDraft = useCallback(
    (patch: Partial<typeof shadowDraft>) => {
      setShadowDraft((prev) => {
        const next = { ...prev, ...patch };
        apply({ boxShadow: buildSingleShadow(next) });
        return next;
      });
    },
    [apply],
  );

  const gradientFill = isGradient(selectedStyles.backgroundImage);
  const [fillMode, setFillMode] = useState<'solid' | 'gradient' | 'image'>(
    gradientFill ? 'gradient' : (selectedStyles.backgroundImage && selectedStyles.backgroundImage !== 'none' && !gradientFill ? 'image' : 'solid')
  );
  const [gradient, setGradient] = useState<GradientValue>(() =>
    gradientFill && selectedStyles.backgroundImage
      ? parseGradientCss(selectedStyles.backgroundImage) ?? createDefaultGradient()
      : createDefaultGradient(),
  );
  useEffect(() => {
    setFillMode(isGradient(selectedStyles.backgroundImage) ? 'gradient' : (selectedStyles.backgroundImage && selectedStyles.backgroundImage !== 'none' && !isGradient(selectedStyles.backgroundImage) ? 'image' : 'solid'));
    if (selectedStyles.backgroundImage && isGradient(selectedStyles.backgroundImage)) {
      const parsed = parseGradientCss(selectedStyles.backgroundImage);
      if (parsed) setGradient(parsed);
    }
  }, [selectedStyles.backgroundImage]);
  const onGradientChange = useCallback(
    (nextGradient: GradientValue) => {
      setGradient(nextGradient);
      apply({ backgroundImage: gradientToCss(nextGradient), backgroundColor: '' });
    },
    [apply],
  );

  const applyCanvasSize = useCallback(
    (width?: number, height?: number) => {
      editorRef.current?.setCanvasSize(
        typeof width === 'number' && width > 0 ? width : undefined,
        typeof height === 'number' && height > 0 ? height : undefined,
      );
      window.setTimeout(refreshCanvas, 0);
    },
    [editorRef, refreshCanvas],
  );

  const openColorEditor = useCallback(
    (
      label: string,
      value: string,
      onChange: (value: string) => void,
      anchor: HTMLElement,
      fill?: ColorEditorState['fill'],
    ) => {
      setColorEditor({
        label,
        value,
        onChange,
        position: popoverPosition(anchor, 260, 360, 320),
        fill,
      });
    },
    [],
  );

  const style = selectedStyles;

  // Whether the current selection is an <img>. Computed up here (before the
  // image-edit effect) so the effect and the fill section both see it.
  const isImgElement = (selection?.tagName ?? '').toLowerCase() === 'img';

  // Respond to a double-click-on-<img> request: open the floating fill
  // editor with the image tab selected so the user uploads a replacement
  // image. For <img> the upload writes src; for other elements it writes a
  // background-image fill.
  const lastImageEditSignalRef = useRef(imageEditSignal ?? 0);
  useEffect(() => {
    if ((imageEditSignal ?? 0) === lastImageEditSignalRef.current) return;
    lastImageEditSignalRef.current = imageEditSignal ?? 0;
    if (!hasSelection) return;
    setFillMode('image');
    setFillExpanded(true);
    // Anchor the floating panel on the panel root (the fill swatch may not be
    // mounted in image mode, so the root is the stable anchor).
    const anchor = panelRootRef.current;
    if (!anchor) return;
    const currentSrc = editorRef.current?.getSelectedSrc() ?? '';
    openColorEditor(
      '填充',
      currentSrc,
      (value) => {
        if (isImgElement) {
          editorRef.current?.setSelectedSrc(value);
          setSelectedImgSrc(value);
        } else {
          apply({ backgroundImage: value ? `url("${value}")` : 'none', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' });
        }
      },
      anchor,
      {
        mode: 'image',
        onModeChange: (nextMode) => {
          setFillMode(nextMode);
          setColorEditor((current) => current && current.fill
            ? { ...current, fill: { ...current.fill, mode: nextMode } }
            : current);
          if (nextMode === 'solid') {
            apply({ backgroundImage: 'none', backgroundColor: previousFill.current });
          } else if (nextMode === 'gradient') {
            apply({ backgroundImage: gradientToCss(gradient), backgroundColor: '' });
          }
        },
        gradient,
        onGradientChange,
        imageState: {
          url: isImgElement
            ? currentSrc
            : (selectedStyles.backgroundImage?.replace(/^url\(['"]?|['"]?\)$/g, '') ?? ''),
          size: optionFromBgSize(selectedStyles.backgroundSize ?? 'cover'),
          repeat: selectedStyles.backgroundRepeat ?? 'no-repeat',
          position: selectedStyles.backgroundPosition ?? 'center',
        },
        onImageChange: (patch) => {
          if (isImgElement) {
            if (patch.url !== undefined) {
              const nextUrl = patch.url;
              editorRef.current?.setSelectedSrc(nextUrl);
              setSelectedImgSrc(nextUrl);
              setColorEditor((cur) => cur && cur.fill ? { ...cur, fill: { ...cur.fill, imageState: { ...cur.fill.imageState, url: nextUrl } } } : cur);
            }
          } else {
            const url = patch.url !== undefined ? patch.url : (selectedStyles.backgroundImage?.replace(/^url\(['"]?|['"]?\)$/g, '') ?? '');
            const size = patch.size !== undefined ? bgSizeFromOption(patch.size) : (selectedStyles.backgroundSize ?? 'cover');
            const repeat = patch.repeat !== undefined ? patch.repeat : (selectedStyles.backgroundRepeat ?? 'no-repeat');
            const position = patch.position !== undefined ? patch.position : (selectedStyles.backgroundPosition ?? 'center');
            if (url) {
              apply({ backgroundImage: `url("${url}")`, backgroundSize: size, backgroundPosition: position, backgroundRepeat: repeat });
            } else {
              apply({ backgroundImage: 'none' });
            }
          }
        },
      },
    );
  }, [imageEditSignal, hasSelection, isImgElement, selectedStyles, gradient, apply, openColorEditor, editorRef]);

  // Keep the previewed <img> src in sync whenever the selection changes.
  useEffect(() => {
    setSelectedImgSrc(isImgElement ? (editorRef.current?.getSelectedSrc() ?? '') : '');
    // Clear the explicit dimension-mode override so a new element starts
    // from its computed style.
    setWidthMode(null);
    setHeightMode(null);
  }, [editorRef, isImgElement, selection]);

  // Colors used by the selection's whole subtree (background/border/text),
  // collected recursively so multi-selecting a flex container surfaces the
  // colors of every descendant. Declared before the no-selection early
  // return so the hook order stays stable across selected/unselected renders.
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  useEffect(() => {
    if (!hasSelection) { setSelectedColors([]); return; }
    setSelectedColors(editorRef.current?.collectColorsFromSelection() ?? []);
  }, [editorRef, hasSelection, selection]);

  const colorEditorPortal = colorEditor ? (
    <FloatingPanel
      title={colorEditor.label}
      position={colorEditor.position}
      onClose={() => {
        setColorEditor(null);
        // Re-assert the canvas selection so the resize handles redraw after
        // the floating editor closes (closing via click-outside or the X
        // button can otherwise leave the handles stale).
        window.setTimeout(() => editorRef.current?.reselectCurrent(), 0);
      }}
    >
      <ColorEditor
        label={colorEditor.label}
        value={colorEditor.value}
        onChange={(value) => {
          setColorEditor((current) => current ? { ...current, value } : current);
          colorEditor.onChange(value);
        }}
        supportsFillModes={!!colorEditor.fill}
        mode={colorEditor.fill?.mode}
        onModeChange={colorEditor.fill?.onModeChange}
        gradient={colorEditor.fill?.gradient}
        onGradientChange={colorEditor.fill?.onGradientChange}
        imageState={colorEditor.fill?.imageState}
        onImageChange={colorEditor.fill?.onImageChange}
        onCropModeToggle={(on) => editorRef.current?.setCropMode(on)}
      />
    </FloatingPanel>
  ) : null;

  if (!hasSelection) {
    const canvasBackgroundVisible = !isTransparent(canvasStyles.backgroundColor);
    const canvasBackgroundValue = canvasBackgroundVisible
      ? (canvasStyles.backgroundColor ?? previousCanvasBackground.current)
      : previousCanvasBackground.current;
    return (
      <div className={styles.root} data-testid="grapesjs-style-panel">
        <div className={styles.elementHeader}>
          <Frame size={14} strokeWidth={1.8} aria-hidden="true" />
          <strong>画板</strong>
        </div>
        <PropertySection title="尺寸">
          <div className={styles.twoColumn}>
            <NumberScrub
              label="画板宽度"
              prefix="W"
              value={`${canvasSize.width}px`}
              unit="px"
              min={0}
              onChange={(value) => applyCanvasSize(pxToNum(value))}
            />
            <NumberScrub
              label="画板高度"
              prefix="H"
              value={`${canvasSize.height}px`}
              unit="px"
              min={0}
              onChange={(value) => applyCanvasSize(undefined, pxToNum(value))}
            />
          </div>
        </PropertySection>
        <PropertySection title="HTML 外观">
          <ColorProperty
            label="HTML 背景"
            value={canvasBackgroundValue}
            visible={canvasBackgroundVisible}
            onChange={(value) => apply({ backgroundColor: value })}
            onVisibleChange={(visible) => apply({ backgroundColor: visible ? previousCanvasBackground.current : 'transparent' })}
            onOpenPicker={(anchor) => openColorEditor(
              'HTML 背景',
              canvasBackgroundValue,
              (value) => apply({ backgroundColor: value }),
              anchor,
            )}
          />
        </PropertySection>
        <PropertySection title="文字">
          <div className={styles.stack}>
            <CompactSelect
              label="字体"
              value={canvasStyles.fontFamily ?? ''}
              options={FONT_FAMILY_OPTIONS}
              onChange={(value) => apply({ fontFamily: value })}
            />
            <NumberScrub
              label="字号"
              prefix={<Type size={13} aria-hidden="true" />}
              value={canvasStyles.fontSize ?? '16px'}
              unit="px"
              min={8}
              onChange={(value) => apply({ fontSize: value })}
            />
          </div>
        </PropertySection>
        {colorEditorPortal}
      </div>
    );
  }

  const flow = flowFromStyles(style);
  const reverseFlow = (style.flexDirection ?? '').endsWith('reverse');
  // A fill counts as "has content" when there's a background color, a
  // gradient, OR a background image (url). The url case matters for pasted
  // screenshot divs and <img>-replaced fills, otherwise the panel stays
  // force-collapsed with only the + button.
  const hasBackgroundImage = !!style.backgroundImage && style.backgroundImage !== 'none';
  const fillVisible = !isTransparent(style.backgroundColor) || isGradient(style.backgroundImage) || hasBackgroundImage;
  const strokeVisible = pxToNum(style.borderTopWidth) > 0 && style.borderStyle !== 'none';
  const effectVisible = !!style.boxShadow && style.boxShadow !== 'none';
  const rotation = parseRotation(style.transform);
  const isTextElement = TEXT_TAGS.has((selection?.tagName ?? '').toLowerCase());
  // selectedColors is declared above (before the no-selection early return)
  // so the hook order stays stable across selected/unselected renders.

  const setFlow = (nextFlow: FlowValue) => {
    if (nextFlow === 'free') {
      apply({ display: 'block', flexDirection: 'row', flexWrap: 'nowrap' });
      return;
    }
    if (nextFlow === 'column') {
      apply({ display: 'flex', flexDirection: 'column', flexWrap: 'nowrap' });
      return;
    }
    if (nextFlow === 'wrap') {
      apply({ display: 'flex', flexDirection: 'row', flexWrap: 'wrap' });
      return;
    }
    apply({ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' });
  };

  const setDimensionMode = (property: 'width' | 'height', mode: DimensionMode) => {
    const isImg = (selection?.tagName ?? '').toLowerCase() === 'img';
    if (mode === 'hug') {
      // <img> and other replaced elements resolve fit-content to a pixel
      // length via getComputedStyle, so the hug state would read back as
      // "fixed". auto round-trips for replaced elements and yields the
      // intrinsic size the user expects from "适应".
      apply({ [property]: isImg ? 'auto' : 'fit-content' });
      return;
    }
    if (mode === 'fill') {
      apply({ [property]: '100%' });
      return;
    }
    const current = pxToNum(style[property], property === 'width' ? 100 : 40);
    apply({ [property]: `${Math.max(1, current)}px` });
  };

  const setAlignment = (column: 0 | 1 | 2, row: 0 | 1 | 2) => {
    const axisValues = ['flex-start', 'center', 'flex-end'];
    const horizontal = axisValues[column] ?? 'flex-start';
    const vertical = axisValues[row] ?? 'flex-start';
    if (flow === 'column') {
      apply({ alignItems: horizontal, justifyContent: vertical });
      return;
    }
    apply({
      display: flow === 'free' ? 'flex' : style.display ?? 'flex',
      flexDirection: flow === 'free' ? 'row' : style.flexDirection ?? 'row',
      justifyContent: horizontal,
      alignItems: vertical,
    });
  };

  return (
    <div ref={panelRootRef} className={styles.root} data-testid="grapesjs-style-panel">
      <div className={styles.elementHeader}>
        <strong>{selection?.tagName.toUpperCase()}</strong>
        <code className={styles.selector}>{selection?.selector}</code>
      </div>

      <PropertySection title="位置">
        <LabeledControl label="对齐">
          <IconGroup
            options={POSITION_ALIGN_OPTIONS}
            value=""
            onChange={(value) => {
              if (value === 'start-horizontal') apply({ justifySelf: 'start' });
              if (value === 'center-horizontal') apply({ justifySelf: 'center' });
              if (value === 'end-horizontal') apply({ justifySelf: 'end' });
              if (value === 'start-vertical') apply({ alignSelf: 'flex-start' });
              if (value === 'center-vertical') apply({ alignSelf: 'center' });
              if (value === 'end-vertical') apply({ alignSelf: 'flex-end' });
            }}
          />
        </LabeledControl>
        <LabeledControl label="定位">
          <div className={styles.twoColumn}>
            <CompactSelect
              label="定位方式"
              value={style.position ?? 'static'}
              options={POSITION_OPTIONS}
              onChange={(value) => apply({ position: value })}
            />
            <div className={styles.emptyControl} aria-hidden="true" />
            <NumberScrub
              label="X 坐标"
              prefix="X"
              value={style.left === 'auto' ? '0px' : style.left ?? '0px'}
              unit="px"
              onChange={(value) => apply({
                position: style.position === 'static' ? 'relative' : style.position ?? 'relative',
                left: value,
              })}
            />
            <NumberScrub
              label="Y 坐标"
              prefix="Y"
              value={style.top === 'auto' ? '0px' : style.top ?? '0px'}
              unit="px"
              onChange={(value) => apply({
                position: style.position === 'static' ? 'relative' : style.position ?? 'relative',
                top: value,
              })}
            />
          </div>
        </LabeledControl>
        <LabeledControl label="外间距">
          <div className={styles.paddingRow}>
            {marginLinked ? (
              <div className={styles.twoColumn}>
                {(() => {
                  const left = style.marginLeft ?? '0px';
                  const right = style.marginRight ?? '0px';
                  const equal = fieldDisplay(left) === fieldDisplay(right);
                  return equal ? (
                    <NumberScrub
                      label="水平外间距"
                      prefix="↔"
                      value={left}
                      unit="px"
                      onChange={(value) => apply({ marginLeft: value, marginRight: value })}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.paddingCompoundField}
                      title="左右外间距不同，点击展开分别设置"
                      data-tooltip="左右外间距不同，点击展开分别设置"
                      onClick={() => setMarginLinked(false)}
                    >
                      <span aria-hidden="true">↔</span>
                      <span>{fieldDisplay(left)}, {fieldDisplay(right)}</span>
                    </button>
                  );
                })()}
                {(() => {
                  const top = style.marginTop ?? '0px';
                  const bottom = style.marginBottom ?? '0px';
                  const equal = fieldDisplay(top) === fieldDisplay(bottom);
                  return equal ? (
                    <NumberScrub
                      label="垂直外间距"
                      prefix="↕"
                      value={top}
                      unit="px"
                      onChange={(value) => apply({ marginTop: value, marginBottom: value })}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.paddingCompoundField}
                      title="上下外间距不同，点击展开分别设置"
                      data-tooltip="上下外间距不同，点击展开分别设置"
                      onClick={() => setMarginLinked(false)}
                    >
                      <span aria-hidden="true">↕</span>
                      <span>{fieldDisplay(top)}, {fieldDisplay(bottom)}</span>
                    </button>
                  );
                })()}
              </div>
            ) : (
              <div className={styles.fourColumn}>
                <NumberScrub label="左外间距" prefix="左" value={style.marginLeft ?? '0px'} unit="px" onChange={(value) => apply({ marginLeft: value })} />
                <NumberScrub label="上外间距" prefix="上" value={style.marginTop ?? '0px'} unit="px" onChange={(value) => apply({ marginTop: value })} />
                <NumberScrub label="右外间距" prefix="右" value={style.marginRight ?? '0px'} unit="px" onChange={(value) => apply({ marginRight: value })} />
                <NumberScrub label="下外间距" prefix="下" value={style.marginBottom ?? '0px'} unit="px" onChange={(value) => apply({ marginBottom: value })} />
              </div>
            )}
            <IconButton
              label={marginLinked ? '分别设置四边外间距' : '联动水平和垂直外间距'}
              icon={marginLinked ? Unlink2 : Link2}
              active={!marginLinked}
              placement="left"
              onClick={() => setMarginLinked((linked) => !linked)}
            />
          </div>
        </LabeledControl>
        <LabeledControl label="旋转">
          <div className={styles.transformRow}>
            <NumberScrub
              label="旋转角度"
              prefix={<RotateCw size={13} aria-hidden="true" />}
              value={`${rotation}`}
              unit="°"
              step={1}
              onChange={(value) => apply({ transform: replaceRotation(style.transform, pxToNum(value)) })}
            />
            <IconButton
              label="水平翻转"
              icon={FlipHorizontal2}
              onClick={() => apply({ transform: `${style.transform === 'none' ? '' : style.transform ?? ''} scaleX(-1)`.trim() })}
            />
            <IconButton
              label="垂直翻转"
              icon={FlipVertical2}
              onClick={() => apply({ transform: `${style.transform === 'none' ? '' : style.transform ?? ''} scaleY(-1)`.trim() })}
            />
            <IconButton label="重置变换" icon={Undo2} placement="left" onClick={() => apply({ transform: 'none' })} />
          </div>
        </LabeledControl>
      </PropertySection>

      <PropertySection
        title="自动布局"
        actions={(
          <IconButton
            label="自动布局设置"
            icon={SlidersHorizontal}
            placement="left"
            onClick={() => setPaddingLinked((linked) => !linked)}
          />
        )}
      >
        <LabeledControl label="流向">
          <div className={styles.controlWithAction}>
            <IconGroup options={FLOW_OPTIONS} value={flow} onChange={(value) => setFlow(value as FlowValue)} />
            <IconButton
              label={reverseFlow ? '恢复正向排列' : '反向排列'}
              icon={Undo2}
              active={reverseFlow}
              disabled={flow === 'free' || flow === 'wrap'}
              placement="left"
              onClick={() => {
                if (flow === 'row') apply({ flexDirection: reverseFlow ? 'row' : 'row-reverse' });
                if (flow === 'column') apply({ flexDirection: reverseFlow ? 'column' : 'column-reverse' });
              }}
            />
            <IconButton
              label="两端对齐"
              icon={flow === 'column' ? AlignVerticalSpaceBetween : AlignHorizontalSpaceBetween}
              active={(style.justifyContent ?? '') === 'space-between'}
              disabled={flow === 'free' || flow === 'wrap'}
              placement="left"
              onClick={() => {
                const next = (style.justifyContent ?? '') === 'space-between' ? 'flex-start' : 'space-between';
                apply({ justifyContent: next });
              }}
            />
          </div>
        </LabeledControl>

        <LabeledControl label="调整大小">
          <div className={styles.twoColumn}>
            <DimensionControl
              axis="宽"
              value={style.width ?? 'auto'}
              tagName={selection?.tagName}
              modeOverride={widthMode}
              onValueChange={(value) => apply({ width: value })}
              onModeChange={(mode) => { setWidthMode(mode); setDimensionMode('width', mode); }}
            />
            <DimensionControl
              axis="高"
              value={style.height ?? 'auto'}
              tagName={selection?.tagName}
              modeOverride={heightMode}
              onValueChange={(value) => apply({ height: value })}
              onModeChange={(mode) => { setHeightMode(mode); setDimensionMode('height', mode); }}
            />
          </div>
        </LabeledControl>

        <div className={styles.alignmentLayout}>
          <LabeledControl label="对齐">
            <AlignmentGrid
              flow={flow}
              justifyContent={style.justifyContent ?? 'flex-start'}
              alignItems={style.alignItems ?? 'stretch'}
              onChange={setAlignment}
            />
          </LabeledControl>
          <div className={styles.spacingStack}>
            <LabeledControl label="间距">
              <NumberScrub
                label="项目间距"
                prefix="↔"
                value={style.gap ?? '0px'}
                unit="px"
                min={0}
                onChange={(value) => apply({ gap: value })}
              />
            </LabeledControl>
            <LabeledControl label="边距">
              <div className={styles.paddingRow}>
                {paddingLinked ? (
                  <div className={styles.twoColumn}>
                    {(() => {
                      // Collapsed horizontal: show a single editable value when
                      // left == right; otherwise show "left,right" as a
                      // read-only hint the user must expand to edit.
                      const left = style.paddingLeft ?? '0px';
                      const right = style.paddingRight ?? '0px';
                      const equal = fieldDisplay(left) === fieldDisplay(right);
                      return equal ? (
                        <NumberScrub
                          label="水平内边距"
                          prefix="↔"
                          value={left}
                          unit="px"
                          min={0}
                          onChange={(value) => apply({ paddingLeft: value, paddingRight: value })}
                        />
                      ) : (
                        <button
                          type="button"
                          className={styles.paddingCompoundField}
                          title="左右内边距不同，点击展开分别设置"
                          data-tooltip="左右内边距不同，点击展开分别设置"
                          onClick={() => setPaddingLinked(false)}
                        >
                          <span aria-hidden="true">↔</span>
                          <span>{fieldDisplay(left)}, {fieldDisplay(right)}</span>
                        </button>
                      );
                    })()}
                    {(() => {
                      const top = style.paddingTop ?? '0px';
                      const bottom = style.paddingBottom ?? '0px';
                      const equal = fieldDisplay(top) === fieldDisplay(bottom);
                      return equal ? (
                        <NumberScrub
                          label="垂直内边距"
                          prefix="↕"
                          value={top}
                          unit="px"
                          min={0}
                          onChange={(value) => apply({ paddingTop: value, paddingBottom: value })}
                        />
                      ) : (
                        <button
                          type="button"
                          className={styles.paddingCompoundField}
                          title="上下内边距不同，点击展开分别设置"
                          data-tooltip="上下内边距不同，点击展开分别设置"
                          onClick={() => setPaddingLinked(false)}
                        >
                          <span aria-hidden="true">↕</span>
                          <span>{fieldDisplay(top)}, {fieldDisplay(bottom)}</span>
                        </button>
                      );
                    })()}
                  </div>
                ) : (
                  <div className={styles.fourColumn}>
                    <NumberScrub label="左内边距" prefix="左" value={style.paddingLeft ?? '0px'} unit="px" min={0} onChange={(value) => apply({ paddingLeft: value })} />
                    <NumberScrub label="上内边距" prefix="上" value={style.paddingTop ?? '0px'} unit="px" min={0} onChange={(value) => apply({ paddingTop: value })} />
                    <NumberScrub label="右内边距" prefix="右" value={style.paddingRight ?? '0px'} unit="px" min={0} onChange={(value) => apply({ paddingRight: value })} />
                    <NumberScrub label="下内边距" prefix="下" value={style.paddingBottom ?? '0px'} unit="px" min={0} onChange={(value) => apply({ paddingBottom: value })} />
                  </div>
                )}
                <IconButton
                  label={paddingLinked ? '分别设置四边内边距' : '联动水平和垂直内边距'}
                  icon={paddingLinked ? Unlink2 : Link2}
                  active={!paddingLinked}
                  placement="left"
                  onClick={() => setPaddingLinked((linked) => !linked)}
                />
              </div>
            </LabeledControl>
          </div>
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={(style.overflow ?? 'visible') === 'hidden'}
            onChange={(event) => apply({ overflow: event.target.checked ? 'hidden' : 'visible' })}
          />
          <span>裁剪内容</span>
        </label>
      </PropertySection>

      {isTextElement ? (
        <PropertySection title="文字">
          <div className={styles.stack}>
            <CompactSelect
              label="字体"
              value={style.fontFamily ?? ''}
              options={FONT_FAMILY_OPTIONS}
              onChange={(value) => apply({ fontFamily: value })}
            />
            <div className={styles.twoColumn}>
              <NumberScrub label="字号" prefix="T" value={style.fontSize ?? '16px'} unit="px" min={1} onChange={(value) => apply({ fontSize: value })} />
              <CompactSelect label="字重" value={style.fontWeight ?? '400'} options={FONT_WEIGHT_OPTIONS} onChange={(value) => apply({ fontWeight: value })} />
              <NumberScrub label="行高" prefix="行" value={style.lineHeight ?? '1.5'} step={0.1} min={0} onChange={(value) => apply({ lineHeight: value })} />
              <NumberScrub label="字间距" prefix="字" value={style.letterSpacing ?? '0px'} unit="px" step={0.5} onChange={(value) => apply({ letterSpacing: value })} />
            </div>
            <LabeledControl label="对齐" inline>
              <IconGroup options={TEXT_ALIGN_OPTIONS} value={style.textAlign ?? 'left'} onChange={(value) => apply({ textAlign: value })} />
            </LabeledControl>
            <ColorProperty
              label="文字颜色"
              value={style.color ?? '#000000'}
              visible={!isTransparent(style.color)}
              onChange={(value) => apply({ color: value })}
              onVisibleChange={(visible) => apply({ color: visible ? '#000000' : 'transparent' })}
              onOpenPicker={(anchor) => openColorEditor(
                '文字颜色',
                style.color ?? '#000000',
                (value) => apply({ color: value }),
                anchor,
              )}
            />
          </div>
        </PropertySection>
      ) : null}

      <PropertySection
        title="外观"
        actions={(
          <IconButton
            label="恢复完全不透明"
            icon={Droplet}
            placement="left"
            onClick={() => apply({ opacity: '1' })}
          />
        )}
      >
        <div className={styles.appearanceGrid}>
          <LabeledControl label="不透明度">
            <NumberScrub
              label="不透明度"
              prefix="◫"
              value={`${Math.round(Number(style.opacity ?? 1) * 100)}%`}
              unit="%"
              min={0}
              max={100}
              onChange={(value) => apply({ opacity: String(pxToNum(value) / 100) })}
            />
          </LabeledControl>
          <LabeledControl label="圆角半径">
            <div className={styles.radiusControlRow}>
              <NumberScrub
                label="圆角半径"
                prefix="⌜"
                value={style.borderRadius ?? '0px'}
                unit="px"
                min={0}
                onChange={(value) => apply({ borderRadius: value })}
              />
              <IconButton
                label={cornersExpanded ? '收起四角设置' : '分别设置四个圆角'}
                icon={cornersExpanded ? Link2 : Unlink2}
                active={cornersExpanded}
                placement="left"
                onClick={() => setCornersExpanded((expanded) => !expanded)}
              />
            </div>
          </LabeledControl>
        </div>
        {cornersExpanded ? (
          <div className={styles.cornerGrid}>
            <NumberScrub label="左上圆角" prefix="⌜" value={style.borderTopLeftRadius ?? style.borderRadius ?? '0px'} unit="px" min={0} onChange={(value) => apply({ borderTopLeftRadius: value })} />
            <NumberScrub label="右上圆角" prefix="⌝" value={style.borderTopRightRadius ?? style.borderRadius ?? '0px'} unit="px" min={0} onChange={(value) => apply({ borderTopRightRadius: value })} />
            <NumberScrub label="左下圆角" prefix="⌞" value={style.borderBottomLeftRadius ?? style.borderRadius ?? '0px'} unit="px" min={0} onChange={(value) => apply({ borderBottomLeftRadius: value })} />
            <NumberScrub label="右下圆角" prefix="⌟" value={style.borderBottomRightRadius ?? style.borderRadius ?? '0px'} unit="px" min={0} onChange={(value) => apply({ borderBottomRightRadius: value })} />
          </div>
        ) : null}
      </PropertySection>

      <PropertySection
        title="填充"
        collapsible
        expanded={fillExpanded}
        onToggle={() => setFillExpanded((e) => !e)}
        hasContent={fillVisible || isImgElement}
        onAdd={() => {
          setFillMode('solid');
          apply({ backgroundColor: previousFill.current });
        }}
        onRemove={() => {
          apply({ backgroundColor: 'transparent', backgroundImage: 'none', backgroundSize: '', backgroundRepeat: '' });
        }}
      >
        {fillMode === 'solid' ? (
          <ColorProperty
            label="填充"
            value={style.backgroundColor ?? previousFill.current}
            visible={fillVisible}
            onChange={(value) => {
              previousFill.current = value;
              apply({ backgroundColor: value, backgroundImage: 'none' });
            }}
            onVisibleChange={(visible) => {
              if (!visible && !isTransparent(style.backgroundColor)) previousFill.current = cssColorToHex(style.backgroundColor);
              apply({ backgroundColor: visible ? previousFill.current : 'transparent' });
            }}
            onOpenPicker={(anchor) => openColorEditor(
              '填充',
              style.backgroundColor ?? previousFill.current,
              (value) => {
                previousFill.current = value;
                apply({ backgroundColor: value, backgroundImage: 'none' });
              },
              anchor,
              {
                mode: fillMode,
                onModeChange: (nextMode) => {
                  setFillMode(nextMode);
                  // Sync the open color editor's mode so the active button
                  // highlight and the rendered editor (gradient/image/solid)
                  // follow the switch inside the floating panel.
                  setColorEditor((current) => current && current.fill
                    ? { ...current, fill: { ...current.fill, mode: nextMode } }
                    : current);
                  if (nextMode === 'solid') {
                    apply({ backgroundImage: 'none', backgroundColor: previousFill.current });
                  } else if (nextMode === 'gradient') {
                    apply({ backgroundImage: gradientToCss(gradient), backgroundColor: '' });
                  }
                },
                gradient,
                onGradientChange,
                imageState: {
                  url: isImgElement ? (editorRef.current?.getSelectedSrc() ?? '') : (selectedStyles.backgroundImage?.replace(/^url\(['"]?|['"]?\)$/g, '') ?? ''),
                  size: optionFromBgSize(selectedStyles.backgroundSize ?? 'cover'),
                  repeat: selectedStyles.backgroundRepeat ?? 'no-repeat',
                  position: selectedStyles.backgroundPosition ?? 'center',
                },
                onImageChange: (patch) => {
                  const url = patch.url !== undefined ? patch.url : (selectedStyles.backgroundImage?.replace(/^url\(['"]?|['"]?\)$/g, '') ?? '');
                  const size = patch.size !== undefined ? patch.size : (selectedStyles.backgroundSize ?? 'cover');
                  const repeat = patch.repeat !== undefined ? patch.repeat : (selectedStyles.backgroundRepeat ?? 'no-repeat');
                  const position = patch.position !== undefined ? patch.position : (selectedStyles.backgroundPosition ?? 'center');
                  if (url) {
                    apply({ backgroundImage: `url("${url}")`, backgroundSize: size, backgroundPosition: position, backgroundRepeat: repeat });
                  } else {
                    apply({ backgroundImage: 'none' });
                  }
                },
              },
            )}
          />
        ) : fillMode === 'gradient' ? (
          <div className={styles.gradientWrap}>
            <GradientEditor value={gradient} onChange={onGradientChange} />
          </div>
        ) : isImgElement ? (
          <ImageFillControl
            url={selectedImgSrc}
            size={optionFromBgSize(selectedStyles.backgroundSize ?? 'cover')}
            repeat={selectedStyles.backgroundRepeat ?? 'no-repeat'}
            onUrlChange={(url) => {
              // For <img>, uploading replaces the src attribute (not a
              // background-image fill), matching "set this image" intent.
              editorRef.current?.setSelectedSrc(url);
              setSelectedImgSrc(url);
            }}
            onSizeChange={(size) => apply({ backgroundSize: bgSizeFromOption(size) })}
            onRepeatChange={(repeat) => apply({ backgroundRepeat: repeat })}
            onCrop={(cssSize, cssPosition) => apply({ backgroundSize: cssSize, backgroundPosition: cssPosition })}
            onCropModeChange={(on) => editorRef.current?.setCropMode(on)}
          />
        ) : (
          <ImageFillControl
            url={selectedStyles.backgroundImage?.replace(/^url\(['"]?|['"]?\)$/g, '') ?? ''}
            size={optionFromBgSize(selectedStyles.backgroundSize ?? 'cover')}
            repeat={selectedStyles.backgroundRepeat ?? 'no-repeat'}
            onUrlChange={(url) => {
              if (url) apply({ backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' });
              else apply({ backgroundImage: 'none' });
            }}
            onSizeChange={(size) => apply({ backgroundSize: bgSizeFromOption(size) })}
            onRepeatChange={(repeat) => apply({ backgroundRepeat: repeat })}
            onCrop={(cssSize, cssPosition) => apply({ backgroundSize: cssSize, backgroundPosition: cssPosition })}
            onCropModeChange={(on) => editorRef.current?.setCropMode(on)}
          />
        )}
      </PropertySection>

      <PropertySection
        title="描边"
        collapsible
        expanded={strokeExpanded}
        onToggle={() => setStrokeExpanded((e) => !e)}
        hasContent={strokeVisible}
        onAdd={() => apply({ borderWidth: '1px', borderStyle: 'solid', borderColor: previousStroke.current })}
        onRemove={() => {
          apply({
            borderWidth: '0px',
            borderTopWidth: '0px',
            borderRightWidth: '0px',
            borderBottomWidth: '0px',
            borderLeftWidth: '0px',
            borderStyle: 'none',
            outline: '',
            outlineWidth: '',
            outlineStyle: '',
            outlineColor: '',
          });
        }}
      >
        <ColorProperty
          label="描边"
          value={style.borderColor ?? previousStroke.current}
          visible={strokeVisible}
          onChange={(value) => {
            previousStroke.current = value;
            apply({ borderColor: value, borderStyle: 'solid', borderWidth: style.borderTopWidth === '0px' ? '1px' : style.borderTopWidth ?? '1px' });
          }}
          onVisibleChange={(visible) => {
            if (!visible && style.borderColor) previousStroke.current = cssColorToHex(style.borderColor);
            apply({ borderStyle: visible ? 'solid' : 'none', borderWidth: visible ? style.borderTopWidth || '1px' : '0px' });
          }}
          onOpenPicker={(anchor) => openColorEditor(
            '描边',
            style.borderColor ?? previousStroke.current,
            (value) => {
              previousStroke.current = value;
              apply({ borderColor: value });
            },
            anchor,
          )}
        />
        <div className={styles.strokeControlRow}>
          <LabeledControl label="位置">
            <CompactSelect
              label="描边位置"
              value={strokePosition}
              options={[
                { value: 'inside', label: '内部' },
                { value: 'center', label: '居中' },
                { value: 'outside', label: '外部' },
              ]}
              onChange={(value) => {
                const pos = value as 'inside' | 'center' | 'outside';
                setStrokePosition(pos);
                const w = pxToNum(style.borderTopWidth ?? '0px', 0);
                const color = style.borderColor ?? '#000000';
                const st = style.borderStyle ?? 'solid';
                if (pos === 'center') {
                  // Normal border, no outline/inset shadow.
                  apply({ borderWidth: w > 0 ? `${w}px` : '', borderStyle: st ?? 'solid', outline: '', boxShadow: '' });
                } else if (pos === 'outside') {
                  // Use outline (renders outside the border box).
                  apply({ outline: `${w}px ${st} ${color}`, outlineOffset: '0px', borderWidth: '0px' });
                } else {
                  // Inside: inset box-shadow simulates inner stroke.
                  apply({ boxShadow: `inset 0 0 0 ${w}px ${color}`, borderWidth: '0px', outline: '' });
                }
              }}
            />
          </LabeledControl>
          <LabeledControl label="粗细">
            <NumberScrub
              label="描边粗细"
              prefix={<SquareDashed size={14} aria-hidden="true" />}
              value={style.borderTopWidth ?? '0px'}
              unit="px"
              min={0}
              onChange={(value) => apply({ borderWidth: value, borderStyle: pxToNum(value) > 0 ? 'solid' : 'none' })}
            />
          </LabeledControl>
          <div className={styles.strokeActionPair}>
            <IconButton
              label={strokeSidesExpanded ? '收起四边描边' : '分别设置四边描边'}
              icon={SlidersHorizontal}
              active={strokeSidesExpanded}
              onClick={() => setStrokeSidesExpanded((expanded) => !expanded)}
            />
            <IconButton
              label="高级描边设置"
              icon={Settings2}
              placement="left"
              onClick={(event) => setStrokePanelPosition(popoverPosition(event.currentTarget, 300, 110, 390))}
            />
          </div>
        </div>
        {strokeSidesExpanded ? (
          <div className={styles.strokeSidesGrid}>
            <NumberScrub label="上描边" prefix="上" value={style.borderTopWidth ?? '0px'} unit="px" min={0} onChange={(value) => apply({ borderTopWidth: value })} />
            <NumberScrub label="右描边" prefix="右" value={style.borderRightWidth ?? '0px'} unit="px" min={0} onChange={(value) => apply({ borderRightWidth: value })} />
            <NumberScrub label="下描边" prefix="下" value={style.borderBottomWidth ?? '0px'} unit="px" min={0} onChange={(value) => apply({ borderBottomWidth: value })} />
            <NumberScrub label="左描边" prefix="左" value={style.borderLeftWidth ?? '0px'} unit="px" min={0} onChange={(value) => apply({ borderLeftWidth: value })} />
          </div>
        ) : null}
      </PropertySection>

      <PropertySection
        title="效果"
        collapsible
        expanded={effectExpanded}
        onToggle={() => setEffectExpanded((e) => !e)}
        hasContent={effectVisible}
        onAdd={() => {
          setEffectType('drop-shadow');
          apply({ boxShadow: previousShadow.current });
        }}
        onRemove={() => {
          setEffectType('none');
          apply({ boxShadow: 'none', filter: '', backdropFilter: '', WebkitBackdropFilter: '' });
        }}
      >
        <div className={styles.effectRow}>
          <button
            type="button"
            className={styles.effectPreviewButton}
            aria-label="打开效果参数"
            title="打开效果参数"
            data-tooltip="打开效果参数"
            onClick={(event) => setEffectPanelPosition(popoverPosition(event.currentTarget, 276, 150, 360))}
          >
            {effectType === 'drop-shadow' || effectType === 'inner-shadow'
              ? <SquareDashed size={16} aria-hidden="true" />
              : effectType === 'noise' || effectType === 'texture'
                ? <Sparkles size={16} aria-hidden="true" />
                : <WandSparkles size={16} aria-hidden="true" />}
          </button>
          <CompactSelect
            label="效果类型"
            value={effectType}
            options={EFFECT_OPTIONS}
            onChange={(value) => {
              const next = value as EffectType;
              setEffectType(next);
              if (next === 'none') {
                if (effectVisible && style.boxShadow) previousShadow.current = style.boxShadow;
                apply({ boxShadow: 'none', filter: '', backdropFilter: '', WebkitBackdropFilter: '' });
              } else if (next === 'drop-shadow') {
                apply({ boxShadow: previousShadow.current || buildSingleShadow(shadowDraft) });
              } else if (next === 'inner-shadow') {
                apply({ boxShadow: buildSingleShadow({ ...shadowDraft, inset: true }) });
                setShadowDraft((d) => ({ ...d, inset: true }));
              } else if (next === 'layer-blur') {
                apply({ filter: 'blur(4px)' });
              } else if (next === 'background-blur') {
                apply({ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' });
              } else if (next === 'glass') {
                apply({ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', backgroundColor: 'rgba(255,255,255,0.1)' });
              }
            }}
          />
          <IconButton
            label={effectType === 'none' ? '显示效果' : '隐藏效果'}
            icon={effectType === 'none' ? EyeOff : Eye}
            active={effectType !== 'none'}
            onClick={() => {
              if (effectType === 'none') {
                setEffectType('drop-shadow');
                apply({ boxShadow: previousShadow.current });
              } else {
                if (effectVisible && style.boxShadow) previousShadow.current = style.boxShadow;
                setEffectType('none');
                apply({ boxShadow: 'none' });
              }
            }}
          />
          <IconButton
            label="移除效果"
            icon={Minus}
            placement="left"
            onClick={() => {
              setEffectType('none');
              apply({ boxShadow: 'none' });
            }}
          />
        </div>
      </PropertySection>

      {selectedColors.length > 0 ? (
        <PropertySection
          title="已选颜色"
          actions={(
            <IconButton
              label={batchMode ? '退出批量修改' : '批量修改颜色'}
              icon={SlidersHorizontal}
              active={batchMode}
              placement="left"
              onClick={() => {
                setBatchMode((active) => !active);
                setBatchSelection([]);
              }}
            />
          )}
        >
          <div className={styles.stack}>
            {selectedColors.map((color) => (
              <SelectedColor
                key={color}
                color={color}
                batchMode={batchMode}
                selected={batchSelection.includes(color)}
                onToggle={() => setBatchSelection((current) =>
                  current.includes(color) ? current.filter((item) => item !== color) : [...current, color]
                )}
                onOpenPicker={(anchor) => {
                  // Seed the drag target with the swatch's current colour so
                  // the first commit matches; subsequent commits re-target at
                  // the just-written colour (see replaceTargetRef).
                  replaceTargetRef.current = color;
                  openColorEditor(
                    '已选颜色',
                    color,
                    (value) => {
                      const target = replaceTargetRef.current ?? color;
                      setReplacementColor(value);
                      editorRef.current?.replaceColors([target], value);
                      // Advance the target so the next drag tick matches the
                      // colour we just wrote, not the stale original.
                      replaceTargetRef.current = value;
                      window.setTimeout(() => {
                        setSelectedColors(editorRef.current?.collectColorsFromSelection() ?? []);
                      }, 0);
                    },
                    anchor,
                  );
                }}
                onColorChange={(value) => {
                  // Manual hex/rgba typing: replace this colour throughout the
                  // selection, mirroring the picker commit path above.
                  const target = replaceTargetRef.current ?? color;
                  editorRef.current?.replaceColors([target], value);
                  replaceTargetRef.current = value;
                  window.setTimeout(() => {
                    setSelectedColors(editorRef.current?.collectColorsFromSelection() ?? []);
                  }, 0);
                }}
              />
            ))}
            {batchMode ? (
              <div className={styles.batchEditor}>
                <div className={styles.batchEditorHeader}>
                  <span>已选择 {batchSelection.length} 个颜色</span>
                  <button type="button" onClick={() => setBatchSelection(selectedColors)}>全选</button>
                </div>
                <div className={styles.batchReplacement}>
                  <span>替换为</span>
                  <button
                    type="button"
                    className={styles.batchReplacementColor}
                    style={{ '--swatch-color': replacementColor } as CSSProperties}
                    aria-label="选择替换颜色"
                    onClick={(event) => openColorEditor('替换颜色', replacementColor, setReplacementColor, event.currentTarget)}
                  />
                  <code>{replacementColor.replace('#', '')}</code>
                  <Button
                    type="button"
                    className={styles.batchApplyButton}
                    disabled={batchSelection.length === 0}
                    title="批量替换选中颜色"
                    onClick={() => {
                      editorRef.current?.replaceColors(batchSelection, replacementColor);
                      setBatchSelection([]);
                      // Refresh the collected color list so replaced colors
                      // surface in their new form.
                      window.setTimeout(() => {
                        setSelectedColors(editorRef.current?.collectColorsFromSelection() ?? []);
                      }, 0);
                    }}
                  >
                    替换
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </PropertySection>
      ) : null}

      {colorEditorPortal}

      {strokePanelPosition ? (
        <FloatingPanel
          title="描边设置"
          position={strokePanelPosition}
          wide
          onClose={() => setStrokePanelPosition(null)}
        >
          <div className={styles.settingsTabs} role="tablist" aria-label="描边设置类型">
            {[
              ['basic', '基础'],
              ['dynamic', '动态'],
              ['brush', '笔刷'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={strokeSettingsTab === value ? styles.settingsTabActive : undefined}
                role="tab"
                aria-selected={strokeSettingsTab === value}
                onClick={() => setStrokeSettingsTab(value as 'basic' | 'dynamic' | 'brush')}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.advancedSettings}>
            <LabeledControl label="样式" inline>
              <CompactSelect
                label="描边样式"
                value={style.borderStyle ?? 'solid'}
                options={[
                  { value: 'solid', label: '纯色' },
                  { value: 'dashed', label: '虚线' },
                  { value: 'dotted', label: '点线' },
                  { value: 'double', label: '双线' },
                ]}
                onChange={(value) => apply({ borderStyle: value })}
              />
            </LabeledControl>
            <LabeledControl label="宽度轮廓" inline>
              <div className={styles.strokeProfile}>
                <span />
                <IconButton label="反转宽度轮廓" icon={Undo2} onClick={() => undefined} />
              </div>
            </LabeledControl>
            <LabeledControl label="端点" inline>
              <IconGroup
                value="butt"
                options={[
                  { value: 'butt', label: '平头端点', icon: Minus },
                  { value: 'round', label: '圆头端点', icon: Droplet },
                  { value: 'square', label: '方头端点', icon: Square },
                ]}
                onChange={() => undefined}
              />
            </LabeledControl>
            <LabeledControl label="连接" inline>
              <IconGroup
                value="miter"
                options={[
                  { value: 'miter', label: '尖角连接', icon: SquareDashed },
                  { value: 'round', label: '圆角连接', icon: Droplet },
                  { value: 'bevel', label: '斜角连接', icon: Scan },
                ]}
                onChange={() => undefined}
              />
            </LabeledControl>
            <div className={styles.twoColumn}>
              <NumberScrub label="虚线长度" prefix="线" value={strokeDashLength} unit="px" min={0} onChange={(value) => {
                setStrokeDashLength(value);
                const gap = pxToNum(strokeDashGap, 0);
                const len = pxToNum(value, 0);
                if (len > 0) apply({ strokeDasharray: `${len}px ${gap}px`, borderStyle: 'dashed' } as Record<string, string>);
                else apply({ strokeDasharray: '', borderStyle: 'solid' } as Record<string, string>);
              }} />
              <NumberScrub label="虚线间隔" prefix="隙" value={strokeDashGap} unit="px" min={0} onChange={(value) => {
                setStrokeDashGap(value);
                const len = pxToNum(strokeDashLength, 0);
                const gap = pxToNum(value, 0);
                if (len > 0) apply({ strokeDasharray: `${len}px ${gap}px`, borderStyle: 'dashed' } as Record<string, string>);
              }} />
            </div>
          </div>
        </FloatingPanel>
      ) : null}

      {effectPanelPosition ? (
        <FloatingPanel
          title={(
            <select
              className={styles.floatingTitleSelect}
              aria-label="效果类型"
              value={effectType}
              onChange={(event) => setEffectType(event.target.value as EffectType)}
            >
              {EFFECT_OPTIONS.filter((option) => option.value !== 'none').map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
          position={effectPanelPosition}
          onClose={() => setEffectPanelPosition(null)}
        >
          <div className={styles.shadowSettings}>
            <div className={styles.twoColumn}>
              <NumberScrub label="水平位置" prefix="X" value={shadowDraft.x} unit="px" onChange={(value) => updateShadowDraft({ x: value })} />
              <NumberScrub label="垂直位置" prefix="Y" value={shadowDraft.y} unit="px" onChange={(value) => updateShadowDraft({ y: value })} />
              <NumberScrub label="模糊" prefix="糊" value={shadowDraft.blur} unit="px" min={0} onChange={(value) => updateShadowDraft({ blur: value })} />
              <NumberScrub label="扩展" prefix="扩" value={shadowDraft.spread} unit="px" onChange={(value) => updateShadowDraft({ spread: value })} />
            </div>
            <LabeledControl label="颜色">
              <div className={styles.shadowColorRow}>
                <button
                  type="button"
                  className={styles.shadowColorSwatch}
                  style={{ '--swatch-color': shadowDraft.color } as CSSProperties}
                  aria-label="投影颜色"
                  onClick={(event) => openColorEditor(
                    '投影颜色',
                    shadowDraft.color,
                    (value) => updateShadowDraft({ color: value }),
                    event.currentTarget,
                  )}
                />
                <ColorTextInput
                  value={shadowDraft.color}
                  onChange={(value) => updateShadowDraft({ color: value })}
                  ariaLabel="投影颜色值"
                />
                <input
                  aria-label="投影透明度"
                  value={shadowDraft.opacity.replace('%', '')}
                  onChange={(event) => updateShadowDraft({ opacity: `${event.target.value}%` })}
                />
                <span>%</span>
              </div>
            </LabeledControl>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={shadowDraft.inset}
                onChange={(event) => updateShadowDraft({ inset: event.target.checked })}
              />
              <span>内阴影</span>
            </label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={effectType === 'inner-shadow' || shadowDraft.inset}
                onChange={(event) => {
                  const inset = event.target.checked;
                  setEffectType(inset ? 'inner-shadow' : 'drop-shadow');
                  updateShadowDraft({ inset });
                }}
              />
              <span>显示在透明区域后面（内阴影）</span>
            </label>
          </div>
        </FloatingPanel>
      ) : null}
    </div>
  );
}

export default StylePanel;
