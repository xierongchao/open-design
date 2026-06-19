import {
  writeProjectTextFileDetailed,
  type WriteProjectTextFileResult,
} from '../providers/registry';
import { recordOpenDesignEditorDiagnostic } from '../diagnostics/editor-diagnostics';
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
  onSaved?: (event: { file: ProjectFile; reason: HtmlFileSaveReason }) => Promise<void> | void;
  write?: HtmlFileSaveWriter;
}

type SaveJob = {
  source: string;
  reason: HtmlFileSaveReason;
  requestId: number;
  waiters: Array<{
    resolve: (result: WriteProjectTextFileResult) => void;
    reject: (error: unknown) => void;
  }>;
};

export function createHtmlFileSaveController({
  projectId,
  fileName,
  artifactManifest,
  onSaved,
  write = writeProjectTextFileDetailed,
}: CreateHtmlFileSaveControllerOptions): HtmlFileSaveController {
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledSave: { source: string; reason: HtmlFileSaveReason } | null = null;
  let latestRequestedSaveId = 0;
  let drainingSaveQueue = false;
  let activeSave: SaveJob | null = null;
  let queuedSave: SaveJob | null = null;
  let lastSuccessfulSave: { source: string; result: WriteProjectTextFileResult } | null = null;

  async function drainSaveQueue() {
    if (drainingSaveQueue) return;
    drainingSaveQueue = true;
    try {
      while (activeSave) {
        const job = activeSave;
        recordOpenDesignEditorDiagnostic('html-save:start', {
          fileName,
          reason: job.reason,
          requestId: job.requestId,
          queued: Boolean(queuedSave),
        });
        try {
          const result = await write(projectId, fileName, job.source, { artifactManifest });
          recordOpenDesignEditorDiagnostic('html-save:finish', {
            fileName,
            reason: job.reason,
            requestId: job.requestId,
            ok: result.ok,
            status: result.ok ? 200 : result.status,
          });
          if (result.ok) {
            lastSuccessfulSave = { source: job.source, result };
          } else {
            lastSuccessfulSave = null;
          }
          if (result.ok && job.requestId === latestRequestedSaveId && !queuedSave) {
            recordOpenDesignEditorDiagnostic('html-save:on-saved', {
              fileName,
              reason: job.reason,
              requestId: job.requestId,
            });
            await onSaved?.({ file: result.file, reason: job.reason });
          }
          for (const waiter of job.waiters) waiter.resolve(result);
        } catch (error) {
          lastSuccessfulSave = null;
          recordOpenDesignEditorDiagnostic('html-save:error', {
            fileName,
            reason: job.reason,
            requestId: job.requestId,
            message: error instanceof Error ? error.message : String(error),
          });
          for (const waiter of job.waiters) waiter.reject(error);
        }
        activeSave = queuedSave;
        queuedSave = null;
      }
    } finally {
      drainingSaveQueue = false;
    }
  }

  async function save(source: string, reason: HtmlFileSaveReason): Promise<WriteProjectTextFileResult> {
    if (!activeSave && !queuedSave && lastSuccessfulSave?.source === source) {
      recordOpenDesignEditorDiagnostic('html-save:skip-duplicate-source', {
        fileName,
        reason,
      });
      return lastSuccessfulSave.result;
    }

    const activeDuplicate = activeSave?.source === source && !queuedSave ? activeSave : null;
    if (activeDuplicate) {
      recordOpenDesignEditorDiagnostic('html-save:join-active-duplicate-source', {
        fileName,
        reason,
        requestId: activeDuplicate.requestId,
      });
      return new Promise<WriteProjectTextFileResult>((resolve, reject) => {
        activeDuplicate.waiters.push({ resolve, reject });
      });
    }

    const queuedDuplicate = queuedSave?.source === source ? queuedSave : null;
    if (queuedDuplicate) {
      recordOpenDesignEditorDiagnostic('html-save:join-queued-duplicate-source', {
        fileName,
        reason,
        requestId: queuedDuplicate.requestId,
      });
      return new Promise<WriteProjectTextFileResult>((resolve, reject) => {
        queuedDuplicate.waiters.push({ resolve, reject });
      });
    }

    const requestId = ++latestRequestedSaveId;
    return new Promise<WriteProjectTextFileResult>((resolve, reject) => {
      const waiter = { resolve, reject };
      if (!activeSave && !drainingSaveQueue) {
        activeSave = { source, reason, requestId, waiters: [waiter] };
        void drainSaveQueue();
        return;
      }
      if (queuedSave) {
        queuedSave.source = source;
        queuedSave.reason = reason;
        queuedSave.requestId = requestId;
        queuedSave.waiters.push(waiter);
      } else {
        queuedSave = { source, reason, requestId, waiters: [waiter] };
      }
    });
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
