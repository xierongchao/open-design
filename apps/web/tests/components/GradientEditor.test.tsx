// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GradientEditor, type GradientValue } from '../../src/components/GradientEditor';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function baseGradient(): GradientValue {
  return {
    type: 'linear',
    angle: 90,
    stops: [
      { id: 'start', color: '#000000', position: 0 },
      { id: 'end', color: '#ffffff', position: 100 },
    ],
  };
}

describe('GradientEditor', () => {
  it('adds an interpolated selected stop when clicking the gradient bar', () => {
    const onChange = vi.fn();
    render(<GradientEditor value={baseGradient()} onChange={onChange} />);
    const bar = screen.getByLabelText('渐变色标条，点击添加色标');
    Object.defineProperty(bar, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 200,
        height: 12,
        right: 200,
        bottom: 12,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(bar, { clientX: 50 });

    expect(onChange).toHaveBeenCalledWith({
      ...baseGradient(),
      stops: [
        ...baseGradient().stops,
        expect.objectContaining({ color: '#404040', position: 25 }),
      ],
    });
  });

  it('falls back to the nearest stop color when inserted between non-hex stops', () => {
    const onChange = vi.fn();
    const value: GradientValue = {
      ...baseGradient(),
      stops: [
        { id: 'start', color: 'rgb(0, 0, 0)', position: 0 },
        { id: 'end', color: '#ffffff', position: 100 },
      ],
    };
    render(<GradientEditor value={value} onChange={onChange} />);
    const bar = screen.getByLabelText('渐变色标条，点击添加色标');
    Object.defineProperty(bar, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 200,
        height: 12,
        right: 200,
        bottom: 12,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(bar, { clientX: 40 });

    expect(onChange).toHaveBeenCalledWith({
      ...value,
      stops: [
        ...value.stops,
        expect.objectContaining({ color: 'rgb(0, 0, 0)', position: 20 }),
      ],
    });
  });

  it('marks the active stop in both the marker and row controls', () => {
    render(<GradientEditor value={baseGradient()} onChange={vi.fn()} />);

    fireEvent.pointerDown(screen.getByLabelText('色标 100%'));

    expect(screen.getByLabelText('色标 100%').className).toContain('ge-stop-marker-active');
    expect(screen.getByLabelText('色标 2 色值').closest('.ge-stop-row')?.className).toContain('ge-stop-row-active');
  });

  it('uses Chinese labels for the main gradient controls', () => {
    render(<GradientEditor value={baseGradient()} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '线性' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '径向' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ 添加色标' })).toBeTruthy();
    expect(screen.getByLabelText('渐变角度')).toBeTruthy();
  });
});
