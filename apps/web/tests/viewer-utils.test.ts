import { describe, expect, it } from 'vitest';
import {
  cancelManualEditPendingStyleSnapshot,
  effectivePreviewScale,
  manualEditPreviewShellStyle,
  desktopEditAutoFitTransform,
  manualEditPanFromPointer,
  manualEditZoomPanAtPoint,
  readArtboardNameFromSource,
  readCanvasSizeFromSource,
  readViewportPresetFromSource,
  writeArtboardNameToSource,
  writeCanvasSizeToSource,
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

describe('manualEditPreviewShellStyle', () => {
  it('uses a layout-stable transform without multiplying screen-space panning', () => {
    const result = manualEditPreviewShellStyle(
      'desktop', 1.0, { x: 0, y: 0 }, { width: 1263, height: 800 },
    );
    expect(result.width).toBe('var(--preview-viewport-width)');
    expect(result.height).toBe('var(--preview-viewport-height)');
    const fitScale = 1263 / 1920;
    const centerX = (1263 - 1920 * fitScale) / 2;
    const centerY = (800 - 1080 * fitScale) / 2;
    expect(result.zoom).toBeUndefined();
    expect(result.transform).toContain(`translate(${centerX}px, ${centerY}px)`);
    expect(result.transform).toContain(`scale(${fitScale})`);
    expect(result.willChange).toBe('auto');
  });

  it('applies user pan offset in translate', () => {
    const result = manualEditPreviewShellStyle(
      'desktop', 1.0, { x: 100, y: 50 }, { width: 1263, height: 800 },
    );
    const fitScale = 1263 / 1920;
    const visualX = (1263 - 1920 * fitScale) / 2 + 100;
    expect(result.transform).toContain(`translate(${visualX}px`);
  });

  it('applies settled user zoom through the transform', () => {
    const result = manualEditPreviewShellStyle(
      'desktop', 1.5, { x: 0, y: 0 }, { width: 1263, height: 800 },
    );
    expect(result.zoom).toBeUndefined();
    expect(result.transform).toContain(`scale(${(1263 / 1920) * 1.5})`);
    expect(result.willChange).toBe('auto');
  });

  it('keeps the compositor hint only while the viewport is moving', () => {
    const result = manualEditPreviewShellStyle(
      'desktop',
      1.5,
      { x: 100, y: 50 },
      { width: 1263, height: 800 },
      undefined,
      true,
    );
    const live = desktopEditAutoFitTransform(1263, 800, 1920, 1080, 1.5, { x: 100, y: 50 });
    expect(result.transform).toContain(
      `translate(${live.translateX}px, ${live.translateY}px)`,
    );
    expect(result.transform).toContain(`scale(${live.zoom})`);
    expect(result.willChange).toBe('transform');
  });

  it('falls back to a direct transform when canvasSize is undefined', () => {
    const result = manualEditPreviewShellStyle('desktop', 1.0);
    expect(result.zoom).toBeUndefined();
    expect(result.transform).toContain('translate');
    expect(result.transform).toContain('scale(1)');
    expect(result.transformOrigin).toBe('0 0');
  });

  it('scales the complete mobile device shell relative to its fitted size', () => {
    const result = manualEditPreviewShellStyle(
      'mobile',
      1.5,
      { x: 0, y: 0 },
      { width: 1000, height: 800 },
      { width: 1920, height: 12605 },
    );
    const fittedScale = Math.min(1, (1000 - 48) / 390, (800 - 48) / 844);
    expect(result.width).toBe('var(--preview-viewport-width)');
    expect(result.height).toBe('var(--preview-viewport-height)');
    expect(result.zoom).toBeUndefined();
    expect(result.transform).toContain(`scale(${fittedScale * 1.5})`);
  });
});

describe('manual edit viewport interaction math', () => {
  it('keeps the content point under the cursor fixed while desktop auto-fit center changes', () => {
    const container = { width: 1263, height: 800 };
    const content = { width: 1920, height: 1080 };
    const anchor = { x: 930, y: 260 };
    const currentPan = { x: 48, y: -32 };
    const currentUserScale = 1;
    const nextUserScale = 1.5;
    const current = desktopEditAutoFitTransform(
      container.width,
      container.height,
      content.width,
      content.height,
      currentUserScale,
      currentPan,
    );
    const contentPoint = {
      x: (anchor.x - current.translateX) / current.zoom,
      y: (anchor.y - current.translateY) / current.zoom,
    };

    const nextPan = manualEditZoomPanAtPoint({
      anchor,
      currentPan,
      currentUserScale,
      nextUserScale,
      container,
      content,
    });
    const next = desktopEditAutoFitTransform(
      container.width,
      container.height,
      content.width,
      content.height,
      nextUserScale,
      nextPan,
    );

    expect(next.translateX + contentPoint.x * next.zoom).toBeCloseTo(anchor.x, 8);
    expect(next.translateY + contentPoint.y * next.zoom).toBeCloseTo(anchor.y, 8);
  });

  it('maps pointer movement to one screen pixel of pan at every zoom level', () => {
    expect(manualEditPanFromPointer(
      { x: 40, y: -20 },
      { x: 100, y: 120 },
      { x: 126, y: 144 },
    )).toEqual({ x: 66, y: 4 });
  });
});

describe('manual edit pending style snapshots', () => {
  it('removes invalid fields without dropping unrelated fields', () => {
    expect(cancelManualEditPendingStyleSnapshot({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px', color: '#111111' },
    }, 'hero', ['fontSize'])).toEqual({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { color: '#111111' },
    });

    expect(cancelManualEditPendingStyleSnapshot({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px' },
    }, 'hero', ['fontSize'])).toBeNull();

    const otherTargetPending = {
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px' },
    };
    expect(cancelManualEditPendingStyleSnapshot(otherTargetPending, 'cta', ['fontSize'])).toBe(otherTargetPending);
  });
});

describe('od-canvas source metadata', () => {
  it('round-trips a mobile custom canvas size and viewport preset', () => {
    const source = '<!doctype html><html><head></head><body>Approval</body></html>';
    const updated = writeCanvasSizeToSource(source, { width: 390, height: 1344 }, 'mobile');

    expect(readCanvasSizeFromSource(updated)).toEqual({ width: 390, height: 1344 });
    expect(readViewportPresetFromSource(updated)).toBe('mobile');
    expect(updated).toContain('width=390,height=1344,viewport=mobile');
  });
});

describe('od-artboard source metadata', () => {
  it('round-trips a renamed GrapesJS artboard name', () => {
    const source = '<!doctype html><html><head></head><body>Approval</body></html>';
    const updated = writeArtboardNameToSource(source, '首页画板');

    expect(readArtboardNameFromSource(updated)).toBe('首页画板');
    expect(updated).toContain('name=%E9%A6%96%E9%A1%B5%E7%94%BB%E6%9D%BF');
  });

  it('updates an existing GrapesJS artboard name meta tag', () => {
    const source = '<html><head><meta name="od-artboard" content="name=Old"></head><body></body></html>';
    const updated = writeArtboardNameToSource(source, 'New Board');

    expect(readArtboardNameFromSource(updated)).toBe('New Board');
    expect(updated.match(/name=["']od-artboard["']/g)).toHaveLength(1);
  });
});
