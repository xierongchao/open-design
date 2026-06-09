// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { emptyManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { ProjectFile } from '../../src/types';

const panelState = vi.hoisted(() => ({
  props: null as ComponentProps<typeof import('../../src/components/ManualEditPanel').ManualEditPanel> | null,
}));

vi.mock('../../src/components/ManualEditPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/ManualEditPanel')>();
  return {
    ...actual,
    ManualEditPanel: (props: ComponentProps<typeof actual.ManualEditPanel>) => {
      panelState.props = props;
      return <div data-testid="mock-manual-edit-panel" />;
    },
  };
});

import { FileViewer } from '../../src/components/FileViewer';

function openManualTools() {
  // Manual tools now live directly in the primary toolbar.
}

function clickManualTool(testId: string) {
  openManualTools();
  fireEvent.click(screen.getByTestId(testId));
}

function clickAgentTool(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
}

// Pins the inspector to a target. Hover no longer auto-selects, so selection
// rides the explicit click path (od-edit-select), matching the bridge sending
// it when the user clicks the hover affordance or a container/image body.
async function selectManualEditTarget(target = heroTarget()) {
  const frame = await waitFor(() => {
    const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    if (!node.contentWindow) throw new Error('Preview frame not ready');
    return node;
  });
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'od-edit-select', target },
      source: frame.contentWindow,
    }));
  });
  await waitFor(() => expect(panelState.props).not.toBeNull());
}

