import { describe, expect, it, vi } from 'vitest';
import {
  createHtmlFileSaveController,
  formatHtmlFileSaveError,
  type HtmlFileSaveWriter,
} from '../../src/components/html-file-save-controller';
import type { ProjectFile } from '../../src/types';

describe('createHtmlFileSaveController', () => {
  it('writes through the configured project file adapter and notifies after success', async () => {
    const file = htmlFile();
    const write = vi.fn<HtmlFileSaveWriter>(async () => ({ ok: true, file }));
    const onSaved = vi.fn();
    const controller = createHtmlFileSaveController({
      projectId: 'project-1',
      fileName: 'index.html',
      artifactManifest: file.artifactManifest,
      onSaved,
      write,
    });

    const result = await controller.save('<html></html>', 'code-save');

    expect(result).toEqual({ ok: true, file });
    expect(write).toHaveBeenCalledWith('project-1', 'index.html', '<html></html>', {
      artifactManifest: file.artifactManifest,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('does not notify after failed saves', async () => {
    const write = vi.fn<HtmlFileSaveWriter>(async () => ({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Nope',
    }));
    const onSaved = vi.fn();
    const controller = createHtmlFileSaveController({
      projectId: 'project-1',
      fileName: 'index.html',
      onSaved,
      write,
    });

    await expect(controller.saveBestEffort('<html></html>', 'grapesjs-autosave-flush')).resolves.toBe(false);

    expect(onSaved).not.toHaveBeenCalled();
  });

  it('coalesces scheduled saves and writes only the latest source', async () => {
    vi.useFakeTimers();
    const file = htmlFile();
    const write = vi.fn<HtmlFileSaveWriter>(async () => ({ ok: true, file }));
    const controller = createHtmlFileSaveController({
      projectId: 'project-1',
      fileName: 'index.html',
      write,
    });

    controller.scheduleSave('<html>first</html>', 'grapesjs-autosave-flush', 100);
    controller.scheduleSave('<html>latest</html>', 'grapesjs-autosave-flush', 100);

    await vi.advanceTimersByTimeAsync(99);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('project-1', 'index.html', '<html>latest</html>', {
      artifactManifest: undefined,
    });
    vi.useRealTimers();
  });

  it('flushes a scheduled save immediately', async () => {
    vi.useFakeTimers();
    const file = htmlFile();
    const write = vi.fn<HtmlFileSaveWriter>(async () => ({ ok: true, file }));
    const controller = createHtmlFileSaveController({
      projectId: 'project-1',
      fileName: 'index.html',
      write,
    });

    controller.scheduleSave('<html>pending</html>', 'grapesjs-autosave-flush', 1000);
    await expect(controller.flushScheduledSave('grapesjs-view-mode-flush')).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('project-1', 'index.html', '<html>pending</html>', {
      artifactManifest: undefined,
    });
    vi.useRealTimers();
  });

  it('cancels scheduled saves', async () => {
    vi.useFakeTimers();
    const file = htmlFile();
    const write = vi.fn<HtmlFileSaveWriter>(async () => ({ ok: true, file }));
    const controller = createHtmlFileSaveController({
      projectId: 'project-1',
      fileName: 'index.html',
      write,
    });

    controller.scheduleSave('<html>pending</html>', 'grapesjs-autosave-flush', 100);
    controller.cancelScheduledSave();
    await vi.advanceTimersByTimeAsync(100);

    expect(write).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('formatHtmlFileSaveError', () => {
  it('keeps status and code in the user-facing error', () => {
    expect(formatHtmlFileSaveError({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Nope',
    })).toBe('Save failed (403 FORBIDDEN): Nope');
  });
});

function htmlFile(): ProjectFile {
  return {
    name: 'index.html',
    path: 'index.html',
    type: 'file',
    size: 1,
    mtime: 1,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Index',
      entry: 'index.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}
