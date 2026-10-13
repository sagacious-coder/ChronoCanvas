import React, { useState } from "react";
import { SandboxTestResult } from "../types/shared";
import { ThemeConfig, getTheme } from "../styles/themes";
import { TerminalIcon, CheckIcon, CloseIcon } from "./Icons";

interface DiagnosticConsoleProps {
  errorTrace?: string | null;
  sandboxResult?: SandboxTestResult | null;
  onDismiss?: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  failureType?: "syntax" | "assertion";
  isSelfHealing?: boolean;
  activeTheme?: ThemeConfig;
}

export const DiagnosticConsole: React.FC<DiagnosticConsoleProps> = ({
  errorTrace,
  sandboxResult,
  onDismiss,
  isOpen,
  onToggleOpen,
  failureType = "syntax",
  isSelfHealing = false,
  activeTheme: passedTheme,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const activeTheme = passedTheme || getTheme("daylight");

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
    <div
      style={{
        backgroundColor: activeTheme.colors.cardBg,
        borderColor: activeTheme.colors.border,
        color: activeTheme.colors.text,
      }}
      className="w-full border rounded-2xl mb-4 overflow-hidden shadow-apple-sm transition-colors duration-200"
    >
      {/* Console Header */}
      <div
        style={{
          backgroundColor: activeTheme.colors.headerBg,
          borderColor: activeTheme.colors.border,
        }}
        className="flex items-center justify-between px-4 py-2.5 border-b"
      >
        <div className="flex items-center gap-2">
          <TerminalIcon size={14} className="text-[#D97706]" />
          <h3 className="text-xs font-semibold" style={{ color: activeTheme.colors.text }}>
            Diagnostic Error &amp; Self-Healing Console
          </h3>
          <span
            style={{
              backgroundColor: activeTheme.colors.bg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="text-[10px] px-2 py-0.2 rounded border font-mono"
          >
            {isSelfHealing
              ? "Self-Healing Log"
              : failureType === "assertion"
              ? "Pytest Trace"
              : "Compiler Log"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.text,
            }}
            className="text-[11px] px-2.5 py-1 rounded-lg border transition cursor-pointer font-medium shadow-apple-sm flex items-center gap-1 hover:opacity-90"
          >
            {copied ? <CheckIcon size={12} className="text-[#137333]" /> : null}
            <span>{copied ? "Copied" : "Copy Log"}</span>
          </button>
          <button
            type="button"
            onClick={onToggleOpen}
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.text,
            }}
            className="text-[11px] px-2.5 py-1 rounded-lg border transition cursor-pointer font-medium shadow-apple-sm hover:opacity-90"
          >
            {isOpen ? "Hide ▲" : "Show ▼"}
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              style={{ color: activeTheme.colors.textMuted }}
              className="text-xs w-6 h-6 rounded-lg transition cursor-pointer flex items-center justify-center hover:opacity-80"
              title="Close error banner"
            >
              <CloseIcon size={12} />
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="p-3.5 bg-[#21252B] text-[#ABB2BF] font-mono text-xs overflow-x-auto leading-relaxed">
          <pre className={`whitespace-pre-wrap font-mono ${isSelfHealing ? "text-[#98C379]" : "text-[#E06C75]"}`}>
            {displayLog}
          </pre>
          <div className="mt-2.5 pt-2 border-t border-[#2C313A] flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[10px] text-[#5C6370]">
            <span className="text-[#98C379]">
              ✓ Safe-Guard Active: Target document frontier was untouched.
            </span>
            <span>{isSelfHealing ? "Self-corrected before canvas merge" : "Mutation blocked prior to broadcast"}</span>
          </div>
        </div>
      )}
    </div>
  );
};
