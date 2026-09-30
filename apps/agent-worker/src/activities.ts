/**
 * ChronoCanvas agent-worker — Temporal Activities.
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
 *
 * Environment variables consumed here:
 *   - `OPENROUTER_API_KEY`  — required for `generateAndInjectResponse`.
 *   - `OPENROUTER_BASE_URL` — optional override (default: https://openrouter.ai/api/v1).
 *   - `OPENROUTER_MODEL`    — optional model override (default: openrouter/auto).
 *   - `CHRONO_WORKER_ID`    — stable worker id stamped on the AgentSyncEnvelope.
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
 * LLM generation + CRDT injection activity.
 *
 * Steps:
 *   1. Deserialise the Loro state into a headless LoroDoc.
 *   2. Read the current canvas text from the `'chrono-canvas-default'` container.
 *   3. Send the canvas text + system instruction to the LLM via OpenRouter.
 *   4. Append the LLM's response to the LoroText container.
 *   5. Export an *incremental* binary update (only the new ops).
 *   6. Broadcast the update to the backend via `AgentSyncEnvelope` over
 *      the BackendSocket singleton, which the server fans out to all connected
 *      clients with `origin: 'agent'`.
 *
 * @param docId             - Stable document id; stamped on the envelope.
 * @param stateBytes        - Current Loro state, serialised as a number[] for
 *                            JSON transport across the Temporal activity boundary.
 * @param systemInstruction - The instruction sent as the system role to the LLM.
 * @returns The LLM's generated text (useful for Temporal history inspection).
 *
 * @throws If `OPENROUTER_API_KEY` is not set, or the LLM call fails, or the
 *         BackendSocket cannot send (not connected).
 */
export async function generateAndInjectResponse(
  docId: string,
  stateBytes: number[],
  systemInstruction: string,
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

  // ---- 2. Read canvas text --------------------------------------------------
  const textContainer = doc.getText('chrono-canvas-default');
  const currentText = textContainer.toString();

  console.log(
    `[generateAndInjectResponse] doc="${docId}" canvas text length=${currentText.length}`,
  );

  // ---- 3. Call the LLM ------------------------------------------------------
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

  // ---- 4. Append to Loro ----------------------------------------------------
  ctx.heartbeat('writing-to-loro');

  // Snapshot the version vector *before* our write so the incremental export
  // only contains the ops we are about to add — nothing the server already has.
  const versionBefore = doc.version();

  // Append a newline separator when the canvas already has content.
  const insertion = currentText.length > 0 ? `\n${generated}` : generated;
  const insertPos = textContainer.length;
  textContainer.insert(insertPos, insertion);

  // ---- 5. Export incremental update -----------------------------------------
  const updateBytes = doc.export({ mode: 'update', from: versionBefore });

  // ---- 6. Broadcast via BackendSocket ---------------------------------------
  ctx.heartbeat('broadcasting-update');

  const envelope: AgentSyncEnvelope = {
    type: 'crdt-sync',
    docId,
    payload: toB64(updateBytes),
    senderId: workerId,
    // Omit versionFrom on this envelope — we are pushing a delta, not joining
    // as a peer that needs a backfill diff.  The server will merge and fan out.
    origin: 'agent',
    timestamp: Date.now(),
  };

  const socket = getBackendSocket(workerId);

  // Connect lazily — no-op if already open.
  if (!socket.isConnected) {
    await socket.connect();
  }

  socket.sendSyncMessage(envelope);

  console.log(
    `[generateAndInjectResponse] doc="${docId}" update broadcast (${updateBytes.length} bytes)`,
  );

  return generated;
}
