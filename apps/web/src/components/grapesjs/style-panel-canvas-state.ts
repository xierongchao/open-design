import {
  useCallback,
  useEffect,
  useState,
  type MutableRefObject,
} from 'react';
import type { GrapesjsEditorHandle } from './GrapesjsEditor';

export type StylePanelCanvasStyles = Record<string, string>;

export interface StylePanelCanvasState {
  canvasStyles: StylePanelCanvasStyles;
  canvasSize: { width: number; height: number };
  applyCanvasStyles(styles: StylePanelCanvasStyles): void;
  applyCanvasSize(width?: number, height?: number): void;
}

/**
 * Owns the no-selection canvas snapshot for StylePanel. It polls only while
 * the canvas panel is visible because GrapesJS may report the frame size a
 * moment after the editor handle is mounted.
 */
export function useStylePanelCanvasState(
  editorRef: MutableRefObject<GrapesjsEditorHandle | null>,
  hasSelection: boolean,
): StylePanelCanvasState {
  const [canvasStyles, setCanvasStyles] = useState<StylePanelCanvasStyles>({});
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const refreshCanvas = useCallback(() => {
    const state = editorRef.current?.getCanvasState?.();
    const stylesSnapshot = state?.styles ?? editorRef.current?.getCanvasStyles() ?? {};
    setCanvasStyles(stylesSnapshot);
    const size = state?.size;
    if (size) {
      setCanvasSize(size);
      return size.width > 0 && size.height > 0;
    }
    return false;
  }, [editorRef]);

  useEffect(() => {
    if (hasSelection) return undefined;
    let cancelled = false;
    let timeout: number | null = null;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      const ready = refreshCanvas();
      attempts += 1;
      if (!ready && attempts < 100) {
        timeout = window.setTimeout(tick, 50);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timeout != null) window.clearTimeout(timeout);
    };
  }, [hasSelection, refreshCanvas]);

  const applyCanvasStyles = useCallback(
    (styles: StylePanelCanvasStyles) => {
      editorRef.current?.setCanvasStyles(styles);
      window.setTimeout(refreshCanvas, 0);
    },
    [editorRef, refreshCanvas],
  );

  const applyCanvasSize = useCallback(
    (width?: number, height?: number) => {
      editorRef.current?.setCanvasSize(
        typeof width === 'number' && width > 0 ? width : undefined,
        typeof height === 'number' && height > 0 ? height : undefined,
      );
      window.setTimeout(refreshCanvas, 0);
    },
    [editorRef, refreshCanvas],
  );

  return {
    canvasStyles,
    canvasSize,
    applyCanvasStyles,
    applyCanvasSize,
  };
}
