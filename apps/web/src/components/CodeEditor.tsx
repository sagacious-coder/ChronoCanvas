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
import { oneDark } from "@codemirror/theme-one-dark";

import { LoroDoc, Awareness, UndoManager } from "loro-crdt";
import { LoroExtensions } from "loro-codemirror";
import { CursorPosition, PeerAwareness } from "@chronocanvas/shared-types";

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
  onCursorChange?: (cursor: CursorPosition, selection?: { anchor: number; head: number }) => void;
  className?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  doc,
  awareness,
  currentUser,
  remotePeers,
  isStreaming = false,
  onCursorChange,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

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

    // LoroExtensions (loro-codemirror) owns the "codemirror" text container and
    // manages the full Loro↔CodeMirror bridge internally — including local, import,
    // and checkout events — via LoroSyncPluginValue. We must seed CM with the same
    // container key the library reads, not a separate "text" container.
    const initialText = doc.getText("codemirror").toString();

    const state = EditorState.create({
      doc: initialText,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    // NOTE: No manual doc.subscribe here.
    // LoroExtensions (LoroSyncPluginValue inside loro-codemirror) installs its own
    // doc.subscribe in its constructor and handles all Loro→CM syncing internally
    // for import and checkout events using loroSyncAnnotation to prevent loops.
    // Adding a second subscriber here that reads a *different* container key
    // ("text" vs. "codemirror") creates a dead-letter sync that never fires
    // correctly and fights the library on every remote import.

    return () => {
      view.destroy();
    };
  }, [doc, awareness, currentUser]);

  const activePeerList = remotePeers ? Array.from(remotePeers.values()) : [];

  return (
    <div className={`relative border border-neutral-700/80 rounded-xl overflow-hidden shadow-2xl bg-[#282c34] flex flex-col ${className}`}>
      {/* Editor Sub-header with Active Presence & AI Streaming Banner */}
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-950/70 border-b border-neutral-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-neutral-400 font-mono">main.ts</span>
          <span className="text-[10px] text-neutral-500 bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800 font-mono">
            TypeScript
          </span>
          {isStreaming && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-950/80 text-purple-300 border border-purple-800 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
              AI Agent Streaming Tokens...
            </span>
          )}
        </div>

        {/* Live Multi-Cursor Presence List (Day 4 & Day 6) */}
        <div className="flex items-center gap-3">
          <span className="text-neutral-400 text-xs flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            You ({currentUser.name})
          </span>

          {activePeerList.map((peer) => (
            <span
              key={peer.peerId}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border"
              style={{
                borderColor: peer.isAgent ? "#a855f7" : (peer.userColor || "#10b981"),
                backgroundColor: peer.isAgent ? "rgba(168, 85, 247, 0.2)" : `${peer.userColor || "#10b981"}20`,
                color: peer.isAgent ? "#d8b4fe" : (peer.userColor || "#10b981"),
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: peer.isAgent ? "#a855f7" : (peer.userColor || "#10b981") }}
              />
              {peer.userName} {peer.cursor ? `(L${peer.cursor.line}:${peer.cursor.ch})` : ""}
            </span>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="h-[520px] w-full" />
    </div>
  );
};
