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

  it('moves the mobile device shell upward even when the workspace was scrolled down', async () => {
    mockPreviewRect(100, 50, 1000, 800);
    renderViewer();
    const canvas = await screen.findByTestId('manual-edit-canvas');
    await selectViewport('Mobile');
    const shell = previewShell(canvas);
    canvas.scrollTop = 1200;
    const before = visualViewportTransform(shell);

    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    fireEvent.pointerDown(canvas, {
      button: 0,
      buttons: 1,
      clientX: 500,
      clientY: 600,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      clientX: 500,
      clientY: 200,
      pointerId: 1,
    });

    const after = visualViewportTransform(shell);
    expect(after.y - before.y).toBeCloseTo(-400, 8);
  });

  it('zooms the complete mobile device shell instead of only its HTML content', async () => {
    mockPreviewRect(100, 50, 1000, 800);
    renderViewer();
    const canvas = await screen.findByTestId('manual-edit-canvas');
    await selectViewport('Mobile');
    const shell = previewShell(canvas);
    const initialRasterScale = Number(shell.style.zoom);

    fireEvent.wheel(canvas, {
      clientX: 500,
      clientY: 400,
      deltaY: -80,
      metaKey: true,
    });

    await waitFor(() => {
      expect(Number(shell.style.zoom)).toBeGreaterThan(initialRasterScale);
      expect(transformScale(shell)).toBeCloseTo(1, 8);
    });
    expect(canvas.style.transform).toBe('');
  });

  it('restores the file canvas size after switching from mobile back to desktop', async () => {
    const source = '<!doctype html><html><head><meta name="od-canvas" content="width=1920,height=12605"></head><body>Long page</body></html>';
    renderViewer({
      source,
      useLiveHtml: false,
      projectId: 'canvas-project',
      fileName: 'admin-components.html',
    });
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const workspace = canvas.closest('.preview-viewport');
    if (!(workspace instanceof HTMLElement)) throw new Error('preview workspace not found');
    await waitFor(() => {
      expect(workspace.style.getPropertyValue('--preview-viewport-height')).toBe('12605px');
    });

    await selectViewport('Mobile');
    expect(workspace.style.getPropertyValue('--preview-viewport-width')).toBe('390px');
    expect(workspace.style.getPropertyValue('--preview-viewport-height')).toBe('844px');

    await selectViewport('Desktop');
    expect(workspace.style.getPropertyValue('--preview-viewport-width')).toBe('1920px');
    expect(workspace.style.getPropertyValue('--preview-viewport-height')).toBe('12605px');
  });
});

function renderViewer({
  source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>',
  useLiveHtml = true,
  projectId = 'project-1',
  fileName = 'preview.html',
}: {
  source?: string;
  useLiveHtml?: boolean;
  projectId?: string;
  fileName?: string;
} = {}) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
  ));
  render(
    <FileViewer
      projectId={projectId}
      projectKind="prototype"
      file={htmlPreviewFile(fileName)}
      liveHtml={useLiveHtml ? source : undefined}
      defaultEditMode
    />,
  );
}

function previewShell(canvas: HTMLElement): HTMLElement {
  const shell = canvas.querySelector('.manual-edit-frame-shell, :scope > div > div');
  if (!(shell instanceof HTMLElement)) throw new Error('manual edit preview shell not found');
  return shell;
}

async function selectViewport(name: 'Desktop' | 'Tablet' | 'Mobile') {
  fireEvent.click(screen.getByRole('button', { name: 'Preview viewport' }));
  fireEvent.click(screen.getByRole('option', { name }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Preview viewport' }).textContent).toContain(name);
  });
}

function mockPreviewRect(left: number, top: number, width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (
      this.classList.contains('viewer-body')
      || this.classList.contains('manual-edit-canvas')
      || this.classList.contains('preview-viewport')
    ) {
      return rect(left, top, width, height);
    }
    return rect(0, 0, 0, 0);
  });
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

function htmlPreviewFile(name = 'preview.html'): ProjectFile {
  return {
    name,
    path: name,
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    mime: 'text/html',
    kind: 'html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Preview',
      entry: name,
      renderer: 'html',
      exports: ['html'],
    },
  };
}
