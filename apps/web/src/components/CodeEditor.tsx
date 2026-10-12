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
import { ThemeConfig, getTheme } from "../styles/themes";

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
  themeConfig?: ThemeConfig;
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
  themeConfig,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const activeTheme = themeConfig || getTheme("daylight");

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

    // Dynamic theme for CodeMirror 6 adhering to active theme configuration
    const dynamicEditorTheme = EditorView.theme({
      "&": {
        color: activeTheme.colors.text,
        backgroundColor: activeTheme.colors.editorBg,
        fontSize: "13.5px",
        width: "100%",
        height: "100%",
      },
      ".cm-content": {
        caretColor: activeTheme.colors.accent,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: activeTheme.colors.accent },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: activeTheme.colors.editorSelection,
      },
      ".cm-gutters": {
        backgroundColor: activeTheme.colors.editorGutter,
        color: activeTheme.colors.editorGutterText,
        borderRight: `1px solid ${activeTheme.colors.border}`,
      },
      ".cm-activeLine": { backgroundColor: activeTheme.colors.headerBg },
      ".cm-activeLineGutter": { backgroundColor: activeTheme.colors.borderHover, color: activeTheme.colors.text },
    }, { dark: activeTheme.isDark });

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
      dynamicEditorTheme,
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
  }, [doc, awareness, currentUser, activeTheme]);

  const activePeerList = remotePeers ? Array.from(remotePeers.values()) : [];

  return (
    <div
      style={{
        backgroundColor: activeTheme.colors.cardBg,
        borderColor: activeTheme.colors.border,
      }}
      className={`w-full relative border rounded-2xl overflow-hidden shadow-apple-md flex flex-col transition-all duration-300 ${
        isRollbackActive ? "revert-pulse-active" : ""
      } ${className}`}
    >
      {/* Editor Sub-header with Active Presence & AI Streaming Banner */}
      <div
        style={{
          backgroundColor: activeTheme.colors.headerBg,
          borderColor: activeTheme.colors.border,
        }}
        className="flex items-center justify-between px-5 py-2.5 border-b text-xs"
      >
        <div className="flex items-center gap-2">
          <span style={{ color: activeTheme.colors.text }} className="font-mono font-medium">
            main.ts
          </span>
          <span
            style={{
              backgroundColor: activeTheme.colors.bg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="text-[10px] px-2 py-0.5 rounded-md border font-mono"
          >
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
          <span style={{ color: activeTheme.colors.textMuted }} className="text-xs flex items-center gap-1.5">
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

      {/* Floating Notification Indicator (Green Success / Red Failure) */}
      {isRollbackActive && (() => {
        const isFailed = Boolean(
          rollbackMessage &&
            (rollbackMessage.toLowerCase().includes("failed") || rollbackMessage.toLowerCase().includes("error"))
        );
        return (
          <div
            className={`absolute top-14 right-6 z-20 flex items-center gap-2 px-4 py-2 rounded-xl shadow-apple-lg text-xs font-mono animate-bounce border ${
              isFailed
                ? "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]"
                : "bg-[#E6F4EA] text-[#137333] border-[#CEEAD6]"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isFailed ? "bg-[#EF4444]" : "bg-[#34A853]"
              }`}
            />
            <span className="font-semibold">{rollbackMessage || "Document Reverted Successfully (< 4ms)"}</span>
          </div>
        );
      })()}

      <div ref={containerRef} className="h-[520px] w-full" />
    </div>
  );
};
