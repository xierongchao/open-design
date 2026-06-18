// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';

import type { GrapesjsEditorHandle } from '../../../src/components/grapesjs/GrapesjsEditor';
import { useStylePanelCanvasState } from '../../../src/components/grapesjs/style-panel-canvas-state';

function editorRef(handle: Partial<GrapesjsEditorHandle>): MutableRefObject<GrapesjsEditorHandle | null> {
  return { current: handle as GrapesjsEditorHandle };
}

async function flushTimeouts() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('useStylePanelCanvasState', () => {
  it('reads canvas styles and size while no element is selected', async () => {
    const ref = editorRef({
      getCanvasState: vi.fn(() => ({
        styles: { backgroundColor: 'rgb(246, 246, 246)' },
        size: { width: 390, height: 1190 },
      })),
    });

    const { result } = renderHook(() => useStylePanelCanvasState(ref, false));

    await waitFor(() => {
      expect(result.current.canvasSize).toEqual({ width: 390, height: 1190 });
      expect(result.current.canvasStyles.backgroundColor).toBe('rgb(246, 246, 246)');
    });
  });

  it('applies canvas styles and refreshes the snapshot', async () => {
    let styles = { backgroundColor: 'rgb(246, 246, 246)' };
    const ref = editorRef({
      getCanvasState: vi.fn(() => ({
        styles,
        size: { width: 390, height: 1190 },
      })),
      setCanvasStyles: vi.fn((next: Record<string, string>) => {
        styles = { ...styles, ...next };
      }),
    });
    const { result } = renderHook(() => useStylePanelCanvasState(ref, false));

    act(() => {
      result.current.applyCanvasStyles({ backgroundColor: '#ffffff' });
    });
    await flushTimeouts();

    expect(ref.current?.setCanvasStyles).toHaveBeenCalledWith({ backgroundColor: '#ffffff' });
    expect(result.current.canvasStyles.backgroundColor).toBe('#ffffff');
  });

  it('normalizes invalid canvas size inputs before writing', async () => {
    const ref = editorRef({
      getCanvasState: vi.fn(() => ({
        styles: {},
        size: { width: 390, height: 1190 },
      })),
      setCanvasSize: vi.fn(),
    });
    const { result } = renderHook(() => useStylePanelCanvasState(ref, false));

    act(() => {
      result.current.applyCanvasSize(0, -1);
    });
    await flushTimeouts();

    expect(ref.current?.setCanvasSize).toHaveBeenCalledWith(undefined, undefined);
  });
});
