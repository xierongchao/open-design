// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PropertySection,
  popoverPosition,
} from '../../../src/components/grapesjs/style-panel-primitives';

afterEach(() => {
  cleanup();
});

describe('style-panel-primitives', () => {
  it('positions floating panels beside the anchor while staying in the viewport', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const anchor = document.createElement('button');
    anchor.getBoundingClientRect = vi.fn(() => ({
      top: 220,
      left: 360,
      right: 400,
      bottom: 252,
      width: 40,
      height: 32,
      x: 360,
      y: 220,
      toJSON: () => ({}),
    }));

    expect(popoverPosition(anchor, 120, 40, 200)).toEqual({
      top: 180,
      left: 230,
    });
  });

  it('turns an empty collapsible section into an add action', () => {
    const onAdd = vi.fn();
    render(
      <PropertySection title="填充" collapsible hasContent={false} onAdd={onAdd}>
        <p>Body</p>
      </PropertySection>,
    );

    expect(screen.queryByText('Body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '填充' }));
    fireEvent.click(screen.getByRole('button', { name: '添加属性' }));

    expect(onAdd).toHaveBeenCalledTimes(2);
  });
});