afterEach(() => {
  cleanup();
  panelState.props = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer manual edit history regressions', () => {
  it('flushes pending style edits before activating draw mode from manual edit', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero" style="color: #111111">Hero</h1></body></html>';
    let saveResolve!: (value: Response) => void;
    const saveResponse = new Promise<Response>((resolve) => {
      saveResolve = resolve;
    });
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        savedSources.push(payload.content);
        return saveResponse;
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(initialSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    clickManualTool('manual-edit-mode-toggle');
    await selectManualEditTarget();

    act(() => {
      panelState.props?.onStyleChange?.('hero', { color: '#ef4444' }, 'Style: Hero');
    });
    clickAgentTool('draw-overlay-toggle');

    await waitFor(() => expect(savedSources).toHaveLength(1));
    expect(savedSources[0]).toContain('rgb(239, 68, 68)');
    openManualTools();
    expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('draw-overlay-toggle').getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      saveResolve(new Response(JSON.stringify({ file: htmlPreviewFile() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      await saveResponse;
    });

    await waitFor(() => {
      openManualTools();
      expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('false');
    });
    expect(screen.getByTestId('draw-overlay-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the srcDoc iframe mounted when closing manual edit on a srcDoc-only preview', async () => {
    const source = '<!doctype html><html><body><script>localStorage.getItem("od");</script><main data-od-id="hero">Hero</main></body></html>';

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    clickManualTool('manual-edit-mode-toggle');
    await selectManualEditTarget();

    const editFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(editFrame.getAttribute('data-od-render-mode')).toBe('srcdoc');
    expect(editFrame.srcdoc).toContain('data-od-edit-bridge');

    // Exiting edit mode is the toolbar toggle's job — the panel's own close
    // button only collapses the inspector and stays in edit.
    clickManualTool('manual-edit-mode-toggle');

    await waitFor(() => {
      const previewFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(previewFrame).toBe(editFrame);
      expect(previewFrame.getAttribute('data-od-render-mode')).toBe('srcdoc');
      expect(previewFrame.srcdoc).toContain('Hero');
      expect(previewFrame.srcdoc).toContain('data-od-edit-bridge');
    });
  });

  it('uses the undone source snapshot for a follow-up edit after undo', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero" style="color: #111111">Hero</h1></body></html>';
    let persistedSource = initialSource;
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    clickManualTool('manual-edit-mode-toggle');
    await selectManualEditTarget();

    act(() => {
      panelState.props?.onApplyPatch(
        { kind: 'set-style', id: 'hero', styles: { color: '#ef4444' } },
        'Style: Hero',
      );
    });
    await waitFor(() => expect(savedSources).toHaveLength(1));
    expect(savedSources[0]).toContain('rgb(239, 68, 68)');

    act(() => {
      panelState.props?.onUndo();
    });
    await waitFor(() => expect(savedSources).toHaveLength(2));
    expect(savedSources[1]).toBe(initialSource);

    act(() => {
      panelState.props?.onApplyPatch(
        { kind: 'set-style', id: 'hero', styles: { backgroundColor: '#f97316' } },
        'Style: Hero',
      );
    });
    await waitFor(() => expect(savedSources).toHaveLength(3));

    expect(savedSources[2]).toContain('background-color: rgb(249, 115, 22)');
    expect(savedSources[2]).not.toContain('rgb(239, 68, 68)');
  });

  it('refreshes the manual edit canvas after non-style source patches', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1></body></html>';
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(initialSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();
    const getActivePreviewFrame = () => screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;

    await waitFor(() => {
      const frame = getActivePreviewFrame();
      expect(frame.getAttribute('data-od-active')).toBe('true');
      expect(frame.getAttribute('data-od-render-mode')).toBe('srcdoc');
      expect(panelState.props?.draft.fullSource).toContain('Hero');
    });
    act(() => {
      panelState.props?.onApplyPatch(
        { id: 'hero', kind: 'set-text', value: 'Updated hero' },
        'Content: Hero',
      );
    });

    await waitFor(() => expect(savedSources).toHaveLength(1));
    await waitFor(() => expect(panelState.props?.draft.fullSource).toContain('Updated hero'));
    await waitFor(() => {
      expect(getActivePreviewFrame().srcdoc).toContain('Updated hero');
    });
  });

  it('zooms the manual edit canvas from cursor wheel messages sent by the iframe', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const frame = await waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(node.getAttribute('data-od-render-mode')).toBe('srcdoc');
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-viewport-wheel',
          clientX: 120,
          clientY: 80,
          deltaY: -80,
        },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => expect(screen.getByText('110%')).toBeTruthy());
  });

  it('zooms the manual edit canvas from cursor wheel input on the canvas surface', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const canvas = await screen.findByTestId('manual-edit-canvas');

    fireEvent.wheel(canvas, {
      clientX: 48,
      clientY: 64,
      deltaY: -80,
      metaKey: true,
    });

    await waitFor(() => expect(screen.getByText('110%')).toBeTruthy());
  });

  it('uses fine-grained manual edit zoom for small wheel deltas', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const shell = canvas.querySelector(':scope > div > div') as HTMLElement | null;
    if (!shell) throw new Error('manual edit preview shell not found');

    fireEvent.wheel(canvas, {
      clientX: 48,
      clientY: 64,
      deltaY: -4,
      metaKey: true,
    });

    await waitFor(() => {
      const scale = Number(shell.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
      expect(scale).toBeGreaterThan(1);
      expect(scale).toBeLessThan(1.02);
    });
  });

  it('zooms the manual edit canvas with transform math instead of scrollbars', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const scrollTo = vi.fn();
    Object.defineProperty(canvas, 'scrollTo', { configurable: true, value: scrollTo });

    fireEvent.wheel(canvas, {
      clientX: 48,
      clientY: 64,
      deltaY: -80,
      metaKey: true,
    });

    await waitFor(() => expect(screen.getByText('110%')).toBeTruthy());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('pans the manual edit canvas with the middle mouse button', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const shell = canvas.querySelector(':scope > div > div') as HTMLElement | null;
    if (!shell) throw new Error('manual edit preview shell not found');

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
    fireEvent.pointerUp(canvas, {
      button: 1,
      buttons: 0,
      clientX: 132,
      clientY: 150,
      pointerId: 1,
    });

    expect(shell.style.transform).toContain('translate(32px, 30px)');
  });

  it('pans iframe-originated middle-button drags with stable screen coordinates', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const frame = await waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });
    const canvas = await screen.findByTestId('manual-edit-canvas');
    const shell = canvas.querySelector(':scope > div > div') as HTMLElement | null;
    if (!shell) throw new Error('manual edit preview shell not found');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-viewport-pan',
          phase: 'start',
          clientX: 100,
          clientY: 120,
          screenX: 500,
          screenY: 620,
        },
        source: frame.contentWindow,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-viewport-pan',
          phase: 'move',
          clientX: 100,
          clientY: 120,
          screenX: 526,
          screenY: 644,
        },
        source: frame.contentWindow,
      }));
    });

    expect(shell.style.transform).toContain('translate(26px, 24px)');
  });

  it('flushes a follow-up manual style edit queued while a prior save is in flight', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero" style="color: #111111">Hero</h1></body></html>';
    let persistedSource = initialSource;
    let firstSaveResolve!: (value: Response) => void;
    const firstSave = new Promise<Response>((resolve) => {
      firstSaveResolve = resolve;
    });
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        if (savedSources.length === 1) return firstSave;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    act(() => {
      panelState.props?.onStyleChange?.('hero', { color: '#ef4444' }, 'Style: Hero');
      panelState.props?.onSaveDraft();
    });
    await waitFor(() => expect(savedSources).toHaveLength(1));

    act(() => {
      panelState.props?.onStyleChange?.('hero', { backgroundColor: '#f97316' }, 'Style: Hero');
      panelState.props?.onSaveDraft();
    });

    await act(async () => {
      firstSaveResolve(new Response(JSON.stringify({ file: htmlPreviewFile() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      await firstSave;
    });

    await waitFor(() => expect(savedSources).toHaveLength(2));
    expect(savedSources[1]).toContain('color: rgb(239, 68, 68)');
    expect(savedSources[1]).toContain('background-color: rgb(249, 115, 22)');
  });

  it('clears the selected target after deleting an element', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1><p data-od-id="body">Body</p></body></html>';
    let persistedSource = initialSource;
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const postMessageSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

    await waitFor(() => expect(panelState.props?.selectedTarget?.id).toBe('hero'));
    expect(panelState.props?.draft.text).toBe('Hero');

    act(() => {
      panelState.props?.onApplyPatch(
        { id: 'hero', kind: 'remove-element' },
        'Delete element',
      );
    });

    await waitFor(() => expect(savedSources).toHaveLength(1));
    expect(savedSources[0]).not.toContain('data-od-id="hero"');
    expect(savedSources[0]).toContain('data-od-id="body"');
    // Clearing the selection closes the inspector: edit mode returns to a clean
    // canvas (no docked/pinned panel) and the iframe selection marker is reset.
    await waitFor(() => expect(screen.queryByTestId('mock-manual-edit-panel')).toBeNull());
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'od-edit-selected-target', id: null }),
      '*',
    );
    await waitFor(() => {
      expect((screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).srcdoc)
        .not.toContain('data-od-id="hero"');
    });
  });

  it('persists iframe drag reorders as DOM tree moves instead of margin edits', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1><p data-od-id="body">Body</p></body></html>';
    let persistedSource = initialSource;
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const frame = await waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });
    await selectManualEditTarget();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-move-end',
          id: 'hero',
          targetId: 'body',
          position: 'after',
        },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => expect(savedSources).toHaveLength(1));
    const savedSource = savedSources[0];
    if (!savedSource) throw new Error('Expected reordered source to be saved');
    expect(savedSource.indexOf('data-od-id="body"')).toBeLessThan(savedSource.indexOf('data-od-id="hero"'));
    expect(savedSource).not.toContain('margin-top');
    expect(savedSource).not.toContain('margin-left');
  });

  it('keeps shift-selected targets and persists batch style changes for all selected elements', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1><p data-od-id="body">Body</p></body></html>';
    let persistedSource = initialSource;
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const frame = await waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error('Preview frame not ready');
    const postedToFrame: unknown[] = [];
    const originalPostMessage = frameWindow.postMessage.bind(frameWindow);
    Object.defineProperty(frameWindow, 'postMessage', {
      configurable: true,
      value: (message: unknown) => {
      postedToFrame.push(message);
      },
    });

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-select', target: heroTarget() },
        source: frame.contentWindow,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-select', target: bodyTarget(), append: true },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => {
      expect(panelState.props?.selectedTargets?.map((target) => target.id)).toEqual(['hero', 'body']);
    });
    await waitFor(() => {
      expect(postedToFrame).toContainEqual({ type: 'od-edit-selected-targets', ids: ['hero', 'body'] });
    });
    const multiSyncIndex = postedToFrame.findIndex((message) => (
      isPlainMessage(message)
      && message.type === 'od-edit-selected-targets'
      && Array.isArray(message.ids)
      && message.ids.join(',') === 'hero,body'
    ));
    expect(multiSyncIndex).toBeGreaterThanOrEqual(0);
    expect(postedToFrame.slice(multiSyncIndex + 1)).not.toContainEqual({
      type: 'od-edit-selected-target',
      id: 'hero',
    });

    act(() => {
      panelState.props?.onStyleChange?.('__selection__', { opacity: '0.5' }, 'Style: 2 elements');
    });

    await waitFor(() => expect(savedSources).toHaveLength(1));
    const savedSource = savedSources[0];
    if (!savedSource) throw new Error('Expected batch style source to be saved');
    expect(savedSource).toContain('data-od-id="hero" style="opacity: 0.5;"');
    expect(savedSource).toContain('data-od-id="body" style="opacity: 0.5;"');
    Object.defineProperty(frameWindow, 'postMessage', {
      configurable: true,
      value: originalPostMessage,
    });
  });

  // D: undo limit toast should NOT appear when no edits were made
  it('does not show undo limit toast when pressing Ctrl+Z with no edit history', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));

    // Press Ctrl+Z without having made any edits — should NOT show the undo limit toast
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });

    // The undo limit toast message should not be present
    expect(screen.queryByText(/undo/i)).toBeNull();
  });
});

function isPlainMessage(value: unknown): value is { type?: string; ids?: unknown } {
  return typeof value === 'object' && value !== null;
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

function heroTarget(): ManualEditTarget {
  return {
    id: 'hero',
    kind: 'text',
    label: 'Hero',
    tagName: 'h1',
    className: '',
    text: 'Hero',
    rect: { x: 0, y: 0, width: 120, height: 40 },
    fields: { text: 'Hero' },
    attributes: { 'data-od-id': 'hero' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<h1 data-od-id="hero">Hero</h1>',
  };
}

function bodyTarget(): ManualEditTarget {
  return {
    id: 'body',
    kind: 'text',
    label: 'Body',
    tagName: 'p',
    className: '',
    text: 'Body',
    rect: { x: 0, y: 50, width: 160, height: 30 },
    fields: { text: 'Body' },
    attributes: { 'data-od-id': 'body' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<p data-od-id="body">Body</p>',
  };
}
