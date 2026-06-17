import { describe, expect, it } from 'vitest';

import {
  calculateCanvasFitToViewport,
  getGrapesjsIframeSelectionOutlineCss,
  getGrapesjsZoomStyleVars,
  upsertGrapesjsIframeSelectionStyle,
} from '../../../src/components/grapesjs/GrapesjsEditor';

describe('GrapesjsEditor canvas fit', () => {
  it('centers the HTML frame vertically when it fits inside the canvas', () => {
    expect(calculateCanvasFitToViewport({
      frameWidth: 390,
      frameHeight: 891,
      canvasWidth: 1000,
      canvasHeight: 1200,
    })).toEqual({
      zoom: 100,
      x: 0,
      y: 155,
    });
  });

  it('keeps a taller HTML frame top-aligned instead of hiding the top content', () => {
    expect(calculateCanvasFitToViewport({
      frameWidth: 390,
      frameHeight: 1192,
      canvasWidth: 1000,
      canvasHeight: 1200,
    })).toEqual({
      zoom: 100,
      x: 0,
      y: 0,
    });
  });
});

describe('GrapesjsEditor zoom style vars', () => {
  it('keeps iframe canvas outlines visually hairline at high zoom', () => {
    expect(getGrapesjsZoomStyleVars(300)).toEqual({
      zoomDecimal: 3,
      canvasHairline: '0.3333px',
      screenHairline: '1px',
    });
  });

  it('keeps host tool overlays in screen pixels instead of inverse zoom pixels', () => {
    expect(getGrapesjsZoomStyleVars(50)).toEqual({
      zoomDecimal: 0.5,
      canvasHairline: '2px',
      screenHairline: '1px',
    });
  });
});

describe('GrapesjsEditor iframe selection CSS', () => {
  it('overrides GrapesJS selected outline shorthand instead of only its width', () => {
    const css = getGrapesjsIframeSelectionOutlineCss();
    const selectedBlock = css.match(/\.gjs-selected,\s*\.gjs-hovered\s*\{[^}]*\}/)?.[0] ?? '';

    expect(selectedBlock).toContain('outline: var(--od-gjs-hairline, 1px) solid #3b82f6 !important;');
    expect(selectedBlock).not.toContain('outline-width: var(--od-gjs-hairline, 1px) !important;');
  });

  it('refreshes an existing iframe style tag instead of leaving stale outline rules', () => {
    const existingStyle = {
      parentNode: {},
      textContent: '.gjs-selected { outline-width: var(--od-gjs-hairline, 1px) !important; }',
      setAttribute() {},
    } as unknown as HTMLStyleElement;
    const fakeDoc = {
      head: {
        querySelector: () => existingStyle,
        appendChild: () => {
          throw new Error('existing style should be reused');
        },
      },
      createElement: () => {
        throw new Error('existing style should be reused');
      },
    } as unknown as Document;

    expect(upsertGrapesjsIframeSelectionStyle(fakeDoc, 'od-flex-child-hover')).toBe(true);
    expect(existingStyle.textContent).toContain('outline: var(--od-gjs-hairline, 1px) solid #3b82f6 !important;');
    expect(existingStyle.textContent).not.toContain('.gjs-selected { outline-width');
  });
});
