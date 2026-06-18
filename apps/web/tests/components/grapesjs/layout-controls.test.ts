import { describe, expect, it } from 'vitest';

import {
  buildAlignmentPatch,
  buildDimensionModePatch,
  buildFlowPatch,
  dimensionMode,
  flowFromStyles,
  axisAlignment,
} from '../../../src/components/grapesjs/layout-controls';

describe('layout-controls', () => {
  it('derives dimension modes from computed CSS values', () => {
    expect(dimensionMode(undefined)).toBe('hug');
    expect(dimensionMode('auto')).toBe('hug');
    expect(dimensionMode('fit-content')).toBe('hug');
    expect(dimensionMode('max-content')).toBe('hug');
    expect(dimensionMode('100%')).toBe('fill');
    expect(dimensionMode('calc(100% - 24px)')).toBe('fill');
    expect(dimensionMode('240px')).toBe('fixed');
  });

  it('treats replaced image dimensions as hug only when they round-trip as auto', () => {
    expect(dimensionMode(undefined, 'img')).toBe('hug');
    expect(dimensionMode('auto', 'img')).toBe('hug');
    expect(dimensionMode('fit-content', 'img')).toBe('fixed');
    expect(dimensionMode('50%', 'img')).toBe('fill');
  });

  it('derives the current flow from display and flex styles', () => {
    expect(flowFromStyles({ display: 'block' })).toBe('free');
    expect(flowFromStyles({ display: 'flex', flexDirection: 'column' })).toBe('column');
    expect(flowFromStyles({ display: 'inline-flex', flexDirection: 'row' })).toBe('row');
    expect(flowFromStyles({ display: 'flex', flexWrap: 'wrap', flexDirection: 'column' })).toBe('wrap');
  });

  it('builds flow patches for free, row, column, and wrap layout', () => {
    expect(buildFlowPatch('free')).toEqual({
      display: 'block',
      flexDirection: 'row',
      flexWrap: 'nowrap',
    });
    expect(buildFlowPatch('row')).toEqual({
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'nowrap',
    });
    expect(buildFlowPatch('column')).toEqual({
      display: 'flex',
      flexDirection: 'column',
      flexWrap: 'nowrap',
    });
    expect(buildFlowPatch('wrap')).toEqual({
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
    });
  });

  it('builds dimension mode patches using the current fixed value as fallback', () => {
    expect(buildDimensionModePatch({
      property: 'width',
      mode: 'hug',
      currentValue: '360px',
    })).toEqual({ width: 'fit-content' });
    expect(buildDimensionModePatch({
      property: 'height',
      mode: 'hug',
      currentValue: '240px',
      tagName: 'img',
    })).toEqual({ height: 'auto' });
    expect(buildDimensionModePatch({
      property: 'width',
      mode: 'fill',
      currentValue: '360px',
    })).toEqual({ width: '100%' });
    expect(buildDimensionModePatch({
      property: 'height',
      mode: 'fixed',
      currentValue: '',
    })).toEqual({ height: '40px' });
    expect(buildDimensionModePatch({
      property: 'width',
      mode: 'fixed',
      currentValue: '0px',
    })).toEqual({ width: '1px' });
  });

  it('maps alignment choices onto the active flex axes', () => {
    expect(axisAlignment('center')).toBe(1);
    expect(axisAlignment('flex-end')).toBe(2);
    expect(axisAlignment('end')).toBe(2);
    expect(axisAlignment('flex-start')).toBe(0);

    expect(buildAlignmentPatch({
      column: 2,
      row: 1,
      flow: 'column',
    })).toEqual({
      alignItems: 'flex-end',
      justifyContent: 'center',
    });
    expect(buildAlignmentPatch({
      column: 1,
      row: 2,
      flow: 'free',
    })).toEqual({
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'flex-end',
    });
    expect(buildAlignmentPatch({
      column: 0,
      row: 1,
      flow: 'row',
      display: 'inline-flex',
      flexDirection: 'row-reverse',
    })).toEqual({
      display: 'inline-flex',
      flexDirection: 'row-reverse',
      justifyContent: 'flex-start',
      alignItems: 'center',
    });
  });
});
