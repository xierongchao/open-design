import { describe, expect, it } from 'vitest';
import {
  shouldRefreshWorkspaceAfterFileWorkspaceRequest,
  shouldSuppressFileRefreshAfterLocalSave,
} from '../../src/components/project-file-refresh';

describe('project file refresh helpers', () => {
  it('skips full workspace refresh for local HTML saves', () => {
    expect(shouldRefreshWorkspaceAfterFileWorkspaceRequest({
      source: 'local-save',
      fileName: '画板.html',
      reason: 'grapesjs-autosave-flush',
    })).toBe(false);
    expect(shouldRefreshWorkspaceAfterFileWorkspaceRequest()).toBe(true);
  });

  it('suppresses watcher echoes from the same recently saved local file', () => {
    const now = 1_000;
    expect(shouldSuppressFileRefreshAfterLocalSave({
      local: {
        at: now - 100,
        fileName: 'nested/%E7%94%BB%E6%9D%BF.html',
        reason: 'grapesjs-autosave-flush',
      },
      events: [
        {
          type: 'file-changed',
          path: 'nested/画板.html',
          kind: 'change',
        },
      ],
      now,
    })).toBe(true);
  });

  it('suppresses local HTML save echoes when the sidecar manifest changes in the same watcher burst', () => {
    const now = 1_000;
    expect(shouldSuppressFileRefreshAfterLocalSave({
      local: {
        at: now - 250,
        fileName: '画板.html',
        reason: 'grapesjs-autosave-flush',
      },
      events: [
        {
          type: 'file-changed',
          path: '画板.html.artifact.json',
          kind: 'change',
        },
        {
          type: 'file-changed',
          path: '画板.html',
          kind: 'change',
        },
      ],
      now,
    })).toBe(true);
  });

  it('does not suppress unrelated or old file changes', () => {
    const now = 5_000;
    expect(shouldSuppressFileRefreshAfterLocalSave({
      local: {
        at: now - 100,
        fileName: '画板.html',
        reason: 'grapesjs-autosave-flush',
      },
      events: [
        {
          type: 'file-changed',
          path: 'DESIGN.md',
          kind: 'change',
        },
      ],
      now,
    })).toBe(false);
    expect(shouldSuppressFileRefreshAfterLocalSave({
      local: {
        at: now - 3_000,
        fileName: '画板.html',
        reason: 'grapesjs-autosave-flush',
      },
      events: [
        {
          type: 'file-changed',
          path: '画板.html',
          kind: 'change',
        },
      ],
      now,
    })).toBe(false);
  });
});
