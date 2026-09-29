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

export interface SyncMessage {
  type: 'crdt-sync';
  docId: string;
  /**
   * Hex-encoded Loro **Version Vector** — the output of
   * `VersionVector.encode()`, i.e. the per-peer op counters the sender already
   * holds. This is NOT a Frontier (a Frontier is a set of op IDs at the tips of
   * the DAG and cannot be compared without the OpLog).
   *
   * The receiver diffs against it with `doc.export({ mode: 'update', from })`
   * to compute exactly the ops the sender is missing. Senders set it to their
   * version *after* applying their own edit, so a diff can never echo their own
   * ops back. Omit it on a cold join to request a full snapshot.
   */
  versionFrom?: string;
  payload: string;     // Base64 encoded binary delta
  senderId: string;
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
