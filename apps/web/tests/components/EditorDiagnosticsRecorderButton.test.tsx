// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDiagnosticsRecorderButton } from '../../src/components/EditorDiagnosticsRecorderButton';

describe('EditorDiagnosticsRecorderButton', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, '__OD_EDITOR_DIAGNOSTICS__');
    Reflect.deleteProperty(window, 'odDiagnostics');
  });

  it('starts recording, then stops and downloads the diagnostics report', () => {
    const report = {
      active: false,
      durationMs: 0,
      endedAt: null,
      events: [],
      fetches: [],
      fetchSummary: [],
      frames: {
        averageDeltaMs: 0,
        count: 0,
        longFrameCount: 0,
        maxDeltaMs: 0,
      },
      longTasks: [],
      operations: [],
      startedAt: null,
    };
    const controller = {
      start: vi.fn(),
      stop: vi.fn(() => report),
      reset: vi.fn(),
      report: vi.fn(() => report),
      download: vi.fn(),
      record: vi.fn(),
    };
    window.__OD_EDITOR_DIAGNOSTICS__ = controller;

    render(<EditorDiagnosticsRecorderButton fileName="画板.html" />);

    const button = screen.getByRole('button', { name: '录制操作诊断' });
    fireEvent.click(button);

    expect(controller.start).toHaveBeenCalledWith({
      includeStacks: true,
      captureOperations: true,
      reset: true,
    });
    expect(controller.record).toHaveBeenCalledWith('diagnostics-recording:started', {
      fileName: '画板.html',
    });
    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button);

    expect(controller.record).toHaveBeenLastCalledWith('diagnostics-recording:stopping', {
      fileName: '画板.html',
    });
    expect(controller.stop).toHaveBeenCalledTimes(1);
    expect(controller.download).toHaveBeenCalledWith(expect.stringMatching(/^open-design-operation-recording-/));
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});
