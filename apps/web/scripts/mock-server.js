import { WebSocketServer } from "ws";

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });

console.log(`\n======================================================`);
console.log(`[ChronoCanvas Server Gateway] Listening on ws://localhost:${PORT}`);
console.log(`Features: Binary CRDT Relay • Multi-Cursor Awareness • Temporal Agent Simulator`);
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
        console.log(`[Temporal Agent] Task dispatched: "${msg.prompt}" (Frontier: ${msg.docFrontier})`);

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

  // Stage 1: Planning Activity
  setTimeout(() => {
    console.log(`[Temporal Agent] Activity 1: Planning task & recording checkpoint frontier.`);
    broadcastJson({
      type: "agent-task-status",
      taskId,
      status: "planning",
    });
  }, 400);

  // Stage 2: LLM Generation Activity (Stream token chunks into editor)
  const codeLines = [
    `// [AI Agent • Temporal Checkpoint Verified]\n`,
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

  setTimeout(() => {
    console.log(`[Temporal Agent] Activity 2: LLM generating code tokens...`);
    broadcastJson({
      type: "agent-task-status",
      taskId,
      status: "generating",
      tokenCount: 84,
    });

    // If not a simulated failure, stream the tokens in real time
    if (!isFailure) {
      let lineIdx = 0;
      const interval = setInterval(() => {
        if (lineIdx < codeLines.length) {
          broadcastJson({
            type: "agent-token-stream",
            taskId,
            chunk: codeLines[lineIdx],
          });
          lineIdx++;
        } else {
          clearInterval(interval);
        }
      }, 150);
    }
  }, 1000);

  // Stage 3: astral-sh/uv Ephemeral Sandbox Testing
  setTimeout(() => {
    console.log(`[Temporal Agent] Activity 3: Running sub-50ms sandbox tests via uv run pytest...`);
    broadcastJson({
      type: "agent-task-status",
      taskId,
      status: "sandboxed-testing",
    });
  }, 3200);

  // Stage 4: Commit or Instant Rollback Protocol
  setTimeout(() => {
    if (isFailure) {
      console.log(`[Temporal Agent] Sandbox pre-flight test failed! Reverting to saved frontier.`);
      broadcastJson({
        type: "agent-task-status",
        taskId,
        status: "rolled-back",
        rollbackTriggered: true,
        errorTrace: "SyntaxError: Unterminated string literal at line 7 (uv sandbox caught error before canvas commit)",
      });
    } else {
      console.log(`[Temporal Agent] Sandbox tests passed (0 errors, 4 tests passed in 38ms). Committing!`);
      broadcastJson({
        type: "agent-task-status",
        taskId,
        status: "committed",
        preFlightTestsPassed: true,
      });
    }
  }, 4000);
}
