/**
 * ChronoCanvas agent-worker — WebSocket transport to the local backend.
 *
 * This module manages the single WebSocket connection from the agent-worker
 * process to the ChronoCanvas WebSocket server (ws://localhost:3001).
 *
 * It is intentionally decoupled from Temporal: activities import it to push
 * deltas out of band without the Temporal sandbox restricting the import.
 *
 * **Day 5 status**: The class is wired up and exported but the worker (`worker.ts`)
 * does NOT start it automatically — connect() must be called explicitly once
 * the agent has a document to join.  Day 6 activities will call `connect()` and
 * `sendSyncMessage()` as part of the agent write path.
 *
 * Wire contract: every outbound frame must be an {@link AgentSyncEnvelope}
 * (defined in `types.ts`), which maps 1-to-1 onto the server's `SyncMessage`
 * discriminator so the EventHub can dispatch it as an agent write.
 */

import WebSocket from 'ws';
import type { AgentSyncEnvelope } from './types';

// ---- Config -----------------------------------------------------------------

const DEFAULT_BACKEND_URL = process.env.CHRONO_BACKEND_URL ?? 'ws://localhost:3001';

/** How long to wait before attempting a reconnect after an unexpected close. */
const RECONNECT_DELAY_MS = 3_000;

/** Maximum number of automatic reconnect attempts (0 = unlimited). */
const MAX_RECONNECT_ATTEMPTS = 10;

const INTERNAL_WORKER_SECRET = process.env.INTERNAL_WORKER_SECRET ?? 'chrono-worker-internal-key';

// ---- BackendSocket ----------------------------------------------------------

/**
 * A managed, auto-reconnecting WebSocket connection to the ChronoCanvas server.
 *
 * Lifecycle:
 *   1. Instantiate: `const bs = new BackendSocket(workerId)`
 *   2. Connect:     `await bs.connect()`  — resolves when the socket is OPEN.
 *   3. Send:        `bs.sendSyncMessage(envelope)` — throws if not connected.
 *   4. Shutdown:    `bs.close()` — clean close, no reconnect.
 *
 * @example
 * ```ts
 * const backend = new BackendSocket('agent-worker-1');
 * await backend.connect();
 * backend.sendSyncMessage({ type: 'crdt-sync', ... });
 * ```
 */
export class BackendSocket {
  private readonly workerId: string;
  private readonly url: string;

  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private shutdownRequested = false;

  /** Resolves when the socket first reaches OPEN state. */
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  constructor(workerId: string, url: string = DEFAULT_BACKEND_URL) {
    this.workerId = workerId;
    this.url = url;
  }

  /**
   * Open the WebSocket connection. Resolves when the socket is OPEN.
   * Idempotent — safe to call if already connected.
   */
  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this._open();
    });

    return this.connectPromise;
  }

  private _open(): void {
    let connectUrl = this.url;
    try {
      const parsed = new URL(this.url);
      parsed.searchParams.set('token', INTERNAL_WORKER_SECRET);
      connectUrl = parsed.toString();
    } catch {
      // ignore
    }

    const ws = new WebSocket(connectUrl, {
      headers: {
        'x-worker-secret': INTERNAL_WORKER_SECRET,
      },
    });
    this.socket = ws;

    ws.on('open', () => {
      console.log(`[BackendSocket:${this.workerId}] connected to ${this.url}`);
      this.reconnectAttempts = 0;
      // Send auth frame to guarantee authenticated state
      try {
        ws.send(JSON.stringify({ type: 'auth', token: INTERNAL_WORKER_SECRET }));
      } catch {
        // ignore
      }
      this.connectResolve?.();
      this.connectResolve = null;
      this.connectReject = null;
    });

    ws.on('message', (data) => {
      // TODO(Day6): handle incoming crdt-sync frames from the server (backfill).
      console.log(`[BackendSocket:${this.workerId}] received: ${data.toString().slice(0, 120)}`);
    });

    ws.on('close', (code, reason) => {
      console.warn(
        `[BackendSocket:${this.workerId}] closed (${code} ${reason.toString()})`
      );
      this.socket = null;
      this.connectPromise = null;

      if (!this.shutdownRequested) {
        this._scheduleReconnect();
      }
    });

    ws.on('error', (err) => {
      console.error(`[BackendSocket:${this.workerId}] error: ${err.message}`);
      // On first-connect failure, reject the outer promise so callers don't hang.
      if (this.connectReject) {
        this.connectReject(err);
        this.connectResolve = null;
        this.connectReject = null;
      }
    });
  }

  private _scheduleReconnect(): void {
    if (MAX_RECONNECT_ATTEMPTS > 0 && this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[BackendSocket:${this.workerId}] max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`
      );
      return;
    }
    this.reconnectAttempts += 1;
    console.log(
      `[BackendSocket:${this.workerId}] reconnecting in ${RECONNECT_DELAY_MS}ms (attempt ${this.reconnectAttempts})`
    );
    setTimeout(() => {
      if (!this.shutdownRequested) {
        this.connectPromise = new Promise<void>((resolve, reject) => {
          this.connectResolve = resolve;
          this.connectReject = reject;
          this._open();
        });
      }
    }, RECONNECT_DELAY_MS);
  }

  /**
   * Send an agent sync envelope to the backend.
   *
   * @throws {Error} if the socket is not currently OPEN.
   */
  sendSyncMessage(envelope: AgentSyncEnvelope | Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(
        `[BackendSocket:${this.workerId}] cannot send — socket is not open`
      );
    }
    this.socket.send(JSON.stringify(envelope));
  }

  /**
   * Gracefully close the connection.  No reconnect will be attempted after this.
   */
  close(): void {
    this.shutdownRequested = true;
    this.socket?.close(1000, 'worker-shutdown');
    this.socket = null;
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

// ---- Process-wide singleton -------------------------------------------------

/**
 * Lazily created singleton for activities that need to push deltas.
 *
 * Activities import this and call `getBackendSocket().sendSyncMessage(...)`.
 * The singleton is not started by the worker bootstrap; it is created on first
 * use so the worker process does not fail to start when the backend is down.
 */
let _singleton: BackendSocket | null = null;

export function getBackendSocket(workerId = 'agent-worker'): BackendSocket {
  if (!_singleton) {
    _singleton = new BackendSocket(workerId, DEFAULT_BACKEND_URL);
  }
  return _singleton;
}
