import { useEffect, useRef, useCallback } from 'react';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  rectangularSelection,
  highlightSpecialChars,
} from '@codemirror/view';
import { EditorState, Extension, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
  foldKeymap,
} from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { search, searchKeymap, highlightSelectionMatches, searchPanelOpen } from '@codemirror/search';
import { oneDark, oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

export interface EditableCodeViewerProps {
  text: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  readOnly?: boolean;
}

// ── Compartments for dynamic reconfiguration ──────────────────────
const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const themeCompartment = new Compartment();

// ── Language detection ─────────────────────────────────────────────
function detectLanguage(text: string): Extension {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<?xml')) {
    return html();
  }
  if (trimmed.startsWith('<') && /<\w+[\s>]/.test(trimmed)) {
    return html();
  }
  if (trimmed.startsWith('{') || /^\s*[\w-]+\s*:/.test(trimmed)) {
    return css();
  }
  return html();
}

// ── Theme helpers ──────────────────────────────────────────────────

/** Read the current app theme from the DOM */
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/** Shared base styles used by both light and dark themes */
const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
  },
  '.cm-content': {
    fontFamily: 'var(--mono, monospace)',
    padding: '8px 16px 8px 0',
    lineHeight: '1.65',
  },
  '.cm-cursor': {
    borderLeft: '2px solid var(--accent, #6366f1)',
  },
  '.cm-gutters': {
    fontFamily: 'var(--mono, monospace)',
    fontSize: '12px',
    border: 'none',
    borderRight: '1px solid var(--border-soft, #e5e5e5)',
    minWidth: '3.5em',
    paddingLeft: '4px',
  },
  '.cm-gutterElement': {
    lineHeight: '1.65',
  },
  '.cm-activeLineGutter': {
    fontWeight: '500',
  },
  '.cm-activeLine': {
    borderRadius: '2px',
  },
  '.cm-selectionBackground': {
    borderRadius: '2px',
  },
  '&.cm-focused .cm-selectionBackground': {
    borderRadius: '2px',
  },
  '.cm-foldGutter': {
    width: '16px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    cursor: 'pointer',
    fontSize: '10px',
    textAlign: 'center',
    transition: 'color 100ms ease, background 100ms ease',
    borderRadius: '3px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--mono, monospace)',
  },
  '.cm-line': {
    padding: '0 16px 0 12px',
  },
  // Search panel — 2-row layout:
  //   Row 1: search input + prev/next
  //   Row 2: replace input + replace/replace all
  '.cm-panel.cm-search': {
    fontFamily: 'var(--mono, monospace)',
    fontSize: '12px',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border, #e5e5e5)',
    position: 'relative',
    lineHeight: '1.8',
  },
  '.cm-panel.cm-search button[name="select"]': {
    display: 'none',
  },
  '.cm-panel.cm-search label': {
    display: 'none',
  },
  '.cm-panel.cm-search .cm-textfield': {
    fontFamily: 'var(--mono, monospace)',
    fontSize: '12px',
    padding: '4px 8px',
    border: '1px solid var(--border, #e5e5e5)',
    borderRadius: '4px',
    outline: 'none',
    minWidth: '160px',
    transition: 'border-color 120ms ease',
  },
  '.cm-panel.cm-search .cm-textfield:focus': {
    borderColor: 'var(--accent, #6366f1)',
  },
  '.cm-panel.cm-search .cm-button': {
    fontFamily: 'inherit',
    fontSize: '12px',
    padding: '3px 10px',
    border: '1px solid var(--border, #e5e5e5)',
    borderRadius: '4px',
    cursor: 'pointer',
    lineHeight: '1.4',
    transition: 'background 100ms ease, border-color 100ms ease',
  },
  '.cm-panel.cm-search .cm-button:hover': {
    borderColor: 'var(--text-muted, #888)',
  },
  '.cm-panel.cm-search button[name="close"]': {
    fontSize: '16px',
    padding: '0 4px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    lineHeight: 1,
    opacity: 0.5,
  },
  '.cm-panel.cm-search button[name="close"]:hover': {
    opacity: 1,
  },
  '.cm-searchMatch': {
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    borderRadius: '2px',
  },
  // Scrollbar
  '.cm-scroller::-webkit-scrollbar': {
    width: '8px',
    height: '8px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    background: 'transparent',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    borderRadius: '4px',
  },
}, { dark: false });

