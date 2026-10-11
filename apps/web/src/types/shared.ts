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
  status: 'planning' | 'generating' | 'sandboxed-testing' | 'self-healing' | 'committed' | 'rolled-back';
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
  simulateFailure?: boolean;
  enableSelfHealing?: boolean;
  byokConfig?: ByokConfig;
  authToken?: string;
}

export interface AskAiResponse {
  workflowId: string;
  status?: string;
  message?: string;
}

export type ChronoWebSocketMessage =
  | SyncMessage
  | AwarenessMessage
  | AgentTaskRequest
  | AgentTaskStatus;
