import { parseCssColor } from './color-utils';
import { pxToNum } from './number-scrub';

export type EffectType = 'none' | 'inner-shadow' | 'drop-shadow' | 'layer-blur' | 'background-blur' | 'glass';

export interface ShadowDraft {
  x: string;
  y: string;
  blur: string;
  spread: string;
  color: string;
  opacity: string;
  inset: boolean;
}

export type StylePatch = Record<string, string>;

export const DEFAULT_SHADOW_DRAFT: ShadowDraft = {
  x: '0px',
  y: '4px',
  blur: '4px',
  spread: '0px',
  color: '#000000',
  opacity: '25%',
  inset: false,
};

export const DEFAULT_PREVIOUS_SHADOW = '0 4px 12px rgba(0, 0, 0, 0.18)';

export const EFFECT_OPTIONS: Array<{ value: EffectType; label: string }> = [
  { value: 'inner-shadow', label: '内阴影' },
  { value: 'drop-shadow', label: '投影' },
  { value: 'layer-blur', label: '图层模糊' },
  { value: 'background-blur', label: '背景模糊' },
  { value: 'glass', label: 'Glass' },
  { value: 'none', label: '无' },
];

export const CLEAR_ALL_EFFECT_STYLES: StylePatch = {
  boxShadow: 'none',
  filter: '',
  backdropFilter: '',
  WebkitBackdropFilter: '',
};

export function buildSingleShadow(params: ShadowDraft): string {
  const alpha = Math.max(0, Math.min(1, pxToNum(params.opacity, 25) / 100));
  const rgb = parseCssColor(params.color);
  const colorCss = alpha < 1
    ? `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${Math.round(alpha * 100) / 100})`
    : params.color;
  return `${params.inset ? 'inset ' : ''}${pxToNum(params.x, 0)}px ${pxToNum(params.y, 4)}px ${pxToNum(params.blur, 4)}px ${pxToNum(params.spread, 0)}px ${colorCss}`;
}

export interface EffectTransitionContext {
  effectVisible: boolean;
  currentBoxShadow?: string;
  previousShadow: string;
  shadowDraft: ShadowDraft;
}

export interface EffectTransition {
  nextType: EffectType;
  styles: StylePatch;
  rememberShadow?: string;
  shadowDraft?: ShadowDraft;
}

export function transitionEffectType(nextType: EffectType, context: EffectTransitionContext): EffectTransition {
  if (nextType === 'none') {
    return {
      nextType,
      rememberShadow: context.effectVisible && context.currentBoxShadow ? context.currentBoxShadow : undefined,
      styles: CLEAR_ALL_EFFECT_STYLES,
    };
  }
  if (nextType === 'drop-shadow') {
    return {
      nextType,
      styles: { boxShadow: context.previousShadow || buildSingleShadow(context.shadowDraft) },
    };
  }
  if (nextType === 'inner-shadow') {
    const shadowDraft = { ...context.shadowDraft, inset: true };
    return {
      nextType,
      shadowDraft,
      styles: { boxShadow: buildSingleShadow(shadowDraft) },
    };
  }
  if (nextType === 'layer-blur') {
    return { nextType, styles: { filter: 'blur(4px)' } };
  }
  if (nextType === 'background-blur') {
    return { nextType, styles: { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } };
  }
  return {
    nextType,
    styles: {
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      backgroundColor: 'rgba(255,255,255,0.1)',
    },
  };
}

export function toggleEffectVisibility(context: EffectTransitionContext & { effectType: EffectType }): EffectTransition {
  if (context.effectType === 'none') {
    return {
      nextType: 'drop-shadow',
      styles: { boxShadow: context.previousShadow },
    };
  }
  return {
    nextType: 'none',
    rememberShadow: context.effectVisible && context.currentBoxShadow ? context.currentBoxShadow : undefined,
    styles: { boxShadow: 'none' },
  };
}
