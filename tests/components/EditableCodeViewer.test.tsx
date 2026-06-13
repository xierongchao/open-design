// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { EditableCodeViewer } from '../../src/components/EditableCodeViewer';

afterEach(cleanup);

const sampleHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
</head>
<body>
  <h1>Hello World</h1>
  <p>This is a paragraph</p>
</body>
</html>`;

describe('EditableCodeViewer', () => {
  it('renders a CodeMirror editor container', () => {
    const { container } = render(<EditableCodeViewer text={sampleHtml} />);
    const editor = container.querySelector('.cm-editor');
    expect(editor).toBeTruthy();
  });

  it('displays the provided text content', async () => {
    const { container } = render(<EditableCodeViewer text={sampleHtml} />);

    const cmContent = container.querySelector('.cm-content');
    expect(cmContent).toBeTruthy();
    expect(cmContent?.textContent).toContain('Hello World');
  });

  it('shows line numbers in the gutter', () => {
    const { container } = render(<EditableCodeViewer text={sampleHtml} />);

    const gutters = container.querySelector('.cm-gutters');
    expect(gutters).toBeTruthy();
    // CodeMirror renders line numbers inside .cm-gutter-lint or .cm-gutter
    const lineNumbers = container.querySelectorAll('.cm-gutterElement');
    expect(lineNumbers.length).toBeGreaterThan(0);
  });

  it('calls onChange when text is edited via CodeMirror dispatch', async () => {
    const onChange = vi.fn();
    const { container } = render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    const view = (container.querySelector('.cm-editor') as any)?.cmView?.view;
    if (!view) return;

    view.dispatch({
      changes: { from: 0, to: 5, insert: 'Hello' },
    });

    expect(onChange).toHaveBeenCalled();
    const newText = onChange.mock.calls[0][0] as string;
    expect(newText).toContain('Hello');
  });

  it('calls onSave when Ctrl+S is pressed', async () => {
    const onSave = vi.fn();
    const { container } = render(<EditableCodeViewer text={sampleHtml} onSave={onSave} />);

    const editorEl = container.querySelector('.cm-editor')!;
    editorEl.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }),
    );

    expect(onSave).toHaveBeenCalled();
  });

  it('reports dirty state when text is modified', async () => {
    const onChange = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <EditableCodeViewer
        text={sampleHtml}
        onChange={onChange}
        onDirtyChange={onDirtyChange}
      />,
    );

    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });

  it('updates content when text prop changes externally', async () => {
    const { container, rerender } = render(
      <EditableCodeViewer text={sampleHtml} />,
    );

    rerender(<EditableCodeViewer text="Updated content" />);

    const cmContent = container.querySelector('.cm-content');
    expect(cmContent?.textContent).toContain('Updated content');
  });

  it('applies readOnly mode to the editor', () => {
    const { container } = render(
      <EditableCodeViewer text={sampleHtml} readOnly />,
    );

    const editor = container.querySelector('.cm-editor');
    expect(editor).toBeTruthy();
    // CodeMirror adds cm-readonly class when read-only
    expect(editor?.classList.contains('cm-readonly')).toBe(true);
  });

  it('creates a fold gutter for HTML content', () => {
    const { container } = render(<EditableCodeViewer text={sampleHtml} />);

    // CodeMirror foldGutter renders a gutter element
    const foldGutter = container.querySelector('.cm-foldGutter');
    expect(foldGutter).toBeTruthy();
  });

  it('switches readOnly mode when prop changes', () => {
    const { container, rerender } = render(
      <EditableCodeViewer text={sampleHtml} readOnly={false} />,
    );

    const editor = container.querySelector('.cm-editor');
    expect(editor?.classList.contains('cm-readonly')).toBe(false);

    rerender(<EditableCodeViewer text={sampleHtml} readOnly />);
    expect(editor?.classList.contains('cm-readonly')).toBe(true);
  });
});
