// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const grapesjsMockState = vi.hoisted(() => ({
  setViewport: vi.fn(),
  setZoom: vi.fn((zoom: number) => { grapesjsMockState.zoom = zoom; }),
  insertIconComponent: vi.fn(),
  frameLeft: 0,
  frameTop: 0,
  zoom: 100,
}));

vi.mock('../../src/components/grapesjs/GrapesjsEditor', async () => {
  const React = await import('react');
  const MockGrapesjsEditor = React.forwardRef<Record<string, unknown>, {
    html: string;
    className?: string;
    initialViewport?: { width: number; height: number };
    selectionChrome?: 'edit' | 'element-selection';
    activeCanvasTool?: string;
    artboardName?: string;
    onCanvasToolChange?: (tool: string) => void;
    onCanvasCommentPin?: (point: { x: number; y: number }) => void;
    onCanvasViewportChange?: () => void;
    onEscapeKey?: () => void;
    onSelectTargets?: (ids: string[]) => void;
    onSelectionChange?: (info: { hasSelection: boolean; tagName: string; selector: string; componentType?: string; canvasTool?: string; styles: Record<string, string>; selectedColors: string[] }) => void;
    onViewportSizeChange?: (width: number, height: number) => void;
  }>(
    (props, ref) => {
      const selectedIdsRef = React.useRef<string[]>([]);
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
      const subtitleElement = {
        nodeType: 1,
        getBoundingClientRect: () => ({
          left: 24,
          top: 86,
          width: 220,
          height: 30,
          right: 244,
          bottom: 116,
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
      const subtitleComponent = {
        getAttributes: () => ({
          'data-od-id': 'hero-subtitle',
          'data-od-label': 'Hero subtitle',
          class: 'hero-subtitle',
        }),
        get: (key: string) => key === 'tagName' ? 'p' : undefined,
        getEl: () => subtitleElement,
        components: () => ({ length: 0, get: () => null }),
        toHTML: () => '<p data-od-id="hero-subtitle" class="hero-subtitle">Hero subtitle</p>',
      };
      const rootComponents = [heroComponent, subtitleComponent];
      const componentById = new Map<string, typeof heroComponent | typeof subtitleComponent>([
        ['hero-title', heroComponent],
        ['hero-subtitle', subtitleComponent],
      ]);
      const emitSelection = (ids: string[]) => {
        selectedIdsRef.current = ids;
        props.onSelectTargets?.(ids);
        props.onSelectionChange?.({
          hasSelection: ids.length > 0,
          tagName: ids.length > 0 ? 'div' : '',
          selector: ids.length > 0 ? 'div.hero-title' : '',
          styles: ids.length > 0 ? { width: '160px', height: '40px' } : {},
          selectedColors: [],
        });
      };
      const editor = {
        Components: {
          getComponents: () => ({
            length: rootComponents.length,
            get: (index: number) => rootComponents[index] ?? null,
          }),
        },
        Canvas: {
          setZoom: grapesjsMockState.setZoom,
          getZoom: () => grapesjsMockState.zoom,
          getFrameEl: () => ({
            getBoundingClientRect: () => ({
              left: grapesjsMockState.frameLeft,
              top: grapesjsMockState.frameTop,
              width: 390 * (grapesjsMockState.zoom / 100),
              height: 844 * (grapesjsMockState.zoom / 100),
              right: grapesjsMockState.frameLeft + 390 * (grapesjsMockState.zoom / 100),
              bottom: grapesjsMockState.frameTop + 844 * (grapesjsMockState.zoom / 100),
            }),
          }),
          getDocument: () => ({
            defaultView: {
              getComputedStyle: () => ({ getPropertyValue: () => '' }),
            },
          }),
        },
        getSelected: () => componentById.get(selectedIdsRef.current[0] ?? '') ?? null,
        getSelectedAll: () => selectedIdsRef.current
          .map((id) => componentById.get(id))
          .filter(Boolean),
      };
      const selectionSnapshot = () => {
        const hasSelection = selectedIdsRef.current.length > 0;
        return {
          hasSelection,
          tagName: hasSelection ? 'div' : '',
          selector: hasSelection ? 'div.hero-title' : '',
          styles: hasSelection ? { width: '160px', height: '40px' } : {},
          selectedColors: [],
        };
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
        insertIconComponent: grapesjsMockState.insertIconComponent,
        reselectCurrent: () => {},
        getSelectionSnapshot: selectionSnapshot,
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
        'data-active-tool': props.activeCanvasTool ?? 'cursor',
        'data-artboard-name': props.artboardName ?? '',
        'data-comment-pin-enabled': String(Boolean(props.onCanvasCommentPin)),
      }, React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-resize-canvas',
        onClick: () => props.onViewportSizeChange?.(props.initialViewport?.width ?? 1920, 1400),
      }, 'resize'), React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-select-target',
        onClick: () => emitSelection(['hero-title']),
      }, 'select'), React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-select-multiple-targets',
        onClick: () => emitSelection(['hero-title', 'hero-subtitle']),
      }, 'select'), React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-clear-targets',
        onClick: () => emitSelection([]),
      }, 'select'), React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-comment-pin',
        onClick: () => props.onCanvasCommentPin?.({ x: 88, y: 144 }),
      }, 'select'), React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-pan-canvas',
        onClick: () => {
          grapesjsMockState.frameLeft = 40;
          grapesjsMockState.frameTop = 25;
          props.onCanvasViewportChange?.();
        },
      }, 'select'), React.createElement('button', {
        type: 'button',
        'data-testid': 'mock-zoom-canvas',
        onClick: () => {
          grapesjsMockState.zoom = 50;
          props.onCanvasViewportChange?.();
        },
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
import type { PreviewComment, PreviewCommentTarget } from '../../src/types';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  grapesjsMockState.setViewport.mockReset();
  grapesjsMockState.setZoom.mockClear();
  grapesjsMockState.insertIconComponent.mockReset();
  grapesjsMockState.frameLeft = 0;
  grapesjsMockState.frameTop = 0;
  grapesjsMockState.zoom = 100;
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
    expect(await screen.findByTestId('grapesjs-bottom-toolbar')).toBeTruthy();
    const drawButton = await screen.findByTestId('grapesjs-tool-mark');
    expect(drawButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(drawButton);

    expect(drawButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('mock-grapesjs-editor')).toBeTruthy();
  });

  it('offers 1000 percent zoom for the GrapesJS canvas menu', async () => {
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
        <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />
      </I18nProvider>,
    );

    await screen.findByTestId('mock-grapesjs-editor');
    fireEvent.click(screen.getByRole('button', { name: /100%/ }));

    const zoom1000 = screen.getByRole('menuitem', { name: /1000%/ });
    fireEvent.click(zoom1000);

    expect(grapesjsMockState.setZoom).toHaveBeenCalledWith(1000);
  });

  it('keeps shape tools collapsed in a Chinese shortcut menu and activates placement tools from it', async () => {
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
        <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />
      </I18nProvider>,
    );

    const editor = await screen.findByTestId('mock-grapesjs-editor');
    expect(editor.getAttribute('data-artboard-name')).toBe('page');
    expect(screen.queryByTestId('grapesjs-tool-rectangle')).toBeNull();

    fireEvent.click(await screen.findByTestId('grapesjs-tool-shapes'));

    expect(await screen.findByTestId('grapesjs-shape-menu')).toBeTruthy();
    expect(screen.getByText('矩形')).toBeTruthy();
    expect(screen.getByText('R')).toBeTruthy();
    expect(screen.queryByText('箭头')).toBeNull();
    expect(screen.queryByText('连接线')).toBeNull();

    fireEvent.click(screen.getByTestId('grapesjs-tool-rectangle'));

    await waitFor(() => {
      expect(editor.getAttribute('data-active-tool')).toBe('rectangle');
    });
    expect(screen.queryByTestId('grapesjs-shape-menu')).toBeNull();
  });

  it('opens the built-in icon library and inserts a configured icon onto the artboard', async () => {
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
        <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />
      </I18nProvider>,
    );

    await screen.findByTestId('mock-grapesjs-editor');
    fireEvent.click(await screen.findByTestId('grapesjs-tool-icons'));

    expect(await screen.findByTestId('grapesjs-icon-library-panel')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /添加图标/i }).length).toBe(100);
    expect(screen.queryByRole('button', { name: '加载更多图标' })).toBeNull();
    expect(
      screen.getAllByRole('button', { name: /添加图标/i })[0]?.querySelector('svg')?.getAttribute('stroke'),
    ).toBe('currentColor');

    const iconList = screen.getByRole('list', { name: '图标列表' });
    Object.defineProperties(iconList, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 880 },
    });
    fireEvent.scroll(iconList);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /添加图标/i }).length).toBeGreaterThan(100);
    });

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索图标' }), {
      target: { value: 'mail' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '图标大小' }), {
      target: { value: '32' },
    });

    fireEvent.click((await screen.findAllByRole('button', { name: /添加图标 Mail/i }))[0] as HTMLElement);

    expect(grapesjsMockState.insertIconComponent).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Mail',
      size: 32,
      color: '#000000',
    }));
  });

  it('shows shortcut help without an in-panel close button', async () => {
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
        <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />
      </I18nProvider>,
    );

    await screen.findByTestId('mock-grapesjs-editor');
    fireEvent.click(await screen.findByTestId('grapesjs-shortcut-help-trigger'));

    const panel = await screen.findByTestId('grapesjs-shortcut-help-panel');
    expect(panel.querySelector('.grapesjs-shortcut-help-close')).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭快捷键说明' })).toBeNull();
  });

  it('loads remote icon results for Chinese search before inserting a configurable icon', async () => {
    const source = '<!doctype html><html><body><main>Design system</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.startsWith('/api/projects/project-1/raw/mobile/page.html')) {
        return new Response(source, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      if (url.startsWith('https://api.iconify.design/search')) {
        expect(url).toContain('query=mail');
        return new Response(JSON.stringify({ icons: ['icon-park-outline:mail'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="zh-CN">
        <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />
      </I18nProvider>,
    );

    await screen.findByTestId('mock-grapesjs-editor');
    fireEvent.click(await screen.findByTestId('grapesjs-tool-icons'));

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索图标' }), {
      target: { value: '邮件' },
    });

    expect(screen.getByText('正在加载远程图标...')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /添加图标 Mail Iconify/ }));

    expect(grapesjsMockState.insertIconComponent).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Mail',
      library: 'remote',
      remoteIcon: 'icon-park-outline:mail',
      remoteSvgUrl: 'https://api.iconify.design/icon-park-outline/mail.svg',
    }));
  });

  it('switches GrapesJS canvas tools from keyboard shortcuts', async () => {
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
        <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />
      </I18nProvider>,
    );

    const editor = await screen.findByTestId('mock-grapesjs-editor');

    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => {
      expect(editor.getAttribute('data-active-tool')).toBe('rectangle');
    });

    fireEvent.keyDown(window, { key: 'L', shiftKey: true });
    await waitFor(() => {
      expect(editor.getAttribute('data-active-tool')).toBe('line');
    });

    fireEvent.keyDown(window, { key: 'x' });
    await waitFor(() => {
      expect(editor.getAttribute('data-active-tool')).toBe('line');
    });
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

    fireEvent.click(await screen.findByTestId('grapesjs-tool-annotation'));

    await waitFor(() => {
      expect(editor.getAttribute('data-selection-chrome')).toBe('element-selection');
    });
    expect(onEditModeChange).toHaveBeenLastCalledWith(false);
    expect(onEditSelectionChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByTestId('mock-select-target'));

    const addButton = await screen.findByTestId('element-selection-add-to-chat');
    expect(screen.getByTestId('grapesjs-bottom-toolbar').contains(addButton)).toBe(true);
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

  it('restores the GrapesJS edit panel state when leaving element selection mode with a selection', async () => {
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
    const annotationTool = await screen.findByTestId('grapesjs-tool-annotation');

    fireEvent.click(annotationTool);
    await waitFor(() => {
      expect(editor.getAttribute('data-selection-chrome')).toBe('element-selection');
    });
    fireEvent.click(screen.getByTestId('mock-select-target'));
    expect(await screen.findByTestId('element-selection-add-to-chat')).toBeTruthy();

    fireEvent.click(annotationTool);

    await waitFor(() => {
      expect(editor.getAttribute('data-selection-chrome')).toBe('edit');
    });
    expect(screen.queryByTestId('element-selection-add-to-chat')).toBeNull();
    expect(onEditModeChange).toHaveBeenLastCalledWith(true);
    expect(onEditSelectionChange).toHaveBeenLastCalledWith(true);
  });

  it('opens and saves a free comment pin in GrapesJS comment mode', async () => {
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
    const onSavePreviewComment = vi.fn(async (target: PreviewCommentTarget, note: string): Promise<PreviewComment> => ({
      id: 'saved-pin',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      filePath: target.filePath,
      elementId: target.elementId,
      selector: target.selector,
      label: target.label,
      text: target.text,
      htmlHint: target.htmlHint,
      position: target.position,
      note,
      status: 'open',
      selectionKind: 'element',
      attachments: [],
      createdAt: 10,
      updatedAt: 10,
    }));

    render(
      <I18nProvider initial="zh-CN">
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={htmlFile()}
          onSavePreviewComment={onSavePreviewComment}
        />
      </I18nProvider>,
    );

    const commentsTool = await screen.findByTestId('grapesjs-tool-comments');
    fireEvent.click(commentsTool);
    await waitFor(() => {
      expect(commentsTool.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('mock-grapesjs-editor').getAttribute('data-comment-pin-enabled')).toBe('true');
    });
    fireEvent.click(await screen.findByTestId('mock-comment-pin'));
    fireEvent.click(await screen.findByTestId('mock-clear-targets'));

    const input = await screen.findByTestId('comment-popover-input');
    expect(await screen.findByTestId('comment-active-pin')).toBeTruthy();
    fireEvent.change(input, { target: { value: '这里需要说明' } });
    fireEvent.click(screen.getByTestId('comment-popover-save'));

    await waitFor(() => {
      expect(onSavePreviewComment).toHaveBeenCalledTimes(1);
    });
    expect(onSavePreviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        elementId: expect.stringMatching(/^pin-/),
        label: '评论',
        position: expect.objectContaining({ x: 88, y: 144, width: 1, height: 1 }),
      }),
      '这里需要说明',
      false,
      [],
    );
  });

  it('restores the GrapesJS edit panel state after toggling comment mode off', async () => {
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
        />
      </I18nProvider>,
    );

    const commentsTool = await screen.findByTestId('grapesjs-tool-comments');
    fireEvent.click(commentsTool);
    fireEvent.click(await screen.findByTestId('mock-select-target'));
    await waitFor(() => {
      expect(commentsTool.getAttribute('aria-pressed')).toBe('true');
    });

    fireEvent.click(commentsTool);

    await waitFor(() => {
      expect(commentsTool.getAttribute('aria-pressed')).toBe('false');
    });
    expect(onEditModeChange).toHaveBeenLastCalledWith(true);
    expect(onEditSelectionChange).toHaveBeenLastCalledWith(true);
  });

  it('keeps GrapesJS comment pins aligned when the canvas frame pans', async () => {
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
        <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />
      </I18nProvider>,
    );

    const commentsTool = await screen.findByTestId('grapesjs-tool-comments');
    fireEvent.click(commentsTool);
    fireEvent.click(await screen.findByTestId('mock-comment-pin'));

    const pin = await screen.findByTestId('comment-active-pin');
    expect(pin.style.left).toBe('88px');
    expect(pin.style.top).toBe('144px');

    fireEvent.click(screen.getByTestId('mock-pan-canvas'));

    await waitFor(() => {
      expect(pin.style.left).toBe('128px');
      expect(pin.style.top).toBe('169px');
    });

    fireEvent.click(screen.getByTestId('mock-zoom-canvas'));

    await waitFor(() => {
      expect(pin.style.left).toBe('84px');
      expect(pin.style.top).toBe('97px');
    });
  });

  it('stages multiple selected GrapesJS elements as one pod attachment', async () => {
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
    const onStageBoardCommentAttachments = vi.fn(() => true);

    render(
      <I18nProvider initial="zh-CN">
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={htmlFile()}
          onStageBoardCommentAttachments={onStageBoardCommentAttachments}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByTestId('grapesjs-tool-annotation'));
    fireEvent.click(await screen.findByTestId('mock-select-multiple-targets'));

    const addButton = await screen.findByTestId('element-selection-add-to-chat');
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(onStageBoardCommentAttachments).toHaveBeenCalledTimes(1);
    });
    expect(onStageBoardCommentAttachments).toHaveBeenCalledWith([
      expect.objectContaining({
        selectionKind: 'pod',
        memberCount: 2,
        source: 'board-batch',
        commentContext: 'context',
        podMembers: expect.arrayContaining([
          expect.objectContaining({
            elementId: 'hero-title',
            selector: 'div.hero-title',
            label: 'Hero title',
          }),
          expect.objectContaining({
            elementId: 'hero-subtitle',
            selector: 'p.hero-subtitle',
            label: 'Hero subtitle',
          }),
        ]),
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

    fireEvent.click(await screen.findByTestId('grapesjs-tool-annotation'));
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
    expect(onEditModeChange).toHaveBeenLastCalledWith(true);
    expect(onEditSelectionChange).toHaveBeenLastCalledWith(true);
  });
});
