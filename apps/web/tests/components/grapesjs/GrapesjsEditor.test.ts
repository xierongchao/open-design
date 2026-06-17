import { describe, expect, it } from 'vitest';

import { calculateCanvasFitToViewport } from '../../../src/components/grapesjs/GrapesjsEditor';

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
