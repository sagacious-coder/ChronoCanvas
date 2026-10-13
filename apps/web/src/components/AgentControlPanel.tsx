import React, { useState } from "react";
import { AgentTaskStatus, ByokConfig } from "../types/shared";
import { ThemeConfig, getTheme } from "../styles/themes";
import { SparklesIcon, PlayIcon, CheckIcon, CloseIcon, ClockIcon } from "./Icons";

interface AgentControlPanelProps {
  onTriggerTask: (
    prompt: string,
    simulateFailure?: boolean,
    failureType?: "syntax" | "assertion",
    enableSelfHealing?: boolean
  ) => void;
  onClearStatus?: () => void;
  currentStatus: AgentTaskStatus | null;
  currentFrontier: string;
  isConnecting?: boolean;
  byokConfig?: ByokConfig;
  activeTheme?: ThemeConfig;
}

export const AgentControlPanel: React.FC<AgentControlPanelProps> = ({
  onTriggerTask,
  onClearStatus,
  currentStatus,
  currentFrontier,
  isConnecting = false,
  byokConfig,
  activeTheme: passedTheme,
}) => {
  const [prompt, setPrompt] = useState("");
  const activeTheme = passedTheme || getTheme("daylight");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    onTriggerTask(prompt.trim(), false);
    setPrompt("");
  };

  const handleSimulateRollback = () => {
    onTriggerTask("Test autonomous error handling and instant rollback", true, "syntax", false);
  };

  const getStatusBadge = () => {
    if (!currentStatus) {
      return (
        <span
          style={{
            backgroundColor: activeTheme.colors.bg,
            borderColor: activeTheme.colors.border,
            color: activeTheme.colors.textMuted,
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border"
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: activeTheme.colors.textMuted }} />
          Idle
        </span>
      );
    }

    switch (currentStatus.status) {
      case "planning":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] animate-ping" />
            Planning...
          </span>
        );
      case "generating":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED] animate-spin" />
            Generating ({currentStatus.tokenCount || 0} tokens)...
          </span>
        );
      case "sandboxed-testing":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce" />
            Testing Sandbox (&lt;50ms)...
          </span>
        );
      case "self-healing":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE] animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED] animate-spin" />
            Auto-Healing...
          </span>
        );
      case "committed":
        return (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]">
              <CheckIcon size={12} className="text-[#137333]" />
              {currentStatus.healedSuccessfully ? "Auto-Healed & Merged" : "Verified & Committed"}
            </span>
            {onClearStatus && (
              <button
                type="button"
                onClick={onClearStatus}
                title="Dismiss status"
                className="text-xs transition cursor-pointer"
                style={{ color: activeTheme.colors.textMuted }}
              >
                <CloseIcon size={12} />
              </button>
            )}
          </div>
        );
      case "rolled-back":
        return (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]">
              <CheckIcon size={12} className="text-[#137333]" />
              State Protected
            </span>
            {onClearStatus && (
              <button
                type="button"
                onClick={onClearStatus}
                title="Dismiss feedback"
                className="text-xs text-[#137333] hover:text-[#0D5224] transition cursor-pointer font-bold"
              >
                <CloseIcon size={12} />
              </button>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      style={{
        backgroundColor: activeTheme.colors.cardBg,
        borderColor: activeTheme.colors.border,
        color: activeTheme.colors.text,
      }}
      className="w-full border rounded-2xl p-4 mb-4 shadow-apple-sm transition-colors duration-200"
    >
      <div
        style={{ borderColor: activeTheme.colors.border }}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b"
      >
        <div className="flex items-center gap-2.5">
          <div
            style={{
              backgroundColor: activeTheme.colors.accentBg,
              borderColor: activeTheme.colors.accent,
              color: activeTheme.colors.accent,
            }}
            className="flex items-center justify-center w-7 h-7 rounded-lg border font-bold text-xs shadow-apple-sm"
          >
            <SparklesIcon size={14} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold" style={{ color: activeTheme.colors.text }}>
                Agent Workflow Controller
              </h2>
              <span
                style={{
                  backgroundColor: activeTheme.colors.bg,
                  borderColor: activeTheme.colors.border,
                  color: activeTheme.colors.textMuted,
                }}
                className="text-[10px] font-mono px-2 py-0.2 rounded-full border"
              >
                {byokConfig?.enabled ? byokConfig.model : "Managed: Claude 3.5"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            style={{
              backgroundColor: activeTheme.colors.bg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-0.5 rounded-lg border"
          >
            <ClockIcon size={12} style={{ color: activeTheme.colors.textMuted }} />
            <span className="font-semibold truncate max-w-[130px]" style={{ color: activeTheme.colors.text }} title={currentFrontier}>
              {currentFrontier || "root-0"}
            </span>
          </div>
          {getStatusBadge()}
        </div>
      </div>

      {/* Task Prompt Form */}
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col sm:flex-row items-center gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            byokConfig?.enabled
              ? `Instruct agent via ${byokConfig.model}...`
              : "Instruct the agent (e.g., 'Implement binary search with type hints')..."
          }
          disabled={Boolean(isConnecting || (currentStatus && currentStatus.status !== "committed" && currentStatus.status !== "rolled-back"))}
          style={{
            backgroundColor: activeTheme.colors.bg,
            borderColor: activeTheme.colors.border,
            color: activeTheme.colors.text,
          }}
          className="flex-1 w-full border rounded-xl px-3.5 py-1.5 text-xs placeholder-[#8C959F] focus:outline-none focus:ring-1 focus:ring-[#2563EB]/40 disabled:opacity-50 transition shadow-apple-sm"
        />
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="submit"
            disabled={!prompt.trim() || isConnecting}
            className="flex-1 sm:flex-initial px-3.5 py-1.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white font-medium text-xs transition shadow-apple-sm cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <PlayIcon size={12} />
            <span>Dispatch</span>
          </button>
          <button
            type="button"
            onClick={handleSimulateRollback}
            disabled={isConnecting}
            title="Demonstrates instant sub-5ms CRDT state reversion"
            style={{
              backgroundColor: activeTheme.colors.headerBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.text,
            }}
            className="px-3 py-1.5 rounded-xl border font-medium text-xs transition cursor-pointer shadow-apple-sm hover:opacity-90"
          >
            Simulate Revert
          </button>
        </div>
      </form>

      {/* Positive Green Revert Notification */}
      {currentStatus?.status === "rolled-back" && (
        <div className="mt-2.5 p-2.5 rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] text-xs text-[#137333] flex items-center justify-between gap-2 shadow-apple-sm">
          <div className="flex items-center gap-2">
            <CheckIcon size={14} className="text-[#34A853]" />
            <span>Document Reverted Successfully in &lt; 4ms (human edits preserved).</span>
          </div>
          {onClearStatus && (
            <button
              onClick={onClearStatus}
              className="text-xs text-[#137333] hover:text-[#0D5224] transition cursor-pointer font-bold"
            >
              <CloseIcon size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
