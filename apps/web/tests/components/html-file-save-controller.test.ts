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

  it('skips duplicate writes when the saved source has not changed', async () => {
    const file = htmlFile();
    const write = vi.fn<HtmlFileSaveWriter>(async () => ({ ok: true, file }));
    const onSaved = vi.fn();
    const controller = createHtmlFileSaveController({
      projectId: 'project-1',
      fileName: 'index.html',
      onSaved,
      write,
    });

    const first = await controller.save('<html>same</html>', 'grapesjs-autosave-flush');
    const second = await controller.save('<html>same</html>', 'grapesjs-autosave-flush');

    expect(first).toEqual({ ok: true, file });
    expect(second).toEqual({ ok: true, file });
    expect(write).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('joins duplicate writes while the same source is already in flight', async () => {
    const file = htmlFile();
    const writes: Array<{
      resolve: (result: Awaited<ReturnType<HtmlFileSaveWriter>>) => void;
    }> = [];
    const write = vi.fn<HtmlFileSaveWriter>(() => new Promise((resolve) => {
      writes.push({ resolve });
    }));
    const onSaved = vi.fn();
    const controller = createHtmlFileSaveController({
      projectId: 'project-1',
      fileName: 'index.html',
      onSaved,
      write,
    });

    const first = controller.save('<html>same</html>', 'grapesjs-autosave-flush');
    const second = controller.save('<html>same</html>', 'grapesjs-autosave-flush');

    expect(write).toHaveBeenCalledTimes(1);
    writes[0]?.resolve({ ok: true, file });

    await expect(first).resolves.toEqual({ ok: true, file });
    await expect(second).resolves.toEqual({ ok: true, file });
    expect(onSaved).toHaveBeenCalledTimes(1);
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

  it('serializes in-flight saves and notifies only after the latest queued source is written', async () => {
    const file = htmlFile();
    const writes: Array<{
      source: string;
      resolve: (result: Awaited<ReturnType<HtmlFileSaveWriter>>) => void;
    }> = [];
    const write = vi.fn<HtmlFileSaveWriter>((_projectId, _fileName, source) => new Promise((resolve) => {
      writes.push({ source, resolve });
    }));
    const onSaved = vi.fn();
    const controller = createHtmlFileSaveController({
      projectId: 'project-1',
      fileName: 'index.html',
      onSaved,
      write,
    });

    const first = controller.saveBestEffort('<html>first</html>', 'grapesjs-autosave-flush');
    const second = controller.saveBestEffort('<html>second</html>', 'grapesjs-autosave-flush');
    const latest = controller.saveBestEffort('<html>latest</html>', 'grapesjs-autosave-flush');

    expect(write).toHaveBeenCalledTimes(1);
    expect(writes[0]?.source).toBe('<html>first</html>');

    writes[0]?.resolve({ ok: true, file });
    await Promise.resolve();
    await Promise.resolve();

    expect(onSaved).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(2);
    expect(writes[1]?.source).toBe('<html>latest</html>');

    writes[1]?.resolve({ ok: true, file });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    await expect(latest).resolves.toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
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

  it('does not flush a save after canceling the pending source', async () => {
    vi.useFakeTimers();
    const file = htmlFile();
    const write = vi.fn<HtmlFileSaveWriter>(async () => ({ ok: true, file }));
    const controller = createHtmlFileSaveController({
      projectId: 'project-1',
      fileName: 'index.html',
      write,
    });

    controller.scheduleSave('<html>pending</html>', 'grapesjs-autosave-flush', 1000);
    controller.cancelScheduledSave();
    await expect(controller.flushScheduledSave('grapesjs-view-mode-flush')).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);

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
