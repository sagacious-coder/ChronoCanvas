import React, { useEffect, useRef } from "react";
import { EditorState, Extension } from "@codemirror/state";
import { 
  EditorView, 
  lineNumbers, 
  highlightActiveLineGutter, 
  highlightSpecialChars, 
  drawSelection, 
  dropCursor, 
  keymap,
  ViewUpdate
} from "@codemirror/view";
import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";

import { LoroDoc, Awareness, UndoManager } from "loro-crdt";
import { LoroExtensions } from "loro-codemirror";
import { CursorPosition, PeerAwareness } from "../types/shared";

export interface UserPresence {
  name: string;
  colorClassName: string;
}

interface CodeEditorProps {
  doc: LoroDoc;
  awareness: Awareness;
  currentUser: UserPresence;
  remotePeers?: Map<string, PeerAwareness>;
  isStreaming?: boolean;
  isRollbackActive?: boolean;
  rollbackMessage?: string | null;
  onCursorChange?: (cursor: CursorPosition, selection?: { anchor: number; head: number }) => void;
  className?: string;
}

/**
 * Universal container reader: reads text from whichever container key
 * the backend or agent worker used (e.g. 'text', 'code', 'content', 'canvas').
 */
export function extractCanvasText(doc: LoroDoc): string {
  // 1. Try explicit 'text' container
  try {
    const t = doc.getText("text").toString();
    if (t && t.length > 0) return t;
  } catch {}

  // 2. Try inspecting toJSON() for any populated text container
  try {
    const json = doc.toJSON() as Record<string, unknown>;
    for (const key of Object.keys(json)) {
      const val = json[key];
      if (typeof val === "string" && val.length > 0) {
        return val;
      }
    }
  } catch {}

  // 3. Fallback candidates common in CRDT backends
  const candidates = ["code", "content", "canvas", "default", "main", "doc", ""];
  for (const key of candidates) {
    try {
      const t = doc.getText(key).toString();
      if (t && t.length > 0) return t;
    } catch {}
  }

  return "";
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  doc,
  awareness,
  currentUser,
  remotePeers,
  isStreaming = false,
  isRollbackActive = false,
  rollbackMessage = null,
  onCursorChange,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Broadcast cursor movements via updateListener
  const cursorUpdateListener = EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.selectionSet && onCursorChange) {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head);
      onCursorChange(
        {
          line: line.number,
          ch: head - line.from,
        },
        {
          anchor: update.state.selection.main.anchor,
          head: update.state.selection.main.head,
        }
      );
    }
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const undoManager = new UndoManager(doc, {});

    // Apple Human Interface creamy theme for CodeMirror 6
    const appleCreamyTheme = EditorView.theme({
      "&": {
        color: "#1F2328",
        backgroundColor: "#FAF8F5",
        fontSize: "13.5px",
      },
      ".cm-content": {
        caretColor: "#2563EB",
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#2563EB" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "#DDE5F5",
      },
      ".cm-gutters": {
        backgroundColor: "#F4EFE6",
        color: "#8C8273",
        borderRight: "1px solid #E6E2D8",
      },
      ".cm-activeLine": { backgroundColor: "#F1EBE0" },
      ".cm-activeLineGutter": { backgroundColor: "#E8E1D2", color: "#1F2328" },
    }, { dark: false });

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
      appleCreamyTheme,
      keymap.of([...defaultKeymap, indentWithTab]),
      cursorUpdateListener,
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

    const initialText = extractCanvasText(doc);

    const state = EditorState.create({
      doc: initialText,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    editorViewRef.current = view;

    // Reactivity Subscription: fires on ANY Loro document mutation (local, import, or agent delta)
    const sub = doc.subscribe(() => {
      if (editorViewRef.current) {
        const activeView = editorViewRef.current;
        const targetText = extractCanvasText(doc);
        const currentViewText = activeView.state.doc.toString();

        if (targetText && targetText !== currentViewText) {
          activeView.dispatch({
            changes: { from: 0, to: currentViewText.length, insert: targetText },
          });
        }
      }
    });

    return () => {
      if (typeof sub === "function") {
        sub();
      } else if (typeof sub === "number" && typeof (doc as any).unsubscribe === "function") {
        (doc as any).unsubscribe(sub);
      }
      view.destroy();
      editorViewRef.current = null;
    };
  }, [doc, awareness, currentUser]);

  const activePeerList = remotePeers ? Array.from(remotePeers.values()) : [];

  return (
    <div
      className={`relative border border-[#E6E2D8] rounded-2xl overflow-hidden shadow-apple-md bg-[#FAF8F5] flex flex-col transition-all duration-300 ${
        isRollbackActive ? "revert-pulse-active" : ""
      } ${className}`}
    >
      {/* Editor Sub-header with Active Presence & AI Streaming Banner */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-[#F7F4EB] border-b border-[#E6E2D8] text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[#1F2328] font-mono font-medium">main.ts</span>
          <span className="text-[10px] text-[#656D76] bg-[#FFFFFF] px-2 py-0.5 rounded-md border border-[#E6E2D8] font-mono">
            TypeScript / Python
          </span>
          {isStreaming && (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F5F3FF] text-[#7C3AED] border border-[#DDD6FE] animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED] animate-ping" />
              AI Agent Streaming Tokens...
            </span>
          )}
        </div>

        {/* Live Multi-Cursor Presence List */}
        <div className="flex items-center gap-2.5">
          <span className="text-[#656D76] text-xs flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
            You ({currentUser.name})
          </span>

          {activePeerList.map((peer) => (
            <span
              key={peer.peerId}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border"
              style={{
                borderColor: peer.isAgent ? "#DDD6FE" : (peer.userName === "MU" ? "#CEEAD6" : "#BFDBFE"),
                backgroundColor: peer.isAgent ? "#F5F3FF" : (peer.userName === "MU" ? "#E6F4EA" : "#EFF6FF"),
                color: peer.isAgent ? "#7C3AED" : (peer.userName === "MU" ? "#137333" : "#1D4ED8"),
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: peer.isAgent ? "#7C3AED" : (peer.userName === "MU" ? "#137333" : "#2563EB") }}
              />
              {peer.userName} {peer.cursor ? `(L${peer.cursor.line}:${peer.cursor.ch})` : ""}
            </span>
          ))}
        </div>
      </div>

      {/* Floating Positive Green Revert Notification Indicator */}
      {isRollbackActive && (
        <div className="absolute top-14 right-6 z-20 flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] shadow-apple-lg text-xs font-mono animate-bounce">
          <span className="w-2 h-2 rounded-full bg-[#34A853]" />
          <span className="font-semibold">{rollbackMessage || "Document Reverted Successfully (< 4ms)"}</span>
        </div>
      )}

      <div ref={containerRef} className="h-[520px] w-full" />
    </div>
  );
};
