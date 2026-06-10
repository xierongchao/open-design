// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
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
  it('renders code text in a textarea for editing', () => {
    const onChange = vi.fn();
    const { container } = render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    const textarea = container.querySelector('.editable-code-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toContain('Hello World');
  });

  it('calls onChange when text is edited', () => {
    const onChange = vi.fn();
    const { container } = render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    const textarea = container.querySelector('.editable-code-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'modified' } });

    expect(onChange).toHaveBeenCalledWith('modified');
  });

  it('renders a search input', () => {
    const onChange = vi.fn();
    render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeTruthy();
  });

  it('shows match count when searching', () => {
    const onChange = vi.fn();
    render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'Hello' } });

    // Should show a match count indicator like "1/1"
    const countEl = screen.getByText(/1\/1/);
    expect(countEl).toBeTruthy();
  });

  it('shows no matches indicator for non-matching search', () => {
    const onChange = vi.fn();
    render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'zzznonexistent' } });

    expect(screen.getByText(/0\/0/)).toBeTruthy();
  });

  it('navigates between search matches with next/prev buttons', () => {
    const text = 'line1 foo\nline2 foo\nline3 foo\nline4 bar';
    const onChange = vi.fn();
    render(<EditableCodeViewer text={text} onChange={onChange} />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'foo' } });

    // Should show "1/3" initially
    expect(screen.getByText(/1\/3/)).toBeTruthy();

    // Click next
    const nextButton = screen.getByLabelText(/next/i);
    fireEvent.click(nextButton);
    expect(screen.getByText(/2\/3/)).toBeTruthy();

    // Click next again
    fireEvent.click(nextButton);
    expect(screen.getByText(/3\/3/)).toBeTruthy();
  });

  it('renders line numbers alongside the code', () => {
    const onChange = vi.fn();
    const { container } = render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    // The gutter should contain line numbers
    const gutter = container.querySelector('.gutter');
    expect(gutter).toBeTruthy();
    expect(gutter?.textContent).toContain('1');
    expect(gutter?.textContent).toContain('2');
  });

  // B: scroll-to-match on search navigation
  it('scrolls textarea to the current match position when navigating search results', () => {
    const longText = Array.from({ length: 50 }, (_, i) => `line ${i + 1} foo`).join('\n');
    const onChange = vi.fn();
    const { container } = render(<EditableCodeViewer text={longText} onChange={onChange} />);

    const textarea = container.querySelector('.editable-code-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    // Mock setSelectionRange and focus to verify scroll behavior
    const selectSpy = vi.spyOn(textarea, 'setSelectionRange');
    const focusSpy = vi.spyOn(textarea, 'focus');

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'foo' } });

    // After searching, the first match should be selected (setSelectionRange called)
    expect(selectSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();

    // The selection start should point to the first "foo" occurrence
    const firstCall = selectSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error('Expected setSelectionRange to be called');

    const [selectionStart, selectionEnd] = firstCall;
    if (selectionStart == null || selectionEnd == null) {
      throw new Error('Expected setSelectionRange to receive numeric selection bounds');
    }

    expect(selectionStart).toBeGreaterThanOrEqual(0);
    expect(selectionEnd).toBeGreaterThan(selectionStart);

    selectSpy.mockRestore();
    focusSpy.mockRestore();
  });

  // B: undo support for textarea edits
  it('restores previous text when Ctrl+Z is pressed after editing', () => {
    const onChange = vi.fn();
    const { container } = render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    const textarea = container.querySelector('.editable-code-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    // Simulate user editing the text
    fireEvent.change(textarea, { target: { value: 'Modified content' } });
    expect(onChange).toHaveBeenCalledWith('Modified content');

    // Press Ctrl+Z to undo
    fireEvent.keyDown(container.querySelector('.editable-code-viewer')!, {
      key: 'z',
      ctrlKey: true,
    });

    // After undo, onChange should be called with the original text
    expect(onChange).toHaveBeenLastCalledWith(sampleHtml);
  });

  it('restores previous text when Cmd+Z is pressed after editing', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    const textarea = container.querySelector('.editable-code-textarea') as HTMLTextAreaElement;

    // Edit: parent would update text to 'First edit'
    fireEvent.change(textarea, { target: { value: 'First edit' } });
    expect(onChange).toHaveBeenCalledWith('First edit');
    rerender(<EditableCodeViewer text="First edit" onChange={onChange} />);

    // Edit again: parent would update text to 'Second edit'
    fireEvent.change(textarea, { target: { value: 'Second edit' } });
    expect(onChange).toHaveBeenCalledWith('Second edit');
    rerender(<EditableCodeViewer text="Second edit" onChange={onChange} />);

    // Undo once: should go back to "First edit"
    fireEvent.keyDown(container.querySelector('.editable-code-viewer')!, {
      key: 'z',
      metaKey: true,
    });
    expect(onChange).toHaveBeenLastCalledWith('First edit');
  });

  it('does not undo past the original text', () => {
    const onChange = vi.fn();
    const { container } = render(<EditableCodeViewer text={sampleHtml} onChange={onChange} />);

    const textarea = container.querySelector('.editable-code-textarea') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'Edit' } });

    // Undo once to restore original
    fireEvent.keyDown(container.querySelector('.editable-code-viewer')!, {
      key: 'z',
      ctrlKey: true,
    });

    // Undo again — should stay at original, not go further
    const callCount = onChange.mock.calls.length;
    fireEvent.keyDown(container.querySelector('.editable-code-viewer')!, {
      key: 'z',
      ctrlKey: true,
    });
    // No additional onChange call
    expect(onChange.mock.calls.length).toBe(callCount);
  });

  // C: search input should keep focus while typing
  it('keeps focus on the search input while typing search keywords', () => {
    const text = 'Hello World Hello';
    const onChange = vi.fn();
    render(<EditableCodeViewer text={text} onChange={onChange} />);

    const searchInput = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);

    // Simulate typing "Hel" character by character
    fireEvent.change(searchInput, { target: { value: 'H' } });
    expect(document.activeElement).toBe(searchInput);

    fireEvent.change(searchInput, { target: { value: 'He' } });
    expect(document.activeElement).toBe(searchInput);

    fireEvent.change(searchInput, { target: { value: 'Hel' } });
    expect(document.activeElement).toBe(searchInput);
  });

  // B: Ctrl/Cmd+S triggers onSave callback
  it('calls onSave when Ctrl+S is pressed', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(<EditableCodeViewer text={sampleHtml} onChange={onChange} onSave={onSave} />);

    fireEvent.keyDown(container.querySelector('.editable-code-viewer')!, {
      key: 's',
      ctrlKey: true,
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onSave when Cmd+S is pressed', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(<EditableCodeViewer text={sampleHtml} onChange={onChange} onSave={onSave} />);

    fireEvent.keyDown(container.querySelector('.editable-code-viewer')!, {
      key: 's',
      metaKey: true,
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // B: isDirty tracking
  it('reports dirty state when text has been modified', () => {
    const onChange = vi.fn();
    const onDirtyChange = vi.fn();
    const { container } = render(
      <EditableCodeViewer text={sampleHtml} onChange={onChange} onDirtyChange={onDirtyChange} />,
    );

    const textarea = container.querySelector('.editable-code-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Modified content' } });

    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('reports clean state after save resets dirty flag', () => {
    const onChange = vi.fn();
    const onDirtyChange = vi.fn();
    const onSave = vi.fn();
    const { container, rerender } = render(
      <EditableCodeViewer text={sampleHtml} onChange={onChange} onSave={onSave} onDirtyChange={onDirtyChange} />,
    );

    const textarea = container.querySelector('.editable-code-textarea') as HTMLTextAreaElement;
    // Edit to make dirty
    fireEvent.change(textarea, { target: { value: 'Modified' } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    // Press Ctrl+S to save
    fireEvent.keyDown(container.querySelector('.editable-code-viewer')!, {
      key: 's',
      ctrlKey: true,
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    // Simulate parent updating text after save (resetting dirty)
    onDirtyChange.mockClear();
    rerender(<EditableCodeViewer text="Modified" onChange={onChange} onSave={onSave} onDirtyChange={onDirtyChange} />);
    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });
});
