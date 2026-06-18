// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../../src/types';

const {
  writeProjectTextFileDetailedMock,
  mockGrapesjsDocumentRef,
  mockGrapesjsSetHtml,
  mockGrapesjsOnChangeRef,
} = vi.hoisted(() => ({
  writeProjectTextFileDetailedMock: vi.fn(),
  mockGrapesjsDocumentRef: { current: null as string | null },
  mockGrapesjsSetHtml: vi.fn(),
  mockGrapesjsOnChangeRef: { current: null as null | ((next: string) => void) },
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    writeProjectTextFileDetailed: writeProjectTextFileDetailedMock,
  };
});

vi.mock('../../src/components/grapesjs/GrapesjsEditor', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const MockGrapesjsEditor = React.forwardRef((
    props: { html: string; className?: string; onChange?: (next: string) => void },
    ref,
  ) => {
    React.useEffect(() => {
      mockGrapesjsOnChangeRef.current = props.onChange ?? null;
      return () => {
        if (mockGrapesjsOnChangeRef.current === props.onChange) {
          mockGrapesjsOnChangeRef.current = null;
        }
      };
    }, [props.onChange]);
    React.useImperativeHandle(ref, () => ({
      getHtml: () => props.html,
      getCss: () => '',
      getDocument: () => mockGrapesjsDocumentRef.current ?? props.html,
      setHtml: mockGrapesjsSetHtml,
      setReadOnly: vi.fn(),
      destroy: vi.fn(),
      applyStyle: vi.fn(),
      getCanvasStyles: () => ({}),
      getCanvasState: () => ({ styles: {}, size: null }),
      setCanvasStyles: vi.fn(),
      setViewport: vi.fn(),
      setCanvasSize: vi.fn(),
      setSelectedSrc: vi.fn(),
      getSelectedSrc: () => '',
      insertImageComponent: vi.fn(),
      reselectCurrent: vi.fn(),
      setCropMode: vi.fn(),
      getEditor: () => null,
    }));
    return (
      <div className={props.className} data-testid="mock-grapesjs-editor">
        {props.html}
      </div>
    );
  });
  MockGrapesjsEditor.displayName = 'MockGrapesjsEditor';
  return { default: MockGrapesjsEditor };
});

import { FileViewer } from '../../src/components/FileViewer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  writeProjectTextFileDetailedMock.mockReset();
  mockGrapesjsDocumentRef.current = null;
  mockGrapesjsSetHtml.mockReset();
  mockGrapesjsOnChangeRef.current = null;
});

function baseHtmlFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    name: 'page.html',
    path: 'page.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Page',
      entry: 'page.html',
      renderer: 'html',
      exports: ['html'],
    },
    ...overrides,
  };
}

describe('FileViewer GrapesJS autosave', () => {
  it('does not flush the GrapesJS document again when only the file mtime changes', async () => {
    const file = baseHtmlFile();
    const liveHtml = '<html><body><main>Raw</main></body></html>';
    mockGrapesjsDocumentRef.current = '<html><head></head><body><main>Raw</main></body></html>';
    writeProjectTextFileDetailedMock.mockResolvedValue({
      ok: true,
      file: { ...file, mtime: file.mtime + 1 },
    });

    const { rerender } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml={liveHtml}
      />,
    );

    await screen.findByTestId('mock-grapesjs-editor');

    rerender(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={{ ...file, mtime: file.mtime + 1 }}
        liveHtml={liveHtml}
      />,
    );

    expect(writeProjectTextFileDetailedMock).not.toHaveBeenCalled();
  });

  it('saves the current GrapesJS document before reloading the preview canvas', async () => {
    const file = baseHtmlFile();
    const liveHtml = '<html><body><main>Raw</main></body></html>';
    const editedHtml = '<html><head></head><body><main style="font-size: 20px">Edited</main></body></html>';
    mockGrapesjsDocumentRef.current = editedHtml;
    writeProjectTextFileDetailedMock.mockResolvedValue({
      ok: true,
      file: { ...file, mtime: file.mtime + 1 },
    });

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml={liveHtml}
      />,
    );

    await screen.findByTestId('mock-grapesjs-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Reload Preview' }));

    await waitFor(() => {
      expect(writeProjectTextFileDetailedMock).toHaveBeenCalledWith(
        'project-1',
        'page.html',
        editedHtml,
        { artifactManifest: file.artifactManifest },
      );
    });
    expect(mockGrapesjsSetHtml).toHaveBeenCalledWith(editedHtml);
  });

  it('coalesces rapid GrapesJS source state updates while autosaving the latest HTML', async () => {
    const file = baseHtmlFile();
    const liveHtml = '<html><body><main>Raw</main></body></html>';
    const firstEdit = '<html><head></head><body><main>First edit</main></body></html>';
    const latestEdit = '<html><head></head><body><main>Latest edit</main></body></html>';
    writeProjectTextFileDetailedMock.mockResolvedValue({
      ok: true,
      file: { ...file, mtime: file.mtime + 1 },
    });

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml={liveHtml}
      />,
    );

    const editor = await screen.findByTestId('mock-grapesjs-editor');
    vi.useFakeTimers();
    try {
      await act(async () => {
        mockGrapesjsOnChangeRef.current?.(firstEdit);
        mockGrapesjsOnChangeRef.current?.(latestEdit);
      });

      expect(editor.textContent).toContain('Raw');
      expect(writeProjectTextFileDetailedMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(editor.textContent).toContain('Raw');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(editor.textContent).toContain('Latest edit');
      expect(writeProjectTextFileDetailedMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(writeProjectTextFileDetailedMock).toHaveBeenCalledTimes(1);
      expect(writeProjectTextFileDetailedMock).toHaveBeenCalledWith(
        'project-1',
        'page.html',
        latestEdit,
        { artifactManifest: file.artifactManifest },
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
