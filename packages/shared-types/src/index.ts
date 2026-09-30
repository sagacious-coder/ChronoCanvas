/**
 * ChronoCanvas Shared Contracts (Stage 0 - Day 1 Freeze)
 * Interface definitions for WebSocket binary delta exchanges,
 * CRDT Frontiers, and Agent Step Checkpoints.
 */

export interface CursorPosition {
  line: number;
  ch: number;
}

export interface PeerAwareness {
  peerId: string;
  userName: string;
  userColor: string;
  cursor?: CursorPosition;
  selection?: { anchor: number; head: number };
  isAgent?: boolean;
}

/**
 * A Loro **Version Vector**, hex-encoded for the JSON wire.
 *
 * This is the hex of `VersionVector.encode()` — the per-peer op counters a peer
 * holds — decoded back with `VersionVector.decode()` on receipt. It is modelled
 * as a distinct named type (rather than a bare `string`) so a `versionFrom`
 * field reads as "a version vector", not "some string": a Frontier hash, a
 * base64 payload, and a version vector are all strings on the wire but must
 * never be mixed. It stays assignable to/from `string` because a live wasm
 * `VersionVector` cannot itself travel over JSON.
 */
export type VersionVectorHex = string;

/** Who authored a delta: a browser user, or an autonomous agent worker. */
export type EditOrigin = 'human' | 'agent';

export interface SyncMessage {
  type: 'crdt-sync';
  docId: string;
  /**
   * The sender's Loro Version Vector (see {@link VersionVectorHex}): the per-peer
   * op counters it already holds. This is NOT a Frontier (a Frontier is a set of
   * op IDs at the tips of the DAG and cannot be compared without the OpLog).
   *
   * The receiver diffs against it with `doc.export({ mode: 'update', from })`
   * to compute exactly the ops the sender is missing. Senders set it to their
   * version *after* applying their own edit, so a diff can never echo their own
   * ops back. Omit it on a cold join to request a full snapshot.
   */
  versionFrom?: VersionVectorHex;
  payload: string;     // Base64 encoded binary delta
  senderId: string;
  /**
   * Provenance of the delta, preserved end-to-end so clients can distinguish a
   * human edit from an agent write (e.g. to tint agent-authored ranges). Set by
   * the server's Event Hub on fan-out; absent on frames a client sends up.
   */
  origin?: EditOrigin;
  timestamp: number;
}

export interface AwarenessMessage {
  type: 'awareness-update';
  /**
   * Scopes presence to a single document. One socket may be joined to several
   * documents at once, so cursors must name the document they belong to rather
   * than being fanned out across every room the socket happens to share.
   */
  docId: string;
  peer: PeerAwareness;
  timestamp: number;
}

export interface AgentTaskRequest {
  type: 'agent-task-request';
  taskId: string;
  prompt: string;
  targetRange?: { from: number; to: number };
  docFrontier: string; // Pre-flight checkpoint hash
}

export interface AgentTaskStatus {
  type: 'agent-task-status';
  taskId: string;
  status: 'planning' | 'generating' | 'sandboxed-testing' | 'committed' | 'rolled-back';
  preFlightTestsPassed?: boolean;
  rollbackTriggered?: boolean;
  errorTrace?: string;
  tokenCount?: number;
}

export type ChronoWebSocketMessage =
  | SyncMessage
  | AwarenessMessage
  | AgentTaskRequest
  | AgentTaskStatus;

// ---- HTTP API contracts -----------------------------------------------------

/**
 * Request body for `POST /api/ask-ai`.
 *
 * The frontend exports the current Loro snapshot as a `Uint8Array` and
 * converts it to a plain number array (`Array.from(bytes)`) so it is
 * JSON-serialisable.  The server reconstructs `new Uint8Array(stateBytes)`
 * before passing it to the Temporal activity.
 */
export interface AskAiRequest {
  /** The Loro document room id (must match the WebSocket room the user is in). */
  docId: string;
  /**
   * Current Loro snapshot as a plain number array.
   * Convert from Uint8Array: `Array.from(doc.export({ mode: 'snapshot' }))`.
   */
  stateBytes: number[];
}

/** Success response body from `POST /api/ask-ai`. */
export interface AskAiResponse {
  /** The Temporal workflow id that was started. */
  workflowId: string;
  /** ISO-8601 timestamp of when the workflow was submitted. */
  submittedAt: string;
}
