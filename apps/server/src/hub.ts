import { WebSocket } from 'ws';
import { LoroDoc, VersionVector } from 'loro-crdt';
import type { CounterSpan, ExportMode, PeerID } from 'loro-crdt';
import type { EditOrigin, SyncMessage, VersionVectorHex } from '@chronocanvas/shared-types';

/** Grace period before an empty room's LoroDoc is dropped from memory. */
export const EMPTY_ROOM_GRACE_MS = Number(process.env.CHRONO_EMPTY_ROOM_GRACE_MS ?? 30_000);

/** Sanity bound on client-supplied document ids. */
const MAX_DOC_ID_LENGTH = 128;

/**
 * ChronoCanvas — authoritative Loro CRDT relay (core write path).
 *
 * This module is deliberately side-effect free: it owns the room registry, the
 * per-room serialized write queue and the single mutation path (`applyDelta`),
 * but it never opens a socket. `index.ts` boots the WebSocket transport on top
 * of it and `EventHub.ts` multiplexes producers into it, so the same merge and
 * fan-out logic serves a browser edit and a headless agent write alike.
 *
 * The server is a full CRDT peer, not a dumb pipe. It keeps one LoroDoc per
 * document id (the source of truth) and, for every member, tracks the version
 * vector the server believes that member already holds. Every write funnels
 * through `applyDelta()`, the single place `room.doc` is mutated and the single
 * place fan-out is decided.
 *
 * Concurrency: writes to a room are serialized on a per-room promise chain
 * (`enqueue`). Loro's import/export are synchronous, so today's socket traffic
 * cannot interleave on its own; the chain is what lets an *async* producer
 * (agent worker, persistence flush, the Event Hub multiplexer) join the same
 * path without two producers ever reading a stale `serverVersion`.
 *
 * Crash policy: a malformed frame, a poisoned payload, or a socket that dies
 * mid-write must degrade that one peer — never the process. Every crossing into
 * wasm (import / export / compare / encode) and every `ws.send` is wrapped, and
 * the per-room queue swallows and logs task failures instead of surfacing an
 * unhandled rejection.
 *
 * Wire format = @chronocanvas/shared-types `SyncMessage`: JSON envelope, binary
 * Loro payload base64 in `payload`, version vector hex in `versionFrom`.
 */

/** Provenance + addressing for a single write. */
export interface DeltaOrigin {
  /** Who authored this delta — broadcast to clients on fan-out. */
  kind: EditOrigin;
  /** Stable id of the writer: a connection id, or an agent/worker id. */
  id: string;
  /** The writer's socket, when it has one; null/absent for headless producers. */
  ws?: WebSocket | null;
  /** Display name for logs (client senderId, agent id). */
  label?: string;
}

/** A participant in a room: a live socket, or a headless (agent) producer. */
interface Member {
  ws: WebSocket | null;
  /** The VersionVector the server believes this member holds. */
  vv: VersionVector;
  /** Send a full snapshot instead of an incremental diff on the next fan-out. */
  needsSnapshot: boolean;
}

// --- Room registry ----------------------------------------------------------

export class DocumentRoom {
  readonly docId: string;
  readonly doc: LoroDoc;
  /** connectionId (or agent id) -> Member. */
  readonly members: Map<string, Member>;
  /** Tail of the per-room write queue. Never rejects — see `enqueue`. */
  tail: Promise<void>;
  /** Queued-but-unfinished writes. Non-zero blocks eviction. */
  pending: number;
  /** Pending empty-room eviction timer, if any. */
  evictionTimer: ReturnType<typeof setTimeout> | null;

  constructor(docId: string) {
    this.docId = docId;
    this.doc = new LoroDoc();
    this.members = new Map();
    this.tail = Promise.resolve();
    this.pending = 0;
    this.evictionTimer = null;
  }
}

const rooms = new Map<string, DocumentRoom>();

