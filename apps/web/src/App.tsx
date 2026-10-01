import React, { useMemo, useState, useEffect } from "react";
import { LoroDoc, Awareness } from "loro-crdt";
import { CodeEditor, UserPresence } from "./components/CodeEditor";
import { AgentControlPanel } from "./components/AgentControlPanel";
import { useLoroSync } from "./hooks/useLoroSync";
import { CursorPosition } from "./types/shared";

export const App: React.FC = () => {
  // Stable LoroDoc and Awareness instances across re-renders
  const { doc, awareness } = useMemo(() => {
    const lDoc = new LoroDoc();
    const lAwareness = new Awareness(lDoc.peerIdStr);
    return { doc: lDoc, awareness: lAwareness };
  }, []);

  // Determine user identity: check URL param ?user=MU or default to ZA
  const [currentUser, setCurrentUser] = useState<UserPresence>(() => {
    const params = new URLSearchParams(window.location.search);
    const userParam = params.get("user");
    if (userParam?.toUpperCase() === "MU") {
      return { name: "MU", colorClassName: "loro-user-mu" };
    }
    return { name: "ZA", colorClassName: "loro-user-za" };
  });

  // Unique peer identifier for presence tracking
  const peerId = useMemo(() => {
    return `${currentUser.name}-${Math.random().toString(36).substring(2, 7)}`;
  }, [currentUser.name]);

  // Synchronize WebSocket client with Loro CRDT, Awareness & Temporal Agent signals
  const {
    status,
    stats,
    agentStatus,
    remotePeers,
    dispatchAgentTask,
    clearAgentStatus,
    broadcastAwareness,
    getFrontierString,
    reconnect,
  } = useLoroSync(doc, "ws://localhost:3001");

  const [currentFrontier, setCurrentFrontier] = useState<string>("root-0");

  useEffect(() => {
    setCurrentFrontier(getFrontierString());
  }, [getFrontierString, stats.updatesSent, stats.updatesReceived]);

  const handleCursorChange = (cursor: CursorPosition, selection?: { anchor: number; head: number }) => {
    broadcastAwareness({
      peerId,
      userName: currentUser.name,
      userColor: currentUser.name === "ZA" ? "#3b82f6" : "#10b981",
      cursor,
      selection,
    });
  };

  const toggleUserIdentity = () => {
    if (currentUser.name === "ZA") {
      setCurrentUser({ name: "MU", colorClassName: "loro-user-mu" });
    } else {
      setCurrentUser({ name: "ZA", colorClassName: "loro-user-za" });
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case "connected":
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Live WebSocket Connected
          </span>
        );
      case "connecting":
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950/80 text-amber-400 border border-amber-800">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            Connecting to Relay...
          </span>
        );
      case "disconnected":
      case "error":
      default:
        return (
          <button
            onClick={reconnect}
            title="Click to reconnect"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 transition cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-neutral-500" />
            Offline Mode (Click to Reconnect)
          </button>
        );
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col items-center p-6 md:p-10 font-sans">
      <header className="w-full max-w-5xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">ChronoCanvas</h1>
            <span className="text-xs bg-indigo-950 text-indigo-400 border border-indigo-800 px-2 py-0.5 rounded font-mono">
              Stage 2 • Day 5 & 6
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Human-AI Co-Editing • CRDT Zero-Lock Concurrency • Temporal Checkpoints
          </p>
        </div>

        <div className="flex items-center gap-3">
          {getStatusBadge()}

          {/* User Presence Switcher Button */}
          <button
            onClick={toggleUserIdentity}
            title="Click to switch peer identity for two-tab testing"
            className="flex items-center gap-2 text-xs bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 rounded-lg border border-neutral-700 transition cursor-pointer"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: currentUser.name === "ZA" ? "#3b82f6" : "#10b981" }}
            />
            Peer: <strong>{currentUser.name}</strong>
            <span className="text-[10px] text-neutral-400 underline">(switch)</span>
          </button>
        </div>
      </header>

      <main className="w-full max-w-5xl">
        {/* Day 5: Agent Task Controller & Workflow Status Indicators */}
        <AgentControlPanel
          onTriggerTask={dispatchAgentTask}
          onClearStatus={clearAgentStatus}
          currentStatus={agentStatus}
          currentFrontier={currentFrontier}
          isConnecting={status !== "connected"}
        />

        {/* Sync Telemetry Bar */}
        <div className="w-full mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono bg-neutral-950/70 border border-neutral-800 px-4 py-2 rounded-lg text-neutral-400">
          <div className="flex gap-4">
            <span>Sent: <strong className="text-neutral-200">{stats.bytesSent} B</strong> ({stats.updatesSent} deltas)</span>
            <span>Received: <strong className="text-neutral-200">{stats.bytesReceived} B</strong> ({stats.updatesReceived} deltas)</span>
          </div>
          <div>
            {stats.lastSyncAt ? (
              <span className="text-emerald-400">Last Synced: {stats.lastSyncAt.toLocaleTimeString()}</span>
            ) : (
              <span className="text-neutral-500">Ready to synchronize</span>
            )}
          </div>
        </div>

        {/* Code Editor with Real-Time Multi-Cursor Awareness & Live Reactivity */}
        <CodeEditor
          doc={doc}
          awareness={awareness}
          currentUser={currentUser}
          remotePeers={remotePeers}
          isStreaming={agentStatus?.status === "generating"}
          onCursorChange={handleCursorChange}
        />
      </main>
    </div>
  );
};

export default App;