/** Light theme — matches the default app appearance */
const lightTheme = EditorView.theme({
  '&': {
    background: 'var(--bg-panel, #ffffff)',
    color: 'var(--text, #333)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent, #6366f1)',
  },
  '.cm-gutters': {
    background: 'var(--bg, #f8f8f8)',
    color: 'var(--text-faint, #aaa)',
  },
  '.cm-activeLineGutter': {
    background: 'color-mix(in srgb, var(--accent, #6366f1) 6%, transparent)',
    color: 'var(--text-muted, #666)',
  },
  '.cm-activeLine': {
    background: 'color-mix(in srgb, var(--accent, #6366f1) 4%, transparent)',
  },
  '.cm-selectionBackground': {
    background: 'color-mix(in oklab, var(--accent, #6366f1) 22%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground': {
    background: 'color-mix(in oklab, var(--accent, #6366f1) 30%, transparent)',
  },
  '.cm-searchMatch': {
    background: 'color-mix(in oklab, var(--accent, #6366f1) 22%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    background: 'color-mix(in oklab, var(--accent, #6366f1) 42%, transparent)',
    outline: '1px solid color-mix(in oklab, var(--accent, #6366f1) 55%, transparent)',
  },
  '.cm-foldGutter .cm-gutterElement': {
    color: 'var(--text-faint, #bbb)',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    background: 'var(--bg-subtle, #f0f0f0)',
    color: 'var(--text, #333)',
  },
  // Search panel (light)
  '.cm-panel.cm-search': {
    background: 'var(--bg, #f8f8f8)',
    color: 'var(--text, #333)',
    borderBottomColor: 'var(--border, #e5e5e5)',
  },
  '.cm-panel.cm-search .cm-textfield': {
    background: 'var(--bg-panel, #fff)',
    color: 'var(--text, #333)',
    borderColor: 'var(--border, #e5e5e5)',
  },
  '.cm-panel.cm-search .cm-button': {
    background: 'var(--bg-panel, #fff)',
    color: 'var(--text-muted, #666)',
    borderColor: 'var(--border, #e5e5e5)',
  },
  '.cm-panel.cm-search .cm-button:hover': {
    background: 'var(--bg-subtle, #f0f0f0)',
  },
  // Scrollbar
  '.cm-scroller::-webkit-scrollbar-thumb': {
    background: 'color-mix(in srgb, var(--text-faint, #ccc) 40%, transparent)',
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    background: 'color-mix(in srgb, var(--text-muted, #999) 50%, transparent)',
  },
}, { dark: false });

/** Dark theme — refined for dark mode */
const darkTheme = EditorView.theme({
  '&': {
    background: 'var(--bg-panel, #1e1e2e)',
    color: 'var(--text, #cdd6f4)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent, #89b4fa)',
  },
  '.cm-gutters': {
    background: 'var(--bg, #11111b)',
    color: 'var(--text-faint, #585b70)',
    borderRightColor: 'var(--border-soft, #313244)',
  },
  '.cm-activeLineGutter': {
    background: 'color-mix(in srgb, var(--accent, #89b4fa) 10%, transparent)',
    color: 'var(--text-muted, #a6adc8)',
  },
  '.cm-activeLine': {
    background: 'color-mix(in srgb, var(--text-faint, #585b70) 8%, transparent)',
  },
  '.cm-selectionBackground': {
    background: 'color-mix(in oklab, var(--accent, #89b4fa) 28%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground': {
    background: 'color-mix(in oklab, var(--accent, #89b4fa) 38%, transparent)',
  },
  '.cm-searchMatch': {
    background: 'color-mix(in oklab, var(--accent, #89b4fa) 25%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    background: 'color-mix(in oklab, var(--accent, #89b4fa) 45%, transparent)',
    outline: '1px solid color-mix(in oklab, var(--accent, #89b4fa) 60%, transparent)',
  },
  '.cm-foldGutter .cm-gutterElement': {
    color: 'var(--text-faint, #585b70)',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    background: 'var(--bg-subtle, #313244)',
    color: 'var(--text, #cdd6f4)',
  },
  // Search panel (dark)
  '.cm-panel.cm-search': {
    background: 'var(--bg, #11111b)',
    color: 'var(--text, #cdd6f4)',
    borderBottomColor: 'var(--border, #313244)',
  },
  '.cm-panel.cm-search .cm-textfield': {
    background: 'var(--bg-panel, #1e1e2e)',
    color: 'var(--text, #cdd6f4)',
    borderColor: 'var(--border, #313244)',
  },
  '.cm-panel.cm-search .cm-button': {
    background: 'var(--bg-panel, #1e1e2e)',
    color: 'var(--text-muted, #a6adc8)',
    borderColor: 'var(--border, #313244)',
  },
  '.cm-panel.cm-search .cm-button:hover': {
    background: 'var(--bg-subtle, #313244)',
  },
  '.cm-panel.cm-search button[name="close"]': {
    color: 'var(--text-muted, #a6adc8)',
  },
  // Scrollbar (dark)
  '.cm-scroller::-webkit-scrollbar-thumb': {
    background: 'color-mix(in srgb, var(--text-faint, #585b70) 50%, transparent)',
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    background: 'color-mix(in srgb, var(--text-muted, #a6adc8) 50%, transparent)',
  },
}, { dark: true });

/** Build the theme extensions for a given mode */
function buildThemeExtensions(dark: boolean): Extension[] {
  if (dark) {
    return [
      baseTheme,
      darkTheme,
      oneDark,
      syntaxHighlighting(oneDarkHighlightStyle),
    ];
  }
  return [
    baseTheme,
    lightTheme,
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  ];
}

// ── Component ──────────────────────────────────────────────────────

export function EditableCodeViewer({ text, onChange, onSave, onDirtyChange, readOnly = false }: EditableCodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const savedTextRef = useRef(text);
  const prevDirtyRef = useRef(false);
  const observerRef = useRef<MutationObserver | null>(null);

  const checkDirty = useCallback((currentText: string) => {
    const dirty = currentText !== savedTextRef.current;
    if (dirty !== prevDirtyRef.current) {
      prevDirtyRef.current = dirty;
      onDirtyChange?.(dirty);
    }
  }, [onDirtyChange]);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const dark = isDarkTheme();
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      highlightSelectionMatches(),
      languageCompartment.of(detectLanguage(text)),
      readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
      themeCompartment.of(buildThemeExtensions(dark)),
      search({ top: true }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        indentWithTab,
        {
          key: 'Mod-s',
          run: () => {
            savedTextRef.current = viewRef.current?.state.doc.toString() ?? text;
            onSave?.();
            return true;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChange) {
          const newText = update.state.doc.toString();
          onChange(newText);
          checkDirty(newText);
        }
      }),
      EditorView.lineWrapping,
    ];

    const state = EditorState.create({ doc: text, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    // Watch for app theme changes and update editor
    observerRef.current = new MutationObserver(() => {
      const nextDark = isDarkTheme();
      view.dispatch({
        effects: themeCompartment.reconfigure(buildThemeExtensions(nextDark)),
      });
    });
    observerRef.current.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external text changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentText = view.state.doc.toString();
    if (currentText === text) return;

    view.dispatch({
      changes: { from: 0, to: currentText.length, insert: text },
      effects: languageCompartment.reconfigure(detectLanguage(text)),
    });
  }, [text]);

  // Sync readOnly changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return (
    <div className="editable-code-viewer" ref={containerRef} />
  );
}
