/**
 * ChronoCanvas Shared Contracts (Stage 4 - Day 13 Auth & BYOK Freeze)
 * Interface definitions for WebSocket binary delta exchanges,
 * CRDT Frontiers, Sandbox Pre-Flight Diagnostics, JWT Authentication, and BYOK.
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

/**
 * Static 64-bit Peer ID for the autonomous AI agent worker ("999999999").
 * Enforces clear attribution in Loro CRDT frontiers and timeline version control.
 */
export const AGENT_PEER_ID = "999999999" as const;

export interface SyncMessage {
  type: 'crdt-sync';
  docId: string;
  versionFrom?: VersionVectorHex; // Hex representation of Loro Version Vector / Frontier
  payload: string;     // Base64 encoded binary delta
  senderId: string;
  origin?: EditOrigin;
  timestamp: number;
}

export interface AwarenessMessage {
  type: 'awareness-update';
  docId?: string;
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

export interface JwtPayload {
  sub: string;
  exp?: number;
  iat?: number;
  role?: string;
  [key: string]: unknown;
}

export interface ByokConfig {
  enabled: boolean;
  provider: 'openrouter' | 'anthropic' | 'openai' | 'custom';
  apiKey?: string;
  model: string;
  customBaseUrl?: string;
}

export interface UserAuthSession {
  mode: 'guest' | 'jwt';
  token?: string;
  subject?: string;
  expiresAt?: number;
}

export interface AgentTaskRequest {
  type: 'agent-task-request';
  taskId: string;
  prompt: string;
  docId?: string;
  targetRange?: { from: number; to: number };
  docFrontier?: string; // Pre-flight checkpoint hash
  apiKey?: string;     // BYOK API key for LLM generation
  provider?: 'openai' | 'anthropic' | 'openrouter';
  simulateFailure?: boolean;
  failureType?: 'syntax' | 'assertion';
  enableSelfHealing?: boolean; // Day 11: triggers autonomous self-healing loop
  byokConfig?: ByokConfig;     // Day 13: Bring-Your-Own-Key configuration
  authToken?: string;          // Day 13: JWT Bearer authorization token
}

export interface SandboxTestCase {
  name: string;
  status: 'passed' | 'failed' | 'running';
  durationMs?: number;
  error?: string;
}

export interface SandboxTestResult {
  suite: string; // e.g. "astral-sh/uv pre-flight"
  runner: 'uv run python -m py_compile' | 'uv run pytest';
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number; // target <50ms
  testCases: SandboxTestCase[];
  stdout?: string;
  stderr?: string;
  errorTraceback?: string;
  preFlightStage?: 'checkpoint-saved' | 'code-generated' | 'testing' | 'self-healing' | 'broadcast-committed' | 'broadcast-aborted';
  attempt?: number;
  maxAttempts?: number;
}

export interface AgentTaskStatus {
  type: 'agent-task-status';
  taskId: string;
  status:
    | 'planning'           // Phase 0: workflow accepted by Temporal, acknowledged immediately
    | 'reading-canvas'     // Phase 1: server extracted hub canvas state, captureCheckpoint running
    | 'generating'         // Phase 2: generateAgentMutation running — LLM call in-flight
    | 'injecting'          // Phase 3: generateAndInjectResponse running — CRDT write in-flight
    | 'sandboxed-testing'  // Sandbox testing phase
    | 'self-healing'       // Error caught, LLM is retrying
    | 'committed'          // Terminal success: CRDT delta broadcast, canvas updated
    | 'completed'          // Final terminal success broadcast to all connected clients
    | 'rolled-back'        // Terminal failure: agent ops reverted, canvas restored to checkpoint
    | 'failed';            // Final terminal failure broadcast to all connected clients
  preFlightTestsPassed?: boolean;
  rollbackTriggered?: boolean;
  errorTrace?: string;
  tokenCount?: number;
  sandboxResult?: SandboxTestResult;
  preFlightStage?: 'checkpoint-saved' | 'code-generated' | 'testing' | 'self-healing' | 'broadcast-committed' | 'broadcast-aborted';
  failureType?: 'syntax' | 'assertion';
  selfHealingAttempt?: number;
  maxAttempts?: number;
  healedSuccessfully?: boolean;
  healedCode?: string;
  byokUsed?: boolean;
  modelUsed?: string;
}

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
  prompt?: string;
  /** Optional BYOK API key for LLM generation. */
  apiKey?: string;
  /** Optional model provider preference. */
  provider?: 'openai' | 'anthropic' | 'openrouter';
  simulateFailure?: boolean;
  enableSelfHealing?: boolean;
  byokConfig?: ByokConfig;
  authToken?: string;
}

/** Success response body from `POST /api/ask-ai`. */
export interface AskAiResponse {
  /** The Temporal workflow id that was started. */
  workflowId: string;
  /** ISO-8601 timestamp of when the workflow was submitted. */
  submittedAt?: string;
  status?: string;
  message?: string;
}

export type ChronoWebSocketMessage =
  | AuthMessage
  | AuthSuccessMessage
  | AuthErrorMessage
  | SyncMessage
  | AwarenessMessage
  | AgentTaskRequest
  | AgentTaskStatus;
