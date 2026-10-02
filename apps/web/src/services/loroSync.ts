import { LoroDoc, VersionVector } from "loro-crdt";
import {
  ChronoWebSocketMessage,
  AgentTaskRequest,
  AgentTaskStatus,
  PeerAwareness,
  SyncMessage,
} from "@chronocanvas/shared-types";

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
  /** The Loro document room id to join. Must match the server-side room. */
  docId?: string;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
  onStatusChange?: (status: ConnectionStatus) => void;
  onStatsChange?: (stats: SyncStats) => void;
  onAgentStatusChange?: (status: AgentTaskStatus) => void;
  onRemoteAwareness?: (peer: PeerAwareness) => void;
}

export class LoroSyncClient {
  private doc: LoroDoc;
  private url: string;
  /** Room id sent in every crdt-sync frame so the server can route to the right DocumentRoom. */
  private docId: string;
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
    this.docId = options.docId || "chrono-canvas-default";
    this.options = {
      url: this.url,
      docId: this.docId,
      autoReconnect: options.autoReconnect ?? true,
      reconnectIntervalMs: options.reconnectIntervalMs ?? 3000,
      onStatusChange: options.onStatusChange || (() => {}),
      onStatsChange: options.onStatsChange || (() => {}),
      onAgentStatusChange: options.onAgentStatusChange || (() => {}),
      onRemoteAwareness: options.onRemoteAwareness || (() => {}),
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
      // Do NOT set binaryType — the server sends JSON-enveloped crdt-sync frames
      // (base64 payload), never raw binary. Keeping the default "blob" type means
      // we won't accidentally try to import a JSON string as Loro bytes.

      this.ws.onopen = () => {
        this.setStatus("connected");
        // Send the current snapshot as a crdt-sync JSON frame so the server can
        // register this connection in the correct DocumentRoom and seed its LoroDoc.
        // Raw binary frames are rejected by the server (no docId to route them).
        const snapshot = this.doc.export({ mode: "snapshot" });
        if (snapshot.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
          this.sendCrdtFrame(snapshot);
        }
      };

      this.ws.onmessage = (event) => {
        // The server always sends JSON-framed messages — never raw binary.
        if (typeof event.data !== "string") {
          console.warn("[LoroSync] Unexpected non-string frame from server, ignoring.");
          return;
        }

        try {
          const message = JSON.parse(event.data);
          if (message.type === "crdt-sync") {
            // Decode the base64 payload and import the Loro delta/snapshot.
            const binary = Uint8Array.from(atob(message.payload), (c) => c.charCodeAt(0));
            if (binary.length > 0) {
              this.doc.import(binary);
              this.doc.commit();
              this.lastVersion = this.doc.version();
              this.stats.bytesReceived += binary.length;
              this.stats.updatesReceived += 1;
              this.stats.lastSyncAt = new Date();
              this.options.onStatsChange({ ...this.stats });
            }
          } else if (message.type === "awareness-update") {
            this.options.onRemoteAwareness(message.peer);
          } else if (message.type === "agent-task-status") {
            this.options.onAgentStatusChange(message);
          } else if (message.type === "agent-token-stream") {
            // Ingest streaming token from AI worker into Loro document.
            // Must target the "codemirror" container — the single canonical text
            // container owned by loro-codemirror's LoroSyncPlugin — or streamed
            // tokens land in an isolated container the editor never reads.
            if (message.chunk) {
              const text = this.doc.getText("codemirror");
              text.insert(text.length, message.chunk);
              this.doc.commit();
            }
          }
        } catch (err) {
          console.error("[LoroSync] Error handling server message:", err);
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

  public exportAndSendUpdate(): Uint8Array | null {
    const update = this.lastVersion
      ? this.doc.export({ mode: "update", from: this.lastVersion })
      : this.doc.export({ mode: "update" });

    this.lastVersion = this.doc.version();

    if (!update || update.length === 0) {
      return null;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendCrdtFrame(update);
    }

    return update;
  }

  /**
   * Encode `bytes` as base64 and send a `crdt-sync` JSON frame to the server.
   *
   * Every outbound CRDT payload — both the cold-join snapshot on `onopen` and
   * every incremental update from `exportAndSendUpdate` — must go through here
   * so the server can route it to the correct `DocumentRoom` via `docId`.
   * Sending raw binary frames is rejected server-side because there is no field
   * to carry the `docId` in an unstructured byte stream.
   */
  private sendCrdtFrame(bytes: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Safe base64 encoding for arbitrary-size Uint8Arrays.
    // btoa(String.fromCharCode(...bytes)) uses spread which overflows the JS
    // call stack for arrays larger than ~65 k elements. Chunking avoids this.
    const CHUNK = 8192;
    let b64 = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    b64 = btoa(b64);

    const frame: SyncMessage = {
      type: "crdt-sync",
      docId: this.docId,
      payload: b64,
      senderId: this.doc.peerIdStr,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(frame));
    this.stats.bytesSent += bytes.length;
    this.stats.updatesSent += 1;
    this.stats.lastSyncAt = new Date();
    this.options.onStatsChange({ ...this.stats });
  }

  public sendAwareness(peer: PeerAwareness) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message: ChronoWebSocketMessage = {
      type: "awareness-update",
      docId: this.docId,
      peer,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
  }

  public dispatchAgentTask(prompt: string, simulateFailure = false) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const frontiers = this.doc.frontiers();
    const frontierStr = JSON.stringify(frontiers);

    const taskId = `task-${Date.now()}`;
    const request: AgentTaskRequest & { simulateFailure?: boolean; docId: string } = {
      type: "agent-task-request",
      taskId,
      docId: this.docId,
      prompt,
      docFrontier: frontierStr,
      simulateFailure,
    };

    this.ws.send(JSON.stringify(request));
  }

  public getFrontierString(): string {
    const f = this.doc.frontiers();
    return f.length > 0 ? JSON.stringify(f) : "root-0";
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
