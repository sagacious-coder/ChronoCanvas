/**
 * ChronoCanvas agent-worker — Temporal Workflows (Day 5).
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
 * Current workflow surface (Day 5 milestone):
 *   - `checkpointWorkflow` — proxies `captureCheckpoint` and returns the result.
 *
 * Extension seam (Day 6+):
 *   - Add activities for `commitAgentDelta` / `broadcastViaWebSocket` here once
 *     the agent write path is wired up; the proxy pattern below scales to any
 *     number of activity signatures without ceremony.
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
 * Default scheduling options for all activities in this package.
 *
 * `startToCloseTimeout` is the wall-clock budget for a single activity attempt.
 * Keep it generous enough for large state imports while still failing fast on a
 * hung wasm call.  The retry policy uses Temporal's default exponential
 * back-off (initial 1 s, cap 100 s, unlimited retries) which is appropriate
 * for idempotent read activities like `captureCheckpoint`.
 */
const defaultActivityOptions: ActivityOptions = {
  startToCloseTimeout: '30 seconds',
  heartbeatTimeout: '10 seconds',
};

// ---- Activity proxy ---------------------------------------------------------

/**
 * Typed stub for every activity exported from `./activities`.
 * Add new activities to that module; they appear here automatically.
 */
const { captureCheckpoint } = proxyActivities<typeof activitiesModule>(
  defaultActivityOptions,
);

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
 * `checkpointWorkflow` — Day 5 milestone workflow.
 *
 * Reads the causal frontier of a Loro document (provided as a serialised state
 * blob) and records it as a durable Temporal history event.  The returned JSON
 * string deserialises to {@link LoroCheckpoint} (defined in `types.ts`).
 *
 * Workflow ID convention: `"checkpoint-{docId}-{timestamp}"`
 *
 * @example Trigger from a Temporal client:
 * ```ts
 * const handle = await client.workflow.start(checkpointWorkflow, {
 *   taskQueue: 'chrono-agent',
 *   workflowId: `checkpoint-${docId}-${Date.now()}`,
 *   args: [{ docId, stateBytes: Array.from(snapshotBytes) }],
 * });
 * const checkpoint = await handle.result();
 * console.log(JSON.parse(checkpoint));
 * ```
 */
export async function checkpointWorkflow(
  input: CheckpointWorkflowInput,
): Promise<string> {
  const checkpointJson = await captureCheckpoint(input.docId, input.stateBytes);
  return checkpointJson;
}