export function getRoom(docId: string): DocumentRoom {
  let room = rooms.get(docId);
  if (!room) {
    room = new DocumentRoom(docId);
    rooms.set(docId, room);
    console.log(`[room] created "${docId}"`);
  }
  cancelEviction(room); // someone is interested again
  return room;
}

/** Look up a room without conjuring one (presence must never create a doc). */
export function peekRoom(docId: string): DocumentRoom | undefined {
  return rooms.get(docId);
}

/**
 * Empty-room eviction. A document lives only in memory, so dropping a room
 * drops its history: the grace period is what stops a page refresh or a flaky
 * connection from wiping a document that someone is about to rejoin.
 *
 * TODO(persistence): flush a snapshot to durable storage here, before the
 * `rooms.delete`, once a store exists — then the grace period can shrink.
 *
 * We deliberately do not call `room.doc.free()`. The doc is unreachable after
 * `rooms.delete`, so wasm-bindgen's FinalizationRegistry reclaims it; an
 * explicit free risks a use-after-free abort, which is precisely the class of
 * crash this module exists to avoid.
 */
export function scheduleEviction(room: DocumentRoom): void {
  if (room.evictionTimer || room.members.size > 0 || room.pending > 0) return;
  room.evictionTimer = setTimeout(() => {
    room.evictionTimer = null;
    // Re-check: a client may have rejoined, or a write landed, during the grace.
    if (room.members.size > 0 || room.pending > 0) return;
    if (rooms.get(room.docId) !== room) return; // already replaced
    rooms.delete(room.docId);
    console.log(`[room:${room.docId}] evicted (empty for ${EMPTY_ROOM_GRACE_MS}ms)`);
  }, EMPTY_ROOM_GRACE_MS);
  room.evictionTimer.unref?.(); // a pending eviction must not hold the process open
}

export function cancelEviction(room: DocumentRoom): void {
  if (!room.evictionTimer) return;
  clearTimeout(room.evictionTimer);
  room.evictionTimer = null;
}

// --- Helpers ----------------------------------------------------------------

export const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
export const fromB64 = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, 'base64'));
export const vvToHex = (vv: VersionVector): VersionVectorHex =>
  Buffer.from(vv.encode()).toString('hex');
export const hexToVV = (hex: VersionVectorHex): VersionVector =>
  VersionVector.decode(new Uint8Array(Buffer.from(hex, 'hex')));
export const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const isValidDocId = (docId: unknown): docId is string =>
  typeof docId === 'string' && docId.length > 0 && docId.length <= MAX_DOC_ID_LENGTH;

/** `ws.send` is best-effort: a dead or half-closed socket must not throw here. */
export function safeSend(ws: WebSocket | null, obj: unknown, context: string): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  let frame: string;
  try {
    frame = JSON.stringify(obj);
  } catch (err) {
    console.error(`[${context}] could not serialize outbound frame: ${errMsg(err)}`);
    return false;
  }
  try {
    ws.send(frame);
    return true;
  } catch (err) {
    console.error(`[${context}] send failed: ${errMsg(err)}`);
    return false;
  }
}

/** `doc.export` crosses into wasm and can throw on a corrupt or detached state. */
function safeExport(room: DocumentRoom, mode: ExportMode): Uint8Array | null {
  try {
    return room.doc.export(mode);
  } catch (err) {
    console.error(`[room:${room.docId}] export(${mode.mode}) failed: ${errMsg(err)}`);
    return null;
  }
}

/**
 * Advance `vv` so it covers every op span that arrived on a frame.
 *
 * This is the hard half of the zero-self-echo guarantee. Whatever version the
 * writer *claimed* in `versionFrom`, the ops it actually just handed us are
 * recorded as held, so the fan-out diff cannot contain them. A client that
 * reports a stale vector — a pre-edit one, say — still cannot be sent its own
 * ops back. Mutates `vv` in place, so only ever pass an exclusively-owned one.
 */
