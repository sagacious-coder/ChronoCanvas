/**
 * ChronoCanvas — Agent API service (frontend).
 *
 * Thin wrapper around the `POST /api/ask-ai` endpoint exposed by the server.
 * Handles JWT Bearer authorization and BYOK custom API key routing headers.
 */

import type { AskAiRequest, AskAiResponse, ByokConfig } from '../types/shared';

// `import.meta.env` is injected by Vite at build time. Cast through unknown
// so this compiles without requiring `vite/client` in tsconfig lib.
const _env = (import.meta as unknown as { env?: Record<string, string> }).env;
const API_BASE = _env?.['VITE_API_BASE'] ?? 'http://localhost:3001';

/**
 * Trigger the `agentSyncWorkflow` Temporal workflow via the backend HTTP API.
 *
 * @param docId      - The Loro document room id (must match the active WS room).
 * @param stateBytes - Current Loro snapshot as a plain number array.
 * @param authToken  - Optional JWT Bearer authorization token.
 * @param byokConfig - Optional Bring-Your-Own-Key provider and model configuration.
 * @returns The `AskAiResponse` containing the `workflowId` that was started.
 * @throws  On network error or non-2xx response.
 */
export async function askAi(
  docId: string,
  stateBytes: number[],
  authToken?: string,
  byokConfig?: ByokConfig
): Promise<AskAiResponse> {
  const body: AskAiRequest = {
    docId,
    stateBytes,
    authToken,
    byokConfig,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  if (byokConfig?.enabled && byokConfig.apiKey) {
    headers['X-BYOK-Provider'] = byokConfig.provider;
    headers['X-BYOK-Model'] = byokConfig.model;
  }

  const res = await fetch(`${API_BASE}/api/ask-ai`, {
    method: 'POST',
    headers,
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
