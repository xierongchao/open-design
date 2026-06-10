// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { DesignFilesPanel, type DesignFilesNavState } from '../../src/components/DesignFilesPanel';
import type { ProjectFile, ProjectFileKind, ProjectFolder } from '../../src/types';

function folder(path: string): ProjectFolder {
  return { name: path.split('/').pop() ?? path, path, type: 'dir', size: 0, mtime: 1700000000 };
}

// Stub localStorage so the component's view-state persistence writes to an
// in-memory store. Cleared in beforeEach so no test bleeds state into the next.
const lsStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => lsStore.get(key) ?? null,
  setItem: (key: string, value: string) => { lsStore.set(key, value); },
  removeItem: (key: string) => { lsStore.delete(key); },
  clear: () => { lsStore.clear(); },
});

beforeEach(() => {
  lsStore.clear();
});

function extForKind(kind: ProjectFileKind): string {
  if (kind === 'html') return 'html';
  if (kind === 'image') return 'png';
  if (kind === 'sketch') return 'sketch.json';
  if (kind === 'text') return 'txt';
  if (kind === 'code') return 'ts';
  if (kind === 'pdf') return 'pdf';
  return 'bin';
}

function file(overrides: Partial<ProjectFile> & Pick<ProjectFile, 'name'>): ProjectFile {
  return {
    path: overrides.name,
    type: 'file',
    size: 1024,
    mtime: Date.now(),
    kind: 'html',
    mime: 'text/html',
    ...overrides,
  };
}

function generateFiles(count: number): ProjectFile[] {
  const kinds: ProjectFileKind[] = ['html', 'image', 'sketch', 'text', 'code', 'pdf'];
  return Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length]!;
    return file({
      name: `file-${i + 1}.${extForKind(kind)}`,
      kind,
      size: 1024 * (i + 1),
      mtime: Date.now() - i * 60_000,
      mime: 'text/plain',
    });
  });
}

function renderPanel(
  files: ProjectFile[],
  overrides: Partial<ComponentProps<typeof DesignFilesPanel>> = {},
) {
  const onOpenFile = vi.fn();
  const onDeleteFiles = vi.fn();
  const onClearUploadError = vi.fn();
  const result = render(
    <DesignFilesPanel
      projectId="test-project"
      files={files}
      liveArtifacts={[]}
      onRefreshFiles={vi.fn()}
      onOpenFile={onOpenFile}
      onOpenLiveArtifact={vi.fn()}
      onRenameFile={vi.fn()}
      onDeleteFile={vi.fn()}
      onDeleteFiles={onDeleteFiles}
      onUpload={vi.fn()}
      onUploadFiles={vi.fn()}
      onPaste={vi.fn()}
      onNewSketch={vi.fn()}
      onClearUploadError={onClearUploadError}
      {...overrides}
    />,
  );
  return { ...result, onDeleteFiles, onOpenFile, onClearUploadError };
}

function createDataTransfer(projectFiles: string[] = []) {
  const store = new Map<string, string>();
  if (projectFiles.length > 0) {
    store.set('application/x-open-design-project-files', JSON.stringify(projectFiles));
  }
  return {
    types: projectFiles.length > 0 ? ['application/x-open-design-project-files'] : [],
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? '',
  };
}

function dispatchDragWithY(
  target: HTMLElement,
  type: 'dragover' | 'drop',
  dataTransfer: ReturnType<typeof createDataTransfer>,
  clientY: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
}

