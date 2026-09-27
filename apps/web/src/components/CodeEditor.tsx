import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle
} from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';

export interface CodeEditorProps {
  initialCode?: string;
  value?: string;
  language?: 'python' | 'javascript';
  onChange?: (code: string) => void;
  readOnly?: boolean;
}

export const CodeEditor = ({
  initialCode = '',
  value,
  language = 'python',
  onChange,
  readOnly = false
}: CodeEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Compartments allow dynamic reconfiguration without recreating the EditorView
  const languageCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;

  // Keep a mutable ref to onChange to prevent recreating the editor on parent re-renders
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 1. Initial Mount: Instantiate CodeMirror 6 exactly once
  useEffect(() => {
    if (!editorRef.current) return;

    // Clear any previous child nodes (guards against React 18 StrictMode double-mount artifacts)
    editorRef.current.innerHTML = '';

    const langExt = language === 'python' ? python() : javascript();
    const startDoc = value !== undefined ? value : initialCode;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && onChangeRef.current) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const startState = EditorState.create({
      doc: startDoc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        oneDark,
        languageCompartment.of(langExt),
        readOnlyCompartment.of(EditorView.editable.of(!readOnly)),
        updateListener,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab
        ]),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px',
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
            backgroundColor: '#090d16 !important'
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'inherit'
          },
          '.cm-gutters': {
            backgroundColor: '#060911',
            color: '#64748b',
            borderRight: '1px solid #1e293b'
          },
          '&.cm-focused .cm-cursor': {
            borderLeftColor: '#38bdf8',
            borderLeftWidth: '2px'
          },
          '&.cm-focused .cm-selectionBackground, ::selection': {
            backgroundColor: '#1e3a8a !important'
          }
        })
      ]
    });

    const view = new EditorView({
      state: startState,
      parent: editorRef.current
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  // Intentionally empty dependency array: Mount once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Dynamic Language Reconfiguration (Zero cursor jump, preserves undo history)
  useEffect(() => {
    if (!viewRef.current) return;
    const langExt = language === 'python' ? python() : javascript();
    viewRef.current.dispatch({
      effects: languageCompartment.reconfigure(langExt)
    });
  }, [language, languageCompartment]);

  // 3. Dynamic ReadOnly Reconfiguration
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorView.editable.of(!readOnly))
    });
  }, [readOnly, readOnlyCompartment]);

  // 4. Controlled External Value Sync (only dispatch if external value differs from doc)
  useEffect(() => {
    if (!viewRef.current || value === undefined) return;
    const currentDoc = viewRef.current.state.doc.toString();
    if (value !== currentDoc) {
      viewRef.current.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value }
      });
    }
  }, [value]);

  return (
    <div className="relative w-full h-full flex flex-col border border-slate-800 rounded-lg overflow-hidden bg-[#090d16] shadow-2xl min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#060911] text-xs text-slate-400 shrink-0">
        <div className="flex items-center space-x-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-medium text-slate-300 uppercase tracking-wider">
            CodeMirror 6 • {language}
          </span>
        </div>
        <div className="flex items-center space-x-3 text-slate-500">
          <span>UTF-8</span>
          <span>Tab: 2 spaces</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
            Stage 0 • Day 1
          </span>
        </div>
      </div>
      <div ref={editorRef} className="flex-1 w-full h-full overflow-hidden min-h-0" />
    </div>
  );
};
