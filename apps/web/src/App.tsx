import React, { useMemo, useState, useEffect, useCallback } from "react";
import { LoroDoc, Awareness } from "loro-crdt";
import { CodeEditor, UserPresence } from "./components/CodeEditor";
import { AgentControlPanel } from "./components/AgentControlPanel";
import { CheckpointTimeline, DocumentCheckpoint } from "./components/CheckpointTimeline";
import { SettingsModal, loadUserSettings, UserSettings, getActiveApiKey } from "./components/SettingsModal";
import { useLoroSync } from "./hooks/useLoroSync";
import { CursorPosition } from "./types/shared";

export const App: React.FC = () => {
  // Stable LoroDoc and Awareness instances across re-renders
  const { doc, awareness } = useMemo(() => {
    const lDoc = new LoroDoc();
    const lAwareness = new Awareness(lDoc.peerIdStr);
    return { doc: lDoc, awareness: lAwareness };
  }, []);

  // User Settings state with local storage persistence
  const [settings, setSettings] = useState<UserSettings>(() => loadUserSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const activeApiKey = useMemo(() => getActiveApiKey(settings), [settings]);
  const activeToken = settings.jwtToken?.trim() || "dev-dummy-token";

  // Determine user identity: check URL param ?user=MU or default to ZA
  const [currentUser, setCurrentUser] = useState<UserPresence>(() => {
    const params = new URLSearchParams(window.location.search);
    const userParam = params.get("user");
    if (userParam?.toUpperCase() === "MU") {
      return { name: "MU", colorClassName: "loro-user-mu" };
    }
    return { name: "ZA", colorClassName: "loro-user-za" };
  });

  const peerId = useMemo(() => {
    return `${currentUser.name}-${Math.random().toString(36).substring(2, 7)}`;
  }, [currentUser.name]);

  // Synchronize WebSocket client with Loro CRDT, Awareness & Temporal Agent signals
  const {
    status,
    isAuthenticated,
    authError,
    stats,
    agentStatus,
    remotePeers,
    dispatchAgentTask,
    clearAgentStatus,
    broadcastAwareness,
    getFrontierString,
    reconnect,
  } = useLoroSync(
    doc,
    "ws://localhost:3001",
    "chrono-canvas-default",
    peerId,
    activeToken,
    activeApiKey,
    settings.selectedProvider,
  );

  const [currentFrontier, setCurrentFrontier] = useState<string>("root-0");
  const [checkpoints, setCheckpoints] = useState<DocumentCheckpoint[]>([
    {
      id: "cp-init-root",
      timestamp: Date.now(),
      frontier: "root-0",
      label: "Initial Document State",
      origin: "initial",
      peer: "root-0",
    },
  ]);

  const [isRollbackActive, setIsRollbackActive] = useState<boolean>(false);
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null);

  // Monitor Frontier changes and record checkpoints
  useEffect(() => {
    const fStr = getFrontierString();
    setCurrentFrontier(fStr);

    if (fStr && fStr !== "root-0") {
      setCheckpoints((prev) => {
        if (prev.some((c) => c.frontier === fStr)) return prev;

        // Parse frontier string to detect author peer ID
        let detectedPeer: string | undefined;
        try {
          if (fStr !== "Latest") {
            const parsed = JSON.parse(fStr);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const agentEntry = parsed.find((entry: any) => String(entry.peer) === "999999999");
              if (agentEntry) {
                detectedPeer = "999999999";
              } else if (parsed[0]?.peer !== undefined) {
                detectedPeer = String(parsed[0].peer);
              }
            }
          }
        } catch {
          // ignore parsing error
        }

        const isAgent = detectedPeer === "999999999" || agentStatus?.status === "generating";

        const newCp: DocumentCheckpoint = {
          id: `cp-${Date.now()}`,
          timestamp: Date.now(),
          frontier: fStr,
          label: isAgent ? "Agent Generation Delta" : "Human Edit Checkpoint",
          origin: isAgent ? "agent" : "human",
          peer: detectedPeer || (isAgent ? "999999999" : doc.peerIdStr),
        };
        return [newCp, ...prev];
      });
    }
  }, [getFrontierString, stats.updatesSent, stats.updatesReceived, agentStatus?.status, doc.peerIdStr]);

  // Terminal Agent State Resolution & Automatic Reset
  useEffect(() => {
    if (agentStatus?.status === "completed" || agentStatus?.status === "committed") {
      setIsRollbackActive(true);
      setRollbackMessage("Agent Task Completed: Document Successfully Verified & Updated");
      const timer = setTimeout(() => {
        setIsRollbackActive(false);
        clearAgentStatus();
      }, 3000);
      return () => clearTimeout(timer);
    } else if (agentStatus?.status === "failed") {
      setIsRollbackActive(true);
      setRollbackMessage(
        agentStatus.errorTrace
          ? `Agent Task Failed: ${agentStatus.errorTrace}`
          : "Agent Task Failed: Maximum retries exhausted"
      );
      const timer = setTimeout(() => {
        setIsRollbackActive(false);
        clearAgentStatus();
      }, 3500);
      return () => clearTimeout(timer);
    } else if (agentStatus?.status === "rolled-back") {
      setIsRollbackActive(true);
      setRollbackMessage("Document Reverted Successfully: Restored to Checkpoint in < 4ms (human edits preserved)");
      const timer = setTimeout(() => {
        setIsRollbackActive(false);
        clearAgentStatus();
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [agentStatus?.status, agentStatus?.errorTrace, clearAgentStatus]);

  // Interactive Time-Travel / Checkpoint Reversion via doc.checkout()
  const handleRestoreCheckpoint = useCallback(
    (targetFrontier: string) => {
      try {
        if (targetFrontier === "root-0" || targetFrontier === "Latest") {
          doc.checkout([]);
        } else {
          const parsed = JSON.parse(targetFrontier);
          doc.checkout(parsed);
        }
        doc.commit();

        setCurrentFrontier(targetFrontier);
        setIsRollbackActive(true);
        setRollbackMessage(`Document Reverted Successfully: Checked out Frontier (${targetFrontier.substring(0, 15)}...)`);

        setTimeout(() => {
          setIsRollbackActive(false);
        }, 2500);
      } catch (err) {
        console.error("Error checking out frontier:", err);
      }
    },
    [doc]
  );

  const handleCursorChange = (cursor: CursorPosition, selection?: { anchor: number; head: number }) => {
    broadcastAwareness({
      peerId,
      userName: currentUser.name,
      userColor: currentUser.name === "ZA" ? "#2563EB" : "#059669",
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
    if (authError) {
      return (
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA] shadow-apple-sm">
          <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
          Auth Failed: {authError}
        </span>
      );
    }

    switch (status) {
      case "connected":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] shadow-apple-sm">
            <span className="w-2 h-2 rounded-full bg-[#34A853] animate-pulse" />
            {isAuthenticated ? `Live & Authenticated (${settings.selectedProvider})` : "Authenticating..."}
          </span>
        );
      case "connecting":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A] shadow-apple-sm">
            <span className="w-2 h-2 rounded-full bg-[#D97706] animate-ping" />
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#FAF8F5] hover:bg-[#F7F4EB] text-[#656D76] hover:text-[#1F2328] border border-[#E6E2D8] transition cursor-pointer shadow-apple-sm"
          >
            <span className="w-2 h-2 rounded-full bg-[#8C959F]" />
            Offline Mode (Click to Reconnect)
          </button>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#1F2328] flex flex-col items-center p-6 md:p-12 font-sans selection:bg-[#DDE5F5]">
      <header className="w-full max-w-5xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[#1F2328]">ChronoCanvas</h1>
            <span className="text-[11px] bg-[#EFEAD9] text-[#4B515D] border border-[#E2DCCF] px-2.5 py-0.5 rounded-full font-medium">
              Dual-Zone Core
            </span>
          </div>
          <p className="text-xs text-[#656D76] mt-1 font-normal">
            Human-AI Co-Editing &bull; CRDT Zero-Lock Concurrency &bull; Sub-5ms Instant Rollbacks
          </p>
        </div>

        <div className="flex items-center gap-3">
          {getStatusBadge()}

          {/* User Presence Switcher Button */}
          <button
            onClick={toggleUserIdentity}
            title="Click to switch peer identity for two-tab testing"
            className="flex items-center gap-2 text-xs bg-[#FFFFFF] hover:bg-[#F7F4EB] text-[#1F2328] px-3.5 py-1.5 rounded-xl border border-[#E6E2D8] transition cursor-pointer shadow-apple-sm"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: currentUser.name === "ZA" ? "#2563EB" : "#059669" }}
            />
            Peer: <strong>{currentUser.name}</strong>
            <span className="text-[10px] text-[#8C959F] underline">(switch)</span>
          </button>

          {/* Settings Modal Toggle Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            title="Configure JWT & BYOK API Keys"
            className="flex items-center gap-1.5 text-xs bg-[#FFFFFF] hover:bg-[#F7F4EB] text-[#1F2328] px-3.5 py-1.5 rounded-xl border border-[#E6E2D8] transition cursor-pointer shadow-apple-sm"
          >
            <svg className="w-3.5 h-3.5 text-[#656D76]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Settings</span>
          </button>
        </div>
      </header>

      <main className="w-full max-w-5xl">
        {/* Temporal Agent Workflow Controller */}
        <AgentControlPanel
          onTriggerTask={dispatchAgentTask}
          onClearStatus={clearAgentStatus}
          currentStatus={agentStatus}
          currentFrontier={currentFrontier}
          isConnecting={status !== "connected"}
        />

        {/* Dual-Zone Version Control System (Pinned Initial State & Collapsible Edits Timeline) */}
        <CheckpointTimeline
          checkpoints={checkpoints}
          currentFrontier={currentFrontier}
          onRestoreCheckpoint={handleRestoreCheckpoint}
        />

        {/* Telemetry Bar */}
        <div className="w-full mb-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono bg-[#FAF8F5] border border-[#E6E2D8] px-4 py-2.5 rounded-xl text-[#656D76] shadow-apple-sm">
          <div className="flex gap-4">
            <span>Sent: <strong className="text-[#1F2328]">{stats.bytesSent} B</strong> ({stats.updatesSent} deltas)</span>
            <span>Received: <strong className="text-[#1F2328]">{stats.bytesReceived} B</strong> ({stats.updatesReceived} deltas)</span>
          </div>
          <div>
            {stats.lastSyncAt ? (
              <span className="text-[#137333] font-semibold">
                ✓ Synced: {stats.lastSyncAt.toLocaleTimeString()}
              </span>
            ) : (
              <span className="text-[#8C959F]">Ready to synchronize</span>
            )}
          </div>
        </div>

        {/* Code Editor with Apple Creamy Theme & Positive Revert Feedback */}
        <CodeEditor
          doc={doc}
          awareness={awareness}
          currentUser={currentUser}
          remotePeers={remotePeers}
          isStreaming={agentStatus?.status === "generating"}
          isRollbackActive={isRollbackActive}
          rollbackMessage={rollbackMessage}
          onCursorChange={handleCursorChange}
        />
      </main>

      {/* Settings & BYOK Vault Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={(newSettings) => {
          setSettings(newSettings);
        }}
      />
    </div>
  );
};

export default App;
