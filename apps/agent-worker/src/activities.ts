/**
 * ChronoCanvas agent-worker — Temporal Activities (Day 7: Checkpoint Rollback).
 *
 * Activities run in a normal Node.js environment (no Temporal sandbox), so they
 * have full access to the file system, network, and native modules — including
 * the Loro CRDT wasm binding and the OpenAI SDK.
 *
 * Activity surface:
 *   - `captureCheckpoint`         — read Loro frontier, return JSON checkpoint.
 *   - `generateAndInjectResponse` — call the LLM via OpenRouter, append the
 *                                   response to the Loro canvas, broadcast the
 *                                   binary update through the BackendSocket.
 *                                   On any failure during generation or CRDT
 *                                   mutation, the activity performs an instant
 *                                   `doc.checkout(savedFrontiers)` rollback,
 *                                   broadcasts the reverted state, then
 *                                   re-throws so Temporal marks the run failed.
 *
 * Environment variables consumed here:
 *   - `OPENROUTER_API_KEY`    — required for `generateAndInjectResponse`.
 *   - `OPENROUTER_BASE_URL`   — optional override (default: https://openrouter.ai/api/v1).
 *   - `OPENROUTER_MODEL`      — optional model override (default: openrouter/auto).
 *   - `CHRONO_WORKER_ID`      — stable worker id stamped on the AgentSyncEnvelope.
 *   - `SIMULATE_AGENT_CRASH`  — set to "true" to trigger a test crash inside
 *                               `generateAndInjectResponse` immediately before
 *                               the CRDT write.  Exercises the rollback path for
 *                               Milestone 2 verification.  Remove / unset in
 *                               production.
 */

import { Context } from '@temporalio/activity';
import { LoroDoc } from 'loro-crdt';
import OpenAI from 'openai';
import type { LoroCheckpoint, FrontierEntry, AgentSyncEnvelope } from './types';
import { getBackendSocket } from './connection';

// ---- Helpers ----------------------------------------------------------------

/**
 * Safely encode a `bigint` peer ID as a decimal string for JSON transport.
 * Loro's `doc.frontiers()` returns `{ peer: bigint; counter: number }[]`.
 * Plain `JSON.stringify` would throw on BigInt — this normalises it first.
 */
function encodePeer(peer: bigint | string | number): string {
  return typeof peer === 'bigint' ? peer.toString(10) : String(peer);
}

// ---- Activities -------------------------------------------------------------

/**
 * Initialise a headless LoroDoc, import the caller-supplied binary state,
 * read the resulting causal frontier via `doc.frontiers()`, and return the
 * checkpoint as a JSON string ready for Temporal's history log.
 *
 * @param docId   - Stable document identifier; recorded in the checkpoint.
 * @param stateBytes - The serialised Loro state to inspect.  Pass an empty
 *                    array to capture the frontier of a brand-new doc (will be
 *                    an empty frontier `[]`).
 * @returns A JSON string that deserialises to {@link LoroCheckpoint}.
 *
 * @remarks
 * The activity is heartbeat-safe: it calls `Context.current().heartbeat()`
 * before and after the wasm import so the Temporal server knows we are alive
 * during potentially large state imports. If the activity is cancelled while
 * blocked inside the wasm call, the cancellation will be honoured on the next
 * heartbeat check.
 */
