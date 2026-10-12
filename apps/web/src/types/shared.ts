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
  versionFrom?: string; // Hex representation of Loro Frontier
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

export interface AskAiRequest {
  docId: string;
  stateBytes: number[];
  prompt?: string;
  apiKey?: string;
  provider?: 'openai' | 'anthropic' | 'openrouter';
  simulateFailure?: boolean;
  enableSelfHealing?: boolean;
  byokConfig?: ByokConfig;
  authToken?: string;
}

export interface AskAiResponse {
  workflowId: string;
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
