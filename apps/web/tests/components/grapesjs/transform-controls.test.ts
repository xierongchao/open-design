import { describe, expect, it } from 'vitest';

import {
  parseRotation,
  replaceRotation,
  toggleFlipTransform,
} from '../../../src/components/grapesjs/transform-controls';

describe('transform-controls', () => {
  it('parses direct rotate and matrix rotation values', () => {
    expect(parseRotation(undefined)).toBe(0);
    expect(parseRotation('none')).toBe(0);
    expect(parseRotation('translateX(10px) rotate(-12.5deg)')).toBe(-12.5);
    expect(parseRotation('matrix(0, 1, -1, 0, 0, 0)')).toBe(90);
  });

  it('replaces the rotation while preserving other transform operations', () => {
    expect(replaceRotation(undefined, 15)).toBe('rotate(15deg)');
    expect(replaceRotation('none', 15)).toBe('rotate(15deg)');
    expect(replaceRotation('translateX(10px) rotate(5deg) scale(2)', 30)).toBe('translateX(10px) scale(2) rotate(30deg)');
  });

  it('toggles horizontal and vertical flips without stacking duplicate scales', () => {
    expect(toggleFlipTransform(undefined, 'x')).toBe('scaleX(-1)');
    expect(toggleFlipTransform('rotate(10deg)', 'y')).toBe('rotate(10deg) scaleY(-1)');
    expect(toggleFlipTransform('rotate(10deg) scaleX(-1)', 'x')).toBe('rotate(10deg)');
    expect(toggleFlipTransform('scaleY(-1)', 'y')).toBe('none');
    expect(toggleFlipTransform('scaleX(1) rotate(10deg)', 'x')).toBe('scaleX(-1) rotate(10deg)');
  });
});
