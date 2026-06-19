// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('editor diagnostics operation recording', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('records sanitized user operations alongside performance diagnostics', async () => {
    vi.resetModules();
    Object.defineProperty(window, 'fetch', {
      value: vi.fn(async () => new Response('{}', { status: 200 })),
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      value: vi.fn(() => 1),
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });

    const { installOpenDesignEditorDiagnostics } = await import('../../src/diagnostics/editor-diagnostics');
    installOpenDesignEditorDiagnostics();

    const target = document.createElement('button');
    target.dataset.testid = 'move-tool';
    target.setAttribute('aria-label', '移动工具');
    document.body.appendChild(target);

    window.__OD_EDITOR_DIAGNOSTICS__?.start({ captureOperations: true });
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 24, clientY: 36 }));
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'z',
      code: 'KeyZ',
      metaKey: true,
    }));
    target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));

    const report = window.__OD_EDITOR_DIAGNOSTICS__?.stop();

    expect(report?.operations.map((entry) => entry.name)).toEqual(['click', 'keydown', 'wheel']);
    expect(report?.operations[0]?.target).toMatchObject({
      tag: 'button',
      testId: 'move-tool',
      ariaLabel: '移动工具',
    });
    expect(report?.operations[1]).toMatchObject({
      key: 'z',
      code: 'KeyZ',
      modifiers: ['meta'],
    });
    expect(report?.operations[2]).toMatchObject({
      deltaY: 120,
    });
  });
});
