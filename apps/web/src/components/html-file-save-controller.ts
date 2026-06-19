import {
  writeProjectTextFileDetailed,
  type WriteProjectTextFileResult,
} from '../providers/registry';
import type { ProjectFile } from '../types';

export type HtmlFileSaveReason =
  | 'code-save'
  | 'grapesjs-artboard-name'
  | 'grapesjs-autosave-flush'
  | 'grapesjs-view-mode-flush'
  | 'inspect-save'
  | 'manual-edit-patch'
  | 'manual-edit-redo'
  | 'manual-edit-undo'
  | 'manual-edit-viewport-size';

export type HtmlFileSaveWriter = (
  projectId: string,
  fileName: string,
  source: string,
  options?: { artifactManifest?: ProjectFile['artifactManifest'] },
) => Promise<WriteProjectTextFileResult>;

export interface HtmlFileSaveController {
  save(source: string, reason: HtmlFileSaveReason): Promise<WriteProjectTextFileResult>;
  saveBestEffort(source: string, reason: HtmlFileSaveReason): Promise<boolean>;
  saveOrThrow(source: string, reason: HtmlFileSaveReason): Promise<ProjectFile>;
  scheduleSave(source: string, reason: HtmlFileSaveReason, delayMs?: number): void;
  flushScheduledSave(reason?: HtmlFileSaveReason): Promise<boolean>;
  cancelScheduledSave(): void;
}

export interface CreateHtmlFileSaveControllerOptions {
  projectId: string;
  fileName: string;
  artifactManifest?: ProjectFile['artifactManifest'];
  onSaved?: () => Promise<void> | void;
  write?: HtmlFileSaveWriter;
}

export function createHtmlFileSaveController({
  projectId,
  fileName,
  artifactManifest,
  onSaved,
  write = writeProjectTextFileDetailed,
}: CreateHtmlFileSaveControllerOptions): HtmlFileSaveController {
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledSave: { source: string; reason: HtmlFileSaveReason } | null = null;

  async function save(source: string, _reason: HtmlFileSaveReason): Promise<WriteProjectTextFileResult> {
    const result = await write(projectId, fileName, source, { artifactManifest });
    if (result.ok) await onSaved?.();
    return result;
  }

  function clearScheduledTimer() {
    if (scheduledTimer) clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }

  function cancelScheduledSave() {
    clearScheduledTimer();
    scheduledSave = null;
  }

  async function saveBestEffort(source: string, reason: HtmlFileSaveReason): Promise<boolean> {
    try {
      const result = await save(source, reason);
      return result.ok;
    } catch {
      return false;
    }
  }

  return {
    save,
    saveBestEffort,
    async saveOrThrow(source, reason) {
      const result = await save(source, reason);
      if (result.ok) return result.file;
      throw new Error(formatHtmlFileSaveError(result));
    },
    scheduleSave(source, reason, delayMs = 1500) {
      scheduledSave = { source, reason };
      clearScheduledTimer();
      scheduledTimer = setTimeout(() => {
        const pending = scheduledSave;
        scheduledTimer = null;
        scheduledSave = null;
        if (pending) void saveBestEffort(pending.source, pending.reason);
      }, delayMs);
    },
    async flushScheduledSave(reason) {
      const pending = scheduledSave;
      clearScheduledTimer();
      scheduledSave = null;
      if (!pending) return true;
      return saveBestEffort(pending.source, reason ?? pending.reason);
    },
    cancelScheduledSave,
  };
}

export function formatHtmlFileSaveError(result: WriteProjectTextFileResult): string {
  if (result.ok) return '';
  return result.status
    ? `Save failed (${result.status}${result.code ? ` ${result.code}` : ''}): ${result.message}`
    : result.message;
}
