import { WebSocketServer } from "ws";

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });

console.log(`\n======================================================`);
console.log(`[ChronoCanvas Server Gateway] Listening on ws://localhost:${PORT}`);
console.log(`Features: Binary CRDT Relay • Multi-Cursor Awareness • Stage 4 Day 13 Auth & BYOK Simulator`);
console.log(`======================================================\n`);

let cachedDocumentSnapshot = null;

wss.on("connection", (ws) => {
  console.log(`[Gateway] Client connected. Total active clients: ${wss.clients.size}`);

  if (cachedDocumentSnapshot) {
    ws.send(cachedDocumentSnapshot, { binary: true });
    console.log(`[Gateway] Sent cached snapshot (${cachedDocumentSnapshot.length} bytes) to new client.`);
  }

  ws.on("message", (data, isBinary) => {
    // 1. Binary CRDT delta relay
    if (isBinary) {
      cachedDocumentSnapshot = data;
      console.log(`[CRDT Sync] Relaying ${data.length} bytes to ${wss.clients.size - 1} peers.`);
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === 1 /* WebSocket.OPEN */) {
          client.send(data, { binary: true });
        }
      }
      return;
    }

    // 2. JSON Message relay (Awareness & Agent workflows)
    try {
      const text = data.toString("utf-8");
      const msg = JSON.parse(text);

      if (msg.type === "awareness-update") {
        for (const client of wss.clients) {
          if (client !== ws && client.readyState === 1) {
            client.send(text);
          }
        }
      } else if (msg.type === "agent-task-request") {
        const byokInfo = msg.byokConfig?.enabled
          ? `[BYOK Active: ${msg.byokConfig.provider} / ${msg.byokConfig.model}]`
          : `[Managed Cluster: claude-3.5-sonnet]`;
        const authInfo = msg.authToken
          ? `[JWT Verified: sub=za-frontend-lead]`
          : `[Guest Session]`;

        console.log(`[Temporal Agent] Task dispatched: "${msg.prompt}" ${byokInfo} ${authInfo} (Frontier: ${msg.docFrontier || 'root-0'})`);

        for (const client of wss.clients) {
          if (client.readyState === 1) client.send(text);
        }

        simulateTemporalWorkflow(msg);
      }
    } catch (err) {
      console.error("[Gateway] Error handling message:", err);
    }
  });

  ws.on("close", () => {
    console.log(`[Gateway] Client disconnected. Total active clients: ${wss.clients.size}`);
  });
});

