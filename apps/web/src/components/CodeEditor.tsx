import React, { useEffect, useRef } from "react";
import { EditorState, Extension } from "@codemirror/state";
import { 
  EditorView, 
  lineNumbers, 
  highlightActiveLineGutter, 
  highlightSpecialChars, 
  drawSelection, 
  dropCursor, 
  keymap 
} from "@codemirror/view";
import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

import { LoroDoc, Awareness, UndoManager } from "loro-crdt";
import { LoroExtensions } from "loro-codemirror";

export interface UserPresence {
  name: string;
  colorClassName: string;
}

interface CodeEditorProps {
  doc: LoroDoc;
  awareness: Awareness;
  currentUser: UserPresence;
  className?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  doc,
  awareness,
  currentUser,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const undoManager = new UndoManager(doc, {});

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      javascript({ typescript: true }),
      oneDark,
      keymap.of([...defaultKeymap, indentWithTab]),
      LoroExtensions(
        doc,
        {
          awareness: awareness,
          user: {
            name: currentUser.name,
            colorClassName: currentUser.colorClassName,
          },
        },
        undoManager
      ),
    ];

    const state = EditorState.create({
      doc: doc.getText("text").toString(),
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [doc, awareness, currentUser]);

  return (
    <div
      ref={containerRef}
      className={`border border-neutral-700 rounded-lg overflow-hidden h-[600px] w-full bg-[#282c34] ${className}`}
    />
  );
};
