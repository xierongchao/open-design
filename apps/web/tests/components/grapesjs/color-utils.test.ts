import { describe, expect, it } from 'vitest';

import { colorValueToCss, rgbToHsv } from '../../../src/components/grapesjs/color-utils';

describe('grapesjs color utils', () => {
  it('preserves typed gray hex values through HSV conversion', () => {
    const hsv = rgbToHsv({ r: 246, g: 246, b: 246 });

    expect(colorValueToCss({ hsv, a: 1 })).toBe('#f6f6f6');
  });
});
