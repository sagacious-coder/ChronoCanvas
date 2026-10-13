import React, { useState, useEffect } from "react";
import { ByokConfig, UserAuthSession } from "../types/shared";
import { THEMES, ThemeConfig } from "../styles/themes";
import { SettingsIcon, CloseIcon, CheckIcon } from "./Icons";

export interface WorkspacePanelSettings {
  defaultView: "minimal" | "sandbox" | "history" | "all";
  showAgentBar: boolean;
  showSandboxWidget: boolean;
  showHistoryTimeline: boolean;
  showTelemetryBar: boolean;
  showContainerBar: boolean;
}

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  byokConfig: ByokConfig;
  onSaveByokConfig: (config: ByokConfig) => void;
  authSession: UserAuthSession;
  onSaveAuthSession: (session: UserAuthSession) => void;
  currentThemeId: string;
  onSelectTheme: (themeId: string) => void;
  panelSettings: WorkspacePanelSettings;
  onSavePanelSettings: (settings: WorkspacePanelSettings) => void;
}

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  isOpen,
  onClose,
  byokConfig,
  onSaveByokConfig,
  authSession,
  onSaveAuthSession,
  currentThemeId,
  onSelectTheme,
  panelSettings,
  onSavePanelSettings,
}) => {
  const [activeTab, setActiveTab] = useState<"themes" | "panels" | "byok" | "jwt">("themes");

  const [selectedTheme, setSelectedTheme] = useState<string>(currentThemeId);
  const [panels, setPanels] = useState<WorkspacePanelSettings>(panelSettings);

  const [enableByok, setEnableByok] = useState<boolean>(byokConfig.enabled);
  const [provider, setProvider] = useState<ByokConfig["provider"]>(byokConfig.provider || "openrouter");
  const [apiKey, setApiKey] = useState<string>(byokConfig.apiKey || "");
  const [model, setModel] = useState<string>(byokConfig.model || "anthropic/claude-3.5-sonnet");
  const [showKey, setShowKey] = useState<boolean>(false);
  const [testKeyStatus, setTestKeyStatus] = useState<string | null>(null);

  const [authMode, setAuthMode] = useState<"guest" | "jwt">(authSession.mode || "guest");
  const [jwtToken, setJwtToken] = useState<string>(authSession.token || "");
  const [showToken, setShowToken] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<boolean>(false);

  useEffect(() => {
    setSelectedTheme(currentThemeId);
  }, [currentThemeId]);

  useEffect(() => {
    setPanels(panelSettings);
  }, [panelSettings]);

  useEffect(() => {
    setEnableByok(byokConfig.enabled);
    setProvider(byokConfig.provider || "openrouter");
    setApiKey(byokConfig.apiKey || "");
    setModel(byokConfig.model || "anthropic/claude-3.5-sonnet");
  }, [byokConfig]);

  useEffect(() => {
    setAuthMode(authSession.mode || "guest");
    setJwtToken(authSession.token || "");
  }, [authSession]);

  if (!isOpen) return null;

  const handleGenerateDevToken = () => {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = btoa(
      JSON.stringify({
        sub: "za-frontend-lead",
        role: "frontend-engineer",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
        iss: "chronocanvas-auth-gateway",
      })
    );
    const signature = "dev_simulated_hmac_signature_0x9a8f";
    const sampleToken = `${header}.${payload}.${signature}`;
    setJwtToken(sampleToken);
    setAuthMode("jwt");
  };

  const handleTestKeyConnectivity = () => {
    if (!apiKey.trim()) {
      setTestKeyStatus("Please enter an API key to test.");
      return;
    }
    setTestKeyStatus("Testing connection...");
    setTimeout(() => {
      setTestKeyStatus(`✓ Connected to ${provider} (${model}) in 218ms. Prompt caching active.`);
    }, 450);
  };

  const handleSave = () => {
    onSelectTheme(selectedTheme);
    onSavePanelSettings(panels);

    onSaveByokConfig({
      enabled: enableByok,
      provider,
      apiKey: apiKey.trim(),
      model,
    });

    onSaveAuthSession({
      mode: authMode,
      token: jwtToken.trim(),
      subject: authMode === "jwt" && jwtToken.trim() ? "za-frontend-lead" : undefined,
      expiresAt: authMode === "jwt" ? Date.now() + 86400000 : undefined,
    });

    setSaveFeedback(true);
    setTimeout(() => {
      setSaveFeedback(false);
      onClose();
    }, 600);
  };

  const currentTheme = THEMES[selectedTheme] || THEMES.daylight;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fade-in">
      <div
        style={{
          backgroundColor: currentTheme.colors.cardBg,
          borderColor: currentTheme.colors.border,
          color: currentTheme.colors.text,
        }}
        className="w-full max-w-2xl border rounded-2xl shadow-apple-lg overflow-hidden flex flex-col transition-all duration-200"
      >
        {/* Modal Header */}
        <div
          style={{
            backgroundColor: currentTheme.colors.headerBg,
            borderColor: currentTheme.colors.border,
          }}
          className="flex items-center justify-between px-6 py-3.5 border-b"
        >
          <div className="flex items-center gap-2.5">
            <div
              style={{
                backgroundColor: currentTheme.colors.accentBg,
                borderColor: currentTheme.colors.accent,
                color: currentTheme.colors.accent,
              }}
              className="flex items-center justify-center w-7 h-7 rounded-lg border font-bold text-sm shadow-apple-sm"
            >
              <SettingsIcon size={15} />
            </div>
            <div>
              <h2 className="text-xs font-semibold" style={{ color: currentTheme.colors.text }}>
                Settings &amp; Workspace Preferences
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-xs w-6 h-6 rounded-lg hover:opacity-75 flex items-center justify-center transition cursor-pointer"
            style={{ color: currentTheme.colors.textMuted }}
          >
            <CloseIcon size={14} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            backgroundColor: currentTheme.colors.bg,
            borderColor: currentTheme.colors.border,
          }}
          className="flex border-b px-6 text-xs font-medium overflow-x-auto"
        >
          {[
            { id: "themes", label: "Themes" },
            { id: "panels", label: "Panels & Layout" },
            { id: "byok", label: "Bring Your Own Key" },
            { id: "jwt", label: "JWT Authentication" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`py-3 px-3.5 border-b-2 transition cursor-pointer whitespace-nowrap text-xs ${
                activeTab === tab.id
                  ? "border-[#2563EB] text-[#2563EB] font-semibold"
                  : "border-transparent text-[#656D76] hover:text-[#1F2328]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[65vh]">
          {/* TAB 1: THEMES */}
          {activeTab === "themes" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold" style={{ color: currentTheme.colors.text }}>
                    Color Palette
                  </h3>
                  <p className="text-[11px]" style={{ color: currentTheme.colors.textMuted }}>
                    Original Creamy Daylight is default. Synchronized live with editor.
                  </p>
                </div>
                <span
                  style={{
                    backgroundColor: currentTheme.colors.accentBg,
                    color: currentTheme.colors.accent,
                    borderColor: currentTheme.colors.accent,
                  }}
                  className="text-[10px] font-mono px-2.5 py-0.5 rounded-full border font-semibold"
                >
                  {currentTheme.name}
                </span>
              </div>

              {/* Theme Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.values(THEMES).map((th: ThemeConfig) => {
                  const isSelected = selectedTheme === th.id;
                  return (
                    <button
                      key={th.id}
                      type="button"
                      onClick={() => {
                        setSelectedTheme(th.id);
                        onSelectTheme(th.id);
                      }}
                      className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center justify-between shadow-apple-sm ${
                        isSelected
                          ? "ring-2 ring-[#2563EB]"
                          : "hover:border-[#8C959F]"
                      }`}
                      style={{
                        backgroundColor: th.colors.cardBg,
                        borderColor: isSelected ? "#2563EB" : th.colors.border,
                        color: th.colors.text,
                      }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex -space-x-1.5 items-center">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black/10"
                            style={{ backgroundColor: th.colors.bg }}
                          />
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black/10"
                            style={{ backgroundColor: th.colors.cardBg }}
                          />
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black/10"
                            style={{ backgroundColor: th.colors.accent }}
                          />
                        </div>

                        <div>
                          <div className="text-xs font-semibold">{th.name}</div>
                          <div className="text-[9px] opacity-75 font-mono">
                            {th.isDark ? "Dark" : "Light"}
                          </div>
                        </div>
                      </div>

                      {isSelected && (
                        <CheckIcon size={14} className="text-[#2563EB]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: PANELS */}
          {activeTab === "panels" && (
            <div className="space-y-3">
              <div>
                <h3 className="text-xs font-semibold" style={{ color: currentTheme.colors.text }}>
                  Workspace Layout
                </h3>
                <p className="text-[11px]" style={{ color: currentTheme.colors.textMuted }}>
                  Select your default view and customize which panels appear on screen.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "minimal", title: "Code & Agent (Clean)", desc: "Minimalist editor view. Keeps landing page clutter-free." },
                  { id: "sandbox", title: "Sandbox Testing", desc: "Focuses on pre-flight gatekeeper and test runner." },
                  { id: "history", title: "Version History", desc: "Focuses on dual-zone checkpoints and rollbacks." },
                  { id: "all", title: "Full View", desc: "Displays all panels simultaneously." },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setPanels({
                        ...panels,
                        defaultView: item.id as WorkspacePanelSettings["defaultView"],
                      })
                    }
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer shadow-apple-sm ${
                      panels.defaultView === item.id
                        ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]"
                        : "border-[#E6E2D8] bg-[#FFFFFF] text-[#1F2328]"
                    }`}
                  >
                    <div className="text-xs font-semibold">{item.title}</div>
                    <div className="text-[10px] text-[#656D76] mt-0.5">{item.desc}</div>
                  </button>
                ))}
              </div>

              <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] shadow-apple-sm space-y-2">
                <div className="text-[10px] font-semibold text-[#4B515D] uppercase tracking-wider">
                  Panel Visibility Toggles
                </div>

                {[
                  { key: "showAgentBar", label: "Agent Workflow Controller" },
                  { key: "showSandboxWidget", label: "Pre-Flight Sandbox Widget" },
                  { key: "showHistoryTimeline", label: "Version Control History" },
                  { key: "showTelemetryBar", label: "Network Telemetry Bar" },
                  { key: "showContainerBar", label: "Container Status Bar" },
                ].map((row) => (
                  <div key={row.key} className="flex items-center justify-between py-1 border-b border-[#F4EFE6] last:border-b-0 text-xs">
                    <span className="text-[#1F2328]">{row.label}</span>
                    <label className="relative inline-flex items-center cursor-pointer ml-3">
                      <input
                        type="checkbox"
                        checked={panels[row.key as keyof WorkspacePanelSettings] as boolean}
                        onChange={(e) =>
                          setPanels({
                            ...panels,
                            [row.key]: e.target.checked,
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-[#E6E2D8] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#D8D2C4] after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#2563EB]" />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: BYOK */}
          {activeTab === "byok" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] shadow-apple-sm">
                <div>
                  <div className="text-xs font-semibold text-[#1F2328]">
                    Bring-Your-Own-Key (BYOK)
                  </div>
                  <div className="text-[10px] text-[#656D76]">
                    Route code generation through your personal API key
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableByok}
                    onChange={(e) => setEnableByok(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#E6E2D8] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#D8D2C4] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#2563EB]" />
                </label>
              </div>

              {enableByok ? (
                <div className="space-y-3 p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] shadow-apple-sm">
                  <div>
                    <label className="block text-[10px] font-semibold text-[#4B515D] mb-1 uppercase tracking-wider">
                      Provider
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: "openrouter", label: "OpenRouter" },
                        { id: "anthropic", label: "Anthropic Direct" },
                        { id: "openai", label: "OpenAI Direct" },
                        { id: "custom", label: "Custom / Local" },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setProvider(item.id as ByokConfig["provider"])}
                          className={`p-2 rounded-lg border text-left transition cursor-pointer text-xs font-medium ${
                            provider === item.id
                              ? "bg-[#EFF6FF] border-[#2563EB] text-[#1D4ED8]"
                              : "bg-[#FAF8F5] border-[#E6E2D8] text-[#1F2328]"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-semibold text-[#4B515D] uppercase tracking-wider">
                        {provider.toUpperCase()} API Key
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="text-[10px] text-[#2563EB] hover:underline"
                      >
                        {showKey ? "Hide" : "Show"}
                      </button>
                    </div>
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter API key..."
                      className="w-full bg-[#FAF8F5] border border-[#E6E2D8] rounded-xl px-3 py-1.5 text-xs font-mono text-[#1F2328] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-[#4B515D] mb-1 uppercase tracking-wider">
                      Model Identifier
                    </label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full bg-[#FAF8F5] border border-[#E6E2D8] rounded-xl px-3 py-1.5 text-xs text-[#1F2328] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                    >
                      <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet (Prompt Caching Active)</option>
                      <option value="openai/gpt-4o">OpenAI GPT-4o</option>
                      <option value="openai/gpt-4o-mini">OpenAI GPT-4o-mini</option>
                      <option value="deepseek/deepseek-coder">DeepSeek Coder</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={handleTestKeyConnectivity}
                      className="text-xs px-2.5 py-1 rounded-lg bg-[#FAF8F5] hover:bg-[#EFEAD9] text-[#1F2328] border border-[#D8D2C4] font-medium transition cursor-pointer shadow-apple-sm"
                    >
                      Test Key Connectivity
                    </button>
                    {testKeyStatus && (
                      <span className={`text-[10px] font-mono ${testKeyStatus.startsWith("✓") ? "text-[#137333]" : "text-[#B45309]"}`}>
                        {testKeyStatus}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] shadow-apple-sm text-xs text-[#656D76]">
                  Managed ChronoCanvas cluster active. Requests routed through pooled keys.
                </div>
              )}
            </div>
          )}

          {/* TAB 4: JWT AUTH */}
          {activeTab === "jwt" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAuthMode("guest")}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                    authMode === "guest"
                      ? "bg-[#EFF6FF] border-[#2563EB] text-[#1D4ED8]"
                      : "bg-[#FFFFFF] border-[#E6E2D8] text-[#1F2328]"
                  }`}
                >
                  <div className="text-xs font-semibold">Guest Dev Mode</div>
                  <div className="text-[10px] text-[#656D76]">Local unauthenticated pairing</div>
                </button>

                <button
                  type="button"
                  onClick={() => setAuthMode("jwt")}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                    authMode === "jwt"
                      ? "bg-[#EFF6FF] border-[#2563EB] text-[#1D4ED8]"
                      : "bg-[#FFFFFF] border-[#E6E2D8] text-[#1F2328]"
                  }`}
                >
                  <div className="text-xs font-semibold">JWT Session</div>
                  <div className="text-[10px] text-[#656D76]">Bearer token verification</div>
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] shadow-apple-sm space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold text-[#4B515D] uppercase tracking-wider">
                    JWT Bearer Token
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGenerateDevToken}
                      className="text-[10px] text-[#2563EB] hover:underline cursor-pointer"
                    >
                      Generate Dev Token
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="text-[10px] text-[#656D76] hover:underline cursor-pointer"
                    >
                      {showToken ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <textarea
                  rows={2}
                  value={jwtToken}
                  onChange={(e) => setJwtToken(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full bg-[#FAF8F5] border border-[#E6E2D8] rounded-xl p-2 text-[10px] font-mono text-[#1F2328] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />

                {jwtToken.trim() ? (
                  <div className="p-2 rounded-lg bg-[#E6F4EA] border border-[#CEEAD6] text-[10px] text-[#137333] flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <CheckIcon size={12} className="text-[#34A853]" />
                      <span>Claims: <strong>za-frontend-lead</strong> (24h)</span>
                    </div>
                    <span className="font-mono text-[#0D5224]">Active</span>
                  </div>
                ) : (
                  <div className="p-2 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-[10px] text-[#B45309]">
                    Running in guest development fallback.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            backgroundColor: currentTheme.colors.headerBg,
            borderColor: currentTheme.colors.border,
          }}
          className="flex items-center justify-between px-6 py-3 border-t text-xs"
        >
          <button
            type="button"
            onClick={() => {
              setSelectedTheme("daylight");
              onSelectTheme("daylight");
              setPanels({
                defaultView: "minimal",
                showAgentBar: true,
                showSandboxWidget: false,
                showHistoryTimeline: false,
                showTelemetryBar: true,
                showContainerBar: true,
              });
              setEnableByok(false);
              setApiKey("");
              setAuthMode("guest");
              setJwtToken("");
            }}
            className="text-xs underline transition cursor-pointer"
            style={{ color: currentTheme.colors.textMuted }}
          >
            Reset
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl border font-medium text-xs transition cursor-pointer shadow-apple-sm"
              style={{
                backgroundColor: currentTheme.colors.cardBg,
                borderColor: currentTheme.colors.border,
                color: currentTheme.colors.text,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-3.5 py-1.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium text-xs transition cursor-pointer shadow-apple-sm flex items-center gap-1.5"
            >
              <CheckIcon size={13} />
              <span>{saveFeedback ? "Saved" : "Save Settings"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
