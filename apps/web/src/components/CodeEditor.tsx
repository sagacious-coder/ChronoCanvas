import React, { useEffect, useRef, useState } from "react";
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
import { CursorPosition, PeerAwareness, WorkspaceFile } from "../types/shared";
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
  // Multi-File & Upload capabilities
  activeFile?: WorkspaceFile;
  openFiles?: WorkspaceFile[];
  onSelectFile?: (fileId: string) => void;
  onCloseFile?: (fileId: string) => void;
  onUploadClick?: () => void;
  onDownloadClick?: () => void;
  onToggleExplorer?: () => void;
  isExplorerOpen?: boolean;
  onDropFiles?: (files: File[]) => void;
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
  activeFile,
  openFiles = [],
  onSelectFile,
  onCloseFile,
  onUploadClick,
  onDownloadClick,
  onToggleExplorer,
  isExplorerOpen = false,
  onDropFiles,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const activeTheme = themeConfig || getTheme("daylight");

  const fileName = activeFile?.name || "main.ts";

  const getLanguageLabel = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "py":
        return "Python (uv sandbox ready)";
      case "ts":
      case "tsx":
        return "TypeScript";
      case "js":
      case "jsx":
        return "JavaScript";
      case "json":
        return "JSON";
      case "md":
        return "Markdown";
      default:
        return "Plain Text / Code";
    }
  };

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

    const initialText = extractCanvasText(doc) || activeFile?.content || "";

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && onDropFiles) {
      onDropFiles(Array.from(e.dataTransfer.files));
    }
  };

  return (
    <div
      style={{
        backgroundColor: activeTheme.colors.cardBg,
        borderColor: isDragOver ? "#2563EB" : activeTheme.colors.border,
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative border rounded-2xl overflow-hidden shadow-apple-md flex flex-col transition-all duration-300 ${
        isRollbackActive ? "revert-pulse-active" : ""
      } ${isDragOver ? "ring-2 ring-[#2563EB]" : ""} ${className}`}
    >
      {/* Top Tab Bar (Multi-File Tabs & Quick Action Buttons) */}
      <div
        style={{
          backgroundColor: activeTheme.colors.bg,
          borderColor: activeTheme.colors.border,
        }}
        className="flex items-center justify-between border-b px-2 overflow-x-auto text-xs"
      >
        <div className="flex items-center gap-1 py-1 overflow-x-auto">
          {/* Toggle Explorer Button */}
          {onToggleExplorer && (
            <button
              type="button"
              onClick={onToggleExplorer}
              style={{
                backgroundColor: isExplorerOpen ? activeTheme.colors.cardBg : "transparent",
                borderColor: isExplorerOpen ? activeTheme.colors.border : "transparent",
                color: activeTheme.colors.text,
              }}
              className="px-2.5 py-1 rounded-lg border flex items-center gap-1.5 font-medium hover:opacity-80 transition cursor-pointer"
              title="Toggle File Explorer Sidebar"
            >
              <span>📁</span>
              <span>Files</span>
            </button>
          )}

          {/* Open File Tabs */}
          {openFiles.map((file) => {
            const isTabActive = file.id === (activeFile?.id || "f-main");
            return (
              <div
                key={file.id}
                onClick={() => onSelectFile && onSelectFile(file.id)}
                style={{
                  backgroundColor: isTabActive ? activeTheme.colors.cardBg : "transparent",
                  borderColor: isTabActive ? activeTheme.colors.border : "transparent",
                  color: isTabActive ? activeTheme.colors.text : activeTheme.colors.textMuted,
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border transition cursor-pointer text-xs ${
                  isTabActive ? "font-semibold shadow-2xs" : "hover:bg-black/5"
                }`}
              >
                <span>{file.name.endsWith(".py") ? "🐍" : file.name.endsWith(".json") ? "⚙️" : "📄"}</span>
                <span>{file.name}</span>
                {openFiles.length > 1 && onCloseFile && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseFile(file.id);
                    }}
                    className="w-4 h-4 rounded hover:bg-black/10 flex items-center justify-center text-[10px] opacity-60 hover:opacity-100 transition cursor-pointer ml-1"
                    title={`Close ${file.name}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Quick Upload & Download Action Buttons */}
        <div className="flex items-center gap-1.5 py-1">
          {onUploadClick && (
            <button
              type="button"
              onClick={onUploadClick}
              className="px-2.5 py-1 rounded-lg border text-[11px] font-medium transition cursor-pointer flex items-center gap-1 bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
              title="Upload code files from your computer"
            >
              <span>⬆️</span>
              <span>Upload</span>
            </button>
          )}

          {onDownloadClick && (
            <button
              type="button"
              onClick={onDownloadClick}
              style={{
                backgroundColor: activeTheme.colors.cardBg,
                borderColor: activeTheme.colors.border,
                color: activeTheme.colors.text,
              }}
              className="px-2.5 py-1 rounded-lg border text-[11px] font-medium transition cursor-pointer flex items-center gap-1 hover:opacity-80"
              title="Download active file"
            >
              <span>⬇️</span>
              <span>Export</span>
            </button>
          )}
        </div>
      </div>

      {/* Editor Sub-header with Active Presence & AI Streaming Banner */}
      <div
        style={{
          backgroundColor: activeTheme.colors.headerBg,
          borderColor: activeTheme.colors.border,
        }}
        className="flex items-center justify-between px-5 py-2 border-b text-xs"
      >
        <div className="flex items-center gap-2">
          <span style={{ color: activeTheme.colors.text }} className="font-mono font-semibold">
            {fileName}
          </span>
          <span
            style={{
              backgroundColor: activeTheme.colors.bg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="text-[10px] px-2 py-0.5 rounded-md border font-mono"
          >
            {getLanguageLabel(fileName)}
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

      {/* Floating Positive Green Revert Notification Indicator */}
      {isRollbackActive && (
        <div className="absolute top-14 right-6 z-20 flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] shadow-apple-lg text-xs font-mono animate-bounce">
          <span className="w-2 h-2 rounded-full bg-[#34A853]" />
          <span className="font-semibold">{rollbackMessage || "Document Reverted Successfully (< 4ms)"}</span>
        </div>
      )}

      {/* Drag & Drop Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#2563EB]/10 backdrop-blur-2xs border-2 border-dashed border-[#2563EB] m-2 rounded-xl pointer-events-none">
          <span className="text-3xl">⬆️</span>
          <span className="text-sm font-semibold text-[#1D4ED8] mt-2">Drop code file to upload and open</span>
        </div>
      )}

      <div ref={containerRef} className="h-[520px] w-full" />
    </div>
  );
};
