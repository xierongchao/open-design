// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer manual edit viewport interactions', () => {
  it('uses compositor scale during the wheel gesture, then settles into CSS zoom', async () => {
    renderViewer();
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const shell = previewShell(canvas);
    const initialRasterScale = Number(shell.style.zoom);

    fireEvent.wheel(canvas, {
      clientX: 0,
      clientY: 0,
      deltaY: -80,
      metaKey: true,
    });

    expect(Number(shell.style.zoom)).toBe(initialRasterScale);
    expect(transformScale(shell)).toBeGreaterThan(1);
    await waitFor(() => {
      expect(screen.getByText('110%')).toBeTruthy();
      expect(Number(shell.style.zoom)).toBeGreaterThan(initialRasterScale);
      expect(transformScale(shell)).toBeCloseTo(1, 8);
    });
  });

  it('keeps the same content point under a canvas-originated wheel anchor', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('viewer-body') || this.classList.contains('manual-edit-canvas')) {
        return rect(100, 50, 1263, 800);
      }
      return rect(0, 0, 0, 0);
    });
    renderViewer();
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const shell = previewShell(canvas);
    await waitFor(() => expect(Number(shell.style.zoom)).toBeCloseTo(1263 / 1920, 5));
    const anchor = { x: 930, y: 260 };
    const before = visualViewportTransform(shell);
    const contentPoint = {
      x: (anchor.x - before.x) / before.scale,
      y: (anchor.y - before.y) / before.scale,
    };

    fireEvent.wheel(canvas, {
      clientX: anchor.x + 100,
      clientY: anchor.y + 50,
      deltaY: -80,
      metaKey: true,
    });

    const after = visualViewportTransform(shell);
    expect(after.x + contentPoint.x * after.scale).toBeCloseTo(anchor.x, 5);
    expect(after.y + contentPoint.y * after.scale).toBeCloseTo(anchor.y, 5);
  });

  it('does not change the visual viewport during the space keydown event', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('viewer-body') || this.classList.contains('manual-edit-canvas')) {
        return rect(100, 50, 1263, 800);
      }
      return rect(0, 0, 0, 0);
    });
    renderViewer();
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const shell = previewShell(canvas);
    await waitFor(() => expect(Number(shell.style.zoom)).toBeCloseTo(1263 / 1920, 5));
    const before = visualViewportTransform(shell);
    let duringKeydown: ReturnType<typeof visualViewportTransform> | null = null;
    window.addEventListener('keydown', () => {
      duringKeydown = visualViewportTransform(shell);
    }, { once: true });

    fireEvent.keyDown(window, { key: ' ', code: 'Space' });

    expect(duringKeydown).toEqual(before);
  });

  it('does not change the visual viewport when the iframe reports space held', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('viewer-body') || this.classList.contains('manual-edit-canvas')) {
        return rect(100, 50, 1263, 800);
      }
      return rect(0, 0, 0, 0);
    });
    renderViewer();
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const shell = previewShell(canvas);
    const iframe = shell.querySelector('iframe');
    if (!(iframe instanceof HTMLIFrameElement)) throw new Error('manual edit iframe not found');
    await waitFor(() => expect(Number(shell.style.zoom)).toBeCloseTo(1263 / 1920, 5));
    const before = visualViewportTransform(shell);
    let duringMessage: ReturnType<typeof visualViewportTransform> | null = null;
    window.addEventListener('message', () => {
      duringMessage = visualViewportTransform(shell);
    }, { once: true });

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'od-edit-space-held' },
      source: iframe.contentWindow,
    }));

    expect(duringMessage).toEqual(before);
  });

  it('keeps pointer panning at one screen pixel per pointer pixel after zooming in', async () => {
    renderViewer();
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const shell = previewShell(canvas);

    fireEvent.wheel(canvas, {
      clientX: 0,
      clientY: 0,
      deltaY: -580,
      metaKey: true,
    });
    await waitFor(() => {
      expect(Number(shell.style.zoom)).toBeGreaterThan(1.5);
      expect(transformScale(shell)).toBeCloseTo(1, 8);
    });
    const before = visualViewportTransform(shell);

    fireEvent.pointerDown(canvas, {
      button: 1,
      buttons: 4,
      clientX: 100,
      clientY: 120,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, {
      buttons: 4,
      clientX: 132,
      clientY: 150,
      pointerId: 1,
    });

    const after = visualViewportTransform(shell);
    expect(after.x - before.x).toBeCloseTo(32, 8);
    expect(after.y - before.y).toBeCloseTo(30, 8);
  });
});

function renderViewer() {
  const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
  ));
  render(
    <FileViewer
      projectId="project-1"
      projectKind="prototype"
      file={htmlPreviewFile()}
      liveHtml={source}
      defaultEditMode
    />,
  );
}

function previewShell(canvas: HTMLElement): HTMLElement {
  const shell = canvas.querySelector(':scope > div > div');
  if (!(shell instanceof HTMLElement)) throw new Error('manual edit preview shell not found');
  return shell;
}

function transformScale(shell: HTMLElement): number {
  return Number(shell.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1);
}

function visualViewportTransform(shell: HTMLElement) {
  const match = shell.style.transform.match(
    /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/,
  );
  if (!match) throw new Error(`unexpected viewport transform: ${shell.style.transform}`);
  const rasterScale = Number(shell.style.zoom || 1);
  return {
    x: Number(match[1]) * rasterScale,
    y: Number(match[2]) * rasterScale,
    scale: Number(match[3]) * rasterScale,
  };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function htmlPreviewFile(): ProjectFile {
  return {
    name: 'preview.html',
    path: 'preview.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    mime: 'text/html',
    kind: 'html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Preview',
      entry: 'preview.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}
