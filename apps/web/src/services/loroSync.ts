import { LoroDoc, VersionVector } from "loro-crdt";

/**
 * Wire contract — mirrors `SyncMessage` in `@chronocanvas/shared-types`
 * (the Day 1 freeze). The server speaks this JSON envelope on every frame:
 * a base64 Loro payload in `payload`, a hex-encoded VersionVector in
 * `versionFrom`, and an `origin` flag the Event Hub stamps on fan-out so a
 * peer edit can be told apart from an agent write. Keep this aligned with the
 * shared-types package — raw binary over the socket is no longer valid.
 */
type EditOrigin = "human" | "agent";

interface SyncMessage {
  type: "crdt-sync";
  docId: string;
  versionFrom?: string;
  payload: string; // base64-encoded binary Loro delta/snapshot
  senderId: string;
  origin?: EditOrigin;
  timestamp: number;
}

// Browser-safe binary <-> base64. Chunked so a large snapshot cannot overflow
// the call stack through a spread into String.fromCharCode.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Hex encoding for the VersionVector, matching the server's `vvToHex`
// (Buffer.from(vv.encode()).toString('hex')).
function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

export interface SyncStats {
  bytesSent: number;
  bytesReceived: number;
  updatesSent: number;
  updatesReceived: number;
  lastSyncAt: Date | null;
}

export interface LoroSyncOptions {
  url?: string;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
  /** Room id; every peer of the same document must share it. */
  docId?: string;
  /** Sender identity, surfaced in the server's logs and `SyncMessage.senderId`. */
  senderId?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onStatsChange?: (stats: SyncStats) => void;
}

export class LoroSyncClient {
  private doc: LoroDoc;
  private url: string;
  private ws: WebSocket | null = null;
  private lastVersion: VersionVector | undefined;
  private unsubscribeDoc: (() => void) | null = null;
  private reconnectTimer: any = null;
  private isDestroyed = false;

  public status: ConnectionStatus = "disconnected";
  public stats: SyncStats = {
    bytesSent: 0,
    bytesReceived: 0,
    updatesSent: 0,
    updatesReceived: 0,
    lastSyncAt: null,
  };

  private options: Required<LoroSyncOptions>;

  constructor(doc: LoroDoc, options: LoroSyncOptions = {}) {
    this.doc = doc;
    this.url = options.url || "ws://localhost:3001";
    this.options = {
      url: this.url,
      autoReconnect: options.autoReconnect ?? true,
      reconnectIntervalMs: options.reconnectIntervalMs ?? 3000,
      docId: options.docId ?? "chrono-canvas-default",
      senderId: options.senderId ?? doc.peerIdStr,
      onStatusChange: options.onStatusChange || (() => {}),
      onStatsChange: options.onStatsChange || (() => {}),
    };

    // Initialize baseline version vector
    this.lastVersion = this.doc.version();
    this.setupDocSubscription();
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange(status);
  }

  private setupDocSubscription() {
    // Listen for changes made to the Loro document
    const sub = this.doc.subscribe((event) => {
      // Export only local changes to prevent reflection loops
      if (event.by === "local") {
        this.exportAndSendUpdate();
      }
    });

    if (typeof sub === "function") {
      this.unsubscribeDoc = sub;
    } else if (typeof sub === "number" && typeof (this.doc as any).unsubscribe === "function") {
      this.unsubscribeDoc = () => (this.doc as any).unsubscribe(sub);
    }
  }

