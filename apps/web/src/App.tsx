import React, { useMemo, useState, useEffect, useCallback } from "react";
import { LoroDoc, Awareness } from "loro-crdt";
import { CodeEditor, UserPresence } from "./components/CodeEditor";
import { AgentControlPanel } from "./components/AgentControlPanel";
import { CheckpointTimeline, DocumentCheckpoint } from "./components/CheckpointTimeline";
import { SandboxDiagnosticWidget } from "./components/SandboxDiagnosticWidget";
import { DiagnosticConsole } from "./components/DiagnosticConsole";
import { UserSettingsModal, WorkspacePanelSettings } from "./components/UserSettingsModal";
import { SystemSanityModal } from "./components/SystemSanityModal";
import { useLoroSync } from "./hooks/useLoroSync";
import { CursorPosition, ByokConfig, UserAuthSession } from "./types/shared";
import { getTheme, DEFAULT_THEME_ID } from "./styles/themes";

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

  const peerId = useMemo(() => {
    return `${currentUser.name}-${Math.random().toString(36).substring(2, 7)}`;
  }, [currentUser.name]);

  // Dynamic Theme Engine (Daylight is original default; 11 developer themes available)
  const [currentThemeId, setCurrentThemeId] = useState<string>(() => {
    try {
      return localStorage.getItem("chrono_theme") || DEFAULT_THEME_ID;
    } catch {
      return DEFAULT_THEME_ID;
    }
  });

  const activeTheme = getTheme(currentThemeId);

  const handleSelectTheme = (newThemeId: string) => {
    setCurrentThemeId(newThemeId);
    try {
      localStorage.setItem("chrono_theme", newThemeId);
    } catch {}
  };

  // Modular Panel & Layout Settings (Decluttering landing page)
  const [panelSettings, setPanelSettings] = useState<WorkspacePanelSettings>(() => {
    try {
      const saved = localStorage.getItem("chrono_panel_settings");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      defaultView: "minimal", // Default to clean, uncluttered layout
      showAgentBar: true,
      showSandboxWidget: false,
      showHistoryTimeline: false,
      showTelemetryBar: true,
      showContainerBar: true,
    };
  });

  // Active interactive view mode tab
  const [activeViewMode, setActiveViewMode] = useState<"minimal" | "sandbox" | "history" | "all">(
    panelSettings.defaultView || "minimal"
  );

  const handleSavePanelSettings = (newSettings: WorkspacePanelSettings) => {
    setPanelSettings(newSettings);
    setActiveViewMode(newSettings.defaultView);
    try {
      localStorage.setItem("chrono_panel_settings", JSON.stringify(newSettings));
    } catch {}
  };

  // BYOK and Auth Configuration State (Persisted in localStorage)
  const [byokConfig, setByokConfig] = useState<ByokConfig>(() => {
    try {
      const saved = localStorage.getItem("chrono_byok_config");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      enabled: false,
      provider: "openrouter",
      apiKey: "",
      model: "anthropic/claude-3.5-sonnet",
    };
  });

  const [authSession, setAuthSession] = useState<UserAuthSession>(() => {
    try {
      const saved = localStorage.getItem("chrono_auth_session");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      mode: "guest",
      token: "",
    };
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isSanityModalOpen, setIsSanityModalOpen] = useState<boolean>(false);

  const handleSaveByokConfig = (newConfig: ByokConfig) => {
    setByokConfig(newConfig);
    try {
      localStorage.setItem("chrono_byok_config", JSON.stringify(newConfig));
    } catch {}
  };

  const handleSaveAuthSession = (newSession: UserAuthSession) => {
    setAuthSession(newSession);
    try {
      localStorage.setItem("chrono_auth_session", JSON.stringify(newSession));
    } catch {}
  };

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
  } = useLoroSync(doc, "ws://localhost:3001", "chrono-canvas-default", peerId);

  const [currentFrontier, setCurrentFrontier] = useState<string>("root-0");
  const [checkpoints, setCheckpoints] = useState<DocumentCheckpoint[]>([
    {
      id: "cp-init-root",
      timestamp: Date.now(),
      frontier: "root-0",
      label: "Initial Document State",
      origin: "initial",
    },
  ]);

  const [isRollbackActive, setIsRollbackActive] = useState<boolean>(false);
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null);
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(false);

  // Monitor Frontier changes and record checkpoints
  useEffect(() => {
    const fStr = getFrontierString();
    setCurrentFrontier(fStr);

    if (fStr && fStr !== "root-0") {
      setCheckpoints((prev) => {
        if (prev.some((c) => c.frontier === fStr)) return prev;
        const isHealed = Boolean(agentStatus?.healedSuccessfully);
        const newCp: DocumentCheckpoint = {
          id: `cp-${Date.now()}`,
          timestamp: Date.now(),
          frontier: fStr,
          label: isHealed
            ? "Self-Healed Agent Delta (Milestone 3)"
            : agentStatus?.status === "generating"
            ? "Agent Generation Delta"
            : "Human Edit Checkpoint",
          origin: agentStatus?.status === "generating" || isHealed ? "agent" : "human",
        };
        return [newCp, ...prev];
      });
    }
  }, [getFrontierString, stats.updatesSent, stats.updatesReceived, agentStatus?.status, agentStatus?.healedSuccessfully]);

  // Stage 4: Positive Green Revert & Pre-Flight Diagnostic Drawer Auto-Open
  useEffect(() => {
    if (agentStatus?.status === "rolled-back" && !agentStatus?.healedSuccessfully) {
      setIsRollbackActive(true);
      setIsConsoleOpen(true);
      setRollbackMessage("Pre-Flight Gatekeeper Blocked Mutation: Canvas Preserved in < 4ms (human edits protected)");
      const timer = setTimeout(() => {
        setIsRollbackActive(false);
      }, 3500);
      return () => clearTimeout(timer);
    }
    if (agentStatus?.healedSuccessfully) {
      setIsRollbackActive(true);
      setRollbackMessage("Milestone 3 Verified: Autonomous Self-Healing Succeeded (< 40ms, Canvas Merged)");
      const timer = setTimeout(() => {
        setIsRollbackActive(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [agentStatus?.status, agentStatus?.healedSuccessfully]);

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
    switch (status) {
      case "connected":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] shadow-apple-sm">
            <span className="w-2 h-2 rounded-full bg-[#34A853] animate-pulse" />
            Live WebSocket Connected
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
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition cursor-pointer shadow-apple-sm"
          >
            <span className="w-2 h-2 rounded-full bg-[#8C959F]" />
            Offline Mode (Click to Reconnect)
          </button>
        );
    }
  };

  // Determine which panels are visible according to active view mode or custom overrides
  const isAgentVisible = panelSettings.showAgentBar;
  const isSandboxVisible =
    activeViewMode === "sandbox" || activeViewMode === "all" || panelSettings.showSandboxWidget;
  const isHistoryVisible =
    activeViewMode === "history" || activeViewMode === "all" || panelSettings.showHistoryTimeline;
  const isTelemetryVisible = panelSettings.showTelemetryBar;
  const isContainerVisible = panelSettings.showContainerBar;

  return (
    <div
      style={{
        backgroundColor: activeTheme.colors.bg,
        color: activeTheme.colors.text,
      }}
      className="min-h-screen flex flex-col items-center p-6 md:p-12 font-sans transition-colors duration-200"
    >
      {/* Top Header */}
      <header className="w-full max-w-5xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: activeTheme.colors.text }}>
              ChronoCanvas
            </h1>
            <span
              style={{
                backgroundColor: activeTheme.colors.badgeBg,
                color: activeTheme.colors.badgeText,
                borderColor: activeTheme.colors.badgeBorder,
              }}
              className="text-[11px] border px-2.5 py-0.5 rounded-full font-medium"
            >
              Stage 4 &bull; Day 14 Launch Ready
            </span>
          </div>
          <p className="text-xs mt-1 font-normal" style={{ color: activeTheme.colors.textMuted }}>
            Zero-Lock Collaborative Coding &bull; Full E2E Sanity Verified &bull; {activeTheme.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {getStatusBadge()}

          {/* Day 14 E2E Sanity Suite Button */}
          <button
            type="button"
            onClick={() => setIsSanityModalOpen(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition cursor-pointer shadow-apple-sm font-semibold bg-[#E6F4EA] text-[#137333] border-[#CEEAD6] hover:bg-[#D4EDDA]"
            title="Inspect Day 14 Full System Sanity Suite and Production Readiness"
          >
            <span>🚀 E2E Sanity Suite</span>
          </button>

          {/* User Settings Modal Trigger Button */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.text,
            }}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl border transition cursor-pointer shadow-apple-sm hover:opacity-90"
            title="Configure Themes, Panels, JWT Auth, and BYOK"
          >
            <span>⚙️ Settings</span>
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: activeTheme.colors.accent }}
              title={`Active Theme: ${activeTheme.name}`}
            />
          </button>

          {/* User Presence Switcher Button */}
          <button
            onClick={toggleUserIdentity}
            title="Click to switch peer identity for two-tab testing"
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.text,
            }}
            className="flex items-center gap-2 text-xs px-3.5 py-1.5 rounded-xl border transition cursor-pointer shadow-apple-sm hover:opacity-90"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: currentUser.name === "ZA" ? "#2563EB" : "#059669" }}
            />
            Peer: <strong>{currentUser.name}</strong>
            <span className="text-[10px] opacity-75 underline">(switch)</span>
          </button>
        </div>
      </header>

      {/* Modular Panel Navigation Toolbar (Decluttered Clean Layout) */}
      <div
        className="w-full max-w-5xl mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b"
        style={{ borderColor: activeTheme.colors.border }}
      >
        <div
          className="flex items-center gap-1.5 p-1 rounded-xl border"
          style={{
            backgroundColor: activeTheme.colors.headerBg,
            borderColor: activeTheme.colors.border,
          }}
        >
          {[
            { id: "minimal", label: "💻 Code & Agent (Clean)", tooltip: "Decluttered minimal editor view" },
            { id: "sandbox", label: "⚡ Sandbox Testing", tooltip: "Focus on astral-sh/uv pre-flight gatekeeper" },
            { id: "history", label: "📜 Version History", tooltip: "Focus on Loro CRDT dual-zone checkpoints" },
            { id: "all", label: "🎛️ Full Stack", tooltip: "Show all panels simultaneously" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveViewMode(tab.id as typeof activeViewMode)}
              style={{
                backgroundColor: activeViewMode === tab.id ? activeTheme.colors.cardBg : "transparent",
                color: activeViewMode === tab.id ? activeTheme.colors.accent : activeTheme.colors.textMuted,
                borderColor: activeViewMode === tab.id ? activeTheme.colors.border : "transparent",
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer shadow-xs whitespace-nowrap"
              title={tab.tooltip}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Quick-action Chips for theme & status */}
        <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: activeTheme.colors.textMuted }}>
          <span
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
            }}
            className="px-2.5 py-1 rounded-lg border flex items-center gap-1.5"
          >
            <span>🎨 Theme:</span>
            <strong style={{ color: activeTheme.colors.text }}>{activeTheme.name}</strong>
          </span>
          <span
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
            }}
            className="px-2.5 py-1 rounded-lg border hidden md:flex items-center gap-1.5"
          >
            <span>Auth:</span>
            <strong style={{ color: activeTheme.colors.text }}>
              {authSession.mode === "jwt" && authSession.token ? "JWT Bearer" : "Guest Mode"}
            </strong>
          </span>
        </div>
      </div>

      <main className="w-full max-w-5xl">
        {/* Panel 1: Temporal Agent Workflow Controller */}
        {isAgentVisible && (
          <AgentControlPanel
            onTriggerTask={(prompt, fail, failureType, enableSelfHealing) =>
              dispatchAgentTask(
                prompt,
                fail,
                failureType || "syntax",
                Boolean(enableSelfHealing),
                byokConfig,
                authSession.mode === "jwt" ? authSession.token : undefined
              )
            }
            onClearStatus={clearAgentStatus}
            currentStatus={agentStatus}
            currentFrontier={currentFrontier}
            isConnecting={status !== "connected"}
            byokConfig={byokConfig}
          />
        )}

        {/* Panel 2: astral-sh/uv Pre-Flight Sandbox & Self-Healing Widget */}
        {isSandboxVisible && (
          <SandboxDiagnosticWidget
            status={agentStatus?.status || "idle"}
            sandboxResult={agentStatus?.sandboxResult}
            selfHealingAttempt={agentStatus?.selfHealingAttempt}
            healedSuccessfully={agentStatus?.healedSuccessfully}
            onSimulateTest={(fail, failureType, enableSelfHealing) =>
              dispatchAgentTask(
                enableSelfHealing
                  ? "Autonomous self-healing verification task"
                  : "Pre-flight sandbox verification",
                fail,
                failureType || "syntax",
                Boolean(enableSelfHealing),
                byokConfig,
                authSession.mode === "jwt" ? authSession.token : undefined
              )
            }
            isConnecting={status !== "connected"}
          />
        )}

        {/* Diagnostic Error & Self-Healing Console (Traceback Drawer) */}
        {(agentStatus?.status === "rolled-back" ||
          agentStatus?.status === "self-healing" ||
          agentStatus?.healedSuccessfully ||
          isConsoleOpen) && (
          <DiagnosticConsole
            errorTrace={agentStatus?.errorTrace}
            sandboxResult={agentStatus?.sandboxResult}
            failureType={agentStatus?.failureType || "syntax"}
            isSelfHealing={agentStatus?.status === "self-healing" || Boolean(agentStatus?.healedSuccessfully)}
            onDismiss={() => {
              setIsConsoleOpen(false);
              clearAgentStatus();
            }}
            isOpen={isConsoleOpen}
            onToggleOpen={() => setIsConsoleOpen(!isConsoleOpen)}
          />
        )}

        {/* Panel 3: Dual-Zone Version Control System (Checkpoints & Frontiers) */}
        {isHistoryVisible && (
          <CheckpointTimeline
            checkpoints={checkpoints}
            currentFrontier={currentFrontier}
            onRestoreCheckpoint={handleRestoreCheckpoint}
          />
        )}

        {/* Panel 4: Telemetry Bar */}
        {isTelemetryVisible && (
          <div
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="w-full mb-3 flex flex-wrap items-center justify-between gap-3 text-xs font-mono border px-4 py-2.5 rounded-xl shadow-apple-sm"
          >
            <div className="flex gap-4">
              <span>
                Sent: <strong style={{ color: activeTheme.colors.text }}>{stats.bytesSent} B</strong> ({stats.updatesSent} deltas)
              </span>
              <span>
                Received: <strong style={{ color: activeTheme.colors.text }}>{stats.bytesReceived} B</strong> ({stats.updatesReceived} deltas)
              </span>
            </div>
            <div>
              {stats.lastSyncAt ? (
                <span className="text-[#137333] font-semibold">
                  ✓ Synced: {stats.lastSyncAt.toLocaleTimeString()}
                </span>
              ) : (
                <span style={{ color: activeTheme.colors.textMuted }}>Ready to synchronize</span>
              )}
            </div>
          </div>
        )}

        {/* Panel 5: Container Distribution Status Bar */}
        {isContainerVisible && (
          <div
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="w-full mb-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono border px-4 py-2 rounded-xl shadow-apple-sm"
          >
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[#137333]">
                <span className="w-2 h-2 rounded-full bg-[#137333]" />
                Container: <strong>Nginx Alpine (Port 80/8080)</strong>
              </span>
              <span>&bull;</span>
              <span>
                LLM: <strong>{byokConfig.enabled ? `BYOK (${byokConfig.model})` : "Managed Cluster"}</strong>
              </span>
            </div>
            <div className="text-[11px] opacity-75">
              Routing: <strong>try_files $uri /index.html</strong>
            </div>
          </div>
        )}

        {/* Code Editor with Universal Container Rendering and Theme Synchronization */}
        <CodeEditor
          doc={doc}
          awareness={awareness}
          currentUser={currentUser}
          remotePeers={remotePeers}
          isStreaming={agentStatus?.status === "generating" || agentStatus?.status === "self-healing"}
          isRollbackActive={isRollbackActive}
          rollbackMessage={rollbackMessage}
          onCursorChange={handleCursorChange}
          themeConfig={activeTheme}
        />
      </main>

      {/* User Settings & BYOK / JWT / Theme Modal */}
      <UserSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        byokConfig={byokConfig}
        onSaveByokConfig={handleSaveByokConfig}
        authSession={authSession}
        onSaveAuthSession={handleSaveAuthSession}
        currentThemeId={currentThemeId}
        onSelectTheme={handleSelectTheme}
        panelSettings={panelSettings}
        onSavePanelSettings={handleSavePanelSettings}
      />

      {/* Day 14 System Launch & E2E Sanity Modal */}
      <SystemSanityModal
        isOpen={isSanityModalOpen}
        onClose={() => setIsSanityModalOpen(false)}
        activeTheme={activeTheme}
      />
    </div>
  );
};

export default App;
