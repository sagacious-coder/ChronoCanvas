import React, { useState } from "react";
import { SandboxTestResult } from "../types/shared";

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
}

export const SandboxDiagnosticWidget: React.FC<SandboxDiagnosticWidgetProps> = ({
  status,
  sandboxResult,
  onSimulateTest,
  isConnecting = false,
  selfHealingAttempt = 0,
  healedSuccessfully = false,
}) => {
  const [showTestDetails, setShowTestDetails] = useState<boolean>(false);

  const isTesting = status === "sandboxed-testing";
  const isHealing = status === "self-healing" || selfHealingAttempt > 0;
  const isPassed = status === "committed" || (sandboxResult?.passed ?? false);
  const isFailed = status === "rolled-back" && !healedSuccessfully;
  const isGenerating = status === "generating";
  const isPlanning = status === "planning";

  // Step States for the 5-Stage Gatekeeper & Self-Healing Pipeline
  const getStepState = (stepNumber: 1 | 2 | 3 | 4 | 5) => {
    if (status === "idle") return "pending";

    // Step 1: Frontier Checkpoint
    if (stepNumber === 1) return "passed";

    // Step 2: Generation in Scratchpad
    if (stepNumber === 2) {
      if (isPlanning || isGenerating) return "active";
      return "passed";
    }

    // Step 3: Pre-Flight uv Sandbox Test
    if (stepNumber === 3) {
      if (isPlanning || isGenerating) return "pending";
      if (isTesting) return "active";
      if (isFailed) return "failed";
      if (isHealing) return "failed"; // First run failed, triggering heal
      if (isPassed) return "passed";
      return "pending";
    }

    // Step 4: Autonomous Self-Healing
    if (stepNumber === 4) {
      if (status === "self-healing") return "active";
      if (healedSuccessfully) return "passed";
      if (isFailed && !healedSuccessfully) return "skipped";
      if (isPassed && !healedSuccessfully) return "skipped"; // Not needed if passed directly
      return "pending";
    }

    // Step 5: CRDT Canvas Broadcast
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
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE] animate-pulse">
          <span className="w-2 h-2 rounded-full bg-[#7C3AED] animate-spin" />
          Autonomous Self-Healing Active (Attempt {selfHealingAttempt || 1}/3)...
        </span>
      );
    }
    if (healedSuccessfully && isPassed) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]">
          <span className="w-2 h-2 rounded-full bg-[#34A853]" />
          Milestone 3 Verified: Auto-Healed &amp; Merged ({sandboxResult?.durationMs || 35}ms)
        </span>
      );
    }
    if (isTesting) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A] animate-pulse">
          <span className="w-2 h-2 rounded-full bg-[#D97706] animate-ping" />
          Pre-Flight Gatekeeper Active (&lt; 50ms)...
        </span>
      );
    }
    if (isPassed) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]">
          <span className="w-2 h-2 rounded-full bg-[#34A853]" />
          Pre-Flight Verified ({sandboxResult?.durationMs || 38}ms) &bull; Broadcast Committed
        </span>
      );
    }
    if (isFailed) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA]">
          <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
          Pre-Flight Verification Failed &bull; Mutation Blocked
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#F7F4EB] text-[#656D76] border border-[#E6E2D8]">
        <span className="w-2 h-2 rounded-full bg-[#8C959F]" />
        Gatekeeper &amp; Self-Healing Ready (astral-sh/uv)
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
    <div className="w-full bg-[#FAF8F5] border border-[#E6E2D8] rounded-2xl p-5 mb-5 shadow-apple-sm transition-all duration-300">
      {/* Widget Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3.5 mb-4 border-b border-[#EBE7DC]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A] font-bold text-sm shadow-apple-sm">
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[#1F2328]">
                astral-sh/uv Pre-Flight Verification &amp; Self-Healing Loop
              </h2>
              <span className="text-[10px] font-mono bg-[#EFEAD9] text-[#4B515D] px-2 py-0.5 rounded border border-[#E2DCCF]">
                Stage 3 &bull; Milestone 3
              </span>
            </div>
            <p className="text-[11px] text-[#656D76] mt-0.5">
              Sub-50ms Isolated Virtual Environment &bull; Automated Traceback Self-Correction &bull; CRDT Safe-Guard
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getStatusBadge()}
        </div>
      </div>

      {/* 5-Stage Pre-Flight & Self-Healing Pipeline Stepper */}
      <div className="mb-4 p-3 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] shadow-apple-sm">
        <div className="text-[11px] font-semibold text-[#656D76] uppercase tracking-wider mb-2.5 flex items-center justify-between">
          <span>Stage 3 Verification Pipeline</span>
          <span className="font-mono text-[10px] lowercase text-[#8C959F]">zero-lock crdt guardrail</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {/* Step 1: Frontier Checkpoint */}
          <div className="p-2.5 rounded-lg border bg-[#FAF8F5] border-[#E6E2D8] flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8C959F] font-mono text-[10px]">STAGE 1</span>
              <span className="text-[10px] text-[#137333] font-bold">✓ Anchored</span>
            </div>
            <div className="mt-1 text-xs font-semibold text-[#1F2328]">Frontier Saved</div>
            <div className="text-[10px] text-[#656D76]">Loro Checkpoint Hash</div>
          </div>

          {/* Step 2: Isolated Scratchpad */}
          <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
            getStepState(2) === "active"
              ? "bg-[#EFF6FF] border-[#BFDBFE] animate-pulse"
              : "bg-[#FAF8F5] border-[#E6E2D8]"
          }`}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8C959F] font-mono text-[10px]">STAGE 2</span>
              <span className="text-[10px] font-semibold">
                {getStepState(2) === "active" ? "Generating..." : getStepState(2) === "passed" ? "✓ Done" : "Waiting"}
              </span>
            </div>
            <div className="mt-1 text-xs font-semibold text-[#1F2328]">Isolated Scratchpad</div>
            <div className="text-[10px] text-[#656D76]">LLM Code Generation</div>
          </div>

          {/* Step 3: uv Pre-Flight Checks */}
          <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
            getStepState(3) === "active"
              ? "bg-[#FFFBEB] border-[#FDE68A] animate-pulse"
              : getStepState(3) === "failed"
              ? "bg-[#FEE2E2] border-[#FECACA]"
              : getStepState(3) === "passed"
              ? "bg-[#E6F4EA] border-[#CEEAD6]"
              : "bg-[#FAF8F5] border-[#E6E2D8]"
          }`}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8C959F] font-mono text-[10px]">STAGE 3</span>
              <span className={`text-[10px] font-bold ${
                getStepState(3) === "failed" ? "text-[#991B1B]" : getStepState(3) === "passed" ? "text-[#137333]" : "text-[#B45309]"
              }`}>
                {getStepState(3) === "failed" ? "✕ Caught" : getStepState(3) === "passed" ? "✓ Verified" : isTesting ? "Running..." : "<50ms"}
              </span>
            </div>
            <div className="mt-1 text-xs font-semibold text-[#1F2328]">uv Sandbox Test</div>
            <div className="text-[10px] text-[#656D76]">py_compile &amp; pytest</div>
          </div>

          {/* Step 4: Autonomous Self-Healing */}
          <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
            getStepState(4) === "active"
              ? "bg-[#F5F3FF] border-[#DDD6FE] animate-pulse"
              : getStepState(4) === "passed"
              ? "bg-[#E6F4EA] border-[#CEEAD6]"
              : "bg-[#FAF8F5] border-[#E6E2D8]"
          }`}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8C959F] font-mono text-[10px]">STAGE 4</span>
              <span className={`text-[10px] font-bold ${
                getStepState(4) === "active" ? "text-[#7C3AED]" : getStepState(4) === "passed" ? "text-[#137333]" : "text-[#8C959F]"
              }`}>
                {getStepState(4) === "active" ? "Healing..." : getStepState(4) === "passed" ? "✓ Auto-Healed" : "Auto-Retry"}
              </span>
            </div>
            <div className="mt-1 text-xs font-semibold text-[#1F2328]">Self-Healing Loop</div>
            <div className="text-[10px] text-[#656D76]">Traceback Re-injection</div>
          </div>

          {/* Step 5: CRDT Canvas Broadcast */}
          <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
            getStepState(5) === "blocked"
              ? "bg-[#FFF5F5] border-[#FED7D7]"
              : getStepState(5) === "passed"
              ? "bg-[#E6F4EA] border-[#CEEAD6]"
              : "bg-[#FAF8F5] border-[#E6E2D8]"
          }`}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8C959F] font-mono text-[10px]">STAGE 5</span>
              <span className={`text-[10px] font-bold ${
                getStepState(5) === "blocked" ? "text-[#991B1B]" : getStepState(5) === "passed" ? "text-[#137333]" : "text-[#8C959F]"
              }`}>
                {getStepState(5) === "blocked" ? "⛔ Blocked" : getStepState(5) === "passed" ? "✓ Broadcasted" : "Standby"}
              </span>
            </div>
            <div className="mt-1 text-xs font-semibold text-[#1F2328]">Canvas Broadcast</div>
            <div className="text-[10px] text-[#656D76]">
              {getStepState(5) === "blocked" ? "Frontier Preserved" : "CRDT Delta Committed"}
            </div>
          </div>
        </div>
      </div>

      {/* 3-Card Verification Metric Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {/* Card 1: py_compile */}
        <div className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] shadow-apple-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#656D76] font-medium">Syntax Validation</span>
            <span className="font-mono text-[10px] text-[#8C959F]">uv run py_compile</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className={`text-sm font-bold ${
              healedSuccessfully ? "text-[#137333]" : isFailed ? "text-[#991B1B]" : isPassed ? "text-[#137333]" : "text-[#137333]"
            }`}>
              {healedSuccessfully ? "Healed & Compiled" : isFailed ? "Syntax Error" : isPassed ? "Compiled" : "Ready"}
            </span>
            <span className="text-[11px] font-mono text-[#656D76]">~12ms</span>
          </div>
        </div>

        {/* Card 2: pytest */}
        <div className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] shadow-apple-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#656D76] font-medium">Test Suite Runner</span>
            <span className="font-mono text-[10px] text-[#8C959F]">uv run pytest</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className={`text-sm font-bold ${
              healedSuccessfully ? "text-[#137333]" : isFailed ? "text-[#991B1B]" : isPassed ? "text-[#137333]" : "text-[#137333]"
            }`}>
              {healedSuccessfully ? "4/4 Passed (Auto-Healed)" : isFailed ? "0/4 Passed" : isPassed ? "4/4 Passed" : "4 Tests Ready"}
            </span>
            <span className="text-[11px] font-mono text-[#656D76]">~26ms</span>
          </div>
        </div>

        {/* Card 3: Broadcast Guardrail */}
        <div className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] shadow-apple-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#656D76] font-medium">Broadcast Guardrail</span>
            <span className="font-mono text-[10px] text-[#8C959F]">Loro Pre-Commit Filter</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className={`text-sm font-bold ${
              isFailed ? "text-[#991B1B]" : isPassed ? "text-[#137333]" : "text-[#2563EB]"
            }`}>
              {isFailed ? "Mutation Blocked" : isPassed ? "Mutation Allowed" : "Filter Active"}
            </span>
            <span className="text-[11px] font-mono text-[#656D76]">&lt; 4ms Rollback</span>
          </div>
        </div>
      </div>

      {/* Self-Healing Success Callout Banner */}
      {healedSuccessfully && (
        <div className="mb-4 p-3.5 rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] text-xs text-[#137333] shadow-apple-sm flex items-start gap-3">
          <span className="w-5 h-5 rounded-full bg-[#137333] text-white flex items-center justify-center font-bold text-[11px] flex-shrink-0 mt-0.5">
            ✓
          </span>
          <div className="flex-1">
            <div className="font-semibold text-sm">Milestone 3 Autonomous Self-Healing Complete:</div>
            <p className="mt-0.5 text-[#0D5224] leading-relaxed">
              Syntax failure in Attempt 1 was caught in sandbox in 14ms &rarr; Compiler traceback was re-injected into Temporal activity loop &rarr; Corrected code verified in Attempt 2 (4/4 tests passed in 26ms) &rarr; Clean CRDT merge into collaborative canvas with zero human keystroke conflicts.
            </p>
          </div>
        </div>
      )}

      {/* Expandable Granular Test Case Breakdown */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowTestDetails(!showTestDetails)}
          className="text-xs text-[#656D76] hover:text-[#1F2328] font-medium flex items-center gap-1.5 transition cursor-pointer"
        >
          <span>{showTestDetails ? "▼ Hide Test Breakdown" : "▶ View Granular Pre-Flight Test Results (4 test cases)"}</span>
          <span className="text-[10px] bg-[#EFEAD9] px-2 py-0.5 rounded font-mono text-[#4B515D]">
            38ms total
          </span>
        </button>

        {showTestDetails && (
          <div className="mt-2.5 p-3 rounded-xl bg-[#FFFFFF] border border-[#E6E2D8] divide-y divide-[#EBE7DC] text-xs font-mono shadow-apple-sm">
            {testCases.map((tc, idx) => (
              <div key={idx} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={tc.status === "failed" ? "text-[#EF4444]" : "text-[#137333]"}>
                    {tc.status === "failed" ? "✕" : "✓"}
                  </span>
                  <span className="font-semibold text-[#1F2328]">{tc.name}</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[#656D76]">
                  <span>{tc.durationMs}ms</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-medium ${
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

      {/* Interactive Simulation Triggers for Day 10 & 11 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-[#EBE7DC]">
        <p className="text-[11px] text-[#656D76]">
          Interactive Stage 3 verification triggers (Sub-50ms Sandbox &amp; Autonomous Self-Healing):
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Day 11 Flagship: Autonomous Self-Healing Loop */}
          <button
            type="button"
            onClick={() => onSimulateTest(true, "syntax", true)}
            disabled={isConnecting || isTesting || status === "self-healing"}
            className="px-3.5 py-1.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-medium transition cursor-pointer shadow-apple-sm disabled:opacity-50 flex items-center gap-1.5"
            title="Demonstrates Milestone 3: Error catch -> Self-correction -> Canvas merge"
          >
            <span>⚡ Run Self-Healing Loop (Milestone 3)</span>
          </button>

          {/* Day 10: Standard Pass */}
          <button
            type="button"
            onClick={() => onSimulateTest(false)}
            disabled={isConnecting || isTesting || status === "self-healing"}
            className="px-3.5 py-1.5 rounded-xl bg-[#FFFFFF] hover:bg-[#F7F4EB] text-[#137333] border border-[#CEEAD6] text-xs font-medium transition cursor-pointer shadow-apple-sm disabled:opacity-50"
          >
            Pre-Flight Pass &amp; Broadcast
          </button>

          {/* Day 10: Unrecoverable Syntax Failure Catch */}
          <button
            type="button"
            onClick={() => onSimulateTest(true, "syntax", false)}
            disabled={isConnecting || isTesting || status === "self-healing"}
            className="px-3 py-1.5 rounded-xl bg-[#FFFFFF] hover:bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA] text-xs font-medium transition cursor-pointer shadow-apple-sm disabled:opacity-50"
          >
            Catch Syntax Error (Abort)
          </button>
        </div>
      </div>
    </div>
  );
};
