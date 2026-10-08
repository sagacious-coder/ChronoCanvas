import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { VersionVector } from 'loro-crdt';
import {
  EMPTY_ROOM_GRACE_MS,
  getRoom,
  peekRoom,
  scheduleEviction,
  isValidDocId,
  fromB64,
  hexToVV,
  safeSend,
  errMsg,
} from './hub.js';
import { eventHub } from './EventHub.js';
import { createApiHandler, getTemporalClient } from './api.js';
import type { AgentTaskStatus } from '@chronocanvas/shared-types';

/**
 * ChronoCanvas WebSocket transport.
 *
 * This module is the browser-facing edge: it validates frames, tracks socket
 * membership, decodes payloads, and hands every edit to the Event Hub, which
 * multiplexes it (alongside agent writes) into the authoritative write path in
 * `hub.ts`. It holds no CRDT logic of its own — that lives in `hub.ts` so an
 * agent worker can reuse it without booting a socket server.
 */

const PORT = Number(process.env.PORT ?? 3001);

/** A live client socket, tagged with its identity and room membership. */
type ClientSocket = WebSocket & { connId: string; joinedRooms: Set<string> };

/**
 * Shared HTTP server — handles both WebSocket upgrades (via `ws`) and the
 * REST API (via `apiHandler`). A single port serves both protocols:
 * the `ws` library intercepts Upgrade requests before the `request` event
 * fires, so REST and WS never collide.
 */
const httpServer = createServer(createApiHandler());
const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log(`🚀 ChronoCanvas server running on port ${PORT}`);
  console.log(`   WS  → ws://localhost:${PORT}`);
  console.log(`   API → http://localhost:${PORT}/api/ask-ai`);
  console.log(`   API → http://localhost:${PORT}/api/agent/dispatch`);
});

