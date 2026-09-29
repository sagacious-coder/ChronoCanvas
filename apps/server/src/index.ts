import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { VersionVector } from 'loro-crdt';
import {
  EMPTY_ROOM_GRACE_MS,
  getRoom,
  peekRoom,
  scheduleEviction,
  isValidDocId,
  fromB64,
  hexToVV,
  safeSend,
  errMsg,
} from './hub.js';
import { eventHub } from './EventHub.js';

/**
 * ChronoCanvas WebSocket transport.
 *
 * This module is the browser-facing edge: it validates frames, tracks socket
 * membership, decodes payloads, and hands every edit to the Event Hub, which
 * multiplexes it (alongside agent writes) into the authoritative write path in
 * `hub.ts`. It holds no CRDT logic of its own — that lives in `hub.ts` so an
 * agent worker can reuse it without booting a socket server.
 */

const PORT = Number(process.env.PORT ?? 8080);

/** A live client socket, tagged with its identity and room membership. */
type ClientSocket = WebSocket & { connId: string; joinedRooms: Set<string> };

const wss = new WebSocketServer({ port: PORT });
console.log(`🚀 ChronoCanvas WebSocket Server running on ws://localhost:${PORT}`);

wss.on('connection', (socket: WebSocket, request) => {
  const ws = socket as ClientSocket;
  const connId = randomUUID();
  ws.connId = connId;
  ws.joinedRooms = new Set<string>();
  console.log(`[+] client ${connId} connected from ${request.socket.remoteAddress}`);

  ws.on('message', (data) => {
    // Outermost crash boundary: nothing a client sends may take the process down.
    try {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch (err) {
        console.error(`[${connId}] bad JSON: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (!message || typeof message !== 'object') {
        console.warn(`[${connId}] frame is not a JSON object`);
        return;
      }
      const frame = message as Record<string, unknown>;
      if (frame.type === 'crdt-sync') handleCrdtSync(ws, frame);
      else if (frame.type === 'awareness-update') handleAwareness(ws, frame);
      else console.log(`[${connId}] unknown message type: ${String(frame.type)}`);
    } catch (err) {
      console.error(`[${connId}] message handler crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ws.on('close', () => {
    for (const docId of ws.joinedRooms) {
      const room = peekRoom(docId);
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

  ws.on('error', (err) => console.error(`[${connId}] socket error: ${err.message}`));
});

// --- crdt-sync ---------------------------------------------------------------
// Thin transport adapter: validate the frame, register membership, decode the
// binary payload, then hand the real work to the Event Hub, which funnels it
// (as a `human` write) into the same queued write path an agent write travels.

function handleCrdtSync(ws: ClientSocket, message: Record<string, unknown>): void {
  const docId = message.docId;
  if (!isValidDocId(docId)) {
    return void console.warn(`[${ws.connId}] crdt-sync with a missing or oversized docId`);
  }

  const room = getRoom(docId);
  const versionFrom = typeof message.versionFrom === 'string' ? message.versionFrom : undefined;

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

  let bytes: Uint8Array | null = null;
  const payload = message.payload;
  if (typeof payload === 'string' && payload.length > 0) {
    try {
      bytes = fromB64(payload);
    } catch (err) {
      return void console.error(
        `[room:${docId}] undecodable payload from ${ws.connId}: ${errMsg(err)}`,
      );
    }
  }

  let sourceVV: VersionVector | null = null;
  if (versionFrom && versionFrom.length > 0) {
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

  const senderId = typeof message.senderId === 'string' ? message.senderId : undefined;
  // Route through the Event Hub: it stamps `kind: 'human'` and the origin is
  // broadcast on the outbound frame so clients can tell the write apart from an
  // agent's. The Hub converges on the same per-room queue + `applyDelta`.
  void eventHub.submitHumanDelta(docId, bytes, sourceVV, {
    connId: ws.connId,
    ws,
    label: senderId ?? ws.connId,
  });
}

// --- awareness-update --------------------------------------------------------
// Presence and cursors are ephemeral — never part of the CRDT — so they bypass
// the write queue entirely and relay straight to the other members of the
// document the frame names.

function handleAwareness(ws: ClientSocket, message: Record<string, unknown>): void {
  const docId = message.docId;
  if (!isValidDocId(docId)) {
    return void console.warn(`[${ws.connId}] awareness-update with a missing or oversized docId`);
  }

  // `peekRoom`, not `getRoom`: presence must never conjure a document, or a
  // peer could spray rooms into existence without ever syncing one.
  const room = peekRoom(docId);
  if (!room) return;

  // Re-serialize rather than forwarding the client's frame verbatim, so a peer
  // cannot smuggle extra fields through the relay.
  const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
  const frame = {
    type: 'awareness-update',
    docId,
    peer: message.peer,
    timestamp,
  };

  for (const [memberId, member] of room.members) {
    if (memberId === ws.connId || member.ws === ws) continue;
    safeSend(member.ws, frame, `room:${docId}/${memberId}`);
  }
}
