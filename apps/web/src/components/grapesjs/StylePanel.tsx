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
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignHorizontalSpaceBetween,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignEndVertical,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  Columns2,
  Droplet,
  Eye,
  EyeOff,
  Expand,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  Grid2X2,
  Link2,
  Minus,
  Plus,
  RotateCw,
  Rows2,
  Scan,
  Settings2,
  SlidersHorizontal,
  Square,
  SquareDashed,
  Type,
  Undo2,
  Unlink2,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import {
  GradientEditor,
  createDefaultGradient,
  gradientToCss,
  parseGradientCss,
  type GradientValue,
} from '../GradientEditor';
import {
  ColorEditor,
  type ColorEditorFillContext,
  type FillMode,
  type ImageFillState,
} from './color-editor-popover';
import {
  ColorProperty,
  ColorTextInput,
  SelectedColor,
  cssColorToHex,
} from './color-fields';
import type { GrapesjsEditorHandle, GrapesjsPositionAlignMode, SelectionSnapshot } from './GrapesjsEditor';
import {
  ImageFillSummary,
  fillSizeToObjectFit,
  imageUrlFromCssUrl,
  objectFitToFillSize,
  optionFromBgSize,
} from './image-fill-control';
import {
  NumberScrub,
  fieldDisplay,
  pxToNum,
} from './number-scrub';
import {
  DIMENSION_MODE_OPTIONS,
  axisAlignment,
  buildAlignmentPatch,
  buildDimensionModePatch,
  buildFlowPatch,
  dimensionMode,
  flowFromStyles,
  type DimensionMode,
  type FlowValue,
} from './layout-controls';
import { useStylePanelCanvasState } from './style-panel-canvas-state';
import {
  CompactSelect,
  FloatingPanel,
  IconButton,
  IconGroup,
  LabeledControl,
  PropertySection,
  popoverPosition,
  type FloatingPosition,
  type IconOption,
} from './style-panel-primitives';
import {
  parseRotation,
  replaceRotation,
  toggleFlipTransform,
} from './transform-controls';
import {
  CLEAR_ALL_EFFECT_STYLES,
  DEFAULT_PREVIOUS_SHADOW,
  DEFAULT_SHADOW_DRAFT,
  EFFECT_OPTIONS,
  buildSingleShadow,
  toggleEffectVisibility,
  transitionEffectType,
  type EffectType,
} from './effect-controls';
import {
  CLEAR_STROKE_STYLES,
  STROKE_POSITION_OPTIONS,
  STROKE_STYLE_OPTIONS,
  buildStrokeAddPatch,
  buildStrokeColorPatch,
  buildStrokeDashPatch,
  buildStrokePositionPatch,
  buildStrokeVisibilityPatch,
  buildStrokeWidthPatch,
  readStrokeLinecap,
  readStrokeLinejoin,
  readStrokePosition,
  type StrokeLinecapValue,
  type StrokeLinejoinValue,
  type StrokePositionValue,
} from './stroke-controls';
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

interface ColorEditorState {
  label: string;
  value: string;
  position: FloatingPosition;
  onChange: (value: string) => void;
  /** Fill-mode context. Only set when the editor is opened from the Fill
   *  section; absent for text color / border / shadow editors. */
  fill?: ColorEditorFillContext;
}

const FLOW_OPTIONS: IconOption[] = [
  { value: 'row', label: '水平', icon: Columns2 },
  { value: 'column', label: '垂直', icon: Rows2 },
  { value: 'wrap', label: '换行', icon: Grid2X2 },
];

type PositionAlignAction = {
  value: string;
  label: string;
  shortcut: string;
  mode: GrapesjsPositionAlignMode;
  icon: typeof AlignStartVertical;
  fallback?: StyleMap;
};

const POSITION_ALIGN_ACTIONS: PositionAlignAction[] = [
  { value: 'left', label: '左对齐', shortcut: '⌥ A', mode: 'left', icon: AlignStartVertical, fallback: { justifySelf: 'start' } },
  { value: 'center-x', label: '左右居中对齐', shortcut: '⌥ H', mode: 'center-x', icon: AlignCenterVertical, fallback: { justifySelf: 'center' } },
  { value: 'right', label: '右对齐', shortcut: '⌥ D', mode: 'right', icon: AlignEndVertical, fallback: { justifySelf: 'end' } },
  { value: 'top', label: '顶对齐', shortcut: '⌥ W', mode: 'top', icon: AlignStartHorizontal, fallback: { alignSelf: 'flex-start' } },
  { value: 'center-y', label: '上下居中对齐', shortcut: '⌥ V', mode: 'center-y', icon: AlignCenterHorizontal, fallback: { alignSelf: 'center' } },
  { value: 'bottom', label: '底对齐', shortcut: '⌥ S', mode: 'bottom', icon: AlignEndHorizontal, fallback: { alignSelf: 'flex-end' } },
  { value: 'distribute-y', label: '垂直平均分布', shortcut: '⇧ ⌥ V', mode: 'distribute-y', icon: AlignVerticalSpaceBetween },
  { value: 'distribute-x', label: '水平平均分布', shortcut: '⇧ ⌥ H', mode: 'distribute-x', icon: AlignHorizontalSpaceBetween },
];

