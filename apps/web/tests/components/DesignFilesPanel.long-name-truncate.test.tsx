// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignFilesPanel } from '../../src/components/DesignFilesPanel';
import type { ProjectFile } from '../../src/types';

// Regression coverage for #3260. Files now live in the folder tree rather
// than a table, so the contract is that the tree name stays in a min-width:0
// grid track, truncates through `.df-tree-name`, and exposes the complete path
// on its button tooltip.
//
// jsdom does not measure layout, so the truncation itself can't be
// asserted directly. These specs encode the contract: the rendered DOM
// keeps the structural classes the CSS relies on, and the `title` is
// present on every name button so hover-tooltip is available even on the
// very long row.

const lsStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => lsStore.get(key) ?? null,
  setItem: (key: string, value: string) => { lsStore.set(key, value); },
  removeItem: (key: string) => { lsStore.delete(key); },
  clear: () => { lsStore.clear(); },
});

function file(overrides: Partial<ProjectFile> & Pick<ProjectFile, 'name'>): ProjectFile {
  return {
    path: overrides.name,
    type: 'file',
    size: 1024,
    mtime: Date.now(),
    kind: 'image',
    mime: 'image/png',
    ...overrides,
  };
}

function renderPanel(files: ProjectFile[]) {
  return render(
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
    />,
  );
}

beforeEach(() => {
  lsStore.clear();
});

afterEach(() => {
  cleanup();
});

const LONG_NAME =
  'mpqdcf5m-A-1-year-old-boy-_standing_-with-short-black-hair_-big-eyes-with-black-pupils_-wearing-a-watermelon-shaped-helmet.jpeg';

describe('DesignFilesPanel long filename truncation (#3260)', () => {
  it('renders the file row for a long filename without crashing', () => {
    const { container } = renderPanel([file({ name: LONG_NAME })]);
    const row = container.querySelector(`[data-testid="design-file-row-${LONG_NAME}"]`);
    expect(row).toBeTruthy();
  });

  it('exposes the full filename via a `title` attribute on the name button', () => {
    const { container } = renderPanel([file({ name: LONG_NAME })]);
    const nameButton = container.querySelector('.df-tree-file-row .df-row-name-btn');
    expect(nameButton).toBeTruthy();
    expect(nameButton?.getAttribute('title')).toBe(LONG_NAME);
  });

  it('keeps the truncate-friendly tree name inside the file name button', () => {
    const { container } = renderPanel([file({ name: LONG_NAME })]);
    const row = container.querySelector('.df-tree-file-row');
    const button = row?.querySelector('button.df-row-name-btn');
    const name = button?.querySelector('span.df-tree-name');
    expect(row).toBeTruthy();
    expect(button).toBeTruthy();
    expect(name).toBeTruthy();
  });
});
