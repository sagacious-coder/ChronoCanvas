/**
 * ChronoCanvas — `/api/ask-ai` HTTP endpoint.
 *
 * This module creates a minimal `node:http` server that handles a single POST
 * route alongside the existing WebSocket server.  It deliberately avoids
 * Express to keep the server dependency-light: the routing logic is four lines
 * and the rest is JSON body parsing + Temporal client setup.
 *
 * ## Why a separate HTTP server?
 *
 * The `ws` package attaches to an existing `http.Server` via the `server`
 * option.  We create one shared `http.Server`, hand it to both the
 * `WebSocketServer` (in `index.ts`) and this module's request handler, so a
 * single port (default 3001) serves both WS upgrades and REST calls.
 *
 * ## Request / Response
 *
 *   POST /api/ask-ai
 *   Content-Type: application/json
 *   Body: { docId: string; stateBytes: number[] }   // AskAiRequest
 *
 *   200 OK
 *   { workflowId: string; submittedAt: string }     // AskAiResponse
 *
 * The handler fires-and-forgets the Temporal workflow — it returns the
 * workflowId immediately and does NOT await the result.  The agent worker
 * will push the CRDT update back through the existing WebSocket fan-out once
 * the LLM responds, so the frontend needs no polling.
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { Connection, Client } from '@temporalio/client';
import type { AskAiRequest, AskAiResponse } from '@chronocanvas/shared-types';

// ---- Config -----------------------------------------------------------------

const TEMPORAL_ADDRESS   = process.env.TEMPORAL_ADDRESS   ?? 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';
const AGENT_TASK_QUEUE   = process.env.AGENT_TASK_QUEUE   ?? 'agent-queue';

/** System instruction the server sends to every agentSyncWorkflow invocation. */
const SYSTEM_INSTRUCTION =
  'Read the canvas text and append a short, coherent 1-sentence continuation.';

// ---- Temporal client (lazy singleton) ---------------------------------------

let _temporalClient: Client | null = null;

async function getTemporalClient(): Promise<Client> {
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

  const { docId, stateBytes } = body as AskAiRequest;

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
      args: [{ docId, stateBytes, systemInstruction: SYSTEM_INSTRUCTION }],
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

// ---- Main request dispatcher ------------------------------------------------

/**
 * Attach this handler to the shared `http.Server` in `index.ts`.
 *
 * Routes handled:
 *   OPTIONS *              — CORS preflight (browser fetch needs this)
 *   POST /api/ask-ai       — trigger agentSyncWorkflow
 *   anything else          — 404
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

    sendJson(res, 404, { error: `No route for ${req.method} ${req.url}` });
  };
}
