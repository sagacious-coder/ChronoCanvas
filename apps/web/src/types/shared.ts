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
 * Static 64-bit Peer ID for the autonomous AI agent worker ("999999999").
 * Enforces clear attribution in Loro CRDT frontiers and timeline version control.
 */
export const AGENT_PEER_ID = "999999999" as const;

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

export interface AuthMessage {
  type: 'auth';
  token: string;
  apiKey?: string;
  provider?: 'openai' | 'anthropic' | 'openrouter';
}

export interface AuthSuccessMessage {
  type: 'auth-success';
  userId: string;
  claims?: Record<string, unknown>;
}

export interface AuthErrorMessage {
  type: 'auth-error';
  error: string;
  code?: 'UNAUTHORIZED' | 'INVALID_TOKEN' | 'TOKEN_EXPIRED';
}

export interface AgentTaskRequest {
  type: 'agent-task-request';
  taskId: string;
  prompt: string;
  docId?: string;
  targetRange?: { from: number; to: number };
  docFrontier?: string; // Pre-flight checkpoint hash
  apiKey?: string;     // BYOK API key
  provider?: 'openai' | 'anthropic' | 'openrouter';
  simulateFailure?: boolean;
}

export interface AgentTaskStatus {
  type: 'agent-task-status';
  taskId: string;
  status:
    | 'planning'           // Phase 0: workflow accepted by Temporal
    | 'reading-canvas'     // Phase 1: captureCheckpoint running — agent is reading CRDT state
    | 'generating'         // Phase 2: generateAgentMutation running — LLM is thinking
    | 'injecting'          // Phase 3: generateAndInjectResponse running — CRDT write in-flight
    | 'sandboxed-testing'  // Sandbox testing phase
    | 'self-healing'       // Error caught, LLM is retrying
    | 'committed'          // Terminal success: CRDT delta broadcast, canvas updated
    | 'completed'          // Final terminal success broadcast to all connected clients
    | 'rolled-back'        // Terminal failure: agent ops reverted, canvas restored
    | 'failed';            // Final terminal failure broadcast to all connected clients
  preFlightTestsPassed?: boolean;
  rollbackTriggered?: boolean;
  errorTrace?: string;
  tokenCount?: number;
}


export type ChronoWebSocketMessage =
  | AuthMessage
  | AuthSuccessMessage
  | AuthErrorMessage
  | SyncMessage
  | AwarenessMessage
  | AgentTaskRequest
  | AgentTaskStatus;
