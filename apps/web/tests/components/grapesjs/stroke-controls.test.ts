import { describe, expect, it } from 'vitest';

import {
  CLEAR_STROKE_STYLES,
  buildStrokeAddPatch,
  buildStrokeColorPatch,
  buildStrokeDashPatch,
  buildStrokePositionPatch,
  buildStrokeVisibilityPatch,
  buildStrokeWidthPatch,
  readStrokeLinecap,
  readStrokeLinejoin,
  readStrokePosition,
} from '../../../src/components/grapesjs/stroke-controls';

describe('stroke-controls', () => {
  it('builds add, remove, color, and visibility patches', () => {
    expect(buildStrokeAddPatch('#336699')).toEqual({
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: '#336699',
    });
    expect(CLEAR_STROKE_STYLES).toMatchObject({
      borderWidth: '0px',
      borderStyle: 'none',
      outline: '',
    });
    expect(buildStrokeColorPatch('#ff0000', '0px')).toEqual({
      borderColor: '#ff0000',
      borderStyle: 'solid',
      borderWidth: '1px',
    });
    expect(buildStrokeVisibilityPatch(true, undefined)).toEqual({
      borderStyle: 'solid',
      borderWidth: '1px',
    });
    expect(buildStrokeVisibilityPatch(false, '2px')).toEqual({
      borderStyle: 'none',
      borderWidth: '0px',
    });
  });

  it('maps stroke position choices to real CSS patches', () => {
    expect(buildStrokePositionPatch({
      position: 'center',
      width: '2px',
      color: '#336699',
      style: 'solid',
    })).toEqual({
      borderWidth: '2px',
      borderStyle: 'solid',
      outline: '',
      boxShadow: '',
    });
    expect(buildStrokePositionPatch({
      position: 'outside',
      width: '2px',
      color: '#336699',
      style: 'dashed',
    })).toEqual({
      outline: '2px dashed #336699',
      outlineOffset: '0px',
      borderWidth: '0px',
    });
    expect(buildStrokePositionPatch({
      position: 'inside',
      width: '2px',
      color: '#336699',
      style: 'solid',
    })).toEqual({
      boxShadow: 'inset 0 0 0 2px #336699',
      borderWidth: '0px',
      outline: '',
    });
  });

  it('builds width and dash patches', () => {
    expect(buildStrokeWidthPatch('3px')).toEqual({
      borderWidth: '3px',
      borderStyle: 'solid',
    });
    expect(buildStrokeWidthPatch('0px')).toEqual({
      borderWidth: '0px',
      borderStyle: 'none',
    });
    expect(buildStrokeDashPatch('8px', '4px')).toEqual({
      strokeDasharray: '8px 4px',
      borderStyle: 'dashed',
    });
    expect(buildStrokeDashPatch('0px', '4px')).toEqual({
      strokeDasharray: '',
      borderStyle: 'solid',
    });
  });

  it('parses constrained stroke option values safely', () => {
    expect(readStrokePosition('outside')).toBe('outside');
    expect(readStrokePosition('weird')).toBe('center');
    expect(readStrokeLinecap('round')).toBe('round');
    expect(readStrokeLinecap('weird')).toBeNull();
    expect(readStrokeLinejoin('bevel')).toBe('bevel');
    expect(readStrokeLinejoin('weird')).toBeNull();
  });
});
