/**
 * ChronoCanvas agent-worker — Temporal Workflows (Day 7: Checkpoint Rollback).
 *
 * **Temporal workflow sandbox rules** that affect this file:
 *
 *   1. No `require` / `import` of Node.js built-ins or third-party packages
 *      except `@temporalio/workflow`.  All I/O and CRDT calls go in activities.
 *   2. Code here MUST be deterministic; `Date.now()`, `Math.random()`, and
 *      `setTimeout` are replaced by Temporal's deterministic equivalents.
 *   3. Activity stubs are created from a type-only import of the activity
 *      module; the runtime never evaluates the actual activity implementations.
 *   4. **All Loro mutations and `doc.checkout()` live in activities.ts** —
 *      never in this file.  The workflow's only job is to sequence the two
 *      activities and propagate errors cleanly into Temporal history.
 *
 * Workflow surface:
 *   - `checkpointWorkflow`  — reads the Loro frontier and returns a checkpoint.
 *   - `agentSyncWorkflow`   — (Day 7) two-phase protocol:
 *       Phase 1 — `captureCheckpoint`: snapshot the current CRDT frontier.
 *       Phase 2 — `generateAndInjectResponse`: call the LLM, write the result
 *                  to the Loro canvas, broadcast the delta.  On any failure the
 *                  activity itself calls `doc.checkout(savedFrontiers)` and
 *                  broadcasts the reverted state before re-throwing, so Temporal
 *                  records the failure durably without any human edits being lost.
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
 * `agentSyncWorkflow` — Day 7 two-phase agent write with checkpoint rollback.
 *
 * **Phase 1 — Checkpoint** (`captureCheckpoint`):
 *   Reads the current Loro frontier from the supplied `stateBytes` and records
 *   it as a durable Temporal history event.  The result is a JSON string
 *   encoding `{ docId, capturedAt, frontiers[] }` that the next phase uses as
 *   the rollback target if anything goes wrong.
 *
 * **Phase 2 — Generate & Inject** (`generateAndInjectResponse`):
 *   Calls the LLM via OpenRouter, appends its response to the Loro
 *   `'chrono-canvas-default'` text container, and broadcasts the incremental
 *   CRDT update to the backend WebSocket server.  The activity receives the
 *   checkpoint JSON from Phase 1 so that, on **any** failure (network error,
 *   LLM timeout, empty response, simulated crash), it can:
 *     1. Call `doc.checkout(savedFrontiers)` to revert the agent's ops.
 *     2. Broadcast the reverted state so all clients heal instantly.
 *     3. Re-throw, causing Temporal to record this activity execution as failed.
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

  // ---- Phase 1: Capture checkpoint -----------------------------------------
  //
  // Use the fast proxy (30 s timeout) — this is a read-only Loro op.
  // The resulting JSON is passed directly into Phase 2, making the rollback
  // target a durable, inspectable entry in Temporal's workflow history.
  const checkpointJson = await captureCheckpoint(input.docId, input.stateBytes);

  // ---- Phase 2: Generate, inject, and broadcast (with rollback on failure) --
  //
  // The LLM proxy carries the longer timeout and capped retry policy.
  // `generateAndInjectResponse` owns all Loro mutations; the workflow never
  // touches `doc` or `doc.checkout()` directly (Temporal determinism rule).
  try {
    const generatedText = await generateAndInjectResponseLLM(
      input.docId,
      input.stateBytes,
      instruction,
      checkpointJson,
    );
    return generatedText;
  } catch (err) {
    // The activity already performed `doc.checkout()` and broadcast the reverted
    // state before throwing.  Here we only re-throw with a workflow-level context
    // message so the Temporal UI shows a clear failure reason.
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[agentSyncWorkflow] Phase 2 failed for doc "${input.docId}" — ` +
      `rollback was executed by the activity. Cause: ${cause}`,
    );
  }
}
