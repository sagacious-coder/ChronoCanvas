/**
 * ChronoCanvas agent-worker — Temporal Activities (Day 5).
 *
 * Activities run in a normal Node.js environment (no Temporal sandbox), so they
 * have full access to the file system, network, and native modules — including
 * the Loro CRDT wasm binding.
 *
 * Current activity surface (Day 5 milestone):
 *   - `captureCheckpoint`  — load a Loro state blob, read its frontier, return
 *                            a JSON checkpoint string.
 *
 * Extension seam (Day 6+):
 *   - `connectToBackend` / `sendSyncMessage` will live here once the WebSocket
 *     connection to ws://localhost:3001 is wired up.  The `AgentSyncEnvelope`
 *     type in `types.ts` is already defined and ready.
 */

import { Context } from '@temporalio/activity';
import { LoroDoc } from 'loro-crdt';
import type { LoroCheckpoint, FrontierEntry } from './types';

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
