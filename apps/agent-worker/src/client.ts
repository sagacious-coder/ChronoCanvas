/**
 * ChronoCanvas agent-worker — Temporal Client trigger script (Day 5).
 *
 * Run this with tsx to kick off a `checkpointWorkflow` against a locally
 * running Temporal server:
 *
 *   cd apps/agent-worker
 *   npx tsx src/client.ts
 *
 * The script starts the workflow, waits for it to complete, and pretty-prints
 * the resulting LoroCheckpoint JSON to stdout.
 *
 * ⚠️  The Temporal worker (`src/worker.ts`) must already be running and polling
 * the `chrono-agent` task queue before you execute this script, otherwise the
 * workflow will sit in RUNNING until a worker comes online.
 *
 * Environment variables (all optional):
 *   TEMPORAL_ADDRESS    — Temporal server gRPC address (default: localhost:7233)
 *   TEMPORAL_NAMESPACE  — Temporal namespace          (default: default)
 *   TEMPORAL_TASK_QUEUE — Task queue to schedule on   (default: chrono-agent)
 *   CHRONO_DOC_ID       — Document id in the checkpoint (default: demo-doc)
 */

import { Connection, Client } from '@temporalio/client';

// ---- Import the workflow by its EXACT exported function name ----------------
//
// The exported name in workflows.ts is `checkpointWorkflow`.
// Passing the function reference (not a string) is the type-safe path:
// Temporal derives the workflow type name from `checkpointWorkflow.name`
// at runtime — no "expected a function, got undefined" TypeError.
import { checkpointWorkflow } from './workflows';
import type { CheckpointWorkflowInput } from './workflows';
import type { LoroCheckpoint } from './types';

// ---- Config -----------------------------------------------------------------

const TEMPORAL_ADDRESS   = process.env.TEMPORAL_ADDRESS    ?? 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE  ?? 'default';
const TASK_QUEUE         = process.env.TEMPORAL_TASK_QUEUE ?? 'chrono-agent';
const DOC_ID             = process.env.CHRONO_DOC_ID       ?? 'demo-doc';

// ---- Main -------------------------------------------------------------------

async function run(): Promise<void> {
  console.log(`[client] connecting to Temporal at ${TEMPORAL_ADDRESS} (namespace: ${TEMPORAL_NAMESPACE})`);

  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client     = new Client({ connection, namespace: TEMPORAL_NAMESPACE });

  // Unique ID per run so re-running the script never collides with a prior
  // execution that is still in a terminal state.
  const workflowId = `checkpoint-${DOC_ID}-${Date.now()}`;

  // `stateBytes: []` → captures the frontier of an empty LoroDoc (frontier = []).
  // Replace with Array.from(doc.export({ mode: 'snapshot' })) for real state.
  const input: CheckpointWorkflowInput = {
    docId: DOC_ID,
    stateBytes: [],
  };

  console.log(`[client] starting workflow  id=${workflowId}  taskQueue=${TASK_QUEUE}`);
  console.log(`[client] input:`, input);

  const handle = await client.workflow.start(checkpointWorkflow, {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[client] workflow started — waiting for result…`);

  const resultJson = await handle.result();
  const checkpoint: LoroCheckpoint = JSON.parse(resultJson);

  console.log('\n✅ Checkpoint recorded:');
  console.log(JSON.stringify(checkpoint, null, 2));
  console.log(`\n[client] workflowId : ${workflowId}`);
  console.log(`[client] runId      : ${handle.firstExecutionRunId}`);

  await connection.close();
}

run().catch((err: unknown) => {
  console.error('[client] fatal error:', err);
  process.exit(1);
});