wss.on('connection', (socket: WebSocket, request) => {
  const ws = socket as ClientSocket;
  const connId = randomUUID();
  ws.connId = connId;
  ws.joinedRooms = new Set<string>();
  console.log(`[+] client ${connId} connected from ${request.socket.remoteAddress}`);

  ws.on('message', (data, isBinary) => {
    // Outermost crash boundary: nothing a client sends may take the process down.
    try {
      // Guard: a *true* binary frame is a protocol error — clients must send
      // crdt-sync JSON frames (base64 payload + docId) so the server can route
      // to the correct DocumentRoom. Raw binary carries no docId field.
      //
      // CRITICAL (ws v8): the `message` event always hands `data` over as a
      // Buffer, even for text frames, so `Buffer.isBuffer(data)` is NOT a binary
      // test — it is true for every frame. The frame opcode lives in the
      // `isBinary` argument. The previous `Buffer.isBuffer(data)` check therefore
      // misclassified every JSON frame as binary and dropped it, which is the
      // real source of the "binary frame received (N bytes)" log.
      if (isBinary) {
        console.warn(
          `[${connId}] protocol error: binary frame received (${(data as Buffer).length} bytes). ` +
          `Client must send crdt-sync JSON frames, not raw Uint8Array. Frame dropped.`,
        );
        return;
      }

      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch (err) {
        console.error(`[${connId}] bad JSON: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (!message || typeof message !== 'object') {
        console.warn(`[${connId}] frame is not a JSON object`);
        return;
      }
      const frame = message as Record<string, unknown>;
      if (frame.type === 'crdt-sync') handleCrdtSync(ws, frame);
      else if (frame.type === 'awareness-update') handleAwareness(ws, frame);
      else if (frame.type === 'agent-task-request') void handleAgentTaskRequest(ws, frame);
      else console.log(`[${connId}] unknown message type: ${String(frame.type)}`);
    } catch (err) {
      console.error(`[${connId}] message handler crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ws.on('close', () => {
    for (const docId of ws.joinedRooms) {
      const room = peekRoom(docId);
      if (!room) continue;
      room.members.delete(connId);
      if (room.members.size === 0) {
        console.log(`[room:${docId}] empty — eviction in ${EMPTY_ROOM_GRACE_MS}ms`);
        scheduleEviction(room); // no-ops while writes are still queued
      }
    }
    ws.joinedRooms.clear();
    console.log(`[-] client ${connId} disconnected`);
  });

  ws.on('error', (err) => console.error(`[${connId}] socket error: ${err.message}`));
});

// --- crdt-sync ---------------------------------------------------------------
// Thin transport adapter: validate the frame, register membership, decode the
// binary payload, then hand the real work to the Event Hub, which funnels it
// (as a `human` write) into the same queued write path an agent write travels.

function handleCrdtSync(ws: ClientSocket, message: Record<string, unknown>): void {
  const docId = message.docId;
  if (!isValidDocId(docId)) {
    return void console.warn(`[${ws.connId}] crdt-sync with a missing or oversized docId`);
  }

  const room = getRoom(docId);
  const versionFrom = typeof message.versionFrom === 'string' ? message.versionFrom : undefined;

  // Membership is mutated synchronously here and in `close`, so join/leave
  // ordering stays consistent with the socket lifecycle. Only the document
  // itself is touched inside the queue.
  if (!room.members.has(ws.connId)) {
    room.members.set(ws.connId, {
      ws,
      vv: new VersionVector(undefined),
      // A peer that arrives without a version vector has no known position in
      // history: seed it with a compact snapshot rather than a diff from zero.
      needsSnapshot: !versionFrom,
    });
    ws.joinedRooms.add(docId);
    console.log(`[room:${docId}] ${ws.connId} joined (${room.members.size} member(s))`);
  }

  let bytes: Uint8Array | null = null;
  const payload = message.payload;
  if (typeof payload === 'string' && payload.length > 0) {
    try {
      bytes = fromB64(payload);
    } catch (err) {
      return void console.error(
        `[room:${docId}] undecodable payload from ${ws.connId}: ${errMsg(err)}`,
      );
    }
  }

  let sourceVV: VersionVector | null = null;
  if (versionFrom && versionFrom.length > 0) {
    try {
      sourceVV = hexToVV(versionFrom);
    } catch (err) {
      // We no longer know where this peer stands: fall back to a full snapshot
      // rather than diffing against a version vector we failed to parse.
      console.error(`[room:${docId}] bad versionFrom from ${ws.connId}: ${errMsg(err)}`);
      const member = room.members.get(ws.connId);
      if (member) member.needsSnapshot = true;
    }
  }

  const senderId = typeof message.senderId === 'string' ? message.senderId : undefined;
  // Route through the Event Hub: it stamps `kind: 'human'` and the origin is
  // broadcast on the outbound frame so clients can tell the write apart from an
  // agent's. The Hub converges on the same per-room queue + `applyDelta`.
  void eventHub.submitHumanDelta(docId, bytes, sourceVV, {
    connId: ws.connId,
    ws,
    label: senderId ?? ws.connId,
  });
}

// --- awareness-update --------------------------------------------------------
// Presence and cursors are ephemeral — never part of the CRDT — so they bypass
// the write queue entirely and relay straight to the other members of the
// document the frame names.

function handleAwareness(ws: ClientSocket, message: Record<string, unknown>): void {
  const docId = message.docId;
  if (!isValidDocId(docId)) {
    return void console.warn(`[${ws.connId}] awareness-update with a missing or oversized docId`);
  }

  // `peekRoom`, not `getRoom`: presence must never conjure a document, or a
  // peer could spray rooms into existence without ever syncing one.
  const room = peekRoom(docId);
  if (!room) return;

  // Re-serialize rather than forwarding the client's frame verbatim, so a peer
  // cannot smuggle extra fields through the relay.
  const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
  const frame = {
    type: 'awareness-update',
    docId,
    peer: message.peer,
    timestamp,
  };

  for (const [memberId, member] of room.members) {
    if (memberId === ws.connId || member.ws === ws) continue;
    safeSend(member.ws, frame, `room:${docId}/${memberId}`);
  }
}

// --- agent-task-request -------------------------------------------------------
// Bridge between the browser's "Dispatch Agent" / "Test Rollback" buttons and
// the Temporal workflow. The frame arrives over the WebSocket (sent by
// `loroSync.ts :: dispatchAgentTask`) so the user never needs a separate fetch.
//
// Flow:
//   1. Validate the frame and extract the docId.
//   2. Reply immediately with `agent-task-status { status: 'planning' }` so the
//      UI updates without waiting for Temporal.
//   3. Export the current hub snapshot (real CRDT bytes, not an empty array).
//   4. Start `agentSyncWorkflow` via the same lazy Temporal client used by the
//      REST endpoint so we never open a second connection.
//   5. Reply `committed` (workflow started) or `rolled-back` (Temporal error).
//
// Note: we only *start* the workflow here and return immediately — the agent
// worker broadcasts the actual CRDT update via its own WebSocket connection once
// the LLM finishes, exactly as it does when triggered via POST /api/ask-ai.

const AGENT_TASK_QUEUE   = process.env.AGENT_TASK_QUEUE   ?? 'agent-queue';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';
const SYSTEM_INSTRUCTION =
  'Read the canvas text and append a short, coherent 1-sentence continuation.';

async function handleAgentTaskRequest(
  ws: ClientSocket,
  message: Record<string, unknown>,
): Promise<void> {
  const taskId = typeof message.taskId === 'string' ? message.taskId : randomUUID();
  const simulateFailure = message.simulateFailure === true;

  // docId: prefer an explicit field; fall back to the well-known default room.
  const rawDocId = typeof message.docId === 'string' ? message.docId : 'chrono-canvas-default';
  const docId = isValidDocId(rawDocId) ? rawDocId : 'chrono-canvas-default';

  console.log(
    `[agent-task] taskId=${taskId} docId=${docId} simulateFailure=${simulateFailure} from ${ws.connId}`,
  );

  // --- 1. Acknowledge immediately so the UI badge switches to "Planning..." ---
  const planningStatus: AgentTaskStatus = {
    type: 'agent-task-status',
    taskId,
    status: 'planning',
  };
  safeSend(ws, planningStatus, `agent-task/${taskId}`);

  // --- 2. Export the current document snapshot from the hub -------------------
  // `peekRoom` — do not conjure a room that was never joined.
  const room = peekRoom(docId);
  let stateBytes: number[] = [];
  let currentDocumentState = '';
  if (room) {
    try {
      const snap = room.doc.export({ mode: 'snapshot' });
      stateBytes = Array.from(snap);
      // Extract the canonical plain-text representation from the hub's
      // authoritative LoroDoc — the same container loro-codemirror writes to.
      currentDocumentState = room.doc.getText('codemirror').toString();
    } catch (exportErr) {
      console.warn(`[agent-task] snapshot export failed for ${docId}: ${errMsg(exportErr)}`);
    }
  }

  // --- 3. Build system instruction (inject failure flag for Test Rollback) ----
  // The worker reads SIMULATE_AGENT_CRASH from its own env, but we also embed a
  // sentinel in the system instruction so a prompt-level crash can be tested
  // without restarting the worker process.
  const systemInstruction = simulateFailure
    ? '__SIMULATE_AGENT_CRASH__ ' + SYSTEM_INSTRUCTION
    : (typeof message.prompt === 'string' && message.prompt.trim()
        ? message.prompt.trim()
        : SYSTEM_INSTRUCTION);

  // --- 4. Fire the Temporal workflow and relay its REAL outcome ----------------
  // We intentionally AWAIT the workflow result rather than replying 'committed'
  // the instant the workflow is scheduled. `workflow.start` resolving only means
  // Temporal *accepted* the job — not that the agent committed. The agent's
  // actual CRDT write (success path) or rollback (failure path) is decided inside
  // `generateAndInjectResponse`, and `agentSyncWorkflow` re-throws on rollback
  // (workflows.ts). `handle.result()` is therefore the only place the server can
  // learn the true terminal status to forward to the browser badge — previously
  // the server reported 'committed' optimistically on start and the real
  // rollback outcome was never relayed, so the badge could never show it.
  const workflowId = `agent-task-${docId}-${taskId}`;
  try {
    const client = await getTemporalClient();
    const handle = await client.workflow.start('agentSyncWorkflow', {
      taskQueue: AGENT_TASK_QUEUE,
      workflowId,
      args: [{ docId, stateBytes, currentDocumentState, systemInstruction }],
    });

    console.log(`[agent-task] workflow started workflowId=${workflowId}`);

    // The worker is now running: move the badge to 'generating' while the
    // two-phase workflow (checkpoint → LLM → broadcast) settles.
    const generatingStatus: AgentTaskStatus = {
      type: 'agent-task-status',
      taskId,
      status: 'generating',
    };
    safeSend(ws, generatingStatus, `agent-task/${taskId}`);

    // Block on the real outcome. Resolves with the generated text on the success
    // path (the browser already received the CRDT delta over its own socket, so
    // this is purely the status confirmation); rejects when the activity rolled
    // back (SIMULATED_AGENT_CRASH, LLM failure, empty response, …) because
    // `agentSyncWorkflow` re-throws after the activity performs its rollback.
    await handle.result();

    console.log(`[agent-task] workflow committed workflowId=${workflowId}`);

    const committedStatus: AgentTaskStatus = {
      type: 'agent-task-status',
      taskId,
      status: 'committed',
    };
    safeSend(ws, committedStatus, `agent-task/${taskId}`);
  } catch (err) {
    // Reached when the workflow failed to start OR when it ran and rolled back.
    // In both cases the authoritative document is already healed (the activity's
    // rollback broadcast, or — for a pre-write crash — nothing was ever written),
    // so the correct client signal is 'rolled-back' with the diagnostic trace
    // that drives the UI's error banner.
    const msg = errMsg(err);
    console.error(`[agent-task] workflow ${workflowId} rolled back / failed: ${msg}`);

    const rolledBackStatus: AgentTaskStatus = {
      type: 'agent-task-status',
      taskId,
      status: 'rolled-back',
      rollbackTriggered: true,
      errorTrace: msg,
    };
    safeSend(ws, rolledBackStatus, `agent-task/${taskId}`);
  }
}