describe('DesignFilesPanel sections', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not show grouping, sort, filter, or pagination chrome', () => {
    renderPanel(generateFiles(60));

    expect(screen.queryByRole('group', { name: 'Group by' })).toBeNull();
    expect(document.querySelector('.df-table')).toBeNull();
    expect(document.querySelector('.df-th-sortable')).toBeNull();
    expect(document.querySelector('.df-kind-filter')).toBeNull();
    expect(document.querySelector('.df-pagination')).toBeNull();
    expect(document.querySelector('.df-page-btn')).toBeNull();
  });

  it('renders a single-line toolbar with file actions and no up/refresh buttons', () => {
    renderPanel([file({ name: 'page.html', kind: 'html' })]);

    expect(document.querySelector('.df-topbar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(document.querySelector('.df-up-btn')).toBeNull();
    expect(document.querySelector('.df-refresh-control')).toBeNull();
    expect(screen.getByTestId('design-files-upload-trigger')).toBeTruthy();
  });

  it('renders project files in a table with kind metadata instead of section groups', () => {
    renderPanel([
      file({ name: 'page.html', kind: 'html', mime: 'text/html' }),
      file({ name: 'chart.png', kind: 'image', mime: 'image/png' }),
    ]);

    const header = document.querySelector('.df-file-table-header')?.textContent ?? '';
    expect(header).toContain('Name');
    expect(header).toContain('Kind');
    expect(header).toContain('Size');
    expect(header).toContain('Modified');
    expect(document.querySelector('.df-section-label')).toBeNull();
    expect(screen.getByTestId('design-file-row-page.html')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-chart.png')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-page.html').querySelector('.df-row-kind')?.textContent).toBe('HTML page');
    expect(screen.getByTestId('design-file-row-chart.png').querySelector('.df-row-kind')?.textContent).toBe('Image');
  });

  it('shows stylesheets as their own table kind without creating a separate section', () => {
    renderPanel([
      file({ name: 'styles.css', kind: 'code', mime: 'text/css' }),
      file({ name: 'app.ts', kind: 'code', mime: 'text/typescript' }),
    ]);

    expect(document.querySelector('.df-section-label')).toBeNull();

    const cssRow = screen.getByTestId('design-file-row-styles.css');
    expect(cssRow.querySelector('.df-row-sub')?.textContent).toBe('Stylesheet');
    expect(cssRow.querySelector('.df-row-kind')?.textContent).toBe('Stylesheet');
    const tsRow = screen.getByTestId('design-file-row-app.ts');
    expect(tsRow.querySelector('.df-row-sub')?.textContent).toBe('Script');
    expect(tsRow.querySelector('.df-row-kind')?.textContent).toBe('Script');
  });

  it('shows type and size in separate table columns', () => {
    renderPanel([file({ name: 'chart.png', kind: 'image', size: 4096 })]);

    const row = screen.getByTestId('design-file-row-chart.png');
    expect(row.querySelector('.df-row-sub')?.textContent).toBe('Image');
    expect(row.querySelector('.df-row-kind')?.textContent).toBe('Image');
    expect(row.querySelector('.df-row-size')?.textContent).toContain('KB');
  });

  it('renders the file tree and table without the old preview footer', () => {
    renderPanel([file({ name: 'page.html', kind: 'html' })]);

    expect(document.querySelector('.df-browser')).toBeTruthy();
    expect(document.querySelector('.df-tree-pane')).toBeTruthy();
    expect(document.querySelector('.df-file-table-panel')).toBeTruthy();
    expect(document.querySelector('.df-useful-info-label')).toBeNull();
    expect(document.querySelector('[data-testid="design-file-preview"]')).toBeNull();
  });
});

