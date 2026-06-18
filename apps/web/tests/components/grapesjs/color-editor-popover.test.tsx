// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ColorEditor,
  cssColorToFormatInput,
  parseFormattedColorInput,
} from '../../../src/components/grapesjs/color-editor-popover';
import {
  colorValueToCss,
  parseCssToColorValue,
} from '../../../src/components/grapesjs/color-utils';
import type { GradientValue } from '../../../src/components/GradientEditor';

function installCanvasMock() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    fillStyle: '',
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }) as unknown as CanvasRenderingContext2D) as unknown as HTMLCanvasElement['getContext']);
}

function gradientValue(): GradientValue {
  return {
    type: 'linear',
    angle: 90,
    stops: [
      { id: 'start', color: '#000000', position: 0 },
      { id: 'end', color: '#ffffff', position: 100 },
    ],
  };
}

beforeEach(() => {
  installCanvasMock();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('color-editor-popover', () => {
  it('formats the active color for the selected input mode', () => {
    const value = parseCssToColorValue('#336699');

    expect(cssColorToFormatInput(value, 'hex')).toBe('336699');
    expect(cssColorToFormatInput(value, 'rgb')).toBe('51, 102, 153');
    expect(cssColorToFormatInput(value, 'hsl')).toBe('210, 50%, 40%');
  });

  it('preserves alpha for six-digit HEX and reads alpha from eight-digit HEX', () => {
    const sixDigit = parseFormattedColorInput('336699', 'hex', 0.4);
    const eightDigit = parseFormattedColorInput('33669980', 'hex', 0.4);

    expect(sixDigit?.a).toBe(0.4);
    expect(colorValueToCss(sixDigit!)).toBe('rgba(51,102,153,0.4)');
    expect(eightDigit?.a).toBeCloseTo(128 / 255);
    expect(colorValueToCss(eightDigit!)).toBe('rgba(51,102,153,0.5)');
  });

  it('rejects incomplete HEX drafts and parses RGB/HSL drafts', () => {
    const rgb = parseFormattedColorInput('51, 102, 153', 'rgb', 0.75);
    const hsl = parseFormattedColorInput('210, 50%, 40%', 'hsl', 0.25);

    expect(parseFormattedColorInput('36', 'hex', 1)).toBeNull();
    expect(colorValueToCss(rgb!)).toBe('rgba(51,102,153,0.75)');
    expect(colorValueToCss(hsl!)).toBe('rgba(51,102,153,0.25)');
  });

  it('keeps non-fill color pickers in solid mode only', () => {
    const onChange = vi.fn();

    render(<ColorEditor label="描边" value="#336699" onChange={onChange} />);

    expect(screen.queryByRole('group', { name: '颜色类型' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '描边颜色值' }), {
      target: { value: 'ff0000' },
    });

    expect(onChange).toHaveBeenCalledWith('#ff0000');
  });

  it('routes image fill controls through the extracted fill interface', () => {
    const onModeChange = vi.fn();
    const onImageChange = vi.fn();

    render(
      <ColorEditor
        label="填充"
        value="#336699"
        onChange={vi.fn()}
        supportsFillModes
        mode="image"
        onModeChange={onModeChange}
        gradient={gradientValue()}
        onGradientChange={vi.fn()}
        imageState={{
          url: 'data:image/png;base64,current',
          size: 'cover',
          repeat: 'no-repeat',
          position: 'center',
        }}
        onImageChange={onImageChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '渐变填充' }));
    fireEvent.change(screen.getByRole('combobox', { name: '尺寸' }), {
      target: { value: 'od-crop' },
    });

    expect(onModeChange).toHaveBeenCalledWith('gradient');
    expect(onImageChange).toHaveBeenCalledWith({ size: 'auto' });
  });
});
