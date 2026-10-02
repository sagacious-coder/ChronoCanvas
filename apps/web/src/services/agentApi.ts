/**
 * ChronoCanvas — Agent API service (frontend).
 *
 * Thin wrapper around the `POST /api/ask-ai` endpoint exposed by the server.
 * Keeps all fetch logic in one place so components stay free of URL strings
 * and response-parsing details.
 */

import type { AskAiRequest, AskAiResponse } from '@chronocanvas/shared-types';

// `import.meta.env` is injected by Vite at build time.  Cast through unknown
// so this compiles without requiring `vite/client` in tsconfig lib.
const _env = (import.meta as unknown as { env?: Record<string, string> }).env;
const API_BASE = _env?.['VITE_API_BASE'] ?? 'http://localhost:3001';

/**
 * Trigger the `agentSyncWorkflow` Temporal workflow via the backend HTTP API.
 *
 * The workflow runs asynchronously — the result (LLM-generated text appended
 * to the canvas) arrives via the existing WebSocket fan-out, not via this
 * response.  The returned `workflowId` can be used to inspect progress in the
 * Temporal Web UI.
 *
 * @param docId      - The Loro document room id (must match the active WS room).
 * @param stateBytes - Current Loro snapshot as a plain number array.
 *                     Produce with `Array.from(doc.export({ mode: 'snapshot' }))`.
 * @returns The `AskAiResponse` containing the `workflowId` that was started.
 * @throws  On network error or non-2xx response (message includes server error detail).
 */
export async function askAi(docId: string, stateBytes: number[]): Promise<AskAiResponse> {
  const body: AskAiRequest = { docId, stateBytes };

  const res = await fetch(`${API_BASE}/api/ask-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) detail = err.error;
    } catch {
      // ignore parse failure — use status code
    }
    throw new Error(`[askAi] ${detail}`);
  }

  return res.json() as Promise<AskAiResponse>;
}
