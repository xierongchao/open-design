// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const grapesjsMockState = vi.hoisted(() => ({
  setViewport: vi.fn(),
}));

vi.mock('../../src/components/grapesjs/GrapesjsEditor', async () => {
  const React = await import('react');
  const MockGrapesjsEditor = React.forwardRef<Record<string, unknown>, {
    html: string;
    className?: string;
    initialViewport?: { width: number; height: number };
    onViewportSizeChange?: (width: number, height: number) => void;
  }>(
    (props, ref) => {
      React.useImperativeHandle(ref, () => ({
        getHtml: () => '',
        getCss: () => '',
        getDocument: () => props.html,
        setHtml: () => {},
        setReadOnly: () => {},
        destroy: () => {},
        applyStyle: () => {},
        getCanvasStyles: () => ({}),
        getCanvasState: () => ({ styles: {}, size: null }),
        setCanvasStyles: () => {},
        setViewport: grapesjsMockState.setViewport,
        setCanvasSize: () => {},
        setSelectedSrc: () => {},
        getSelectedSrc: () => '',
        insertImageComponent: () => {},
        reselectCurrent: () => {},
        setCropMode: () => {},
        collectColorsFromSelection: () => [],
        replaceColors: () => 0,
        getEditor: () => ({ Canvas: { setZoom: () => {} } }),
      }));
      return React.createElement('div', {
        className: props.className,
        'data-testid': 'mock-grapesjs-editor',
        'data-initial-width': String(props.initialViewport?.width ?? ''),
        'data-initial-height': String(props.initialViewport?.height ?? ''),
      }, React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-resize-canvas',
        onClick: () => props.onViewportSizeChange?.(props.initialViewport?.width ?? 1920, 1400),
      }, 'resize'));
    },
  );
  MockGrapesjsEditor.displayName = 'MockGrapesjsEditor';
  return { default: MockGrapesjsEditor };
});

import { FileViewer } from '../../src/components/FileViewer';
import { I18nProvider } from '../../src/i18n';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  grapesjsMockState.setViewport.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function htmlFile(): ProjectFile {
  return {
    name: 'mobile/page.html',
    path: 'mobile/page.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Mobile Page',
      entry: 'mobile/page.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}

function mobileCanvasSource(): string {
  return `<!doctype html>
<html>
  <head><meta name="od-canvas" content="width=380,height=1192,viewport=mobile"></head>
  <body style="background-color:#f6f6f6"><main>审批页</main></body>
</html>`;
}

describe('FileViewer GrapesJS interactive mode', () => {
  it('uses the saved mobile canvas size and exclusive mode highlight in interactive mode', async () => {
    const source = mobileCanvasSource();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.startsWith('/api/projects/project-1/raw/mobile/page.html')) {
        return new Response(source, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('', { status: 404 });
    }));

    render(
      <I18nProvider initial="zh-CN">
        <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />
      </I18nProvider>,
    );

    const editTab = await screen.findByRole('tab', { name: '编辑模式' });
    const interactiveTab = screen.getByRole('tab', { name: '交互模式' });
    const codeTab = screen.getByRole('tab', { name: '代码' });
    expect(editTab.classList.contains('active')).toBe(true);
    expect(interactiveTab.classList.contains('active')).toBe(false);
    expect(codeTab.classList.contains('active')).toBe(false);

    fireEvent.click(interactiveTab);

    await screen.findByTestId('grapesjs-interactive-frame');
    expect(editTab.classList.contains('active')).toBe(false);
    expect(interactiveTab.classList.contains('active')).toBe(true);
    expect(codeTab.classList.contains('active')).toBe(false);

    const viewport = screen.getByTestId('grapesjs-interactive-viewport');
    await waitFor(() => {
      expect(viewport.classList.contains('preview-viewport-mobile')).toBe(true);
      expect(viewport.style.getPropertyValue('--preview-viewport-width')).toBe('380px');
      expect(viewport.style.getPropertyValue('--preview-viewport-height')).toBe('1192px');
    });
    expect(screen.getByTestId('grapesjs-interactive-canvas')).toBeTruthy();
  });

  it('keeps a user-selected desktop viewport when a refetch still contains old mobile metadata', async () => {
    const source = mobileCanvasSource();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.startsWith('/api/projects/project-1/raw/mobile/page.html')) {
        return new Response(source, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onViewportPresetChange = vi.fn();
    const file = htmlFile();
    const { rerender } = render(
      <I18nProvider initial="zh-CN">
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={file}
          onViewportPresetChange={onViewportPresetChange}
        />
      </I18nProvider>,
    );

    const viewportButton = await screen.findByRole('button', { name: '预览视口' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '预览视口' }).textContent).toContain('移动端');
    });

    fireEvent.click(viewportButton);
    fireEvent.click(screen.getByRole('option', { name: /桌面端/ }));
    expect(screen.getByRole('button', { name: '预览视口' }).textContent).toContain('桌面端');

    rerender(
      <I18nProvider initial="zh-CN">
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={{ ...file, mtime: file.mtime + 1 }}
          fileViewportPreset="desktop"
          onViewportPresetChange={onViewportPresetChange}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('button', { name: '预览视口' }).textContent).toContain('桌面端');
    });
  });

  it('keeps a desktop custom canvas height after the right panel edits it', async () => {
    const source = '<!doctype html><html><body><main>Design system</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.startsWith('/api/projects/project-1/raw/mobile/page.html')) {
        return new Response(source, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('', { status: 404 });
    }));

    render(
      <I18nProvider initial="zh-CN">
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={htmlFile()}
          fileViewportPreset="desktop"
        />
      </I18nProvider>,
    );

    const editor = await screen.findByTestId('mock-grapesjs-editor');
    await waitFor(() => {
      expect(editor.getAttribute('data-initial-width')).toBe('1920');
      expect(editor.getAttribute('data-initial-height')).toBe('1080');
    });

    fireEvent.click(screen.getByTestId('mock-resize-canvas'));

    await waitFor(() => {
      expect(editor.getAttribute('data-initial-width')).toBe('1920');
      expect(editor.getAttribute('data-initial-height')).toBe('1400');
      expect(grapesjsMockState.setViewport).toHaveBeenLastCalledWith(1920, 1400);
    });
  });
});
