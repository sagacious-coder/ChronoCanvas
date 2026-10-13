import React, { useState } from "react";
import { SandboxTestResult } from "../types/shared";
import { ThemeConfig, getTheme } from "../styles/themes";
import { BoltIcon, CheckIcon, CloseIcon, ShieldIcon } from "./Icons";

interface SandboxDiagnosticWidgetProps {
  status: "idle" | "planning" | "generating" | "sandboxed-testing" | "self-healing" | "committed" | "rolled-back";
  sandboxResult?: SandboxTestResult | null;
  onSimulateTest: (
    simulateFailure: boolean,
    failureType?: "syntax" | "assertion",
    enableSelfHealing?: boolean
  ) => void;
  isConnecting?: boolean;
  selfHealingAttempt?: number;
  healedSuccessfully?: boolean;
  activeTheme?: ThemeConfig;
}

export const SandboxDiagnosticWidget: React.FC<SandboxDiagnosticWidgetProps> = ({
  status,
  sandboxResult,
  onSimulateTest,
  isConnecting = false,
  selfHealingAttempt = 0,
  healedSuccessfully = false,
  activeTheme: passedTheme,
}) => {
  const [showTestDetails, setShowTestDetails] = useState<boolean>(false);
  const activeTheme = passedTheme || getTheme("daylight");

  const isTesting = status === "sandboxed-testing";
  const isHealing = status === "self-healing" || selfHealingAttempt > 0;
  const isPassed = status === "committed" || (sandboxResult?.passed ?? false);
  const isFailed = status === "rolled-back" && !healedSuccessfully;
  const isGenerating = status === "generating";
  const isPlanning = status === "planning";

  // Step States for the 5-Stage Gatekeeper Pipeline
  const getStepState = (stepNumber: 1 | 2 | 3 | 4 | 5) => {
    if (status === "idle") return "pending";
    if (stepNumber === 1) return "passed";
    if (stepNumber === 2) {
      if (isPlanning || isGenerating) return "active";
      return "passed";
    }
    if (stepNumber === 3) {
      if (isPlanning || isGenerating) return "pending";
      if (isTesting) return "active";
      if (isFailed) return "failed";
      if (isHealing) return "failed";
      if (isPassed) return "passed";
      return "pending";
    }
    if (stepNumber === 4) {
      if (status === "self-healing") return "active";
      if (healedSuccessfully) return "passed";
      if (isFailed && !healedSuccessfully) return "skipped";
      if (isPassed && !healedSuccessfully) return "skipped";
      return "pending";
    }
    if (stepNumber === 5) {
      if (isFailed) return "blocked";
      if (isPassed) return "passed";
      return "pending";
    }
    return "pending";
  };

  const getStatusBadge = () => {
    if (status === "self-healing") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE] animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED] animate-spin" />
          Self-Healing (Attempt {selfHealingAttempt || 1}/3)...
        </span>
      );
    }
    if (healedSuccessfully && isPassed) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]">
          <CheckIcon size={12} className="text-[#137333]" />
          Auto-Healed &amp; Merged ({sandboxResult?.durationMs || 35}ms)
        </span>
      );
    }
    if (isTesting) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A] animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-ping" />
          Pre-Flight Active (&lt; 50ms)...
        </span>
      );
    }
    if (isPassed) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]">
          <CheckIcon size={12} className="text-[#137333]" />
          Pre-Flight Verified ({sandboxResult?.durationMs || 38}ms)
        </span>
      );
    }
    if (isFailed) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA]">
          <CloseIcon size={12} className="text-[#EF4444]" />
          Pre-Flight Failed &bull; Blocked
        </span>
      );
    }
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
        Sandbox Ready (uv)
      </span>
    );
  };

  const testCases = sandboxResult?.testCases && sandboxResult.testCases.length > 0
    ? sandboxResult.testCases
    : [
        {
          name: "test_syntax_compilation",
          description: "astral-sh/uv py_compile AST syntax validation",
          status: isFailed ? ("failed" as const) : isPassed ? ("passed" as const) : ("running" as const),
          durationMs: 12,
        },
        {
          name: "test_type_contract_safety",
          description: "Type annotations and parameter count match",
          status: isFailed ? ("failed" as const) : isPassed ? ("passed" as const) : ("running" as const),
          durationMs: 8,
        },
        {
          name: "test_unit_assertions",
          description: "uv run pytest suite edge cases & boundary checks",
          status: isFailed ? ("failed" as const) : isPassed ? ("passed" as const) : ("running" as const),
          durationMs: 16,
        },
        {
          name: "test_crdt_frontier_guard",
          description: "Loro CRDT pre-flight Frontier anchor preserved",
          status: "passed" as const,
          durationMs: 2,
        },
      ];

  return (
    <div
      style={{
        backgroundColor: activeTheme.colors.cardBg,
        borderColor: activeTheme.colors.border,
        color: activeTheme.colors.text,
      }}
      className="w-full border rounded-2xl p-4 mb-4 shadow-apple-sm transition-colors duration-200"
    >
      {/* Widget Header */}
      <div
        style={{ borderColor: activeTheme.colors.border }}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 mb-3 border-b"
      >
        <div className="flex items-center gap-2.5">
          <div style={{ backgroundColor: activeTheme.colors.accentBg, borderColor: activeTheme.colors.border, color: activeTheme.colors.accent }} className="flex items-center justify-center w-7 h-7 rounded-lg border font-bold text-xs shadow-apple-sm">
            <BoltIcon size={14} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold" style={{ color: activeTheme.colors.text }}>
                uv Pre-Flight Sandbox &amp; Self-Healing Loop
              </h2>
              <span
                style={{
                  backgroundColor: activeTheme.colors.bg,
                  borderColor: activeTheme.colors.border,
                  color: activeTheme.colors.textMuted,
                }}
                className="text-[10px] font-mono px-2 py-0.2 rounded border"
              >
                &lt; 50ms Guardrail
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getStatusBadge()}
        </div>
      </div>

      {/* 5-Stage Pre-Flight & Self-Healing Pipeline Stepper */}
      <div
        style={{
          backgroundColor: activeTheme.colors.bg,
          borderColor: activeTheme.colors.border,
        }}
        className="mb-3 p-2.5 rounded-xl border shadow-apple-sm"
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {/* Step 1: Frontier Checkpoint */}
          <div
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
            }}
            className="p-2 rounded-lg border flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span style={{ color: activeTheme.colors.textMuted }} className="font-mono text-[9px]">STAGE 1</span>
              <span className="text-[10px] text-[#137333] font-bold">Anchored</span>
            </div>
            <div className="mt-0.5 text-xs font-semibold" style={{ color: activeTheme.colors.text }}>Frontier Saved</div>
          </div>

          {/* Step 2: Isolated Scratchpad */}
          <div
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
            }}
            className={`p-2 rounded-lg border flex flex-col justify-between ${
              getStepState(2) === "active" ? "ring-1 ring-[#2563EB] animate-pulse" : ""
            }`}
          >
            <div className="flex items-center justify-between text-[11px]">
              <span style={{ color: activeTheme.colors.textMuted }} className="font-mono text-[9px]">STAGE 2</span>
              <span className="text-[10px] font-semibold" style={{ color: activeTheme.colors.text }}>
                {getStepState(2) === "active" ? "Generating..." : "Done"}
              </span>
            </div>
            <div className="mt-0.5 text-xs font-semibold" style={{ color: activeTheme.colors.text }}>Scratchpad</div>
          </div>

          {/* Step 3: uv Pre-Flight Checks */}
          <div
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
            }}
            className="p-2 rounded-lg border flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span style={{ color: activeTheme.colors.textMuted }} className="font-mono text-[9px]">STAGE 3</span>
              <span className={`text-[10px] font-bold ${
                getStepState(3) === "failed" ? "text-[#991B1B]" : getStepState(3) === "passed" ? "text-[#137333]" : "text-[#B45309]"
              }`}>
                {getStepState(3) === "failed" ? "Caught" : getStepState(3) === "passed" ? "Verified" : "<50ms"}
              </span>
            </div>
            <div className="mt-0.5 text-xs font-semibold" style={{ color: activeTheme.colors.text }}>Sandbox Test</div>
          </div>

          {/* Step 4: Autonomous Self-Healing */}
          <div
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
            }}
            className="p-2 rounded-lg border flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span style={{ color: activeTheme.colors.textMuted }} className="font-mono text-[9px]">STAGE 4</span>
              <span className={`text-[10px] font-bold ${
                getStepState(4) === "active" ? "text-[#7C3AED]" : getStepState(4) === "passed" ? "text-[#137333]" : ""
              }`} style={{ color: getStepState(4) === "passed" ? "#137333" : activeTheme.colors.textMuted }}>
                {getStepState(4) === "active" ? "Healing..." : getStepState(4) === "passed" ? "Auto-Healed" : "Auto-Retry"}
              </span>
            </div>
            <div className="mt-0.5 text-xs font-semibold" style={{ color: activeTheme.colors.text }}>Self-Healing</div>
          </div>

          {/* Step 5: CRDT Canvas Broadcast */}
          <div
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
            }}
            className="p-2 rounded-lg border flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span style={{ color: activeTheme.colors.textMuted }} className="font-mono text-[9px]">STAGE 5</span>
              <span className={`text-[10px] font-bold ${
                getStepState(5) === "blocked" ? "text-[#991B1B]" : getStepState(5) === "passed" ? "text-[#137333]" : ""
              }`} style={{ color: getStepState(5) === "passed" ? "#137333" : activeTheme.colors.textMuted }}>
                {getStepState(5) === "blocked" ? "Blocked" : getStepState(5) === "passed" ? "Broadcasted" : "Standby"}
              </span>
            </div>
            <div className="mt-0.5 text-xs font-semibold" style={{ color: activeTheme.colors.text }}>Broadcast</div>
          </div>
        </div>
      </div>

      {/* 3-Card Verification Metric Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
        <div
          style={{
            backgroundColor: activeTheme.colors.bg,
            borderColor: activeTheme.colors.border,
          }}
          className="p-3 rounded-xl border shadow-apple-sm flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: activeTheme.colors.textMuted }} className="font-medium">Syntax Validation</span>
            <span className="font-mono text-[10px]" style={{ color: activeTheme.colors.textMuted }}>py_compile</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className={`text-xs font-bold ${
              healedSuccessfully ? "text-[#137333]" : isFailed ? "text-[#991B1B]" : isPassed ? "text-[#137333]" : "text-[#137333]"
            }`}>
              {healedSuccessfully ? "Healed & Compiled" : isFailed ? "Syntax Error" : isPassed ? "Compiled" : "Ready"}
            </span>
            <span className="text-[10px] font-mono" style={{ color: activeTheme.colors.textMuted }}>~12ms</span>
          </div>
        </div>

        <div
          style={{
            backgroundColor: activeTheme.colors.bg,
            borderColor: activeTheme.colors.border,
          }}
          className="p-3 rounded-xl border shadow-apple-sm flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: activeTheme.colors.textMuted }} className="font-medium">Test Suite Runner</span>
            <span className="font-mono text-[10px]" style={{ color: activeTheme.colors.textMuted }}>uv pytest</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className={`text-xs font-bold ${
              healedSuccessfully ? "text-[#137333]" : isFailed ? "text-[#991B1B]" : isPassed ? "text-[#137333]" : "text-[#137333]"
            }`}>
              {healedSuccessfully ? "4/4 Passed" : isFailed ? "0/4 Passed" : isPassed ? "4/4 Passed" : "4 Tests Ready"}
            </span>
            <span className="text-[10px] font-mono" style={{ color: activeTheme.colors.textMuted }}>~26ms</span>
          </div>
        </div>

        <div
          style={{
            backgroundColor: activeTheme.colors.bg,
            borderColor: activeTheme.colors.border,
          }}
          className="p-3 rounded-xl border shadow-apple-sm flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: activeTheme.colors.textMuted }} className="font-medium">Broadcast Guardrail</span>
            <span className="font-mono text-[10px]" style={{ color: activeTheme.colors.textMuted }}>Pre-Commit Filter</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className={`text-xs font-bold ${
              isFailed ? "text-[#991B1B]" : isPassed ? "text-[#137333]" : "text-[#2563EB]"
            }`}>
              {isFailed ? "Blocked" : isPassed ? "Allowed" : "Active"}
            </span>
            <span className="text-[10px] font-mono" style={{ color: activeTheme.colors.textMuted }}>&lt; 4ms Rollback</span>
          </div>
        </div>
      </div>

      {/* Expandable Granular Test Case Breakdown */}
      <div className="mb-3">
        <button
          type="button"
          onClick={() => setShowTestDetails(!showTestDetails)}
          className="text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          style={{ color: activeTheme.colors.textMuted }}
        >
          <ShieldIcon size={13} />
          <span>{showTestDetails ? "Hide Test Breakdown" : "View Granular Pre-Flight Results (4 test cases)"}</span>
          <span
            style={{
              backgroundColor: activeTheme.colors.bg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="text-[10px] px-2 py-0.2 rounded font-mono border"
          >
            38ms
          </span>
        </button>

        {showTestDetails && (
          <div
            style={{
              backgroundColor: activeTheme.colors.bg,
              borderColor: activeTheme.colors.border,
            }}
            className="mt-2 p-2.5 rounded-xl border text-xs font-mono shadow-apple-sm space-y-1"
          >
            {testCases.map((tc, idx) => (
              <div key={idx} className="py-1 flex items-center justify-between border-b last:border-b-0" style={{ borderColor: activeTheme.colors.border }}>
                <div className="flex items-center gap-2">
                  <span className={tc.status === "failed" ? "text-[#EF4444]" : "text-[#137333]"}>
                    {tc.status === "failed" ? "✕" : "✓"}
                  </span>
                  <span className="font-semibold" style={{ color: activeTheme.colors.text }}>{tc.name}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span style={{ color: activeTheme.colors.textMuted }}>{tc.durationMs}ms</span>
                  <span className={`px-1.5 py-0.2 rounded font-sans font-medium ${
                    tc.status === "failed" ? "bg-[#FEE2E2] text-[#991B1B]" : "bg-[#E6F4EA] text-[#137333]"
                  }`}>
                    {tc.status === "failed" ? "FAILED" : "PASSED"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Simulation Triggers with Clean Vector Icons */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: activeTheme.colors.border }}>
        <button
          type="button"
          onClick={() => onSimulateTest(true, "syntax", true)}
          disabled={isConnecting || isTesting || status === "self-healing"}
          className="px-3 py-1.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-medium transition cursor-pointer shadow-apple-sm disabled:opacity-50 flex items-center gap-1.5"
          title="Demonstrates error catch -> self-correction -> clean canvas merge"
        >
          <BoltIcon size={12} />
          <span>Self-Healing Loop</span>
        </button>

        <button
          type="button"
          onClick={() => onSimulateTest(false)}
          disabled={isConnecting || isTesting || status === "self-healing"}
          style={{
            backgroundColor: activeTheme.colors.cardBg,
            borderColor: activeTheme.colors.border,
            color: activeTheme.colors.text,
          }}
          className="px-3 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer shadow-apple-sm disabled:opacity-50 flex items-center gap-1.5 hover:opacity-90"
        >
          <CheckIcon size={12} className="text-[#137333]" />
          <span>Pass &amp; Broadcast</span>
        </button>

        <button
          type="button"
          onClick={() => onSimulateTest(true, "syntax", false)}
          disabled={isConnecting || isTesting || status === "self-healing"}
          style={{
            backgroundColor: activeTheme.colors.cardBg,
            borderColor: activeTheme.colors.border,
            color: activeTheme.id === "daylight" || activeTheme.id === "matcha" ? "#991B1B" : "#F87171",
          }}
          className="px-3 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer shadow-apple-sm disabled:opacity-50 flex items-center gap-1.5 hover:opacity-90"
        >
          <CloseIcon size={12} />
          <span>Catch Error (Abort)</span>
        </button>
      </div>
    </div>
  );
};
