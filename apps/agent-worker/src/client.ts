/**
 * ChronoCanvas agent-worker — Temporal Client trigger script (Day 6).
 *
 * Starts an `agentSyncWorkflow` run against the local Temporal server:
 *
 *   cd apps/agent-worker
 *   npx tsx src/client.ts
 *
 * The workflow calls the LLM via OpenRouter, appends the generated text to the
 * Loro canvas, broadcasts the incremental CRDT update to the backend, and
 * returns the raw generated text which is logged here.
 *
 * ⚠️  Prerequisites before running:
 *   1. Temporal dev server running  →  `npx @temporalio/cli server start-dev`
 *   2. Worker polling               →  `npx tsx src/worker.ts`  (separate terminal)
 *   3. OPENROUTER_API_KEY set       →  in `.env` or the shell environment
 *
 * Environment variables (all optional, with defaults):
 *   TEMPORAL_ADDRESS    — Temporal gRPC address  (default: localhost:7233)
 *   TEMPORAL_NAMESPACE  — Temporal namespace     (default: default)
 */

import { Connection, Client } from '@temporalio/client';

// Import by the exact exported function name from workflows.ts.
// Temporal derives the workflow type string from `agentSyncWorkflow.name`
// at runtime — passing the function reference is the only type-safe path.
import { agentSyncWorkflow } from './workflows';
import type { AgentSyncWorkflowInput } from './workflows';

// ---- Config -----------------------------------------------------------------

const TEMPORAL_ADDRESS   = process.env.TEMPORAL_ADDRESS   ?? 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';

// ---- Main -------------------------------------------------------------------

async function run(): Promise<void> {
  console.log(`[client] connecting to Temporal at ${TEMPORAL_ADDRESS}`);

  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client     = new Client({ connection, namespace: TEMPORAL_NAMESPACE });

  const workflowId = `agent-sync-${Date.now()}`;

  const input: AgentSyncWorkflowInput = {
    docId: 'chrono-canvas-default',
    stateBytes: [],
    currentDocumentState: '',
    systemInstruction:
      'Read the canvas text and append a short, coherent 1-sentence continuation.',
  };

  console.log(`[client] ▶  starting  workflowId=${workflowId}  taskQueue=agent-queue`);
  console.log(`[client]    input →`, input);

  const handle = await client.workflow.start(agentSyncWorkflow, {
    taskQueue: 'agent-queue',
    workflowId,
    args: [input],
  });

  console.log(`[client] ⏳  workflow running — waiting for result…`);

  const generatedText = await handle.result();

  console.log('\n✅  Agent response injected into canvas:');
  console.log('─'.repeat(60));
  console.log(generatedText);
  console.log('─'.repeat(60));
  console.log(`\n[client] workflowId : ${workflowId}`);
  console.log(`[client] runId      : ${handle.firstExecutionRunId}`);

  await connection.close();
}

run().catch((err: unknown) => {
  console.error('[client] fatal error:', err);
  process.exit(1);
});
