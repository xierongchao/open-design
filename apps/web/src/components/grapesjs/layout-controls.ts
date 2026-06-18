import { pxToNum } from './number-scrub';

export type FlowValue = 'free' | 'column' | 'row' | 'wrap';
export type DimensionMode = 'fixed' | 'hug' | 'fill';

export type StylePatch = Record<string, string>;

export const DIMENSION_MODE_OPTIONS: Array<{ value: DimensionMode; label: string }> = [
  { value: 'fixed', label: '固定' },
  { value: 'hug', label: '撑满' },
  { value: 'fill', label: '填充' },
];

export function dimensionMode(value: string | undefined, tagName?: string): DimensionMode {
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

export function flowFromStyles(style: Record<string, string>): FlowValue {
  const display = (style.display ?? 'block').split('::')[0] ?? 'block';
  if (display !== 'flex' && display !== 'inline-flex') return 'free';
  if ((style.flexWrap ?? 'nowrap') !== 'nowrap') return 'wrap';
  return (style.flexDirection ?? 'row').startsWith('column') ? 'column' : 'row';
}

export function axisAlignment(value: string | undefined): 0 | 1 | 2 {
  if (value === 'center') return 1;
  if (value === 'flex-end' || value === 'end') return 2;
  return 0;
}

export function buildFlowPatch(nextFlow: FlowValue): StylePatch {
  if (nextFlow === 'free') return { display: 'block', flexDirection: 'row', flexWrap: 'nowrap' };
  if (nextFlow === 'column') return { display: 'flex', flexDirection: 'column', flexWrap: 'nowrap' };
  if (nextFlow === 'wrap') return { display: 'flex', flexDirection: 'row', flexWrap: 'wrap' };
  return { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' };
}

export function buildDimensionModePatch({
  property,
  mode,
  currentValue,
  tagName,
}: {
  property: 'width' | 'height';
  mode: DimensionMode;
  currentValue: string | undefined;
  tagName?: string;
}): StylePatch {
  const isImg = (tagName ?? '').toLowerCase() === 'img';
  if (mode === 'hug') return { [property]: isImg ? 'auto' : 'fit-content' };
  if (mode === 'fill') return { [property]: '100%' };
  const current = pxToNum(currentValue, property === 'width' ? 100 : 40);
  return { [property]: `${Math.max(1, current)}px` };
}

export function buildAlignmentPatch({
  column,
  row,
  flow,
  display,
  flexDirection,
}: {
  column: 0 | 1 | 2;
  row: 0 | 1 | 2;
  flow: FlowValue;
  display?: string;
  flexDirection?: string;
}): StylePatch {
  const axisValues = ['flex-start', 'center', 'flex-end'];
  const horizontal = axisValues[column] ?? 'flex-start';
  const vertical = axisValues[row] ?? 'flex-start';
  if (flow === 'column') {
    return { alignItems: horizontal, justifyContent: vertical };
  }
  return {
    display: flow === 'free' ? 'flex' : display ?? 'flex',
    flexDirection: flow === 'free' ? 'row' : flexDirection ?? 'row',
    justifyContent: horizontal,
    alignItems: vertical,
  };
}
