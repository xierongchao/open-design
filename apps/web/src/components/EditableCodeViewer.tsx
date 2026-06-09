import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface EditableCodeViewerProps {
  text: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  readOnly?: boolean;
}

export function EditableCodeViewer({ text, onChange, onSave, onDirtyChange, readOnly = false }: EditableCodeViewerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatch, setCurrentMatch] = useState(0);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLElement>(null);
  const isUndoRef = useRef(false);
  const savedTextRef = useRef(text);
  const prevDirtyRef = useRef(false);
  const lastEditedValueRef = useRef(text);

  const lines = useMemo(() => text.split('\n'), [text]);
  const gutter = useMemo(() => lines.map((_, i) => `${i + 1}`).join('\n'), [lines]);

  const matches = useMemo(() => {
    if (!searchQuery) return [];
    const result: number[] = [];
    const lower = text.toLowerCase();
    const query = searchQuery.toLowerCase();
    let pos = 0;
    while (true) {
      const idx = lower.indexOf(query, pos);
      if (idx === -1) break;
      result.push(idx);
      pos = idx + 1;
    }
    return result;
  }, [text, searchQuery]);

  useEffect(() => {
    if (matches.length > 0 && currentMatch >= matches.length) {
      setCurrentMatch(0);
    } else if (matches.length === 0) {
      setCurrentMatch(0);
    }
  }, [matches.length, currentMatch]);

  // Scroll to and select the current match
  useEffect(() => {
    if (matches.length === 0 || !textareaRef.current) return;
    const matchPos = matches[currentMatch];
    if (matchPos == null) return;
    const textarea = textareaRef.current;
    const queryLen = searchQuery.length;
    textarea.setSelectionRange(matchPos, matchPos + queryLen);
    // Do not steal focus from the search input while the user is typing
    const searchInput = textarea.closest('.editable-code-viewer')?.querySelector('.editable-code-search-input');
    if (searchInput && document.activeElement === searchInput) return;
    textarea.focus();
  }, [matches, currentMatch, searchQuery]);

  const handleNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatch((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const handlePrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatch((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const handleKeyDown = useCallback(
    (ev: React.KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'f') {
        ev.preventDefault();
        const input = (ev.currentTarget as HTMLElement).querySelector('.editable-code-search-input') as HTMLInputElement;
        input?.focus();
        input?.select();
      }
      if (ev.key === 'Enter' && searchQuery) {
        ev.preventDefault();
        if (ev.shiftKey) handlePrev();
        else handleNext();
      }
      if (ev.key === 'Escape' && searchQuery) {
        ev.preventDefault();
        setSearchQuery('');
      }
      // Undo: Ctrl+Z / Cmd+Z
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z' && !ev.shiftKey) {
        ev.preventDefault();
        if (undoStack.length > 0) {
          const previous = undoStack[undoStack.length - 1]!;
          isUndoRef.current = true;
          onChange?.(previous);
          setUndoStack((stack) => stack.slice(0, -1));
        }
      }
      // Save: Ctrl+S / Cmd+S
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
        ev.preventDefault();
        savedTextRef.current = lastEditedValueRef.current;
        onSave?.();
      }
    },
    [searchQuery, handleNext, handlePrev, onChange, undoStack, onSave],
  );

  // Track dirty state: detect when text prop catches up to the saved baseline
  useEffect(() => {
    const dirty = text !== savedTextRef.current;
    if (dirty !== prevDirtyRef.current) {
      prevDirtyRef.current = dirty;
      onDirtyChange?.(dirty);
    }
  }, [text, onDirtyChange]);

  const handleChange = useCallback(
    (ev: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!isUndoRef.current) {
        setUndoStack((stack) => [...stack, text]);
      }
      isUndoRef.current = false;
      const newValue = ev.target.value;
      lastEditedValueRef.current = newValue;
      // Mark dirty immediately (text prop hasn't changed yet)
      if (!prevDirtyRef.current) {
        prevDirtyRef.current = true;
        onDirtyChange?.(true);
      }
      onChange?.(newValue);
    },
    [onChange, text, onDirtyChange],
  );

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const gutter = gutterRef.current;
    if (textarea && gutter) {
      gutter.scrollTop = textarea.scrollTop;
    }
  }, []);

  const matchLabel = searchQuery
    ? matches.length > 0
      ? `${currentMatch + 1}/${matches.length}`
      : '0/0'
    : '';

  return (
    <div className="editable-code-viewer" onKeyDown={handleKeyDown}>
      <div className="editable-code-search">
        <input
          type="text"
          className="editable-code-search-input"
          placeholder="Search… (Ctrl+F)"
          value={searchQuery}
          onChange={(ev) => {
            setSearchQuery(ev.target.value);
            setCurrentMatch(0);
          }}
        />
        {searchQuery ? <span className="editable-code-search-count">{matchLabel}</span> : null}
        {searchQuery ? (
          <>
            <button
              type="button"
              className="editable-code-search-btn"
              aria-label="Previous match"
              onClick={handlePrev}
            >
              ↑
            </button>
            <button
              type="button"
              className="editable-code-search-btn"
              aria-label="Next match"
              onClick={handleNext}
            >
              ↓
            </button>
          </>
        ) : null}
      </div>
      <div className="editable-code-body">
        <code className="gutter" ref={gutterRef} role="presentation" aria-hidden>
          {gutter}
        </code>
        <textarea
          ref={textareaRef}
          className="editable-code-textarea"
          role="textbox"
          value={text}
          onChange={handleChange}
          onScroll={syncScroll}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
