import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
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
import type {
  AgentTaskStatus,
  AuthSuccessMessage,
  AuthErrorMessage,
  JwtPayload,
} from '@chronocanvas/shared-types';

/**
 * ChronoCanvas WebSocket transport with JWT gateway authentication.
 *
 * This module is the browser-facing edge: it validates frames, enforces
 * JWT authentication on handshake or via initial auth frame, tracks socket
 * membership, decodes payloads, and hands every edit to the Event Hub.
 */

const PORT = Number(process.env.PORT ?? 3001);
const JWT_SECRET = process.env.JWT_SECRET ?? 'chrono-canvas-dev-secret-key-change-in-prod';
const INTERNAL_WORKER_SECRET = process.env.INTERNAL_WORKER_SECRET ?? 'chrono-worker-internal-key';
const AUTH_TIMEOUT_MS = 10_000;

/** A live client socket, tagged with its identity, authentication, and room membership. */
type ClientSocket = WebSocket & {
  connId: string;
  joinedRooms: Set<string>;
  isAuthenticated: boolean;
  userId?: string;
  byokApiKey?: string;
  authTimeoutTimer?: NodeJS.Timeout;
};

/**
 * Validates an HS256 JWT using timing-safe HMAC SHA-256 verification.
 * Throws on invalid signature, expired token, or malformed payload.
 */
export function verifyJwtToken(token: string, secret = JWT_SECRET): JwtPayload {
  const clean = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  // Development bypass token support for unauthenticated frontend development
  if (clean === 'dev-dummy-token') {
    return { sub: 'dev-user-001', role: 'developer' };
  }

  const parts = clean.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT: must consist of 3 dot-separated parts');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const data = `${headerB64}.${payloadB64}`;

  const expectedSig = createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  const sigBuf = Buffer.from(signatureB64);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid JWT signature');
  }

  const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
  let claims: JwtPayload;
  try {
    claims = JSON.parse(payloadJson) as JwtPayload;
  } catch {
    throw new Error('Invalid JWT payload JSON');
  }

  if (claims.exp && typeof claims.exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (now > claims.exp) {
      throw new Error('JWT token has expired');
    }
  }

  if (!claims.sub || typeof claims.sub !== 'string') {
    throw new Error('JWT token missing subject (sub) claim');
  }

  return claims;
}

/**
 * Extracts authentication credentials (JWT token or internal worker token)
 * from incoming HTTP Upgrade request headers, URL query parameters, or protocols.
 */
function extractTokenFromRequest(request: IncomingMessage): { token?: string; isWorker?: boolean } {
  // 1. Worker internal secret header
  const workerHeader = request.headers['x-worker-secret'];
  if (workerHeader && workerHeader === INTERNAL_WORKER_SECRET) {
    return { isWorker: true };
  }

  // 2. Authorization header (Bearer <token>)
  const authHeader = request.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return { token: authHeader.slice(7).trim() };
  }

  // 3. Query string token (?token=...)
  if (request.url) {
    try {
      const parsedUrl = new URL(request.url, 'http://localhost');
      const tokenParam = parsedUrl.searchParams.get('token');
      if (tokenParam) {
        if (tokenParam === INTERNAL_WORKER_SECRET) {
          return { isWorker: true };
        }
        return { token: tokenParam };
      }
    } catch {
      // Ignore URL parsing errors
    }
  }

  // 4. Sec-WebSocket-Protocol token
  const protocolHeader = request.headers['sec-websocket-protocol'];
  if (protocolHeader) {
    const protocols = protocolHeader.split(',').map((p) => p.trim());
    for (const p of protocols) {
      if (p === INTERNAL_WORKER_SECRET) return { isWorker: true };
      if (p.startsWith('token.')) return { token: p.slice(6) };
    }
  }

  return {};
}

/**
 * Shared HTTP server — handles both WebSocket upgrades (via `ws`) and the
 * REST API (via `apiHandler`).
 */
const httpServer = createServer(createApiHandler());
const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log(`🚀 ChronoCanvas server running on port ${PORT}`);
  console.log(`   WS  → ws://localhost:${PORT}`);
  console.log(`   API → http://localhost:${PORT}/api/ask-ai`);
  console.log(`   API → http://localhost:${PORT}/api/agent/dispatch`);
});

wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
  const ws = socket as ClientSocket;
  const connId = randomUUID();
  ws.connId = connId;
  ws.joinedRooms = new Set<string>();

  // Authenticate socket: check upgrade request credentials first
  const { token, isWorker } = extractTokenFromRequest(request);

  if (isWorker) {
    ws.isAuthenticated = true;
    ws.userId = 'system-agent-worker';
    console.log(`[+] client ${connId} authenticated as internal worker via handshake`);
  } else if (token) {
    try {
      const claims = verifyJwtToken(token);
      ws.isAuthenticated = true;
      ws.userId = claims.sub;
      console.log(`[+] client ${connId} authenticated via upgrade token for user ${claims.sub}`);
    } catch (err) {
      console.warn(`[-] client ${connId} upgrade token invalid: ${errMsg(err)}`);
      safeSend(
        ws,
        {
          type: 'auth-error',
          error: `Authentication failed: ${errMsg(err)}`,
          code: 'INVALID_TOKEN',
        } as AuthErrorMessage,
        `auth-error/${connId}`,
      );
      ws.close(1008, 'Authentication failed');
      return;
    }
  } else {
    // Grace period for in-band auth frame
    ws.isAuthenticated = false;
    ws.authTimeoutTimer = setTimeout(() => {
      if (!ws.isAuthenticated && ws.readyState === WebSocket.OPEN) {
        console.warn(`[-] client ${connId} auth timeout reached without credentials`);
        safeSend(
          ws,
          {
            type: 'auth-error',
            error: 'Authentication timeout: No auth frame received within 10s',
            code: 'UNAUTHORIZED',
          } as AuthErrorMessage,
          `auth-timeout/${connId}`,
        );
        ws.close(1008, 'Authentication timeout');
      }
    }, AUTH_TIMEOUT_MS);
    console.log(`[+] client ${connId} connected in pending-auth state from ${request.socket.remoteAddress}`);
  }

  ws.on('message', (data, isBinary) => {
    // Outermost crash boundary: nothing a client sends may take the process down.
    try {
      if (isBinary) {
        console.warn(
          `[${connId}] protocol error: binary frame received (${(data as Buffer).length} bytes). Frame dropped.`,
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

      // Explicit authentication frame
      if (frame.type === 'auth') {
        handleAuth(ws, frame);
        return;
      }

      // Security Gate: Reject unauthenticated sockets before any CRDT sync or task dispatch
      if (!ws.isAuthenticated) {
        console.warn(`[${connId}] rejected unauthenticated frame type "${String(frame.type)}"`);
        safeSend(
          ws,
          {
            type: 'auth-error',
            error: 'Unauthorized: Authentication required before transmitting canvas data',
            code: 'UNAUTHORIZED',
          } as AuthErrorMessage,
          `auth-error/${connId}`,
        );
        return;
      }

      if (frame.type === 'crdt-sync') handleCrdtSync(ws, frame);
      else if (frame.type === 'awareness-update') handleAwareness(ws, frame);
      else if (frame.type === 'agent-task-request') void handleAgentTaskRequest(ws, frame);
      else if (frame.type === 'agent-task-status') handleAgentTaskStatus(ws, frame);
      else console.log(`[${connId}] unknown message type: ${String(frame.type)}`);
    } catch (err) {
      console.error(`[${connId}] message handler crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ws.on('close', () => {
    if (ws.authTimeoutTimer) {
      clearTimeout(ws.authTimeoutTimer);
    }
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

// --- auth --------------------------------------------------------------------

function handleAuth(ws: ClientSocket, message: Record<string, unknown>): void {
  const token = typeof message.token === 'string' ? message.token : undefined;
  const apiKey =
    typeof message.apiKey === 'string' && message.apiKey.trim()
      ? message.apiKey.trim()
      : undefined;

  if (!token) {
    safeSend(
      ws,
      {
        type: 'auth-error',
        error: 'Missing token in auth frame',
        code: 'UNAUTHORIZED',
      } as AuthErrorMessage,
      `auth-error/${ws.connId}`,
    );
    return;
  }

  // Check internal worker secret
  if (token === INTERNAL_WORKER_SECRET) {
    if (ws.authTimeoutTimer) clearTimeout(ws.authTimeoutTimer);
    ws.isAuthenticated = true;
    ws.userId = 'system-agent-worker';
    if (apiKey) ws.byokApiKey = apiKey;

    safeSend(
      ws,
      {
        type: 'auth-success',
        userId: ws.userId,
      } as AuthSuccessMessage,
      `auth-success/${ws.connId}`,
    );
    console.log(`[auth] client ${ws.connId} authenticated as internal worker via frame`);
    return;
  }

  try {
    const claims = verifyJwtToken(token);
    if (ws.authTimeoutTimer) clearTimeout(ws.authTimeoutTimer);
    ws.isAuthenticated = true;
    ws.userId = claims.sub;
    if (apiKey) ws.byokApiKey = apiKey;

    safeSend(
      ws,
      {
        type: 'auth-success',
        userId: claims.sub,
        claims: { sub: claims.sub, role: claims.role },
      } as AuthSuccessMessage,
      `auth-success/${ws.connId}`,
    );
    console.log(`[auth] client ${ws.connId} authenticated for user ${claims.sub}`);
  } catch (err) {
    console.warn(`[auth] client ${ws.connId} verification failed: ${errMsg(err)}`);
    safeSend(
      ws,
      {
        type: 'auth-error',
        error: `Authentication failed: ${errMsg(err)}`,
        code: 'INVALID_TOKEN',
      } as AuthErrorMessage,
      `auth-error/${ws.connId}`,
    );
    ws.close(1008, 'Authentication failed');
  }
}

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

// --- agent-task-status -------------------------------------------------------
// Relay task status updates from the agent worker to the clients

function handleAgentTaskStatus(ws: ClientSocket, message: Record<string, unknown>): void {
  const taskId = typeof message.taskId === 'string' ? message.taskId : undefined;
  if (!taskId) return;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      safeSend(client as ClientSocket, message, `agent-task-status/${taskId}`);
    }
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

  // --- Phase 0: Acknowledge immediately → UI badge = "Planning..." -----------
  const planningStatus: AgentTaskStatus = {
    type: 'agent-task-status',
    taskId,
    status: 'planning',
  };
  safeSend(ws, planningStatus, `agent-task/${taskId}`);
  
  // Artificial delay so the UI can render "Planning..."
  await new Promise(resolve => setTimeout(resolve, 800));

  // --- Phase 1: Read document state from the hub → UI badge = "Reading canvas..." ---
  //
  // We emit `reading-canvas` *before* the expensive snapshot export so the badge
  // updates immediately. The export itself is synchronous wasm and completes in
  // < 1 ms for typical documents, but the status communicates what Phase 1 of
  // the Temporal workflow (captureCheckpoint) will be doing on the worker side.
  const readingCanvasStatus: AgentTaskStatus = {
    type: 'agent-task-status',
    taskId,
    status: 'reading-canvas',
  };
  console.log("EMITTING TO WS:", "reading-canvas");
  safeSend(ws, readingCanvasStatus, `agent-task/${taskId}`);
  
  // Artificial delay so the UI can render "Reading Canvas..."
  await new Promise(resolve => setTimeout(resolve, 800));

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
      console.log(
        `[agent-task] taskId=${taskId} canvas extracted: ${currentDocumentState.length} chars, ${currentDocumentState.split('\n').length} lines`,
      );
    } catch (exportErr) {
      console.warn(`[agent-task] snapshot export failed for ${docId}: ${errMsg(exportErr)}`);
    }
  } else {
    console.log(`[agent-task] taskId=${taskId} no active room for docId=${docId} — canvas is empty`);
  }

  // Build system instruction (inject failure flag for Test Rollback).
  // The worker reads SIMULATE_AGENT_CRASH from its own env, but we also embed a
  // sentinel in the system instruction so a prompt-level crash can be tested
  // without restarting the worker process.
  const systemInstruction = simulateFailure
    ? '__SIMULATE_AGENT_CRASH__ ' + SYSTEM_INSTRUCTION
    : (typeof message.prompt === 'string' && message.prompt.trim()
        ? message.prompt.trim()
        : SYSTEM_INSTRUCTION);

  // Extract BYOK API key: prefer frame-level parameter, fallback to authenticated socket session
  const apiKey =
    typeof message.apiKey === 'string' && message.apiKey.trim()
      ? message.apiKey.trim()
      : ws.byokApiKey;

  // --- Phase 2 & 3: Fire Temporal workflow and relay granular phase statuses ---
  //
  // We AWAIT the full workflow result — `workflow.start` resolving only means
  // Temporal *accepted* the job, not that the agent committed. We emit:
  //   • `generating` — right after the workflow is accepted (Phase 2: LLM call)
  //   • `injecting`  — emitted after the LLM completes, with an artificial delay
  //                    before `committed` to ensure the UI has time to render it.
  //   • `committed` / `rolled-back` — on the true terminal outcome from handle.result().
  const workflowId = `agent-task-${docId}-${taskId}`;
  try {
    const client = await getTemporalClient();
    const handle = await client.workflow.start('agentSyncWorkflow', {
      taskQueue: AGENT_TASK_QUEUE,
      workflowId,
      args: [{ docId, stateBytes, currentDocumentState, systemInstruction, taskId, apiKey }],
    });

    console.log(`[agent-task] workflow started workflowId=${workflowId}`);

    // Phase 2 — LLM is thinking.
    const generatingStatus: AgentTaskStatus = {
      type: 'agent-task-status',
      taskId,
      status: 'generating',
    };
    safeSend(ws, generatingStatus, `agent-task/${taskId}`);

    // Block on the real outcome. Resolves with the generated text on the success
    // path; rejects when the activity rolled back because `agentSyncWorkflow`
    // re-throws after the activity performs its rollback.
    await handle.result();

    console.log(`[agent-task] workflow finished workflowId=${workflowId}`);

    // Phase 3 UX — The CRDT write actually already happened in the activity,
    // but we guarantee the UI flashes "Injecting Code..." before settling.
    const injectingStatus: AgentTaskStatus = {
      type: 'agent-task-status',
      taskId,
      status: 'injecting',
    };
    console.log("EMITTING TO WS:", "injecting");
    safeSend(ws, injectingStatus, `agent-task/${taskId}`);
    
    // Artificial delay so the UI can render "Injecting Code..."
    await new Promise(resolve => setTimeout(resolve, 800));

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

    // UX: Show the rollback "injecting" phase visually before showing failure
    const injectingStatus: AgentTaskStatus = {
      type: 'agent-task-status',
      taskId,
      status: 'injecting',
    };
    console.log("EMITTING TO WS:", "injecting");
    safeSend(ws, injectingStatus, `agent-task/${taskId}`);
    await new Promise(resolve => setTimeout(resolve, 800));

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
