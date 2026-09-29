import { useEffect, useRef, useState } from "react";
import { LoroDoc } from "loro-crdt";
import { LoroSyncClient, ConnectionStatus, SyncStats } from "../services/loroSync";

export function useLoroSync(doc: LoroDoc, serverUrl: string = "ws://localhost:3001") {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [stats, setStats] = useState<SyncStats>({
    bytesSent: 0,
    bytesReceived: 0,
    updatesSent: 0,
    updatesReceived: 0,
    lastSyncAt: null,
  });

  const clientRef = useRef<LoroSyncClient | null>(null);

  useEffect(() => {
    const client = new LoroSyncClient(doc, {
      url: serverUrl,
      onStatusChange: setStatus,
      onStatsChange: setStats,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.destroy();
      clientRef.current = null;
    };
  }, [doc, serverUrl]);

  return {
    status,
    stats,
    reconnect: () => clientRef.current?.connect(),
    sendUpdate: () => clientRef.current?.exportAndSendUpdate(),
  };
}
