/**
 * ChronoCanvas — HTTP API endpoints.
 *
 * This module creates a minimal `node:http` server that handles REST routes
 * alongside the existing WebSocket server.  It deliberately avoids Express
 * to keep the server dependency-light.
 *
 * ## Why a separate HTTP server?
 *
 * The `ws` package attaches to an existing `http.Server` via the `server`
 * option.  We create one shared `http.Server`, hand it to both the
 * `WebSocketServer` (in `index.ts`) and this module's request handler, so a
 * single port (default 3001) serves both WS upgrades and REST calls.
 *
 * ## Endpoints
 *
 *   POST /api/ask-ai
 *   Content-Type: application/json
 *   Body: { docId: string; stateBytes: number[] }   // AskAiRequest
 *   → 200: { workflowId: string; submittedAt: string }
 *   The frontend sends its own snapshot bytes; the server decodes them to text
 *   for the `currentDocumentState` workflow arg.
 *
 *   POST /api/agent/dispatch
 *   Content-Type: application/json
 *   Body: { docId: string; instruction?: string }
 *   → 200: { workflowId: string; submittedAt: string }
 *   Authoritative route: the server extracts the current Loro room text from
 *   the live hub (the ground truth), not from a client snapshot.
 *
 * Both handlers fire-and-forget the Temporal workflow — the agent worker
 * broadcasts the CRDT update back through the WebSocket fan-out once the
 * LLM responds, so the frontend needs no polling.
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { Connection, Client } from '@temporalio/client';
import { LoroDoc } from 'loro-crdt';
import type { AskAiRequest, AskAiResponse } from '@chronocanvas/shared-types';

// ---- Config -----------------------------------------------------------------

const TEMPORAL_ADDRESS   = process.env.TEMPORAL_ADDRESS   ?? 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';
const AGENT_TASK_QUEUE   = process.env.AGENT_TASK_QUEUE   ?? 'agent-queue';

/** Default instruction when none is specified by the caller. */
const DEFAULT_SYSTEM_INSTRUCTION =
  'Read the canvas and suggest a coherent continuation or improvement.';

// Deferred require so this module can be imported without the hub being fully
// initialised — it is called at request time, not import time.
import { peekRoom, errMsg } from './hub.js';

// ---- Temporal client (lazy singleton) ---------------------------------------

let _temporalClient: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (_temporalClient) return _temporalClient;
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  _temporalClient = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
  return _temporalClient;
}

// ---- Body parsing -----------------------------------------------------------

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ---- Response helpers -------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

// ---- Route handler ----------------------------------------------------------

async function handleAskAi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Could not parse request body as JSON.' });
    return;
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as Record<string, unknown>).docId !== 'string' ||
    !Array.isArray((body as Record<string, unknown>).stateBytes)
  ) {
    sendJson(res, 400, { error: 'Body must be { docId: string; stateBytes: number[] }.' });
    return;
  }

  const { docId, stateBytes, apiKey } = body as AskAiRequest;

  // --- Extract current document text from the client's snapshot bytes ---------
  // The client sends its own Loro snapshot.  We decode it into a headless doc
  // to pull the plain text for the `currentDocumentState` workflow arg.  The
  // hub's authoritative doc would be preferable, but /api/ask-ai is a pull
  // endpoint and the client snapshot is already there — use it.
  let currentDocumentState = '';
  if (stateBytes.length > 0) {
    try {
      const tempDoc = new LoroDoc();
      tempDoc.import(new Uint8Array(stateBytes));
      currentDocumentState = tempDoc.getText('codemirror').toString();
    } catch (decodeErr) {
      console.warn(`[api/ask-ai] could not decode stateBytes for docId=${docId}: ${errMsg(decodeErr)}`);
      // Continue without text — the LLM will operate on an empty canvas context.
    }
  }

  let client: Client;
  try {
    client = await getTemporalClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[api/ask-ai] Temporal connection failed: ${msg}`);
    sendJson(res, 503, { error: `Could not connect to Temporal: ${msg}` });
    return;
  }

  const workflowId = `agent-sync-${docId}-${Date.now()}`;

  try {
    // Fire-and-forget: the workflow result arrives via WebSocket fan-out, not
    // via HTTP response.  We only need the workflowId for the client to track
    // progress in the Temporal UI if needed.
    await client.workflow.start('agentSyncWorkflow', {
      taskQueue: AGENT_TASK_QUEUE,
      workflowId,
      args: [{
        docId,
        stateBytes,
        currentDocumentState,
        systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
        apiKey,
      }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[api/ask-ai] Failed to start workflow: ${msg}`);
    sendJson(res, 500, { error: `Failed to start agent workflow: ${msg}` });
    return;
  }

  console.log(`[api/ask-ai] started workflowId=${workflowId} for docId=${docId}`);

  const responseBody: AskAiResponse = {
    workflowId,
    submittedAt: new Date().toISOString(),
  };
  sendJson(res, 200, responseBody);
}

