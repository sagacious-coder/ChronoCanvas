/**
 * ChronoCanvas agent-worker — Temporal Workflows (Stage 3: Live LLM Integration).
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
 *      never in this file.  The workflow's only job is to sequence the activities
 *      and propagate errors cleanly into Temporal history.
 *
 * Workflow surface:
 *   - `checkpointWorkflow`  — reads the Loro frontier and returns a checkpoint.
 *   - `agentSyncWorkflow`   — Stage 3 three-phase protocol:
 *       Phase 1 — `captureCheckpoint`       : snapshot the current CRDT frontier.
 *       Phase 2 — `generateAgentMutation`   : call the LLM, return a structured
 *                  JSON mutation describing the exact edit to make.
 *       Phase 3 — `generateAndInjectResponse`: apply the mutation to Loro, broadcast
 *                  the delta.  On any failure the activity calls `doc.checkout()`
 *                  and broadcasts the reverted state before re-throwing.
 */

import {
  proxyActivities,
  ApplicationFailure,
  ActivityFailure,
  type ActivityOptions,
} from '@temporalio/workflow';

// Type-only import: Temporal's bundler strips the implementation at runtime so
// we stay inside the sandbox.  The generic parameter is the activity module's
// export shape — proxyActivities returns stubs with identical signatures.
import type * as activities from './activities';

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
const { captureCheckpoint, generateAndInjectResponse, generateAgentMutation, emitTaskStatus } =
  proxyActivities<typeof activities>(defaultActivityOptions);

// For the LLM generation activity we need a separate proxy so it carries its own options.
const { generateAndInjectResponse: generateAndInjectResponseLLM } =
  proxyActivities<typeof activities>(llmActivityOptions);

// The mutation generation step uses the LLM proxy timeout (same patience needed).
const { generateAgentMutation: generateAgentMutationLLM } =
  proxyActivities<typeof activities>(llmActivityOptions);

const { verifyMutationSyntax } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 1 } // Force immediate failure back to the workflow loop
});

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
   * Full text content of the canvas at dispatch time, as a plain string.
   *
   * Passed directly to `generateAgentMutation` so the LLM can evaluate the
   * current document state without needing to decode the Loro binary itself.
   * The server extracts this from the live room via `doc.getText('codemirror').toString()`
   * before dispatching the workflow.
   *
   * Pass an empty string when the canvas is blank.
   */
  currentDocumentState?: string;
  /**
   * The user's natural-language instruction sent to the LLM.
   *
   * @default 'Read the canvas and suggest a coherent continuation or improvement.'
   */
  systemInstruction?: string;
  /** Task ID for emitting progress updates directly to UI */
  taskId?: string;
}

/** Default instruction when the caller supplies none. */
const DEFAULT_INSTRUCTION =
  'Read the canvas and suggest a coherent continuation or improvement.';

/**
 * `agentSyncWorkflow` — Stage 3 three-phase agent write with checkpoint rollback.
 *
 * **Phase 1 — Checkpoint** (`captureCheckpoint`):
 *   Reads the current Loro frontier from the supplied `stateBytes` and records
 *   it as a durable Temporal history event.  The result is a JSON string
 *   encoding `{ docId, capturedAt, frontiers[] }` that later phases use as
 *   the rollback target if anything goes wrong.
 *
 * **Phase 2 — Generate Mutation** (`generateAgentMutation`):
 *   Sends the user's instruction and the full `currentDocumentState` text to
 *   the LLM via OpenRouter.  The LLM returns a structured JSON mutation
 *   `{ operation, position?, deleteCount?, content, rationale }` that describes
 *   *exactly* what to write and where.  This phase has its own capped retry
 *   policy and is isolated from the CRDT write so a bad LLM response never
 *   corrupts the canvas.
 *
 * **Phase 3 — Inject & Broadcast** (`generateAndInjectResponse`):
 *   Applies the mutation to the Loro canvas and broadcasts the incremental CRDT
 *   update to the backend WebSocket server.  On **any** failure, the activity:
 *     1. Calls `doc.checkout(savedFrontiers)` to revert the agent's ops.
 *     2. Broadcasts the reverted state so all clients heal instantly.
 *     3. Re-throws, causing Temporal to record this activity execution as failed.
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
 *   args: [{ docId, stateBytes: Array.from(snapshotBytes), currentDocumentState: canvasText }],
 * });
 * const generatedText = await handle.result();
 * ```
 */
export async function agentSyncWorkflow(
  input: AgentSyncWorkflowInput,
): Promise<string> {
  const instruction = input.systemInstruction ?? DEFAULT_INSTRUCTION;
  const documentState = input.currentDocumentState ?? '';

  // ---- Phase 1: Capture checkpoint -----------------------------------------
  //
  // Use the fast proxy (30 s timeout) — this is a read-only Loro op.
  // The resulting JSON is passed directly into Phase 3, making the rollback
  // target a durable, inspectable entry in Temporal's workflow history.
  const checkpointJson = await captureCheckpoint(input.docId, input.stateBytes);

  // ---- Phase 2: Generate the structured mutation ----------------------------
  let mutationJson: string;
  let errorFeedback = '';
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const prompt = errorFeedback
        ? `${instruction}\n\nLAST ATTEMPT FAILED WITH:\n${errorFeedback}\nPlease fix the syntax error.`
        : instruction;
      
      mutationJson = await generateAgentMutationLLM(prompt, documentState);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw ApplicationFailure.nonRetryable(
        `[agentSyncWorkflow] Phase 2 (mutation generation) failed for doc "${input.docId}" — ` +
        `no CRDT write was attempted. Cause: ${cause}`,
      );
    }

    // ---- Phase 2.5: Verify Syntax -------------------------------------------
    try {
      if (input.taskId) {
        await emitTaskStatus(input.taskId, 'sandboxed-testing');
      }
      
      await verifyMutationSyntax(input.stateBytes, mutationJson);
      
      // Syntax OK, break out of retry loop to commit
      break;
    } catch (err: any) {
      if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure && err.cause.message.includes('SYNTAX_ERROR:')) {
        errorFeedback = err.cause.message;
        
        if (input.taskId) {
          await emitTaskStatus(input.taskId, 'self-healing', errorFeedback);
        }
        
        if (attempt === MAX_ATTEMPTS) {
          throw ApplicationFailure.nonRetryable(
            `Self-healing failed after ${MAX_ATTEMPTS} attempts. Last error: ${errorFeedback}`
          );
        }
        // Let loop retry Phase 2
        continue;
      }
      
      // Re-throw if it's a different error
      const cause = err instanceof Error ? err.message : String(err);
      throw ApplicationFailure.nonRetryable(`[agentSyncWorkflow] Verification failed unexpectedly: ${cause}`);
    }
  }

  // ---- Phase 3: Inject mutation into Loro & broadcast ----------------------
  try {
    const generatedText = await generateAndInjectResponseLLM(
      input.docId,
      input.stateBytes,
      mutationJson!,
      checkpointJson,
    );
    return generatedText;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw ApplicationFailure.nonRetryable(
      `[agentSyncWorkflow] Phase 3 failed for doc "${input.docId}" — ` +
      `rollback was executed by the activity. Cause: ${cause}`,
    );
  }
}
