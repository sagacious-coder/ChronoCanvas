import type { WebSocket } from 'ws';
import type { VersionVector } from 'loro-crdt';
import { submitDelta, type DeltaOrigin } from './hub.js';

/**
 * ChronoCanvas Event Hub — the multiplexer named by the Day 3 objective:
 * "multiplex human edits and agent writes across active client connections".
 *
 * Two classes of producer feed one document:
 *   - **humans** — browser sockets pushing `crdt-sync` frames (see `index.ts`);
 *   - **agents** — headless Temporal workers with no socket, committing writes
 *     out of band (the future `apps/agent-worker`).
 *
 * Both are funnelled into the *same* authoritative write path — `submitDelta`,
 * and through it the single `applyDelta` mutation point — so an agent write and
 * a human edit merge, serialize on the per-room queue, and fan out through one
 * code path. The only thing the Hub adds is provenance: it stamps each write
 * with `kind` ('human' | 'agent'), which `broadcast` then puts on the outbound
 * `SyncMessage.origin` field so every client can tell who authored a change.
 *
 * The write path is injected (defaulting to `submitDelta`) so the Hub can be
 * unit-tested against a fake sink without booting the WebSocket server.
 */

/** A browser client: has a live socket the fan-out can address and self-skip. */
export interface HumanProducer {
  /** The client's connection id — its member key in the room. */
  connId: string;
  /** The live socket. */
  ws: WebSocket;
  /** Display name for logs (the client's `senderId`). */
  label?: string;
}

/** A headless agent/worker: identified by task or worker id, with no socket. */
export interface AgentProducer {
  /** Stable id of the agent or task — its member key in the room. */
  agentId: string;
  /** Display name for logs. */
  label?: string;
}

/** The write sink the Hub multiplexes into. Matches `submitDelta`'s shape. */
export type DeltaSink = (
  docId: string,
  bytes: Uint8Array | null,
  sourceVV: VersionVector | null,
  origin: DeltaOrigin,
) => Promise<void>;

export class EventHub {
  private readonly sink: DeltaSink;

  constructor(sink: DeltaSink = submitDelta) {
    this.sink = sink;
  }

  /**
   * Ingest a delta that arrived on a browser socket. Tagged `kind: 'human'` and
   * carrying `ws`, so the fan-out can serve this member its backfill while the
   * identity guard prevents a duplicate write to the same socket.
   */
  submitHumanDelta(
    docId: string,
    bytes: Uint8Array | null,
    sourceVV: VersionVector | null,
    from: HumanProducer,
  ): Promise<void> {
    return this.sink(docId, bytes, sourceVV, {
      kind: 'human',
      id: from.connId,
      ws: from.ws,
      label: from.label ?? from.connId,
    });
  }

  /**
   * Ingest a delta produced out of band by an agent worker. Tagged
   * `kind: 'agent'` with no socket (`ws: null`), so it merges and fans out to
   * every human member exactly like a peer edit — clients see `origin: 'agent'`.
   */
  submitAgentDelta(
    docId: string,
    bytes: Uint8Array | null,
    sourceVV: VersionVector | null,
    from: AgentProducer,
  ): Promise<void> {
    return this.sink(docId, bytes, sourceVV, {
      kind: 'agent',
      id: from.agentId,
      ws: null,
      label: from.label ?? from.agentId,
    });
  }
}

/** Process-wide multiplexer shared by the WS transport and agent producers. */
export const eventHub = new EventHub();