// ---- /api/agent/dispatch handler --------------------------------------------

/**
 * Authoritative dispatch endpoint.
 *
 * Unlike `/api/ask-ai` (which relies on the client's own snapshot bytes),
 * this route pulls the **current Loro document text directly from the hub**
 * — the server's authoritative source of truth.  This guarantees the LLM
 * always sees the latest committed state, not a potentially stale client
 * snapshot from before a concurrent edit landed.
 *
 * Request body: `{ docId: string; instruction?: string }`
 * Response:     `{ workflowId: string; submittedAt: string }`
 */
async function handleAgentDispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Could not parse request body as JSON.' });
    return;
  }

  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).docId !== 'string') {
    sendJson(res, 400, { error: 'Body must be { docId: string; instruction?: string }.' });
    return;
  }

  const { docId, instruction, apiKey } = body as { docId: string; instruction?: string; apiKey?: string };
  const systemInstruction =
    typeof instruction === 'string' && instruction.trim()
      ? instruction.trim()
      : DEFAULT_SYSTEM_INSTRUCTION;

  // --- Pull authoritative document state from the hub -------------------------
  // `peekRoom` — never conjure a room that was never joined.  If no room exists
  // for this docId the document is blank and we proceed with an empty string.
  let stateBytes: number[] = [];
  let currentDocumentState = '';
  const room = peekRoom(docId);
  if (room) {
    try {
      const snap = room.doc.export({ mode: 'snapshot' });
      stateBytes = Array.from(snap);
      // Extract the canonical text container that loro-codemirror writes to.
      currentDocumentState = room.doc.getText('codemirror').toString();
    } catch (exportErr) {
      console.warn(
        `[api/agent/dispatch] snapshot export failed for docId=${docId}: ${errMsg(exportErr)}`,
      );
      // Fall through with empty bytes/text — the LLM will operate on a blank canvas.
    }
  } else {
    console.log(`[api/agent/dispatch] no active room for docId=${docId} — treating canvas as empty`);
  }

  let client: Client;
  try {
    client = await getTemporalClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[api/agent/dispatch] Temporal connection failed: ${msg}`);
    sendJson(res, 503, { error: `Could not connect to Temporal: ${msg}` });
    return;
  }

  const workflowId = `agent-dispatch-${docId}-${Date.now()}`;

  try {
    await client.workflow.start('agentSyncWorkflow', {
      taskQueue: AGENT_TASK_QUEUE,
      workflowId,
      args: [{ docId, stateBytes, currentDocumentState, systemInstruction, apiKey }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[api/agent/dispatch] Failed to start workflow: ${msg}`);
    sendJson(res, 500, { error: `Failed to start agent workflow: ${msg}` });
    return;
  }

  console.log(
    `[api/agent/dispatch] started workflowId=${workflowId} for docId=${docId} ` +
    `currentDocumentState.length=${currentDocumentState.length}`,
  );

  const responseBody: AskAiResponse = { workflowId, submittedAt: new Date().toISOString() };
  sendJson(res, 200, responseBody);
}

// ---- Main request dispatcher ------------------------------------------------

/**
 * Attach this handler to the shared `http.Server` in `index.ts`.
 *
 * Routes handled:
 *   OPTIONS *                   — CORS preflight (browser fetch needs this)
 *   POST /api/ask-ai            — trigger agentSyncWorkflow (client supplies snapshot)
 *   POST /api/agent/dispatch    — trigger agentSyncWorkflow (server reads hub state)
 *   anything else               — 404
 *
 * WebSocket upgrade requests never reach this handler: the `ws` library
 * intercepts them before the `request` event fires.
 */
export function createApiHandler() {
  return async function apiHandler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/ask-ai') {
      await handleAskAi(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/agent/dispatch') {
      await handleAgentDispatch(req, res);
      return;
    }

    sendJson(res, 404, { error: `No route for ${req.method} ${req.url}` });
  };
}
