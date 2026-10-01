import React, { useState } from "react";
import { AgentTaskStatus } from "../types/shared";

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
    onTriggerTask("Write faulty code to test instant rollback", true);
  };

  const getStatusBadge = () => {
    if (!currentStatus) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
          <span className="w-2 h-2 rounded-full bg-neutral-500" />
          Agent Idle
        </span>
      );
    }

    switch (currentStatus.status) {
      case "planning":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-950/80 text-blue-400 border border-blue-800 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
            Temporal: Planning Task...
          </span>
        );
      case "generating":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-indigo-950/80 text-indigo-400 border border-indigo-800">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-spin" />
            Generating Code ({currentStatus.tokenCount || 0} tokens)...
          </span>
        );
      case "sandboxed-testing":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-950/80 text-amber-300 border border-amber-800">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" />
            astral-sh/uv: Pre-Flight Sandbox Testing (&lt;50ms)...
          </span>
        );
      case "committed":
        return (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Verified & Committed
            </span>
            {onClearStatus && (
              <button
                type="button"
                onClick={onClearStatus}
                title="Reset status"
                className="text-xs text-neutral-400 hover:text-neutral-200 transition"
              >
                ✕
              </button>
            )}
          </div>
        );
      case "rolled-back":
        return (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-rose-950/80 text-rose-300 border border-rose-800">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              Syntax Error Caught: Rolled Back
            </span>
            {onClearStatus && (
              <button
                type="button"
                onClick={onClearStatus}
                title="Dismiss warning"
                className="text-xs text-neutral-400 hover:text-neutral-200 transition cursor-pointer"
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
    <div className="w-full bg-neutral-950/90 border border-neutral-800 rounded-xl p-4 mb-4 shadow-lg backdrop-blur-sm">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-3 border-b border-neutral-800/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 font-bold text-xs">
            AI
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-200">Temporal Agent Workflow Controller</h2>
            <p className="text-xs text-neutral-400">Durable Checkpoint Orchestration & Rollback Plane</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-mono text-neutral-400 bg-neutral-900 px-2.5 py-1 rounded border border-neutral-800">
            <span className="text-neutral-500">Checkpoint Frontier:</span>
            <span className="text-neutral-200 font-semibold truncate max-w-[130px]">{currentFrontier || "Latest"}</span>
          </div>
          {getStatusBadge()}
        </div>
      </div>

      {/* Task Prompt Form */}
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col sm:flex-row items-center gap-2.5">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Instruct the autonomous agent (e.g., 'Implement binary search with type hints')..."
          disabled={Boolean(isConnecting || (currentStatus && currentStatus.status !== "committed" && currentStatus.status !== "rolled-back"))}
          className="flex-1 w-full bg-neutral-900 border border-neutral-700/80 rounded-lg px-3.5 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 transition"
        />
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="submit"
            disabled={!prompt.trim() || isConnecting}
            className="flex-1 sm:flex-initial px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-medium text-xs transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
          >
            Dispatch Agent
          </button>
          <button
            type="button"
            onClick={handleSimulateRollback}
            disabled={isConnecting}
            title="Simulates a pre-flight test failure to demonstrate instant CRDT rollback"
            className="px-3 py-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 font-medium text-xs transition cursor-pointer"
          >
            Test Rollback
          </button>
        </div>
      </form>

      {/* Diagnostic Error Banner if Rolled Back with Dismiss option */}
      {currentStatus?.status === "rolled-back" && currentStatus.errorTrace && (
        <div className="mt-3 p-2.5 rounded-lg bg-rose-950/30 border border-rose-900/60 text-xs text-rose-300 font-mono flex items-center justify-between gap-2">
          <div>
            <span className="font-bold">Rollback Protocol Engaged: </span>
            {currentStatus.errorTrace}
          </div>
          {onClearStatus && (
            <button
              onClick={onClearStatus}
              className="px-2 py-0.5 rounded text-[10px] bg-rose-900/50 hover:bg-rose-800 text-rose-200 transition cursor-pointer flex-shrink-0"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
};
