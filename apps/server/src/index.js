import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { LoroDoc, VersionVector } from 'loro-crdt';

const PORT = Number(process.env.PORT ?? 8080);

/** Grace period before an empty room's LoroDoc is dropped from memory. */
const EMPTY_ROOM_GRACE_MS = Number(process.env.CHRONO_EMPTY_ROOM_GRACE_MS ?? 30_000);

/** Sanity bound on client-supplied document ids. */
const MAX_DOC_ID_LENGTH = 128;

/**
 * ChronoCanvas — authoritative Loro CRDT relay.
 *
 * The server is a full CRDT peer, not a dumb pipe. It keeps one LoroDoc per
 * document id (the source of truth) and, for every member, tracks the version
 * vector the server believes that member already holds. Every write — whether
 * it arrives on a browser socket or, later, from a Temporal agent worker —
 * funnels through `applyDelta()`, the single place `room.doc` is mutated and
 * the single place fan-out is decided.
 *
 * Concurrency: writes to a room are serialized on a per-room promise chain
 * (`enqueue`). Loro's import/export are synchronous, so today's socket traffic
 * cannot interleave on its own; the chain is what lets an *async* producer
 * (agent worker, persistence flush, the upcoming Event Hub multiplexer) join
 * the same path without two producers ever reading a stale `serverVersion`.
 *
 * Why it never echoes or loops — two independent guards:
 *  - Identity: one socket is never written to twice for a single edit, even if
 *    it is registered under a stale second member id.
 *  - Version vectors: a member is handed only the ops its VV lacks, and the
 *    writer's VV is advanced to cover the op spans that arrived on its own
 *    frame — so it cannot be handed its own ops back even if it misreports its
 *    version. Note the writer is NOT skipped outright: a cold joiner and a
 *    reconnecting peer are both "the origin" and still need their backfill.
 *  - Propagation is driven by "someone wrote", never by "the server imported" —
 *    importing yields nothing to forward, so updates converge. (Clients must
 *    likewise broadcast only *local* edits: use the client-side
 *    `doc.subscribeLocalUpdates()`, not `subscribe()`.)
 *
 * Crash policy: a malformed frame, a poisoned payload, or a socket that dies
 * mid-write must degrade that one peer — never the process. Every crossing
 * into wasm (import / export / compare / encode) and every `ws.send` is
 * wrapped, and the per-room queue swallows and logs task failures instead of
 * surfacing an unhandled rejection.
 *
 * Wire format = @chronocanvas/shared-types `SyncMessage`: JSON envelope,
 * binary Loro payload base64 in `payload`, version vector hex in `versionFrom`.
 */

// --- Room registry ----------------------------------------------------------

class DocumentRoom {
  constructor(docId) {
    this.docId = docId;
    this.doc = new LoroDoc();
    /**
     * connectionId -> {
     *   ws:            the socket, or null for a headless producer (agent);
     *   vv:            the VersionVector the server believes this member holds;
     *   needsSnapshot: send a full snapshot instead of an incremental diff.
     * }
     */
    this.members = new Map();
    /** Tail of the per-room write queue. Never rejects — see `enqueue`. */
    this.tail = Promise.resolve();
    /** Queued-but-unfinished writes. Non-zero blocks eviction. */
    this.pending = 0;
    /** Pending empty-room eviction timer, if any. */
    this.evictionTimer = null;
  }
}

/** @type {Map<string, DocumentRoom>} */
const rooms = new Map();

export function getRoom(docId) {
  let room = rooms.get(docId);
  if (!room) {
    room = new DocumentRoom(docId);
    rooms.set(docId, room);
    console.log(`[room] created "${docId}"`);
  }
  cancelEviction(room); // someone is interested again
  return room;
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
function scheduleEviction(room) {
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

function cancelEviction(room) {
  if (!room.evictionTimer) return;
  clearTimeout(room.evictionTimer);
  room.evictionTimer = null;
}

// --- Helpers ----------------------------------------------------------------

const toB64 = (bytes) => Buffer.from(bytes).toString('base64');
const fromB64 = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));
const vvToHex = (vv) => Buffer.from(vv.encode()).toString('hex');
const hexToVV = (hex) => VersionVector.decode(new Uint8Array(Buffer.from(hex, 'hex')));
const errMsg = (err) => (err instanceof Error ? err.message : String(err));

