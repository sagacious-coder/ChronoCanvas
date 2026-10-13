import { LoroDoc, VersionVector } from "loro-crdt";
import {
  AgentTaskStatus,
  PeerAwareness,
  SyncMessage,
  ByokConfig,
} from "../types/shared";

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
  docId?: string;
  peerId?: string;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
  onStatusChange?: (status: ConnectionStatus) => void;
  onStatsChange?: (stats: SyncStats) => void;
  onAgentStatusChange?: (status: AgentTaskStatus) => void;
  onRemoteAwareness?: (peer: PeerAwareness) => void;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export class LoroSyncClient {
  private doc: LoroDoc;
  private ws: WebSocket | null = null;
  private options: Required<LoroSyncOptions>;
  private status: ConnectionStatus = "disconnected";
  private stats: SyncStats = {
    bytesSent: 0,
    bytesReceived: 0,
    updatesSent: 0,
    updatesReceived: 0,
    lastSyncAt: null,
  };
  private lastVersion: VersionVector | null = null;
  private reconnectTimer: any = null;
  private isDestroyed = false;
  private unsubscribeDoc: (() => void) | null = null;

  public readonly docId: string;
  public readonly peerId: string;

  constructor(doc: LoroDoc, options: LoroSyncOptions = {}) {
    this.doc = doc;
    this.docId = options.docId || "chrono-canvas-default";
    this.peerId = options.peerId || doc.peerIdStr;

    this.options = {
      url: options.url || "ws://localhost:3001",
      docId: this.docId,
      peerId: this.peerId,
      autoReconnect: options.autoReconnect ?? true,
      reconnectIntervalMs: options.reconnectIntervalMs || 2000,
      onStatusChange: options.onStatusChange || (() => {}),
      onStatsChange: options.onStatsChange || (() => {}),
      onAgentStatusChange: options.onAgentStatusChange || (() => {}),
      onRemoteAwareness: options.onRemoteAwareness || (() => {}),
    };

    // Auto-export local changes when user types in CodeMirror
    const sub = this.doc.subscribe(() => {
      this.exportAndSendUpdate();
    });

    if (typeof sub === "function") {
      this.unsubscribeDoc = sub;
    } else if (typeof sub === "number" && typeof (this.doc as any).unsubscribe === "function") {
      this.unsubscribeDoc = () => (this.doc as any).unsubscribe(sub);
    }
  }

  private setStatus(next: ConnectionStatus) {
    if (this.status !== next) {
      this.status = next;
      this.options.onStatusChange(next);
    }
  }

  public connect() {
    if (this.isDestroyed || this.ws) return;

    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(this.options.url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.setStatus("connected");
        // Handshake: export current state to peer
        this.exportAndSendUpdate();
      };

      this.ws.onmessage = (event) => {
        // Binary CRDT updates
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          if (bytes.length > 0) {
            this.doc.import(bytes);
            this.doc.commit();
            this.lastVersion = this.doc.version();

            this.stats.bytesReceived += bytes.length;
            this.stats.updatesReceived += 1;
            this.stats.lastSyncAt = new Date();
            this.options.onStatsChange({ ...this.stats });
          }
          return;
        }

        // Text / JSON updates (crdt-sync, awareness, agent status)
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data);

            if (message.type === "crdt-sync") {
              // Ingest CRDT delta broadcasted by server (from human peer or agent worker)
              if (message.payload && typeof message.payload === "string") {
                const binary = base64ToUint8Array(message.payload);
                if (binary.length > 0) {
                  this.doc.import(binary);
                  this.doc.commit();
                  this.lastVersion = this.doc.version();

                  this.stats.bytesReceived += binary.length;
                  this.stats.updatesReceived += 1;
                  this.stats.lastSyncAt = new Date();
                  this.options.onStatsChange({ ...this.stats });
                }
              }
            } else if (message.type === "awareness-update") {
              if (message.peer) {
                this.options.onRemoteAwareness(message.peer);
              }
            } else if (message.type === "agent-task-status") {
              this.options.onAgentStatusChange(message);
            }
          } catch (err) {
            console.error("[LoroSync] Error parsing JSON frame:", err);
          }
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
      // Package into crdt-sync JSON frame required by MU server
      const syncMsg: SyncMessage = {
        type: "crdt-sync",
        docId: this.docId,
        payload: uint8ArrayToBase64(update),
        senderId: this.peerId,
        timestamp: Date.now(),
      };

      this.ws.send(JSON.stringify(syncMsg));
      this.stats.bytesSent += update.length;
      this.stats.updatesSent += 1;
      this.stats.lastSyncAt = new Date();
      this.options.onStatsChange({ ...this.stats });
    }

    return update;
  }

  public sendAwareness(peer: PeerAwareness) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      type: "awareness-update",
      docId: this.docId,
      peer,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
  }

  public dispatchAgentTask(
    prompt: string,
    simulateFailure = false,
    failureType: "syntax" | "assertion" = "syntax",
    enableSelfHealing = false,
    byokConfig?: ByokConfig,
    authToken?: string
  ) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const taskId = `task-${Date.now()}`;
    const request = {
      type: "agent-task-request",
      taskId,
      docId: this.docId,
      prompt,
      simulateFailure,
      failureType,
      enableSelfHealing,
      byokConfig,
      authToken,
      docFrontier: this.getFrontierString(),
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
