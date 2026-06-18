// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ColorProperty,
  ColorTextInput,
  SelectedColor,
  cssColorToHex,
  normalizeTypedCssColor,
} from '../../../src/components/grapesjs/color-fields';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('color-fields', () => {
  it('normalizes typed color values for panel fields', () => {
    expect(cssColorToHex('rgba(51, 102, 153, 0.4)')).toBe('#336699');
    expect(cssColorToHex('#33669980')).toBe('#336699');
    expect(normalizeTypedCssColor('336699')).toBe('#336699');
    expect(normalizeTypedCssColor('33669980')).toBe('rgba(51,102,153,0.5)');
    expect(normalizeTypedCssColor('rgb(51, 102, 153)')).toBe('#336699');
    expect(normalizeTypedCssColor('hsl(210 50% 40%)')).toBe('#336699');
    expect(normalizeTypedCssColor('33')).toBeNull();
  });

  it('lets users keep an incomplete color draft until blur', () => {
    const onChange = vi.fn();
    render(<ColorTextInput value="#336699" onChange={onChange} ariaLabel="颜色值" />);
    const input = screen.getByRole('textbox', { name: '颜色值' }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: '3' } });
    expect(input.value).toBe('3');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(input.value).toBe('336699');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits valid color text and visibility changes through ColorProperty', () => {
    const onChange = vi.fn();
    const onVisibleChange = vi.fn();
    const onOpenPicker = vi.fn();

    render(
      <ColorProperty
        label="填充"
        value="#336699"
        visible
        onChange={onChange}
        onVisibleChange={onVisibleChange}
        onOpenPicker={onOpenPicker}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: '填充颜色值' }), {
      target: { value: 'ff0000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '隐藏填充' }));
    fireEvent.click(screen.getByRole('button', { name: '填充取色器' }));

    expect(onChange).toHaveBeenCalledWith('#ff0000');
    expect(onVisibleChange).toHaveBeenCalledWith(false);
    expect(onOpenPicker).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
  });

  it('supports selected color batch selection and direct replacement', () => {
    const onToggle = vi.fn();
    const onOpenPicker = vi.fn();
    const onColorChange = vi.fn();

    render(
      <SelectedColor
        color="#336699"
        batchMode
        selected={false}
        onToggle={onToggle}
        onOpenPicker={onOpenPicker}
        onColorChange={onColorChange}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '选择颜色 #336699' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑颜色 #336699' }));
    fireEvent.change(screen.getByRole('textbox', { name: '颜色值 #336699' }), {
      target: { value: 'ff0000' },
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpenPicker).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
    expect(onColorChange).toHaveBeenCalledWith('#ff0000');
  });
});
