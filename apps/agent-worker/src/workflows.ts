/**
 * ChronoCanvas agent-worker — Temporal Workflows.
 *
 * **Temporal workflow sandbox rules** that affect this file:
 *
 *   1. No `require` / `import` of Node.js built-ins or third-party packages
 *      except `@temporalio/workflow`.  All I/O and CRDT calls go in activities.
 *   2. Code here MUST be deterministic; `Date.now()`, `Math.random()`, and
 *      `setTimeout` are replaced by Temporal's deterministic equivalents.
 *   3. Activity stubs are created from a type-only import of the activity
 *      module; the runtime never evaluates the actual activity implementations.
 *
 * Workflow surface:
 *   - `checkpointWorkflow`  — reads the Loro frontier and returns a checkpoint.
 *   - `agentSyncWorkflow`   — calls the LLM, appends its response to the canvas,
 *                             broadcasts the incremental CRDT update.
 */

import {
  proxyActivities,
  type ActivityOptions,
} from '@temporalio/workflow';

// Type-only import: Temporal's bundler strips the implementation at runtime so
// we stay inside the sandbox.  The generic parameter is the activity module's
// export shape — proxyActivities returns stubs with identical signatures.
import type * as activitiesModule from './activities';

// ---- Activity options -------------------------------------------------------

/**
 * Options for fast, idempotent activities (Loro import, frontier read).
 */
const defaultActivityOptions: ActivityOptions = {
  startToCloseTimeout: '30 seconds',
  heartbeatTimeout: '10 seconds',
};

/**
 * Options for the LLM generation activity.
 *
 * LLM calls via OpenRouter can take significantly longer than a local wasm
 * operation.  `startToCloseTimeout` is generous to accommodate cold-start
 * latency on free-tier models; `heartbeatTimeout` keeps Temporal informed
 * during the blocking HTTP call so it can detect a hung worker.
 */
const llmActivityOptions: ActivityOptions = {
  startToCloseTimeout: '3 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    // Retrying a generation that timed out can produce duplicate canvas
    // content.  Cap at 2 attempts so a transient error is recovered, but
    // an infinite retry loop cannot spam the canvas.
    maximumAttempts: 2,
  },
};

// ---- Activity proxies -------------------------------------------------------

/**
 * Typed stubs for every activity exported from `./activities`.
 * Add new activities to that module; they appear here automatically.
 */
const { captureCheckpoint, generateAndInjectResponse } =
  proxyActivities<typeof activitiesModule>(defaultActivityOptions);

// For the LLM activity we need a separate proxy so it carries its own options.
const { generateAndInjectResponse: generateAndInjectResponseLLM } =
  proxyActivities<typeof activitiesModule>(llmActivityOptions);

// ---- Workflow definitions ---------------------------------------------------

/**
 * Input contract for {@link checkpointWorkflow}.
 *
 * `stateBytes` is carried as a plain number array because Uint8Array is not
 * JSON-serialisable across a Temporal workflow input boundary.  The activity
 * reconstructs the typed array before handing it to Loro.
 */
export interface CheckpointWorkflowInput {
  /** Stable document identifier recorded in the checkpoint. */
  docId: string;
  /**
   * The Loro document state to inspect, serialised as a plain number array.
   * Pass `[]` to capture the frontier of an empty document.
   *
   * To convert a `Uint8Array` from the Loro API:
   * ```ts
   * const stateBytes = Array.from(doc.export({ mode: 'snapshot' }));
   * ```
   */
  stateBytes: number[];
}

/**
 * `checkpointWorkflow` — reads the Loro frontier and records it as a durable
 * Temporal history event.
 *
 * Workflow ID convention: `"checkpoint-{docId}-{timestamp}"`
 */
export async function checkpointWorkflow(
  input: CheckpointWorkflowInput,
): Promise<string> {
  const checkpointJson = await captureCheckpoint(input.docId, input.stateBytes);
  return checkpointJson;
}

// -----------------------------------------------------------------------------

/**
 * Input contract for {@link agentSyncWorkflow}.
 */
export interface AgentSyncWorkflowInput {
  /** Stable document identifier — stored on the AgentSyncEnvelope. */
  docId: string;
  /**
   * Current Loro canvas state, serialised as a plain number array.
   * Pass `[]` when triggering against an empty document.
   *
   * ```ts
   * const stateBytes = Array.from(doc.export({ mode: 'snapshot' }));
   * ```
   */
  stateBytes: number[];
  /**
   * System-role instruction sent to the LLM.
   *
   * @default 'Read the provided canvas text and write a short, creative
   *           1-sentence continuation.'
   */
  systemInstruction?: string;
}

/** Default system instruction when none is provided by the caller. */
const DEFAULT_INSTRUCTION =
  'Read the provided canvas text and write a short, creative 1-sentence continuation.';

/**
 * `agentSyncWorkflow` — the main agent write workflow.
 *
 * Calls the LLM via OpenRouter, appends its response to the Loro
 * `'chrono-canvas-default'` text container, and broadcasts the incremental
 * CRDT update to the backend WebSocket server so all connected clients see
 * the agent's contribution with `origin: 'agent'`.
 *
 * Returns the raw LLM-generated text for inspection in Temporal history.
 *
 * Workflow ID convention: `"agent-sync-{docId}-{timestamp}"`
 *
 * @example
 * ```ts
 * const handle = await client.workflow.start(agentSyncWorkflow, {
 *   taskQueue: 'chrono-agent',
 *   workflowId: `agent-sync-${docId}-${Date.now()}`,
 *   args: [{ docId, stateBytes: Array.from(snapshotBytes) }],
 * });
 * const generatedText = await handle.result();
 * ```
 */
export async function agentSyncWorkflow(
  input: AgentSyncWorkflowInput,
): Promise<string> {
  const instruction = input.systemInstruction ?? DEFAULT_INSTRUCTION;

  // Use the LLM-specific proxy (longer timeout, capped retries).
  const generatedText = await generateAndInjectResponseLLM(
    input.docId,
    input.stateBytes,
    instruction,
  );

  return generatedText;
}