describe('DesignFilesPanel large list', () => {
  afterEach(() => cleanup());

  it('renders all rows at once (no pagination)', () => {
    const { container } = renderPanel(generateFiles(500));
    expect(container.querySelectorAll('.df-file-row').length).toBe(500);
  });

  it('renders 500 files within a reasonable time', () => {
    const files = generateFiles(500);
    const start = performance.now();
    renderPanel(files);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('DesignFilesPanel selection', () => {
  afterEach(() => cleanup());

  it('shows the batch bar and passes every selected file to batch delete', () => {
    const files = generateFiles(3);
    const { container, onDeleteFiles } = renderPanel(files);
    const rows = Array.from(container.querySelectorAll('.df-file-row'));

    const firstName = rows[0]!.getAttribute('data-testid')!.replace(/^design-file-row-/, '');
    const secondName = rows[1]!.getAttribute('data-testid')!.replace(/^design-file-row-/, '');
    fireEvent.click(rows[0]!.querySelector('.df-row-check')!);
    fireEvent.click(rows[1]!.querySelector('.df-row-check')!);

    expect(container.querySelector('[data-testid="design-files-batch-bar"]')).toBeTruthy();

    fireEvent.click(container.querySelector('[data-testid="design-files-batch-delete"]')!);
    expect(onDeleteFiles).toHaveBeenCalledTimes(1);
    expect(onDeleteFiles).toHaveBeenCalledWith([firstName, secondName]);
  });

  it('does not preview or open files from row controls', () => {
    const files = generateFiles(1);
    const { container, onOpenFile } = renderPanel(files);
    const row = container.querySelector('.df-file-row')!;

    fireEvent.click(row.querySelector('.df-row-check')!);
    expect(container.querySelector('[data-testid="design-file-preview"]')).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();

    fireEvent.click(row.querySelector('.df-row-menu')!);
    expect(container.querySelector('[data-testid="design-file-preview"]')).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('uses non-control row targets to focus and open without rendering a preview panel', () => {
    const files = generateFiles(1);
    const { container, onOpenFile } = renderPanel(files);
    const row = container.querySelector('.df-file-row')!;

    fireEvent.click(row.querySelector('.df-row-icon')!);
    expect(row.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-testid="design-file-preview"]')).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();

    fireEvent.doubleClick(row.querySelector('.df-row-name-btn')!);
    expect(onOpenFile).toHaveBeenCalledWith('file-1.html');
    onOpenFile.mockClear();

    fireEvent.doubleClick(row.querySelector('.df-row-time')!);
    expect(onOpenFile).toHaveBeenCalledWith('file-1.html');
  });
});

describe('DesignFilesPanel folders', () => {
  afterEach(() => cleanup());

  it('creates a nested folder in the current directory', async () => {
    const onCreateFolder = vi.fn(async (path: string) => folder(path));
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
    ], { onCreateFolder });

    fireEvent.click(screen.getByTestId('design-folder-row-assets').querySelector('.df-row-name-btn')!);
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.change(screen.getByPlaceholderText('Folder name'), {
      target: { value: 'icons' },
    });
    fireEvent.submit(screen.getByTestId('design-folder-create-row'));

    expect(onCreateFolder).toHaveBeenCalledWith('assets/icons');
  });

  it('moves the dragged file into a folder', () => {
    const onMoveFiles = vi.fn();
    const { container } = renderPanel([
      file({ name: 'index.html', kind: 'html' }),
      file({ name: 'assets/logo.png', kind: 'image' }),
    ], { onMoveFiles });

    const fileRow = screen.getByTestId('design-file-row-index.html');
    const folderRow = screen.getByTestId('design-folder-row-assets');
    fireEvent.dragStart(fileRow, {
      dataTransfer: createDataTransfer(),
    });
    fireEvent.drop(folderRow, {
      dataTransfer: createDataTransfer(['index.html']),
    });

    expect(onMoveFiles).toHaveBeenCalledWith(['index.html'], 'assets');
    expect(container.querySelector('[data-testid="design-file-preview"]')).toBeNull();
  });

  it('moves the dragged folder into another folder', async () => {
    const onRenameFolder = vi.fn(async (_from: string, to: string) => folder(to));
    renderPanel([
      file({ name: 'images/photo.png', kind: 'image' }),
      file({ name: 'documents/readme.txt', kind: 'text' }),
    ], { onRenameFolder });

    const imagesRow = screen.getByTestId('design-folder-row-images');
    const documentsRow = screen.getByTestId('design-folder-row-documents');
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(imagesRow, { dataTransfer });
    fireEvent.drop(documentsRow, { dataTransfer });

    await waitFor(() => {
      expect(onRenameFolder).toHaveBeenCalledWith('images', 'documents/images');
    });
  });

  it('reorders sibling folders without moving them on disk', async () => {
    const onRenameFolder = vi.fn(async (_from: string, to: string) => folder(to));
    renderPanel([
      file({ name: 'a/page.html', kind: 'html' }),
      file({ name: 'b/page.html', kind: 'html' }),
      file({ name: 'c/page.html', kind: 'html' }),
    ], { onRenameFolder });

    const cRow = screen.getByTestId('design-folder-row-c');
    const aRow = screen.getByTestId('design-folder-row-a');
    Object.defineProperty(aRow, 'getBoundingClientRect', {
      value: () => ({
        top: 100,
        bottom: 130,
        left: 0,
        right: 240,
        width: 240,
        height: 30,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(cRow, { dataTransfer });
    dispatchDragWithY(aRow, 'dragover', dataTransfer, 102);
    dispatchDragWithY(aRow, 'drop', dataTransfer, 102);

    await waitFor(() => {
      const names = Array.from(document.querySelectorAll('.df-dir-row .df-tree-name'))
        .map((node) => node.textContent);
      expect(names).toEqual(['c', 'a', 'b']);
    });
    expect(onRenameFolder).not.toHaveBeenCalled();
  });
});

describe('DesignFilesPanel directory navigation', () => {
  afterEach(() => {
    cleanup();
  });

  it('collapses nested files into a single folder row at root without inline counts', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'assets/icons/star.svg', kind: 'image' }),
    ]);

    const dirRows = document.querySelectorAll('.df-dir-row');
    expect(dirRows.length).toBe(1);
    expect(dirRows[0]!.textContent).toContain('assets');
    expect(dirRows[0]!.querySelector('.df-tree-count')).toBeNull();
    expect(document.querySelector('.df-tree-root')?.querySelector('.df-tree-count')).toBeNull();
  });

  it('pins folders into a Folders section', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    expect(document.querySelector('.df-tree-head')?.textContent).toContain('Folders');
    expect(document.querySelector('.df-tree-head-count')).toBeNull();
  });

  it('uses a disclosure control on the root folder row', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    const rootToggle = document.querySelector<HTMLButtonElement>('.df-tree-root .df-tree-toggle')!;
    expect(rootToggle).toBeTruthy();
    expect(rootToggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(rootToggle);
    expect(screen.queryByTestId('design-folder-row-assets')).toBeNull();

    fireEvent.click(rootToggle);
    expect(screen.getByTestId('design-folder-row-assets')).toBeTruthy();
  });

  it('keeps folder destructive actions in the right-click menu', async () => {
    const onDeleteFolder = vi.fn(async () => true);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
    ], { onDeleteFolder });

    const folderRow = screen.getByTestId('design-folder-row-assets');
    expect(folderRow.querySelector('.df-dir-delete')).toBeNull();

    fireEvent.contextMenu(folderRow);
    fireEvent.click(screen.getByTestId('design-folder-delete-assets'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onDeleteFolder).toHaveBeenCalledWith('assets');
  });

  it('renames folders from the right-click menu', async () => {
    const onRenameFolder = vi.fn(async (_from: string, to: string) => folder(to));
    vi.spyOn(window, 'prompt').mockReturnValue('pages');
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
    ], { onRenameFolder });

    fireEvent.contextMenu(screen.getByTestId('design-folder-row-assets'));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onRenameFolder).toHaveBeenCalledWith('assets', 'pages');
  });

  it('clicking a folder row navigates into it and shows only basenames and nested dirs', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'assets/icons/star.svg', kind: 'image' }),
    ]);

    fireEvent.click(document.querySelector('.df-dir-row .df-row-name-btn')!);

    expect(document.querySelector('.df-breadcrumbs')).toBeTruthy();
    expect(document.querySelector('.df-breadcrumb-current')?.textContent).toBe('assets');

    const fileRow = screen.getByTestId('design-file-row-assets/logo.png');
    expect(fileRow.querySelector('.df-row-name')?.textContent).toBe('logo.png');
    expect(fileRow.querySelector('.df-row-name')?.textContent).not.toContain('assets/');

    expect(screen.getByTestId('design-folder-row-assets/icons')).toBeTruthy();
  });

  it('always renders the root breadcrumb on the default-root view', () => {
    // Regression: managed-storage projects have currentDir==='' and no
    // rootDirName, which previously collapsed the whole breadcrumb nav to null
    // and left the toolbar blank on the left for the most common path. The root
    // crumb must always render, falling back to the t('designFiles.crumbs')
    // label when no rootDirName exists.
    renderPanel([file({ name: 'top.html', kind: 'html' })]);

    expect(document.querySelector('.df-breadcrumbs')).toBeTruthy();
    expect(document.querySelector('.df-breadcrumb-current')?.textContent).toBe('project');
  });

  it('shows rootDirName as the root breadcrumb when one is provided', () => {
    renderPanel([file({ name: 'top.html', kind: 'html' })], {
      rootDirName: 'my-folder',
    });

    expect(document.querySelector('.df-breadcrumb-current')?.textContent).toBe('my-folder');
  });

  it('clicking the root breadcrumb navigates back to root', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    fireEvent.click(document.querySelector('.df-dir-row .df-row-name-btn')!);
    expect(document.querySelector('.df-breadcrumbs')).toBeTruthy();

    fireEvent.click(document.querySelector('.df-breadcrumb-btn')!);

    expect(document.querySelector('.df-breadcrumb-current')?.textContent).not.toBe('assets');
    expect(screen.getByTestId('design-file-row-top.html')).toBeTruthy();
    expect(screen.getByTestId('design-folder-row-assets')).toBeTruthy();
  });

  it('keeps subdirectory files out of the root file table', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    expect(screen.getByTestId('design-folder-row-assets')).toBeTruthy();
    expect(screen.queryByTestId('design-file-row-assets/logo.png')).toBeNull();
    expect(screen.getByTestId('design-file-row-top.html')).toBeTruthy();
  });

  it('preserves the current directory when remounted with navState from a previous render', () => {
    let saved: DesignFilesNavState | undefined;

    function makePanel(nav?: DesignFilesNavState) {
      return (
        <DesignFilesPanel
          projectId="test-project"
          files={[
            file({ name: 'assets/logo.png', kind: 'image' }),
            file({ name: 'top.html', kind: 'html' }),
          ]}
          liveArtifacts={[]}
          navState={nav}
          onNavStateChange={(state) => { saved = state; }}
          onRefreshFiles={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenLiveArtifact={vi.fn()}
          onRenameFile={vi.fn()}
          onDeleteFile={vi.fn()}
          onDeleteFiles={vi.fn()}
          onUpload={vi.fn()}
          onUploadFiles={vi.fn()}
          onPaste={vi.fn()}
          onNewSketch={vi.fn()}
        />
      );
    }

    const { unmount } = render(makePanel());

    fireEvent.click(document.querySelector('.df-dir-row .df-row-name-btn')!);
    expect(document.querySelector('.df-breadcrumb-current')?.textContent).toBe('assets');

    unmount();
    render(makePanel(saved));

    expect(document.querySelector('.df-breadcrumb-current')?.textContent).toBe('assets');
    expect(screen.getByTestId('design-file-row-assets/logo.png')).toBeTruthy();
  });

  it('navigates up one level via the parent breadcrumb', () => {
    renderPanel([file({ name: 'assets/icons/star.svg', kind: 'image' })]);

    fireEvent.click(screen.getByTestId('design-folder-row-assets').querySelector('.df-row-name-btn')!);
    fireEvent.click(screen.getByTestId('design-folder-row-assets/icons').querySelector('.df-row-name-btn')!);
    expect(document.querySelector('.df-breadcrumb-current')?.textContent).toBe('icons');

    const crumbs = Array.from(document.querySelectorAll('.df-breadcrumb-btn'));
    fireEvent.click(crumbs[crumbs.length - 1]!);
    expect(document.querySelector('.df-breadcrumb-current')?.textContent).toBe('assets');
  });

  it('clears selection when navigating into or out of a directory', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    const topRow = screen.getByTestId('design-file-row-top.html');
    fireEvent.click(topRow.querySelector('.df-row-check')!);
    expect(topRow.classList.contains('selected')).toBe(true);

    fireEvent.click(document.querySelector('.df-dir-row .df-row-name-btn')!);
    expect(document.querySelectorAll('.df-file-row.selected').length).toBe(0);

    fireEvent.click(document.querySelector('.df-breadcrumb-btn')!);
    expect(document.querySelectorAll('.df-file-row.selected').length).toBe(0);
  });

  it('resets currentDir automatically when all files in the current subdirectory are removed', () => {
    function makePanel(files: ProjectFile[]) {
      return (
        <DesignFilesPanel
          projectId="test-project"
          files={files}
          liveArtifacts={[]}
          onRefreshFiles={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenLiveArtifact={vi.fn()}
          onRenameFile={vi.fn()}
          onDeleteFile={vi.fn()}
          onDeleteFiles={vi.fn()}
          onUpload={vi.fn()}
          onUploadFiles={vi.fn()}
          onPaste={vi.fn()}
          onNewSketch={vi.fn()}
        />
      );
    }

    const { rerender } = render(
      makePanel([
        file({ name: 'assets/logo.png', kind: 'image' }),
        file({ name: 'top.html', kind: 'html' }),
      ]),
    );

    fireEvent.click(document.querySelector('.df-dir-row .df-row-name-btn')!);
    expect(document.querySelector('.df-breadcrumb-current')?.textContent).toBe('assets');

    rerender(makePanel([file({ name: 'top.html', kind: 'html' })]));

    expect(document.querySelector('.df-breadcrumb-current')?.textContent).not.toBe('assets');
    expect(screen.getByTestId('design-file-row-top.html')).toBeTruthy();
  });
});

