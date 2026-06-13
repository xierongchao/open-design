// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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

  it('displays the provided text content', () => {
    const { container } = render(<EditableCodeViewer text={sampleHtml} />);

    const cmContent = container.querySelector('.cm-content');
    expect(cmContent).toBeTruthy();
    expect(cmContent?.textContent).toContain('Hello World');
  });

  it('shows line numbers in the gutter', () => {
    const { container } = render(<EditableCodeViewer text={sampleHtml} />);

    const gutters = container.querySelector('.cm-gutters');
    expect(gutters).toBeTruthy();
    const lineNumbers = container.querySelectorAll('.cm-gutterElement');
    expect(lineNumbers.length).toBeGreaterThan(0);
  });

  it('updates content when text prop changes externally', () => {
    const { container, rerender } = render(
      <EditableCodeViewer text={sampleHtml} />,
    );

    rerender(<EditableCodeViewer text="Updated content" />);

    const cmContent = container.querySelector('.cm-content');
    expect(cmContent?.textContent).toContain('Updated content');
  });

  it('creates a fold gutter for HTML content', () => {
    const { container } = render(<EditableCodeViewer text={sampleHtml} />);

    const foldGutter = container.querySelector('.cm-foldGutter');
    expect(foldGutter).toBeTruthy();
  });

});
