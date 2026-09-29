import { LoroDoc, VersionVector } from "loro-crdt";

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
        // On connect, export current state snapshot to synchronize with server
        const snapshot = this.doc.export({ mode: "snapshot" });
        if (snapshot.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(snapshot);
          this.stats.bytesSent += snapshot.length;
          this.stats.updatesSent += 1;
          this.stats.lastSyncAt = new Date();
          this.options.onStatsChange({ ...this.stats });
        }
      };

      this.ws.onmessage = async (event) => {
        let buffer: ArrayBuffer;
        if (event.data instanceof ArrayBuffer) {
          buffer = event.data;
        } else if (event.data instanceof Blob) {
          buffer = await event.data.arrayBuffer();
        } else {
          return;
        }

        const update = new Uint8Array(buffer);
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

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(update);
      this.stats.bytesSent += update.length;
      this.stats.updatesSent += 1;
      this.stats.lastSyncAt = new Date();
      this.options.onStatsChange({ ...this.stats });
    }

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
