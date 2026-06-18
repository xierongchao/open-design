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
    selectionChrome?: 'edit' | 'element-selection';
    onEscapeKey?: () => void;
    onSelectTargets?: (ids: string[]) => void;
    onViewportSizeChange?: (width: number, height: number) => void;
  }>(
    (props, ref) => {
      const heroElement = {
        nodeType: 1,
        getBoundingClientRect: () => ({
          left: 20,
          top: 30,
          width: 160,
          height: 40,
          right: 180,
          bottom: 70,
        }),
      };
      const heroComponent = {
        getAttributes: () => ({
          'data-od-id': 'hero-title',
          'data-od-label': 'Hero title',
          class: 'hero-title',
        }),
        get: (key: string) => key === 'tagName' ? 'div' : undefined,
        getEl: () => heroElement,
        components: () => ({ length: 0, get: () => null }),
        toHTML: () => '<div data-od-id="hero-title" class="hero-title">Hero title</div>',
      };
      const editor = {
        Components: {
          getComponents: () => ({
            length: 1,
            get: (index: number) => index === 0 ? heroComponent : null,
          }),
        },
        Canvas: {
          setZoom: () => {},
          getFrameEl: () => ({
            getBoundingClientRect: () => ({
              left: 0,
              top: 0,
              width: 390,
              height: 844,
              right: 390,
              bottom: 844,
            }),
          }),
          getDocument: () => ({
            defaultView: {
              getComputedStyle: () => ({ getPropertyValue: () => '' }),
            },
          }),
        },
        getSelected: () => heroComponent,
      };
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
        replaceColors: () => 0,
        getEditor: () => editor,
      }));
      return React.createElement('div', {
        className: props.className,
        'data-testid': 'mock-grapesjs-editor',
        'data-initial-width': String(props.initialViewport?.width ?? ''),
        'data-initial-height': String(props.initialViewport?.height ?? ''),
        'data-selection-chrome': props.selectionChrome ?? 'edit',
      }, React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-resize-canvas',
        onClick: () => props.onViewportSizeChange?.(props.initialViewport?.width ?? 1920, 1400),
      }, 'resize'), React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-select-target',
        onClick: () => props.onSelectTargets?.(['hero-title']),
      }, 'select'), React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-escape-key',
        onClick: () => props.onEscapeKey?.(),
      }, 'escape'));
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

  it('does not route GrapesJS tool switches through the legacy manual edit flush', async () => {
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
          initialFallbackManualEditMode
        />
      </I18nProvider>,
    );

    await screen.findByTestId('mock-grapesjs-editor');
    const drawButton = await screen.findByTestId('draw-overlay-toggle');
    expect(drawButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(drawButton);

    expect(drawButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('mock-grapesjs-editor')).toBeTruthy();
  });

  it('shows an add-to-chat action after selecting an element in element selection mode', async () => {
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
    const onEditModeChange = vi.fn();
    const onEditSelectionChange = vi.fn();
    const onStageBoardCommentAttachments = vi.fn(() => true);

    render(
      <I18nProvider initial="zh-CN">
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={htmlFile()}
          onEditModeChange={onEditModeChange}
          onEditSelectionChange={onEditSelectionChange}
          onStageBoardCommentAttachments={onStageBoardCommentAttachments}
        />
      </I18nProvider>,
    );

    const editor = await screen.findByTestId('mock-grapesjs-editor');
    expect(editor.getAttribute('data-selection-chrome')).toBe('edit');

    fireEvent.click(await screen.findByTestId('board-mode-toggle'));

    await waitFor(() => {
      expect(editor.getAttribute('data-selection-chrome')).toBe('element-selection');
    });
    expect(onEditModeChange).toHaveBeenLastCalledWith(false);
    expect(onEditSelectionChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByTestId('mock-select-target'));

    const addButton = await screen.findByTestId('element-selection-add-to-chat');
    expect(screen.getByTestId('element-selection-action').textContent).toContain('Hero title');
    await waitFor(() => {
      expect(onEditSelectionChange).toHaveBeenLastCalledWith(false);
    });

    fireEvent.click(addButton);

    await waitFor(() => {
      expect(onStageBoardCommentAttachments).toHaveBeenCalledTimes(1);
    });
    expect(onStageBoardCommentAttachments).toHaveBeenCalledWith([
      expect.objectContaining({
        elementId: 'hero-title',
        selector: 'div.hero-title',
        label: 'Hero title',
        htmlHint: '<div data-od-id="hero-title" class="hero-title">Hero title</div>',
        source: 'board-batch',
        commentContext: 'context',
      }),
    ]);
  });

  it('exits element selection mode when Escape is pressed inside the GrapesJS canvas', async () => {
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
    const onEditModeChange = vi.fn();
    const onEditSelectionChange = vi.fn();

    render(
      <I18nProvider initial="zh-CN">
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={htmlFile()}
          onEditModeChange={onEditModeChange}
          onEditSelectionChange={onEditSelectionChange}
          onStageBoardCommentAttachments={() => true}
        />
      </I18nProvider>,
    );

    const editor = await screen.findByTestId('mock-grapesjs-editor');

    fireEvent.click(await screen.findByTestId('board-mode-toggle'));
    await waitFor(() => {
      expect(editor.getAttribute('data-selection-chrome')).toBe('element-selection');
    });
    fireEvent.click(screen.getByTestId('mock-select-target'));
    expect(await screen.findByTestId('element-selection-add-to-chat')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mock-escape-key'));

    await waitFor(() => {
      expect(editor.getAttribute('data-selection-chrome')).toBe('edit');
    });
    expect(screen.queryByTestId('element-selection-add-to-chat')).toBeNull();
    expect(onEditModeChange).toHaveBeenLastCalledWith(false);
    expect(onEditSelectionChange).toHaveBeenLastCalledWith(false);
  });
});