function coverImported(vv: VersionVector, success: Map<PeerID, CounterSpan> | null): void {
  if (!success) return;
  for (const [peer, span] of success) {
    const held = vv.get(peer) ?? 0;
    if (span.end > held) vv.setEnd({ peer, counter: span.end });
  }
}

/** Build a server->client crdt-sync envelope carrying a binary Loro payload. */
function msg(
  docId: string,
  bytes: Uint8Array,
  versionHex: VersionVectorHex,
  origin: EditOrigin,
): SyncMessage {
  return {
    type: 'crdt-sync',
    docId,
    payload: toB64(bytes),
    versionFrom: versionHex,
    senderId: 'server',
    origin,
    timestamp: Date.now(),
  };
}

// --- Per-room write queue ----------------------------------------------------

/**
 * Serialize a write against a room. Humans and (soon) Temporal agent workers
 * share one chain per room, so `serverVersion` is always read after the
 * previous write has landed — no interleaving, no lost fan-out.
 *
 * Neither the returned promise nor `room.tail` ever rejects: a failing task is
 * logged and the chain continues, instead of wedging every later write behind
 * a poisoned one (and instead of raising an unhandled rejection, which by
 * default takes the process down).
 */
export function enqueue(room: DocumentRoom, task: () => void | Promise<void>): Promise<void> {
  room.pending += 1;
  const done = room.tail
    .then(task)
    .catch((err) => {
      console.error(`[room:${room.docId}] write task failed: ${errMsg(err)}`);
    })
    .then(() => {
      room.pending -= 1;
      // The last writer out of an already-abandoned room turns off the lights.
      if (room.pending === 0 && room.members.size === 0) scheduleEviction(room);
    });
  room.tail = done;
  return done;
}

// --- Core write path ---------------------------------------------------------

/**
 * The single place `room.doc` is mutated and fan-out is decided.
 *
 * Callers must go through `enqueue(room, () => applyDelta(...))` so that
 * `serverVersion` is read only after every earlier write has landed. It is
 * independent of any WebSocket instance: `origin.ws` is optional, so a headless
 * agent producer travels exactly the same path a browser edit does.
 *
 * @param room
 * @param bytes    Binary Loro update/snapshot, or null for a join pass that
 *                 only backfills.
 * @param sourceVV VV the writer holds *after* its own edit, or null.
 * @param origin   Provenance + addressing for this write.
 */
export function applyDelta(
  room: DocumentRoom,
  bytes: Uint8Array | null,
  sourceVV: VersionVector | null,
  origin: DeltaOrigin,
): void {
  const who = origin.label ?? origin.id;
  let imported: Map<PeerID, CounterSpan> | null = null;

  // 1. Merge the incoming binary delta into the authoritative document.
  if (bytes && bytes.length > 0) {
    try {
      const status = room.doc.import(bytes);
      imported = status.success;
      if (status.pending && status.pending.size > 0) {
        console.warn(`[room:${room.docId}] update from ${who} has pending deps`);
      }
    } catch (err) {
      // Poisoned payload: drop this delta, keep the room and the process alive.
      console.error(`[room:${room.docId}] import from ${who} failed: ${errMsg(err)}`);
      return;
    }
  }

  // 2. Record where the writer now stands.
  //
  //    `sourceVV` is the version it reported *after* applying its own edit, so
  //    a diff from it already excludes the writer's own ops. `coverImported`
  //    then folds in the spans that actually arrived on this frame, closing the
  //    gap left by a client that misreports `versionFrom`.
  const self = room.members.get(origin.id);
  if (self && (sourceVV || (imported && imported.size))) {
    // Version vectors held on member records are treated as immutable — a
    // fan-out shares one instance across members — so copy before mutating.
    //
    // NOTE(loro-crdt 1.16.3 footgun): the `VersionVector` constructor's .d.ts
    // advertises a `VersionVector` overload, but at runtime passing a
    // VersionVector makes the wasm ctor fall through to its "treat the arg as a
    // Map" branch and call `.entries()` on it — a method a VersionVector does not
    // have — throwing `getObject(...).entries is not a function`. That throw
    // surfaces as "[room:…] write task failed" (enqueue's catch) and silently
    // drops the edit's fan-out. Browser frames carry no `versionFrom`, so this
    // null branch is the COMMON path, not an edge case — every human keystroke
    // hit it. Clone via an encode/decode round-trip, which copies cleanly.
    const owned = sourceVV ?? VersionVector.decode(self.vv.encode());
    coverImported(owned, imported);
    self.vv = owned;
    if (sourceVV) self.needsSnapshot = false; // it told us where it is
  }

  // 3. One fan-out pass covers everyone.
  broadcast(room, origin);
}

