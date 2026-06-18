import { describe, expect, it } from 'vitest';

import {
  CLEAR_ALL_EFFECT_STYLES,
  DEFAULT_PREVIOUS_SHADOW,
  DEFAULT_SHADOW_DRAFT,
  buildSingleShadow,
  toggleEffectVisibility,
  transitionEffectType,
} from '../../../src/components/grapesjs/effect-controls';

describe('effect-controls', () => {
  it('builds a single shadow layer from draft fields', () => {
    expect(buildSingleShadow({
      ...DEFAULT_SHADOW_DRAFT,
      x: '2px',
      y: '6px',
      blur: '12px',
      spread: '1px',
      color: '#336699',
      opacity: '40%',
      inset: true,
    })).toBe('inset 2px 6px 12px 1px rgba(51,102,153,0.4)');
  });

  it('transitions effect types into the style patch written by StylePanel', () => {
    expect(transitionEffectType('none', {
      effectVisible: true,
      currentBoxShadow: '0 1px 2px #000',
      previousShadow: DEFAULT_PREVIOUS_SHADOW,
      shadowDraft: DEFAULT_SHADOW_DRAFT,
    })).toEqual({
      nextType: 'none',
      rememberShadow: '0 1px 2px #000',
      styles: CLEAR_ALL_EFFECT_STYLES,
    });

    expect(transitionEffectType('background-blur', {
      effectVisible: false,
      previousShadow: DEFAULT_PREVIOUS_SHADOW,
      shadowDraft: DEFAULT_SHADOW_DRAFT,
    })).toEqual({
      nextType: 'background-blur',
      styles: {
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      },
    });

    expect(transitionEffectType('inner-shadow', {
      effectVisible: false,
      previousShadow: DEFAULT_PREVIOUS_SHADOW,
      shadowDraft: DEFAULT_SHADOW_DRAFT,
    })).toEqual({
      nextType: 'inner-shadow',
      shadowDraft: { ...DEFAULT_SHADOW_DRAFT, inset: true },
      styles: {
        boxShadow: 'inset 0px 4px 4px 0px rgba(0,0,0,0.25)',
      },
    });
  });

  it('toggles effect visibility while preserving the last visible shadow', () => {
    expect(toggleEffectVisibility({
      effectType: 'drop-shadow',
      effectVisible: true,
      currentBoxShadow: '0 2px 8px #000',
      previousShadow: DEFAULT_PREVIOUS_SHADOW,
      shadowDraft: DEFAULT_SHADOW_DRAFT,
    })).toEqual({
      nextType: 'none',
      rememberShadow: '0 2px 8px #000',
      styles: { boxShadow: 'none' },
    });

    expect(toggleEffectVisibility({
      effectType: 'none',
      effectVisible: false,
      previousShadow: '0 8px 24px rgba(0,0,0,0.2)',
      shadowDraft: DEFAULT_SHADOW_DRAFT,
    })).toEqual({
      nextType: 'drop-shadow',
      styles: { boxShadow: '0 8px 24px rgba(0,0,0,0.2)' },
    });
  });
});
