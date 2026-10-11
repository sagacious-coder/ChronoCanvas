import { LoroDoc, VersionVector } from "loro-crdt";
import {
  AgentTaskStatus,
  PeerAwareness,
  SyncMessage,
  AuthMessage,
  AuthSuccessMessage,
  AuthErrorMessage,
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
  authToken?: string;
  apiKey?: string;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
  onStatusChange?: (status: ConnectionStatus) => void;
  onStatsChange?: (stats: SyncStats) => void;
  onAgentStatusChange?: (status: AgentTaskStatus) => void;
  onRemoteAwareness?: (peer: PeerAwareness) => void;
  onAuthSuccess?: (msg: AuthSuccessMessage) => void;
  onAuthError?: (msg: AuthErrorMessage) => void;
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
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class LoroSyncClient {
  private doc: LoroDoc;
  private url: string;
  private docId: string;
  private peerId: string;
  private authToken: string;
  private apiKey?: string;
  private ws: WebSocket | null = null;
  private lastVersion: VersionVector | undefined;
  private unsubscribeDoc: (() => void) | null = null;
  private reconnectTimer: any = null;
  private isDestroyed = false;

  public isAuthenticated = false;
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
    this.peerId = options.peerId || `client-${Math.random().toString(36).substring(2, 9)}`;
    this.authToken = options.authToken || "dev-dummy-token";
    this.apiKey = options.apiKey;
    this.options = {
      url: this.url,
      docId: this.docId,
      peerId: this.peerId,
      authToken: this.authToken,
      apiKey: this.apiKey ?? "",
      autoReconnect: options.autoReconnect ?? true,
      reconnectIntervalMs: options.reconnectIntervalMs ?? 3000,
      onStatusChange: options.onStatusChange || (() => {}),
      onStatsChange: options.onStatsChange || (() => {}),
      onAgentStatusChange: options.onAgentStatusChange || (() => {}),
      onRemoteAwareness: options.onRemoteAwareness || (() => {}),
      onAuthSuccess: options.onAuthSuccess || (() => {}),
      onAuthError: options.onAuthError || (() => {}),
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

      this.ws.onopen = () => {
        this.setStatus("connected");

        // 1. Immediately transmit AuthMessage with dev bypass token
        const authPayload: AuthMessage = {
          type: "auth",
          token: this.authToken || "dev-dummy-token",
          ...(this.apiKey ? { apiKey: this.apiKey } : {}),
        };
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(authPayload));
        }

        // 2. Send crdt-sync frame (JSON with base64 payload + docId) to register room membership
        const snapshot = this.doc.export({ mode: "snapshot" });
        const syncMsg: SyncMessage = {
          type: "crdt-sync",
          docId: this.docId,
          payload: uint8ArrayToBase64(snapshot),
          senderId: this.peerId,
          timestamp: Date.now(),
        };

        if (this.ws?.readyState === WebSocket.OPEN) {
          const jsonPayload = JSON.stringify(syncMsg);
          this.ws.send(jsonPayload);
          this.stats.bytesSent += snapshot.length;
          this.stats.updatesSent += 1;
          this.stats.lastSyncAt = new Date();
          this.options.onStatsChange({ ...this.stats });
        }
      };

      this.ws.onmessage = async (event) => {
        // MU server protocol: All frames are JSON text frames
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data);

            if (message.type === "auth-success") {
              console.log(`[LoroSync] Authenticated successfully as user: ${message.userId}`);
              this.isAuthenticated = true;
              this.options.onAuthSuccess?.(message as AuthSuccessMessage);
            } else if (message.type === "auth-error") {
              console.error(
                `[LoroSync] Authentication error [${message.code || "AUTH_FAILED"}]: ${message.error}`,
              );
              this.isAuthenticated = false;
              this.options.onAuthError?.(message as AuthErrorMessage);
            } else if (message.type === "crdt-sync") {
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

      this.ws.onclose = (event: CloseEvent) => {
        this.isAuthenticated = false;
        this.setStatus("disconnected");
        this.ws = null;
        if (event?.code === 1008) {
          console.warn("[LoroSync] Connection closed by server due to policy violation (authentication failed).");
        }
        if (this.options.autoReconnect && !this.isDestroyed && event?.code !== 1008) {
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

  public dispatchAgentTask(prompt: string, simulateFailure = false) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const taskId = `task-${Date.now()}`;
    const request = {
      type: "agent-task-request",
      taskId,
      docId: this.docId,
      prompt,
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
