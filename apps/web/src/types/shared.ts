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
  versionFrom?: string; // Hex representation of Loro Frontier
  payload: string;     // Base64 encoded binary delta
  senderId: string;
  timestamp: number;
}

export interface AwarenessMessage {
  type: 'awareness-update';
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
