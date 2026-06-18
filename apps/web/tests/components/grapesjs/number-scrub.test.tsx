// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NumberScrub,
  fieldDisplay,
  pxToNum,
} from '../../../src/components/grapesjs/number-scrub';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('number-scrub', () => {
  it('parses CSS-like numeric values for panel math', () => {
    expect(pxToNum('12px')).toBe(12);
    expect(pxToNum('-4.5deg')).toBe(-4.5);
    expect(pxToNum('calc(100% - 4px)', 9)).toBe(9);
    expect(fieldDisplay('18.5px')).toBe('18.5');
  });

  it('commits keyboard changes without forcing a unit', () => {
    const onChange = vi.fn();
    render(<NumberScrub label="透明度" value="50" step={1} onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole('spinbutton', { name: '透明度' }), { key: 'ArrowUp' });

    expect(onChange).toHaveBeenCalledWith('51');
  });

  it('deduplicates repeated pointer moves that stay in the same scrub bucket', () => {
    const onChange = vi.fn();
    const { container } = render(
      <NumberScrub label="宽" prefix="W" value="10px" unit="px" onChange={onChange} />,
    );
    const prefix = container.querySelector('[data-tooltip="宽，拖拽调整"]');
    expect(prefix).toBeTruthy();

    fireEvent.pointerDown(prefix!, { clientX: 0 });
    fireEvent.pointerMove(document, { clientX: 4 });
    fireEvent.pointerMove(document, { clientX: 4 });
    fireEvent.pointerMove(document, { clientX: 7 });
    fireEvent.pointerUp(document);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, '11px');
    expect(onChange).toHaveBeenNthCalledWith(2, '12px');
  });
});
