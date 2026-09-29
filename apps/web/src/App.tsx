import React, { useMemo, useState } from "react";
import { LoroDoc, Awareness } from "loro-crdt";
import { CodeEditor, UserPresence } from "./components/CodeEditor";
import { useLoroSync } from "./hooks/useLoroSync";

export const App: React.FC = () => {
  // Stable LoroDoc and Awareness instances across re-renders
  const { doc, awareness } = useMemo(() => {
    const lDoc = new LoroDoc();
    const lAwareness = new Awareness(lDoc.peerIdStr);
    return { doc: lDoc, awareness: lAwareness };
  }, []);

  // WebSocket sync hook (Day 3 requirement)
  const { status, stats, reconnect } = useLoroSync(doc, "ws://localhost:3001");

  const [activeUser] = useState<UserPresence>({
    name: "ZA",
    colorClassName: "loro-user-za",
  });

  const [localFeedback, setLocalFeedback] = useState<string>("");

  // Retain offline test simulation button for local validation
  const handleSimulateAgentInsertion = () => {
    const peerDoc = new LoroDoc();
    peerDoc.import(doc.export({ mode: "snapshot" }));

    const timestamp = new Date().toLocaleTimeString();
    const snippet = `// [Agent Checkpoint ${timestamp}] Auto-generated test function\nfunction agentTask() {\n  return "verified by Loro CRDT";\n}\n\n`;

    peerDoc.getText("text").insert(0, snippet);

    const update = peerDoc.export({ mode: "update" });
    doc.import(update);
    doc.commit();

    setLocalFeedback(`Simulated peer inserted ${update.length} bytes at ${timestamp}`);
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
            Connecting to ws://localhost:3001...
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
            Offline Mode (Click to Connect)
          </button>
        );
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col items-center p-8">
      <header className="w-full max-w-5xl flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">ChronoCanvas</h1>
          <p className="text-sm text-neutral-400">Day 3 Milestone: WebSocket Binary Delta Sync (Loro CRDT)</p>
        </div>
        <div className="flex items-center gap-3">
          {getStatusBadge()}
          <span className="flex items-center gap-2 text-xs bg-neutral-800 px-3 py-1.5 rounded-md border border-neutral-700">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            Peer: <strong>{activeUser.name}</strong>
          </span>
          <button
            onClick={handleSimulateAgentInsertion}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3.5 py-1.5 rounded-md transition shadow-sm cursor-pointer"
          >
            Simulate Peer CRDT Insertion
          </button>
        </div>
      </header>

      {/* Sync Telemetry Bar */}
      <div className="w-full max-w-5xl mb-3 flex items-center justify-between text-xs font-mono bg-neutral-950/70 border border-neutral-800 px-4 py-2 rounded-lg text-neutral-400">
        <div className="flex gap-4">
          <span>Sent: <strong className="text-neutral-200">{stats.bytesSent} B</strong> ({stats.updatesSent} deltas)</span>
          <span>Received: <strong className="text-neutral-200">{stats.bytesReceived} B</strong> ({stats.updatesReceived} deltas)</span>
        </div>
        <div>
          {stats.lastSyncAt ? (
            <span className="text-emerald-400">Last Synced: {stats.lastSyncAt.toLocaleTimeString()}</span>
          ) : localFeedback ? (
            <span className="text-indigo-400">{localFeedback}</span>
          ) : (
            <span className="text-neutral-500">Ready to synchronize</span>
          )}
        </div>
      </div>

      <main className="w-full max-w-5xl">
        <CodeEditor
          doc={doc}
          awareness={awareness}
          currentUser={activeUser}
        />
      </main>
    </div>
  );
};

export default App;
