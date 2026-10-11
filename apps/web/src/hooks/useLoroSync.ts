import { useEffect, useRef, useState, useCallback } from "react";
import { LoroDoc } from "loro-crdt";
import { LoroSyncClient, ConnectionStatus, SyncStats } from "../services/loroSync";
import { AgentTaskStatus, PeerAwareness, ByokConfig } from "../types/shared";

export function useLoroSync(
  doc: LoroDoc,
  serverUrl = "ws://localhost:3001",
  docId = "chrono-canvas-default",
  peerId?: string
) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [stats, setStats] = useState<SyncStats>({
    bytesSent: 0,
    bytesReceived: 0,
    updatesSent: 0,
    updatesReceived: 0,
    lastSyncAt: null,
  });
  const [agentStatus, setAgentStatus] = useState<AgentTaskStatus | null>(null);
  const [remotePeers, setRemotePeers] = useState<Map<string, PeerAwareness>>(new Map());

  const clientRef = useRef<LoroSyncClient | null>(null);

  const handleRemoteAwareness = useCallback((peer: PeerAwareness) => {
    setRemotePeers((prev) => {
      const next = new Map(prev);
      next.set(peer.peerId, peer);
      return next;
    });
  }, []);

  useEffect(() => {
    const client = new LoroSyncClient(doc, {
      url: serverUrl,
      docId,
      peerId,
      onStatusChange: setStatus,
      onStatsChange: setStats,
      onAgentStatusChange: setAgentStatus,
      onRemoteAwareness: handleRemoteAwareness,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.destroy();
      clientRef.current = null;
    };
  }, [doc, serverUrl, docId, peerId, handleRemoteAwareness]);

  const dispatchAgentTask = useCallback(
    (
      prompt: string,
      simulateFailure = false,
      failureType: "syntax" | "assertion" = "syntax",
      enableSelfHealing = false,
      byokConfig?: ByokConfig,
      authToken?: string
    ) => {
      clientRef.current?.dispatchAgentTask(prompt, simulateFailure, failureType, enableSelfHealing, byokConfig, authToken);
    },
    []
  );

  const clearAgentStatus = useCallback(() => {
    setAgentStatus(null);
  }, []);

  const broadcastAwareness = useCallback((peer: PeerAwareness) => {
    clientRef.current?.sendAwareness(peer);
  }, []);

  const getFrontierString = useCallback(() => {
    return clientRef.current?.getFrontierString() || "Latest";
  }, []);

  return {
    status,
    stats,
    agentStatus,
    remotePeers,
    dispatchAgentTask,
    clearAgentStatus,
    broadcastAwareness,
    getFrontierString,
    reconnect: () => clientRef.current?.connect(),
    sendUpdate: () => clientRef.current?.exportAndSendUpdate(),
  };
}
