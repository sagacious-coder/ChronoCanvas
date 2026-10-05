import React, { useState } from "react";
import { AgentTaskStatus } from "@chronocanvas/shared-types";

interface AgentControlPanelProps {
  onTriggerTask: (prompt: string, simulateFailure?: boolean) => void;
  onClearStatus?: () => void;
  currentStatus: AgentTaskStatus | null;
  currentFrontier: string;
  isConnecting?: boolean;
}

export const AgentControlPanel: React.FC<AgentControlPanelProps> = ({
  onTriggerTask,
  onClearStatus,
  currentStatus,
  currentFrontier,
  isConnecting = false,
}) => {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    onTriggerTask(prompt.trim(), false);
    setPrompt("");
  };

  const handleSimulateRollback = () => {
    onTriggerTask("Test autonomous error handling and instant rollback", true);
  };

  const getStatusBadge = () => {
    if (!currentStatus) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#F7F4EB] text-[#656D76] border border-[#E6E2D8]">
          <span className="w-2 h-2 rounded-full bg-[#8C959F]" />
          Agent Idle
        </span>
      );
    }

    switch (currentStatus.status) {
      case "planning":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] animate-pulse">
            <span className="w-2 h-2 rounded-full bg-[#2563EB] animate-ping" />
            Temporal: Planning Task...
          </span>
        );
      case "generating":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]">
            <span className="w-2 h-2 rounded-full bg-[#7C3AED] animate-spin" />
            Generating Code ({currentStatus.tokenCount || 0} tokens)...
          </span>
        );
      case "sandboxed-testing":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]">
            <span className="w-2 h-2 rounded-full bg-[#D97706] animate-bounce" />
            astral-sh/uv: Sandbox Testing (&lt;50ms)...
          </span>
        );
      case "committed":
        return (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]">
              <span className="w-2 h-2 rounded-full bg-[#137333]" />
              Verified & Committed to Canvas
            </span>
            {onClearStatus && (
              <button
                type="button"
                onClick={onClearStatus}
                title="Dismiss status"
                className="text-xs text-[#656D76] hover:text-[#1F2328] transition cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        );
      case "rolled-back":
        return (
          <div className="flex items-center gap-2">
            {/* Positive Green Revert State per explicit feedback */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]">
              <span className="w-2 h-2 rounded-full bg-[#137333]" />
              Rollback Executed: Clean State Restored
            </span>
            {onClearStatus && (
              <button
                type="button"
                onClick={onClearStatus}
                title="Dismiss feedback"
                className="text-xs text-[#137333] hover:text-[#0D5224] transition cursor-pointer font-bold"
              >
                ✕ Dismiss
              </button>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full bg-[#FAF8F5] border border-[#E6E2D8] rounded-2xl p-5 mb-5 shadow-apple-sm">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-3.5 border-b border-[#EBE7DC]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE] font-bold text-xs shadow-apple-sm">
            AI
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#1F2328]">Temporal Agent Workflow Controller</h2>
            <p className="text-[11px] text-[#656D76]">Durable Checkpoint Orchestration &bull; Isolated Sandbox Testing</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-mono text-[#656D76] bg-[#FFFFFF] px-2.5 py-1 rounded-lg border border-[#E6E2D8]">
            <span className="text-[#8C959F]">Frontier:</span>
            <span className="text-[#1F2328] font-semibold truncate max-w-[140px]" title={currentFrontier}>
              {currentFrontier || "Latest"}
            </span>
          </div>
          {getStatusBadge()}
        </div>
      </div>

      {/* Task Prompt Form */}
      <form onSubmit={handleSubmit} className="mt-3.5 flex flex-col sm:flex-row items-center gap-2.5">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Instruct the autonomous agent (e.g., 'Implement binary search with type hints')..."
          disabled={Boolean(isConnecting || (currentStatus && currentStatus.status !== "committed" && currentStatus.status !== "rolled-back"))}
          className="flex-1 w-full bg-[#FFFFFF] border border-[#E6E2D8] rounded-xl px-4 py-2 text-xs text-[#1F2328] placeholder-[#8C959F] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:opacity-50 transition shadow-apple-sm"
        />
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="submit"
            disabled={!prompt.trim() || isConnecting}
            className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#F7F4EB] disabled:text-[#8C959F] text-white font-medium text-xs transition shadow-apple-sm cursor-pointer disabled:cursor-not-allowed"
          >
            Dispatch Agent
          </button>
          <button
            type="button"
            onClick={handleSimulateRollback}
            disabled={isConnecting}
            title="Demonstrates instant sub-5ms CRDT state reversion"
            className="px-3.5 py-2 rounded-xl bg-[#F7F4EB] hover:bg-[#EFEAD9] text-[#4B515D] border border-[#E6E2D8] font-medium text-xs transition cursor-pointer shadow-apple-sm"
          >
            Test Revert Document
          </button>
        </div>
      </form>

      {/* Positive Green Revert & Rollback Success Banner */}
      {currentStatus?.status === "rolled-back" && (
        <div className="mt-3.5 p-3 rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] text-xs text-[#137333] flex items-center justify-between gap-3 shadow-apple-sm">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-[#34A853] text-white flex items-center justify-center font-bold text-[10px]">
              ✓
            </span>
            <div>
              <span className="font-semibold">Document Reverted Successfully: </span>
              <span>Reverted agent mutation to checkpoint in &lt; 4ms. Human keystrokes preserved.</span>
              {currentStatus.errorTrace && (
                <span className="block text-[11px] text-[#0D5224] font-mono mt-0.5 opacity-90">
                  {currentStatus.errorTrace}
                </span>
              )}
            </div>
          </div>
          {onClearStatus && (
            <button
              onClick={onClearStatus}
              className="px-2.5 py-1 rounded-lg bg-[#FFFFFF] hover:bg-[#F7F4EB] text-[#137333] border border-[#CEEAD6] text-xs font-medium transition cursor-pointer flex-shrink-0 shadow-apple-sm"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
};