  public connect() {
    if (this.isDestroyed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.setStatus("connected");
        // Announce ourselves so the server registers this socket as a room
        // member and backfills the current document, and push whatever local
        // state we already hold. Both travel as the shared SyncMessage
        // envelope — never raw binary. An empty payload is still a valid join.
        const snapshot = this.doc.export({ mode: "snapshot" });
        const versionFrom = bytesToHex(this.doc.version().encode());
        this.sendSync(snapshot.length > 0 ? snapshot : null, versionFrom);
        // Advance the checkpoint so a local edit exports only new ops from here.
        this.lastVersion = this.doc.version();
      };

      this.ws.onmessage = async (event) => {
        // The server now speaks JSON SyncMessage frames (text), not raw binary.
        // Decode to a string first, tolerating the odd ArrayBuffer/Blob delivery.
        let raw: string;
        if (typeof event.data === "string") {
          raw = event.data;
        } else if (event.data instanceof ArrayBuffer) {
          raw = new TextDecoder().decode(event.data);
        } else if (event.data instanceof Blob) {
          raw = await event.data.text();
        } else {
          return;
        }

        let message: SyncMessage;
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || parsed.type !== "crdt-sync" || typeof parsed.payload !== "string") {
            return;
          }
          message = parsed as SyncMessage;
        } catch (err) {
          console.error("[LoroSync] Ignoring non-JSON frame:", err);
          return;
        }

        // A join/backfill pass may carry no ops.
        if (message.payload.length === 0) return;

        let update: Uint8Array;
        try {
          update = base64ToBytes(message.payload);
        } catch (err) {
          console.error("[LoroSync] Undecodable payload:", err);
          return;
        }
        if (update.length === 0) return;

        try {
          // Ingest incoming server delta
          this.doc.import(update);
          this.doc.commit();

          // Advance local version vector checkpoint so local edits don't re-export server bytes
          this.lastVersion = this.doc.version();

          this.stats.bytesReceived += update.length;
          this.stats.updatesReceived += 1;
          this.stats.lastSyncAt = new Date();
          this.options.onStatsChange({ ...this.stats });

          // `origin` ('human' | 'agent') rides on every server frame so the UI
          // can later tint agent-authored changes distinctly from peer edits.
          void message.origin;
        } catch (err) {
          console.error("[LoroSync] Error importing remote delta:", err);
        }
      };

      this.ws.onerror = () => {
        this.setStatus("error");
      };

      this.ws.onclose = () => {
        this.setStatus("disconnected");
        this.ws = null;
        if (this.options.autoReconnect && !this.isDestroyed) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            this.connect();
          }, this.options.reconnectIntervalMs);
        }
      };
    } catch {
      this.setStatus("error");
    }
  }

  /**
   * Wrap a binary Loro update/snapshot in the shared `SyncMessage` envelope and
   * send it. `bytes === null` (or empty) still sends a valid join/heartbeat
   * frame carrying only `versionFrom`, which the server needs to register
   * membership and place this peer in history. Stats count the binary payload,
   * not the JSON overhead, so telemetry stays comparable to the raw-byte era.
   */
  private sendSync(bytes: Uint8Array | null, versionFrom: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    const message: SyncMessage = {
      type: "crdt-sync",
      docId: this.options.docId,
      versionFrom,
      payload: bytes && bytes.length > 0 ? bytesToBase64(bytes) : "",
      senderId: this.options.senderId,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));

    if (bytes && bytes.length > 0) {
      this.stats.bytesSent += bytes.length;
      this.stats.updatesSent += 1;
      this.stats.lastSyncAt = new Date();
      this.options.onStatsChange({ ...this.stats });
    }
    return true;
  }

  public exportAndSendUpdate(): Uint8Array | null {
    // Export compact binary update since the last version vector
    const update = this.lastVersion
      ? this.doc.export({ mode: "update", from: this.lastVersion })
      : this.doc.export({ mode: "update" });

    // Advance baseline version checkpoint
    this.lastVersion = this.doc.version();

    if (!update || update.length === 0) {
      return null;
    }

    // `versionFrom` is our version *after* this edit, so the diff the server
    // sends back to us can never echo these ops (see SyncMessage.versionFrom).
    this.sendSync(update, bytesToHex(this.doc.version().encode()));

    return update;
  }

  public disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  public destroy() {
    this.isDestroyed = true;
    this.disconnect();
    if (this.unsubscribeDoc) {
      this.unsubscribeDoc();
      this.unsubscribeDoc = null;
    }
  }
}
