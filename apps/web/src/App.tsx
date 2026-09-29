import React, { useMemo, useState } from "react";
import { LoroDoc, Awareness } from "loro-crdt";
import { CodeEditor, UserPresence } from "./components/CodeEditor";

export const App: React.FC = () => {
  // Stable LoroDoc and Awareness instances
  const { doc, awareness } = useMemo(() => {
    const lDoc = new LoroDoc();
    const lAwareness = new Awareness(lDoc.peerIdStr);
    return { doc: lDoc, awareness: lAwareness };
  }, []);

  const [activeUser] = useState<UserPresence>({
    name: "ZA",
    colorClassName: "loro-user-za",
  });

  const [logMessage, setLogMessage] = useState<string>("");

  // Correct Peer Simulation:
  // An agent/teammate lives on another peer and sends update deltas via doc.import()
  const handleSimulateAgentInsertion = () => {
    // 1. Create a simulated remote peer
    const peerDoc = new LoroDoc();
    
    // 2. Sync peerDoc with current document state
    peerDoc.import(doc.export({ mode: "snapshot" }));

    // 3. The remote peer writes code
    const timestamp = new Date().toLocaleTimeString();
    const peerText = peerDoc.getText("text");
    peerText.insert(0, `// [Agent Checkpoint ${timestamp}] Auto-generated test function\nfunction agentTask() {\n  return "verified by Loro CRDT";\n}\n\n`);

    // 4. Export the peer's delta
    const update = peerDoc.export({ mode: "update", from: doc.oplogVersion() });

    // 5. Import into local doc (loro-codemirror catches this and updates the screen)
    doc.import(update);

    setLogMessage(`Imported ${update.length} bytes from simulated peer at ${timestamp}`);
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col items-center p-8">
      <header className="w-full max-w-5xl flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">ChronoCanvas</h1>
          <p className="text-sm text-neutral-400">Day 2 Milestone: CodeMirror 6 + Loro CRDT Mounting</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs bg-neutral-800 px-3 py-1.5 rounded-md border border-neutral-700">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
            Active Peer: <strong>{activeUser.name}</strong>
          </span>
          <button
            onClick={handleSimulateAgentInsertion}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3.5 py-1.5 rounded-md transition shadow-sm cursor-pointer"
          >
            Simulate Peer CRDT Insertion
          </button>
        </div>
      </header>

      {logMessage && (
        <div className="w-full max-w-5xl mb-3 text-xs text-emerald-400 font-mono bg-neutral-950/60 border border-neutral-800 px-3 py-1.5 rounded">
          ✓ {logMessage}
        </div>
      )}

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