function broadcastJson(msgObj) {
  const payload = JSON.stringify(msgObj);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function simulateTemporalWorkflow(req) {
  const taskId = req.taskId;
  const isFailure = Boolean(req.simulateFailure);
  const failureType = req.failureType || "syntax";
  const isSelfHealing = Boolean(req.enableSelfHealing);
  const byokUsed = Boolean(req.byokConfig?.enabled);
  const modelUsed = byokUsed ? req.byokConfig.model : "anthropic/claude-3.5-sonnet";

  // Stage 1: Frontier Checkpoint Saved (Pre-Flight Anchor)
  setTimeout(() => {
    console.log(`[Temporal Agent] Step 1: Pre-flight Frontier Checkpoint recorded (${req.docFrontier || 'root-0'}).`);
    broadcastJson({
      type: "agent-task-status",
      taskId,
      status: "planning",
      preFlightStage: "checkpoint-saved",
      byokUsed,
      modelUsed,
    });
  }, 350);

  // Clean code lines
  const cleanCodeLines = [
    `// [AI Agent • Model: ${modelUsed} • Prompt Caching Active]\n`,
    `function binarySearch<T>(arr: T[], target: T): number {\n`,
    `  let left = 0;\n`,
    `  let right = arr.length - 1;\n\n`,
    `  while (left <= right) {\n`,
    `    const mid = Math.floor((left + right) / 2);\n`,
    `    if (arr[mid] === target) return mid;\n`,
    `    if (arr[mid] < target) left = mid + 1;\n`,
    `    else right = mid - 1;\n`,
    `  }\n`,
    `  return -1; // Target element not found\n`,
    `}\n\n`
  ];

  // Stage 2: Initial Code Generation in Scratchpad
  setTimeout(() => {
    console.log(`[Temporal Agent] Step 2: Generating code in isolated scratchpad using ${modelUsed}...`);
    broadcastJson({
      type: "agent-task-status",
      taskId,
      status: "generating",
      tokenCount: 84,
      preFlightStage: "code-generated",
      byokUsed,
      modelUsed,
    });
  }, 900);

  // Stage 3: uv Sandbox Pre-Flight Verification (<50ms)
  setTimeout(() => {
    console.log(`[Temporal Agent] Step 3: Running sub-50ms pre-flight verification...`);
    broadcastJson({
      type: "agent-task-status",
      taskId,
      status: "sandboxed-testing",
      preFlightStage: "testing",
      byokUsed,
      modelUsed,
    });
  }, 1900);

  // Stage 4: Self-Healing Loop OR Final Decision
  if (isSelfHealing) {
    // Step 4a: Error Caught in Attempt 1
    setTimeout(() => {
      console.log(`[Temporal Agent] Attempt 1 Caught SyntaxError in 14ms! Re-injecting traceback into LLM context.`);
      broadcastJson({
        type: "agent-task-status",
        taskId,
        status: "self-healing",
        selfHealingAttempt: 1,
        maxAttempts: 3,
        preFlightStage: "self-healing",
        byokUsed,
        modelUsed,
        errorTrace: "SyntaxError: '(' was never closed at line 7 (uv py_compile caught error)",
        sandboxResult: {
          suite: "astral-sh/uv pre-flight",
          runner: "uv run python -m py_compile",
          passed: false,
          totalTests: 4,
          passedTests: 1,
          failedTests: 1,
          durationMs: 14,
          testCases: [
            { name: "test_syntax_compilation", status: "failed", durationMs: 14, error: "SyntaxError: '(' was never closed" },
            { name: "test_type_contract_safety", status: "failed", durationMs: 6 },
            { name: "test_crdt_frontier_guard", status: "passed", durationMs: 2 },
          ],
          errorTraceback: "SyntaxError: '(' was never closed at line 7",
        },
      });
    }, 2500);

    // Step 4b: Re-generating Self-Corrected Code with Stream
    setTimeout(() => {
      console.log(`[Temporal Agent] Attempt 2: Generated corrected code. Streaming healed tokens...`);
      let lineIdx = 0;
      const interval = setInterval(() => {
        if (lineIdx < cleanCodeLines.length) {
          broadcastJson({
            type: "agent-token-stream",
            taskId,
            chunk: cleanCodeLines[lineIdx],
          });
          lineIdx++;
        } else {
          clearInterval(interval);
        }
      }, 100);
    }, 3200);

    // Step 4c: Pre-Flight Re-test PASSES & Merged into Canvas (Milestone 3 Complete!)
    setTimeout(() => {
      console.log(`[Temporal Agent] Milestone 3 Verified! Re-test passed in 25ms. Merging into canvas.`);
      broadcastJson({
        type: "agent-task-status",
        taskId,
        status: "committed",
        healedSuccessfully: true,
        preFlightTestsPassed: true,
        selfHealingAttempt: 2,
        preFlightStage: "broadcast-committed",
        byokUsed,
        modelUsed,
        sandboxResult: {
          suite: "astral-sh/uv pre-flight",
          runner: "uv run pytest",
          passed: true,
          totalTests: 4,
          passedTests: 4,
          failedTests: 0,
          durationMs: 25,
          testCases: [
            { name: "test_syntax_compilation", status: "passed", durationMs: 9 },
            { name: "test_type_contract_safety", status: "passed", durationMs: 6 },
            { name: "test_unit_assertions", status: "passed", durationMs: 14 },
            { name: "test_crdt_frontier_guard", status: "passed", durationMs: 2 },
          ],
        },
      });
    }, 4500);

  } else if (isFailure) {
    // Unrecoverable simulated failure (mutation blocked, drawer opened)
    setTimeout(() => {
      const isSyntax = failureType === "syntax";
      const errorMsg = isSyntax
        ? "SyntaxError: Unterminated string literal at line 7 (uv py_compile caught error before canvas commit)"
        : "AssertionError: assert binarySearch([1, 3, 5], 4) == -1 (uv pytest caught failure before canvas commit)";

      console.log(`[Temporal Agent] Pre-flight failed! Canvas mutation blocked. Reverting to anchor.`);
      broadcastJson({
        type: "agent-task-status",
        taskId,
        status: "rolled-back",
        rollbackTriggered: true,
        failureType,
        errorTrace: errorMsg,
        preFlightStage: "broadcast-aborted",
        byokUsed,
        modelUsed,
        sandboxResult: {
          suite: "astral-sh/uv pre-flight",
          runner: isSyntax ? "uv run python -m py_compile" : "uv run pytest",
          passed: false,
          totalTests: 4,
          passedTests: isSyntax ? 1 : 3,
          failedTests: 1,
          durationMs: isSyntax ? 14 : 28,
          testCases: [
            { name: isSyntax ? "test_syntax_compilation" : "test_unit_assertions", status: "failed", durationMs: 14, error: errorMsg },
            { name: "test_type_contract_safety", status: isSyntax ? "failed" : "passed", durationMs: 8 },
            { name: "test_crdt_frontier_guard", status: "passed", durationMs: 2 },
          ],
          errorTraceback: errorMsg,
        },
      });
    }, 2600);

  } else {
    // Normal Pass (No error)
    setTimeout(() => {
      let lineIdx = 0;
      const interval = setInterval(() => {
        if (lineIdx < cleanCodeLines.length) {
          broadcastJson({
            type: "agent-token-stream",
            taskId,
            chunk: cleanCodeLines[lineIdx],
          });
          lineIdx++;
        } else {
          clearInterval(interval);
        }
      }, 100);
    }, 2400);

    setTimeout(() => {
      console.log(`[Temporal Agent] Pre-flight passed (4/4 passed in 38ms). Broadcasting mutation to canvas!`);
      broadcastJson({
        type: "agent-task-status",
        taskId,
        status: "committed",
        preFlightTestsPassed: true,
        preFlightStage: "broadcast-committed",
        byokUsed,
        modelUsed,
        sandboxResult: {
          suite: "astral-sh/uv pre-flight",
          runner: "uv run pytest",
          passed: true,
          totalTests: 4,
          passedTests: 4,
          failedTests: 0,
          durationMs: 38,
          testCases: [
            { name: "test_syntax_compilation", status: "passed", durationMs: 12 },
            { name: "test_type_contract_safety", status: "passed", durationMs: 8 },
            { name: "test_unit_assertions", status: "passed", durationMs: 16 },
            { name: "test_crdt_frontier_guard", status: "passed", durationMs: 2 },
          ],
        },
      });
    }, 3600);
  }
}
