/**
 * Internal types for the ChronoCanvas agent-worker.
 *
 * These live here (rather than in @chronocanvas/shared-types) because they are
 * implementation details of the Temporal activities: the checkpoint format is
 * opaque to the browser and the server only needs SyncMessage, which is already
 * in shared-types.
 */

// ---- Loro Frontier ----------------------------------------------------------

/**
 * A single entry in a Loro Frontier — the "tip" of one peer's causal chain.
 *
 * `LoroDoc.frontiers()` returns `Array<{ peer: bigint; counter: number }>`.
 * BigInt is not JSON-serialisable natively, so we encode `peer` as a decimal
 * string on the wire and parse it back to BigInt when needed.
 */
export interface FrontierEntry {
  /** Peer ID encoded as a decimal string (BigInt → String). */
  peer: string;
  /** The last committed counter for that peer. */
  counter: number;
}

/**
 * The JSON-serialisable checkpoint recorded by the `captureCheckpoint` activity.
 *
 * A checkpoint is a structural snapshot of the CRDT's causal frontier at the
 * moment the activity ran. It lets later workflow steps compare whether the
 * document has advanced since the last agent inspection.
 */
export interface LoroCheckpoint {
  /** ISO-8601 timestamp of when the checkpoint was taken. */
  capturedAt: string;
  /** Stable identifier for the document (Temporal workflow parameter). */
  docId: string;
  /**
   * The Loro frontier at capture time — the set of (peer, counter) pairs that
   * define the tip of the op-DAG.  Use `JSON.stringify` / `JSON.parse` to move
   * across the Temporal activity boundary.
   */
  frontiers: FrontierEntry[];
}

// ---- WebSocket transport contract -------------------------------------------

/**
 * Every message the agent-worker sends to the local WebSocket backend
 * (ws://localhost:3001) MUST be wrapped in this envelope.
 *
 * The server's EventHub reads `origin` to decide how to stamp the fan-out
 * `SyncMessage.origin` field so browsers can distinguish agent writes from
 * human edits.
 *
 * @see {@link @chronocanvas/shared-types#SyncMessage} for the browser-facing wire type.
 */
export interface AgentSyncEnvelope {
  /** Must always be 'crdt-sync' to match the server's dispatch switch. */
  type: 'crdt-sync';
  /** Base64-encoded Loro binary delta. */
  payload: string;
  /** Stable worker/task id so the server can track the member record. */
  senderId: string;
  /**
   * The agent's Loro VersionVector hex *after* applying its own edit, so the
   * server's diff excludes those ops.  Omit on a cold join to get a snapshot.
   */
  versionFrom?: string;
  /** Hard-wired to 'agent' so the EventHub stamps fan-out frames correctly. */
  origin: 'agent';
  /** The document this delta belongs to. */
  docId: string;
  /** Unix ms timestamp of when the envelope was built. */
  timestamp: number;
}
