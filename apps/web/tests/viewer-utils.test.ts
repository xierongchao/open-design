import { describe, expect, it } from 'vitest';
import {
  effectivePreviewScale,
  manualEditPreviewShellStyle,
  desktopEditAutoFitTransform,
} from '../src/components/viewer-utils';

describe('effectivePreviewScale', () => {
  it('returns previewScale when canvasSize is missing', () => {
    expect(effectivePreviewScale('desktop', 1.0)).toBe(1.0);
  });

  it('computes fitScale * previewScale for desktop', () => {
    expect(effectivePreviewScale('desktop', 1.0, { width: 1263, height: 800 })).toBeCloseTo(1263 / 1920, 4);
  });

  it('applies user zoom on top of fitScale for desktop', () => {
    expect(effectivePreviewScale('desktop', 2.0, { width: 1263, height: 800 })).toBeCloseTo((1263 / 1920) * 2.0, 4);
  });

  it('clamps to 1 when container is larger than 1920x1080', () => {
    expect(effectivePreviewScale('desktop', 1.0, { width: 2000, height: 1200 })).toBe(1.0);
  });
});

describe('desktopEditAutoFitTransform', () => {
  it('scales and centers 1920x1080 in a smaller container', () => {
    const result = desktopEditAutoFitTransform(1263, 800, 1920, 1080, 1.0, { x: 0, y: 0 });
    const expectedZoom = 1263 / 1920;
    expect(result.zoom).toBeCloseTo(expectedZoom, 4);
    expect(result.translateX).toBeCloseTo(0, 2);
    expect(result.translateY).toBeCloseTo((800 - 1080 * expectedZoom) / 2, 2);
  });

  it('scales and centers when height is the constraint', () => {
    const result = desktopEditAutoFitTransform(1400, 600, 1920, 1080, 1.0, { x: 0, y: 0 });
    const expectedZoom = 600 / 1080;
    expect(result.zoom).toBeCloseTo(expectedZoom, 4);
    expect(result.translateX).toBeCloseTo((1400 - 1920 * expectedZoom) / 2, 2);
    expect(result.translateY).toBeCloseTo(0, 2);
  });

  it('returns zoom=1 and centers when container is larger than content', () => {
    const result = desktopEditAutoFitTransform(2000, 1200, 1920, 1080, 1.0, { x: 0, y: 0 });
    expect(result.zoom).toBe(1);
    expect(result.translateX).toBeCloseTo((2000 - 1920) / 2, 2);
    expect(result.translateY).toBeCloseTo((1200 - 1080) / 2, 2);
  });

  it('applies user zoom on top of fitScale', () => {
    const result = desktopEditAutoFitTransform(1263, 800, 1920, 1080, 1.5, { x: 0, y: 0 });
    expect(result.zoom).toBeCloseTo((1263 / 1920) * 1.5, 4);
  });

  it('adds user pan offset to center translate', () => {
    const result = desktopEditAutoFitTransform(1263, 800, 1920, 1080, 1.0, { x: 50, y: -30 });
    const fitScale = 1263 / 1920;
    expect(result.translateX).toBeCloseTo((1263 - 1920 * fitScale) / 2 + 50, 2);
    expect(result.translateY).toBeCloseTo((800 - 1080 * fitScale) / 2 - 30, 2);
  });

  it('returns fallback when container dimensions are zero', () => {
    const result = desktopEditAutoFitTransform(0, 0, 1920, 1080, 1.0, { x: 0, y: 0 });
    expect(result.zoom).toBe(1);
    expect(result.translateX).toBe(0);
    expect(result.translateY).toBe(0);
  });
});

describe('manualEditPreviewShellStyle (desktop)', () => {
  it('uses zoom for scaling and translate for centering', () => {
    const result = manualEditPreviewShellStyle(
      'desktop', 1.0, { x: 0, y: 0 }, { width: 1263, height: 800 },
    );
    expect(result.width).toBe('var(--preview-viewport-width)');
    expect(result.height).toBe('var(--preview-viewport-height)');
    const fitScale = 1263 / 1920;
    expect(result.zoom).toBeCloseTo(fitScale, 4);
    const centerX = (1263 - 1920 * fitScale) / 2;
    const centerY = (800 - 1080 * fitScale) / 2;
    expect(result.transform).toContain(`translate(${centerX.toFixed(2)}px, ${centerY.toFixed(2)}px)`);
    expect(result.transform).not.toContain('scale');
  });

  it('applies user pan offset in translate', () => {
    const result = manualEditPreviewShellStyle(
      'desktop', 1.0, { x: 100, y: 50 }, { width: 1263, height: 800 },
    );
    const fitScale = 1263 / 1920;
    expect(result.transform).toContain(`translate(${((1263 - 1920 * fitScale) / 2 + 100).toFixed(2)}px`);
  });

  it('applies user zoom in zoom property', () => {
    const result = manualEditPreviewShellStyle(
      'desktop', 1.5, { x: 0, y: 0 }, { width: 1263, height: 800 },
    );
    expect(result.zoom).toBeCloseTo((1263 / 1920) * 1.5, 4);
  });

  it('falls back to zoom + translate when canvasSize is undefined', () => {
    const result = manualEditPreviewShellStyle('desktop', 1.0);
    expect(result.zoom).toBe(1.0);
    expect(result.transform).toContain('translate');
    expect(result.transformOrigin).toBe('0 0');
  });

  it('keeps existing behavior for non-desktop viewports', () => {
    const result = manualEditPreviewShellStyle('tablet', 1.0, { x: 0, y: 0 });
    expect(result.width).toBe('var(--preview-viewport-width)');
    expect(result.height).toBe('var(--preview-viewport-height)');
    expect(result.transform).toContain('scale');
    expect(result.zoom).toBeUndefined();
  });
});