/** Hand every member exactly the ops it lacks. Never throws. */
function broadcast(room: DocumentRoom, origin: DeltaOrigin): void {
  let serverVersion: VersionVector;
  let serverHex: VersionVectorHex;
  try {
    serverVersion = room.doc.version();
    serverHex = vvToHex(serverVersion);
  } catch (err) {
    console.error(`[room:${room.docId}] could not read server version: ${errMsg(err)}`);
    return;
  }

  for (const [memberId, member] of room.members) {
    try {
      // Guard 1 — identity. A socket registered under a second, stale member id
      // must not be written to twice for one edit; its live record is served on
      // its own iteration. The writer's *own* record is deliberately not skipped
      // here — a cold joiner and a reconnecting peer are both "the origin" and
      // still need their backfill. Echo is ruled out by the version vectors
      // instead (see `applyDelta` step 2).
      const isOriginRecord = memberId === origin.id;
      const isOriginSocket = !!origin.ws && member.ws === origin.ws;
      if (isOriginSocket && !isOriginRecord) continue;

      // Guard 2 — version vectors. `compare` returns -1 / 0 / 1, or undefined
      // when the two versions are concurrent (neither dominates the other).
      const cmp = member.vv.compare(serverVersion);

      if (cmp === 0) {
        member.needsSnapshot = false; // holds exactly what the server holds
        continue;
      }

      if (cmp !== -1) {
        // 1         -> claims ops the server has never seen.
        // undefined -> diverged concurrently.
        // Either way an incremental diff from that VV is meaningless, so
        // re-seed the member with a full snapshot. Note this only heals
        // server -> member; ops the *server* is missing arrive on the member's
        // next push. TODO(resync): an explicit resync-request frame would make
        // that recovery deterministic rather than opportunistic.
        const reason = cmp === undefined ? 'diverged (concurrent)' : 'is ahead of the server';
        console.warn(`[room:${room.docId}] ${memberId} ${reason} — re-seeding with a snapshot`);
        member.needsSnapshot = true;
      }

      const delta = member.needsSnapshot
        ? safeExport(room, { mode: 'snapshot' }) // compact cold-start / resync
        : safeExport(room, { mode: 'update', from: member.vv });

      // Export failed: leave this member's VV untouched so the next write retries.
      if (!delta) continue;

      const envelope = msg(room.docId, delta, serverHex, origin.kind);
      if (!safeSend(member.ws, envelope, `room:${room.docId}/${memberId}`)) continue;

      member.vv = serverVersion; // assumes ordered, reliable WS delivery
      member.needsSnapshot = false;
    } catch (err) {
      // One bad member must not abort the fan-out for the rest of the room.
      console.error(`[room:${room.docId}] fan-out to ${memberId} failed: ${errMsg(err)}`);
    }
  }
}

/**
 * Public seam for producers that are not WebSocket clients — Temporal agent
 * workers, and the Event Hub multiplexer — so they travel the same queue, merge
 * and fan-out path a browser edit does. Because this module has no side effects
 * on import, it is safe to call from any app in the workspace.
 */
export function submitDelta(
  docId: string,
  bytes: Uint8Array | null,
  sourceVV: VersionVector | null,
  origin: DeltaOrigin,
): Promise<void> {
  const room = getRoom(docId);
  return enqueue(room, () => applyDelta(room, bytes, sourceVV, origin));
}
