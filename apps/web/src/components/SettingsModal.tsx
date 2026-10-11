import React, { useState, useEffect } from "react";

export type LlmProvider = "openrouter" | "openai" | "anthropic";

export interface UserSettings {
  selectedProvider: LlmProvider;
  jwtToken: string;
  apiKeys: {
    openrouter?: string;
    openai?: string;
    anthropic?: string;
  };
}

export const SETTINGS_STORAGE_KEY = "chronocanvas_byok_settings";

export const DEFAULT_SETTINGS: UserSettings = {
  selectedProvider: "openrouter",
  jwtToken: "dev-dummy-token",
  apiKeys: {
    openrouter: "",
    openai: "",
    anthropic: "",
  },
};

export function loadUserSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        apiKeys: {
          ...DEFAULT_SETTINGS.apiKeys,
          ...(parsed.apiKeys || {}),
        },
      };
    }
  } catch (err) {
    console.warn("[Settings] Failed to parse stored settings:", err);
  }
  return DEFAULT_SETTINGS;
}

export function saveUserSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("[Settings] Failed to persist settings to localStorage:", err);
  }
}

export function getActiveApiKey(settings: UserSettings): string | undefined {
  const key = settings.apiKeys[settings.selectedProvider];
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSave: (newSettings: UserSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [formData, setFormData] = useState<UserSettings>(settings);
  const [showKeys, setShowKeys] = useState<{ [key: string]: boolean }>({});
  const [saveToast, setSaveToast] = useState(false);

  // Sync state when modal opens with fresh settings
  useEffect(() => {
    if (isOpen) {
      setFormData(settings);
      setSaveToast(false);
    }
  }, [isOpen, settings]);

  // Handle ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleShowKey = (provider: string) => {
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      selectedProvider: e.target.value as LlmProvider,
    }));
  };

  const handleKeyChange = (provider: LlmProvider, value: string) => {
    setFormData((prev) => ({
      ...prev,
      apiKeys: {
        ...prev.apiKeys,
        [provider]: value,
      },
    }));
  };

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      jwtToken: e.target.value,
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveUserSettings(formData);
    onSave(formData);
    setSaveToast(true);
    setTimeout(() => {
      setSaveToast(false);
      onClose();
    }, 700);
  };

  const handleResetDefaults = () => {
    setFormData(DEFAULT_SETTINGS);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm transition-all animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-[#FAF8F5] border border-[#E6E2D8] rounded-2xl shadow-apple-lg overflow-hidden flex flex-col text-[#1F2328]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-[#E6E2D8] bg-[#FDFBF7]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ECE6D5] flex items-center justify-center text-[#4B515D]">
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <div>
              <h2 id="settings-modal-title" className="text-base font-semibold text-[#1F2328]">
                Gateway & BYOK Settings
              </h2>
              <p className="text-xs text-[#656D76]">
                Configure JWT authorization and Bring-Your-Own-Key parameters
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#656D76] hover:text-[#1F2328] hover:bg-[#EFEAD9] transition cursor-pointer"
            aria-label="Close settings modal"
          >
            ✕
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSave} className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* JWT Gateway Section */}
          <div className="space-y-2">
            <label htmlFor="jwt-token-input" className="block text-xs font-semibold text-[#1F2328] uppercase tracking-wider">
              WebSocket JWT Authorization Token
            </label>
            <div className="relative">
              <input
                id="jwt-token-input"
                type="text"
                value={formData.jwtToken}
                onChange={handleTokenChange}
                placeholder="dev-dummy-token"
                className="w-full text-xs font-mono px-3.5 py-2.5 bg-white border border-[#E6E2D8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1F2328]/15 focus:border-[#1F2328] transition"
              />
            </div>
            <p className="text-[11px] text-[#656D76]">
              Verified by the backend gateway on connection. Default:{" "}
              <code className="bg-[#EFEAD9] px-1.5 py-0.5 rounded text-[#1F2328]">dev-dummy-token</code> (development bypass).
            </p>
          </div>

          <div className="border-t border-[#E6E2D8] pt-4 space-y-4">
            {/* Preferred Model Provider Dropdown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="provider-select" className="text-xs font-semibold text-[#1F2328] uppercase tracking-wider">
                  Active LLM Provider (BYOK)
                </label>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] font-medium">
                  Active: {formData.selectedProvider}
                </span>
              </div>

              <select
                id="provider-select"
                value={formData.selectedProvider}
                onChange={handleProviderChange}
                className="w-full text-xs px-3.5 py-2.5 bg-white border border-[#E6E2D8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1F2328]/15 focus:border-[#1F2328] transition cursor-pointer font-medium"
              >
                <option value="openrouter">OpenRouter (Default Router - Recommended)</option>
                <option value="openai">OpenAI (Direct sk-... API Key)</option>
                <option value="anthropic">Anthropic (Direct Claude sk-ant-... Key)</option>
              </select>
            </div>

            {/* Provider API Keys */}
            <div className="space-y-3 pt-1">
              <h3 className="text-xs font-semibold text-[#656D76] uppercase tracking-wider">
                API Key Vault (Stored locally in browser)
              </h3>

              {/* OpenRouter Key Input */}
              <div
                className={`p-3 rounded-xl border transition ${
                  formData.selectedProvider === "openrouter"
                    ? "bg-white border-[#1F2328]/30 shadow-apple-xs"
                    : "bg-[#F7F4EB] border-[#E6E2D8] opacity-75"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="key-openrouter" className="text-xs font-medium text-[#1F2328] flex items-center gap-1.5">
                    OpenRouter API Key
                    {formData.selectedProvider === "openrouter" && (
                      <span className="text-[9px] bg-[#1F2328] text-white px-1.5 py-0.5 rounded font-bold uppercase">
                        Current
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleShowKey("openrouter")}
                    className="text-[11px] text-[#656D76] hover:text-[#1F2328] transition"
                  >
                    {showKeys["openrouter"] ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  id="key-openrouter"
                  type={showKeys["openrouter"] ? "text" : "password"}
                  value={formData.apiKeys.openrouter || ""}
                  onChange={(e) => handleKeyChange("openrouter", e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full text-xs font-mono px-3 py-2 bg-white border border-[#E6E2D8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F2328]/15 transition"
                />
              </div>

              {/* OpenAI Key Input */}
              <div
                className={`p-3 rounded-xl border transition ${
                  formData.selectedProvider === "openai"
                    ? "bg-white border-[#1F2328]/30 shadow-apple-xs"
                    : "bg-[#F7F4EB] border-[#E6E2D8] opacity-75"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="key-openai" className="text-xs font-medium text-[#1F2328] flex items-center gap-1.5">
                    OpenAI API Key
                    {formData.selectedProvider === "openai" && (
                      <span className="text-[9px] bg-[#1F2328] text-white px-1.5 py-0.5 rounded font-bold uppercase">
                        Current
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleShowKey("openai")}
                    className="text-[11px] text-[#656D76] hover:text-[#1F2328] transition"
                  >
                    {showKeys["openai"] ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  id="key-openai"
                  type={showKeys["openai"] ? "text" : "password"}
                  value={formData.apiKeys.openai || ""}
                  onChange={(e) => handleKeyChange("openai", e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full text-xs font-mono px-3 py-2 bg-white border border-[#E6E2D8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F2328]/15 transition"
                />
              </div>

              {/* Anthropic Key Input */}
              <div
                className={`p-3 rounded-xl border transition ${
                  formData.selectedProvider === "anthropic"
                    ? "bg-white border-[#1F2328]/30 shadow-apple-xs"
                    : "bg-[#F7F4EB] border-[#E6E2D8] opacity-75"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="key-anthropic" className="text-xs font-medium text-[#1F2328] flex items-center gap-1.5">
                    Anthropic API Key
                    {formData.selectedProvider === "anthropic" && (
                      <span className="text-[9px] bg-[#1F2328] text-white px-1.5 py-0.5 rounded font-bold uppercase">
                        Current
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleShowKey("anthropic")}
                    className="text-[11px] text-[#656D76] hover:text-[#1F2328] transition"
                  >
                    {showKeys["anthropic"] ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  id="key-anthropic"
                  type={showKeys["anthropic"] ? "text" : "password"}
                  value={formData.apiKeys.anthropic || ""}
                  onChange={(e) => handleKeyChange("anthropic", e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="w-full text-xs font-mono px-3 py-2 bg-white border border-[#E6E2D8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F2328]/15 transition"
                />
              </div>
            </div>

            <p className="text-[11px] text-[#656D76] leading-relaxed">
              🔐 Your keys are stored strictly in your browser's <code className="bg-[#EFEAD9] px-1 py-0.5 rounded text-[#1F2328]">localStorage</code>. They are transmitted dynamically with agent tasks and never persisted in backend databases.
            </p>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-[#E6E2D8]">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-xs text-[#656D76] hover:text-[#1F2328] transition underline cursor-pointer"
            >
              Reset to Defaults
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium bg-white hover:bg-[#F7F4EB] text-[#1F2328] rounded-xl border border-[#E6E2D8] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-medium bg-[#1F2328] hover:bg-[#343A40] text-white rounded-xl shadow-apple-sm transition cursor-pointer flex items-center gap-1.5"
              >
                {saveToast ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-[#34A853] animate-ping" />
                    Saved!
                  </>
                ) : (
                  "Save & Apply"
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