const TEXT_ALIGN_OPTIONS: IconOption[] = [
  { value: 'left', label: '左对齐', icon: AlignLeft },
  { value: 'center', label: '居中对齐', icon: AlignCenter },
  { value: 'right', label: '右对齐', icon: AlignRight },
  { value: 'justify', label: '两端对齐', icon: AlignJustify },
];

const ROW_ALIGNMENT_ICONS: Record<0 | 1 | 2, LucideIcon> = {
  0: AlignVerticalJustifyStart,
  1: AlignVerticalJustifyCenter,
  2: AlignVerticalJustifyEnd,
};

const COLUMN_ALIGNMENT_ICONS: Record<0 | 1 | 2, LucideIcon> = {
  0: AlignHorizontalJustifyStart,
  1: AlignHorizontalJustifyCenter,
  2: AlignHorizontalJustifyEnd,
};

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

const EMPTY_SELECTED_COLORS: string[] = [];

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

function isTransparent(value: string | undefined): boolean {
  return !value || value === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(value);
}

function isGradient(value: string | undefined): boolean {
  return !!value && /gradient\(/i.test(value);
}

function DimensionControl({
  axis,
  value,
  tagName,
  allowHug,
  modeOverride,
  onValueChange,
  onModeChange,
}: {
  axis: '宽' | '高';
  value: string;
  tagName?: string;
  allowHug: boolean;
  modeOverride?: DimensionMode | null;
  onValueChange: (value: string) => void;
  onModeChange: (mode: DimensionMode) => void;
}) {
  // Prefer the explicit override (set when the user picks a mode) over the
  // computed-style derivation, which resolves hug/fill to px and would snap
  // the dropdown back to 固定.
  const inferredMode = modeOverride ?? dimensionMode(value, tagName);
  const effectiveMode = !allowHug && inferredMode === 'hug' ? 'fixed' : inferredMode;
  const options = allowHug
    ? DIMENSION_MODE_OPTIONS
    : DIMENSION_MODE_OPTIONS.filter((option) => option.value !== 'hug');
  return (
    <div className={styles.dimensionControl}>
      <NumberScrub label={axis} prefix={axis === '宽' ? 'W' : 'H'} value={value} unit="px" min={0} onChange={onValueChange} />
      <CompactSelect
        label={`${axis}调整模式`}
        value={effectiveMode}
        options={options}
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
          const rowIndex = row as 0 | 1 | 2;
          const columnIndex = column as 0 | 1 | 2;
          const ActiveIcon = verticalFlow
            ? ROW_ALIGNMENT_ICONS[rowIndex]
            : COLUMN_ALIGNMENT_ICONS[columnIndex];
          return (
            <button
              key={`${column}-${row}`}
              type="button"
              className={`${styles.alignmentCell}${active ? ` ${styles.alignmentCellActive}` : ''}`}
              aria-label={label}
              aria-pressed={active}
              title={label}
              data-tooltip={label}
              onClick={() => onChange(columnIndex, rowIndex)}
            >
              {active ? (
                <ActiveIcon
                  className={styles.alignmentActiveIcon}
                  size={17}
                  strokeWidth={2.1}
                  aria-hidden="true"
                />
              ) : (
                <span className={styles.alignmentDot} />
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}

function PositionAlignControls({
  disabled = false,
  onAction,
}: {
  disabled?: boolean;
  onAction: (action: PositionAlignAction) => void;
}) {
  return (
    <div className={styles.positionAlignGrid} role="group" aria-label="位置对齐">
      {POSITION_ALIGN_ACTIONS.map((action) => {
        const ActionIcon = action.icon;
        const accessibleLabel = `${action.label} ${action.shortcut}`;
        return (
          <button
            key={action.value}
            type="button"
            className={styles.positionAlignButton}
            aria-label={accessibleLabel}
            title={accessibleLabel}
            data-tooltip={accessibleLabel}
            disabled={disabled}
            onClick={() => onAction(action)}
          >
            <ActionIcon size={13} strokeWidth={1.9} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function StylePanel({ editorRef, selection, imageEditSignal }: StylePanelProps) {
  const hasSelection = !!selection?.hasSelection;
  const selectedStyles = selection?.styles ?? {};
  const {
    canvasStyles,
    canvasSize,
    applyCanvasStyles,
    applyCanvasSize,
  } = useStylePanelCanvasState(editorRef, hasSelection);
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
  const [strokePosition, setStrokePosition] = useState<StrokePositionValue>('center');
  const [strokeLinecap, setStrokeLinecap] = useState<StrokeLinecapValue>('butt');
  const [strokeLinejoin, setStrokeLinejoin] = useState<StrokeLinejoinValue>('miter');
  const [strokeDashLength, setStrokeDashLength] = useState('0px');
  const [strokeDashGap, setStrokeDashGap] = useState('0px');
  const [shadowDraft, setShadowDraft] = useState(DEFAULT_SHADOW_DRAFT);
  const previousFill = useRef('#FFFFFF');
  const previousCanvasBackground = useRef('#FFFFFF');
  const previousStroke = useRef('#000000');
  const previousShadow = useRef(DEFAULT_PREVIOUS_SHADOW);

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
      applyCanvasStyles(kebab);
    },
    [applyCanvasStyles, editorRef, hasSelection],
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

  const isImgElement = (selection?.tagName ?? '').toLowerCase() === 'img';
  const gradientFill = isGradient(selectedStyles.backgroundImage);
  const backgroundImageUrl = imageUrlFromCssUrl(selectedStyles.backgroundImage);
  const selectedImageUrl = isImgElement
    ? (selectedImgSrc || editorRef.current?.getSelectedSrc() || '')
    : backgroundImageUrl;
  const [fillMode, setFillMode] = useState<FillMode>(
    gradientFill ? 'gradient' : (isImgElement || backgroundImageUrl ? 'image' : 'solid')
  );
  const [gradient, setGradient] = useState<GradientValue>(() =>
    gradientFill && selectedStyles.backgroundImage
      ? parseGradientCss(selectedStyles.backgroundImage) ?? createDefaultGradient()
      : createDefaultGradient(),
  );
  useEffect(() => {
    setFillMode(isGradient(selectedStyles.backgroundImage) ? 'gradient' : (isImgElement || backgroundImageUrl ? 'image' : 'solid'));
    if (selectedStyles.backgroundImage && isGradient(selectedStyles.backgroundImage)) {
      const parsed = parseGradientCss(selectedStyles.backgroundImage);
      if (parsed) setGradient(parsed);
    }
  }, [backgroundImageUrl, isImgElement, selectedStyles.backgroundImage]);
  const onGradientChange = useCallback(
    (nextGradient: GradientValue) => {
      setGradient(nextGradient);
      apply({ backgroundImage: gradientToCss(nextGradient), backgroundColor: '' });
    },
    [apply],
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

  const buildImageFillState = useCallback((): ImageFillState => {
    if (isImgElement) {
      return {
        url: selectedImgSrc || editorRef.current?.getSelectedSrc() || '',
        size: objectFitToFillSize(selectedStyles.objectFit),
        repeat: 'no-repeat',
        position: selectedStyles.objectPosition ?? 'center',
        cropSize: selectedStyles.objectFit === 'none' ? 'auto' : selectedStyles.objectFit ?? 'cover',
      };
    }
    return {
      url: backgroundImageUrl,
      size: optionFromBgSize(selectedStyles.backgroundSize ?? 'cover'),
      repeat: selectedStyles.backgroundRepeat ?? 'no-repeat',
      position: selectedStyles.backgroundPosition ?? 'center',
      cropSize: selectedStyles.backgroundSize ?? 'cover',
    };
  }, [
    backgroundImageUrl,
    editorRef,
    isImgElement,
    selectedImgSrc,
    selectedStyles.backgroundPosition,
    selectedStyles.backgroundRepeat,
    selectedStyles.backgroundSize,
    selectedStyles.objectFit,
    selectedStyles.objectPosition,
  ]);

  const handleImageFillChange = useCallback((patch: Partial<ImageFillState>) => {
    const updateOpenImageState = (statePatch: Partial<ImageFillState>) => {
      setColorEditor((current) => current && current.fill
        ? { ...current, fill: { ...current.fill, imageState: { ...current.fill.imageState, ...statePatch } } }
        : current);
    };

    if (isImgElement) {
      const nextStyles: StyleMap = {};
      if (patch.url !== undefined) {
        editorRef.current?.setSelectedSrc(patch.url);
        setSelectedImgSrc(patch.url);
      }
      if (patch.size !== undefined) {
        nextStyles.objectFit = fillSizeToObjectFit(patch.size);
        if (nextStyles.objectFit === 'none' && !selectedStyles.objectPosition) nextStyles.objectPosition = 'center';
      }
      if (patch.position !== undefined) nextStyles.objectPosition = patch.position;
      const nextImageState: Partial<ImageFillState> = { ...patch };
      if (patch.size !== undefined) {
        nextImageState.size = objectFitToFillSize(fillSizeToObjectFit(patch.size));
        nextImageState.cropSize = patch.size;
      }
      updateOpenImageState(nextImageState);
      if (Object.keys(nextStyles).length > 0) apply(nextStyles);
      return;
    }

    const url = patch.url !== undefined ? patch.url : backgroundImageUrl;
    const size = patch.size !== undefined ? patch.size : (selectedStyles.backgroundSize ?? 'cover');
    const repeat = patch.repeat !== undefined ? patch.repeat : (selectedStyles.backgroundRepeat ?? 'no-repeat');
    const position = patch.position !== undefined ? patch.position : (selectedStyles.backgroundPosition ?? 'center');
    if (url) {
      updateOpenImageState({
        ...patch,
        url,
        size: optionFromBgSize(size),
        cropSize: size,
        repeat,
        position,
      });
      apply({
        backgroundImage: `url("${url}")`,
        backgroundSize: size,
        backgroundPosition: position,
        backgroundRepeat: repeat,
      });
    } else {
      updateOpenImageState({ ...patch, url: '' });
      apply({ backgroundImage: 'none' });
    }
  }, [
    apply,
    backgroundImageUrl,
    editorRef,
    isImgElement,
    selectedStyles.backgroundPosition,
    selectedStyles.backgroundRepeat,
    selectedStyles.backgroundSize,
    selectedStyles.objectPosition,
  ]);

  const handleFillModeChange = useCallback((nextMode: FillMode) => {
    setFillMode(nextMode);
    setColorEditor((current) => current && current.fill
      ? { ...current, fill: { ...current.fill, mode: nextMode } }
      : current);
    if (nextMode === 'solid') {
      apply({ backgroundImage: 'none', backgroundColor: previousFill.current });
    } else if (nextMode === 'gradient') {
      apply({ backgroundImage: gradientToCss(gradient), backgroundColor: '' });
    }
  }, [apply, gradient]);

  const openFillEditor = useCallback((anchor: HTMLElement, mode: FillMode = fillMode) => {
    openColorEditor(
      '填充',
      selectedStyles.backgroundColor ?? previousFill.current,
      (value) => {
        previousFill.current = value;
        apply({ backgroundColor: value, backgroundImage: 'none' });
      },
      anchor,
      {
        mode,
        onModeChange: handleFillModeChange,
        gradient,
        onGradientChange,
        imageState: buildImageFillState(),
        onImageChange: handleImageFillChange,
      },
    );
  }, [
    apply,
    buildImageFillState,
    fillMode,
    gradient,
    handleFillModeChange,
    handleImageFillChange,
    onGradientChange,
    openColorEditor,
    selectedStyles.backgroundColor,
  ]);

  const style = selectedStyles;
  const selectedStrokeLinecap = style.strokeLinecap ?? style['stroke-linecap'];
  const selectedStrokeLinejoin = style.strokeLinejoin ?? style['stroke-linejoin'];

  useEffect(() => {
    const nextLinecap = readStrokeLinecap(selectedStrokeLinecap);
    const nextLinejoin = readStrokeLinejoin(selectedStrokeLinejoin);
    if (nextLinecap) setStrokeLinecap(nextLinecap);
    if (nextLinejoin) setStrokeLinejoin(nextLinejoin);
  }, [selectedStrokeLinecap, selectedStrokeLinejoin]);

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
    const anchor = panelRootRef.current;
    if (!anchor) return;
    openFillEditor(anchor, 'image');
  }, [imageEditSignal, hasSelection, openFillEditor]);

  // Keep the previewed <img> src in sync whenever the selection changes.
  useEffect(() => {
    setSelectedImgSrc(isImgElement ? (editorRef.current?.getSelectedSrc() ?? '') : '');
    // Clear the explicit dimension-mode override so a new element starts
    // from its computed style.
    setWidthMode(null);
    setHeightMode(null);
  }, [editorRef, isImgElement, selection]);

  // Colors used by the selection's whole subtree (background/border/text).
  // GrapesjsEditor computes this as part of the selection snapshot so the
  // panel does not need to run its own recursive DOM scan.
  const selectedColors = hasSelection ? (selection?.selectedColors ?? EMPTY_SELECTED_COLORS) : EMPTY_SELECTED_COLORS;
  useEffect(() => {
    setBatchSelection((current) => {
      const next = current.filter((color) => selectedColors.includes(color));
      return next.length === current.length ? current : next;
    });
  }, [selectedColors]);

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
        <PropertySection title="位置">
          <LabeledControl label="对齐">
            <PositionAlignControls disabled onAction={() => {}} />
          </LabeledControl>
        </PropertySection>
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
  const autoLayoutActive = flow !== 'free';
  const autoLayoutIsVertical = flow === 'column';
  const gapLabel = autoLayoutIsVertical ? '垂直间距' : '水平间距';
  const gapPrefix = autoLayoutIsVertical ? '↕' : '↔';
  const distributionLabel = autoLayoutIsVertical ? '垂直分布式' : '水平分布式';
  const DistributionIcon = autoLayoutIsVertical ? AlignVerticalSpaceBetween : AlignHorizontalSpaceBetween;
  const absolutePositionActive = style.position === 'absolute';
  const reverseFlow = (style.flexDirection ?? '').endsWith('reverse');
  // A fill counts as "has content" when there's a background color, a
  // gradient, OR a background image (url). The url case matters for pasted
  // screenshot divs and <img>-replaced fills, otherwise the panel stays
  // force-collapsed with only the + button.
  const hasBackgroundImage = !!style.backgroundImage && style.backgroundImage !== 'none';
  const isIconElement = selection?.canvasTool === 'icon';
  const iconColorVisible = isIconElement && !isTransparent(style.color);
  const fillVisible = !isTransparent(style.backgroundColor) || isGradient(style.backgroundImage) || hasBackgroundImage;
  const strokeVisible = pxToNum(style.borderTopWidth) > 0 && style.borderStyle !== 'none';
  const effectVisible = !!style.boxShadow && style.boxShadow !== 'none';
  const rotation = parseRotation(style.transform);
  const isTextElement =
    TEXT_TAGS.has((selection?.tagName ?? '').toLowerCase()) ||
    selection?.componentType === 'text' ||
    selection?.canvasTool === 'text';
  // selectedColors is declared above (before the no-selection early return)
  // so the hook order stays stable across selected/unselected renders.
  const effectContext = () => ({
    effectVisible,
    currentBoxShadow: style.boxShadow,
    previousShadow: previousShadow.current,
    shadowDraft,
  });
  const commitEffectTransition = (transition: ReturnType<typeof transitionEffectType>) => {
    setEffectType(transition.nextType);
    if (transition.rememberShadow) previousShadow.current = transition.rememberShadow;
    if (transition.shadowDraft) setShadowDraft(transition.shadowDraft);
    apply(transition.styles);
  };

  const setFlow = (nextFlow: FlowValue) => {
    if (hasSelection) {
      if (nextFlow === 'free' && editorRef.current?.dissolveSelectedFlex?.()) return;
      if (nextFlow === 'row' && editorRef.current?.arrangeSelectionAsFlex?.('row')) return;
      if (nextFlow === 'column' && editorRef.current?.arrangeSelectionAsFlex?.('column')) return;
      if (nextFlow === 'wrap' && editorRef.current?.arrangeSelectionAsFlex?.('row')) {
        apply({ flexWrap: 'wrap' });
        return;
      }
    }
    apply(buildFlowPatch(nextFlow));
  };

  const setDimensionMode = (property: 'width' | 'height', mode: DimensionMode) => {
    apply(buildDimensionModePatch({
      property,
      mode,
      currentValue: style[property],
      tagName: selection?.tagName,
    }));
  };

  const setAlignment = (column: 0 | 1 | 2, row: 0 | 1 | 2) => {
    apply(buildAlignmentPatch({
      column,
      row,
      flow,
      display: style.display,
      flexDirection: style.flexDirection,
    }));
  };
  const applyPositionAlignAction = (action: PositionAlignAction) => {
    if (editorRef.current?.alignPositionedSelection?.(action.mode)) return;
    if (action.fallback) apply(action.fallback);
  };

  const appearanceSection = (
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
              label={cornersExpanded ? '收起圆角' : '展开圆角'}
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
  );

  const horizontalPaddingControl = (() => {
    const left = style.paddingLeft ?? '0px';
    const right = style.paddingRight ?? '0px';
    const equal = fieldDisplay(left) === fieldDisplay(right);
    return equal ? (
      <NumberScrub
        label="左右边距"
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
        title="左右边距不同，点击展开分别设置"
        data-tooltip="左右边距不同，点击展开分别设置"
        onClick={() => setPaddingLinked(false)}
      >
        <span aria-hidden="true">↔</span>
        <span>{fieldDisplay(left)}, {fieldDisplay(right)}</span>
      </button>
    );
  })();

  const verticalPaddingControl = (() => {
    const top = style.paddingTop ?? '0px';
    const bottom = style.paddingBottom ?? '0px';
    const equal = fieldDisplay(top) === fieldDisplay(bottom);
    return equal ? (
      <NumberScrub
        label="上下边距"
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
        title="上下边距不同，点击展开分别设置"
        data-tooltip="上下边距不同，点击展开分别设置"
        onClick={() => setPaddingLinked(false)}
      >
        <span aria-hidden="true">↕</span>
        <span>{fieldDisplay(top)}, {fieldDisplay(bottom)}</span>
      </button>
    );
  })();

  const autoLayoutBody = autoLayoutActive ? (
    <div className={styles.autoLayoutCompact} data-testid="auto-layout-compact">
      <div className={styles.autoLayoutFlow}>
        <IconGroup options={FLOW_OPTIONS} value={flow} onChange={(value) => setFlow(value as FlowValue)} />
      </div>
      <div className={styles.autoLayoutGap}>
        <NumberScrub
          label={gapLabel}
          prefix={gapPrefix}
          value={style.gap ?? '0px'}
          unit="px"
          min={0}
          onChange={(value) => apply({ gap: value })}
        />
      </div>
      <div className={styles.autoLayoutAlignment}>
        <AlignmentGrid
          flow={flow}
          justifyContent={style.justifyContent ?? 'flex-start'}
          alignItems={style.alignItems ?? 'stretch'}
          onChange={setAlignment}
        />
      </div>
      <div className={styles.autoLayoutActions} data-testid="auto-layout-actions">
        <IconButton
          label={reverseFlow ? '恢复正向排列' : '反向排列'}
          icon={Undo2}
          active={reverseFlow}
          disabled={flow === 'wrap'}
          placement="left"
          onClick={() => {
            if (flow === 'row') apply({ flexDirection: reverseFlow ? 'row' : 'row-reverse' });
            if (flow === 'column') apply({ flexDirection: reverseFlow ? 'column' : 'column-reverse' });
          }}
        />
        <IconButton
          label={distributionLabel}
          icon={DistributionIcon}
          active={(style.justifyContent ?? '') === 'space-between'}
          placement="left"
          onClick={() => {
            const next = (style.justifyContent ?? '') === 'space-between' ? 'flex-start' : 'space-between';
            apply({ justifyContent: next });
          }}
        />
      </div>
      {paddingLinked ? (
        <div className={styles.autoLayoutPaddingPair} data-testid="auto-layout-padding-pair">
          <div className={styles.autoLayoutPaddingY} data-testid="auto-layout-padding-y">
            {verticalPaddingControl}
          </div>
          <div className={styles.autoLayoutPaddingX} data-testid="auto-layout-padding-x">
            {horizontalPaddingControl}
          </div>
        </div>
      ) : (
          <div className={styles.autoLayoutPaddingExpanded} data-testid="auto-layout-padding-expanded">
            <NumberScrub label="左边距" prefix="左" value={style.paddingLeft ?? '0px'} unit="px" min={0} onChange={(value) => apply({ paddingLeft: value })} />
            <NumberScrub label="上边距" prefix="上" value={style.paddingTop ?? '0px'} unit="px" min={0} onChange={(value) => apply({ paddingTop: value })} />
            <NumberScrub label="右边距" prefix="右" value={style.paddingRight ?? '0px'} unit="px" min={0} onChange={(value) => apply({ paddingRight: value })} />
            <NumberScrub label="下边距" prefix="下" value={style.paddingBottom ?? '0px'} unit="px" min={0} onChange={(value) => apply({ paddingBottom: value })} />
          </div>
      )}
      <div className={styles.autoLayoutPaddingLink}>
        <IconButton
          label={paddingLinked ? '分别设置四边距' : '联动左右和上下边距'}
          icon={paddingLinked ? Expand : Link2}
          active={!paddingLinked}
          placement="left"
          onClick={() => setPaddingLinked((linked) => !linked)}
        />
      </div>
    </div>
  ) : null;

  return (
    <div ref={panelRootRef} className={styles.root} data-testid="grapesjs-style-panel">
      <div className={styles.elementHeader}>
        <strong>{selection?.tagName.toUpperCase()}</strong>
        <code className={styles.selector}>{selection?.selector}</code>
      </div>

      <PropertySection title="位置">
        <LabeledControl label="对齐">
          <PositionAlignControls onAction={applyPositionAlignAction} />
        </LabeledControl>
        <LabeledControl label="定位">
          <div className={styles.positionGeometryGrid}>
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
            <IconButton
              label="绝对定位"
              icon={Scan}
              active={absolutePositionActive}
              placement="left"
              onClick={() => apply({ position: absolutePositionActive ? 'relative' : 'absolute' })}
            />
          </div>
        </LabeledControl>
        <LabeledControl label="尺寸">
          <div className={styles.dimensionStackGrid} data-testid="dimension-stack-grid">
            <DimensionControl
              axis="宽"
              value={style.width ?? 'auto'}
              tagName={selection?.tagName}
              allowHug={isTextElement}
              modeOverride={widthMode}
              onValueChange={(value) => apply({ width: value })}
              onModeChange={(mode) => { setWidthMode(mode); setDimensionMode('width', mode); }}
            />
            <DimensionControl
              axis="高"
              value={style.height ?? 'auto'}
              tagName={selection?.tagName}
              allowHug={isTextElement}
              modeOverride={heightMode}
              onValueChange={(value) => apply({ height: value })}
              onModeChange={(mode) => { setHeightMode(mode); setDimensionMode('height', mode); }}
            />
            <IconButton
              label="裁剪内容"
              icon={SquareDashed}
              active={(style.overflow ?? 'visible') === 'hidden'}
              placement="left"
              onClick={() => apply({ overflow: (style.overflow ?? 'visible') === 'hidden' ? 'visible' : 'hidden' })}
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
              onClick={() => apply({ transform: toggleFlipTransform(style.transform, 'x') })}
            />
            <IconButton
              label="垂直翻转"
              icon={FlipVertical2}
              onClick={() => apply({ transform: toggleFlipTransform(style.transform, 'y') })}
            />
            <IconButton label="重置变换" icon={Undo2} placement="left" onClick={() => apply({ transform: 'none' })} />
          </div>
        </LabeledControl>
      </PropertySection>

      {appearanceSection}

      <PropertySection
        title="自动布局"
        actions={(
          <IconButton
            label={autoLayoutActive ? '取消自动布局' : '开启自动布局'}
            icon={autoLayoutActive ? Minus : Plus}
            placement="left"
            onClick={() => setFlow(autoLayoutActive ? 'free' : 'row')}
          />
        )}
      >
        {autoLayoutBody}
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
        title="填充"
        collapsible
        expanded={fillExpanded}
        onToggle={() => setFillExpanded((e) => !e)}
        hasContent={iconColorVisible || fillVisible || isImgElement}
        onAdd={() => {
          if (isIconElement) {
            apply({ color: style.color && !isTransparent(style.color) ? style.color : '#333333' });
            return;
          }
          setFillMode('solid');
          apply({ backgroundColor: previousFill.current });
        }}
        onRemove={() => {
          if (isIconElement) {
            apply({ color: 'transparent' });
            return;
          }
          apply({ backgroundColor: 'transparent', backgroundImage: 'none', backgroundSize: '', backgroundRepeat: '' });
        }}
      >
        {isIconElement ? (
          <ColorProperty
            label="图标"
            value={style.color && !isTransparent(style.color) ? style.color : '#333333'}
            visible={iconColorVisible}
            onChange={(value) => apply({ color: value })}
            onVisibleChange={(visible) => apply({ color: visible ? (style.color && !isTransparent(style.color) ? style.color : '#333333') : 'transparent' })}
            onOpenPicker={(anchor) => openColorEditor(
              '图标颜色',
              style.color && !isTransparent(style.color) ? style.color : '#333333',
              (value) => apply({ color: value }),
              anchor,
            )}
          />
        ) : fillMode === 'solid' ? (
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
                onModeChange: handleFillModeChange,
                gradient,
                onGradientChange,
                imageState: buildImageFillState(),
                onImageChange: handleImageFillChange,
              },
            )}
          />
        ) : fillMode === 'gradient' ? (
          <div className={styles.gradientWrap}>
            <GradientEditor value={gradient} onChange={onGradientChange} />
          </div>
        ) : (
          <ImageFillSummary
            url={selectedImageUrl}
            onOpen={(anchor) => {
              setFillMode('image');
              openFillEditor(anchor, 'image');
            }}
          />
        )}
      </PropertySection>

      <PropertySection
        title="描边"
        collapsible
        expanded={strokeExpanded}
        onToggle={() => setStrokeExpanded((e) => !e)}
        hasContent={strokeVisible}
        onAdd={() => apply(buildStrokeAddPatch(previousStroke.current))}
        onRemove={() => {
          apply(CLEAR_STROKE_STYLES);
        }}
      >
        <ColorProperty
          label="描边"
          value={style.borderColor ?? previousStroke.current}
          visible={strokeVisible}
          onChange={(value) => {
            previousStroke.current = value;
            apply(buildStrokeColorPatch(value, style.borderTopWidth));
          }}
          onVisibleChange={(visible) => {
            if (!visible && style.borderColor) previousStroke.current = cssColorToHex(style.borderColor);
            apply(buildStrokeVisibilityPatch(visible, style.borderTopWidth));
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
              options={STROKE_POSITION_OPTIONS}
              onChange={(value) => {
                const pos = readStrokePosition(value);
                setStrokePosition(pos);
                apply(buildStrokePositionPatch({
                  position: pos,
                  width: style.borderTopWidth,
                  color: style.borderColor,
                  style: style.borderStyle,
                }));
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
              onChange={(value) => apply(buildStrokeWidthPatch(value))}
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
          commitEffectTransition(transitionEffectType('drop-shadow', effectContext()));
        }}
        onRemove={() => {
          commitEffectTransition({ nextType: 'none', styles: CLEAR_ALL_EFFECT_STYLES });
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
              : <WandSparkles size={16} aria-hidden="true" />}
          </button>
          <CompactSelect
            label="效果类型"
            value={effectType}
            options={EFFECT_OPTIONS}
            onChange={(value) => {
              commitEffectTransition(transitionEffectType(value as EffectType, effectContext()));
            }}
          />
          <IconButton
            label={effectType === 'none' ? '显示效果' : '隐藏效果'}
            icon={effectType === 'none' ? EyeOff : Eye}
            active={effectType !== 'none'}
            onClick={() => {
              commitEffectTransition(toggleEffectVisibility({ ...effectContext(), effectType }));
            }}
          />
          <IconButton
            label="移除效果"
            icon={Minus}
            placement="left"
            onClick={() => {
              commitEffectTransition({ nextType: 'none', styles: { boxShadow: 'none' } });
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
                  options={STROKE_STYLE_OPTIONS}
                  onChange={(value) => apply({ borderStyle: value })}
                />
            </LabeledControl>
            <LabeledControl label="端点" inline>
              <IconGroup
                value={strokeLinecap}
                options={[
                  { value: 'butt', label: '平头端点', icon: Minus },
                  { value: 'round', label: '圆头端点', icon: Droplet },
                  { value: 'square', label: '方头端点', icon: Square },
                ]}
                onChange={(value) => {
                  const next = readStrokeLinecap(value);
                  if (!next) return;
                  setStrokeLinecap(next);
                  apply({ strokeLinecap: next });
                }}
              />
            </LabeledControl>
            <LabeledControl label="连接" inline>
              <IconGroup
                value={strokeLinejoin}
                options={[
                  { value: 'miter', label: '尖角连接', icon: SquareDashed },
                  { value: 'round', label: '圆角连接', icon: Droplet },
                  { value: 'bevel', label: '斜角连接', icon: Scan },
                ]}
                onChange={(value) => {
                  const next = readStrokeLinejoin(value);
                  if (!next) return;
                  setStrokeLinejoin(next);
                  apply({ strokeLinejoin: next });
                }}
              />
            </LabeledControl>
            <div className={styles.twoColumn}>
              <NumberScrub label="虚线长度" prefix="线" value={strokeDashLength} unit="px" min={0} onChange={(value) => {
                setStrokeDashLength(value);
                apply(buildStrokeDashPatch(value, strokeDashGap));
              }} />
              <NumberScrub label="虚线间隔" prefix="隙" value={strokeDashGap} unit="px" min={0} onChange={(value) => {
                setStrokeDashGap(value);
                apply(buildStrokeDashPatch(strokeDashLength, value));
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
              onChange={(event) => {
                commitEffectTransition(transitionEffectType(event.target.value as EffectType, effectContext()));
              }}
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