describe('DesignFilesPanel current-directory sync', () => {
  afterEach(() => cleanup());

  it('reports the active folder so new files are created under it, not the root', () => {
    const onCurrentDirChange = vi.fn();
    renderPanel(
      [
        file({ name: 'top.html', kind: 'html' }),
        file({ name: 'assets/logo.png', kind: 'image' }),
      ],
      { onCurrentDirChange },
    );
    // Mounts at the root.
    expect(onCurrentDirChange).toHaveBeenLastCalledWith('');
    // Navigate into the folder — the parent must learn the new target dir, or
    // upload / paste / new-sketch would create at the project root (#3358 regression).
    fireEvent.click(document.querySelector('.df-dir-row .df-row-name-btn')!);
    expect(onCurrentDirChange).toHaveBeenLastCalledWith('assets');
  });
});

describe('DesignFilesPanel persisted (empty) folders', () => {
  afterEach(() => cleanup());

  it('shows an empty persisted folder that has no files under it', () => {
    // Only a root file + an empty persisted folder; the folder must still
    // appear (it would vanish if we derived dirs from file paths alone).
    renderPanel([file({ name: 'top.html', kind: 'html' })], { folders: [folder('assets')] });
    const dirRows = [...document.querySelectorAll('.df-dir-row')];
    expect(dirRows.some((r) => r.textContent?.includes('assets'))).toBe(true);
  });

  it('surfaces a nested empty persisted folder after navigating into its parent', () => {
    renderPanel([], { folders: [folder('assets'), folder('assets/icons')] });
    // Zero files, but the persisted folder still renders the tree (not the
    // empty state), so 'assets' is navigable at the root.
    const rootDirs = [...document.querySelectorAll('.df-dir-row .df-tree-name')].map((e) => e.textContent);
    expect(rootDirs).toContain('assets');
    fireEvent.click(document.querySelector('.df-dir-row .df-row-name-btn')!);
    const nestedDirs = [...document.querySelectorAll('.df-dir-row .df-tree-name')].map((e) => e.textContent);
    expect(nestedDirs).toContain('icons');
  });
});