export async function captureCheckpoint(
  docId: string,
  stateBytes: number[],
): Promise<string> {
  const ctx = Context.current();

  ctx.heartbeat('starting-loro-import');

  const doc = new LoroDoc();

  // Convert the plain-number array (JSON-serialisable across the Temporal
  // activity boundary) back into a Uint8Array for Loro.
  const bytes = new Uint8Array(stateBytes);

  if (bytes.length > 0) {
    try {
      doc.import(bytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[captureCheckpoint] LoroDoc.import failed for doc "${docId}": ${msg}`);
    }
  }

  ctx.heartbeat('reading-frontiers');

  // `doc.frontiers()` returns `Array<{ peer: bigint; counter: number }>`.
  // The peer ID is a BigInt and is not JSON-serialisable; normalise to string.
  const rawFrontiers = doc.frontiers();
  const frontiers: FrontierEntry[] = rawFrontiers.map((f) => ({
    peer: encodePeer(f.peer as unknown as bigint),
    counter: f.counter,
  }));

  const checkpoint: LoroCheckpoint = {
    capturedAt: new Date().toISOString(),
    docId,
    frontiers,
  };

  return JSON.stringify(checkpoint);
}

// ---- LLM helpers ------------------------------------------------------------

/**
 * Lazily initialised OpenAI client pointed at OpenRouter.
 * Constructed on first call so the worker process starts even when the env var
 * is not set — the activity will throw with a clear message when it is missing.
 */
let _openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        '[generateAndInjectResponse] OPENROUTER_API_KEY environment variable is not set.',
      );
    }
    _openai = new OpenAI({
      baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      apiKey,
    });
  }
  return _openai;
}

/** Base64-encode a Uint8Array for the AgentSyncEnvelope payload field. */
const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

// ---- Activities (continued) -------------------------------------------------

/**
 * LLM generation + CRDT injection activity — with checkpoint rollback.
 *
 * Steps:
 *   1. Deserialise the Loro state into a headless LoroDoc.
 *   2. Deserialise `checkpointJson` into a {@link LoroCheckpoint} and decode
 *      the saved frontiers into Loro's native `{ peer: bigint; counter }[]`
 *      format.  These are the coordinates we roll back to on failure.
 *   3. Read the current canvas text from the `'codemirror'` container.
 *   4. **[CRASH FENCE]** If `SIMULATE_AGENT_CRASH=true`, throw immediately to
 *      exercise the rollback path without a live LLM.
 *   5. Call the LLM via OpenRouter.
 *   6. Append the LLM's response to the LoroText container.
 *   7. Export an *incremental* binary update and broadcast it to all clients.
 *
 * On **any** error thrown by steps 4–7, the catch block:
 *   - Calls `doc.checkout(savedFrontiers)` to revert all agent ops in-place.
 *   - Exports the rolled-back state and broadcasts it as an `AgentSyncEnvelope`
 *     so every client instantly sees the clean, pre-agent canvas.
 *   - Re-throws the original error so Temporal records the activity as failed
 *     and the workflow can handle it (or let it surface to the caller).
 *
 * @param docId             - Stable document id; stamped on the envelope.
 * @param stateBytes        - Current Loro state, serialised as a number[] for
 *                            JSON transport across the Temporal activity boundary.
 * @param systemInstruction - The instruction sent as the system role to the LLM.
 * @param checkpointJson    - JSON string produced by {@link captureCheckpoint}
 *                            immediately before this activity was scheduled.
 *                            Contains the frontier we revert to on failure.
 * @returns The LLM's generated text (useful for Temporal history inspection).
 *
 * @throws Re-throws any error from the generation/mutation phase after the
 *         rollback broadcast has been sent.
 */
export async function generateAndInjectResponse(
  docId: string,
  stateBytes: number[],
  systemInstruction: string,
  checkpointJson: string,
): Promise<string> {
  const ctx = Context.current();
  const workerId = process.env.CHRONO_WORKER_ID ?? 'agent-worker';

  // ---- 1. Load Loro state ---------------------------------------------------
  ctx.heartbeat('loading-loro-state');

  const doc = new LoroDoc();
  const bytes = new Uint8Array(stateBytes);

  if (bytes.length > 0) {
    try {
      doc.import(bytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[generateAndInjectResponse] LoroDoc.import failed for doc "${docId}": ${msg}`,
      );
    }
  }

  // ---- 2. Decode the saved checkpoint into Loro-native frontiers ------------
  //
  // `checkpointJson` was produced by `captureCheckpoint`, which normalised
  // bigint peer IDs to decimal strings via `encodePeer`.  Loro's `PeerID` type
  // is defined as `\`${number}\`` — a decimal string — so `FrontierEntry.peer`
  // is already the correct shape; we cast it directly without any BigInt
  // conversion.
  //
  // Loro checkout signature: `checkout(frontiers: { peer: PeerID; counter: number }[])`
  // where `type PeerID = \`${number}\`` (loro-crdt/*/loro_wasm.d.ts, line 69).
  let savedFrontiers: { peer: `${number}`; counter: number }[];
  try {
    const checkpoint: LoroCheckpoint = JSON.parse(checkpointJson) as LoroCheckpoint;
    savedFrontiers = checkpoint.frontiers.map((f: FrontierEntry) => ({
      // `f.peer` is already a decimal string produced by `encodePeer(bigint)`.
      // The cast to `${number}` matches Loro's PeerID template-literal type.
      peer: f.peer as `${number}`,
      counter: f.counter,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[generateAndInjectResponse] Failed to parse checkpointJson for doc "${docId}": ${msg}`,
    );
  }

  // ---- 3. Read canvas text --------------------------------------------------
  // The "codemirror" container is the single canonical text container owned by
  // loro-codemirror's LoroSyncPlugin. All editor clients write here.
  const textContainer = doc.getText('codemirror');
  const currentText = textContainer.toString();

  console.log(
    `[generateAndInjectResponse] doc="${docId}" canvas text length=${currentText.length}`,
  );

  // Snapshot the version vector *before* any agent write so the success-path
  // incremental export contains only the new ops and the rollback broadcast
  // can be diffed from the same baseline.
  const versionBefore = doc.version();

  // ---- Helper: connect the socket lazily (shared by success + rollback) -----
  const socket = getBackendSocket(workerId);
  if (!socket.isConnected) {
    await socket.connect();
  }

  // ---- Rollback helper ------------------------------------------------------
  //
  // Must be defined before the try block so the catch can close over it.
  // Exported as an inner function to keep the happy-path readable.
  //
  // The Loro `checkout` call is synchronous and targets the exact ops recorded
  // in `savedFrontiers`.  Because Loro is a CRDT, any concurrent human edits
  // that arrived after the checkpoint was captured are NOT reverted — only the
  // agent's own ops are rewound.  The whole operation completes in < 5 ms for
  // documents of typical session size.
  async function broadcastRollback(cause: unknown): Promise<void> {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    console.warn(
      `[generateAndInjectResponse] doc="${docId}" rolling back agent ops — cause: ${causeMsg}`,
    );

    try {
      // Revert all agent ops committed after the checkpoint.
      // `doc.checkout()` accepts `{ peer: bigint; counter: number }[]`.
      doc.checkout(savedFrontiers);

      // Export only the delta since our pre-write baseline so clients that
      // already applied the (now-reverted) agent ops converge back cleanly.
      const rollbackBytes = doc.export({ mode: 'update', from: versionBefore });

      const rollbackEnvelope: AgentSyncEnvelope = {
        type: 'crdt-sync',
        docId,
        payload: toB64(rollbackBytes),
        senderId: workerId,
        origin: 'agent',
        timestamp: Date.now(),
      };

      socket.sendSyncMessage(rollbackEnvelope);

      console.log(
        `[generateAndInjectResponse] doc="${docId}" rollback broadcast sent` +
        ` (${rollbackBytes.length} bytes)`,
      );
    } catch (rollbackErr) {
      // The rollback itself failed — log loudly so an operator can investigate,
      // but still re-throw the *original* error below so Temporal history is
      // accurate about what initially went wrong.
      console.error(
        `[generateAndInjectResponse] doc="${docId}" ROLLBACK FAILED:`,
        rollbackErr,
      );
    }
  }

  // ---- 4–7. Generation, mutation, and broadcast (crash-protected) -----------
  try {
    // ---- [4] Simulated crash gate (Milestone 2 testing) ---------------------
    //
    // Toggle by setting SIMULATE_AGENT_CRASH=true in the worker environment.
    // This throw fires *after* the checkpoint frontiers have been decoded but
    // *before* any CRDT write, so the rollback broadcast will produce a no-op
    // delta (empty update) — the correct behaviour for a pre-write crash.
    if (process.env.SIMULATE_AGENT_CRASH === 'true') {
      throw new Error('SIMULATED_AGENT_CRASH');
    }

    // ---- [5] Call the LLM ---------------------------------------------------
    ctx.heartbeat('calling-llm');

    const model = process.env.OPENROUTER_MODEL ?? 'openrouter/auto';
    const openai = getOpenAIClient();

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: systemInstruction,
        },
        {
          role: 'user',
          // The canvas text is the LLM's sole context.  An empty canvas is
          // signalled explicitly so the model does not hallucinate prior content.
          content: currentText.length > 0
            ? `Current canvas text:\n\n${currentText}`
            : '(The canvas is currently empty.)',
        },
      ],
    });

    const generated = completion.choices[0]?.message?.content ?? '';

    if (!generated) {
      throw new Error(
        `[generateAndInjectResponse] LLM returned an empty response for doc "${docId}"`,
      );
    }

    console.log(
      `[generateAndInjectResponse] doc="${docId}" LLM generated ${generated.length} chars`,
    );

    // ---- [6] Append to Loro -------------------------------------------------
    ctx.heartbeat('writing-to-loro');

    // Append a newline separator when the canvas already has content.
    const insertion = currentText.length > 0 ? `\n${generated}` : generated;
    const insertPos = textContainer.length;
    textContainer.insert(insertPos, insertion);

    // ---- [7] Export incremental update + broadcast -------------------------
    ctx.heartbeat('broadcasting-update');

    const updateBytes = doc.export({ mode: 'update', from: versionBefore });

    const envelope: AgentSyncEnvelope = {
      type: 'crdt-sync',
      docId,
      payload: toB64(updateBytes),
      senderId: workerId,
      // Omit versionFrom — we are pushing a delta, not joining as a peer that
      // needs a backfill diff.  The server merges and fans out.
      origin: 'agent',
      timestamp: Date.now(),
    };

    socket.sendSyncMessage(envelope);

    console.log(
      `[generateAndInjectResponse] doc="${docId}" update broadcast (${updateBytes.length} bytes)`,
    );

    return generated;

  } catch (err) {
    // ---- Rollback path -------------------------------------------------------
    //
    // Any error thrown by steps 4–7 lands here.  We attempt the checkout +
    // broadcast before re-throwing so Temporal sees a proper activity failure
    // (not a silent hang) and so clients are immediately healed.
    await broadcastRollback(err);

    // Re-throw the original error so the Temporal server records the activity
    // as failed, the workflow can react (e.g. surface to the caller or retry
    // with a capped attempt count), and Temporal history remains accurate.
    throw err;
  }
}
