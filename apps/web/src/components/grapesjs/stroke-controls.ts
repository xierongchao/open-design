import { pxToNum } from './number-scrub';

export type StrokePositionValue = 'inside' | 'center' | 'outside';
export type StrokeLinecapValue = 'butt' | 'round' | 'square';
export type StrokeLinejoinValue = 'miter' | 'round' | 'bevel';

export type StylePatch = Record<string, string>;

export const STROKE_POSITION_OPTIONS: Array<{ value: StrokePositionValue; label: string }> = [
  { value: 'inside', label: '内部' },
  { value: 'center', label: '居中' },
  { value: 'outside', label: '外部' },
];

export const STROKE_STYLE_OPTIONS = [
  { value: 'solid', label: '纯色' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'double', label: '双线' },
];

export const CLEAR_STROKE_STYLES: StylePatch = {
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
};

export function readStrokeLinecap(value: string | undefined): StrokeLinecapValue | null {
  return value === 'butt' || value === 'round' || value === 'square' ? value : null;
}

export function readStrokeLinejoin(value: string | undefined): StrokeLinejoinValue | null {
  return value === 'miter' || value === 'round' || value === 'bevel' ? value : null;
}

export function readStrokePosition(value: string): StrokePositionValue {
  return value === 'inside' || value === 'outside' ? value : 'center';
}

export function buildStrokeAddPatch(color: string): StylePatch {
  return { borderWidth: '1px', borderStyle: 'solid', borderColor: color };
}

export function buildStrokeColorPatch(color: string, currentTopWidth: string | undefined): StylePatch {
  return {
    borderColor: color,
    borderStyle: 'solid',
    borderWidth: currentTopWidth === '0px' ? '1px' : currentTopWidth ?? '1px',
  };
}

export function buildStrokeVisibilityPatch(visible: boolean, currentTopWidth: string | undefined): StylePatch {
  return {
    borderStyle: visible ? 'solid' : 'none',
    borderWidth: visible ? currentTopWidth || '1px' : '0px',
  };
}

export function buildStrokePositionPatch({
  position,
  width,
  color,
  style,
}: {
  position: StrokePositionValue;
  width: string | undefined;
  color: string | undefined;
  style: string | undefined;
}): StylePatch {
  const w = pxToNum(width ?? '0px', 0);
  const strokeColor = color ?? '#000000';
  const strokeStyle = style ?? 'solid';
  if (position === 'center') {
    return {
      borderWidth: w > 0 ? `${w}px` : '',
      borderStyle: strokeStyle,
      outline: '',
      boxShadow: '',
    };
  }
  if (position === 'outside') {
    return {
      outline: `${w}px ${strokeStyle} ${strokeColor}`,
      outlineOffset: '0px',
      borderWidth: '0px',
    };
  }
  return {
    boxShadow: `inset 0 0 0 ${w}px ${strokeColor}`,
    borderWidth: '0px',
    outline: '',
  };
}

export function buildStrokeWidthPatch(width: string): StylePatch {
  return {
    borderWidth: width,
    borderStyle: pxToNum(width) > 0 ? 'solid' : 'none',
  };
}

export function buildStrokeDashPatch(length: string, gap: string): StylePatch {
  const len = pxToNum(length, 0);
  const gapPx = pxToNum(gap, 0);
  if (len <= 0) return { strokeDasharray: '', borderStyle: 'solid' };
  return { strokeDasharray: `${len}px ${gapPx}px`, borderStyle: 'dashed' };
}
