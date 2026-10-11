import React, { useState } from "react";
import { SandboxTestResult } from "../types/shared";

interface DiagnosticConsoleProps {
  errorTrace?: string | null;
  sandboxResult?: SandboxTestResult | null;
  onDismiss?: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  failureType?: "syntax" | "assertion";
  isSelfHealing?: boolean;
}

export const DiagnosticConsole: React.FC<DiagnosticConsoleProps> = ({
  errorTrace,
  sandboxResult,
  onDismiss,
  isOpen,
  onToggleOpen,
  failureType = "syntax",
  isSelfHealing = false,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  const defaultSyntaxLog =
    "Traceback (most recent call last):\n  File \"/tmp/uv_sandbox/test_agent.py\", line 7, in <module>\n    def calculate_total(items\n                             ^\nSyntaxError: '(' was never closed\n[astral-sh/uv] py_compile caught syntax error in 14ms. Canvas mutation broadcast aborted.";

  const defaultAssertionLog =
    "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-8.3.2, pluggy-1.5.0\nrootdir: /tmp/chrono-uv-sandbox\ncollected 4 items\n\ntests/test_binary_search.py ..F.\n\n=================================== FAILURES ===================================\n_____________________________ test_binary_search_missing ______________________\n\n    def test_binary_search_missing():\n>       assert binarySearch([1, 3, 5, 7], 4) == -1\nE       AssertionError: assert None == -1\n\ntests/test_binary_search.py:18: AssertionError\n=========================== 1 failed, 3 passed in 0.03s ==========================\n[astral-sh/uv] pytest assertion failure caught in 28ms. Canvas mutation broadcast aborted.";

  const selfHealingLog =
    "=== STAGE 3 • MILESTONE 3 AUTONOMOUS SELF-HEALING AUDIT LOG ===\n" +
    "[00:00.014] Attempt 1/3: uv py_compile detected SyntaxError: '(' was never closed at line 7\n" +
    "[00:00.018] Pre-Flight Gatekeeper: Canvas write blocked (Frontier root-0 preserved)\n" +
    "[00:00.024] Temporal Orchestrator: Activity retry engaged with traceback re-injection\n" +
    "[00:00.032] LLM Self-Healing Prompt: Re-evaluating with prompt caching (token discount active)\n" +
    "[00:00.840] Attempt 2/3: Generated corrected syntax for calculate_total(items)\n" +
    "[00:00.865] uv py_compile AST check: PASSED (11ms)\n" +
    "[00:00.890] uv pytest unit test suite: 4/4 PASSED (25ms)\n" +
    "[00:00.894] Pre-Flight Approved: Emitting verified Loro CRDT delta to collaborative canvas\n" +
    "=== RESOLUTION: Autonomous Self-Healing Succeeded (Zero Human Edits Lost) ===";

  const displayLog = isSelfHealing
    ? selfHealingLog
    : errorTrace ||
      sandboxResult?.errorTraceback ||
      sandboxResult?.stderr ||
      (failureType === "assertion" ? defaultAssertionLog : defaultSyntaxLog);

  const handleCopy = () => {
    navigator.clipboard.writeText(displayLog);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full bg-[#FAF8F5] border border-[#E6E2D8] rounded-2xl mb-5 overflow-hidden shadow-apple-sm transition-all duration-300">
      {/* Console Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-[#F7F4EB] border-b border-[#E6E2D8]">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#D97706] animate-pulse" />
          <h3 className="text-xs font-semibold text-[#1F2328]">
            Pre-Flight Diagnostic Error &amp; Self-Healing Console
          </h3>
          <span className="text-[10px] text-[#656D76] bg-[#FFFFFF] px-2 py-0.5 rounded border border-[#E6E2D8] font-mono">
            {isSelfHealing
              ? "Temporal Self-Healing Loop"
              : failureType === "assertion"
              ? "astral-sh/uv Pytest Trace"
              : "astral-sh/uv Compiler Log"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs px-2.5 py-1 rounded-lg bg-[#FFFFFF] hover:bg-[#EFEAD9] text-[#4B515D] border border-[#D8D2C4] transition cursor-pointer font-medium shadow-apple-sm"
          >
            {copied ? "✓ Copied" : "Copy Traceback"}
          </button>
          <button
            type="button"
            onClick={onToggleOpen}
            className="text-xs px-2.5 py-1 rounded-lg bg-[#FFFFFF] hover:bg-[#EFEAD9] text-[#4B515D] border border-[#D8D2C4] transition cursor-pointer font-medium shadow-apple-sm"
          >
            {isOpen ? "Hide Console ▲" : "Show Console ▼"}
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs px-2 py-1 rounded-lg hover:bg-[#EFEAD9] text-[#8C959F] hover:text-[#1F2328] transition cursor-pointer"
              title="Close error banner"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="p-4 bg-[#21252B] text-[#ABB2BF] font-mono text-xs overflow-x-auto leading-relaxed">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#2C313A] text-[11px] text-[#5C6370]">
            <span>SANDBOX VENV: /tmp/chrono-uv-sandbox (Python 3.12)</span>
            <span>GATEWAY: Sub-50ms Verification &bull; Temporal Self-Healing Loop</span>
          </div>
          <pre className={`whitespace-pre-wrap font-mono ${isSelfHealing ? "text-[#98C379]" : "text-[#E06C75]"}`}>
            {displayLog}
          </pre>
          <div className="mt-3 pt-2.5 border-t border-[#2C313A] flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-[#5C6370]">
            <span className="text-[#98C379]">
              ✓ CRDT Safe-Guard Active: Target document frontier was untouched.
            </span>
            <span>{isSelfHealing ? "Self-corrected before canvas merge" : "Mutation blocked prior to Loro canvas broadcast"}</span>
          </div>
        </div>
      )}
    </div>
  );
};