const isValidDocId = (docId) =>
  typeof docId === 'string' && docId.length > 0 && docId.length <= MAX_DOC_ID_LENGTH;

/** `ws.send` is best-effort: a dead or half-closed socket must not throw here. */
function safeSend(ws, obj, context) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  let frame;
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
function safeExport(room, mode) {
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
function coverImported(vv, success) {
  if (!success) return;
  for (const [peer, span] of success) {
    const held = vv.get(peer) ?? 0;
    if (span.end > held) vv.setEnd({ peer, counter: span.end });
  }
}

/** Build a server->client crdt-sync envelope carrying a binary Loro payload. */
function msg(docId, bytes, versionHex) {
  return {
    type: 'crdt-sync',
    docId,
    payload: toB64(bytes),
    versionFrom: versionHex,
    senderId: 'server',
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
export function enqueue(room, task) {
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
 * @typedef {Object} DeltaOrigin
 * @property {string} id      Stable id of the writer: a connection id, or an
 *                            agent/worker id for headless producers.
 * @property {*}      [ws]    The writer's socket, when it has one.
 * @property {string} [label] Display name for logs (client senderId, agent id).
 */

/**
 * The single place `room.doc` is mutated and fan-out is decided.
 *
 * Callers must go through `enqueue(room, () => applyDelta(...))` so that
 * `serverVersion` is read only after every earlier write has landed.
 *
 * @param {DocumentRoom}       room
 * @param {Uint8Array|null}    bytes    Binary Loro update/snapshot, or null for
 *                                      a join pass that only backfills.
 * @param {VersionVector|null} sourceVV VV the writer holds *after* its own edit.
 * @param {DeltaOrigin}        origin
 */
export function applyDelta(room, bytes, sourceVV, origin) {
  const who = origin.label ?? origin.id;
  /** @type {Map<string, { start: number, end: number }>|null} */
  let imported = null;

  // 1. Merge the incoming binary delta into the authoritative document.
  if (bytes && bytes.length > 0) {
    try {
      const status = room.doc.import(bytes);
      imported = status?.success ?? null;
      if (status?.pending && status.pending.size > 0) {
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
  if (self && (sourceVV || imported?.size)) {
    // Version vectors held on member records are treated as immutable — a
    // fan-out shares one instance across members — so copy before mutating.
    const owned = sourceVV ?? new VersionVector(self.vv);
    coverImported(owned, imported);
    self.vv = owned;
    if (sourceVV) self.needsSnapshot = false; // it told us where it is
  }

  // 3. One fan-out pass covers everyone.
  broadcast(room, origin);
}

/** Hand every member exactly the ops it lacks. Never throws. */
function broadcast(room, origin) {
  let serverVersion;
  let serverHex;
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

      const envelope = msg(room.docId, delta, serverHex);
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
 * workers, and the Event Hub multiplexer — so they travel the same queue,
 * merge and fan-out path a browser edit does.
 *
 * NOTE: importing this module also boots the WebSocket server below. Lift the
 * room registry, the queue and the write path into their own module before
 * importing them from another app.
 */
export function submitDelta(docId, bytes, sourceVV, origin) {
  const room = getRoom(docId);
  return enqueue(room, () => applyDelta(room, bytes, sourceVV, origin));
}

// --- Server bootstrap --------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });
console.log(`🚀 ChronoCanvas WebSocket Server running on ws://localhost:${PORT}`);

wss.on('connection', (ws, request) => {
  const connId = randomUUID();
  ws.connId = connId;
  ws.joinedRooms = new Set();
  console.log(`[+] client ${connId} connected from ${request.socket.remoteAddress}`);

  ws.on('message', (data) => {
    // Outermost crash boundary: nothing a client sends may take the process down.
    try {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (err) {
        console.error(`[${connId}] bad JSON: ${errMsg(err)}`);
        return;
      }
      if (!message || typeof message !== 'object') {
        console.warn(`[${connId}] frame is not a JSON object`);
        return;
      }
      if (message.type === 'crdt-sync') handleCrdtSync(ws, message);
      else if (message.type === 'awareness-update') handleAwareness(ws, message);
      else console.log(`[${connId}] unknown message type: ${message.type}`);
    } catch (err) {
      console.error(`[${connId}] message handler crashed: ${errMsg(err)}`);
    }
  });

  ws.on('close', () => {
    for (const docId of ws.joinedRooms) {
      const room = rooms.get(docId);
      if (!room) continue;
      room.members.delete(connId);
      if (room.members.size === 0) {
        console.log(`[room:${docId}] empty — eviction in ${EMPTY_ROOM_GRACE_MS}ms`);
        scheduleEviction(room); // no-ops while writes are still queued
      }
    }
    ws.joinedRooms.clear();
    console.log(`[-] client ${connId} disconnected`);
  });

  ws.on('error', (err) => console.error(`[${connId}] socket error: ${errMsg(err)}`));
});

// --- crdt-sync ---------------------------------------------------------------
// Thin transport adapter: validate the frame, register membership, decode the
// binary payload, then hand the real work to the queued write path.

function handleCrdtSync(ws, message) {
  const { docId, payload, versionFrom, senderId } = message;
  if (!isValidDocId(docId)) {
    return void console.warn(`[${ws.connId}] crdt-sync with a missing or oversized docId`);
  }

  const room = getRoom(docId);

  // Membership is mutated synchronously here and in `close`, so join/leave
  // ordering stays consistent with the socket lifecycle. Only the document
  // itself is touched inside the queue.
  if (!room.members.has(ws.connId)) {
    room.members.set(ws.connId, {
      ws,
      vv: new VersionVector(undefined),
      // A peer that arrives without a version vector has no known position in
      // history: seed it with a compact snapshot rather than a diff from zero.
      needsSnapshot: !versionFrom,
    });
    ws.joinedRooms.add(docId);
    console.log(`[room:${docId}] ${ws.connId} joined (${room.members.size} member(s))`);
  }

  let bytes = null;
  if (typeof payload === 'string' && payload.length > 0) {
    try {
      bytes = fromB64(payload);
    } catch (err) {
      return void console.error(
        `[room:${docId}] undecodable payload from ${ws.connId}: ${errMsg(err)}`,
      );
    }
  }

  let sourceVV = null;
  if (typeof versionFrom === 'string' && versionFrom.length > 0) {
    try {
      sourceVV = hexToVV(versionFrom);
    } catch (err) {
      // We no longer know where this peer stands: fall back to a full snapshot
      // rather than diffing against a version vector we failed to parse.
      console.error(`[room:${docId}] bad versionFrom from ${ws.connId}: ${errMsg(err)}`);
      const member = room.members.get(ws.connId);
      if (member) member.needsSnapshot = true;
    }
  }

  const origin = { id: ws.connId, ws, label: senderId ?? ws.connId };
  enqueue(room, () => applyDelta(room, bytes, sourceVV, origin));
}

// --- awareness-update --------------------------------------------------------
// Presence and cursors are ephemeral — never part of the CRDT — so they bypass
// the write queue entirely and relay straight to the other members of the
// document the frame names.

function handleAwareness(ws, message) {
  const { docId, peer, timestamp } = message;
  if (!isValidDocId(docId)) {
    return void console.warn(`[${ws.connId}] awareness-update with a missing or oversized docId`);
  }

  // `rooms.get`, not `getRoom`: presence must never conjure a document, or a
  // peer could spray rooms into existence without ever syncing one.
  const room = rooms.get(docId);
  if (!room) return;

  // Re-serialize rather than forwarding the client's frame verbatim, so a peer
  // cannot smuggle extra fields through the relay.
  const frame = {
    type: 'awareness-update',
    docId,
    peer,
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
  };

  for (const [memberId, member] of room.members) {
    if (memberId === ws.connId || member.ws === ws) continue;
    safeSend(member.ws, frame, `room:${docId}/${memberId}`);
  }
}
